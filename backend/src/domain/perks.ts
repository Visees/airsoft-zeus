import { many, one, type Queryable, type Row, type Tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { hub } from '../realtime/hub.js';
import { playsIn, type EventContext } from './context.js';
import { DEFAULT_PERK_CONFIG, type Precision } from './defaults.js';
import { activity, alert, eventGms, eventPlayers, notify } from './journal.js';
import { applyLedger } from './ledger.js';
import { upsertIntel } from './locations.js';
import { statusOf, type ObjRow } from './objectives.js';
import { objectiveVisible } from './rules.js';
import * as dto from './serialize.js';

export type AvailabilityReason =
  | 'store_disabled'
  | 'not_live'
  | 'not_eligible'
  | 'sold_out'
  | 'team_limit'
  | 'cooldown'
  | 'insufficient_funds'
  | 'disabled'
  | 'no_team'
  | null;

export interface TeamPerkStats {
  purchases: number;
  lastAt: number | null;
}

/** Pure availability check shared by the store listing and the purchase endpoint. */
export function perkAvailability(
  ctx: Pick<EventContext, 'event' | 'member'>,
  perk: Row,
  stats: TeamPerkStats,
  teamCurrency: number,
  now: number,
): { canBuy: boolean; reason: AvailabilityReason; cooldownUntil: string | null; teamPurchases: number } {
  const m = ctx.member;
  const cooldownUntil = perk.cooldown_sec && stats.lastAt ? stats.lastAt + perk.cooldown_sec * 1000 : null;
  const res = (reason: AvailabilityReason) => ({
    canBuy: reason === null,
    reason,
    cooldownUntil: cooldownUntil && cooldownUntil > now ? new Date(cooldownUntil).toISOString() : null,
    teamPurchases: stats.purchases,
  });
  if (!ctx.event.store_enabled) return res('store_disabled');
  if (!perk.enabled) return res('disabled');
  if (ctx.event.status !== 'live') return res('not_live');
  if (!m || m.status !== 'approved' || !m.team_id) return res('no_team');
  if (perk.eligible === 'squad_leaders' && !m.is_squad_leader) return res('not_eligible');
  if (perk.eligible === 'roles' && !(perk.eligible_roles ?? []).includes(m.player_role)) return res('not_eligible');
  if (perk.total_quantity > 0 && (perk.remaining_quantity ?? 0) <= 0) return res('sold_out');
  if (perk.per_team_limit > 0 && stats.purchases >= perk.per_team_limit) return res('team_limit');
  if (cooldownUntil && cooldownUntil > now) return res('cooldown');
  if (teamCurrency < Number(perk.price)) return res('insufficient_funds');
  return res(null);
}

export async function teamPerkStats(q: Queryable, eventId: string, teamId: string): Promise<Map<string, TeamPerkStats>> {
  const rows = await many<{ perk_id: string; n: number; last_at: Date | null }>(
    `SELECT perk_id, count(*)::int AS n, max(created_at) AS last_at FROM perk_purchases
      WHERE event_id = $1 AND team_id = $2 AND status <> 'rejected' AND NOT refunded GROUP BY perk_id`,
    [eventId, teamId],
    q,
  );
  return new Map(rows.map((r) => [r.perk_id, { purchases: r.n, lastAt: r.last_at ? new Date(r.last_at).getTime() : null }]));
}

const AVAILABILITY_MESSAGES: Record<Exclude<AvailabilityReason, null>, string> = {
  store_disabled: 'The store is closed for this event.',
  not_live: 'Perks can only be bought while the game is running.',
  not_eligible: 'Your role cannot buy this perk.',
  sold_out: 'This perk is sold out.',
  team_limit: 'Your team reached the limit for this perk.',
  cooldown: 'This perk is cooling down for your team.',
  insufficient_funds: 'Your team does not have enough credits.',
  disabled: 'This perk is not available.',
  no_team: 'Join a team first.',
};

export interface PurchaseInput {
  ctx: EventContext;
  perkId: string;
  userId: string;
  targetTeamId?: string | null;
  targetObjectiveId?: string | null;
  clientTxId: string;
  now: number;
}

export async function purchase(t: Tx, p: PurchaseInput): Promise<string> {
  const { ctx, now } = p;
  const eventId = ctx.event.id;
  const m = ctx.member;
  if (!m || !playsIn(m) || !m.team_id) throw forbidden('Only players on a team can buy perks.', 'no_team');
  const teamId = m.team_id;
  const perk = await one('SELECT * FROM perks WHERE id = $1 AND event_id = $2 FOR UPDATE', [p.perkId, eventId], t);
  if (!perk) throw notFound('Perk not found.');
  const team = await one<{ currency: number }>('SELECT currency FROM teams WHERE id = $1 FOR UPDATE', [teamId], t);
  const stats = (await teamPerkStats(t, eventId, teamId)).get(perk.id) ?? { purchases: 0, lastAt: null };
  const avail = perkAvailability(ctx, perk, stats, Number(team?.currency ?? 0), now);
  if (!avail.canBuy) throw conflict(AVAILABILITY_MESSAGES[avail.reason!], avail.reason!);

  // Targets
  let targetTeamId: string | null = p.targetTeamId ?? null;
  let targetObjectiveId: string | null = p.targetObjectiveId ?? null;
  if (['uav', 'recon'].includes(perk.type) && ctx.rules.enemies === 'never') {
    throw conflict('Enemy positions are disabled in this event.', 'not_eligible');
  }
  if (targetTeamId) {
    const tt = await one<{ id: string }>('SELECT id FROM teams WHERE id = $1 AND event_id = $2', [targetTeamId, eventId], t);
    if (!tt) throw badRequest('Choose a valid team.', 'invalid_target', { targetTeamId: 'Choose a valid team.' });
    if (targetTeamId === teamId) throw badRequest('Choose an enemy team.', 'invalid_target', { targetTeamId: 'Choose an enemy team.' });
  }
  if (perk.target === 'enemy_team' && !targetTeamId) {
    const enemies = await many<{ id: string }>('SELECT id FROM teams WHERE event_id = $1 AND id <> $2', [eventId, teamId], t);
    if (enemies.length === 1) targetTeamId = enemies[0].id;
    else if (perk.type === 'theft') throw badRequest('Choose the team to steal from.', 'invalid_target', { targetTeamId: 'Required' });
  }
  if (perk.target === 'objective') {
    if (!targetObjectiveId) throw badRequest('Choose an objective.', 'invalid_target', { targetObjectiveId: 'Required' });
    const o = await one<ObjRow>('SELECT * FROM objectives WHERE id = $1 AND event_id = $2', [targetObjectiveId, eventId], t);
    const counts = new Map((await many<{ id: string; capture_count: number }>('SELECT id, capture_count FROM objectives WHERE event_id = $1', [eventId], t)).map((r) => [r.id, r.capture_count]));
    if (!o || !objectiveVisible(o, statusOf(o, counts, now), ctx.viewer, { status: ctx.event.status, phase: ctx.event.phase, rules: ctx.rules })) {
      throw badRequest('Choose a valid objective.', 'invalid_target', { targetObjectiveId: 'Choose a valid objective.' });
    }
  } else {
    targetObjectiveId = perk.target === 'none' ? null : targetObjectiveId;
  }
  if (perk.type === 'theft' && targetTeamId) {
    const target = await one<{ theft_protected_until: Date | null }>('SELECT theft_protected_until FROM teams WHERE id = $1', [targetTeamId], t);
    if (target?.theft_protected_until && new Date(target.theft_protected_until).getTime() > now) {
      throw conflict('That team was robbed recently and is protected for now.', 'target_protected');
    }
  }

  const status = perk.requires_approval ? 'pending_approval' : perk.activation === 'immediate' ? 'ready' : 'ready';
  const row = await one<{ id: string }>(
    `INSERT INTO perk_purchases (event_id, perk_id, team_id, buyer_id, price, target_team_id, target_objective_id, client_tx_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [eventId, perk.id, teamId, p.userId, perk.price, targetTeamId, targetObjectiveId, p.clientTxId, status],
    t,
  );
  const purchaseId = row!.id;
  await applyLedger(t, {
    eventId,
    teamId,
    kind: 'currency',
    type: 'perk_purchase',
    amount: -Number(perk.price),
    scoring: ctx.scoring,
    userId: p.userId,
    perkId: perk.id,
    purchaseId,
    clientTxId: p.clientTxId,
    reason: `Bought ${perk.name}`,
    requireFunds: true,
  });
  if (perk.total_quantity > 0) await t.query('UPDATE perks SET remaining_quantity = remaining_quantity - 1 WHERE id = $1', [perk.id]);

  const buyer = await one<{ nickname: string }>('SELECT nickname FROM users WHERE id = $1', [p.userId], t);
  await activity(t, eventId, { type: 'perk_purchased', message: `${buyer?.nickname ?? 'A player'} bought ${perk.name}`, scope: 'team', teamId, userId: p.userId, data: { perkId: perk.id, purchaseId } });
  await notify(t, (await eventPlayers(t, eventId, teamId)).filter((id) => id !== p.userId), {
    type: 'perk_purchased',
    title: `${perk.name} bought`,
    body: `${buyer?.nickname ?? 'A teammate'} spent ${perk.price} credits${perk.requires_approval ? ' — waiting for GM approval' : ''}.`,
    eventId,
    url: `/events/${eventId}/live/store`,
    push: false,
  });

  if (perk.requires_approval) {
    await alert(t, eventId, {
      type: 'purchase_request',
      severity: 'warning',
      userId: p.userId,
      message: `${buyer?.nickname ?? 'A player'} requests ${perk.name} (${perk.price} cr)`,
      data: { purchaseId, perkId: perk.id, teamId },
    });
    await notify(t, await eventGms(t, eventId), {
      type: 'perk_purchased',
      title: 'Perk approval needed',
      body: `${perk.name} for ${buyer?.nickname ?? 'a player'}`,
      priority: 'high',
      eventId,
      url: `/gm/events/${eventId}/control`,
    });
  } else if (perk.activation === 'immediate') {
    await activate(t, ctx, purchaseId, p.userId, now);
  }
  t.afterCommit(() => hub.invalidate(eventId, ['purchases', 'perks', 'effects'], ['gm', { teamId }]));
  return purchaseId;
}

export async function loadPurchase(t: Queryable, eventId: string, purchaseId: string) {
  const row = await one(`SELECT ${dto.PURCHASE_SELECT} WHERE pp.id = $1 AND pp.event_id = $2`, [purchaseId, eventId], t);
  if (!row) throw notFound('Purchase not found.');
  return row;
}

/** Activate a purchase in status 'ready'. */
export async function activate(t: Tx, ctx: EventContext, purchaseId: string, _actorId: string, now: number): Promise<void> {
  const eventId = ctx.event.id;
  const pp = await one('SELECT * FROM perk_purchases WHERE id = $1 AND event_id = $2 FOR UPDATE', [purchaseId, eventId], t);
  if (!pp) throw notFound('Purchase not found.');
  if (pp.status !== 'ready') throw conflict('This perk cannot be activated now.', 'invalid_state');
  if (ctx.event.status !== 'live') throw conflict('Perks can only be activated while the game is running.', 'not_live');
  const perk = await one('SELECT * FROM perks WHERE id = $1', [pp.perk_id], t);
  if (!perk) throw notFound('Perk not found.');
  const config = { ...DEFAULT_PERK_CONFIG, ...(perk.config ?? {}) };
  const durationSec = perk.type === 'recon' ? config.recon.revealSec : perk.duration_sec;
  const expiresAt = new Date(now + durationSec * 1000);
  const teamId: string = pp.team_id;
  let status: 'active' | 'completed' = durationSec > 0 ? 'active' : 'completed';
  let effectId: string | null = null;

  const createEffect = async () => {
    const e = await one<{ id: string }>(
      `INSERT INTO effects (event_id, purchase_id, type, team_id, target_team_id, objective_id, starts_at, expires_at, config)
       VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),$8,$9) RETURNING id`,
      [eventId, purchaseId, perk.type, teamId, pp.target_team_id, pp.target_objective_id, now, expiresAt, JSON.stringify(perk.config ?? {})],
      t,
    );
    effectId = e!.id;
    return effectId;
  };

  switch (perk.type) {
    case 'uav':
    case 'recon': {
      const id = await createEffect();
      const precision: Precision = perk.type === 'uav' ? config.uav.precision : config.recon.precision;
      const cfg = perk.type === 'uav' ? { precision, delaySec: config.uav.delaySec, areaRadiusM: config.uav.areaRadiusM } : { precision, areaRadiusM: 75 };
      // Snapshot of current positions of the target team(s) — never earlier positions than now.
      const targets = await many(
        `SELECT pl.* FROM player_locations pl JOIN event_members m ON m.event_id = pl.event_id AND m.user_id = pl.user_id
          WHERE pl.event_id = $1 AND m.status = 'approved' AND m.tracking_active
            AND m.team_id IS NOT NULL AND m.team_id <> $2 AND ($3::uuid IS NULL OR m.team_id = $3)
            AND pl.received_at > now() - make_interval(secs => $4)`,
        [eventId, teamId, pp.target_team_id, ctx.tracking.hideAfterSec],
        t,
      );
      for (const loc of targets) await upsertIntel(eventId, { id, team_id: teamId }, loc.user_id, loc as never, cfg, now, t);
      break;
    }
    case 'jammer':
      if (!pp.target_objective_id) throw conflict('No objective selected.', 'invalid_target');
      await createEffect();
      await recomputeObjectiveEffects(t, eventId);
      break;
    case 'shield':
      if (!pp.target_objective_id) throw conflict('No objective selected.', 'invalid_target');
      await createEffect();
      await recomputeObjectiveEffects(t, eventId);
      break;
    case 'double_points':
      await createEffect();
      break;
    case 'theft': {
      if (!pp.target_team_id) throw conflict('No target team.', 'invalid_target');
      const target = await one<{ currency: number; name: string }>('SELECT currency, name FROM teams WHERE id = $1 FOR UPDATE', [pp.target_team_id], t);
      const balance = Number(target?.currency ?? 0);
      const wanted = config.theft.mode === 'percent' ? Math.floor((balance * config.theft.amount) / 100) : Math.floor(config.theft.amount);
      const amount = Math.max(0, Math.min(wanted, balance));
      const out = await applyLedger(t, {
        eventId,
        teamId: pp.target_team_id,
        kind: 'currency',
        type: 'theft_out',
        amount: -amount,
        scoring: ctx.scoring,
        perkId: perk.id,
        purchaseId,
        reason: `Stolen with ${perk.name}`,
      });
      await applyLedger(t, { eventId, teamId, kind: 'currency', type: 'theft_in', amount: -out.applied, scoring: ctx.scoring, perkId: perk.id, purchaseId, reason: `Stolen from ${target?.name}` });
      if (config.theft.protectionSec > 0) {
        await t.query('UPDATE teams SET theft_protected_until = to_timestamp($2/1000.0) WHERE id = $1', [pp.target_team_id, now + config.theft.protectionSec * 1000]);
      }
      await notify(t, await eventPlayers(t, eventId, pp.target_team_id), {
        type: 'perk_activated',
        title: 'Credits stolen',
        body: `An enemy team took ${-out.applied} credits from your team.`,
        priority: 'high',
        eventId,
        url: `/events/${eventId}/live/team`,
      });
      status = 'completed';
      break;
    }
    default: {
      // GM-fulfilled perks: an effect for the timer (if any) and an alert for the GM.
      if (durationSec > 0) await createEffect();
      const buyerTeam = await one<{ name: string }>('SELECT name FROM teams WHERE id = $1', [teamId], t);
      await alert(t, eventId, {
        type: 'perk_fulfil',
        severity: 'warning',
        message: `${perk.name} for ${buyerTeam?.name ?? 'a team'} — act in the field`,
        data: { purchaseId, perkId: perk.id, teamId },
      });
    }
  }

  await t.query(`UPDATE perk_purchases SET status = $2, activated_at = to_timestamp($3/1000.0), expires_at = $4, updated_at = now() WHERE id = $1`, [
    purchaseId,
    status,
    now,
    durationSec > 0 ? expiresAt : null,
  ]);
  await activity(t, eventId, { type: 'perk_activated', message: `${perk.name} activated`, scope: 'team', teamId, data: { purchaseId, effectId } });
  await activity(t, eventId, { type: 'perk_activated', message: `${perk.name} activated`, scope: 'gm', teamId, data: { purchaseId, effectId } });
  await notify(t, await eventPlayers(t, eventId, teamId), {
    type: 'perk_activated',
    title: `${perk.name} active`,
    body: durationSec > 0 ? `For ${Math.round(durationSec / 60) || 1} min` : 'Done',
    eventId,
    url: `/events/${eventId}/live`,
    push: false,
  });
  t.afterCommit(() => {
    hub.invalidate(eventId, ['purchases', 'effects'], ['gm', { teamId }]);
    if (['jammer', 'shield'].includes(perk.type)) hub.invalidate(eventId, ['objectives']);
    hub.positionsDirty(eventId);
  });
}

/** Rebuild objectives.jammed_for and shield columns from the active effects. */
export async function recomputeObjectiveEffects(t: Tx, eventId: string): Promise<void> {
  const teams = await many<{ id: string }>('SELECT id FROM teams WHERE event_id = $1', [eventId], t);
  const effects = await many(`SELECT * FROM effects WHERE event_id = $1 AND status = 'active' AND expires_at > now() AND type IN ('jammer','shield')`, [eventId], t);
  const jams = new Map<string, Record<string, number>>();
  const shields = new Map<string, { until: Date; teamId: string }>();
  for (const e of effects) {
    if (!e.objective_id) continue;
    const until = new Date(e.expires_at);
    if (e.type === 'jammer') {
      const targets = e.target_team_id ? [e.target_team_id] : teams.map((x) => x.id).filter((id) => id !== e.team_id);
      const j = jams.get(e.objective_id) ?? {};
      for (const tt of targets) j[tt] = Math.max(j[tt] ?? 0, until.getTime());
      jams.set(e.objective_id, j);
    } else {
      const cur = shields.get(e.objective_id);
      if (!cur || cur.until < until) shields.set(e.objective_id, { until, teamId: e.team_id });
    }
  }
  await t.query(`UPDATE objectives SET jammed_for = '{}', shielded_until = NULL, shielded_team_id = NULL WHERE event_id = $1 AND (jammed_for <> '{}' OR shielded_until IS NOT NULL)`, [eventId]);
  for (const [oid, j] of jams) await t.query('UPDATE objectives SET jammed_for = $2 WHERE id = $1', [oid, JSON.stringify(j)]);
  for (const [oid, s] of shields) await t.query('UPDATE objectives SET shielded_until = $2, shielded_team_id = $3 WHERE id = $1', [oid, s.until, s.teamId]);
}

export async function review(t: Tx, ctx: EventContext, purchaseId: string, approve: boolean, reason: string | null, actorId: string, now: number): Promise<void> {
  const eventId = ctx.event.id;
  const pp = await one('SELECT * FROM perk_purchases WHERE id = $1 AND event_id = $2 FOR UPDATE', [purchaseId, eventId], t);
  if (!pp) throw notFound('Purchase not found.');
  if (pp.status !== 'pending_approval') throw conflict('This request was already handled.', 'invalid_state');
  const perk = await one('SELECT * FROM perks WHERE id = $1', [pp.perk_id], t);
  await t.query('UPDATE perk_purchases SET status = $2, resolved_by = $3, reason = $4, updated_at = now() WHERE id = $1', [
    purchaseId,
    approve ? 'ready' : 'rejected',
    actorId,
    reason,
  ]);
  await t.query(`UPDATE alerts SET acknowledged_at = now(), acknowledged_by = $2 WHERE event_id = $1 AND type = 'purchase_request' AND data->>'purchaseId' = $3`, [
    eventId,
    actorId,
    purchaseId,
  ]);
  if (approve) {
    if (perk?.activation === 'immediate') await activate(t, ctx, purchaseId, actorId, now);
    else
      await notify(t, await eventPlayers(t, eventId, pp.team_id), {
        type: 'perk_activated',
        title: `${perk?.name} approved`,
        body: 'Activate it from the store when you are ready.',
        eventId,
        url: `/events/${eventId}/live/store`,
      });
  } else {
    await refund(t, ctx, pp, perk, reason ?? 'Rejected by the Game Master', actorId);
    await notify(t, await eventPlayers(t, eventId, pp.team_id), {
      type: 'perk_rejected',
      title: `${perk?.name} rejected`,
      body: `${pp.price} credits refunded${reason ? ` — ${reason}` : ''}.`,
      eventId,
      url: `/events/${eventId}/live/store`,
    });
  }
  t.afterCommit(() => hub.invalidate(eventId, ['purchases', 'alerts'], ['gm', { teamId: pp.team_id }]));
}

async function refund(t: Tx, ctx: EventContext, pp: Row, perk: Row | null, reason: string, actorId: string): Promise<void> {
  await applyLedger(t, {
    eventId: ctx.event.id,
    teamId: pp.team_id,
    kind: 'currency',
    type: 'perk_refund',
    amount: Number(pp.price),
    scoring: ctx.scoring,
    perkId: pp.perk_id,
    purchaseId: pp.id,
    actorId,
    reason,
  });
  await t.query('UPDATE perk_purchases SET refunded = true WHERE id = $1', [pp.id]);
  if (perk && perk.total_quantity > 0) await t.query('UPDATE perks SET remaining_quantity = LEAST(total_quantity, remaining_quantity + 1) WHERE id = $1', [perk.id]);
}

export async function cancel(t: Tx, ctx: EventContext, purchaseId: string, doRefund: boolean, reason: string, actorId: string): Promise<void> {
  const eventId = ctx.event.id;
  const pp = await one('SELECT * FROM perk_purchases WHERE id = $1 AND event_id = $2 FOR UPDATE', [purchaseId, eventId], t);
  if (!pp) throw notFound('Purchase not found.');
  if (['rejected', 'cancelled'].includes(pp.status)) throw conflict('This purchase is already closed.', 'invalid_state');
  if (pp.refunded && doRefund) throw conflict('Already refunded.', 'invalid_state');
  const perk = await one('SELECT * FROM perks WHERE id = $1', [pp.perk_id], t);
  await t.query(`UPDATE effects SET status = 'cancelled' WHERE purchase_id = $1 AND status = 'active'`, [purchaseId]);
  await t.query(`DELETE FROM intel_positions WHERE effect_id IN (SELECT id FROM effects WHERE purchase_id = $1)`, [purchaseId]);
  await t.query(`UPDATE perk_purchases SET status = 'cancelled', resolved_by = $2, reason = $3, updated_at = now() WHERE id = $1`, [purchaseId, actorId, reason]);
  await recomputeObjectiveEffects(t, eventId);
  if (doRefund) await refund(t, ctx, pp, perk, `Refund: ${reason}`, actorId);
  await activity(t, eventId, { type: 'perk_cancelled', message: `GM cancelled ${perk?.name ?? 'a perk'}${doRefund ? ' (refunded)' : ''}: ${reason}`, scope: 'team', teamId: pp.team_id });
  await notify(t, await eventPlayers(t, eventId, pp.team_id), {
    type: 'perk_expired',
    title: `${perk?.name ?? 'Perk'} cancelled by the GM`,
    body: doRefund ? `${pp.price} credits refunded.` : reason,
    eventId,
    url: `/events/${eventId}/live/store`,
  });
  t.afterCommit(() => {
    hub.invalidate(eventId, ['purchases', 'effects', 'objectives', 'perks']);
    hub.positionsDirty(eventId);
  });
}

/** Expire effects whose time is up (called by the tick). */
export async function expireEffects(t: Tx, eventId: string): Promise<number> {
  const expired = await many(
    `UPDATE effects SET status = 'expired' WHERE event_id = $1 AND status = 'active' AND expires_at <= now() RETURNING id, purchase_id, team_id, type`,
    [eventId],
    t,
  );
  if (!expired.length) return 0;
  const ids = expired.map((e) => e.id);
  await t.query('DELETE FROM intel_positions WHERE effect_id = ANY($1::uuid[])', [ids]);
  await t.query(`UPDATE perk_purchases SET status = 'expired', updated_at = now() WHERE id = ANY($1::uuid[]) AND status = 'active'`, [
    expired.map((e) => e.purchase_id).filter(Boolean),
  ]);
  await recomputeObjectiveEffects(t, eventId);
  for (const e of expired) {
    const perk = e.purchase_id ? await one<{ name: string }>('SELECT pk.name FROM perk_purchases pp JOIN perks pk ON pk.id = pp.perk_id WHERE pp.id = $1', [e.purchase_id], t) : null;
    await notify(t, await eventPlayers(t, eventId, e.team_id), {
      type: 'perk_expired',
      title: `${perk?.name ?? 'Perk'} expired`,
      eventId,
      url: `/events/${eventId}/live/store`,
      push: false,
    });
  }
  t.afterCommit(() => {
    hub.invalidate(eventId, ['purchases', 'effects', 'objectives']);
    hub.positionsDirty(eventId);
  });
  return expired.length;
}
