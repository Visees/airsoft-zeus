/**
 * Geofence capture state machine (pure). Persisted in capture_states as JSON.
 *
 * Progress only advances with SERVER time between consecutive fresh reports of the same
 * team (gaps longer than maxGapMs restart the clock), so replayed or queued samples and
 * clients that go silent cannot complete a capture.
 */
import { distanceM } from '../lib/geo.js';
import type { Geofence, Tracking } from './defaults.js';

export interface TeamProgress {
  /** seconds of hold accumulated */
  s: number;
  /** server time (ms) of the last accrual; null = paused */
  at: number | null;
  /** server time (ms) the team dropped out by going silent (no exit seen); see SILENCE_RESET */
  idle?: number;
}

export interface GeofenceState {
  progress: Record<string, TeamProgress>;
  /** teamId → userId → last server time inside (ms) */
  present: Record<string, Record<string, number>>;
  armed: Record<string, boolean>;
  contested: boolean;
  contestedSince: number | null;
}

export const emptyState = (): GeofenceState => ({ progress: {}, present: {}, armed: {}, contested: false, contestedSince: null });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fromRow(row: Record<string, any> | null | undefined): GeofenceState {
  if (!row) return emptyState();
  const p = (row.progress ?? {}) as { teams?: Record<string, TeamProgress>; contestedSince?: number | null };
  return {
    progress: p.teams ?? {},
    present: (row.present ?? {}) as Record<string, Record<string, number>>,
    armed: (row.armed ?? {}) as Record<string, boolean>,
    contested: !!row.contested,
    contestedSince: p.contestedSince ?? null,
  };
}

export function toRow(s: GeofenceState) {
  return {
    progress: { teams: s.progress, contestedSince: s.contestedSince },
    present: s.present,
    armed: s.armed,
    contested: s.contested,
  };
}

export interface Report {
  userId: string;
  teamId: string;
  inside: boolean;
}

export interface AdvanceInput {
  now: number;
  cfg: Geofence;
  /** Can this team accrue progress right now (objective capturable by the team via geofence)? */
  canAccrue: (teamId: string) => boolean;
  /** Presence entries older than this are dropped (player went silent). */
  presenceTtlMs: number;
  /** Max server-time gap between accruals that still counts. */
  maxGapMs: number;
  report?: Report;
}

export interface AdvanceResult {
  state: GeofenceState;
  /** Team that just completed the hold time. */
  completedBy: string | null;
  /** A contest just ended (for defense bonus), with its duration in ms. */
  contestEndedAfterMs: number | null;
  changed: boolean;
  multiplier: Record<string, number>;
  /** Majority rule: the team that alone has the most players inside (null otherwise). */
  leader: string | null;
}

/**
 * How far past the edge a player who is already counted may drift before leaving (hysteresis
 * against GPS jitter): the fix accuracy, kept within 5–10 m and never more than the radius.
 * Simulated against Gaussian noise: a larger cap keeps few more real holders under very poor GPS
 * but counts many more players standing 5–10 m outside.
 */
export function exitMarginM(radiusM: number, accuracyM: number): number {
  return Math.min(radiusM, Math.max(5, Math.min(accuracyM, 10)));
}

export interface ZoneFix {
  lat: number;
  lng: number;
  accuracy: number;
  /** device time (ms) */
  t: number;
}

/**
 * - inside / outside: report it
 * - confirming: one fix says inside, waiting for a second before the player counts
 * - hold: the fixes disagree or are too poor; leave the player as they are (no report)
 */
export type ZoneReading = 'inside' | 'outside' | 'confirming' | 'hold';

/** Fixes that vote on inside/outside. */
const VOTES = 3;

/**
 * Is the player in the zone, judged on their recent fixes rather than the newest one alone?
 * Phone fixes jump around (the reported accuracy is a ~68% radius, so a third of fixes land
 * outside their own circle), so:
 * - only fixes within this zone's max accuracy vote, and the newest fix must be one of them;
 * - the state changes only when 2 of the last 3 votes agree, so a single stray fix never brings a
 *   player in (or an enemy in to contest) and never throws one out;
 * - a counted player votes outside only past radius + exitMarginM (hysteresis).
 * There is deliberately no "far away = out at once" shortcut: multipath spikes of 20+ m with a
 * small reported accuracy happen, and a player who really runs off sends a fix every few metres
 * (minDistanceM), so two outside votes arrive quickly anyway.
 * It filters spikes, not slow drift (under trees the error stays similar for minutes): the zone
 * must still be large compared with the GPS error.
 */
