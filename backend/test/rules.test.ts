import { describe, expect, it } from 'vitest';
import { DEFAULT_GEOFENCE, DEFAULT_TRACKING, DEFAULT_VISIBILITY, merge, type VisibilityRules } from '../src/domain/defaults.js';
import { validateSamples } from '../src/domain/anticheat.js';
import { advance, emptyState, exitMarginM } from '../src/domain/geofence.js';
import {
  captureBlock,
  contentVisible,
  degrade,
  objectiveStatus,
  objectiveVisible,
  projectPositions,
  type ObjectiveRow,
  type PosLocation,
  type PosMember,
  type Viewer,
} from '../src/domain/rules.js';
import { distanceM, offset } from '../src/lib/geo.js';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const base: ObjectiveRow = {
  id: 'o1',
  enabled: true,
  disabled_by_gm: false,
  max_captures: 0,
  capture_count: 0,
  prerequisite_ids: [],
  availability_start: null,
  availability_end: null,
  contested: false,
  contested_by_gm: false,
  owner_team_id: null,
  allowed_team_ids: [],
  cooldown_sec: 0,
  last_captured_at: null,
  jammed_for: {},
  shielded_until: null,
  shielded_team_id: null,
  methods: ['code'],
  require_geofence: false,
  visibility: { mode: 'all' },
};
const viewer = (over: Partial<Viewer> = {}): Viewer => ({
  userId: 'u1',
  isGm: false,
  approved: true,
  teamId: 'A',
  squadId: 'S1',
  isSquadLeader: false,
  playerRole: 'rifleman',
  allianceId: null,
  ...over,
});
const live = { status: 'live' as const, phase: null, rules: DEFAULT_VISIBILITY };
const noAlliance = () => null;

describe('objective status', () => {
  it('follows precedence', () => {
    expect(objectiveStatus(base, true, NOW)).toBe('active');
    expect(objectiveStatus({ ...base, owner_team_id: 'A' }, true, NOW)).toBe('captured');
    expect(objectiveStatus({ ...base, owner_team_id: 'A', contested: true }, true, NOW)).toBe('contested');
    expect(objectiveStatus({ ...base, availability_start: new Date(NOW + 1000) }, true, NOW)).toBe('inactive');
    expect(objectiveStatus({ ...base, availability_end: new Date(NOW) }, true, NOW)).toBe('inactive');
    expect(objectiveStatus({ ...base, prerequisite_ids: ['x'] }, false, NOW)).toBe('locked');
    expect(objectiveStatus({ ...base, max_captures: 1, capture_count: 1, owner_team_id: 'A' }, true, NOW)).toBe('completed');
    expect(objectiveStatus({ ...base, disabled_by_gm: true, max_captures: 1, capture_count: 1 }, true, NOW)).toBe('disabled');
  });
});

describe('capture eligibility', () => {
  const block = (o: Partial<ObjectiveRow>, team: string | null = 'A', method: 'code' | 'qr' | 'geofence' = 'code', armed = {}) => {
    const row = { ...base, ...o };
    return captureBlock(row, objectiveStatus(row, true, NOW), 'live', team, NOW, method, armed);
  };
  it('allows a normal capture', () => expect(block({})).toBeNull());
  it('blocks when not live', () => expect(captureBlock(base, 'active', 'paused', 'A', NOW, 'code')).toBe('not_live'));
  it('blocks without a team', () => expect(block({}, null)).toBe('no_team'));
  it('blocks own objective', () => expect(block({ owner_team_id: 'A' })).toBe('already_owned'));
  it('blocks teams not allowed', () => expect(block({ allowed_team_ids: ['B'] })).toBe('team_not_allowed'));
  it('blocks during cooldown', () => expect(block({ owner_team_id: 'B', cooldown_sec: 60, last_captured_at: new Date(NOW - 30_000) })).toBe('cooldown'));
  it('allows after cooldown', () => expect(block({ owner_team_id: 'B', cooldown_sec: 60, last_captured_at: new Date(NOW - 61_000) })).toBeNull());
  it('blocks the jammed team only', () => {
    expect(block({ jammed_for: { A: NOW + 10_000 } })).toBe('jammed');
    expect(block({ jammed_for: { A: NOW + 10_000 } }, 'B')).toBeNull();
    expect(block({ jammed_for: { A: NOW - 1 } })).toBeNull();
  });
  it('blocks shielded objectives for other teams', () => {
    expect(block({ shielded_until: new Date(NOW + 5000), shielded_team_id: 'B' })).toBe('shielded');
    expect(block({ shielded_until: new Date(NOW + 5000), shielded_team_id: 'A' })).toBeNull();
  });
  it('zone contest blocks only geofence captures, GM contest blocks all', () => {
    expect(block({ contested: true, methods: ['code', 'geofence'] }, 'A', 'code')).toBeNull();
    expect(block({ contested: true, methods: ['code', 'geofence'] }, 'A', 'geofence')).toBe('contested');
    expect(block({ contested_by_gm: true })).toBe('contested');
  });
  it('requires the zone hold before code when configured', () => {
    expect(block({ require_geofence: true })).toBe('geofence_required');
    expect(block({ require_geofence: true }, 'A', 'code', { A: true })).toBeNull();
  });
});

