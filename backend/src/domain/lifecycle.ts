import { many, one, type Tx } from '../db.js';
import { conflict, precondition } from '../errors.js';
import { hub } from '../realtime/hub.js';
import type { EventContext } from './context.js';
import { activity, audit, eventGms, eventPlayers, notify } from './journal.js';
import { applyLedger } from './ledger.js';
import { settleRecurring, type ObjRow } from './objectives.js';
import type { EventStatus } from './rules.js';
import * as dto from './serialize.js';

export const TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  draft: ['published', 'registration_open', 'cancelled'],
  published: ['registration_open', 'lobby', 'draft', 'cancelled'],
  registration_open: ['lobby', 'published', 'cancelled'],
  lobby: ['live', 'registration_open', 'cancelled'],
  live: ['paused', 'completed'],
  paused: ['live', 'completed'],
  completed: [],
  cancelled: ['draft'],
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Change the event status with all side effects, inside `t` (event row locked by caller).
 * Returns the new status.
 */
export async function transition(t: Tx, ctx: EventContext, to: EventStatus, actorId: string | null, reason: string | null): Promise<EventStatus> {
  const ev = ctx.event;
  const from = ev.status;
  if (from === to) return to;
  if (!canTransition(from, to)) throw conflict(`An event cannot go from ${from.replace('_', ' ')} to ${to.replace('_', ' ')}.`, 'invalid_transition');
  const now = Date.now();
  const eventId = ev.id;

  if (to === 'live' && from === 'lobby') {
    const teams = await many<{ id: string }>('SELECT id FROM teams WHERE event_id = $1', [eventId], t);
    if (teams.length < 2) throw precondition('Create at least two teams before starting the game.', 'not_enough_teams');
    const durationMs = new Date(ev.end_at).getTime() - new Date(ev.start_at).getTime();
    const firstStart = !ev.started_at;
    await t.query(
      `UPDATE events SET status = 'live', started_at = COALESCE(started_at, now()), paused_at = NULL,
              ends_at = COALESCE(ends_at, now() + make_interval(secs => $2)), updated_at = now() WHERE id = $1`,
      [eventId, Math.max(60, Math.round(durationMs / 1000))],
    );
    if (firstStart) {
      const already = await one('SELECT 1 FROM ledger_entries WHERE event_id = $1 AND type = $2 LIMIT 1', [eventId, 'starting_balance'], t);
      if (!already) {
        for (const team of teams) {
          if (ctx.scoring.startingPoints)
            await applyLedger(t, { eventId, teamId: team.id, kind: 'points', type: 'starting_balance', amount: ctx.scoring.startingPoints, scoring: ctx.scoring, reason: 'Starting points' });
          if (ctx.scoring.startingCurrency)
            await applyLedger(t, { eventId, teamId: team.id, kind: 'currency', type: 'starting_balance', amount: ctx.scoring.startingCurrency, scoring: ctx.scoring, reason: 'Starting credits' });
        }
      }
      await t.query('UPDATE objectives SET recurring_last_at = now() WHERE event_id = $1 AND owner_team_id IS NOT NULL', [eventId]);
    }
    await activity(t, eventId, { type: 'game_started', message: 'The game has started', scope: 'all' });
    await notify(t, await eventPlayers(t, eventId), {
      type: 'game_started',
      title: `${ev.name} has started`,
      body: 'Open the live map.',
      priority: 'high',
      eventId,
      url: `/events/${eventId}/live`,
    });
  } else if (to === 'paused') {
    // settle held-objective rewards up to the pause
    const owned = await many<ObjRow>('SELECT * FROM objectives WHERE event_id = $1 AND owner_team_id IS NOT NULL FOR UPDATE', [eventId], t);
    for (const o of owned) await settleRecurring(t, ctx, o, now);
    await t.query(`UPDATE events SET status = 'paused', paused_at = now(), updated_at = now() WHERE id = $1`, [eventId]);
    await activity(t, eventId, { type: 'game_paused', message: `Game paused${reason ? `: ${reason}` : ''}`, scope: 'all' });
    await notify(t, await eventPlayers(t, eventId), {
      type: 'game_paused',
      title: 'Game paused',
      body: reason ?? 'Wait for the Game Master.',
      priority: 'high',
      eventId,
      url: `/events/${eventId}/live`,
    });
  } else if (to === 'live' && from === 'paused') {
    // The clock stops while paused: extend the end time by the pause length.
    await t.query(
      `UPDATE events SET status = 'live',
              paused_total_ms = paused_total_ms + GREATEST(0, (extract(epoch FROM now() - paused_at) * 1000)::bigint),
              ends_at = ends_at + (now() - paused_at), paused_at = NULL, updated_at = now() WHERE id = $1`,
      [eventId],
    );
    await t.query('UPDATE objectives SET recurring_last_at = now() WHERE event_id = $1 AND owner_team_id IS NOT NULL', [eventId]);
    // Effects keep their wall-clock expiry; geofence progress restarts.
    await t.query(`UPDATE capture_states SET progress = '{}', present = '{}', contested = false WHERE event_id = $1`, [eventId]);
    await activity(t, eventId, { type: 'game_resumed', message: 'Game resumed', scope: 'all' });
    await notify(t, await eventPlayers(t, eventId), { type: 'game_resumed', title: 'Game resumed', priority: 'high', eventId, url: `/events/${eventId}/live` });
  } else if (to === 'completed') {
    await completeGame(t, ctx, now);
  } else if (to === 'cancelled') {
    await t.query(`UPDATE events SET status = 'cancelled', updated_at = now() WHERE id = $1`, [eventId]);
    await notify(t, await eventPlayers(t, eventId), {
      type: 'announcement',
      title: `${ev.name} was cancelled`,
      body: reason ?? '',
      priority: 'high',
      eventId,
      url: `/events/${eventId}`,
    });
  } else {
    await t.query('UPDATE events SET status = $2, updated_at = now() WHERE id = $1', [eventId, to]);
    if (to === 'lobby') {
      await notify(t, await eventPlayers(t, eventId), {
        type: 'event_starting_soon',
        title: `${ev.name}: lobby is open`,
        body: 'Check the rules, enable location and mark yourself ready.',
        eventId,
        url: `/events/${eventId}/lobby`,
      });
    }
  }

  await audit(t, eventId, actorId, 'event.status', { type: 'event', id: eventId, before: { status: from }, after: { status: to }, reason });
  t.afterCommit(async () => {
    const fresh = await one('SELECT * FROM events WHERE id = $1', [eventId]);
    if (fresh) hub.emit(eventId, 'clock', { eventId, clock: dto.clock(fresh) });
    hub.invalidate(eventId, ['event', 'objectives', 'perks']);
    hub.teams(eventId);
    hub.positionsDirty(eventId);
  });
  return to;
}

