import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireVerified } from '../auth/middleware.js';
import { many, one, pool, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { idempotent } from '../lib/idempotency.js';
import { randomToken } from '../lib/ids.js';
import { decodeCursor, page } from '../lib/pagination.js';
import { consume } from '../lib/rate-limit.js';
import { body, clientTxId, idParam, lat, lng, playerRole, queryOf, shortText, uuid } from '../lib/validate.js';
import { config } from '../config.js';
import { hub, positionsFor } from '../realtime/hub.js';
import { eventContext, FINISHED, requireGm, requireMember, type EventContext } from '../domain/context.js';
import { defaultPerks, perkConfigSchema } from '../domain/defaults.js';
import { activity, alert, audit, eventPlayers, notify } from '../domain/journal.js';
import { applyLedger } from '../domain/ledger.js';
import { reportLocation, stopTracking } from '../domain/locations.js';
import { loadObjectives, objectiveDtos, performCapture, revokeCapture, settleRecurring, statusOf, type ObjRow } from '../domain/objectives.js';
import * as perks from '../domain/perks.js';
import { computeResults, exportCsv, exportPdf } from '../domain/results.js';
import { scopedVisible } from '../domain/rules.js';
import * as dto from '../domain/serialize.js';
import { eventDetail, membersFor } from '../domain/views.js';
import { visiblePois, visibleZones } from './content.js';
import { tr } from '../i18n/index.js';
import { objectiveActionLabel } from '../i18n/labels.js';

export const liveRouter = Router();

// ------------------------------------------------------------------ snapshot

async function perksFor(ctx: EventContext) {
  if (!ctx.isGm && !ctx.event.store_enabled) return [];
  const rows = await many('SELECT * FROM perks WHERE event_id = $1 ORDER BY sort_order, created_at', [ctx.event.id]);
  if (ctx.isGm) return rows.map((p) => dto.perk(p));
  const teamId = ctx.viewer.teamId;
  const stats = teamId ? await perks.teamPerkStats(pool, ctx.event.id, teamId) : new Map();
  const team = teamId ? await one<{ currency: number }>('SELECT currency FROM teams WHERE id = $1', [teamId]) : null;
  const now = Date.now();
  return rows
    .filter((p) => p.enabled)
    .map((p) => dto.perk(p, perks.perkAvailability(ctx, p, stats.get(p.id) ?? { purchases: 0, lastAt: null }, Number(team?.currency ?? 0), now)));
}

async function purchasesFor(ctx: EventContext) {
  const rows = ctx.isGm
    ? await many(`SELECT ${dto.PURCHASE_SELECT} WHERE pp.event_id = $1 ORDER BY pp.created_at DESC LIMIT 300`, [ctx.event.id])
    : ctx.viewer.teamId
      ? await many(`SELECT ${dto.PURCHASE_SELECT} WHERE pp.event_id = $1 AND pp.team_id = $2 ORDER BY pp.created_at DESC LIMIT 100`, [ctx.event.id, ctx.viewer.teamId])
      : [];
  return rows.map(dto.purchase);
}

async function effectsFor(ctx: EventContext) {
  const rows = await many(
    `SELECT e.*, pk.name AS perk_name FROM effects e LEFT JOIN perk_purchases pp ON pp.id = e.purchase_id LEFT JOIN perks pk ON pk.id = pp.perk_id
      WHERE e.event_id = $1 AND (e.status = 'active' OR e.expires_at > now() - interval '30 minutes') ${ctx.isGm ? '' : 'AND e.team_id = $2'}
      ORDER BY e.starts_at DESC`,
    ctx.isGm ? [ctx.event.id] : [ctx.event.id, ctx.viewer.teamId ?? '00000000-0000-0000-0000-000000000000'],
  );
  return rows.map(dto.effect);
}

async function announcementsFor(ctx: EventContext, limit = 30, cursor?: { at: string; id: string } | null) {
  const params: unknown[] = [ctx.event.id];
  let where = 'a.event_id = $1';
  if (!ctx.isGm) {
    params.push(ctx.viewer.teamId ?? '00000000-0000-0000-0000-000000000000', ctx.viewer.userId);
    where += ` AND (a.scope = 'all' OR (a.scope = 'team' AND a.team_id = $2) OR (a.scope = 'player' AND a.target_user_id = $3))`;
  }
  if (cursor) {
    params.push(cursor.at, cursor.id);
    where += ` AND (a.created_at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  return many(
    `SELECT a.*, u.nickname AS author_nickname FROM announcements a LEFT JOIN users u ON u.id = a.author_id WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit + 1}`,
    params,
  );
}

liveRouter.get('/:eventId/live', async (req, res) => {
  const me = currentUser(req);
  const ctx = await requireMember(idParam(req, 'eventId'), me.id);
  const [event, members, objectives, pois, zones, perkList, purchases, effects, announcements, positions, alerts] = await Promise.all([
    eventDetail(ctx),
    membersFor(ctx),
    loadObjectives(ctx.event.id).then((s) => objectiveDtos(ctx, s)),
    visiblePois(ctx),
    visibleZones(ctx),
    perksFor(ctx),
    purchasesFor(ctx),
    effectsFor(ctx),
    announcementsFor(ctx, 20),
    positionsFor(ctx.event.id, me.id, ctx.isGm),
    ctx.isGm
      ? many(`SELECT a.*, u.nickname FROM alerts a LEFT JOIN users u ON u.id = a.user_id WHERE a.event_id = $1 ORDER BY a.created_at DESC LIMIT 100`, [ctx.event.id])
      : Promise.resolve(null),
  ]);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    event,
    members,
    objectives,
    pois,
    zones,
    perks: perkList,
    purchases,
    effects,
    announcements: announcements.slice(0, 20).map(dto.announcement),
    positions,
    ...(alerts ? { alerts: alerts.map(dto.alert) } : {}),
    serverNow: new Date().toISOString(),
  });
});

// ------------------------------------------------------------------ location

const sample = z.object({
  lat,
  lng,
  accuracy: z.number().min(0).max(100_000),
  speed: z.number().min(-1).max(500).nullable().optional(),
  heading: z.number().min(-1).max(360).nullable().optional(),
  altitude: z.number().min(-1000).max(10_000).nullable().optional(),
  timestamp: z.number().int().positive(),
  isMocked: z.boolean().optional(),
});

liveRouter.post('/:eventId/locations', async (req, res) => {
  const me = currentUser(req);
  const b = body(req, z.object({ samples: z.array(sample).min(1).max(20), screenObjectiveId: uuid.nullable().optional(), sentAt: z.number().int().positive().optional() }));
  res.json(await reportLocation(idParam(req, 'eventId'), me.id, b.samples, b.screenObjectiveId ?? null, b.sentAt));
});

liveRouter.post('/:eventId/tracking/stop', async (req, res) => {
  await stopTracking(idParam(req, 'eventId'), currentUser(req).id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ feeds

liveRouter.get('/:eventId/ledger', async (req, res) => {
  const ctx = await requireMember(idParam(req, 'eventId'), currentUser(req).id);
  const q = queryOf(req, z.object({ kind: z.enum(['points', 'currency']).optional(), teamId: uuid.optional(), cursor: z.string().optional() }));
  const teamId = ctx.isGm ? (q.teamId ?? null) : ctx.viewer.teamId;
  if (!ctx.isGm && (!teamId || (q.teamId && q.teamId !== teamId))) throw forbidden(tr`You can only see your own team’s ledger.`);
  const c = decodeCursor(q.cursor);
  const params: unknown[] = [ctx.event.id];
  const where = ['l.event_id = $1'];
  if (teamId) where.push(`l.team_id = $${params.push(teamId)}`);
  if (q.kind) where.push(`l.kind = $${params.push(q.kind)}`);
  if (c) {
    params.push(c.at, c.id);
    where.push(`(l.created_at, l.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const rows = await many(`SELECT ${dto.LEDGER_SELECT} WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC, l.id DESC LIMIT 51`, params);
  res.json(page(rows, 50, dto.ledger));
});

liveRouter.get('/:eventId/activity', async (req, res) => {
  const ctx = await requireMember(idParam(req, 'eventId'), currentUser(req).id);
  const q = queryOf(req, z.object({ cursor: z.string().optional() }));
  const c = decodeCursor(q.cursor);
  const params: unknown[] = [ctx.event.id];
  let where = 'a.event_id = $1';
  if (!ctx.isGm) {
    params.push(ctx.viewer.teamId ?? '00000000-0000-0000-0000-000000000000');
    where += ` AND (a.scope = 'all' OR (a.scope = 'team' AND a.team_id = $2))`;
  }
  if (c) {
    params.push(c.at, Number(c.id));
    where += ` AND (a.created_at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`;
  }
  const rows = await many(`SELECT a.* FROM activity a WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT 51`, params);
  res.json(page(rows, 50, dto.activity));
});

liveRouter.get('/:eventId/announcements', async (req, res) => {
  const ctx = await requireMember(idParam(req, 'eventId'), currentUser(req).id);
  const q = queryOf(req, z.object({ cursor: z.string().optional() }));
  const rows = await announcementsFor(ctx, 30, decodeCursor(q.cursor));
  res.json(page(rows, 30, dto.announcement));
});

liveRouter.post('/:eventId/announcements', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(
    req,
    z.object({
      scope: z.enum(['all', 'team', 'player']),
      teamId: uuid.nullable().optional(),
      targetUserId: uuid.nullable().optional(),
      title: shortText(120).min(2, 'Write a title'),
      body: z.string().max(2000).default(''),
      priority: z.enum(['normal', 'high', 'emergency']),
    }),
  );
  if (b.scope === 'team' && !b.teamId) throw badRequest(tr`Choose a team.`, 'invalid_argument', { teamId: tr`Required` });
  if (b.scope === 'player' && !b.targetUserId) throw badRequest(tr`Choose a player.`, 'invalid_argument', { targetUserId: tr`Required` });
  await consume('announce', me.id, 30, 60);
  const row = await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t);
    if (b.teamId && !(await one('SELECT 1 FROM teams WHERE id = $1 AND event_id = $2', [b.teamId, eventId], t))) throw badRequest(tr`Unknown team.`);
    const a = await one(
      `INSERT INTO announcements (event_id, scope, team_id, target_user_id, title, body, priority, author_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *, (SELECT nickname FROM users WHERE id = $8) AS author_nickname`,
      [eventId, b.scope, b.scope === 'team' ? b.teamId : null, b.scope === 'player' ? b.targetUserId : null, b.title, b.body, b.priority, me.id],
      t,
    );
    const recipients =
      b.scope === 'all' ? await eventPlayers(t, eventId) : b.scope === 'team' ? await eventPlayers(t, eventId, b.teamId) : [b.targetUserId!];
    await notify(t, recipients, {
      type: b.priority === 'emergency' ? 'emergency' : b.scope === 'team' ? 'team_announcement' : b.scope === 'player' ? 'gm_message' : 'announcement',
      title: (tr) => (b.priority === 'emergency' ? tr`EMERGENCY: ${b.title}` : b.title),
      body: b.body,
      priority: b.priority,
      eventId,
      url: ['live', 'paused'].includes(ctx.event.status) ? `/events/${eventId}/live` : `/events/${eventId}/lobby`,
      push: true,
    });
    if (b.priority === 'emergency') {
      await alert(t, eventId, { type: 'emergency', severity: 'critical', message: (tr) => tr`Emergency alert sent: ${b.title}`, data: { announcementId: a!.id } });
    }
    await audit(t, eventId, me.id, 'announcement.send', { type: 'announcement', id: a!.id, after: { scope: b.scope, priority: b.priority, title: b.title } });
    const item = dto.announcement(a!);
    t.afterCommit(() => {
      const targets = b.scope === 'all' ? (['all'] as const) : b.scope === 'team' ? (['gm', { teamId: b.teamId! }] as const) : (['gm', { userId: b.targetUserId! }] as const);
      hub.emit(eventId, 'announcement', { eventId, announcement: item }, [...targets]);
    });
    return item;
  });
  res.status(201).json(row);
});

