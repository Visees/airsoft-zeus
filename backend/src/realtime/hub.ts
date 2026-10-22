import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { userForClaims } from '../auth/middleware.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { config } from '../config.js';
import { many, one } from '../db.js';
import { eventContext } from '../domain/context.js';
import { tracking as trackingOf, visibility as visibilityOf } from '../domain/defaults.js';
import { projectPositions, type IntelRow, type PosLocation, type PosMember, type ProjectionInput, type Sample, type Viewer, type VisiblePosition } from '../domain/rules.js';
import { TEAM_SELECT, team as teamDto } from '../domain/serialize.js';
import { logger } from '../logger.js';

/**
 * Rooms:
 *   u:<userId>                 every socket of a user (notifications, kicks)
 *   e:<eventId>                everyone subscribed to the event (members and GMs)
 *   e:<eventId>:gm             Game Masters
 *   e:<eventId>:t:<teamId>     members of a team ("none" for unassigned)
 * Payloads that depend on the viewer (positions, team balances, objectives) are either
 * computed per socket or announced as `invalidate` so clients refetch filtered REST data.
 */

export type InvalidateScope =
  | 'event'
  | 'me'
  | 'members'
  | 'squads'
  | 'objectives'
  | 'pois'
  | 'zones'
  | 'perks'
  | 'purchases'
  | 'effects'
  | 'alerts'
  | 'captures'
  | 'ledger';

export type Target = 'all' | 'gm' | { teamId: string | null } | { userId: string };

interface Sub {
  isGm: boolean;
  /** subscribed from the player screens: a Game Master on a team gets their team's view */
  asPlayer: boolean;
}

interface SocketData {
  userId: string;
  subs: Map<string, Sub>;
}

let io: Server | null = null;
const online = new Map<string, number>(); // userId → open sockets
const subscribers = new Map<string, Set<string>>(); // eventId → socket ids
const dirtyPositions = new Set<string>();
const teamsTimers = new Map<string, NodeJS.Timeout>();
let broadcastTimer: NodeJS.Timeout | null = null;
let heartbeat = 0;

export function initRealtime(server: HttpServer): Server {
  io = new Server(server, {
    path: '/socket.io',
    serveClient: false,
    cors: { origin: false },
    pingInterval: 20_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 64 * 1024,
  });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      const claims = token ? verifyAccessToken(token) : null;
      const user = claims ? await userForClaims(claims.sub, claims.ver) : null;
      if (!user || !user.emailVerified) return next(new Error('unauthorized'));
      (socket.data as SocketData).userId = user.id;
      (socket.data as SocketData).subs = new Map();
      next();
    } catch (err) {
      logger.warn({ err }, 'socket auth failed');
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const data = socket.data as SocketData;
    void socket.join(`u:${data.userId}`);
    online.set(data.userId, (online.get(data.userId) ?? 0) + 1);

    socket.on('subscribe', async (eventId: unknown, ...args: unknown[]) => {
      // subscribe(eventId, ack) or subscribe(eventId, { view }, ack)
      const ack = args.find((a) => typeof a === 'function') as ((res: { ok: boolean; error?: string; role?: 'gm' | 'player' }) => void) | undefined;
      const opts = args.find((a) => typeof a === 'object' && a !== null) as { view?: unknown } | undefined;
      const reply = ack ?? (() => undefined);
      try {
        if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) return reply({ ok: false, error: 'invalid_event' });
        const ok = await joinEventRooms(socket, eventId, opts?.view === 'player');
        if (!ok) return reply({ ok: false, error: 'not_member' });
        reply({ ok: true, role: data.subs.get(eventId)?.isGm ? 'gm' : 'player' });
        dirtyPositions.add(eventId);
      } catch (err) {
        logger.warn({ err }, 'subscribe failed');
        reply({ ok: false, error: 'server_error' });
      }
    });

    socket.on('unsubscribe', (eventId: unknown) => {
      if (typeof eventId === 'string') leaveEventRooms(socket, eventId);
    });

    socket.on('disconnect', () => {
      const n = (online.get(data.userId) ?? 1) - 1;
      if (n <= 0) online.delete(data.userId);
      else online.set(data.userId, n);
      for (const eventId of data.subs.keys()) subscribers.get(eventId)?.delete(socket.id);
      void one('UPDATE event_members SET last_seen_at = now() WHERE user_id = $1 AND status = $2', [data.userId, 'approved']).catch(() => undefined);
    });
  });

  broadcastTimer = setInterval(() => void broadcastPositions(), config.POSITIONS_BROADCAST_MS);
  return io;
}