describe('objective visibility', () => {
  it('hides objectives before start unless revealed', () => {
    expect(objectiveVisible(base, 'active', viewer(), { ...live, status: 'lobby' })).toBe(false);
    expect(objectiveVisible(base, 'active', viewer(), { ...live, status: 'lobby', rules: { ...DEFAULT_VISIBILITY, revealObjectivesBeforeStart: true } })).toBe(true);
  });
  it('respects team visibility and GM-only', () => {
    expect(objectiveVisible({ ...base, visibility: { mode: 'teams', teamIds: ['B'] } }, 'active', viewer(), live)).toBe(false);
    expect(objectiveVisible({ ...base, visibility: { mode: 'teams', teamIds: ['A'] } }, 'active', viewer(), live)).toBe(true);
    expect(objectiveVisible({ ...base, visibility: { mode: 'gm_only' } }, 'active', viewer(), live)).toBe(false);
    expect(objectiveVisible({ ...base, visibility: { mode: 'gm_only' } }, 'active', viewer({ isGm: true }), live)).toBe(true);
  });
  it('reveals hidden objectives once prerequisites are captured', () => {
    const o = { ...base, visibility: { mode: 'after_prerequisites' as const } };
    expect(objectiveVisible(o, 'locked', viewer(), live)).toBe(false);
    expect(objectiveVisible(o, 'active', viewer(), live)).toBe(true);
  });
  it('applies captured objective rules', () => {
    const o = { ...base, owner_team_id: 'B' };
    const rules = (capturedObjectives: VisibilityRules['capturedObjectives']) => ({ ...live, rules: { ...DEFAULT_VISIBILITY, capturedObjectives } });
    expect(objectiveVisible(o, 'captured', viewer(), rules('hidden'))).toBe(false);
    expect(objectiveVisible(o, 'captured', viewer(), rules('owner_only'))).toBe(false);
    expect(objectiveVisible(o, 'captured', viewer({ teamId: 'B' }), rules('owner_only'))).toBe(true);
    expect(objectiveVisible(o, 'captured', viewer(), rules('visible'))).toBe(true);
  });
  it('denies non-approved members', () => expect(objectiveVisible(base, 'active', viewer({ approved: false }), live)).toBe(false));
});

