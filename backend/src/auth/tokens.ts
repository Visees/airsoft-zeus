import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { one, pool, type Queryable } from '../db.js';
import { randomToken, sha256 } from '../lib/ids.js';

export interface AccessClaims {
  sub: string;
  /** token_version: bumping it revokes all sessions */
  ver: number;
  /** email verified */
  ev: boolean;
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: config.ACCESS_TOKEN_TTL_SEC, issuer: 'airsofthub' });
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'], issuer: 'airsofthub' }) as AccessClaims;
    return typeof decoded.sub === 'string' ? decoded : null;
  } catch {
    return null;
  }
}

/** Single-use email verification / password reset token. Returns the raw token for the email link. */
export async function issueOneTimeToken(userId: string, kind: 'email_verify' | 'password_reset', ttlMinutes: number, q: Queryable = pool): Promise<string> {
  const raw = randomToken(32);
  await q.query("UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL", [userId, kind]);
  await q.query(
    `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [userId, kind, sha256(raw), ttlMinutes],
  );
  return raw;
}

/** Consume a one-time token; returns the user id or null when invalid/expired/used. */
export async function consumeOneTimeToken(raw: string, kind: 'email_verify' | 'password_reset', q: Queryable = pool): Promise<string | null> {
  const row = await one<{ user_id: string }>(
    `UPDATE auth_tokens SET used_at = now()
      WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [sha256(raw), kind],
    q,
  );
  return row?.user_id ?? null;
}

/** Refresh tokens rotate on every use; a reused (already rotated) token revokes its whole family. */
export async function issueRefreshToken(userId: string, userAgent: string | undefined, family?: string, q: Queryable = pool): Promise<string> {
  const raw = randomToken(48);
  await q.query(
    `INSERT INTO auth_tokens (user_id, kind, token_hash, family, expires_at, user_agent)
     VALUES ($1, 'refresh', $2, $3, now() + make_interval(days => $4), $5)`,
    [userId, sha256(raw), family ?? randomUUID(), config.REFRESH_TOKEN_TTL_DAYS, userAgent?.slice(0, 300) ?? null],
  );
  return raw;
}

export type RotateResult = { ok: true; userId: string; token: string } | { ok: false; reason: 'invalid' | 'reused' | 'expired' };

export async function rotateRefreshToken(raw: string, userAgent: string | undefined): Promise<RotateResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string; user_id: string; family: string; used_at: Date | null; expires_at: Date }>(
      `SELECT id, user_id, family, used_at, expires_at FROM auth_tokens WHERE token_hash = $1 AND kind = 'refresh' FOR UPDATE`,
      [sha256(raw)],
    );
    const row = rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'invalid' };
    }
    if (row.used_at) {
      // Reuse of a rotated token: someone else has a copy. Revoke the family.
      await client.query(`UPDATE auth_tokens SET used_at = COALESCE(used_at, now()), expires_at = now() WHERE family = $1`, [row.family]);
      await client.query('COMMIT');
      return { ok: false, reason: 'reused' };
    }
    if (row.expires_at.getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'expired' };
    }
    await client.query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [row.id]);
    const token = await issueRefreshToken(row.user_id, userAgent, row.family, client);
    await client.query('COMMIT');
    return { ok: true, userId: row.user_id, token };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  await pool.query(
    `UPDATE auth_tokens SET used_at = now(), expires_at = now()
      WHERE family = (SELECT family FROM auth_tokens WHERE token_hash = $1 AND kind = 'refresh')`,
    [sha256(raw)],
  );
}

export async function revokeAllSessions(userId: string, q: Queryable = pool): Promise<void> {
  await q.query(`UPDATE auth_tokens SET used_at = COALESCE(used_at, now()), expires_at = now() WHERE user_id = $1 AND kind = 'refresh'`, [userId]);
  await q.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
}
