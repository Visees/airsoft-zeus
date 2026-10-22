import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../errors.js';
import { tr } from '../i18n/index.js';

/**
 * Parts of the app that admins can switch on or off per user (Admin → Users → a user).
 * `default` applies to everyone without an override; overrides live in `users.features`
 * (`{ key: boolean }`, only values that differ from the default). Platform admins
 * (ADMIN_EMAILS) always have every feature.
 *
 * Adding one: a key here, the same key in `Feature` (frontend models.ts) with its label in
 * `featureLabels` (core/util/format.ts), then `requireFeature(key)` on its routes and
 * `auth.can(key)` / `featureGuard(key)` in the UI.
 */
export const FEATURES = {
  discover_events: { default: true },
  create_events: { default: true },
  create_clubs: { default: true },
  support: { default: true },
  manage_news: { default: false },
} as const satisfies Record<string, { default: boolean }>;

export type Feature = keyof typeof FEATURES;
export type FeatureOverrides = Partial<Record<Feature, boolean>>;

export const FEATURE_KEYS = Object.keys(FEATURES) as Feature[];

export function isFeature(key: string): key is Feature {
  return Object.hasOwn(FEATURES, key);
}

/** Overrides as stored, without unknown keys (features removed from the code). */
export function cleanOverrides(raw: unknown): FeatureOverrides {
  const out: FeatureOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) if (isFeature(k) && typeof v === 'boolean' && v !== FEATURES[k].default) out[k] = v;
  return out;
}

/** What the user can use: the default unless overridden; admins get everything. */
export function effectiveFeatures(raw: unknown, admin: boolean): Record<Feature, boolean> {
  const overrides = cleanOverrides(raw);
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, admin || (overrides[k] ?? FEATURES[k].default)])) as Record<Feature, boolean>;
}

/** Goes after requireVerified (or requireAuth): `req.user.features` is loaded with the user. */
export function requireFeature(feature: Feature) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.user?.features[feature]) return next();
    next(forbidden(tr`This part of the app is not enabled for your account.`, 'feature_disabled'));
  };
}
