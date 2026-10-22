import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { one } from '../db.js';
import { forbidden, unauthorized } from '../errors.js';
import { effectiveFeatures, type Feature } from './features.js';
import { verifyAccessToken } from './tokens.js';
import { tr } from '../i18n/index.js';

export interface AuthUser {
  id: string;
  nickname: string;
  emailVerified: boolean;
  termsAccepted: boolean;
  isAdmin: boolean;
  /** What this account may use (see auth/features.ts). */
  features: Record<Feature, boolean>;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Validates the bearer token and loads the user. The token_version check makes
 * "log out everywhere", password changes and account deletion effective immediately.
 */
export async function authenticate(req: Request): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const claims = verifyAccessToken(header.slice(7));
  if (!claims) return null;
  return userForClaims(claims.sub, claims.ver);
}

export async function userForClaims(userId: string, version: number): Promise<AuthUser | null> {
  const row = await one<{
    id: string;
    nickname: string;
    email: string;
    email_verified_at: Date | null;
    terms_accepted_at: Date | null;
    token_version: number;
    deleted_at: Date | null;
    features: unknown;
  }>('SELECT id, nickname, email, email_verified_at, terms_accepted_at, token_version, deleted_at, features FROM users WHERE id = $1', [userId]);
  if (!row || row.deleted_at || row.token_version !== version) return null;
  const isAdmin = isAdminEmail(row.email);
  return {
    id: row.id,
    nickname: row.nickname,
    emailVerified: !!row.email_verified_at,
    termsAccepted: !!row.terms_accepted_at,
    isAdmin,
    features: effectiveFeatures(row.features, isAdmin),
  };
}

/** Signed in (any verification state). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const user = await authenticate(req);
  if (!user) return next(unauthorized(tr`Your session has expired. Sign in again.`, 'token_expired'));
  req.user = user;
  next();
}

/** Signed in with a verified email and accepted terms: required for anything event related. */
export async function requireVerified(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const user = await authenticate(req);
  if (!user) return next(unauthorized(tr`Your session has expired. Sign in again.`, 'token_expired'));
  if (!user.emailVerified) return next(forbidden(tr`Verify your email address first.`, 'email_not_verified'));
  if (!user.termsAccepted) return next(forbidden(tr`Accept the terms of service first.`, 'terms_not_accepted'));
  req.user = user;
  next();
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Platform admin: the email is listed in ADMIN_EMAILS. */
export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && config.ADMIN_EMAILS.includes(email.toLowerCase());
}

export async function userIsAdmin(userId: string): Promise<boolean> {
  const row = await one<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
  return isAdminEmail(row?.email);
}

/** Verified user listed in ADMIN_EMAILS. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireVerified(req, res, async (err?: unknown) => {
    if (err) return next(err);
    if (!req.user!.isAdmin) return next(forbidden(tr`Only platform admins can do that.`, 'not_admin'));
    next();
  });
}
