import { many, one, pool, type Queryable, type Row, type Tx } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { hub } from '../realtime/hub.js';
import type { EventContext } from './context.js';
import { geofence as geofenceOf, rewards as rewardsOf } from './defaults.js';
import { activity, alert, eventPlayers, notify } from './journal.js';
import { applyLedger } from './ledger.js';
import {
  captureBlock,
  cooldownUntil,
  objectiveStatus,
  objectiveVisible,
  prereqsSatisfied,
  type CaptureBlockReason,
  type ObjectiveRow,
  type ObjectiveStatus,
} from './rules.js';
import * as dto from './serialize.js';
import { tr } from '../i18n/index.js';
import { captureMethodLabel } from '../i18n/labels.js';

export type ObjRow = Row & ObjectiveRow & { name: string; event_id: string; lat: number; lng: number; rewards: unknown; recurring_last_at: Date | null; last_status: string | null };

export const OBJECTIVE_SELECT = `o.*, u.nickname AS last_captured_by_nickname FROM objectives o LEFT JOIN users u ON u.id = o.last_captured_by`;

export interface ObjectiveSet {
  rows: ObjRow[];
  counts: Map<string, number>;
  armed: Map<string, Record<string, boolean>>;
}

export async function loadObjectives(eventId: string, q: Queryable = pool): Promise<ObjectiveSet> {
  const rows = await many<ObjRow>(`SELECT ${OBJECTIVE_SELECT} WHERE o.event_id = $1 ORDER BY o.sort_order, o.created_at`, [eventId], q);
  const states = await many<{ objective_id: string; armed: Record<string, boolean> }>('SELECT objective_id, armed FROM capture_states WHERE event_id = $1', [eventId], q);
  return {
    rows,
    counts: new Map(rows.map((r) => [r.id, r.capture_count])),
    armed: new Map(states.map((s) => [s.objective_id, s.armed ?? {}])),
  };
}

export function statusOf(row: ObjRow, counts: Map<string, number>, now = Date.now()): ObjectiveStatus {
  return objectiveStatus(row, prereqsSatisfied(row, counts), now);
}

/** Objectives the viewer may see, as DTOs (GM variant includes the capture code). */
export function objectiveDtos(ctx: EventContext, set: ObjectiveSet, now = Date.now()) {
  const out = [];
  for (const row of set.rows) {
    const status = statusOf(row, set.counts, now);
    if (!objectiveVisible(row, status, ctx.viewer, { status: ctx.event.status, phase: ctx.event.phase, rules: ctx.rules })) continue;
    out.push(objectiveDto(ctx, row, status, set.armed.get(row.id) ?? {}, now));
  }
  return out;
}

export function objectiveDto(ctx: EventContext, row: ObjRow, status: ObjectiveStatus, armed: Record<string, boolean>, now = Date.now()) {
  const teamId = ctx.viewer.teamId;
  const blocked: CaptureBlockReason | null = ctx.isGm ? null : captureBlock(row, status, ctx.event.status, teamId, now, 'any', armed);
  return dto.objective(
    row,
    {
      status,
      canCapture: !ctx.isGm && blocked === null,
      blockedReason: blocked,
      cooldownUntil: cooldownUntil(row),
      viewerTeamId: teamId,
      lastCapturedByNickname: (row.last_captured_by_nickname as string | null) ?? null,
    },
    ctx.isGm,
  );
}

/** Points multiplier from active double-points effects of a team. */
export async function pointsMultiplier(t: Queryable, eventId: string, teamId: string): Promise<number> {
  const row = await one<{ m: number | null }>(
    `SELECT max(COALESCE((config->'doublePoints'->>'multiplier')::float, 2)) AS m
       FROM effects WHERE event_id = $1 AND team_id = $2 AND type = 'double_points' AND status = 'active' AND expires_at > now()`,
    [eventId, teamId],
    t,
  );
  return row?.m && row.m > 1 ? row.m : 1;
}

