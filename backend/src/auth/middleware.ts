import type { NextFunction, Request, Response } from 'express';
import { one } from '../db.js';
import { forbidden, unauthorized } from '../errors.js';
import { verifyAccessToken } from './tokens.js';

export interface AuthUser {
  id: string;
  nickname: string;
  emailVerified: boolean;
  termsAccepted: boolean;
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
  const row = await one<{ id: string; nickname: string; email_verified_at: Date | null; terms_accepted_at: Date | null; token_version: number; deleted_at: Date | null }>(
    'SELECT id, nickname, email_verified_at, terms_accepted_at, token_version, deleted_at FROM users WHERE id = $1',
    [userId],
  );
  if (!row || row.deleted_at || row.token_version !== version) return null;
  return { id: row.id, nickname: row.nickname, emailVerified: !!row.email_verified_at, termsAccepted: !!row.terms_accepted_at };
}

/** Signed in (any verification state). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const user = await authenticate(req);
  if (!user) return next(unauthorized('Your session has expired. Sign in again.', 'token_expired'));
  req.user = user;
  next();
}

/** Signed in with a verified email and accepted terms: required for anything event related. */
export async function requireVerified(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const user = await authenticate(req);
  if (!user) return next(unauthorized('Your session has expired. Sign in again.', 'token_expired'));
  if (!user.emailVerified) return next(forbidden('Verify your email address first.', 'email_not_verified'));
  if (!user.termsAccepted) return next(forbidden('Accept the terms of service first.', 'terms_not_accepted'));
  req.user = user;
  next();
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