liveRouter.get('/:eventId/alerts', async (req, res) => {
  const ctx = await requireGm(idParam(req, 'eventId'), currentUser(req).id);
  const q = queryOf(req, z.object({ cursor: z.string().optional() }));
  const c = decodeCursor(q.cursor);
  const rows = await many(
    `SELECT a.*, u.nickname FROM alerts a LEFT JOIN users u ON u.id = a.user_id WHERE a.event_id = $1 ${c ? 'AND (a.created_at, a.id) < ($2::timestamptz, $3::uuid)' : ''}
      ORDER BY a.created_at DESC, a.id DESC LIMIT 51`,
    c ? [ctx.event.id, c.at, c.id] : [ctx.event.id],
  );
  res.json(page(rows, 50, dto.alert));
});

liveRouter.post('/:eventId/alerts/:alertId/ack', async (req, res) => {
  const me = currentUser(req);
  const ctx = await requireGm(idParam(req, 'eventId'), me.id);
  await one('UPDATE alerts SET acknowledged_at = now(), acknowledged_by = $3 WHERE id = $1 AND event_id = $2 AND acknowledged_at IS NULL RETURNING id', [
    idParam(req, 'alertId'),
    ctx.event.id,
    me.id,
  ]);
  hub.invalidate(ctx.event.id, ['alerts'], ['gm']);
  res.json({ ok: true });
});

