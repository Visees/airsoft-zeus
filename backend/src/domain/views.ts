import { many, one, pool, type Queryable } from '../db.js';
import { hub } from '../realtime/hub.js';
import type { EventContext } from './context.js';
import * as dto from './serialize.js';

/** EventDetail for the viewer of `ctx`. */
export async function eventDetail(ctx: EventContext, q: Queryable = pool) {
  const e = ctx.event;
  const userId = ctx.viewer.userId;
  const summary = await one(`SELECT ${dto.EVENT_SUMMARY_SELECT} FROM events e WHERE e.id = $2`, [userId, e.id], q);
  const teams = await many(`SELECT ${dto.TEAM_SELECT} FROM teams t WHERE t.event_id = $1 ORDER BY t.sort_order, t.created_at`, [e.id], q);
  const squads = await many('SELECT * FROM squads WHERE event_id = $1 ORDER BY created_at', [e.id], q);
  const gms = await many(
    `SELECT u.id, u.nickname, u.avatar_url FROM event_members m JOIN users u ON u.id = m.user_id
      WHERE m.event_id = $1 AND m.role = 'gm' AND m.status = 'approved' ORDER BY m.joined_at`,
    [e.id],
    q,
  );
  // Attachments are for the people taking part; others only see how many there are.
  const canSeeAttachments = ctx.isGm || ctx.member?.status === 'approved';
  const attachments = await many('SELECT * FROM event_attachments WHERE event_id = $1 ORDER BY created_at', [e.id], q);
  const meRow = ctx.member ? await one('SELECT m.*, u.nickname, u.avatar_url FROM event_members m JOIN users u ON u.id = m.user_id WHERE m.event_id = $1 AND m.user_id = $2', [e.id, userId], q) : null;
  const myTeam = ctx.viewer.teamId;
  return {
    ...dto.eventSummary(summary!),
    // A GM playing in the player view gets the player's event (ctx.isGm is false then).
    isGm: ctx.isGm,
    description: e.description,
    customModeRules: e.custom_mode_rules,
    requiresApproval: e.requires_approval,
    rules: e.rules,
    safetyRules: e.safety_rules,
    requiredEquipment: e.required_equipment,
    chronoInfo: e.chrono_info,
    teamSelection: e.team_selection,
    teamsLocked: e.teams_locked,
    registrationLocked: e.registration_locked,
    area: e.area_lat !== null && e.area_lng !== null ? { lat: e.area_lat, lng: e.area_lng, zoom: e.area_zoom ?? 16 } : null,
    mapOverlay: e.map_overlay ?? null,
    mapLayers: e.map_layers ?? [],
    tracking: ctx.tracking,
    visibilityRules: ctx.rules,
    scoring: ctx.scoring,
    storeEnabled: e.store_enabled,
    phase: e.phase,
    autoEnd: e.auto_end,
    clock: dto.clock(e),
    winnerTeamId: e.winner_team_id,
    resultsToken: e.results_published_at ? e.results_token : ctx.isGm ? e.results_token : null,
    resultsPublished: !!e.results_published_at,
    gameMasters: gms.map((g) => ({ id: g.id, nickname: g.nickname, avatarUrl: g.avatar_url })),
    teams: teams.map((t) => dto.team(t, { showCurrency: ctx.isGm || ctx.rules.showEnemyCurrency || t.id === myTeam })),
    squads: ctx.isGm || ctx.member?.status === 'approved' ? squads.map(dto.squad) : [],
    me: meRow ? dto.member(meRow, { viewerIsGm: ctx.isGm, showRole: true, online: hub.isOnline(userId) }) : null,
    joinCode: ctx.isGm ? e.join_code : null,
    attachmentCount: attachments.length,
    attachments: canSeeAttachments ? attachments.map(dto.attachment) : [],
  };
}

/** Members list for the viewer: GMs see everyone with private details; players see approved members. */
export async function membersFor(ctx: EventContext, q: Queryable = pool) {
  const rows = await many(
    `SELECT m.*, u.nickname, u.avatar_url, u.deleted_at FROM event_members m JOIN users u ON u.id = m.user_id
      WHERE m.event_id = $1 ${ctx.isGm ? '' : "AND m.status = 'approved'"} ORDER BY m.role, u.nickname`,
    [ctx.event.id],
    q,
  );
  const staleMs = ctx.tracking.staleAfterSec * 1000;
  const now = Date.now();
  return rows.map((m) => {
    const recentGps = m.last_location_at && now - new Date(m.last_location_at).getTime() <= staleMs;
    const self = m.user_id === ctx.viewer.userId;
    const d = dto.member(m, { viewerIsGm: ctx.isGm, showRole: ctx.rules.showRoles || self, online: hub.isOnline(m.user_id) || !!recentGps });
    if (!ctx.isGm && !self) {
      // Players don't need other players' device state.
      return { ...d, locationPermission: 'unknown' as const, notificationPermission: 'unknown' as const, gpsAccuracy: null, lastLocationAt: null };
    }
    return d;
  });
}
