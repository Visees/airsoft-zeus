/**
 * Pure game rules: objective status, capture eligibility, visibility, position projection.
 * No I/O here, so every rule is unit-tested (test/rules.test.ts). The routes and the
 * realtime broadcaster only ever send data that passed through these functions.
 */
import { approximate, snapToGrid } from '../lib/geo.js';
import type { Precision, Tracking, VisibilityRules } from './defaults.js';

export type EventStatus = 'draft' | 'published' | 'registration_open' | 'lobby' | 'live' | 'paused' | 'completed' | 'cancelled';
export type ObjectiveStatus = 'inactive' | 'active' | 'locked' | 'contested' | 'captured' | 'disabled' | 'completed';
export type CaptureBlockReason =
  | 'not_live'
  | 'no_team'
  | 'disabled'
  | 'completed'
  | 'locked'
  | 'inactive'
  | 'contested'
  | 'already_owned'
  | 'team_not_allowed'
  | 'cooldown'
  | 'jammed'
  | 'shielded'
  | 'geofence_required';

export interface Viewer {
  userId: string;
  isGm: boolean;
  approved: boolean;
  teamId: string | null;
  squadId: string | null;
  isSquadLeader: boolean;
  playerRole: string;
  allianceId: string | null;
}

export interface EventLike {
  status: EventStatus;
  phase: string | null;
  rules: VisibilityRules;
}

export interface ObjectiveRow {
  id: string;
  enabled: boolean;
  disabled_by_gm: boolean;
  max_captures: number;
  capture_count: number;
  prerequisite_ids: string[];
  availability_start: Date | null;
  availability_end: Date | null;
  contested: boolean;
  contested_by_gm: boolean;
  owner_team_id: string | null;
  allowed_team_ids: string[];
  cooldown_sec: number;
  last_captured_at: Date | null;
  jammed_for: Record<string, number>;
  shielded_until: Date | null;
  shielded_team_id: string | null;
  methods: string[];
  require_geofence: boolean;
  visibility: { mode: 'all' | 'teams' | 'after_prerequisites' | 'gm_only'; teamIds?: string[] };
}

/** Status precedence: disabled > completed > locked > inactive > contested > captured > active. */
export function objectiveStatus(o: ObjectiveRow, prereqsSatisfied: boolean, now: number): ObjectiveStatus {
  if (!o.enabled || o.disabled_by_gm) return 'disabled';
  if (o.max_captures > 0 && o.capture_count >= o.max_captures) return 'completed';
  if (o.prerequisite_ids.length > 0 && !prereqsSatisfied) return 'locked';
  if ((o.availability_start && o.availability_start.getTime() > now) || (o.availability_end && o.availability_end.getTime() <= now)) return 'inactive';
  if (o.contested || o.contested_by_gm) return 'contested';
  if (o.owner_team_id) return 'captured';
  return 'active';
}

/** Prerequisites are satisfied once each of them has been captured at least once. */
export function prereqsSatisfied(o: Pick<ObjectiveRow, 'prerequisite_ids'>, captureCounts: Map<string, number>): boolean {
  return o.prerequisite_ids.every((id) => (captureCounts.get(id) ?? 0) > 0);
}

export function cooldownUntil(o: Pick<ObjectiveRow, 'cooldown_sec' | 'last_captured_at'>): number | null {
  if (!o.cooldown_sec || !o.last_captured_at) return null;
  return o.last_captured_at.getTime() + o.cooldown_sec * 1000;
}

/**
 * Why `teamId` cannot capture now (null = it can).
 * `method` 'geofence' ignores the requireGeofence check; zone contests block only geofence captures,
 * a GM-marked contest blocks all methods.
 */
