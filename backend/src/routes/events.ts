import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireFeature } from '../auth/features.js';
import { currentUser, requireVerified, userIsAdmin } from '../auth/middleware.js';
import { many, one, tx, type Tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { normalizeCode, readableCode, safeEqual } from '../lib/ids.js';
import { decodeCursor, page } from '../lib/pagination.js';
import { consume } from '../lib/rate-limit.js';
import { body, hexColor, idParam, isoDate, lat, lng, playerRole, queryOf, shortText, uuid } from '../lib/validate.js';
import { hub } from '../realtime/hub.js';
import { canViewEvent, eventContext, FINISHED, requireGm, requireViewable, type EventContext } from '../domain/context.js';
import { materialize, snapshotEvent } from '../domain/copy.js';
import { merge, scoringSchema, trackingSchema, visibilitySchema, DEFAULT_SCORING, DEFAULT_TRACKING, DEFAULT_VISIBILITY } from '../domain/defaults.js';
import { activity, audit, eventGms, notify } from '../domain/journal.js';
import { extend, transition } from '../domain/lifecycle.js';
import * as dto from '../domain/serialize.js';
import { eventDetail, membersFor } from '../domain/views.js';
import { removeAttachmentFiles } from './attachments.js';
import { eventDate, tr } from '../i18n/index.js';

export const eventsRouter = Router();

const gameMode = z.enum(['sunday', 'milsim', 'scenario', 'championship', 'plr', 'pcr', 'custom']);
const status = z.enum(['draft', 'published', 'registration_open', 'lobby', 'live', 'paused', 'completed', 'cancelled']);

const eventInput = z.object({
  name: shortText(120).min(3, 'At least 3 characters'),
  coverUrl: z.string().max(500).startsWith('/api/files/').nullable().optional(),
  description: z.string().max(10_000).optional(),
  gameMode,
  customModeName: shortText(80).nullable().optional(),
  customModeRules: z.string().max(10_000).nullable().optional(),
  startAt: isoDate,
  endAt: isoDate,
  meetingAddress: shortText(300).nullable().optional(),
  meetingLat: lat.nullable().optional(),
  meetingLng: lng.nullable().optional(),
  minPlayers: z.number().int().min(0).max(2000).optional(),
  maxPlayers: z.number().int().min(1).max(2000).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  requiresApproval: z.boolean().optional(),
  rules: z.string().max(20_000).optional(),
  safetyRules: z.string().max(20_000).optional(),
  requiredEquipment: z.string().max(10_000).optional(),
  chronoInfo: z.string().max(10_000).optional(),
  teamSelection: z.enum(['gm', 'auto', 'player']).optional(),
  teamsLocked: z.boolean().optional(),
  registrationLocked: z.boolean().optional(),
  area: z.object({ lat, lng, zoom: z.number().min(1).max(22) }).nullable().optional(),
  tracking: trackingSchema.partial().optional(),
  visibilityRules: visibilitySchema.partial().optional(),
  scoring: scoringSchema.partial().optional(),
  storeEnabled: z.boolean().optional(),
  phase: shortText(40).nullable().optional(),
  autoEnd: z.boolean().optional(),
});

const COLS: Record<string, string> = {
  name: 'name',
  coverUrl: 'cover_url',
  description: 'description',
  gameMode: 'game_mode',
  customModeName: 'custom_mode_name',
  customModeRules: 'custom_mode_rules',
  startAt: 'start_at',
  endAt: 'end_at',
  meetingAddress: 'meeting_address',
  meetingLat: 'meeting_lat',
  meetingLng: 'meeting_lng',
  minPlayers: 'min_players',
  maxPlayers: 'max_players',
  visibility: 'visibility',
  requiresApproval: 'requires_approval',
  rules: 'rules',
  safetyRules: 'safety_rules',
  requiredEquipment: 'required_equipment',
  chronoInfo: 'chrono_info',
  teamSelection: 'team_selection',
  teamsLocked: 'teams_locked',
  registrationLocked: 'registration_locked',
  storeEnabled: 'store_enabled',
  phase: 'phase',
  autoEnd: 'auto_end',
};

function validateTimes(start?: string, end?: string, min?: number, max?: number) {
  const fields: Record<string, string> = {};
  if (start && end && Date.parse(end) <= Date.parse(start)) fields.endAt = tr`The end must be after the start`;
  if (min !== undefined && max !== undefined && min > max) fields.minPlayers = tr`Minimum players cannot exceed the maximum`;
  if (Object.keys(fields).length) throw badRequest(tr`Some fields are not valid.`, 'invalid_argument', fields);
}

async function detail(eventId: string, userId: string) {
  return eventDetail(await eventContext(eventId, userId));
}

// ------------------------------------------------------------------ listing

eventsRouter.get('/discover', requireFeature('discover_events'), async (req, res) => {
  const me = currentUser(req);
  const q = queryOf(req, z.object({ q: z.string().max(80).optional(), mode: gameMode.optional(), from: z.string().optional(), cursor: z.string().optional() }));
  const c = decodeCursor(q.cursor);
  const params: unknown[] = [me.id];
  const where = [`e.visibility = 'public'`, `e.status IN ('published','registration_open','lobby','live','paused')`];
  if (q.q?.trim()) {
    params.push(q.q.trim());
    where.push(`(e.name ILIKE '%' || $${params.length} || '%' OR e.meeting_address ILIKE '%' || $${params.length} || '%')`);
  }
  if (q.mode) {
    params.push(q.mode);
    where.push(`e.game_mode = $${params.length}`);
  }
  const from = q.from && !isNaN(Date.parse(q.from)) ? q.from : new Date(Date.now() - 12 * 3600_000).toISOString();
  params.push(from);
  where.push(`e.end_at >= $${params.length}`);
  if (c) {
    params.push(c.at, c.id);
    where.push(`(e.start_at, e.id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const rows = await many(`SELECT ${dto.EVENT_SUMMARY_SELECT} FROM events e WHERE ${where.join(' AND ')} ORDER BY e.start_at, e.id LIMIT 21`, params);
  res.json(page(rows.map((r) => ({ ...r, created_at: r.start_at })), 20, dto.eventSummary));
});

eventsRouter.get('/mine', async (req, res) => {
  const me = currentUser(req);
  const { filter } = queryOf(req, z.object({ filter: z.enum(['upcoming', 'past', 'gm', 'invitations']).default('upcoming') }));
  const conds: Record<string, string> = {
    upcoming: `EXISTS (SELECT 1 FROM event_members m WHERE m.event_id = e.id AND m.user_id = $1 AND m.status IN ('pending','approved'))
               AND e.status NOT IN ('completed','cancelled')`,
    past: `EXISTS (SELECT 1 FROM event_members m WHERE m.event_id = e.id AND m.user_id = $1 AND m.status IN ('approved','left','removed','banned'))
           AND e.status IN ('completed','cancelled')`,
    gm: `(e.owner_id = $1 OR EXISTS (SELECT 1 FROM event_members m WHERE m.event_id = e.id AND m.user_id = $1 AND m.role = 'gm' AND m.status = 'approved'))`,
    invitations: `EXISTS (SELECT 1 FROM event_members m WHERE m.event_id = e.id AND m.user_id = $1 AND m.status = 'invited') AND e.status NOT IN ('completed','cancelled')`,
  };
  const order = filter === 'past' ? 'e.start_at DESC' : filter === 'gm' ? `CASE WHEN e.status IN ('completed','cancelled') THEN 1 ELSE 0 END, e.start_at` : 'e.start_at';
  const rows = await many(`SELECT ${dto.EVENT_SUMMARY_SELECT} FROM events e WHERE ${conds[filter]} ORDER BY ${order} LIMIT 200`, [me.id]);
  res.json(rows.map(dto.eventSummary));
});

// ------------------------------------------------------------------ create / read / update

eventsRouter.post('/', requireFeature('create_events'), async (req, res) => {
  const me = currentUser(req);
  const b = body(req, eventInput);
  validateTimes(b.startAt, b.endAt, b.minPlayers, b.maxPlayers);
  await consume('event-create', me.id, 20, 86400, tr`You created many events today. Try again tomorrow.`);
  const id = await tx(async (t) => {
    const ev = await one<{ id: string }>(
      `INSERT INTO events (owner_id, name, cover_url, description, game_mode, custom_mode_name, custom_mode_rules, start_at, end_at, meeting_address,
                           meeting_lat, meeting_lng, min_players, max_players, visibility, requires_approval, rules, safety_rules, required_equipment,
                           chrono_info, team_selection, area_lat, area_lng, area_zoom, tracking, visibility_rules, scoring, store_enabled, auto_end, join_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30) RETURNING id`,
      [
        me.id, b.name, b.coverUrl ?? null, b.description ?? '', b.gameMode, b.customModeName ?? null, b.customModeRules ?? null, b.startAt, b.endAt,
        b.meetingAddress ?? null, b.meetingLat ?? null, b.meetingLng ?? null, b.minPlayers ?? 2, b.maxPlayers ?? 40, b.visibility ?? 'public',
        b.requiresApproval ?? false, b.rules ?? '', b.safetyRules ?? '', b.requiredEquipment ?? '', b.chronoInfo ?? '', b.teamSelection ?? 'gm',
        b.area?.lat ?? b.meetingLat ?? null, b.area?.lng ?? b.meetingLng ?? null, b.area?.zoom ?? 16,
        JSON.stringify(merge(DEFAULT_TRACKING, b.tracking ?? {})), JSON.stringify(merge(DEFAULT_VISIBILITY, b.visibilityRules ?? {})),
        JSON.stringify(merge(DEFAULT_SCORING, b.scoring ?? {})), b.storeEnabled ?? true, b.autoEnd ?? true, readableCode(8),
      ],
      t,
    );
    await t.query(`INSERT INTO event_members (event_id, user_id, role, status) VALUES ($1,$2,'gm','approved')`, [ev!.id, me.id]);
    await audit(t, ev!.id, me.id, 'event.create', { type: 'event', id: ev!.id, after: { name: b.name } });
    return ev!.id;
  });
  res.status(201).json(await detail(id, me.id));
});

eventsRouter.post('/find-by-code', async (req, res) => {
  const me = currentUser(req);
  const b = body(req, z.object({ code: z.string().max(20) }));
  await consume('find-code', me.id, 10, 60, tr`Too many code attempts. Wait a minute.`);
  const code = normalizeCode(b.code);
  const ev = code.length >= 4 ? await one<{ id: string }>(`SELECT id FROM events WHERE join_code = $1 AND status NOT IN ('draft','cancelled')`, [code]) : null;
  if (!ev) throw notFound(tr`No event with this code. Check it with the Game Master.`, 'invalid_code');
  res.json({ eventId: ev.id });
});

eventsRouter.get('/:eventId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const { code } = queryOf(req, z.object({ code: z.string().max(20).optional() }));
  const ctx = await eventContext(eventId, me.id);
  if (!canViewEvent(ctx)) {
    // A private event opens for someone holding its join code (the invite link), before joining.
    await consume('event-code', me.id, 20, 60, tr`Too many code attempts. Wait a minute.`);
    const ok = !!code && !!ctx.event.join_code && !['draft', 'cancelled'].includes(ctx.event.status) && safeEqual(normalizeCode(code), ctx.event.join_code);
    if (!ok) throw notFound(tr`Event not found.`);
  }
  res.json(await eventDetail(ctx));
});

eventsRouter.patch('/:eventId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, eventInput.partial());
  const changed = await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    if (FINISHED.includes(ctx.event.status)) throw conflict(tr`Finished events cannot be edited.`, 'event_finished');
    const e = ctx.event;
    validateTimes(b.startAt ?? e.start_at.toISOString(), b.endAt ?? e.end_at.toISOString(), b.minPlayers ?? e.min_players, b.maxPlayers ?? e.max_players);
    const sets: string[] = [];
    const params: unknown[] = [eventId];
    for (const [k, col] of Object.entries(COLS)) {
      const v = (b as Record<string, unknown>)[k];
      if (v !== undefined) {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (b.area !== undefined) {
      params.push(b.area?.lat ?? null, b.area?.lng ?? null, b.area?.zoom ?? null);
      sets.push(`area_lat = $${params.length - 2}`, `area_lng = $${params.length - 1}`, `area_zoom = $${params.length}`);
    }
    const nested: [keyof typeof b, string, unknown][] = [
      ['tracking', 'tracking', ctx.tracking],
      ['visibilityRules', 'visibility_rules', ctx.rules],
      ['scoring', 'scoring', ctx.scoring],
    ];
    for (const [k, col, current] of nested) {
      if (b[k]) {
        params.push(JSON.stringify(merge(current, b[k])));
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (!sets.length) return [] as string[];
    await t.query(`UPDATE events SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
    const keys = Object.keys(b);
    await audit(t, eventId, me.id, 'event.update', { type: 'event', id: eventId, before: pickKeys(ctx, keys), after: b });
    return keys;
  });
  if (changed.length) {
    hub.invalidate(eventId, ['event']);
    if (changed.some((k) => ['visibilityRules', 'tracking', 'phase', 'storeEnabled'].includes(k))) {
      hub.invalidate(eventId, ['objectives', 'pois', 'zones', 'perks', 'members']);
      hub.positionsDirty(eventId);
      hub.teams(eventId);
    }
    if (changed.includes('startAt') || changed.includes('endAt')) {
      const fresh = await one('SELECT * FROM events WHERE id = $1', [eventId]);
      if (fresh) hub.emit(eventId, 'clock', { eventId, clock: dto.clock(fresh) });
    }
  }
  res.json(await detail(eventId, me.id));
});

function pickKeys(ctx: EventContext, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k === 'tracking') out[k] = ctx.tracking;
    else if (k === 'visibilityRules') out[k] = ctx.rules;
    else if (k === 'scoring') out[k] = ctx.scoring;
    else if (COLS[k]) out[k] = ctx.event[COLS[k]];
  }
  return out;
}