describe('POI/zone visibility', () => {
  it('filters by team, squad, role, phase and time window', () => {
    const v = viewer();
    expect(contentVisible({ mode: 'teams', teamIds: ['B'] }, v, live, NOW, null, false, noAlliance)).toBe(false);
    expect(contentVisible({ squadIds: ['S2'] }, v, live, NOW, null, false, noAlliance)).toBe(false);
    expect(contentVisible({ roles: ['medic'] }, v, live, NOW, null, false, noAlliance)).toBe(false);
    expect(contentVisible({ roles: ['rifleman'] }, v, live, NOW, null, false, noAlliance)).toBe(true);
    expect(contentVisible({ phases: ['lobby'] }, v, live, NOW, null, false, noAlliance)).toBe(false);
    expect(contentVisible({ phases: ['night'] }, v, { ...live, phase: 'night' }, NOW, null, false, noAlliance)).toBe(true);
    expect(contentVisible({ activeFrom: new Date(NOW + 1000).toISOString() }, v, live, NOW, null, false, noAlliance)).toBe(false);
    expect(contentVisible({ activeUntil: new Date(NOW - 1000).toISOString() }, v, live, NOW, null, false, noAlliance)).toBe(false);
  });
  it('hides enemy bases unless allowed', () => {
    expect(contentVisible({ mode: 'all' }, viewer(), live, NOW, 'B', true, noAlliance)).toBe(false);
    expect(contentVisible({ mode: 'all' }, viewer(), live, NOW, 'A', true, noAlliance)).toBe(true);
    expect(contentVisible({ mode: 'all' }, viewer(), { ...live, rules: { ...DEFAULT_VISIBILITY, showEnemyBases: true } }, NOW, 'B', true, noAlliance)).toBe(true);
  });
});

describe('position projection', () => {
  const origin = { lat: 45.5, lng: 9.2 };
  const members = new Map<string, PosMember>(
    [
      ['u1', 'A', 'S1', false],
      ['u2', 'A', 'S1', false],
      ['u3', 'A', 'S2', false],
      ['u4', 'B', 'S3', false],
      ['u5', 'C', 'S4', false],
    ].map(([userId, teamId, squadId, isSquadLeader]) => [
      userId as string,
      { userId: userId as string, nickname: `nick-${userId}`, teamId: teamId as string, squadId: squadId as string, isSquadLeader: isSquadLeader as boolean, playerRole: 'rifleman', trackingActive: true },
    ]),
  );
  const loc = (userId: string, i: number, ageMs = 1000): PosLocation => {
    const p = offset(origin, 50 * i, 90);
    return { userId, ...p, accuracy: 5, sampleAt: NOW - ageMs, receivedAt: NOW - ageMs, ring: [{ ...p, accuracy: 5, t: NOW - 120_000 }], suspiciousCount: 0, lastFlagAt: null };
  };
  const locations = ['u1', 'u2', 'u3', 'u4', 'u5'].map((u, i) => loc(u, i));
  const run = (rules: Partial<VisibilityRules>, v = viewer(), intel: Parameters<typeof projectPositions>[1]['intel'] = []) =>
    projectPositions(v, {
      rules: merge(DEFAULT_VISIBILITY, rules),
      tracking: DEFAULT_TRACKING,
      members,
      teamAlliance: (t) => (t === 'A' || t === 'C' ? 'blue' : null),
      locations,
      intel,
      now: NOW,
    });
  const ids = (ps: ReturnType<typeof run>) => ps.map((p) => `${p.userId}:${p.kind}`).sort();

  it('team mode shows the team, never enemies', () => {
    expect(ids(run({ allies: 'team', enemies: 'perk_only' }))).toEqual(['u1:self', 'u2:ally', 'u3:ally']);
  });
  it('squad mode shows only the squad', () => {
    expect(ids(run({ allies: 'squad' }))).toEqual(['u1:self', 'u2:ally']);
  });
  it('none mode shows only self, squad leaders see their squad', () => {
    expect(ids(run({ allies: 'none' }))).toEqual(['u1:self']);
    expect(ids(run({ allies: 'none', squadLeadersSeeSquad: true }, viewer({ isSquadLeader: true })))).toEqual(['u1:self', 'u2:ally']);
  });
  it('alliance mode includes allied teams', () => {
    expect(ids(run({ allies: 'alliance' }, viewer({ allianceId: 'blue' })))).toEqual(['u1:self', 'u2:ally', 'u3:ally', 'u5:ally']);
  });
  it('always-visible enemies are degraded to the enemy precision', () => {
    const res = run({ allies: 'team', enemies: 'always', enemyPrecision: 'area', approxRadiusM: 100 });
    const enemy = res.find((p) => p.userId === 'u4')!;
    expect(enemy.kind).toBe('enemy');
    expect(enemy.precision).toBe('area');
    expect(enemy.radiusM).toBeGreaterThan(100);
    expect(distanceM(enemy, locations[3])).toBeLessThanOrEqual(enemy.radiusM!);
  });
  it('approximate positions stay inside their radius', () => {
    const res = run({ allyPrecision: 'approximate', approxRadiusM: 40 });
    const ally = res.find((p) => p.userId === 'u2')!;
    expect(ally.radiusM).toBe(40);
    expect(distanceM(ally, locations[1])).toBeLessThanOrEqual(40);
  });
  it('delayed positions come from the ring buffer', () => {
    const res = run({ allyPrecision: 'delayed', delaySec: 60 });
    const ally = res.find((p) => p.userId === 'u2')!;
    expect(Date.parse(ally.sampleAt)).toBe(NOW - 120_000);
  });
  it('intel is shown only to the viewer team and only before expiry', () => {
    const intel = [{ userId: 'u4', viewerTeamId: 'A', lat: 1, lng: 1, radiusM: null, precision: 'exact' as const, sampleAt: NOW, writtenAt: NOW, expiresAt: NOW + 1000 }];
    expect(ids(run({ enemies: 'perk_only' }, viewer(), intel))).toContain('u4:intel');
    expect(ids(run({ enemies: 'perk_only' }, viewer({ teamId: 'B', squadId: 'S3', userId: 'u4' }), intel))).not.toContain('u4:intel');
    expect(ids(run({ enemies: 'perk_only' }, viewer(), [{ ...intel[0], expiresAt: NOW }]))).not.toContain('u4:intel');
    expect(ids(run({ enemies: 'never' }, viewer(), intel))).not.toContain('u4:intel');
  });
  it('hides nicknames and roles when configured', () => {
    const ally = run({ showNicknames: false, showRoles: false }).find((p) => p.userId === 'u2')!;
    expect(ally.nickname).toBeNull();
    expect(ally.playerRole).toBeNull();
  });
  it('GM sees everyone exactly', () => {
    const res = run({ allies: 'none', enemies: 'never' }, viewer({ isGm: true, teamId: null }));
    expect(res).toHaveLength(5);
    expect(res.every((p) => p.precision === 'exact')).toBe(true);
  });
  it('unassigned or pending players see only themselves', () => {
    expect(ids(run({}, viewer({ teamId: null })))).toEqual(['u1:self']);
    expect(ids(run({}, viewer({ approved: false })))).toEqual(['u1:self']);
  });
  it('drops positions older than hideAfter', () => {
    const res = projectPositions(viewer(), {
      rules: DEFAULT_VISIBILITY,
      tracking: DEFAULT_TRACKING,
      members,
      teamAlliance: noAlliance,
      locations: [loc('u2', 1, (DEFAULT_TRACKING.hideAfterSec + 1) * 1000)],
      intel: [],
      now: NOW,
    });
    expect(res).toHaveLength(0);
  });
  it('degrade delayed returns null without old samples', () => {
    expect(degrade({ ...locations[0], ring: [] }, 'delayed', DEFAULT_VISIBILITY, NOW)).toBeNull();
  });
});

