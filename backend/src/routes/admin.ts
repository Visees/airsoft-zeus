import { Router } from 'express';
import { z } from 'zod';
import { cleanOverrides, FEATURE_KEYS, FEATURES, type Feature } from '../auth/features.js';
import { currentUser, isAdminEmail } from '../auth/middleware.js';
import { config } from '../config.js';
import { many, one, tx, type Row } from '../db.js';
import { audit } from '../domain/journal.js';
import * as dto from '../domain/serialize.js';
import { conflict, notFound } from '../errors.js';
import { decodeCursor, page } from '../lib/pagination.js';
import { body, idParam, queryOf } from '../lib/validate.js';
import { tr } from '../i18n/index.js';

/**
 * Platform admin dashboard (ADMIN_EMAILS). Mounted behind requireAdmin. Ticket and News lists come
 * from /support?all=true and /news?all=true; this adds the counters and the user directory.
 */
export const adminRouter = Router();

adminRouter.get('/overview', async (_req, res) => {
  const tickets = await one<{ open: number; answered: number; closed: number; open_bugs: number }>(
    `SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
            count(*) FILTER (WHERE status = 'answered')::int AS answered,
            count(*) FILTER (WHERE status = 'closed')::int AS closed,
            count(*) FILTER (WHERE status = 'open' AND category = 'bug')::int AS open_bugs
     FROM support_tickets`,
  );
  const news = await one<{ drafts: number; scheduled: number; published: number }>(
    `SELECT count(*) FILTER (WHERE published_at IS NULL)::int AS drafts,
            count(*) FILTER (WHERE published_at > now())::int AS scheduled,
            count(*) FILTER (WHERE published_at <= now())::int AS published
     FROM news`,
  );
  const users = await one<{ total: number; new_week: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new_week
     FROM users WHERE deleted_at IS NULL`,
  );
  res.json({
    users: { total: users!.total, newThisWeek: users!.new_week },
    tickets: { open: tickets!.open, answered: tickets!.answered, closed: tickets!.closed, openBugs: tickets!.open_bugs },
    news: { drafts: news!.drafts, scheduled: news!.scheduled, published: news!.published },
  });
});

// ------------------------------------------------------------------ users

/** Last refresh-token rotation: the app refreshes on start and every few minutes while open. */
const LAST_ACTIVE = `(SELECT max(a.created_at) FROM auth_tokens a WHERE a.user_id = u.id AND a.kind = 'refresh') AS last_active_at`;

function userSummary(u: Row) {
  return {
    id: u.id,
    nickname: u.nickname,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    avatarUrl: u.avatar_url,
    emailVerified: !!u.email_verified_at,
    isAdmin: isAdminEmail(u.email),
    customAccess: Object.keys(cleanOverrides(u.features)).length > 0,
    createdAt: dto.iso(u.created_at)!,
    lastActiveAt: dto.iso(u.last_active_at),
  };
}

/** Every account (deleted ones excluded), newest first. `q` searches nickname, email and name. */
adminRouter.get('/users', async (req, res) => {
  const q = queryOf(
    req,
    z.object({
      q: z.string().max(80).optional(),
      filter: z.enum(['all', 'unverified', 'admins', 'custom']).default('all'),
      cursor: z.string().optional(),
    }),
  );
  const c = decodeCursor(q.cursor);
  const params: unknown[] = [];
  const where = ['u.deleted_at IS NULL'];
  const term = q.q?.trim();
  if (term) {
    params.push(term);
    const p = `$${params.length}`;
    where.push(`(u.nickname ILIKE '%' || ${p} || '%' OR u.email ILIKE '%' || ${p} || '%' OR concat_ws(' ', u.first_name, u.last_name) ILIKE '%' || ${p} || '%')`);
  }
  if (q.filter === 'unverified') where.push('u.email_verified_at IS NULL');
  if (q.filter === 'custom') where.push(`u.features <> '{}'::jsonb`);
  if (q.filter === 'admins') {
    params.push(config.ADMIN_EMAILS);
    where.push(`lower(u.email) = ANY($${params.length}::text[])`);
  }
  if (c) {
    params.push(c.at, c.id);
    where.push(`(u.created_at, u.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const rows = await many(`SELECT u.*, ${LAST_ACTIVE} FROM users u WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC, u.id DESC LIMIT 21`, params);
  res.json(page(rows, 20, userSummary));
});

async function userDetail(userId: string) {
  const u = await one(`SELECT u.*, ${LAST_ACTIVE} FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`, [userId]);
  if (!u) throw notFound(tr`Player not found.`);
  const counts = await one<{ played: number; run: number; tickets: number }>(
    `SELECT
       (SELECT count(*)::int FROM event_members m WHERE m.user_id = $1 AND m.role = 'player' AND m.status IN ('approved','left','removed','banned')) AS played,
       (SELECT count(*)::int FROM events e WHERE e.owner_id = $1 OR EXISTS (
          SELECT 1 FROM event_members m WHERE m.event_id = e.id AND m.user_id = $1 AND m.role = 'gm' AND m.status = 'approved')) AS run,
       (SELECT count(*)::int FROM support_tickets t WHERE t.user_id = $1) AS tickets`,
    [userId],
  );
  const events = await many(
    `SELECT e.id, e.name, e.status, e.start_at, m.role, m.status AS member_status
       FROM event_members m JOIN events e ON e.id = m.event_id
      WHERE m.user_id = $1 ORDER BY e.start_at DESC LIMIT 10`,
    [userId],
  );
  const me = dto.meUser(u, []);
  const overrides = cleanOverrides(u.features);
  return {
    ...userSummary(u),
    country: u.country,
    language: u.language,
    clubId: u.club_id,
    clubName: u.club_name,
    playerRole: u.player_role,
    termsAccepted: me.termsAccepted,
    onboardingDone: me.onboardingDone,
    stats: me.stats,
    counts: { eventsPlayed: counts!.played, eventsRun: counts!.run, supportTickets: counts!.tickets },
    features: FEATURE_KEYS.map((key) => ({ key, enabled: me.features[key], default: FEATURES[key].default, custom: key in overrides })),
    recentEvents: events.map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status,
      startAt: dto.iso(e.start_at)!,
      role: e.role,
      memberStatus: e.member_status,
    })),
  };
}

