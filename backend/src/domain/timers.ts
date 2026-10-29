import { many, one, tx, type Row, type Tx } from '../db.js';
import { badRequest, conflict, forbidden } from '../errors.js';
import { hub } from '../realtime/hub.js';
import type { EventContext, EventRow } from './context.js';
import { activity, alert, audit, eventPlayers, notify } from './journal.js';
import { tr, type Translate } from '../i18n/index.js';
import { clockLabel, gameClockMs, nextTimer, timerElapsedMs, type TimerAction, type TimerRow, type TimerState } from './timer-clock.js';

export * from './timer-clock.js';

/**
 * Objective timers: a countdown per team on objectives with a time limit (`objectives.timer_sec`).
 * The GM or one of the objective's referees (`objectives.referee_ids`) runs them. They count game
 * time, so a paused game freezes every timer without touching the rows.
 */

export interface ObjectiveTimerDto {
  teamId: string;
  state: TimerState;
  /** game time counted at `at` (server time) */
  elapsedMs: number;
  at: string;
  /** counting up right now: running and the game is live */
  ticking: boolean;
  startedAt: string;
}

export function timerDto(t: TimerRow, ev: EventRow, now: number): ObjectiveTimerDto {
  return {
    teamId: t.team_id,
    state: t.state,
    elapsedMs: timerElapsedMs(t, gameClockMs(ev, now)),
    at: new Date(now).toISOString(),
    ticking: t.state === 'running' && ev.status === 'live',
    startedAt: new Date(t.started_at).toISOString(),
  };
}

/** GM, or an approved member listed as a referee of the objective. */
export function canRunTimers(ctx: EventContext, o: { referee_ids?: string[] | null }): boolean {
  return ctx.isGm || (ctx.viewer.approved && (o.referee_ids ?? []).includes(ctx.viewer.userId));
}

function actionLabel(tr: Translate, action: TimerAction): string {
  const labels: Record<TimerAction, string> = {
    start: tr`started`,
    pause: tr`paused`,
    resume: tr`resumed`,
    stop: tr`stopped`,
    reset: tr`reset`,
  };
  return labels[action];
}

interface TimerObjective extends Row {
  id: string;
  name: string;
  timer_sec: number;
  referee_ids: string[];
  allowed_team_ids: string[];
}