async function completeGame(t: Tx, ctx: EventContext, now: number): Promise<void> {
  const eventId = ctx.event.id;
  const owned = await many<ObjRow>('SELECT * FROM objectives WHERE event_id = $1 AND owner_team_id IS NOT NULL FOR UPDATE', [eventId], t);
  if (ctx.event.status === 'live') for (const o of owned) await settleRecurring(t, ctx, o, now);

  await t.query(
    `UPDATE events SET status = 'completed', ended_at = now(),
            paused_total_ms = paused_total_ms + CASE WHEN paused_at IS NOT NULL THEN GREATEST(0, (extract(epoch FROM now() - paused_at) * 1000)::bigint) ELSE 0 END,
            paused_at = NULL, updated_at = now() WHERE id = $1`,
    [eventId],
  );
  await t.query(`UPDATE effects SET status = 'expired' WHERE event_id = $1 AND status = 'active'`, [eventId]);
  await t.query(`UPDATE perk_purchases SET status = 'expired' WHERE event_id = $1 AND status = 'active'`, [eventId]);
  await t.query(`DELETE FROM intel_positions WHERE event_id = $1`, [eventId]);
  await t.query(`UPDATE event_members SET tracking_active = false WHERE event_id = $1`, [eventId]);

  // Winner
  const teams = await many<{ id: string; name: string; points: number; held: number }>(
    `SELECT t.id, t.name, t.points, (SELECT count(*)::int FROM objectives o WHERE o.owner_team_id = t.id) AS held FROM teams t WHERE t.event_id = $1`,
    [eventId],
    t,
  );
  const key = (x: { points: number; held: number }) => (ctx.scoring.winCondition === 'objectives' ? x.held * 1e9 + Number(x.points) : Number(x.points));
  const sorted = [...teams].sort((a, b) => key(b) - key(a));
  const isDraw = sorted.length > 1 && key(sorted[0]) === key(sorted[1]);
  const winner = !isDraw && sorted[0] ? sorted[0] : null;
  await t.query('UPDATE events SET winner_team_id = $2 WHERE id = $1', [eventId, winner?.id ?? null]);

  // Player stats and badges
  const members = await many<{ user_id: string; team_id: string | null; points: number; captures: number }>(
    `SELECT user_id, team_id, points, captures FROM event_members WHERE event_id = $1 AND status = 'approved' AND role = 'player' AND team_id IS NOT NULL`,
    [eventId],
    t,
  );
  const mvp = [...members].sort((a, b) => Number(b.points) - Number(a.points))[0];
  for (const m of members) {
    const result = isDraw ? 'draws' : m.team_id === winner?.id ? 'wins' : 'losses';
    const u = await one<{ stats: Record<string, number> }>(
      `UPDATE users SET stats = jsonb_set(jsonb_set(jsonb_set(jsonb_set(stats,
            '{gamesPlayed}', to_jsonb(COALESCE((stats->>'gamesPlayed')::int, 0) + 1)),
            '{objectivesCaptured}', to_jsonb(COALESCE((stats->>'objectivesCaptured')::int, 0) + $2)),
            '{totalPoints}', to_jsonb(COALESCE((stats->>'totalPoints')::bigint, 0) + $3)),
            ARRAY[$4::text], to_jsonb(COALESCE((stats->>$4)::int, 0) + 1)), updated_at = now()
        WHERE id = $1 RETURNING stats`,
      [m.user_id, m.captures, Number(m.points), result],
      t,
    );
    const s = u?.stats ?? {};
    const badges = ['first_game'];
    if ((s.objectivesCaptured ?? 0) >= 1) badges.push('first_capture');
    if ((s.objectivesCaptured ?? 0) >= 10) badges.push('ten_captures');
    if ((s.objectivesCaptured ?? 0) >= 50) badges.push('fifty_captures');
    if ((s.gamesPlayed ?? 0) >= 10) badges.push('veteran');
    if (result === 'wins') badges.push('winner');
    if (mvp && mvp.user_id === m.user_id && Number(mvp.points) > 0) badges.push('mvp');
    for (const code of badges) {
      await t.query('INSERT INTO user_badges (user_id, code, event_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [m.user_id, code, eventId]);
    }
  }
  for (const gm of await eventGms(t, eventId)) {
    await t.query(`INSERT INTO user_badges (user_id, code, event_id) VALUES ($1,'game_master',$2) ON CONFLICT DO NOTHING`, [gm, eventId]);
  }

  await activity(t, eventId, {
    type: 'game_ended',
    message: winner ? `Game over — ${winner.name} wins` : 'Game over — draw',
    scope: 'all',
    teamId: winner?.id ?? null,
  });
  await notify(t, await eventPlayers(t, eventId), {
    type: 'game_ended',
    title: winner ? `${winner.name} wins` : 'Game over: draw',
    body: 'See the final results.',
    priority: 'high',
    eventId,
    url: `/events/${eventId}/results`,
  });
}

/** Add minutes to the end time of a running game. */
export async function extend(t: Tx, ctx: EventContext, minutes: number, actorId: string): Promise<void> {
  if (!['live', 'paused', 'lobby'].includes(ctx.event.status)) throw conflict('Only a running game can be extended.', 'invalid_state');
  await t.query(
    `UPDATE events SET ends_at = COALESCE(ends_at, now()) + make_interval(mins => $2), end_at = end_at + make_interval(mins => $2), updated_at = now() WHERE id = $1`,
    [ctx.event.id, minutes],
  );
  await audit(t, ctx.event.id, actorId, 'event.extend', { type: 'event', id: ctx.event.id, after: { minutes } });
  await activity(t, ctx.event.id, { type: 'game_extended', message: `Game time extended by ${minutes} min`, scope: 'all' });
  t.afterCommit(async () => {
    const fresh = await one('SELECT * FROM events WHERE id = $1', [ctx.event.id]);
    if (fresh) hub.emit(ctx.event.id, 'clock', { eventId: ctx.event.id, clock: dto.clock(fresh) });
  });
}