export function readZone(
  fixes: ZoneFix[],
  center: { lat: number; lng: number },
  cfg: Pick<Geofence, 'radiusM' | 'maxAccuracyM'>,
  wasPresent: boolean,
  windowMs: number,
): ZoneReading {
  const newest = fixes[fixes.length - 1];
  if (!newest || newest.accuracy > cfg.maxAccuracyM) return 'hold';
  const votes = fixes.filter((f) => f.accuracy <= cfg.maxAccuracyM && newest.t - f.t <= windowMs).slice(-VOTES);
  const isIn = (f: ZoneFix) => distanceM(f, center) <= cfg.radiusM + (wasPresent ? exitMarginM(cfg.radiusM, f.accuracy) : 0);
  const ins = votes.filter(isIn).length;
  const outs = votes.length - ins;
  if (wasPresent) {
    if (outs >= 2) return 'outside';
    return ins > outs ? 'inside' : 'hold';
  }
  if (!isIn(newest)) return 'outside';
  return ins >= 2 && ins > outs ? 'inside' : 'confirming';
}

export function multiplierFor(cfg: Geofence, playersPresent: number): number {
  if (!cfg.multiPlayerBoost || playersPresent <= 1) return 1;
  return Math.min(cfg.maxMultiplier, 1 + cfg.boostPerExtraPlayer * (playersPresent - 1));
}

/**
 * Majority rule ("domination"): with several teams inside, the team with strictly more players
 * present holds the zone. Null when the rule is off, only one team is inside, or there is a tie.
 */