eventsRouter.delete('/:eventId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  // Platform admins can remove any event they can see, in any state (moderation).
  const admin = await userIsAdmin(me.id);
  const files = await tx(async (t) => {
    const ctx = admin ? await requireViewable(eventId, me.id, t) : await requireGm(eventId, me.id, t, true);
    if (!admin) {
      if (ctx.event.owner_id !== me.id) throw forbidden(tr`Only the event owner can delete it.`);
      if (!['draft', 'cancelled'].includes(ctx.event.status)) throw conflict(tr`Only drafts and cancelled events can be deleted. Cancel it first.`, 'invalid_state');
    }
    const members = admin
      ? (await many<{ user_id: string }>(`SELECT user_id FROM event_members WHERE event_id = $1 AND user_id <> $2 AND status IN ('invited','pending','approved')`, [eventId, me.id], t)).map((r) => r.user_id)
      : [];
    const files = await many<{ stored_name: string }>('SELECT stored_name FROM event_attachments WHERE event_id = $1', [eventId], t);
    await t.query("SELECT set_config('airsofthub.allow_purge', 'on', true)");
    await t.query('DELETE FROM events WHERE id = $1', [eventId]);
    await notify(t, members, { type: 'event_removed', title: (tr) => tr`${ctx.event.name} was removed`, body: (tr) => tr`A platform admin removed this event.`, url: '/notifications' });
    return files.map((f) => f.stored_name);
  });
  await removeAttachmentFiles(files);
  if (admin) hub.invalidate(eventId, ['event']);
  res.json({ ok: true });
});