export function closeRealtime(): Promise<void> {
  if (broadcastTimer) clearInterval(broadcastTimer);
  return new Promise((resolve) => (io ? io.close(() => resolve()) : resolve()));
}

async function joinEventRooms(socket: Socket, eventId: string, asPlayer: boolean): Promise<boolean> {
  const data = socket.data as SocketData;
  const ctx = await eventContext(eventId, data.userId, undefined, false, asPlayer);
  const allowed = ctx.isGm || ctx.member?.status === 'approved';
  leaveEventRooms(socket, eventId);
  if (!allowed) return false;
  const rooms = [`e:${eventId}`];
  if (ctx.isGm) rooms.push(`e:${eventId}:gm`);
  else rooms.push(`e:${eventId}:t:${ctx.member?.team_id ?? 'none'}`);
  await socket.join(rooms);
  data.subs.set(eventId, { isGm: ctx.isGm, asPlayer });
  let set = subscribers.get(eventId);
  if (!set) subscribers.set(eventId, (set = new Set()));
  set.add(socket.id);
  return true;
}

function leaveEventRooms(socket: Socket, eventId: string): void {
  const data = socket.data as SocketData;
  for (const room of socket.rooms) if (room === `e:${eventId}` || room.startsWith(`e:${eventId}:`)) void socket.leave(room);
  data.subs.delete(eventId);
  subscribers.get(eventId)?.delete(socket.id);
}

function room(eventId: string, target: Target): string {
  if (target === 'all') return `e:${eventId}`;
  if (target === 'gm') return `e:${eventId}:gm`;
  if ('userId' in target) return `u:${target.userId}`;
  return `e:${eventId}:t:${target.teamId ?? 'none'}`;
}

export const hub = {
  isOnline(userId: string): boolean {
    return (online.get(userId) ?? 0) > 0;
  },

  invalidate(eventId: string, scopes: InvalidateScope[], targets: Target[] = ['all']): void {
    if (!io) return;
    for (const t of targets) io.to(room(eventId, t)).emit('invalidate', { eventId, scopes });
  },

  emit(eventId: string, name: string, payload: unknown, targets: Target[] = ['all']): void {
    if (!io) return;
    let op = io.to(room(eventId, targets[0]));
    for (const t of targets.slice(1)) op = op.to(room(eventId, t));
    op.emit(name, payload);
  },

  toUser(userId: string, name: string, payload: unknown): void {
    io?.to(`u:${userId}`).emit(name, payload);
  },

  /** Team scores to every room, with currency filtered per viewer. Debounced per event. */
  teams(eventId: string): void {
    if (!io) return;
    const existing = teamsTimers.get(eventId);
    if (existing) return;
    teamsTimers.set(
      eventId,
      setTimeout(() => {
        teamsTimers.delete(eventId);
        void emitTeams(eventId).catch((err) => logger.warn({ err }, 'emit teams failed'));
      }, 250),
    );
  },

  positionsDirty(eventId: string): void {
    dirtyPositions.add(eventId);
  },

  /** Re-evaluate a user's rooms after their membership/team/role changed. */
  async refreshUser(eventId: string, userId: string, notifyKick = true): Promise<void> {
    if (!io) return;
    const sockets = await io.in(`u:${userId}`).fetchSockets();
    for (const s of sockets) {
      const local = io.sockets.sockets.get(s.id);
      const sub = local ? (local.data as SocketData).subs.get(eventId) : undefined;
      if (!local || !sub) continue;
      const ok = await joinEventRooms(local, eventId, sub.asPlayer);
      if (!ok && notifyKick) local.emit('kicked', { eventId, reason: 'You are no longer a member of this event.' });
    }
    io.to(`u:${userId}`).emit('invalidate', { eventId, scopes: ['event', 'me', 'objectives', 'pois', 'zones', 'perks', 'purchases', 'effects'] });
    dirtyPositions.add(eventId);
  },

  kick(eventId: string, userId: string, reason: string): void {
    if (!io) return;
    io.to(`u:${userId}`).emit('kicked', { eventId, reason });
    void hub.refreshUser(eventId, userId);
  },

  /** Every socket subscribed to the event re-joins its rooms (team reshuffles, GM changes). */
  async refreshEvent(eventId: string): Promise<void> {
    if (!io) return;
    for (const id of subscribers.get(eventId) ?? []) {
      const s = io.sockets.sockets.get(id);
      const sub = s ? (s.data as SocketData).subs.get(eventId) : undefined;
      if (s && sub) await joinEventRooms(s, eventId, sub.asPlayer).catch(() => undefined);
    }
    dirtyPositions.add(eventId);
  },
};