export function majorityLeader(present: GeofenceState['present'], cfg: Geofence): string | null {
  if (!cfg.contestable || cfg.contestRule !== 'majority') return null;
  const counts = Object.entries(present)
    .map(([team, users]) => [team, Object.keys(users).length] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (counts.length < 2) return null;
  return counts[0][1] > counts[1][1] ? counts[0][0] : null;
}

/**
 * How long a player stays counted without a report. Clients report every intervalSec (twice that
 * with battery saver); 3.5 intervals leaves room for a slow GPS fix plus a slow or failed request
 * (simulated with patchy-network latencies, 2.5 intervals dropped players standing still a few
 * times an hour).
 */
export function presenceTtlMs(tracking: Pick<Tracking, 'intervalSec' | 'batterySaver'>): number {
  const intervalMs = tracking.intervalSec * 1000 * (tracking.batterySaver ? 2 : 1);
  return Math.max(3.5 * intervalMs, 30_000);
}

/** The capture shown to everyone on the map: the team holding the zone now, else the one furthest along. */
export interface CaptureSummary {
  teamId: string;
  /** hold seconds at `now` */
  progressSec: number;
  requiredSec: number;
  /** hold seconds gained per second while it runs; 0 = paused */
  rate: number;
}

export function captureSummary(s: GeofenceState, cfg: Geofence, now: number): CaptureSummary | null {
  let best: CaptureSummary | null = null;
  for (const [teamId, entry] of Object.entries(s.progress)) {
    const present = s.present[teamId];
    const rate = entry.at !== null && present && !s.contested ? multiplierFor(cfg, Object.keys(present).length) : 0;
    const progressSec = Math.min(cfg.durationSec, entry.s + (rate && now > entry.at! ? ((now - entry.at!) / 1000) * rate : 0));
    if (progressSec <= 0 && !rate) continue;
    if (!best || (rate > 0 && best.rate === 0) || ((rate > 0) === (best.rate > 0) && progressSec > best.progressSec)) {
      best = { teamId, progressSec, requiredSec: cfg.durationSec, rate };
    }
  }
  return best;
}

/**
 * Must viewers refetch to see the capture right? Clients extrapolate a running capture, so only a
 * different team or rate, or a jump away from the extrapolation (lost hold time), counts.
 * Both summaries must be taken at the same `now`.
 */
export function captureChanged(a: CaptureSummary | null, b: CaptureSummary | null): boolean {
  if (!a || !b) return a !== b;
  return a.teamId !== b.teamId || a.rate !== b.rate || Math.abs(a.progressSec - b.progressSec) > 2;
}

/** A silent team's paused progress is kept this long (at least 2 presence TTLs) before "reset on exit" applies. */
const SILENCE_RESET_MS = 120_000;

export function advance(prev: GeofenceState, input: AdvanceInput): AdvanceResult {
  const { now, cfg, report } = input;
  const s: GeofenceState = structuredClone(prev);
  const before = JSON.stringify(prev);

  // 1. presence
  const exitSeenBy = report && !report.inside ? report.teamId : null;
  if (report) {
    const team = (s.present[report.teamId] ??= {});
    if (report.inside) team[report.userId] = now;
    else delete team[report.userId];
  }
  for (const [teamId, users] of Object.entries(s.present)) {
    for (const [uid, at] of Object.entries(users)) if (now - at > input.presenceTtlMs) delete users[uid];
    if (Object.keys(users).length === 0) delete s.present[teamId];
  }
  const teamsPresent = Object.keys(s.present);

  // 2. contest
  const multiplier: Record<string, number> = {};
  for (const t of teamsPresent) multiplier[t] = multiplierFor(cfg, Object.keys(s.present[t]).length);
  const wasContested = s.contested;
  const leader = majorityLeader(s.present, cfg);
  // Majority rule: only a tie contests the zone; otherwise any second team inside does.
  s.contested = cfg.contestable && teamsPresent.length >= 2 && leader === null;
  let contestEndedAfterMs: number | null = null;
  if (s.contested && !wasContested) {
    s.contestedSince = now;
    // credit the hold time up to the moment the contest started, then pause
    for (const [teamId, entry] of Object.entries(s.progress)) {
      if (entry.at !== null && now - entry.at <= input.maxGapMs && now > entry.at && s.present[teamId]) {
        entry.s += ((now - entry.at) / 1000) * (multiplier[teamId] ?? 1);
      }
      entry.at = null;
    }
  }
  if (!s.contested && wasContested) {
    contestEndedAfterMs = s.contestedSince ? now - s.contestedSince : 0;
    s.contestedSince = null;
  }

  // Majority rule: teams that are not (or no longer) the majority stop accruing; credit them up to now.
  if (leader) {
    for (const [teamId, entry] of Object.entries(s.progress)) {
      if (teamId === leader || entry.at === null) continue;
      if (now - entry.at <= input.maxGapMs && now > entry.at && s.present[teamId]) {
        entry.s += ((now - entry.at) / 1000) * (multiplier[teamId] ?? 1);
      }
      entry.at = null;
    }
  }

  // 3. teams that left the zone. "Reset on exit" applies when a player is seen leaving; a team that
  // only went silent (dead spot, late reports) is paused and resets after a longer silence.
  const silenceResetMs = Math.max(SILENCE_RESET_MS, 2 * input.presenceTtlMs);
  for (const [teamId, entry] of Object.entries(s.progress)) {
    if (s.present[teamId]) {
      delete entry.idle;
      continue;
    }
    entry.at = null;
    if (!cfg.resetOnExit) continue;
    entry.idle ??= now;
    if (teamId === exitSeenBy || now - entry.idle > silenceResetMs) delete s.progress[teamId];
  }

  // 4. accrual for the reporting team
  let completedBy: string | null = null;
  if (report?.inside && s.present[report.teamId]) {
    const t = report.teamId;
    const entry = (s.progress[t] ??= { s: 0, at: null });
    if (s.contested || !input.canAccrue(t) || (leader !== null && t !== leader)) {
      entry.at = null; // paused while contested, outnumbered or not capturable
      if (!input.canAccrue(t) && entry.s === 0) delete s.progress[t];
    } else {
      if (entry.at !== null && now - entry.at <= input.maxGapMs && now > entry.at) {
        entry.s += ((now - entry.at) / 1000) * (multiplier[t] ?? 1);
      }
      entry.at = now;
      if (entry.s >= cfg.durationSec) {
        completedBy = t;
        s.progress = {};
      }
    }
  }

  return { state: s, completedBy, contestEndedAfterMs, changed: JSON.stringify(s) !== before, multiplier, leader };
}