eventsRouter.post('/:eventId/status', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, z.object({ status, reason: z.string().max(500).optional() }));
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    await transition(t, ctx, b.status, me.id, b.reason ?? null);
  });
  res.json(await detail(eventId, me.id));
});

eventsRouter.post('/:eventId/gm/extend', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, z.object({ minutes: z.number().int().min(1).max(600) }));
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    await extend(t, ctx, b.minutes, me.id);
  });
  res.json(await detail(eventId, me.id));
});

eventsRouter.post('/:eventId/join-code/regenerate', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const code = await tx(async (t) => {
    await requireGm(eventId, me.id, t, true);
    const code = readableCode(8);
    await t.query('UPDATE events SET join_code = $2, updated_at = now() WHERE id = $1', [eventId, code]);
    await audit(t, eventId, me.id, 'event.join_code.regenerate', { type: 'event', id: eventId });
    return code;
  });
  res.json({ joinCode: code });
});

// ------------------------------------------------------------------ copies & templates

eventsRouter.post('/:eventId/duplicate', requireFeature('create_events'), async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const id = await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t);
    const snap = await snapshotEvent(eventId, t);
    return materialize(t, me.id, snap, { name: tr`${ctx.event.name} (copy)`.slice(0, 120) });
  });
  res.status(201).json(await detail(id, me.id));
});

eventsRouter.post('/:eventId/template', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, z.object({ name: shortText(120).min(2) }));
  const row = await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const snap = await snapshotEvent(eventId, t);
    return one(
      `INSERT INTO event_templates (owner_id, name, data) VALUES ($1,$2,$3) RETURNING id, name, created_at, data->'event'->>'game_mode' AS game_mode`,
      [me.id, b.name, JSON.stringify(snap)],
      t,
    );
  });
  res.status(201).json({ id: row!.id, name: row!.name, createdAt: dto.iso(row!.created_at), gameMode: row!.game_mode ?? 'custom' });
});

export const templateInstantiateRouter = Router();
templateInstantiateRouter.post('/templates/events/:id/instantiate', requireVerified, requireFeature('create_events'), async (req, res) => {
  const me = currentUser(req);
  const b = body(req, z.object({ name: shortText(120).min(3), startAt: isoDate, endAt: isoDate }));
  validateTimes(b.startAt, b.endAt);
  const tpl = await one('SELECT data FROM event_templates WHERE id = $1 AND owner_id = $2', [idParam(req, 'id'), me.id]);
  if (!tpl) throw notFound(tr`Template not found.`);
  const id = await tx((t) => materialize(t, me.id, tpl.data, b));
  res.status(201).json(await detail(id, me.id));
});

// ------------------------------------------------------------------ membership

async function memberDto(t: Tx | null, eventId: string, userId: string, viewerIsGm: boolean) {
  const m = await one('SELECT m.*, u.nickname, u.avatar_url FROM event_members m JOIN users u ON u.id = m.user_id WHERE m.event_id = $1 AND m.user_id = $2', [eventId, userId], t ?? undefined);
  if (!m) throw notFound(tr`Member not found.`);
  return dto.member(m, { viewerIsGm, showRole: true, online: hub.isOnline(userId) });
}