adminRouter.get('/users/:userId', async (req, res) => {
  res.json(await userDetail(idParam(req, 'userId')));
});

const featureChanges = z.object({
  features: z.partialRecord(z.enum(FEATURE_KEYS as [Feature, ...Feature[]]), z.boolean().nullable()),
});

/**
 * Switch features on or off for one user: `{ features: { create_events: false } }`. A value equal
 * to the default (or null) removes the override, so the user follows the default again.
 * Takes effect on the user's next request; their app shows it after its next refresh.
 */
adminRouter.patch('/users/:userId/features', async (req, res) => {
  const me = currentUser(req);
  const userId = idParam(req, 'userId');
  const b = body(req, featureChanges);
  await tx(async (t) => {
    const u = await one<{ email: string; features: unknown }>('SELECT email, features FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [userId], t);
    if (!u) throw notFound(tr`Player not found.`);
    if (isAdminEmail(u.email)) throw conflict(tr`Platform admins always have every feature.`, 'admin_user');
    const before = cleanOverrides(u.features);
    const merged: Record<string, boolean | null | undefined> = { ...before, ...b.features };
    const after = cleanOverrides(Object.fromEntries(Object.entries(merged).filter(([, v]) => typeof v === 'boolean')));
    await t.query('UPDATE users SET features = $2, updated_at = now() WHERE id = $1', [userId, JSON.stringify(after)]);
    await audit(t, null, me.id, 'user.features', { type: 'user', id: userId, before, after });
  });
  res.json(await userDetail(userId));
});
