import { z } from 'zod';

export const precision = z.enum(['exact', 'approximate', 'delayed', 'area']);
export type Precision = z.infer<typeof precision>;

export const trackingSchema = z.object({
  intervalSec: z.number().int().min(3).max(300),
  minDistanceM: z.number().min(0).max(500),
  maxAccuracyM: z.number().min(5).max(500),
  background: z.boolean(),
  stopWhenPaused: z.boolean(),
  staleAfterSec: z.number().int().min(10).max(3600),
  hideAfterSec: z.number().int().min(10).max(86400),
  showLastKnown: z.boolean(),
  batterySaver: z.boolean(),
  highAccuracy: z.boolean(),
  maxSpeedMps: z.number().min(2).max(100),
  retentionDays: z.number().int().min(0).max(365),
  keepHistory: z.boolean(),
});
export type Tracking = z.infer<typeof trackingSchema>;

export const visibilitySchema = z.object({
  allies: z.enum(['none', 'squad', 'team', 'alliance']),
  squadLeadersSeeSquad: z.boolean(),
  enemies: z.enum(['never', 'perk_only', 'always']),
  allyPrecision: precision,
  enemyPrecision: precision,
  approxRadiusM: z.number().min(5).max(1000),
  delaySec: z.number().int().min(5).max(3600),
  showNicknames: z.boolean(),
  showRoles: z.boolean(),
  showEnemyBases: z.boolean(),
  capturedObjectives: z.enum(['visible', 'hidden', 'owner_only']),
  revealObjectivesBeforeStart: z.boolean(),
  showEnemyCurrency: z.boolean(),
});
export type VisibilityRules = z.infer<typeof visibilitySchema>;

export const scoringSchema = z.object({
  startingPoints: z.number().int().min(-1_000_000).max(1_000_000),
  startingCurrency: z.number().int().min(0).max(1_000_000),
  maxCurrency: z.number().int().min(0).max(10_000_000),
  allowNegativePoints: z.boolean(),
  winCondition: z.enum(['points', 'objectives']),
});
export type Scoring = z.infer<typeof scoringSchema>;

export const DEFAULT_TRACKING: Tracking = {
  intervalSec: 10,
  minDistanceM: 5,
  maxAccuracyM: 50,
  background: true,
  stopWhenPaused: true,
  staleAfterSec: 60,
  hideAfterSec: 600,
  showLastKnown: true,
  batterySaver: false,
  highAccuracy: true,
  maxSpeedMps: 12,
  retentionDays: 7,
  keepHistory: true,
};

export const DEFAULT_VISIBILITY: VisibilityRules = {
  allies: 'team',
  squadLeadersSeeSquad: true,
  enemies: 'perk_only',
  allyPrecision: 'exact',
  enemyPrecision: 'approximate',
  approxRadiusM: 50,
  delaySec: 60,
  showNicknames: true,
  showRoles: true,
  showEnemyBases: false,
  capturedObjectives: 'visible',
  revealObjectivesBeforeStart: false,
  showEnemyCurrency: false,
};

export const DEFAULT_SCORING: Scoring = {
  startingPoints: 0,
  startingCurrency: 100,
  maxCurrency: 0,
  allowNegativePoints: false,
  winCondition: 'points',
};

export const geofenceSchema = z.object({
  radiusM: z.number().min(3).max(1000),
  durationSec: z.number().int().min(5).max(7200),
  resetOnExit: z.boolean(),
  multiPlayerBoost: z.boolean(),
  boostPerExtraPlayer: z.number().min(0).max(5),
  maxMultiplier: z.number().min(1).max(10),
  contestable: z.boolean(),
  /** With several teams inside a contestable zone: 'pause' = nobody progresses; 'majority' = the team with most players inside does (a tie pauses). */
  contestRule: z.enum(['pause', 'majority']),
  requireScreenOpen: z.boolean(),
  maxAccuracyM: z.number().min(3).max(500),
});
export type Geofence = z.infer<typeof geofenceSchema>;

export const DEFAULT_GEOFENCE: Geofence = {
  radiusM: 25,
  durationSec: 60,
  resetOnExit: true,
  multiPlayerBoost: false,
  boostPerExtraPlayer: 0.5,
  maxMultiplier: 3,
  contestable: true,
  contestRule: 'pause',
  requireScreenOpen: false,
  // at most the radius: a rougher fix can't tell inside from outside
  maxAccuracyM: 25,
};

const amount = z.number().int().min(-1_000_000).max(1_000_000);
export const rewardsSchema = z.object({
  points: amount.min(0),
  currency: amount.min(0),
  perTeam: z.record(z.string().uuid(), z.object({ points: amount.min(0), currency: amount.min(0) })),
  recurringPointsPerMinute: amount.min(0),
  recurringCurrencyPerMinute: amount.min(0),
  captureBonus: amount.min(0),
  defenseBonus: amount.min(0),
  completionBonus: amount.min(0),
});
export type Rewards = z.infer<typeof rewardsSchema>;

export const DEFAULT_REWARDS: Rewards = {
  points: 100,
  currency: 50,
  perTeam: {},
  recurringPointsPerMinute: 0,
  recurringCurrencyPerMinute: 0,
  captureBonus: 0,
  defenseBonus: 0,
  completionBonus: 0,
};