/** Assign to the team with the fewest players that still has room. */
async function autoTeam(t: Tx, eventId: string): Promise<string | null> {
  const row = await one<{ id: string }>(
    `SELECT t.id FROM teams t
      LEFT JOIN event_members m ON m.team_id = t.id AND m.status = 'approved'
      WHERE t.event_id = $1 GROUP BY t.id
      HAVING t.capacity = 0 OR count(m.user_id) < t.capacity
      ORDER BY count(m.user_id), t.sort_order, random() LIMIT 1`,
    [eventId],
    t,
  );
  return row?.id ?? null;
}

async function emergencyFor(t: Tx, userId: string) {
  const u = await one('SELECT emergency_contact, emergency_contact_enabled, privacy FROM users WHERE id = $1', [userId], t);
  return u && u.emergency_contact_enabled && u.privacy?.shareEmergencyWithGm ? u.emergency_contact : null;
}

eventsRouter.post('/:eventId/join', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, z.object({ joinCode: z.string().max(20).optional() }));
  await consume('join', me.id, 10, 60);
  const result = await tx(async (t) => {
    const ctx = await eventContext(eventId, me.id, t, true);
    const e = ctx.event;
    if (ctx.isGm) throw conflict(tr`You are a Game Master of this event.`, 'is_gm');
    const existing = ctx.member;
    if (existing && ['approved', 'pending'].includes(existing.status)) return existing.status;
    if (existing && ['rejected', 'banned'].includes(existing.status)) throw forbidden(tr`The Game Master did not accept you in this event.`, 'not_allowed');
    const invited = existing?.status === 'invited';
    if (!invited) {
      if (e.visibility === 'private' && (!b.joinCode || !e.join_code || !safeEqual(normalizeCode(b.joinCode), e.join_code))) {
        throw forbidden(tr`Enter the join code you received from the Game Master.`, 'invalid_code');
      }
      if (!['registration_open', 'lobby'].includes(e.status)) throw conflict(tr`Registration is not open for this event.`, 'registration_closed');
      if (e.registration_locked) throw conflict(tr`Registration is closed.`, 'registration_closed');
    }
    const count = await one<{ n: number }>(`SELECT count(*)::int AS n FROM event_members WHERE event_id = $1 AND role = 'player' AND status IN ('approved','pending')`, [eventId], t);
    if ((count?.n ?? 0) >= e.max_players) throw conflict(tr`This event is full.`, 'event_full');

    const status = invited || !e.requires_approval ? 'approved' : 'pending';
    const user = await one('SELECT player_role, nickname FROM users WHERE id = $1', [me.id], t);
    const teamId = status === 'approved' && e.team_selection === 'auto' ? await autoTeam(t, eventId) : null;
    await t.query(
      `INSERT INTO event_members (event_id, user_id, role, status, player_role, team_id, emergency_contact, joined_at)
       VALUES ($1,$2,'player',$3,$4,$5,$6, now())
       ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status, player_role = EXCLUDED.player_role, team_id = EXCLUDED.team_id,
         emergency_contact = EXCLUDED.emergency_contact, ready = false, joined_at = now(), updated_at = now()`,
      [eventId, me.id, status, user?.player_role ?? 'rifleman', teamId, JSON.stringify(await emergencyFor(t, me.id))],
    );
    await activity(t, eventId, { type: 'member_joined', message: `${user?.nickname} ${status === 'pending' ? 'asked to join' : 'joined'}`, scope: 'gm', userId: me.id });
    if (status === 'pending') {
      await notify(t, await eventGms(t, eventId), {
        type: 'registration_approved',
        title: (tr) => tr`New registration request`,
        body: (tr) => tr`${user?.nickname} wants to join ${e.name}.`,
        eventId,
        url: `/gm/events/${eventId}/players`,
      });
    }
    return status;
  });
  hub.invalidate(eventId, ['members'], ['all']);
  void hub.refreshUser(eventId, me.id);
  res.json({ status: result });
});

eventsRouter.post('/:eventId/leave', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  await tx(async (t) => {
    const ctx = await eventContext(eventId, me.id, t);
    if (ctx.event.owner_id === me.id) throw conflict(tr`The owner cannot leave the event. Cancel it instead.`, 'is_owner');
    if (!ctx.member || !['approved', 'pending', 'invited'].includes(ctx.member.status)) return;
    await t.query(
      `UPDATE event_members SET status = 'left', tracking_active = false, ready = false, emergency_contact = NULL, is_squad_leader = false, updated_at = now()
        WHERE event_id = $1 AND user_id = $2`,
      [eventId, me.id],
    );
    await t.query('UPDATE squads SET leader_id = NULL WHERE event_id = $1 AND leader_id = $2', [eventId, me.id]);
    await activity(t, eventId, { type: 'member_left', message: (tr) => tr`${me.nickname} left the event`, scope: 'gm', userId: me.id });
  });
  hub.invalidate(eventId, ['members']);
  void hub.refreshUser(eventId, me.id, false);
  res.json({ ok: true });
});

eventsRouter.post('/:eventId/invitation', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, z.object({ accept: z.boolean() }));
  const status = await tx(async (t) => {
    const ctx = await eventContext(eventId, me.id, t, true);
    if (ctx.member?.status !== 'invited') throw conflict(tr`There is no open invitation for you.`, 'no_invitation');
    if (!b.accept) {
      await t.query(`UPDATE event_members SET status = 'left', updated_at = now() WHERE event_id = $1 AND user_id = $2`, [eventId, me.id]);
      return 'left';
    }
    const teamId = ctx.event.team_selection === 'auto' ? await autoTeam(t, eventId) : null;
    await t.query(
      `UPDATE event_members SET status = 'approved', team_id = COALESCE(team_id, $3), emergency_contact = $4, joined_at = now(), updated_at = now()
        WHERE event_id = $1 AND user_id = $2`,
      [eventId, me.id, teamId, JSON.stringify(await emergencyFor(t, me.id))],
    );
    await activity(t, eventId, { type: 'member_joined', message: (tr) => tr`${me.nickname} accepted the invitation`, scope: 'gm', userId: me.id });
    return 'approved';
  });
  hub.invalidate(eventId, ['members']);
  void hub.refreshUser(eventId, me.id);
  res.json({ status });
});