describe('geofence', () => {
  const cfg = { ...DEFAULT_GEOFENCE, durationSec: 30 };
  const step = (s: ReturnType<typeof emptyState>, now: number, report?: { userId: string; teamId: string; inside: boolean }, c = cfg) =>
    advance(s, { now, cfg: c, canAccrue: () => true, presenceTtlMs: 25_000, maxGapMs: 25_000, report });

  it('accrues with server time and completes', () => {
    let s = emptyState();
    let r = step(s, 0, { userId: 'u1', teamId: 'A', inside: true });
    s = r.state;
    expect(s.progress.A.s).toBe(0);
    r = step(s, 10_000, { userId: 'u1', teamId: 'A', inside: true });
    s = r.state;
    expect(s.progress.A.s).toBeCloseTo(10);
    r = step(s, 20_000, { userId: 'u1', teamId: 'A', inside: true });
    r = step(r.state, 30_000, { userId: 'u1', teamId: 'A', inside: true });
    expect(r.completedBy).toBe('A');
  });
  it('does not count long gaps (offline or replayed samples)', () => {
    let r = step(emptyState(), 0, { userId: 'u1', teamId: 'A', inside: true });
    r = step(r.state, 100_000, { userId: 'u1', teamId: 'A', inside: true });
    expect(r.state.progress.A.s).toBe(0);
  });
  it('resets on exit when configured', () => {
    let r = step(emptyState(), 0, { userId: 'u1', teamId: 'A', inside: true });
    r = step(r.state, 10_000, { userId: 'u1', teamId: 'A', inside: true });
    r = step(r.state, 15_000, { userId: 'u1', teamId: 'A', inside: false });
    expect(r.state.progress.A).toBeUndefined();
  });
  describe('GPS jitter', () => {
    const long = { ...cfg, durationSec: 120 };
    const jitter = (s: ReturnType<typeof emptyState>, now: number, report?: { userId: string; teamId: string; inside: boolean; firm?: boolean }) =>
      advance(s, { now, cfg: long, canAccrue: () => true, presenceTtlMs: 25_000, maxGapMs: 25_000, exitGraceMs: 15_000, report });

    it('forgives one stray outside fix and credits the time', () => {
      let r = jitter(emptyState(), 0, { userId: 'u1', teamId: 'A', inside: true });
      r = jitter(r.state, 10_000, { userId: 'u1', teamId: 'A', inside: true });
      r = jitter(r.state, 20_000, { userId: 'u1', teamId: 'A', inside: false });
      expect(r.state.present.A.u1).toBe(10_000);
      expect(r.state.progress.A.s).toBeCloseTo(10);
      r = jitter(r.state, 30_000, { userId: 'u1', teamId: 'A', inside: true });
      expect(r.state.progress.A.s).toBeCloseTo(30);
    });
    it('removes the player after a second outside report', () => {
      let r = jitter(emptyState(), 0, { userId: 'u1', teamId: 'A', inside: true });
      r = jitter(r.state, 10_000, { userId: 'u1', teamId: 'A', inside: false });
      r = jitter(r.state, 20_000, { userId: 'u1', teamId: 'A', inside: false });
      expect(r.state.present.A).toBeUndefined();
      expect(r.state.progress.A).toBeUndefined(); // resetOnExit
    });
    it('removes the player at once on a firm outside report', () => {
      let r = jitter(emptyState(), 0, { userId: 'u1', teamId: 'A', inside: true });
      r = jitter(r.state, 5_000, { userId: 'u1', teamId: 'A', inside: false, firm: true });
      expect(r.state.present.A).toBeUndefined();
    });
    it('keeps a player without a report (fix too poor to judge) until presence expires', () => {
      let r = jitter(emptyState(), 0, { userId: 'u1', teamId: 'A', inside: true });
      r = jitter(r.state, 20_000);
      expect(r.state.present.A.u1).toBe(0);
      r = jitter(r.state, 30_000);
      expect(r.state.present.A).toBeUndefined();
    });
    it('exit margin follows accuracy within 5–15 m and the radius', () => {
      expect(exitMarginM(25, 2)).toBe(5);
      expect(exitMarginM(25, 9)).toBe(9);
      expect(exitMarginM(25, 40)).toBe(15);
      expect(exitMarginM(4, 10)).toBe(4);
    });
  });
  it('pauses while contested and reports the end of a contest', () => {
    let r = step(emptyState(), 0, { userId: 'u1', teamId: 'A', inside: true });
    r = step(r.state, 5_000, { userId: 'u9', teamId: 'B', inside: true });
    expect(r.state.contested).toBe(true);
    r = step(r.state, 10_000, { userId: 'u1', teamId: 'A', inside: true });
    expect(r.state.progress.A.s).toBeCloseTo(5);
    r = step(r.state, 40_000, { userId: 'u9', teamId: 'B', inside: false });
    expect(r.state.contested).toBe(false);
    expect(r.contestEndedAfterMs).toBe(35_000);
  });
  it('multiple players speed up the capture when boost is on', () => {
    const boost = { ...cfg, multiPlayerBoost: true, boostPerExtraPlayer: 0.5, maxMultiplier: 3 };
    let r = step(emptyState(), 0, { userId: 'u1', teamId: 'A', inside: true }, boost);
    r = step(r.state, 1_000, { userId: 'u2', teamId: 'A', inside: true }, boost);
    r = step(r.state, 11_000, { userId: 'u1', teamId: 'A', inside: true }, boost);
    expect(r.state.progress.A.s).toBeCloseTo(1.5 + 15, 0);
  });
  describe('majority rule', () => {
    const maj = { ...cfg, contestRule: 'majority' as const };
    it('lets the team with more players inside keep capturing', () => {
      let r = step(emptyState(), 0, { userId: 'a1', teamId: 'A', inside: true }, maj);
      r = step(r.state, 1_000, { userId: 'a2', teamId: 'A', inside: true }, maj);
      r = step(r.state, 2_000, { userId: 'b1', teamId: 'B', inside: true }, maj);
      expect(r.state.contested).toBe(false);
      expect(r.leader).toBe('A');
      r = step(r.state, 12_000, { userId: 'a1', teamId: 'A', inside: true }, maj);
      expect(r.state.progress.A.s).toBeCloseTo(12);
      r = step(r.state, 13_000, { userId: 'b1', teamId: 'B', inside: true }, maj);
      expect(r.state.progress.B?.s ?? 0).toBe(0); // outnumbered: no progress
    });
    it('contests on a tie, and the new majority takes over', () => {
      let r = step(emptyState(), 0, { userId: 'a1', teamId: 'A', inside: true }, maj);
      r = step(r.state, 10_000, { userId: 'b1', teamId: 'B', inside: true }, maj);
      expect(r.state.contested).toBe(true); // 1 vs 1
      expect(r.state.progress.A.s).toBeCloseTo(10);
      r = step(r.state, 11_000, { userId: 'b2', teamId: 'B', inside: true }, maj);
      expect(r.state.contested).toBe(false);
      expect(r.leader).toBe('B');
      r = step(r.state, 21_000, { userId: 'b1', teamId: 'B', inside: true }, maj);
      expect(r.state.progress.B.s).toBeCloseTo(10);
      r = step(r.state, 22_000, { userId: 'a1', teamId: 'A', inside: true }, maj);
      expect(r.state.progress.A.s).toBeCloseTo(10); // A paused while outnumbered
    });
    it('is ignored when the zone is not contestable', () => {
      const off = { ...maj, contestable: false };
      let r = step(emptyState(), 0, { userId: 'a1', teamId: 'A', inside: true }, off);
      r = step(r.state, 1_000, { userId: 'b1', teamId: 'B', inside: true }, off);
      expect(r.leader).toBeNull();
      expect(r.state.contested).toBe(false);
    });
  });
});