liveRouter.get('/:eventId/audit', async (req, res) => {
  const ctx = await requireGm(idParam(req, 'eventId'), currentUser(req).id);
  const q = queryOf(req, z.object({ cursor: z.string().optional() }));
  const c = decodeCursor(q.cursor);
  const rows = await many(
    `SELECT a.*, u.nickname AS actor_nickname FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.event_id = $1 ${c ? 'AND (a.created_at, a.id) < ($2::timestamptz, $3::bigint)' : ''} ORDER BY a.created_at DESC, a.id DESC LIMIT 51`,
    c ? [ctx.event.id, c.at, Number(c.id)] : [ctx.event.id],
  );
  res.json(page(rows, 50, dto.audit));
});

// ------------------------------------------------------------------ GM overrides

liveRouter.post('/:eventId/gm/adjust', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(
    req,
    z.object({
      teamId: uuid,
      kind: z.enum(['points', 'currency']),
      amount: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, 'Enter an amount other than 0'),
      reason: z.string().trim().min(3, 'Give a short reason').max(500),
      penalty: z.boolean().optional(),
      userId: uuid.nullable().optional(),
      clientTxId,
    }),
  );
  const { result } = await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t);
    if (ctx.event.status === 'cancelled') throw conflict(tr`This event was cancelled.`, 'event_finished');
    return idempotent(t, me.id, b.clientTxId, 'adjust', async () => {
      const r = await applyLedger(t, {
        eventId,
        teamId: b.teamId,
        kind: b.kind,
        type: b.penalty ? 'penalty' : 'gm_adjustment',
        amount: b.amount,
        scoring: ctx.scoring,
        userId: b.userId ?? null,
        reason: b.reason,
        actorId: me.id,
        clientTxId: b.clientTxId,
      });
      const team = await one<{ name: string }>('SELECT name FROM teams WHERE id = $1', [b.teamId], t);
      await activity(t, eventId, {
        type: b.penalty ? 'penalty' : 'gm_adjustment',
        message: (tr) =>
          r.applied >= 0
            ? b.kind === 'points'
              ? tr`GM gave ${r.applied} points to ${team?.name}: ${b.reason}`
              : tr`GM gave ${r.applied} credits to ${team?.name}: ${b.reason}`
            : b.kind === 'points'
              ? tr`GM took ${-r.applied} points from ${team?.name}: ${b.reason}`
              : tr`GM took ${-r.applied} credits from ${team?.name}: ${b.reason}`,
        scope: b.kind === 'points' ? 'all' : 'team',
        teamId: b.teamId,
      });
      await audit(t, eventId, me.id, 'balance.adjust', { type: 'team', id: b.teamId, after: { kind: b.kind, requested: b.amount, applied: r.applied }, reason: b.reason });
      return r;
    });
  });
  res.json({ balance: result.balance, applied: result.applied });
});