async function emitTeams(eventId: string): Promise<void> {
  if (!io) return;
  const ev = await one<{ visibility_rules: unknown }>('SELECT visibility_rules FROM events WHERE id = $1', [eventId]);
  if (!ev) return;
  const rules = visibilityOf(ev.visibility_rules);
  const teams = await many(`SELECT ${TEAM_SELECT} FROM teams t WHERE t.event_id = $1 ORDER BY t.sort_order, t.created_at`, [eventId]);
  io.to(`e:${eventId}:gm`).emit('teams', { eventId, teams: teams.map((t) => teamDto(t, { showCurrency: true })) });
  for (const viewerTeam of [...teams.map((t) => t.id as string), 'none']) {
    io.to(`e:${eventId}:t:${viewerTeam}`).emit('teams', {
      eventId,
      teams: teams.map((t) => teamDto(t, { showCurrency: rules.showEnemyCurrency || t.id === viewerTeam })),
    });
  }
}

// ---------------------------------------------------------------------------
// Positions broadcaster
// ---------------------------------------------------------------------------

async function broadcastPositions(): Promise<void> {
  if (!io) return;
  heartbeat++;
  const everyFew = heartbeat % 5 === 0; // refresh online/stale status even without movement
  for (const [eventId, sockets] of subscribers) {
    if (sockets.size === 0) {
      subscribers.delete(eventId);
      continue;
    }
    if (!dirtyPositions.has(eventId) && !everyFew) continue;
    dirtyPositions.delete(eventId);
    try {
      await broadcastEvent(eventId, sockets);
    } catch (err) {
      logger.warn({ err, eventId }, 'positions broadcast failed');
    }
  }
}

interface ProjectionData {
  input: Omit<ProjectionInput, 'now'>;
  members: Map<string, PosMember & { role: string }>;
  teamAlliance: (teamId: string) => string | null;
}