eventsRouter.patch('/:eventId/me', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const perm = z.enum(['unknown', 'granted', 'denied', 'prompt']);
  const b = body(
    req,
    z.object({ ready: z.boolean(), rulesAccepted: z.boolean(), locationPermission: perm, notificationPermission: perm, playerRole, trackingConsent: z.boolean() }).partial(),
  );
  await tx(async (t) => {
    const ctx = await eventContext(eventId, me.id, t);
    if (!ctx.member || !['approved', 'pending'].includes(ctx.member.status)) throw forbidden(tr`Join the event first.`, 'not_member');
    const sets: string[] = [];
    const params: unknown[] = [eventId, me.id];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      sets.push(sql.replace('?', `$${params.length}`));
    };
    if (b.ready !== undefined) add('ready = ?', b.ready);
    if (b.rulesAccepted !== undefined) add('rules_accepted_at = CASE WHEN ? THEN now() ELSE NULL END', b.rulesAccepted);
    if (b.locationPermission) add('location_permission = ?', b.locationPermission);
    if (b.notificationPermission) add('notification_permission = ?', b.notificationPermission);
    if (b.playerRole) add('player_role = ?', b.playerRole);
    if (b.trackingConsent !== undefined) {
      add('tracking_consent_at = CASE WHEN ? THEN COALESCE(tracking_consent_at, now()) ELSE NULL END', b.trackingConsent);
      if (!b.trackingConsent) sets.push('tracking_active = false');
      await t.query('INSERT INTO consent_log (user_id, kind, granted, event_id, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6)', [
        me.id,
        'tracking',
        b.trackingConsent,
        eventId,
        req.ip ?? null,
        req.get('user-agent') ?? null,
      ]);
    }
    if (b.ready === true && !ctx.member.rules_accepted_at && b.rulesAccepted !== true) {
      const row = await one('SELECT rules_accepted_at FROM event_members WHERE event_id = $1 AND user_id = $2', [eventId, me.id], t);
      if (!row?.rules_accepted_at) throw conflict(tr`Accept the rules before marking yourself ready.`, 'rules_not_accepted');
    }
    if (sets.length) await t.query(`UPDATE event_members SET ${sets.join(', ')}, updated_at = now() WHERE event_id = $1 AND user_id = $2`, params);
  });
  hub.invalidate(eventId, ['members']);
  if (b.trackingConsent === false) hub.positionsDirty(eventId);
  res.json(await memberDto(null, eventId, me.id, false));
});

eventsRouter.get('/:eventId/members', async (req, res) => {
  const me = currentUser(req);
  const ctx = await requireViewable(idParam(req, 'eventId'), me.id);
  if (!ctx.isGm && ctx.member?.status !== 'approved') throw forbidden(tr`Join the event to see the players.`, 'not_member');
  res.json(await membersFor(ctx));
});

eventsRouter.post('/:eventId/members/invite', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, z.object({ nickname: z.string().trim().max(40) }));
  await consume('invite', me.id, 60, 3600);
  const userId = await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    if (FINISHED.includes(ctx.event.status)) throw conflict(tr`This event is over.`, 'event_finished');
    const u = await one<{ id: string }>('SELECT id FROM users WHERE lower(nickname) = lower($1) AND deleted_at IS NULL', [b.nickname], t);
    if (!u) throw notFound(tr`No player with this nickname.`, 'unknown_nickname');
    const existing = await one('SELECT status, role FROM event_members WHERE event_id = $1 AND user_id = $2', [eventId, u.id], t);
    if (existing && (existing.role === 'gm' || ['approved', 'invited'].includes(existing.status))) throw conflict(tr`This player is already in the event or invited.`, 'already_member');
    await t.query(
      `INSERT INTO event_members (event_id, user_id, role, status, invited_by) VALUES ($1,$2,'player','invited',$3)
       ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'invited', invited_by = $3, updated_at = now()`,
      [eventId, u.id, me.id],
    );
    await notify(t, [u.id], {
      type: 'event_invitation',
      title: (tr) => tr`Invitation: ${ctx.event.name}`,
      body: (tr) => tr`${me.nickname} invited you. ${eventDate(ctx.event.start_at, tr.lang)}`,
      priority: 'high',
      eventId,
      url: `/events/${eventId}`,
    });
    await audit(t, eventId, me.id, 'member.invite', { type: 'user', id: u.id });
    return u.id;
  });
  hub.invalidate(eventId, ['members'], ['gm']);
  res.status(201).json(await memberDto(null, eventId, userId, true));
});

eventsRouter.post('/:eventId/members/:userId/review', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const userId = idParam(req, 'userId');
  const b = body(req, z.object({ approve: z.boolean() }));
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    const m = await one('SELECT status FROM event_members WHERE event_id = $1 AND user_id = $2 FOR UPDATE', [eventId, userId], t);
    if (!m || m.status !== 'pending') throw conflict(tr`This request was already handled.`, 'invalid_state');
    const teamId = b.approve && ctx.event.team_selection === 'auto' ? await autoTeam(t, eventId) : null;
    await t.query('UPDATE event_members SET status = $3, team_id = COALESCE(team_id, $4), updated_at = now() WHERE event_id = $1 AND user_id = $2', [
      eventId,
      userId,
      b.approve ? 'approved' : 'rejected',
      teamId,
    ]);
    await notify(t, [userId], {
      type: b.approve ? 'registration_approved' : 'registration_rejected',
      title: (tr) => (b.approve ? tr`You're in: ${ctx.event.name}` : tr`Registration declined: ${ctx.event.name}`),
      body: (tr) => (b.approve ? tr`Open the event to check the rules and your team.` : tr`The Game Master did not accept your registration.`),
      eventId,
      url: `/events/${eventId}`,
    });
    await audit(t, eventId, me.id, b.approve ? 'member.approve' : 'member.reject', { type: 'user', id: userId });
  });
  hub.invalidate(eventId, ['members']);
  void hub.refreshUser(eventId, userId);
  res.json(await memberDto(null, eventId, userId, true));
});

