import type { Row } from '../db.js';
import type { EventRow } from './context.js';

/** Pure parts of the objective timers (see timers.ts): game clock, counted time, state changes. */

export type TimerState = 'running' | 'paused' | 'stopped';
export type TimerAction = 'start' | 'pause' | 'resume' | 'stop' | 'reset';

export interface TimerRow extends Row {
  objective_id: string;
  team_id: string;
  event_id: string;
  state: TimerState;
  elapsed_ms: number | string;
  run_game_ms: number | string | null;
  started_at: Date;
  overrun_notified: boolean;
}

/** Game clock in ms: wall time minus every pause; stands still while paused and after the end. */
export function gameClockMs(ev: Pick<EventRow, 'paused_at' | 'ended_at' | 'paused_total_ms'>, now: number): number {
  const frozenAt = ev.ended_at ? new Date(ev.ended_at).getTime() : ev.paused_at ? new Date(ev.paused_at).getTime() : now;
  return Math.min(frozenAt, now) - Number(ev.paused_total_ms ?? 0);
}

export function timerElapsedMs(t: Pick<TimerRow, 'state' | 'elapsed_ms' | 'run_game_ms'>, clock: number): number {
  const base = Number(t.elapsed_ms);
  return t.state === 'running' && t.run_game_ms !== null ? base + Math.max(0, clock - Number(t.run_game_ms)) : base;
}

export interface TimerChange {
  state: TimerState;
  elapsedMs: number;
  runGameMs: number | null;
}

/** Next state of a team's timer, or the reason the action does not apply (null = delete the row). */
export function nextTimer(cur: Pick<TimerRow, 'state' | 'elapsed_ms' | 'run_game_ms'> | null, action: TimerAction, clock: number): TimerChange | null | 'not_started' | 'already_started' | 'not_running' | 'not_paused' {
  if (action === 'reset') return null;
  if (action === 'start') {
    if (cur && cur.state !== 'stopped') return 'already_started';
    return { state: 'running', elapsedMs: 0, runGameMs: clock };
  }
  if (!cur) return 'not_started';
  const elapsedMs = timerElapsedMs(cur, clock);
  switch (action) {
    case 'pause':
      return cur.state === 'running' ? { state: 'paused', elapsedMs, runGameMs: null } : 'not_running';
    case 'resume':
      return cur.state === 'paused' ? { state: 'running', elapsedMs, runGameMs: clock } : 'not_paused';
    case 'stop':
      return cur.state === 'stopped' ? 'not_running' : { state: 'stopped', elapsedMs, runGameMs: null };
  }
}

/** m:ss (or h:mm:ss) for messages. */
export function clockLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
