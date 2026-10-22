import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/password.js';
import {
  consumeOneTimeToken,
  issueOneTimeToken,
  issueRefreshToken,
  revokeAllSessions,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from '../auth/tokens.js';
import { config, cookieSecure } from '../config.js';
import { many, one, tx } from '../db.js';
import { badRequest, conflict, unauthorized } from '../errors.js';
import { consume } from '../lib/rate-limit.js';
import { body, nickname, password, queryOf } from '../lib/validate.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../mail.js';
import * as dto from '../domain/serialize.js';
import { requestLang, toLang, tr } from '../i18n/index.js';

export const authRouter = Router();

const COOKIE = 'zeus_rt';
const HINT = 'zeus_session';
export function clearSessionCookies(res: Response): void {
  res.clearCookie(COOKIE, { path: '/api/auth' });
  res.clearCookie(HINT, { path: '/' });
}
const cookieOpts = () => ({
  httpOnly: true,
  secure: cookieSecure,
  sameSite: 'strict' as const,
  path: '/api/auth',
  maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
});

async function sessionResponse(req: Request, res: Response, userId: string, refreshToken?: string) {
  const user = await one('SELECT * FROM users WHERE id = $1', [userId]);
  if (!user || user.deleted_at) throw unauthorized();
  const badges = await many('SELECT * FROM user_badges WHERE user_id = $1 ORDER BY awarded_at', [userId]);
  const rt = refreshToken ?? (await issueRefreshToken(userId, req.get('user-agent')));
  res.cookie(COOKIE, rt, cookieOpts());
  // Readable hint (no secret) so the app only tries to restore a session when one may exist.
  res.cookie(HINT, '1', { ...cookieOpts(), httpOnly: false, path: '/' });
  res.json({
    user: dto.meUser(user, badges),
    accessToken: signAccessToken({ sub: user.id, ver: user.token_version, ev: !!user.email_verified_at }),
    expiresIn: config.ACCESS_TOKEN_TTL_SEC,
  });
}

const RESERVED = new Set(['admin', 'administrator', 'gamemaster', 'gm', 'system', 'moderator', 'support', 'zeus', 'airsofthub', 'deleted-player', 'null', 'undefined']);

async function nicknameProblem(nick: string, exceptUserId?: string): Promise<string | null> {
  const fmt = nickname.safeParse(nick);
  if (!fmt.success) return fmt.error.issues[0].message;
  if (RESERVED.has(nick.toLowerCase())) return tr`This nickname is reserved.`;
  const taken = await one('SELECT id FROM users WHERE lower(nickname) = lower($1) AND ($2::uuid IS NULL OR id <> $2)', [nick, exceptUserId ?? null]);
  return taken ? tr`This nickname is already taken.` : null;
}
export { nicknameProblem };

authRouter.get('/nickname-available', async (req, res) => {
  const { nickname: nick } = queryOf(req, z.object({ nickname: z.string().max(40) }));
  await consume('nick', req.ip ?? 'ip', 60, 60);
  const problem = await nicknameProblem(nick.trim());
  res.json({ available: !problem, reason: problem });
});

authRouter.post('/register', async (req, res) => {
  const b = body(
    req,
    z.object({
      email: z.string().trim().toLowerCase().email('Enter a valid email address').max(200),
      password,
      nickname,
      acceptTerms: z.literal(true, { message: tr`Accept the terms to continue` }),
      termsVersion: z.string().max(40),
      privacyVersion: z.string().max(40),
      language: z.enum(['en', 'it', 'de', 'fr', 'es']).optional(),
    }),
  );
  const language = b.language ?? requestLang();
  await consume('register', req.ip ?? 'ip', 10, 3600, tr`Too many accounts created from this network. Try again later.`);
  const problem = await nicknameProblem(b.nickname);
  if (problem) throw conflict(problem, 'nickname_taken', { nickname: problem });
  const exists = await one('SELECT 1 FROM users WHERE lower(email) = $1', [b.email]);
  if (exists) throw conflict(tr`An account with this email already exists. Log in instead.`, 'email_taken', { email: tr`An account with this email already exists.` });

  const hash = await hashPassword(b.password);
  const { userId, token } = await tx(async (t) => {
    const u = await one<{ id: string }>(
      `INSERT INTO users (email, password_hash, nickname, terms_version, privacy_version, terms_accepted_at, language)
       VALUES ($1,$2,$3,$4,$5, now(), $6) RETURNING id`,
      [b.email, hash, b.nickname, b.termsVersion, b.privacyVersion, language],
      t,
    );
    const ip = req.ip ?? null;
    const ua = req.get('user-agent') ?? null;
    await t.query(`INSERT INTO consent_log (user_id, kind, version, granted, ip, user_agent) VALUES ($1,'terms',$2,true,$3,$4),($1,'privacy',$5,true,$3,$4)`, [
      u!.id,
      b.termsVersion,
      ip,
      ua,
      b.privacyVersion,
    ]);
    const token = await issueOneTimeToken(u!.id, 'email_verify', 24 * 60, t);
    return { userId: u!.id, token };
  });
  void sendVerificationEmail(b.email, b.nickname, token, toLang(language));
  res.status(201);
  await sessionResponse(req, res, userId);
});

authRouter.post('/login', async (req, res) => {
  const b = body(req, z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) }));
  await consume('login-ip', req.ip ?? 'ip', 30, 900);
  await consume('login-email', b.email, 8, 900, tr`Too many attempts for this account. Wait 15 minutes or reset your password.`);
  const user = await one<{ id: string; password_hash: string; deleted_at: Date | null }>('SELECT id, password_hash, deleted_at FROM users WHERE lower(email) = $1', [b.email]);
  const ok = await verifyPassword(b.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || user.deleted_at || !ok) throw unauthorized(tr`Wrong email or password.`, 'invalid_credentials');
  await sessionResponse(req, res, user.id);
});