eventsRouter.post('/:eventId/members/:userId/remove', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const userId = idParam(req, 'userId');
  // A removed player can join again; a banned one cannot until a Game Master invites them.
  const b = body(req, z.object({ reason: z.string().trim().min(3, 'Give a short reason').max(500), ban: z.boolean().default(false) }));
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    if (userId === ctx.event.owner_id) throw conflict(tr`The owner cannot be removed.`, 'is_owner');
    const m = await one('SELECT * FROM event_members WHERE event_id = $1 AND user_id = $2 FOR UPDATE', [eventId, userId], t);
    if (!m) throw notFound(tr`Member not found.`);
    await t.query(
      `UPDATE event_members SET status = $4, removal_reason = $3, tracking_active = false, ready = false, is_squad_leader = false, emergency_contact = NULL, updated_at = now()
        WHERE event_id = $1 AND user_id = $2`,
      [eventId, userId, b.reason, b.ban ? 'banned' : 'removed'],
    );
    await t.query('UPDATE squads SET leader_id = NULL WHERE event_id = $1 AND leader_id = $2', [eventId, userId]);
    await notify(t, [userId], {
      type: 'removed_from_event',
      title: (tr) => (b.ban ? tr`Banned from ${ctx.event.name}` : tr`Removed from ${ctx.event.name}`),
      body: b.reason,
      priority: 'high',
      eventId,
      url: `/events/${eventId}`,
    });
    await audit(t, eventId, me.id, b.ban ? 'member.ban' : 'member.remove', { type: 'user', id: userId, before: { status: m.status, teamId: m.team_id }, reason: b.reason });
  });
  hub.invalidate(eventId, ['members']);
  hub.kick(eventId, userId, b.reason);
  res.json({ ok: true });
});

async function assign(t: Tx, ctx: EventContext, userId: string, teamId: string | null, squadId: string | null | undefined, leader: boolean | undefined, actorId: string) {
  const eventId = ctx.event.id;
  const m = await one('SELECT * FROM event_members WHERE event_id = $1 AND user_id = $2 FOR UPDATE', [eventId, userId], t);
  // Game Masters can be put on a team too, to play the game.
  const assignable = m?.role === 'gm' ? m.status === 'approved' : ['approved', 'pending', 'invited'].includes(m?.status);
  if (!m || !assignable) throw notFound(tr`Player not found in this event.`);
  if (teamId) {
    const team = await one('SELECT id, capacity, name, (SELECT count(*)::int FROM event_members x WHERE x.team_id = teams.id AND x.status = \'approved\' AND x.user_id <> $3) AS n FROM teams WHERE id = $1 AND event_id = $2', [teamId, eventId, userId], t);
    if (!team) throw badRequest(tr`Unknown team.`, 'invalid_argument', { teamId: tr`Unknown team` });
    if (team.capacity > 0 && team.n >= team.capacity) throw conflict(tr`${team.name} is full.`, 'team_full');
  }
  let squad = squadId === undefined ? (teamId === m.team_id ? m.squad_id : null) : squadId;
  if (squad) {
    const s = await one('SELECT team_id FROM squads WHERE id = $1 AND event_id = $2', [squad, eventId], t);
    if (!s || s.team_id !== teamId) throw badRequest(tr`That squad belongs to another team.`, 'invalid_argument', { squadId: tr`Squad not in this team` });
  }
  if (!teamId) squad = null;
  const isLeader = leader ?? (squad === m.squad_id ? m.is_squad_leader : false);
  if (isLeader && !squad) throw badRequest(tr`Pick a squad before making the player its leader.`, 'invalid_argument', { isSquadLeader: tr`Needs a squad` });
  if (isLeader && squad) {
    await t.query('UPDATE event_members SET is_squad_leader = false WHERE event_id = $1 AND squad_id = $2 AND user_id <> $3', [eventId, squad, userId]);
    await t.query('UPDATE squads SET leader_id = $2 WHERE id = $1', [squad, userId]);
  } else if (m.is_squad_leader && m.squad_id) {
    await t.query('UPDATE squads SET leader_id = NULL WHERE id = $1 AND leader_id = $2', [m.squad_id, userId]);
  }
  // A Game Master taken off their team stops playing, so their location is no longer shared.
  await t.query(
    `UPDATE event_members SET team_id = $3, squad_id = $4, is_squad_leader = $5,
            tracking_active = CASE WHEN role = 'gm' AND $3::uuid IS NULL THEN false ELSE tracking_active END, updated_at = now()
      WHERE event_id = $1 AND user_id = $2`,
    [
      eventId,
      userId,
      teamId,
      squad,
      isLeader,
    ],
  );
  if (teamId !== m.team_id && teamId && userId !== actorId) {
    const team = await one('SELECT name FROM teams WHERE id = $1', [teamId], t);
    await notify(t, [userId], {
      type: 'team_assigned',
      title: (tr) => tr`You are on ${team?.name}`,
      body: (tr) => (ctx.event.status === 'live' ? tr`Your map now shows your new team.` : tr`Check your team in the lobby.`),
      priority: ctx.event.status === 'live' ? 'high' : 'normal',
      eventId,
      url: `/events/${eventId}`,
    });
  }
  await audit(t, eventId, actorId, 'member.assign', { type: 'user', id: userId, before: { teamId: m.team_id, squadId: m.squad_id }, after: { teamId, squadId: squad, isLeader } });
}

eventsRouter.post('/:eventId/members/:userId/assign', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const userId = idParam(req, 'userId');
  const b = body(req, z.object({ teamId: uuid.nullable(), squadId: uuid.nullable().optional(), isSquadLeader: z.boolean().optional() }));
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    if (FINISHED.includes(ctx.event.status)) throw conflict(tr`This event is over.`, 'event_finished');
    await assign(t, ctx, userId, b.teamId, b.squadId, b.isSquadLeader, me.id);
  });
  hub.invalidate(eventId, ['members', 'event']);
  hub.teams(eventId);
  void hub.refreshUser(eventId, userId);
  res.json(await memberDto(null, eventId, userId, true));
});