export function captureBlock(
  o: ObjectiveRow,
  status: ObjectiveStatus,
  eventStatus: EventStatus,
  teamId: string | null,
  now: number,
  method: 'code' | 'qr' | 'geofence' | 'any',
  armed: Record<string, boolean> = {},
): CaptureBlockReason | null {
  if (eventStatus !== 'live') return 'not_live';
  if (!teamId) return 'no_team';
  if (status === 'disabled') return 'disabled';
  if (status === 'completed') return 'completed';
  if (status === 'locked') return 'locked';
  if (status === 'inactive') return 'inactive';
  if (o.contested_by_gm) return 'contested';
  if (method === 'geofence' && o.contested) return 'contested';
  if (o.owner_team_id === teamId) return 'already_owned';
  if (o.allowed_team_ids.length > 0 && !o.allowed_team_ids.includes(teamId)) return 'team_not_allowed';
  const cd = cooldownUntil(o);
  if (cd !== null && cd > now) return 'cooldown';
  const jam = o.jammed_for?.[teamId];
  if (jam && jam > now) return 'jammed';
  if (o.shielded_until && o.shielded_until.getTime() > now && o.shielded_team_id !== teamId) return 'shielded';
  const codeLike = method === 'code' || method === 'qr' || (method === 'any' && (o.methods.includes('code') || o.methods.includes('qr')));
  if (codeLike && o.require_geofence && !armed[teamId]) return 'geofence_required';
  return null;
}

export function objectiveVisible(o: ObjectiveRow, status: ObjectiveStatus, viewer: Viewer, ev: EventLike): boolean {
  if (viewer.isGm) return true;
  if (!viewer.approved) return false;
  const started = ev.status === 'live' || ev.status === 'paused' || ev.status === 'completed';
  if (!started && !ev.rules.revealObjectivesBeforeStart) return false;
  const vis = o.visibility ?? { mode: 'all' };
  switch (vis.mode) {
    case 'gm_only':
      return false;
    case 'teams':
      if (!viewer.teamId || !(vis.teamIds ?? []).includes(viewer.teamId)) return false;
      break;
    case 'after_prerequisites':
      if (status === 'locked') return false;
      break;
  }
  if (o.owner_team_id && (status === 'captured' || status === 'completed' || status === 'contested')) {
    if (ev.rules.capturedObjectives === 'hidden') return false;
    if (ev.rules.capturedObjectives === 'owner_only' && o.owner_team_id !== viewer.teamId) return false;
  }
  return true;
}

export interface ContentVisibility {
  mode?: 'all' | 'teams' | 'gm_only';
  teamIds?: string[];
  squadIds?: string[];
  roles?: string[];
  phases?: string[];
  activeFrom?: string | null;
  activeUntil?: string | null;
}

/** POIs and zones. `ownerTeamId` marks team bases (hidden from enemies unless showEnemyBases). */
export function contentVisible(
  vis: ContentVisibility | null | undefined,
  viewer: Viewer,
  ev: EventLike,
  now: number,
  ownerTeamId: string | null,
  isBase: boolean,
  teamAlliance: (teamId: string) => string | null,
): boolean {
  if (viewer.isGm) return true;
  if (!viewer.approved) return false;
  const v = vis ?? {};
  if (v.mode === 'gm_only') return false;
  if (v.mode === 'teams' && (!viewer.teamId || !(v.teamIds ?? []).includes(viewer.teamId))) return false;
  if (v.squadIds?.length && (!viewer.squadId || !v.squadIds.includes(viewer.squadId))) return false;
  if (v.roles?.length && !v.roles.includes(viewer.playerRole)) return false;
  if (v.phases?.length && !v.phases.includes(ev.status) && !(ev.phase && v.phases.includes(ev.phase))) return false;
  if (v.activeFrom && Date.parse(v.activeFrom) > now) return false;
  if (v.activeUntil && Date.parse(v.activeUntil) <= now) return false;
  if (isBase && ownerTeamId && !isFriendly(viewer, ownerTeamId, teamAlliance) && !ev.rules.showEnemyBases) return false;
  return true;
}

export function isFriendly(viewer: Pick<Viewer, 'teamId' | 'allianceId'>, teamId: string, teamAlliance: (teamId: string) => string | null): boolean {
  if (!viewer.teamId) return false;
  if (viewer.teamId === teamId) return true;
  const a = teamAlliance(teamId);
  return !!a && a === viewer.allianceId;
}