authRouter.post('/refresh', async (req, res) => {
  const raw = req.cookies?.[COOKIE];
  if (!raw) throw unauthorized(tr`Not signed in.`, 'no_session');
  const r = await rotateRefreshToken(raw, req.get('user-agent'));
  if (!r.ok) {
    clearSessionCookies(res);
    throw unauthorized(tr`Your session has expired. Sign in again.`, 'session_expired');
  }
  await sessionResponse(req, res, r.userId, r.token);
});

authRouter.post('/logout', async (req, res) => {
  const raw = req.cookies?.[COOKIE];
  if (raw) await revokeRefreshToken(raw);
  clearSessionCookies(res);
  res.json({ ok: true });
});

authRouter.post('/verify-email', async (req, res) => {
  const b = body(req, z.object({ token: z.string().min(10).max(200) }));
  await consume('verify', req.ip ?? 'ip', 20, 600);
  const userId = await consumeOneTimeToken(b.token, 'email_verify');
  if (!userId) throw badRequest(tr`This link is invalid or has expired. Request a new one.`, 'invalid_token');
  await one('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1 RETURNING id', [userId]);
  res.json({ ok: true });
});

authRouter.post('/resend-verification', requireAuth, async (req, res) => {
  const me = currentUser(req);
  await consume('resend', me.id, 3, 3600, tr`You can request at most 3 emails per hour.`);
  const u = await one('SELECT email, nickname, language, email_verified_at FROM users WHERE id = $1', [me.id]);
  if (u && !u.email_verified_at) {
    const token = await issueOneTimeToken(me.id, 'email_verify', 24 * 60);
    void sendVerificationEmail(u.email, u.nickname, token, toLang(u.language));
  }
  res.json({ ok: true });
});

authRouter.post('/forgot-password', async (req, res) => {
  const b = body(req, z.object({ email: z.string().trim().toLowerCase().max(200) }));
  await consume('forgot-ip', req.ip ?? 'ip', 10, 3600);
  await consume('forgot-email', b.email, 3, 3600, tr`Check your inbox; you can request at most 3 emails per hour.`);
  const u = await one('SELECT id, email, nickname, language FROM users WHERE lower(email) = $1 AND deleted_at IS NULL', [b.email]);
  if (u) {
    const token = await issueOneTimeToken(u.id, 'password_reset', 60);
    void sendPasswordResetEmail(u.email, u.nickname, token, toLang(u.language));
  }
  // Same answer whether or not the account exists.
  res.json({ ok: true });
});

authRouter.post('/reset-password', async (req, res) => {
  const b = body(req, z.object({ token: z.string().min(10).max(200), password }));
  await consume('reset', req.ip ?? 'ip', 20, 3600);
  const hash = await hashPassword(b.password);
  await tx(async (t) => {
    const userId = await consumeOneTimeToken(b.token, 'password_reset', t);
    if (!userId) throw badRequest(tr`This link is invalid or has expired. Request a new one.`, 'invalid_token');
    // Reaching the inbox proves the address too.
    await t.query('UPDATE users SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1', [userId, hash]);
    await revokeAllSessions(userId, t);
  });
  clearSessionCookies(res);
  res.json({ ok: true });
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const me = currentUser(req);
  const b = body(req, z.object({ currentPassword: z.string().max(200), newPassword: password }));
  await consume('change-pw', me.id, 5, 900);
  const u = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [me.id]);
  if (!u || !(await verifyPassword(b.currentPassword, u.password_hash))) {
    throw badRequest(tr`The current password is wrong.`, 'invalid_credentials', { currentPassword: tr`Wrong password` });
  }
  const hash = await hashPassword(b.newPassword);
  await tx(async (t) => {
    await t.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [me.id, hash]);
    await revokeAllSessions(me.id, t);
  });
  // Keep this device signed in with a fresh session.
  await sessionResponse(req, res, me.id);
});