/** Everything the projection needs for one event, or null when positions are not shared now. */
async function loadProjection(eventId: string): Promise<ProjectionData | null> {
  const ev = await one<{ status: string; tracking: unknown; visibility_rules: unknown }>('SELECT status, tracking, visibility_rules FROM events WHERE id = $1', [
    eventId,
  ]);
  if (!ev || !['live', 'paused', 'completed'].includes(ev.status)) return null;
  const [members, teams, locations, intel] = await Promise.all([
    many(
      `SELECT m.user_id, u.nickname, m.team_id, m.squad_id, m.is_squad_leader, m.player_role, m.tracking_active, m.role
         FROM event_members m JOIN users u ON u.id = m.user_id
        WHERE m.event_id = $1 AND m.status = 'approved'`,
      [eventId],
    ),
    many<{ id: string; alliance_id: string | null }>('SELECT id, alliance_id FROM teams WHERE event_id = $1', [eventId]),
    many('SELECT * FROM player_locations WHERE event_id = $1', [eventId]),
    many(
      `SELECT i.*, e.expires_at FROM intel_positions i JOIN effects e ON e.id = i.effect_id
        WHERE i.event_id = $1 AND e.status = 'active' AND e.expires_at > now()`,
      [eventId],
    ),
  ]);
  const memberMap = new Map<string, PosMember & { role: string }>(
    members.map((m) => [
      m.user_id,
      {
        userId: m.user_id,
        nickname: m.nickname,
        teamId: m.team_id,
        squadId: m.squad_id,
        isSquadLeader: m.is_squad_leader,
        playerRole: m.player_role,
        trackingActive: m.tracking_active,
        role: m.role,
      },
    ]),
  );
  const alliance = new Map(teams.map((t) => [t.id, t.alliance_id]));
  const teamAlliance = (teamId: string) => alliance.get(teamId) ?? null;
  const locs: PosLocation[] = locations
    .filter((l) => {
      const m = memberMap.get(l.user_id);
      return !!m && (m.role === 'player' || !!m.teamId);
    })
    .map((l) => ({
      userId: l.user_id,
      lat: l.lat,
      lng: l.lng,
      accuracy: l.accuracy,
      sampleAt: new Date(l.sample_at).getTime(),
      receivedAt: new Date(l.received_at).getTime(),
      ring: (l.ring ?? []) as Sample[],
      suspiciousCount: l.suspicious_count,
      lastFlagAt: l.last_flag_at ? new Date(l.last_flag_at).getTime() : null,
    }));
  const intelRows: IntelRow[] = intel.map((i) => ({
    userId: i.user_id,
    viewerTeamId: i.viewer_team_id,
    lat: i.lat,
    lng: i.lng,
    radiusM: i.radius_m,
    precision: i.precision,
    sampleAt: new Date(i.sample_at).getTime(),
    writtenAt: new Date(i.written_at).getTime(),
    expiresAt: new Date(i.expires_at).getTime(),
  }));
  return {
    input: { rules: visibilityOf(ev.visibility_rules), tracking: trackingOf(ev.tracking), members: memberMap, teamAlliance, locations: locs, intel: intelRows },
    members: memberMap,
    teamAlliance,
  };
}

function viewerFor(userId: string, isGm: boolean, data: ProjectionData): Viewer {
  const m = data.members.get(userId);
  return {
    userId,
    isGm,
    approved: !!m,
    teamId: m?.teamId ?? null,
    squadId: m?.squadId ?? null,
    isSquadLeader: m?.isSquadLeader ?? false,
    playerRole: m?.playerRole ?? 'rifleman',
    allianceId: m?.teamId ? data.teamAlliance(m.teamId) : null,
  };
}

async function broadcastEvent(eventId: string, socketIds: Set<string>): Promise<void> {
  const data = await loadProjection(eventId);
  if (!data) return;
  const now = Date.now();
  const serverNow = new Date(now).toISOString();
  for (const id of socketIds) {
    const s = io!.sockets.sockets.get(id);
    if (!s) continue;
    const sd = s.data as SocketData;
    const sub = sd.subs.get(eventId);
    if (!sub) continue;
    const positions = projectPositions(viewerFor(sd.userId, sub.isGm, data), { ...data.input, now });
    s.emit('positions', { eventId, positions, serverNow });
  }
}

/** Positions for one viewer (REST snapshot) — same projection as the broadcaster. */
export async function positionsFor(eventId: string, userId: string, isGm: boolean): Promise<VisiblePosition[]> {
  const data = await loadProjection(eventId);
  if (!data) return [];
  return projectPositions(viewerFor(userId, isGm, data), { ...data.input, now: Date.now() });
}