export function scopedVisible(scope: 'all' | 'team' | 'player' | 'gm', teamId: string | null, targetUserId: string | null, viewer: Viewer): boolean {
  if (viewer.isGm) return true;
  if (!viewer.approved) return false;
  if (scope === 'all') return true;
  if (scope === 'team') return !!teamId && teamId === viewer.teamId;
  if (scope === 'player') return targetUserId === viewer.userId;
  return false;
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export interface Sample {
  lat: number;
  lng: number;
  accuracy: number;
  t: number; // device time ms (validated)
}

export interface PosMember {
  userId: string;
  nickname: string;
  teamId: string | null;
  squadId: string | null;
  isSquadLeader: boolean;
  playerRole: string;
  trackingActive: boolean;
}

export interface PosLocation {
  userId: string;
  lat: number;
  lng: number;
  accuracy: number;
  sampleAt: number;
  receivedAt: number;
  ring: Sample[];
  suspiciousCount: number;
  lastFlagAt: number | null;
}

export interface IntelRow {
  userId: string;
  viewerTeamId: string;
  lat: number;
  lng: number;
  radiusM: number | null;
  precision: Precision;
  sampleAt: number;
  writtenAt: number;
  expiresAt: number;
}

export interface VisiblePosition {
  userId: string;
  nickname: string | null;
  teamId: string | null;
  squadId: string | null;
  playerRole: string | null;
  kind: 'self' | 'ally' | 'enemy' | 'intel';
  precision: Precision;
  lat: number;
  lng: number;
  accuracyM: number | null;
  radiusM: number | null;
  sampleAt: string;
  receivedAt: string;
  status: 'online' | 'stale' | 'offline';
  flags?: string[];
  suspicious?: boolean;
}

export interface ProjectionInput {
  rules: VisibilityRules;
  tracking: Tracking;
  members: Map<string, PosMember>;
  teamAlliance: (teamId: string) => string | null;
  locations: PosLocation[];
  intel: IntelRow[];
  now: number;
}

/** Apply a precision level to a location. Returns null when no sample qualifies (delayed). */
export function degrade(
  loc: PosLocation,
  precision: Precision,
  rules: Pick<VisibilityRules, 'approxRadiusM' | 'delaySec'>,
  now: number,
): { lat: number; lng: number; accuracyM: number | null; radiusM: number | null; sampleAt: number } | null {
  switch (precision) {
    case 'exact':
      return { lat: loc.lat, lng: loc.lng, accuracyM: loc.accuracy, radiusM: null, sampleAt: loc.sampleAt };
    case 'approximate': {
      // New offset every 2 minutes so the circle doesn't drift with every update.
      const p = approximate(loc, rules.approxRadiusM, `${loc.userId}:${Math.floor(now / 120_000)}`);
      return { ...p, accuracyM: null, radiusM: rules.approxRadiusM, sampleAt: loc.sampleAt };
    }
    case 'area': {
      const p = snapToGrid(loc, rules.approxRadiusM);
      return { ...p, accuracyM: null, radiusM: Math.round(rules.approxRadiusM * Math.SQRT2), sampleAt: loc.sampleAt };
    }
    case 'delayed': {
      const cutoff = now - rules.delaySec * 1000;
      let best: Sample | null = null;
      for (const s of loc.ring) if (s.t <= cutoff && (!best || s.t > best.t)) best = s;
      if (!best) return null;
      return { lat: best.lat, lng: best.lng, accuracyM: best.accuracy, radiusM: null, sampleAt: best.t };
    }
  }
}

function positionStatus(receivedAt: number, now: number, t: Tracking): 'online' | 'stale' | 'offline' {
  const age = (now - receivedAt) / 1000;
  if (age <= t.staleAfterSec) return 'online';
  if (age <= t.hideAfterSec) return 'stale';
  return 'offline';
}

/** Can `viewer` see the given ally (same side) member? */
export function canSeeAlly(viewer: Viewer, m: PosMember, rules: VisibilityRules, teamAlliance: (teamId: string) => string | null): boolean {
  if (!viewer.teamId || !m.teamId) return false;
  const sameTeam = m.teamId === viewer.teamId;
  const sameSquad = sameTeam && !!viewer.squadId && m.squadId === viewer.squadId;
  const leaderSees = rules.squadLeadersSeeSquad && viewer.isSquadLeader && sameSquad;
  switch (rules.allies) {
    case 'none':
      return leaderSees;
    case 'squad':
      return sameSquad || leaderSees;
    case 'team':
      return sameTeam;
    case 'alliance':
      return sameTeam || (!!viewer.allianceId && teamAlliance(m.teamId) === viewer.allianceId);
  }
}

/**
 * Everything `viewer` may see on the map, already degraded. This is the only path by
 * which positions leave the server.
 */
export function projectPositions(viewer: Viewer, input: ProjectionInput): VisiblePosition[] {
  const { rules, tracking, members, teamAlliance, now } = input;
  const out: VisiblePosition[] = [];
  const iso = (ms: number) => new Date(ms).toISOString();

  for (const loc of input.locations) {
    const m = members.get(loc.userId);
    if (!m) continue;
    const status = positionStatus(loc.receivedAt, now, tracking);

    if (viewer.isGm) {
      out.push({
        userId: m.userId,
        nickname: m.nickname,
        teamId: m.teamId,
        squadId: m.squadId,
        playerRole: m.playerRole,
        kind: 'ally',
        precision: 'exact',
        lat: loc.lat,
        lng: loc.lng,
        accuracyM: loc.accuracy,
        radiusM: null,
        sampleAt: iso(loc.sampleAt),
        receivedAt: iso(loc.receivedAt),
        status: m.trackingActive ? status : 'offline',
        flags: loc.lastFlagAt && now - loc.lastFlagAt < 15 * 60_000 ? ['recent_flag'] : [],
        suspicious: loc.suspiciousCount > 0,
      });
      continue;
    }
    if (!viewer.approved || !viewer.teamId) {
      if (loc.userId !== viewer.userId) continue;
    }
    if (!m.trackingActive) continue;
    if (status === 'offline') continue;
    if (status === 'stale' && !tracking.showLastKnown) continue;

    if (loc.userId === viewer.userId) {
      out.push({
        userId: m.userId,
        nickname: m.nickname,
        teamId: m.teamId,
        squadId: m.squadId,
        playerRole: m.playerRole,
        kind: 'self',
        precision: 'exact',
        lat: loc.lat,
        lng: loc.lng,
        accuracyM: loc.accuracy,
        radiusM: null,
        sampleAt: iso(loc.sampleAt),
        receivedAt: iso(loc.receivedAt),
        status,
      });
      continue;
    }
    if (!m.teamId) continue;

    const friendly = isFriendly(viewer, m.teamId, teamAlliance);
    let kind: 'ally' | 'enemy' | null = null;
    let precision: Precision = 'exact';
    if (friendly) {
      if (canSeeAlly(viewer, m, rules, teamAlliance)) {
        kind = 'ally';
        precision = rules.allyPrecision;
      }
    } else if (rules.enemies === 'always') {
      kind = 'enemy';
      precision = rules.enemyPrecision;
    }
    if (!kind) continue;
    const d = degrade(loc, precision, rules, now);
    if (!d) continue;
    out.push({
      userId: m.userId,
      nickname: rules.showNicknames ? m.nickname : null,
      teamId: m.teamId,
      squadId: kind === 'ally' ? m.squadId : null,
      playerRole: rules.showRoles ? m.playerRole : null,
      kind,
      precision,
      lat: d.lat,
      lng: d.lng,
      accuracyM: d.accuracyM,
      radiusM: d.radiusM,
      sampleAt: iso(d.sampleAt),
      receivedAt: iso(loc.receivedAt),
      status,
    });
  }

  // UAV / recon intel: snapshots taken while the effect was active, for the viewer's team only.
  if (!viewer.isGm && viewer.approved && viewer.teamId && rules.enemies !== 'never') {
    const shown = new Set(out.filter((p) => p.kind === 'enemy').map((p) => p.userId));
    for (const i of input.intel) {
      if (i.viewerTeamId !== viewer.teamId || i.expiresAt <= now || shown.has(i.userId)) continue;
      const m = members.get(i.userId);
      if (!m) continue;
      shown.add(i.userId);
      out.push({
        userId: i.userId,
        nickname: rules.showNicknames ? m.nickname : null,
        teamId: m.teamId,
        squadId: null,
        playerRole: rules.showRoles ? m.playerRole : null,
        kind: 'intel',
        precision: i.precision,
        lat: i.lat,
        lng: i.lng,
        accuracyM: null,
        radiusM: i.radiusM,
        sampleAt: iso(i.sampleAt),
        receivedAt: iso(i.writtenAt),
        status: now - i.writtenAt <= tracking.staleAfterSec * 1000 ? 'online' : 'stale',
      });
    }
  }
  return out;
}