export const perkConfigSchema = z.object({
  uav: z
    .object({ refreshSec: z.number().int().min(2).max(600), precision, delaySec: z.number().int().min(0).max(3600), areaRadiusM: z.number().min(5).max(1000) })
    .optional(),
  theft: z.object({ mode: z.enum(['fixed', 'percent']), amount: z.number().min(0).max(1_000_000), protectionSec: z.number().int().min(0).max(86400) }).optional(),
  doublePoints: z.object({ multiplier: z.number().min(1).max(10) }).optional(),
  recon: z.object({ precision, revealSec: z.number().int().min(5).max(600) }).optional(),
});
export type PerkConfig = z.infer<typeof perkConfigSchema>;

export const DEFAULT_PERK_CONFIG: Required<PerkConfig> = {
  uav: { refreshSec: 10, precision: 'exact', delaySec: 0, areaRadiusM: 75 },
  theft: { mode: 'percent', amount: 20, protectionSec: 600 },
  doublePoints: { multiplier: 2 },
  recon: { precision: 'approximate', revealSec: 30 },
};

/** Deep merge for nested settings objects (plain objects only; arrays/values replace). */
export function merge<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = isPlain(out[k]) && isPlain(v) ? merge(out[k], v) : v;
  }
  return out as T;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const tracking = (stored: unknown): Tracking => merge(DEFAULT_TRACKING, stored ?? {});
export const visibility = (stored: unknown): VisibilityRules => merge(DEFAULT_VISIBILITY, stored ?? {});
export const scoring = (stored: unknown): Scoring => merge(DEFAULT_SCORING, stored ?? {});
export const geofence = (stored: unknown): Geofence => merge(DEFAULT_GEOFENCE, stored ?? {});
export const rewards = (stored: unknown): Rewards => merge(DEFAULT_REWARDS, stored ?? {});

/** Default perks offered by "Add default perks". */
export const DEFAULT_PERKS = [
  {
    name: 'UAV',
    type: 'uav',
    icon: 'lucideRadar',
    price: 300,
    durationSec: 90,
    cooldownSec: 600,
    target: 'enemy_team',
    description: 'Shows the positions of an enemy team on your team’s map while it is active.',
    config: { uav: DEFAULT_PERK_CONFIG.uav },
  },
  {
    name: 'Objective jammer',
    type: 'jammer',
    icon: 'lucideAntenna',
    price: 250,
    durationSec: 180,
    cooldownSec: 600,
    target: 'objective',
    description: 'The chosen objective cannot be captured by the enemy team until the jammer expires.',
    config: {},
  },
  {
    name: 'Currency theft',
    type: 'theft',
    icon: 'lucideCoins',
    price: 200,
    durationSec: 0,
    cooldownSec: 900,
    target: 'enemy_team',
    requiresApproval: true,
    description: 'Takes 20% of an enemy team’s credits. A team can’t be robbed again for 10 minutes.',
    config: { theft: DEFAULT_PERK_CONFIG.theft },
  },
  {
    name: 'Recon scan',
    type: 'recon',
    icon: 'lucideScan',
    price: 120,
    durationSec: 30,
    cooldownSec: 300,
    target: 'enemy_team',
    description: 'One snapshot of approximate enemy positions, visible for 30 seconds.',
    config: { recon: DEFAULT_PERK_CONFIG.recon },
  },
  {
    name: 'Objective shield',
    type: 'shield',
    icon: 'lucideShieldCheck',
    price: 200,
    durationSec: 300,
    cooldownSec: 900,
    target: 'objective',
    description: 'Other teams cannot capture the chosen objective for 5 minutes.',
    config: {},
  },
  {
    name: 'Double points',
    type: 'double_points',
    icon: 'lucideSparkles',
    price: 350,
    durationSec: 300,
    cooldownSec: 1200,
    target: 'none',
    description: 'Points from captures and held objectives are doubled for 5 minutes.',
    config: { doublePoints: DEFAULT_PERK_CONFIG.doublePoints },
  },
  {
    name: 'Instant respawn',
    type: 'instant_respawn',
    icon: 'lucideHeartPulse',
    price: 80,
    durationSec: 0,
    cooldownSec: 300,
    target: 'none',
    eligible: 'squad_leaders',
    description: 'One player of your squad respawns on the spot. Show this to the nearest marshal.',
    config: {},
  },
  {
    name: 'Supply drop',
    type: 'supply_drop',
    icon: 'lucidePackage',
    price: 150,
    durationSec: 0,
    cooldownSec: 900,
    target: 'none',
    requiresApproval: true,
    description: 'The Game Master places an ammo and medic cache near your team.',
    config: {},
  },
  {
    name: 'Comms jammer',
    type: 'comms_jammer',
    icon: 'lucideRadio',
    price: 250,
    durationSec: 120,
    cooldownSec: 900,
    target: 'enemy_team',
    requiresApproval: true,
    description: 'The enemy team must stay off the radio for 2 minutes. Enforced by marshals.',
    config: {},
  },
] as const;