liveRouter.post('/:eventId/gm/objectives/:objectiveId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const objectiveId = idParam(req, 'objectiveId');
  const b = body(
    req,
    z.object({
      action: z.enum(['activate', 'disable', 'set_owner', 'clear_owner', 'contest', 'uncontest', 'reset']),
      reason: z.string().trim().min(3, 'Give a short reason').max(500),
      teamId: uuid.nullable().optional(),
    }),
  );
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t);
    const o = await one<ObjRow>('SELECT * FROM objectives WHERE id = $1 AND event_id = $2 FOR UPDATE', [objectiveId, eventId], t);
    if (!o) throw notFound(tr`Objective not found.`);
    const now = Date.now();
    switch (b.action) {
      case 'activate':
        await t.query('UPDATE objectives SET disabled_by_gm = false, enabled = true WHERE id = $1', [o.id]);
        break;
      case 'disable':
        await t.query('UPDATE objectives SET disabled_by_gm = true WHERE id = $1', [o.id]);
        break;
      case 'contest':
        await t.query('UPDATE objectives SET contested_by_gm = true WHERE id = $1', [o.id]);
        break;
      case 'uncontest':
        await t.query('UPDATE objectives SET contested_by_gm = false, contested = false WHERE id = $1', [o.id]);
        await t.query(`UPDATE capture_states SET contested = false, present = '{}' WHERE objective_id = $1`, [o.id]);
        break;
      case 'clear_owner':
        if (ctx.event.status === 'live') await settleRecurring(t, ctx, o, now);
        await t.query('UPDATE objectives SET owner_team_id = NULL, recurring_last_at = NULL WHERE id = $1', [o.id]);
        break;
      case 'set_owner': {
        if (!b.teamId) throw badRequest(tr`Choose the team.`, 'invalid_argument', { teamId: tr`Required` });
        const team = await one('SELECT id FROM teams WHERE id = $1 AND event_id = $2', [b.teamId, eventId], t);
        if (!team) throw badRequest(tr`Unknown team.`);
        if (ctx.event.status === 'live') {
          // A GM capture: rewards and notifications like a normal capture.
          await t.query('UPDATE objectives SET disabled_by_gm = false, contested_by_gm = false WHERE id = $1', [o.id]);
          if (o.owner_team_id !== b.teamId) await performCapture(t, { ctx, objectiveId: o.id, teamId: b.teamId, userId: null, method: 'gm', now, actorId: me.id });
        } else {
          await t.query('UPDATE objectives SET owner_team_id = $2 WHERE id = $1', [o.id, b.teamId]);
        }
        break;
      }
      case 'reset':
        await t.query(
          `UPDATE objectives SET owner_team_id = NULL, capture_count = 0, last_captured_at = NULL, last_captured_by = NULL, contested = false,
                  contested_by_gm = false, disabled_by_gm = false, completed_at = NULL, recurring_last_at = NULL WHERE id = $1`,
          [o.id],
        );
        await t.query(`UPDATE capture_states SET progress = '{}', present = '{}', armed = '{}', contested = false WHERE objective_id = $1`, [o.id]);
        break;
    }
    await t.query('UPDATE objectives SET updated_at = now() WHERE id = $1', [o.id]);
    await activity(t, eventId, { type: 'gm_objective', message: (tr) => tr`GM: ${o.name} — ${objectiveActionLabel(tr, b.action)} (${b.reason})`, scope: 'gm', objectiveId: o.id });
    if (['disable', 'activate', 'contest', 'reset'].includes(b.action)) {
      await activity(t, eventId, {
        type: 'gm_objective',
        message: (tr) =>
          b.action === 'disable'
            ? tr`${o.name} was disabled by the GM`
            : b.action === 'activate'
              ? tr`${o.name} is active again`
              : b.action === 'contest'
                ? tr`${o.name} is contested`
                : tr`${o.name} was reset by the GM`,
        scope: 'all',
        objectiveId: o.id,
      });
    }
    await audit(t, eventId, me.id, `objective.${b.action}`, {
      type: 'objective',
      id: o.id,
      before: { owner: o.owner_team_id, disabled: o.disabled_by_gm, contested: o.contested_by_gm },
      after: { teamId: b.teamId ?? null },
      reason: b.reason,
    });
  });
  hub.invalidate(eventId, ['objectives', 'captures']);
  const ctx = await eventContext(eventId, me.id);
  const set = await loadObjectives(eventId);
  res.json(objectiveDtos(ctx, set).find((o) => o.id === objectiveId));
});

