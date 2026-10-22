/**
 * Geofence capture state machine (pure). Persisted in capture_states as JSON.
 *
 * Progress only advances with SERVER time between consecutive fresh reports of the same
 * team (gaps longer than maxGapMs restart the clock), so replayed or queued samples and
 * clients that go silent cannot complete a capture.
 */
import type { Geofence } from './defaults.js';

export interface TeamProgress {
  /** seconds of hold accumulated */
  s: number;
  /** server time (ms) of the last accrual; null = paused */
  at: number | null;
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
  /** Outside for sure (screen closed, far from the zone): skip the exit grace period. */
  firm?: boolean;
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
  /**
   * A non-firm outside report only removes a player who has not been inside for this long, so one
   * stray GPS fix doesn't throw them out (the time is credited when they report inside again).
   */
  exitGraceMs?: number;
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
 * against GPS jitter): the fix accuracy, kept within 5–15 m and never more than the radius.
 */
export function exitMarginM(radiusM: number, accuracyM: number): number {
  return Math.min(radiusM, Math.max(5, Math.min(accuracyM, 15)));
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

export function advance(prev: GeofenceState, input: AdvanceInput): AdvanceResult {
  const { now, cfg, report } = input;
  const s: GeofenceState = structuredClone(prev);
  const before = JSON.stringify(prev);

  // 1. presence
  if (report) {
    const team = (s.present[report.teamId] ??= {});
    const lastInside = team[report.userId];
    if (report.inside) team[report.userId] = now;
    else if (report.firm || lastInside === undefined || now - lastInside >= (input.exitGraceMs ?? 0)) delete team[report.userId];
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

  // 3. teams that left the zone
  for (const teamId of Object.keys(s.progress)) {
    if (!s.present[teamId]) {
      if (cfg.resetOnExit) delete s.progress[teamId];
      else s.progress[teamId].at = null;
    }
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