describe('anti-cheat', () => {
  const p0 = { lat: 45.5, lng: 9.2, accuracy: 5, t: NOW - 20_000 };
  it('accepts plausible movement', () => {
    const next = offset(p0, 50, 0);
    const r = validateSamples(p0, [{ ...next, accuracy: 5, timestamp: NOW - 5_000 }], NOW, DEFAULT_TRACKING);
    expect(r.accepted).toHaveLength(1);
    expect(r.fresh).toBe(true);
  });
  it('rejects teleports', () => {
    const far = offset(p0, 2_000, 0);
    const r = validateSamples(p0, [{ ...far, accuracy: 5, timestamp: NOW - 10_000 }], NOW, DEFAULT_TRACKING);
    expect(r.accepted).toHaveLength(0);
    expect(r.flags).toContain('speed');
    expect(r.suspicious[0].flag).toBe('speed');
  });
  it('rejects mock, future and very old samples', () => {
    const r = validateSamples(null, [
      { ...p0, timestamp: NOW, isMocked: true },
      { ...p0, timestamp: NOW + 60_000 },
      { ...p0, timestamp: NOW - 20 * 60_000 },
    ], NOW, DEFAULT_TRACKING);
    expect(r.accepted).toHaveLength(0);
    expect(r.flags.sort()).toEqual(['future_timestamp', 'mock', 'too_old']);
  });
  it('marks queued samples as not fresh', () => {
    const r = validateSamples(null, [{ ...p0, timestamp: NOW - 60_000 }], NOW, DEFAULT_TRACKING);
    expect(r.accepted).toHaveLength(1);
    expect(r.fresh).toBe(false);
  });
});