liveRouter.post('/:eventId/gm/captures/:captureId/revoke', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, z.object({ reverseRewards: z.boolean(), reason: z.string().trim().min(3).max(500) }));
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t);
    await revokeCapture(t, ctx, idParam(req, 'captureId'), b.reverseRewards, b.reason, me.id);
    await audit(t, eventId, me.id, 'capture.revoke', { type: 'capture', id: req.params.captureId, after: { reverseRewards: b.reverseRewards }, reason: b.reason });
  });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ perks

const perkInput = z.object({
  name: shortText(80).min(2, 'Name the perk'),
  description: z.string().max(1000),
  icon: shortText(40),
  type: z.enum(['uav', 'jammer', 'theft', 'shield', 'double_points', 'recon', 'instant_respawn', 'supply_drop', 'comms_jammer', 'custom']),
  price: z.number().int().min(0).max(1_000_000),
  durationSec: z.number().int().min(0).max(86_400),
  cooldownSec: z.number().int().min(0).max(86_400),
  totalQuantity: z.number().int().min(0).max(10_000),
  perTeamLimit: z.number().int().min(0).max(10_000),
  eligible: z.enum(['any', 'squad_leaders', 'roles']),
  eligibleRoles: z.array(playerRole).max(8),
  requiresApproval: z.boolean(),
  activation: z.enum(['immediate', 'manual']),
  target: z.enum(['none', 'enemy_team', 'objective']),
  config: perkConfigSchema,
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
});
const PERK_COLS: Record<string, string> = {
  name: 'name',
  description: 'description',
  icon: 'icon',
  type: 'type',
  price: 'price',
  durationSec: 'duration_sec',
  cooldownSec: 'cooldown_sec',
  perTeamLimit: 'per_team_limit',
  eligible: 'eligible',
  eligibleRoles: 'eligible_roles',
  requiresApproval: 'requires_approval',
  activation: 'activation',
  target: 'target',
  enabled: 'enabled',
  sortOrder: 'sort_order',
};