eventsRouter.post('/:eventId/choose-team', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, z.object({ teamId: uuid }));
  await tx(async (t) => {
    const ctx = await eventContext(eventId, me.id, t, true);
    if (ctx.member?.status !== 'approved' || ctx.member.role !== 'player') throw forbidden(tr`Join the event first.`, 'not_member');
    if (ctx.event.team_selection !== 'player') throw conflict(tr`The Game Master assigns the teams in this event.`, 'teams_assigned_by_gm');
    if (ctx.event.teams_locked || ['live', 'paused', 'completed', 'cancelled'].includes(ctx.event.status)) throw conflict(tr`Teams are locked.`, 'teams_locked');
    await assign(t, ctx, me.id, b.teamId, null, false, me.id);
  });
  hub.invalidate(eventId, ['members', 'event']);
  hub.teams(eventId);
  void hub.refreshUser(eventId, me.id);
  res.json(await memberDto(null, eventId, me.id, false));
});

eventsRouter.post('/:eventId/auto-balance', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const assigned = await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    if (FINISHED.includes(ctx.event.status)) throw conflict(tr`This event is over.`, 'event_finished');
    const players = await many<{ user_id: string }>(
      `SELECT user_id FROM event_members WHERE event_id = $1 AND role = 'player' AND status = 'approved' AND team_id IS NULL ORDER BY random()`,
      [eventId],
      t,
    );
    let n = 0;
    for (const p of players) {
      const teamId = await autoTeam(t, eventId);
      if (!teamId) break;
      await t.query('UPDATE event_members SET team_id = $3, updated_at = now() WHERE event_id = $1 AND user_id = $2', [eventId, p.user_id, teamId]);
      n++;
    }
    await audit(t, eventId, me.id, 'members.auto_balance', { after: { assigned: n } });
    return n;
  });
  hub.invalidate(eventId, ['members', 'event']);
  hub.teams(eventId);
  void hub.refreshEvent(eventId);
  res.json({ assigned });
});

eventsRouter.post('/:eventId/game-masters', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, z.object({ nickname: z.string().trim().max(40) }));
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    const u = await one<{ id: string }>('SELECT id FROM users WHERE lower(nickname) = lower($1) AND deleted_at IS NULL AND email_verified_at IS NOT NULL', [b.nickname], t);
    if (!u) throw notFound(tr`No verified player with this nickname.`, 'unknown_nickname');
    const m = await one('SELECT role, status FROM event_members WHERE event_id = $1 AND user_id = $2', [eventId, u.id], t);
    if (m?.role === 'player' && m.status === 'approved') throw conflict(tr`This person plays in the event. Remove them as a player first.`, 'is_player');
    await t.query(
      `INSERT INTO event_members (event_id, user_id, role, status) VALUES ($1,$2,'gm','approved')
       ON CONFLICT (event_id, user_id) DO UPDATE SET role = 'gm', status = 'approved', team_id = NULL, squad_id = NULL, is_squad_leader = false`,
      [eventId, u.id],
    );
    await notify(t, [u.id], { type: 'gm_message', title: (tr) => tr`You are a Game Master of ${ctx.event.name}`, eventId, url: `/gm/events/${eventId}` });
    await audit(t, eventId, me.id, 'gm.add', { type: 'user', id: u.id });
  });
  hub.invalidate(eventId, ['event', 'members']);
  res.json({ ok: true });
});

eventsRouter.delete('/:eventId/game-masters/:userId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const userId = idParam(req, 'userId');
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    if (userId === ctx.event.owner_id) throw conflict(tr`The owner is always a Game Master.`, 'is_owner');
    await t.query(
      `UPDATE event_members SET status = 'left', tracking_active = false, is_squad_leader = false, updated_at = now() WHERE event_id = $1 AND user_id = $2 AND role = 'gm'`,
      [eventId, userId],
    );
    await t.query('UPDATE squads SET leader_id = NULL WHERE event_id = $1 AND leader_id = $2', [eventId, userId]);
    await audit(t, eventId, me.id, 'gm.remove', { type: 'user', id: userId });
  });
  hub.invalidate(eventId, ['event', 'members']);
  void hub.refreshUser(eventId, userId);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ teams & squads

/** A built-in icon name, or an image uploaded for it (POST /uploads with purpose team_icon). */
const teamIcon = shortText(80).refine((v) => /^[a-z0-9-]{0,40}$/.test(v) || /^\/api\/files\/team_icon-[A-Za-z0-9_-]{24}\.(jpg|png|webp)$/.test(v), 'Choose an icon or upload an image');

const teamInput = z.object({
  name: shortText(60).min(1, 'Name the team'),
  color: hexColor,
  icon: teamIcon,
  pattern: z.enum(['solid', 'stripes', 'dots', 'chevron', 'cross', 'grid']),
  capacity: z.number().int().min(0).max(2000),
  sortOrder: z.number().int().min(0).max(1000),
  allianceId: shortText(40).nullable(),
  baseLat: lat.nullable(),
  baseLng: lng.nullable(),
});
const TEAM_COLS: Record<string, string> = {
  name: 'name',
  color: 'color',
  icon: 'icon',
  pattern: 'pattern',
  capacity: 'capacity',
  sortOrder: 'sort_order',
  allianceId: 'alliance_id',
  baseLat: 'base_lat',
  baseLng: 'base_lng',
};

async function teamDto(teamId: string) {
  const t = await one(`SELECT ${dto.TEAM_SELECT} FROM teams t WHERE t.id = $1`, [teamId]);
  return dto.team(t!, { showCurrency: true });
}

eventsRouter.post('/:eventId/teams', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, teamInput.partial().required({ name: true }));
  const id = await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    if (FINISHED.includes(ctx.event.status)) throw conflict(tr`This event is over.`, 'event_finished');
    const n = await one<{ n: number }>('SELECT count(*)::int AS n FROM teams WHERE event_id = $1', [eventId], t);
    if ((n?.n ?? 0) >= 16) throw conflict(tr`An event can have at most 16 teams.`, 'too_many_teams');
    const row = await one<{ id: string }>(
      `INSERT INTO teams (event_id, name, color, icon, pattern, capacity, sort_order, alliance_id, base_lat, base_lng)
       VALUES ($1,$2,COALESCE($3,'#7C8A4A'),COALESCE($4,'shield'),COALESCE($5,'solid'),COALESCE($6,0),COALESCE($7::int,$11::int),$8,$9,$10) RETURNING id`,
      [eventId, b.name, b.color ?? null, b.icon ?? null, b.pattern ?? null, b.capacity ?? null, b.sortOrder ?? null, b.allianceId ?? null, b.baseLat ?? null, b.baseLng ?? null, n?.n ?? 0],
      t,
    );
    if (ctx.event.status === 'live' || ctx.event.status === 'paused') {
      // A team added mid-game gets the starting balances too.
      const s = ctx.scoring;
      if (s.startingPoints) await t.query('UPDATE teams SET points = $2 WHERE id = $1', [row!.id, s.startingPoints]);
      if (s.startingCurrency) await t.query('UPDATE teams SET currency = $2 WHERE id = $1', [row!.id, s.startingCurrency]);
    }
    await audit(t, eventId, me.id, 'team.create', { type: 'team', id: row!.id, after: b });
    return row!.id;
  });
  hub.invalidate(eventId, ['event']);
  hub.teams(eventId);
  res.status(201).json(await teamDto(id));
});