/** Apply a GM/referee action to one team's timer (objective row locked by the caller's query). */
export async function runTimerAction(t: Tx, ctx: EventContext, objectiveId: string, teamId: string, action: TimerAction, actorId: string, now = Date.now()): Promise<void> {
  const eventId = ctx.event.id;
  const o = await one<TimerObjective>('SELECT id, name, timer_sec, referee_ids, allowed_team_ids FROM objectives WHERE id = $1 AND event_id = $2 FOR UPDATE', [objectiveId, eventId], t);
  if (!o || !canRunTimers(ctx, o)) throw forbidden(tr`Only the Game Masters and this objective's referees can run its timer.`, 'not_referee');
  if (o.timer_sec <= 0) throw conflict(tr`This objective has no time limit.`, 'no_timer');
  if (ctx.event.status !== 'live' && ctx.event.status !== 'paused') throw conflict(tr`The game is not running.`, 'not_live');
  const team = await one<{ name: string }>('SELECT name FROM teams WHERE id = $1 AND event_id = $2', [teamId, eventId], t);
  if (!team) throw badRequest(tr`Unknown team.`, 'invalid_argument', { teamId: tr`Unknown team` });
  if (o.allowed_team_ids.length && !o.allowed_team_ids.includes(teamId)) throw conflict(tr`This team cannot play this objective.`, 'team_not_allowed');

  const cur = await one<TimerRow>('SELECT * FROM objective_timers WHERE objective_id = $1 AND team_id = $2 FOR UPDATE', [o.id, teamId], t);
  const clock = gameClockMs(ctx.event, now);
  const next = nextTimer(cur, action, clock);
  if (typeof next === 'string') {
    const messages = {
      not_started: tr`The timer of this team has not started.`,
      already_started: tr`The timer of this team is already running. Stop or reset it first.`,
      not_running: tr`The timer of this team is not running.`,
      not_paused: tr`The timer of this team is not paused.`,
    };
    throw conflict(messages[next], `timer_${next}`);
  }
  if (next === null) {
    await t.query('DELETE FROM objective_timers WHERE objective_id = $1 AND team_id = $2', [o.id, teamId]);
  } else if (action === 'start') {
    await t.query(
      `INSERT INTO objective_timers (objective_id, team_id, event_id, state, elapsed_ms, run_game_ms, started_at, overrun_notified, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7 / 1000.0),false,$8)
       ON CONFLICT (objective_id, team_id) DO UPDATE SET state = EXCLUDED.state, elapsed_ms = EXCLUDED.elapsed_ms, run_game_ms = EXCLUDED.run_game_ms,
         started_at = EXCLUDED.started_at, overrun_notified = false, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [o.id, teamId, eventId, next.state, next.elapsedMs, next.runGameMs, now, actorId],
    );
  } else {
    await t.query(
      `UPDATE objective_timers SET state = $3, elapsed_ms = $4, run_game_ms = $5, updated_by = $6, updated_at = now() WHERE objective_id = $1 AND team_id = $2`,
      [o.id, teamId, next.state, next.elapsedMs, next.runGameMs, actorId],
    );
  }

  const limitMs = o.timer_sec * 1000;
  const limit = clockLabel(limitMs);
  const name = o.name;
  const teamName = team.name;
  if (action === 'start') {
    await activity(t, eventId, { type: 'objective_timer', message: (tr) => tr`Timer started on ${name}: ${limit} to complete it`, scope: 'team', teamId, objectiveId: o.id });
    await notify(t, await eventPlayers(t, eventId, teamId), {
      type: 'objective_timer',
      title: (tr) => tr`Timer started: ${name}`,
      body: (tr) => tr`Your team has ${limit} to complete the objective.`,
      priority: 'high',
      eventId,
      url: `/events/${eventId}/live/objectives/${o.id}`,
      data: { objectiveId: o.id },
    });
  } else if (action === 'stop' && next) {
    const used = clockLabel(next.elapsedMs);
    const over = next.elapsedMs > limitMs;
    const overBy = clockLabel(next.elapsedMs - limitMs);
    await activity(t, eventId, {
      type: 'objective_timer',
      message: (tr) => (over ? tr`Timer stopped on ${name}: ${used}, ${overBy} over the limit` : tr`Timer stopped on ${name}: ${used} of ${limit}`),
      scope: 'team',
      teamId,
      objectiveId: o.id,
      data: { elapsedMs: next.elapsedMs, limitMs },
    });
  }
  if (!ctx.isGm) {
    await activity(t, eventId, { type: 'objective_timer', message: (tr) => tr`Referee: ${name} — timer of ${teamName} ${actionLabel(tr, action)}`, scope: 'gm', teamId, objectiveId: o.id });
  }
  await audit(t, eventId, actorId, `objective.timer.${action}`, {
    type: 'objective',
    id: o.id,
    before: cur ? { teamId, state: cur.state, elapsedMs: timerElapsedMs(cur, clock) } : { teamId, state: null },
    after: next ? { teamId, state: next.state, elapsedMs: next.elapsedMs } : { teamId, state: null },
  });
  t.afterCommit(() => hub.invalidate(eventId, ['objectives']));
}

/** Engine tick: tell the team, the referees and the GMs once when a running timer passes its limit. */
export async function notifyTimerOverruns(ctx: EventContext, now: number): Promise<void> {
  const eventId = ctx.event.id;
  const rows = await many<TimerRow & { name: string; timer_sec: number; referee_ids: string[]; team_name: string }>(
    `SELECT ot.*, o.name, o.timer_sec, o.referee_ids, tm.name AS team_name
       FROM objective_timers ot JOIN objectives o ON o.id = ot.objective_id JOIN teams tm ON tm.id = ot.team_id
      WHERE ot.event_id = $1 AND ot.state = 'running' AND NOT ot.overrun_notified AND o.timer_sec > 0`,
    [eventId],
  );
  const clock = gameClockMs(ctx.event, now);
  for (const r of rows) {
    if (timerElapsedMs(r, clock) < r.timer_sec * 1000) continue;
    await tx(async (t) => {
      const marked = await t.query(
        `UPDATE objective_timers SET overrun_notified = true WHERE objective_id = $1 AND team_id = $2 AND state = 'running' AND NOT overrun_notified`,
        [r.objective_id, r.team_id],
      );
      if (!marked.rowCount) return;
      const name = r.name;
      const teamName = r.team_name;
      const limit = clockLabel(r.timer_sec * 1000);
      const url = `/events/${eventId}/live/objectives/${r.objective_id}`;
      await activity(t, eventId, { type: 'objective_timer', message: (tr) => tr`Objective failed: time is up on ${name} (${limit})`, scope: 'team', teamId: r.team_id, objectiveId: r.objective_id });
      await alert(t, eventId, {
        type: 'objective_timer',
        severity: 'warning',
        message: (tr) => tr`${teamName} failed ${name}: time is up (${limit})`,
        data: { objectiveId: r.objective_id, teamId: r.team_id },
      });
      await notify(t, await eventPlayers(t, eventId, r.team_id), {
        type: 'objective_timer',
        title: (tr) => tr`Objective failed: ${name}`,
        body: (tr) => tr`Your team used the ${limit} allowed. The timer keeps counting until a referee or the Game Master stops it.`,
        priority: 'high',
        eventId,
        url,
        data: { objectiveId: r.objective_id },
      });
      const referees = r.referee_ids.length
        ? (await many<{ user_id: string }>(`SELECT user_id FROM event_members WHERE event_id = $1 AND status = 'approved' AND user_id = ANY($2::uuid[])`, [eventId, r.referee_ids], t)).map((m) => m.user_id)
        : [];
      if (referees.length) {
        await notify(t, referees, {
          type: 'objective_timer',
          title: (tr) => tr`Objective failed: ${name}`,
          body: (tr) => tr`${teamName} used the ${limit} allowed. Stop the timer when they are done.`,
          priority: 'high',
          eventId,
          url,
          data: { objectiveId: r.objective_id, teamId: r.team_id },
        });
      }
      t.afterCommit(() => hub.invalidate(eventId, ['objectives']));
    });
  }
}