liveRouter.get('/:eventId/perks', async (req, res) => {
  res.json(await perksFor(await requireMember(idParam(req, 'eventId'), currentUser(req).id)));
});

liveRouter.post('/:eventId/perks', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, perkInput.partial().required({ name: true, type: true, price: true }));
  const row = await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const r = await one(
      `INSERT INTO perks (event_id, name, description, icon, type, price, duration_sec, cooldown_sec, total_quantity, remaining_quantity, per_team_limit, eligible,
                          eligible_roles, requires_approval, activation, target, config, enabled, sort_order)
       VALUES ($1,$2,COALESCE($3,''),COALESCE($4,'lucideZap'),$5,$6,COALESCE($7,0),COALESCE($8,0),COALESCE($9,0),COALESCE($9,0),COALESCE($10,0),COALESCE($11,'any'),
               COALESCE($12,'{}'::text[]),COALESCE($13,false),COALESCE($14,'immediate'),COALESCE($15,'none'),COALESCE($16,'{}'::jsonb),COALESCE($17,true),
               COALESCE($18,(SELECT count(*) FROM perks WHERE event_id = $1))) RETURNING *`,
      [eventId, b.name, b.description ?? null, b.icon ?? null, b.type, b.price, b.durationSec ?? null, b.cooldownSec ?? null, b.totalQuantity ?? null,
        b.perTeamLimit ?? null, b.eligible ?? null, b.eligibleRoles ?? null, b.requiresApproval ?? null, b.activation ?? null, b.target ?? null,
        b.config ? JSON.stringify(b.config) : null, b.enabled ?? null, b.sortOrder ?? null],
      t,
    );
    await audit(t, eventId, me.id, 'perk.create', { type: 'perk', id: r!.id, after: b });
    return r!;
  });
  hub.invalidate(eventId, ['perks']);
  res.status(201).json(dto.perk(row));
});