eventsRouter.patch('/:eventId/teams/:teamId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const teamId = idParam(req, 'teamId');
  const b = body(req, teamInput.partial());
  await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const sets: string[] = [];
    const params: unknown[] = [teamId, eventId];
    for (const [k, col] of Object.entries(TEAM_COLS)) {
      const v = (b as Record<string, unknown>)[k];
      if (v !== undefined) {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (!sets.length) return;
    const r = await t.query(`UPDATE teams SET ${sets.join(', ')} WHERE id = $1 AND event_id = $2`, params);
    if (!r.rowCount) throw notFound(tr`Team not found.`);
    await audit(t, eventId, me.id, 'team.update', { type: 'team', id: teamId, after: b });
  });
  hub.invalidate(eventId, ['event']);
  hub.teams(eventId);
  if (b.allianceId !== undefined) {
    hub.positionsDirty(eventId);
    void hub.refreshEvent(eventId);
  }
  res.json(await teamDto(teamId));
});

eventsRouter.delete('/:eventId/teams/:teamId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const teamId = idParam(req, 'teamId');
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    if (ctx.event.started_at) throw conflict(tr`Teams cannot be deleted once the game has started.`, 'game_started');
    await t.query("SELECT set_config('airsofthub.allow_purge', 'on', true)");
    const r = await t.query('DELETE FROM teams WHERE id = $1 AND event_id = $2', [teamId, eventId]);
    if (!r.rowCount) throw notFound(tr`Team not found.`);
    await audit(t, eventId, me.id, 'team.delete', { type: 'team', id: teamId });
  });
  hub.invalidate(eventId, ['event', 'members']);
  void hub.refreshEvent(eventId);
  res.json({ ok: true });
});

const squadInput = z.object({ teamId: uuid, name: shortText(60).min(1), callsign: shortText(30).nullable(), icon: teamIcon.nullable(), leaderId: uuid.nullable() });

eventsRouter.post('/:eventId/squads', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, squadInput.partial().required({ teamId: true, name: true }));
  const row = await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const team = await one('SELECT id FROM teams WHERE id = $1 AND event_id = $2', [b.teamId, eventId], t);
    if (!team) throw badRequest(tr`Unknown team.`, 'invalid_argument', { teamId: tr`Unknown team` });
    return one('INSERT INTO squads (event_id, team_id, name, callsign, icon) VALUES ($1,$2,$3,$4,$5) RETURNING *', [eventId, b.teamId, b.name, b.callsign ?? null, b.icon ?? null], t);
  });
  hub.invalidate(eventId, ['event', 'squads']);
  res.status(201).json(dto.squad(row!));
});

eventsRouter.patch('/:eventId/squads/:squadId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const squadId = idParam(req, 'squadId');
  const b = body(req, squadInput.partial());
  const row = await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    const s = await one('SELECT * FROM squads WHERE id = $1 AND event_id = $2 FOR UPDATE', [squadId, eventId], t);
    if (!s) throw notFound(tr`Squad not found.`);
    if (b.teamId && b.teamId !== s.team_id) throw badRequest(tr`A squad cannot move to another team.`, 'invalid_argument', { teamId: tr`Cannot change` });
    // undefined = keep, null or '' = clear (name is required)
    await t.query(
      `UPDATE squads SET name = COALESCE($2, name),
              callsign = CASE WHEN $5 THEN NULLIF($3, '') ELSE callsign END,
              icon = CASE WHEN $6 THEN NULLIF($4, '') ELSE icon END WHERE id = $1`,
      [squadId, b.name ?? null, b.callsign ?? null, b.icon ?? null, b.callsign !== undefined, b.icon !== undefined],
    );
    if (b.leaderId !== undefined) {
      if (b.leaderId) {
        const m = await one('SELECT team_id FROM event_members WHERE event_id = $1 AND user_id = $2 AND status = $3', [eventId, b.leaderId, 'approved'], t);
        if (!m || m.team_id !== s.team_id) throw badRequest(tr`The leader must be on this team.`, 'invalid_argument', { leaderId: tr`Not on this team` });
        await assign(t, ctx, b.leaderId, s.team_id, squadId, true, me.id);
      } else {
        await t.query('UPDATE event_members SET is_squad_leader = false WHERE event_id = $1 AND squad_id = $2', [eventId, squadId]);
        await t.query('UPDATE squads SET leader_id = NULL WHERE id = $1', [squadId]);
      }
    }
    return one('SELECT * FROM squads WHERE id = $1', [squadId], t);
  });
  hub.invalidate(eventId, ['event', 'squads', 'members']);
  if (b.leaderId) void hub.refreshUser(eventId, b.leaderId);
  hub.positionsDirty(eventId);
  res.json(dto.squad(row!));
});

eventsRouter.delete('/:eventId/squads/:squadId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const squadId = idParam(req, 'squadId');
  await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    await t.query('UPDATE event_members SET is_squad_leader = false WHERE event_id = $1 AND squad_id = $2', [eventId, squadId]);
    const r = await t.query('DELETE FROM squads WHERE id = $1 AND event_id = $2', [squadId, eventId]);
    if (!r.rowCount) throw notFound(tr`Squad not found.`);
  });
  hub.invalidate(eventId, ['event', 'squads', 'members']);
  hub.positionsDirty(eventId);
  res.json({ ok: true });
});

export function eventIdOf(req: Request): string {
  return idParam(req, 'eventId');
}