/** Award whole minutes of "held objective" rewards to the current owner. */
export async function settleRecurring(t: Tx, ctx: EventContext, row: ObjRow, now: number): Promise<void> {
  if (!row.owner_team_id || !row.recurring_last_at) return;
  const r = rewardsOf(row.rewards);
  if (!r.recurringPointsPerMinute && !r.recurringCurrencyPerMinute) return;
  const minutes = Math.floor((now - new Date(row.recurring_last_at).getTime()) / 60_000);
  if (minutes < 1) return;
  const mult = await pointsMultiplier(t, ctx.event.id, row.owner_team_id);
  const base = { eventId: ctx.event.id, teamId: row.owner_team_id, scoring: ctx.scoring, objectiveId: row.id, type: 'recurring' as const, reason: tr`Held ${row.name} for ${minutes} min` };
  if (r.recurringPointsPerMinute) await applyLedger(t, { ...base, kind: 'points', amount: Math.round(r.recurringPointsPerMinute * minutes * mult) });
  if (r.recurringCurrencyPerMinute) await applyLedger(t, { ...base, kind: 'currency', amount: r.recurringCurrencyPerMinute * minutes });
  const next = new Date(new Date(row.recurring_last_at).getTime() + minutes * 60_000);
  await t.query('UPDATE objectives SET recurring_last_at = $1 WHERE id = $2', [next, row.id]);
  row.recurring_last_at = next;
}

export interface CaptureInput {
  ctx: EventContext;
  objectiveId: string;
  teamId: string;
  userId: string | null;
  method: 'code' | 'qr' | 'geofence' | 'gm';
  clientTxId?: string | null;
  now: number;
  actorId?: string | null;
}

export interface CaptureOutcome {
  captured: true;
  captureId: string;
  objectiveId: string;
  points: number;
  currency: number;
}

const BLOCK_MESSAGES = (): Record<CaptureBlockReason, string> => ({
  not_live: tr`The game is not running.`,
  no_team: tr`You are not on a team.`,
  disabled: tr`This objective is disabled.`,
  completed: tr`This objective has no captures left.`,
  locked: tr`Capture the prerequisite objectives first.`,
  inactive: tr`This objective is not available right now.`,
  contested: tr`The objective is contested.`,
  already_owned: tr`Your team already holds this objective.`,
  team_not_allowed: tr`Your team cannot capture this objective.`,
  cooldown: tr`The objective is cooling down after the last capture.`,
  jammed: tr`This objective is jammed for your team.`,
  shielded: tr`This objective is shielded by another team.`,
  geofence_required: tr`Hold the zone first, then enter the code.`,
});

export function blockError(reason: CaptureBlockReason) {
  return conflict(BLOCK_MESSAGES()[reason], reason);
}

/**
 * Capture inside the caller's transaction (objective row locked). Validates again under the
 * lock, so two simultaneous captures cannot both succeed.
 */