liveRouter.post('/:eventId/perks/defaults', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const rows = await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const existing = new Set((await many<{ type: string }>('SELECT type FROM perks WHERE event_id = $1', [eventId], t)).map((r) => r.type));
    const out = [];
    let order = existing.size;
    for (const p of defaultPerks()) {
      if (existing.has(p.type)) continue;
      const r = await one(
        `INSERT INTO perks (event_id, name, description, icon, type, price, duration_sec, cooldown_sec, target, requires_approval, eligible, config, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [eventId, p.name, p.description, p.icon, p.type, p.price, p.durationSec, p.cooldownSec, p.target, 'requiresApproval' in p ? p.requiresApproval : false,
          'eligible' in p ? p.eligible : 'any', JSON.stringify(p.config), order++],
        t,
      );
      out.push(r!);
    }
    await audit(t, eventId, me.id, 'perk.defaults', { after: { added: out.length } });
    return out;
  });
  hub.invalidate(eventId, ['perks']);
  res.status(201).json(rows.map((r) => dto.perk(r)));
});

liveRouter.patch('/:eventId/perks/:perkId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const perkId = idParam(req, 'perkId');
  const b = body(req, perkInput.partial());
  const row = await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const cur = await one('SELECT * FROM perks WHERE id = $1 AND event_id = $2 FOR UPDATE', [perkId, eventId], t);
    if (!cur) throw notFound(tr`Perk not found.`);
    const sets: string[] = [];
    const params: unknown[] = [perkId];
    for (const [k, col] of Object.entries(PERK_COLS)) {
      const v = (b as Record<string, unknown>)[k];
      if (v !== undefined) {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (b.config) {
      params.push(JSON.stringify(b.config));
      sets.push(`config = $${params.length}`);
    }
    if (b.totalQuantity !== undefined) {
      // keep the number already sold: remaining = new total - sold
      const sold = Math.max(0, (cur.total_quantity ?? 0) - (cur.remaining_quantity ?? 0));
      params.push(b.totalQuantity, Math.max(0, b.totalQuantity - sold));
      sets.push(`total_quantity = $${params.length - 1}`, `remaining_quantity = $${params.length}`);
    }
    const r = await one(`UPDATE perks SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 RETURNING *`, params, t);
    await audit(t, eventId, me.id, 'perk.update', { type: 'perk', id: perkId, after: b });
    return r!;
  });
  hub.invalidate(eventId, ['perks']);
  res.json(dto.perk(row));
});

liveRouter.delete('/:eventId/perks/:perkId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const perkId = idParam(req, 'perkId');
  await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const used = await one('SELECT 1 FROM perk_purchases WHERE perk_id = $1 LIMIT 1', [perkId], t);
    if (used) {
      await t.query('UPDATE perks SET enabled = false WHERE id = $1 AND event_id = $2', [perkId, eventId]);
    } else {
      const r = await t.query('DELETE FROM perks WHERE id = $1 AND event_id = $2', [perkId, eventId]);
      if (!r.rowCount) throw notFound(tr`Perk not found.`);
    }
    await audit(t, eventId, me.id, used ? 'perk.disable' : 'perk.delete', { type: 'perk', id: perkId });
  });
  hub.invalidate(eventId, ['perks']);
  res.json({ ok: true });
});

liveRouter.post('/:eventId/perks/:perkId/purchase', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, z.object({ targetTeamId: uuid.nullable().optional(), targetObjectiveId: uuid.nullable().optional(), clientTxId }));
  await consume('purchase', me.id, 10, 60, tr`Too many purchases. Wait a minute.`);
  const { result: purchaseId } = await tx(async (t) => {
    const ctx = await eventContext(eventId, me.id, t, true);
    if (!ctx.isGm && ctx.member?.status !== 'approved') throw forbidden(tr`Join the event first.`, 'not_member');
    return idempotent(t, me.id, b.clientTxId, 'purchase', () =>
      perks.purchase(t, { ctx, perkId: idParam(req, 'perkId'), userId: me.id, targetTeamId: b.targetTeamId, targetObjectiveId: b.targetObjectiveId, clientTxId: b.clientTxId, now: Date.now() }),
    );
  });
  res.json(dto.purchase(await perks.loadPurchase(pool, eventId, purchaseId)));
});

liveRouter.get('/:eventId/purchases', async (req, res) => {
  res.json(await purchasesFor(await requireMember(idParam(req, 'eventId'), currentUser(req).id)));
});

liveRouter.get('/:eventId/effects', async (req, res) => {
  res.json(await effectsFor(await requireMember(idParam(req, 'eventId'), currentUser(req).id)));
});

async function purchaseDto(eventId: string, purchaseId: string) {
  const row = await one(`SELECT ${dto.PURCHASE_SELECT} WHERE pp.id = $1 AND pp.event_id = $2`, [purchaseId, eventId]);
  if (!row) throw notFound(tr`Purchase not found.`);
  return dto.purchase(row);
}

liveRouter.post('/:eventId/purchases/:purchaseId/review', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const purchaseId = idParam(req, 'purchaseId');
  const b = body(req, z.object({ approve: z.boolean(), reason: z.string().max(500).optional() }));
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t);
    await perks.review(t, ctx, purchaseId, b.approve, b.reason ?? null, me.id, Date.now());
    await audit(t, eventId, me.id, b.approve ? 'purchase.approve' : 'purchase.reject', { type: 'purchase', id: purchaseId, reason: b.reason });
  });
  res.json(await purchaseDto(eventId, purchaseId));
});

liveRouter.post('/:eventId/purchases/:purchaseId/activate', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const purchaseId = idParam(req, 'purchaseId');
  await tx(async (t) => {
    const ctx = await eventContext(eventId, me.id, t);
    const pp = await one('SELECT team_id, buyer_id FROM perk_purchases WHERE id = $1 AND event_id = $2', [purchaseId, eventId], t);
    if (!pp) throw notFound(tr`Purchase not found.`);
    const allowed = ctx.isGm || pp.buyer_id === me.id || (ctx.member?.status === 'approved' && ctx.member.team_id === pp.team_id && ctx.member.is_squad_leader);
    if (!allowed) throw forbidden(tr`Only the buyer, a squad leader of the team or the GM can activate it.`);
    await perks.activate(t, ctx, purchaseId, me.id, Date.now());
  });
  res.json(await purchaseDto(eventId, purchaseId));
});

liveRouter.post('/:eventId/purchases/:purchaseId/cancel', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const purchaseId = idParam(req, 'purchaseId');
  const b = body(req, z.object({ refund: z.boolean(), reason: z.string().trim().min(3).max(500) }));
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t);
    await perks.cancel(t, ctx, purchaseId, b.refund, b.reason, me.id);
    await audit(t, eventId, me.id, 'purchase.cancel', { type: 'purchase', id: purchaseId, after: { refund: b.refund }, reason: b.reason });
  });
  res.json(await purchaseDto(eventId, purchaseId));
});

// ------------------------------------------------------------------ results & exports

liveRouter.get('/:eventId/results', async (req, res) => {
  const ctx = await requireMember(idParam(req, 'eventId'), currentUser(req).id).catch(async (e) => {
    // former members (left/removed) can still see results of a completed event
    const c = await eventContext(idParam(req, 'eventId'), currentUser(req).id);
    if (c.member && c.event.status === 'completed') return c;
    throw e;
  });
  res.json(await computeResults(ctx.event.id, { publicView: !ctx.isGm }));
});

liveRouter.post('/:eventId/results/publish', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const token = await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    if (ctx.event.status !== 'completed') throw conflict(tr`Results can be published when the game is over.`, 'not_completed');
    const tok = ctx.event.results_token ?? randomToken(18);
    await t.query('UPDATE events SET results_token = $2, results_published_at = now() WHERE id = $1', [eventId, tok]);
    await audit(t, eventId, me.id, 'results.publish', { type: 'event', id: eventId });
    return tok;
  });
  hub.invalidate(eventId, ['event']);
  res.json({ token, url: `${config.SITE_URL}/r/${token}` });
});

liveRouter.post('/:eventId/results/unpublish', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    await t.query('UPDATE events SET results_published_at = NULL WHERE id = $1', [eventId]);
    await audit(t, eventId, me.id, 'results.unpublish', { type: 'event', id: eventId });
  });
  hub.invalidate(eventId, ['event']);
  res.json({ ok: true });
});

liveRouter.get('/:eventId/export', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const q = queryOf(req, z.object({ format: z.enum(['csv', 'pdf']), kind: z.enum(['leaderboard', 'players', 'captures', 'ledger', 'perks']).default('leaderboard') }));
  const ctx = await eventContext(eventId, me.id);
  const isPlayer = ctx.member && ['approved', 'left', 'removed', 'banned'].includes(ctx.member.status);
  if (!ctx.isGm && !(isPlayer && ctx.event.status === 'completed')) throw forbidden(tr`Exports are available to the GM, and to players once the game is over.`);
  if (!ctx.isGm && q.kind === 'ledger') throw forbidden(tr`The full ledger export is for Game Masters.`);
  await consume('export', me.id, 30, 3600);
  const slug = ctx.event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event';
  if (q.format === 'pdf') {
    const pdf = await exportPdf(eventId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-results.pdf"`);
    res.send(pdf);
  } else {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-${q.kind}.csv"`);
    res.send(await exportCsv(eventId, q.kind));
  }
});

