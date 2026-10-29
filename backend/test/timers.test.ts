import { describe, expect, it } from 'vitest';
import { clockLabel, gameClockMs, nextTimer, timerElapsedMs } from '../src/domain/timer-clock.js';

const T0 = Date.parse('2026-10-29T10:00:00Z');
const live = { paused_at: null, ended_at: null, paused_total_ms: 0 };

describe('objective timers', () => {
  it('game clock stands still while paused and after the end', () => {
    expect(gameClockMs(live, T0)).toBe(T0);
    const paused = { paused_at: new Date(T0), ended_at: null, paused_total_ms: 5000 };
    expect(gameClockMs(paused, T0 + 60_000)).toBe(T0 - 5000);
    const ended = { paused_at: null, ended_at: new Date(T0), paused_total_ms: 0 };
    expect(gameClockMs(ended, T0 + 60_000)).toBe(T0);
  });

  it('a game pause does not count towards a running timer', () => {
    const run = nextTimer(null, 'start', gameClockMs(live, T0));
    if (!run || typeof run === 'string') throw new Error('should start');
    const row = { state: run.state, elapsed_ms: run.elapsedMs, run_game_ms: run.runGameMs };
    // 60 s live, then 30 s paused, then resumed (paused_total_ms 30 s) and 10 s live
    const duringPause = gameClockMs({ paused_at: new Date(T0 + 60_000), ended_at: null, paused_total_ms: 0 }, T0 + 90_000);
    expect(timerElapsedMs(row, duringPause)).toBe(60_000);
    const afterResume = gameClockMs({ paused_at: null, ended_at: null, paused_total_ms: 30_000 }, T0 + 100_000);
    expect(timerElapsedMs(row, afterResume)).toBe(70_000);
  });

  it('pause, resume and stop keep the counted time', () => {
    let row: { state: 'running' | 'paused' | 'stopped'; elapsed_ms: number; run_game_ms: number | null } | null = null;
    const step = (action: Parameters<typeof nextTimer>[1], at: number) => {
      const n = nextTimer(row, action, at);
      if (!n || typeof n === 'string') throw new Error(`${action}: ${String(n)}`);
      row = { state: n.state, elapsed_ms: n.elapsedMs, run_game_ms: n.runGameMs };
      return row;
    };
    step('start', 0);
    expect(step('pause', 20_000)).toEqual({ state: 'paused', elapsed_ms: 20_000, run_game_ms: null });
    expect(timerElapsedMs(row!, 50_000)).toBe(20_000);
    step('resume', 50_000);
    expect(timerElapsedMs(row!, 55_000)).toBe(25_000);
    expect(step('stop', 60_000)).toEqual({ state: 'stopped', elapsed_ms: 30_000, run_game_ms: null });
    // a stopped timer can start again from zero
    expect(step('start', 70_000)).toEqual({ state: 'running', elapsed_ms: 0, run_game_ms: 70_000 });
  });

  it('refuses actions that do not apply', () => {
    expect(nextTimer(null, 'pause', 0)).toBe('not_started');
    expect(nextTimer({ state: 'running', elapsed_ms: 0, run_game_ms: 0 }, 'start', 0)).toBe('already_started');
    expect(nextTimer({ state: 'paused', elapsed_ms: 0, run_game_ms: null }, 'pause', 0)).toBe('not_running');
    expect(nextTimer({ state: 'running', elapsed_ms: 0, run_game_ms: 0 }, 'resume', 0)).toBe('not_paused');
    expect(nextTimer({ state: 'stopped', elapsed_ms: 0, run_game_ms: null }, 'stop', 0)).toBe('not_running');
    expect(nextTimer({ state: 'running', elapsed_ms: 0, run_game_ms: 0 }, 'reset', 0)).toBeNull();
  });

  it('formats clock labels', () => {
    expect(clockLabel(0)).toBe('0:00');
    expect(clockLabel(605_000)).toBe('10:05');
    expect(clockLabel(3_725_000)).toBe('1:02:05');
  });
});