export async function performCapture(t: Tx, input: CaptureInput): Promise<CaptureOutcome> {
  const { ctx, now } = input;
  const eventId = ctx.event.id;
  const row = await one<ObjRow>('SELECT * FROM objectives WHERE id = $1 AND event_id = $2 FOR UPDATE', [input.objectiveId, eventId], t);
  if (!row) throw notFound(tr`Objective not found.`);
  const counts = new Map((await many<{ id: string; capture_count: number }>('SELECT id, capture_count FROM objectives WHERE event_id = $1', [eventId], t)).map((r) => [r.id, r.capture_count]));
  const status = statusOf(row, counts, now);
  const state = await one<{ armed: Record<string, boolean> }>('SELECT armed FROM capture_states WHERE objective_id = $1', [row.id], t);
  if (input.method !== 'gm') {
    if (!objectiveVisible(row, status, ctx.viewer, { status: ctx.event.status, phase: ctx.event.phase, rules: ctx.rules }) && input.method !== 'geofence') {
      throw notFound(tr`Objective not found.`);
    }
    const block = captureBlock(row, status, ctx.event.status, input.teamId, now, input.method, state?.armed ?? {});
    if (block) throw blockError(block);
  }

  const previousOwner = row.owner_team_id;
  // Pay out the time the previous owner held it before ownership changes.
  await settleRecurring(t, ctx, row, now);

  const r = rewardsOf(row.rewards);
  const teamRewards = r.perTeam[input.teamId] ?? { points: r.points, currency: r.currency };
  const mult = await pointsMultiplier(t, eventId, input.teamId);
  const points = Math.round(teamRewards.points * mult);
  const currency = teamRewards.currency;
  const firstCapture = row.capture_count === 0;
  const newCount = row.capture_count + 1;
  const completes = row.max_captures > 0 && newCount >= row.max_captures;

  const capture = await one<{ id: string }>(
    `INSERT INTO objective_captures (event_id, objective_id, team_id, user_id, method, points, currency, previous_owner_team_id, client_tx_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [eventId, row.id, input.teamId, input.userId, input.method, points, currency, previousOwner, input.clientTxId ?? null],
    t,
  );
  const captureId = capture!.id;
  await t.query(
    `UPDATE objectives SET owner_team_id = $2, capture_count = $3, last_captured_at = to_timestamp($4 / 1000.0), last_captured_by = $5,
            recurring_last_at = to_timestamp($4 / 1000.0), contested = false, completed_at = CASE WHEN $6 THEN now() ELSE completed_at END,
            updated_at = now()
      WHERE id = $1`,
    [row.id, input.teamId, newCount, now, input.userId, completes],
  );
  await t.query(`UPDATE capture_states SET progress = '{}', armed = '{}', contested = false, updated_at = now() WHERE objective_id = $1`, [row.id]);
  if (input.userId) await t.query('UPDATE event_members SET captures = captures + 1 WHERE event_id = $1 AND user_id = $2', [eventId, input.userId]);

  const base = { eventId, teamId: input.teamId, scoring: ctx.scoring, userId: input.userId, objectiveId: row.id, captureId, clientTxId: input.clientTxId, actorId: input.actorId ?? null };
  if (points) await applyLedger(t, { ...base, kind: 'points', type: 'capture', amount: points, reason: (tr) => tr`Captured ${row.name}` });
  if (currency) await applyLedger(t, { ...base, kind: 'currency', type: 'capture', amount: currency, reason: (tr) => tr`Captured ${row.name}` });
  if (firstCapture && r.captureBonus) await applyLedger(t, { ...base, kind: 'points', type: 'capture_bonus', amount: Math.round(r.captureBonus * mult), reason: (tr) => tr`First capture of ${row.name}` });
  if (completes && r.completionBonus) await applyLedger(t, { ...base, kind: 'points', type: 'completion_bonus', amount: Math.round(r.completionBonus * mult), reason: (tr) => tr`Completed ${row.name}` });

  // Feed, alerts, notifications
  const teamName = (await one<{ name: string }>('SELECT name FROM teams WHERE id = $1', [input.teamId], t))?.name ?? tr`A team`;
  const nickname = input.userId ? (await one<{ nickname: string }>('SELECT nickname FROM users WHERE id = $1', [input.userId], t))?.nickname : null;
  const capturedVisibleToAll = ctx.rules.capturedObjectives === 'visible' && (row.visibility?.mode ?? 'all') === 'all';
  await activity(t, eventId, {
    type: 'objective_captured',
    message: (tr) => (nickname ? tr`${teamName} captured ${row.name} (${nickname}, ${captureMethodLabel(tr, input.method)})` : tr`${teamName} captured ${row.name}`),
    scope: capturedVisibleToAll ? 'all' : 'gm',
    teamId: input.teamId,
    userId: input.userId,
    objectiveId: row.id,
    data: { method: input.method, points, currency },
  });
  if (!capturedVisibleToAll) {
    await activity(t, eventId, { type: 'objective_captured', message: (tr) => tr`Your team captured ${row.name}`, scope: 'team', teamId: input.teamId, objectiveId: row.id, data: { points, currency } });
  }
  await alert(t, eventId, {
    type: 'capture',
    severity: 'info',
    userId: input.userId,
    message: (tr) => tr`${teamName} captured ${row.name} by ${captureMethodLabel(tr, input.method)}`,
    data: { objectiveId: row.id, captureId, teamId: input.teamId },
  });
  const url = `/events/${eventId}/live/objectives/${row.id}`;
  await notify(t, await eventPlayers(t, eventId, input.teamId), {
    type: 'objective_captured',
    title: `${row.name} captured`,
    body: (tr) => (nickname ? tr`+${points} points, +${currency} credits · ${nickname}` : tr`+${points} points, +${currency} credits`),
    eventId,
    url,
    data: { objectiveId: row.id },
  });
  if (previousOwner && previousOwner !== input.teamId) {
    await notify(t, await eventPlayers(t, eventId, previousOwner), {
      type: 'objective_lost',
      title: `${row.name} lost`,
      body: (tr) => tr`${teamName} took the objective.`,
      priority: 'high',
      eventId,
      url,
      data: { objectiveId: row.id },
    });
  }
  // Unlocks: objectives that list this one as prerequisite, and the "next" objective.
  if (firstCapture) {
    const unlocked = await many<{ id: string; name: string; prerequisite_ids: string[] }>(
      `SELECT id, name, prerequisite_ids FROM objectives WHERE event_id = $1 AND ($2 = ANY(prerequisite_ids) OR id = $3)`,
      [eventId, row.id, row.next_objective_id],
      t,
    );
    counts.set(row.id, newCount);
    for (const u of unlocked) {
      if (u.prerequisite_ids.every((p) => (counts.get(p) ?? 0) > 0)) {
        await activity(t, eventId, { type: 'objective_available', message: (tr) => tr`New objective available: ${u.name}`, scope: 'all', objectiveId: u.id });
        await notify(t, await eventPlayers(t, eventId), {
          type: 'objective_available',
          title: (tr) => tr`New objective available`,
          body: u.name,
          eventId,
          url: `/events/${eventId}/live/objectives/${u.id}`,
          data: { objectiveId: u.id },
        });
      }
    }
  }

  t.afterCommit(() => {
    hub.invalidate(eventId, ['objectives', 'captures']);
  });
  return { captured: true, captureId, objectiveId: row.id, points, currency };
}

/** GM revokes a capture: optionally reverses its rewards; ownership goes back to the previous owner. */
export async function revokeCapture(t: Tx, ctx: EventContext, captureId: string, reverseRewards: boolean, reason: string, actorId: string): Promise<void> {
  const c = await one('SELECT * FROM objective_captures WHERE id = $1 AND event_id = $2 FOR UPDATE', [captureId, ctx.event.id], t);
  if (!c) throw notFound(tr`Capture not found.`);
  if (c.revoked_at) throw conflict(tr`This capture was already revoked.`, 'already_revoked');
  await t.query('UPDATE objective_captures SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1', [captureId, actorId, reason]);
  const o = await one<ObjRow>('SELECT * FROM objectives WHERE id = $1 FOR UPDATE', [c.objective_id], t);
  if (o && o.owner_team_id === c.team_id) {
    await t.query(
      `UPDATE objectives SET owner_team_id = $2, capture_count = GREATEST(0, capture_count - 1), completed_at = NULL,
              recurring_last_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END, updated_at = now() WHERE id = $1`,
      [o.id, c.previous_owner_team_id],
    );
  } else if (o) {
    await t.query('UPDATE objectives SET capture_count = GREATEST(0, capture_count - 1), updated_at = now() WHERE id = $1', [o.id]);
  }
  if (c.user_id) await t.query('UPDATE event_members SET captures = GREATEST(0, captures - 1) WHERE event_id = $1 AND user_id = $2', [ctx.event.id, c.user_id]);
  if (reverseRewards) {
    const base = { eventId: ctx.event.id, teamId: c.team_id, scoring: ctx.scoring, userId: c.user_id, objectiveId: c.objective_id, captureId, actorId, type: 'capture_revoked' as const, reason };
    if (Number(c.points)) await applyLedger(t, { ...base, kind: 'points', amount: -Number(c.points) });
    if (Number(c.currency)) await applyLedger(t, { ...base, kind: 'currency', amount: -Number(c.currency) });
  }
  await activity(t, ctx.event.id, { type: 'capture_revoked', message: (tr) => tr`GM revoked a capture of ${o?.name ?? tr`an objective`}: ${reason}`, scope: 'all', teamId: c.team_id, objectiveId: c.objective_id });
  t.afterCommit(() => hub.invalidate(ctx.event.id, ['objectives', 'captures']));
}

export { geofenceOf };
