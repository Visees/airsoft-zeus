import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth, requireVerified } from '../auth/middleware.js';
import { verifyPassword } from '../auth/password.js';
import { revokeAllSessions } from '../auth/tokens.js';
import { many, one, tx } from '../db.js';
import { badRequest, conflict } from '../errors.js';
import { decodeCursor, page } from '../lib/pagination.js';
import { consume } from '../lib/rate-limit.js';
import { body, playerRole, queryOf, shortText, uuid } from '../lib/validate.js';
import { sendAccountDeletedEmail } from '../mail.js';
import * as dto from '../domain/serialize.js';
import { clearSessionCookies, nicknameProblem } from './auth.js';
import { latestNews } from './news.js';
import { requestLang, tr } from '../i18n/index.js';

export const meRouter = Router();

async function meDto(userId: string) {
  const u = await one('SELECT * FROM users WHERE id = $1', [userId]);
  const badges = await many('SELECT * FROM user_badges WHERE user_id = $1 ORDER BY awarded_at', [userId]);
  return dto.meUser(u!, badges);
}

meRouter.get('/', requireAuth, async (req, res) => {
  res.json(await meDto(currentUser(req).id));
});

const emergency = z.object({ name: shortText(80), phone: shortText(40), relation: shortText(60) });

meRouter.patch('/', requireAuth, async (req, res) => {
  const me = currentUser(req);
  const b = body(
    req,
    z
      .object({
        firstName: shortText(80).nullable(),
        lastName: shortText(80).nullable(),
        dateOfBirth: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
          .refine((d) => Date.parse(d) < Date.now() && Date.parse(d) > Date.parse('1900-01-01'), 'Enter a real date of birth')
          .nullable(),
        country: shortText(60).nullable(),
        language: z.enum(['en', 'it', 'de', 'fr', 'es']),
        avatarUrl: z.string().max(500).startsWith('/api/files/', 'Upload the picture first').nullable(),
        clubId: uuid.nullable(),
        clubName: shortText(100).nullable(),
        playerRole,
        customRole: shortText(40).nullable(),
        bio: z.string().max(280).nullable(),
        emergencyContact: emergency.nullable(),
        emergencyContactEnabled: z.boolean(),
        privacy: z.object({ showClub: z.boolean(), showStats: z.boolean(), showRole: z.boolean(), showCountry: z.boolean(), shareEmergencyWithGm: z.boolean() }).partial(),
        locationRetentionDays: z.number().int().min(1).max(365),
        onboardingDone: z.boolean(),
      })
      .partial(),
  );
  const map: Record<string, string> = {
    firstName: 'first_name',
    lastName: 'last_name',
    dateOfBirth: 'date_of_birth',
    country: 'country',
    language: 'language',
    avatarUrl: 'avatar_url',
    clubId: 'club_id',
    clubName: 'club_name',
    playerRole: 'player_role',
    customRole: 'custom_role',
    bio: 'bio',
    emergencyContactEnabled: 'emergency_contact_enabled',
    locationRetentionDays: 'location_retention_days',
    onboardingDone: 'onboarding_done',
  };
  const sets: string[] = [];
  const params: unknown[] = [me.id];
  for (const [k, col] of Object.entries(map)) {
    const v = (b as Record<string, unknown>)[k];
    if (v !== undefined) {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (b.clubId) {
    const c = await one('SELECT name FROM clubs WHERE id = $1', [b.clubId]);
    if (!c) throw badRequest(tr`Club not found.`, 'invalid_argument', { clubId: tr`Club not found` });
    params.push(c.name);
    sets.push(`club_name = $${params.length}`);
  }
  if (b.emergencyContact !== undefined) {
    params.push(b.emergencyContact ? JSON.stringify(b.emergencyContact) : null);
    sets.push(`emergency_contact = $${params.length}`);
  }
  if (b.privacy) {
    params.push(JSON.stringify(b.privacy));
    sets.push(`privacy = privacy || $${params.length}::jsonb`);
  }
  if (sets.length) await one(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING id`, params);
  // Keep the copy GMs see in sync with the opt-in.
  await one(
    `UPDATE event_members m SET emergency_contact = CASE WHEN (u.privacy->>'shareEmergencyWithGm')::boolean AND u.emergency_contact_enabled THEN u.emergency_contact ELSE NULL END
       FROM users u WHERE u.id = m.user_id AND m.user_id = $1 AND m.status IN ('pending','approved') RETURNING m.user_id`,
    [me.id],
  );
  res.json(await meDto(me.id));
});

meRouter.post('/nickname', requireAuth, async (req, res) => {
  const me = currentUser(req);
  const b = body(req, z.object({ nickname: z.string().trim().max(40) }));
  await consume('nick-change', me.id, 5, 86400, tr`You can change your nickname at most 5 times a day.`);
  const problem = await nicknameProblem(b.nickname, me.id);
  if (problem) throw conflict(problem, 'nickname_taken', { nickname: problem });
  await one('UPDATE users SET nickname = $2, updated_at = now() WHERE id = $1 RETURNING id', [me.id, b.nickname]);
  res.json(await meDto(me.id));
});

meRouter.post('/consents', requireAuth, async (req, res) => {
  const me = currentUser(req);
  const b = body(
    req,
    z.object({
      kind: z.enum(['terms', 'privacy', 'location', 'notifications', 'emergency_share', 'tracking']),
      granted: z.boolean(),
      version: z.string().max(40).optional(),
      eventId: uuid.optional(),
    }),
  );
  await tx(async (t) => {
    await t.query('INSERT INTO consent_log (user_id, kind, version, granted, event_id, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      me.id,
      b.kind,
      b.version ?? null,
      b.granted,
      b.eventId ?? null,
      req.ip ?? null,
      req.get('user-agent') ?? null,
    ]);
    if (b.granted && (b.kind === 'terms' || b.kind === 'privacy')) {
      const col = b.kind === 'terms' ? 'terms_version' : 'privacy_version';
      await t.query(`UPDATE users SET ${col} = $2 WHERE id = $1`, [me.id, b.version ?? null]);
      await t.query(`UPDATE users SET terms_accepted_at = now() WHERE id = $1 AND terms_version IS NOT NULL AND privacy_version IS NOT NULL`, [me.id]);
    }
  });
  res.json({ ok: true });
});

/**
 * Notifications shown on the home page: about events (new, invitations, registrations, starting,
 * live, ended, cancelled). In-game ones (captures, perks, GM messages…) stay in the live screens
 * and on the notifications page.
 */
const HOME_NOTIFICATION_TYPES = [
  'event_published',
  'event_invitation',
  'registration_approved',
  'registration_rejected',
  'team_assigned',
  'event_starting_soon',
  'game_started',
  'game_ended',
  'event_cancelled',
  'event_removed',
  'removed_from_event',
  'support_reply',
];

meRouter.get('/home', requireVerified, async (req, res) => {
  const me = currentUser(req);
  const rows = await many(
    `SELECT ${dto.EVENT_SUMMARY_SELECT} FROM events e
      WHERE e.owner_id = $1 OR EXISTS (SELECT 1 FROM event_members m WHERE m.event_id = e.id AND m.user_id = $1 AND m.status IN ('invited','pending','approved'))
      ORDER BY e.start_at`,
    [me.id],
  );
  const events = rows.map(dto.eventSummary);
  const playing = events.filter((e) => !e.isGm && e.myStatus === 'approved');
  const now = Date.now();
  const activeEvent =
    events.find((e) => ['live', 'paused'].includes(e.status) && (e.myStatus === 'approved' || e.isGm)) ??
    events.find((e) => e.status === 'lobby' && (e.myStatus === 'approved' || e.isGm)) ??
    null;
  const nextEvent =
    playing.find((e) => ['published', 'registration_open', 'lobby'].includes(e.status) && Date.parse(e.endAt) > now && e.id !== activeEvent?.id) ?? null;
  const user = await one('SELECT stats FROM users WHERE id = $1', [me.id]);
  const notes = await many('SELECT * FROM notifications WHERE user_id = $1 AND type = ANY($2::text[]) ORDER BY created_at DESC LIMIT 5', [me.id, HOME_NOTIFICATION_TYPES]);
  const unread = await one<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = ANY($2::text[]) AND read_at IS NULL', [
    me.id,
    HOME_NOTIFICATION_TYPES,
  ]);
  const gmEvents = events.filter((e) => e.isGm);
  const pending = await many<{ event_id: string; name: string; n: number }>(
    `SELECT e.id AS event_id, e.name, count(*)::int AS n FROM event_members m JOIN events e ON e.id = m.event_id
      WHERE m.status = 'pending' AND e.id = ANY($1::uuid[]) GROUP BY e.id, e.name`,
    [gmEvents.map((e) => e.id)],
  );
  res.json({
    activeEvent,
    nextEvent,
    invitations: events.filter((e) => e.myStatus === 'invited'),
    recentEvents: playing.filter((e) => e.status === 'completed').reverse().slice(0, 5),
    stats: { gamesPlayed: 0, objectivesCaptured: 0, totalPoints: 0, wins: 0, losses: 0, draws: 0, ...(user?.stats ?? {}) },
    unreadNotifications: unread?.n ?? 0,
    latestNotifications: notes.map(dto.notification),
    news: await latestNews(3),
    gm: gmEvents.length
      ? {
          drafts: gmEvents.filter((e) => e.status === 'draft'),
          published: gmEvents.filter((e) => ['published', 'registration_open', 'lobby'].includes(e.status)),
          live: gmEvents.filter((e) => ['live', 'paused'].includes(e.status)),
          pendingApprovals: pending.map((p) => ({ eventId: p.event_id, eventName: p.name, count: p.n })),
        }
      : null,
  });
});

meRouter.get('/stats', requireAuth, async (req, res) => {
  const me = currentUser(req);
  const u = await one('SELECT stats FROM users WHERE id = $1', [me.id]);
  const badges = await many('SELECT * FROM user_badges WHERE user_id = $1 ORDER BY awarded_at', [me.id]);
  const history = await many(
    `SELECT e.id, e.name, e.ended_at, e.winner_team_id, t.name AS team_name, t.color AS team_color, m.team_id, m.points, m.captures
       FROM event_members m JOIN events e ON e.id = m.event_id LEFT JOIN teams t ON t.id = m.team_id
      WHERE m.user_id = $1 AND (m.role = 'player' OR m.team_id IS NOT NULL) AND e.status = 'completed' ORDER BY e.ended_at DESC LIMIT 100`,
    [me.id],
  );
  res.json({
    stats: { gamesPlayed: 0, objectivesCaptured: 0, totalPoints: 0, wins: 0, losses: 0, draws: 0, ...(u?.stats ?? {}) },
    badges: badges.map(dto.badge),
    history: history.map((h) => ({
      eventId: h.id,
      eventName: h.name,
      endedAt: dto.iso(h.ended_at),
      teamName: h.team_name,
      teamColor: h.team_color,
      result: !h.team_id ? null : !h.winner_team_id ? 'draw' : h.winner_team_id === h.team_id ? 'win' : 'loss',
      points: Number(h.points),
      captures: h.captures,
    })),
  });
});

meRouter.get('/notifications', requireAuth, async (req, res) => {
  const me = currentUser(req);
  const q = queryOf(req, z.object({ cursor: z.string().optional() }));
  const c = decodeCursor(q.cursor);
  const rows = await many(
    `SELECT * FROM notifications WHERE user_id = $1 ${c ? 'AND (created_at, id) < ($2::timestamptz, $3::uuid)' : ''} ORDER BY created_at DESC, id DESC LIMIT 31`,
    c ? [me.id, c.at, c.id] : [me.id],
  );
  res.json(page(rows, 30, dto.notification));
});

meRouter.get('/notifications/unread-count', requireAuth, async (req, res) => {
  const row = await one<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [currentUser(req).id]);
  res.json({ unread: row?.n ?? 0 });
});

meRouter.post('/notifications/read', requireAuth, async (req, res) => {
  const me = currentUser(req);
  const b = body(req, z.object({ ids: z.array(uuid).max(200).optional(), all: z.boolean().optional() }));
  if (b.all) await many('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL RETURNING id', [me.id]);
  else if (b.ids?.length) await many('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) RETURNING id', [me.id, b.ids]);
  res.json({ ok: true });
});

meRouter.post('/push-subscriptions', requireAuth, async (req, res) => {
  const me = currentUser(req);
  // A browser sends its Web Push subscription; the native apps send their FCM token.
  const b = body(
    req,
    z.union([
      z.object({ endpoint: z.string().url().max(1000).startsWith('https://'), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }),
      z.object({ fcmToken: z.string().min(20).max(1000).regex(/^[\w:.-]+$/) }),
    ]),
  );
  const [kind, endpoint, p256dh, auth] = 'fcmToken' in b ? ['fcm', b.fcmToken, null, null] : ['web', b.endpoint, b.keys.p256dh, b.keys.auth];
  await one(
    `INSERT INTO push_subscriptions (user_id, kind, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, kind = EXCLUDED.kind, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth RETURNING id`,
    [me.id, kind, endpoint, p256dh, auth, req.get('user-agent')?.slice(0, 300) ?? null],
  );
  res.json({ ok: true });
});

meRouter.delete('/push-subscriptions', requireAuth, async (req, res) => {
  const me = currentUser(req);
  const b = body(req, z.object({ endpoint: z.string().max(1000) }));
  await many('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2 RETURNING id', [me.id, b.endpoint]);
  res.json({ ok: true });
});

/** GDPR export: everything stored about the user, as JSON. */
meRouter.get('/export', requireAuth, async (req, res) => {
  const me = currentUser(req);
  await consume('export', me.id, 5, 3600);
  const user = await one('SELECT * FROM users WHERE id = $1', [me.id]);
  delete user!.password_hash;
  delete user!.token_version;
  const data = {
    exportedAt: new Date().toISOString(),
    user,
    badges: await many('SELECT code, event_id, awarded_at FROM user_badges WHERE user_id = $1', [me.id]),
    consents: await many('SELECT kind, version, granted, event_id, created_at FROM consent_log WHERE user_id = $1 ORDER BY created_at', [me.id]),
    memberships: await many(
      `SELECT e.name AS event, m.role, m.status, m.player_role, m.points, m.captures, m.currency_earned, m.joined_at
         FROM event_members m JOIN events e ON e.id = m.event_id WHERE m.user_id = $1`,
      [me.id],
    ),
    captures: await many(
      `SELECT e.name AS event, o.name AS objective, c.method, c.points, c.currency, c.created_at
         FROM objective_captures c JOIN objectives o ON o.id = c.objective_id JOIN events e ON e.id = c.event_id WHERE c.user_id = $1`,
      [me.id],
    ),
    locationHistory: await many('SELECT event_id, lat, lng, accuracy, sample_at FROM location_history WHERE user_id = $1 ORDER BY sample_at', [me.id]),
    notifications: await many('SELECT type, title, body, created_at, read_at FROM notifications WHERE user_id = $1', [me.id]),
    pushSubscriptions: await many('SELECT endpoint, created_at FROM push_subscriptions WHERE user_id = $1', [me.id]),
    eventsOwned: await many('SELECT id, name, status, start_at FROM events WHERE owner_id = $1', [me.id]),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="airsofthub-data.json"');
  res.json(data);
});

/**
 * Account deletion: personal data is erased, the row is kept as an anonymous "Deleted player"
 * so ledgers and results stay consistent. Location history and push subscriptions are deleted.
 */
meRouter.delete('/', requireAuth, async (req, res) => {
  const me = currentUser(req);
  const b = body(req, z.object({ password: z.string().max(200), confirm: z.literal('DELETE') }));
  await consume('delete-account', me.id, 5, 3600);
  const u = await one('SELECT email, password_hash FROM users WHERE id = $1', [me.id]);
  if (!u || !(await verifyPassword(b.password, u.password_hash))) throw badRequest(tr`The password is wrong.`, 'invalid_credentials', { password: tr`Wrong password` });
  const owned = await one<{ n: number }>(`SELECT count(*)::int AS n FROM events WHERE owner_id = $1 AND status IN ('live','paused','lobby')`, [me.id]);
  if (owned?.n) throw conflict(tr`You are running an event right now. End or cancel it first.`, 'running_event');
  await tx(async (t) => {
    await t.query('DELETE FROM location_history WHERE user_id = $1', [me.id]);
    await t.query('DELETE FROM player_locations WHERE user_id = $1', [me.id]);
    await t.query('DELETE FROM push_subscriptions WHERE user_id = $1', [me.id]);
    await t.query('DELETE FROM notifications WHERE user_id = $1', [me.id]);
    await t.query(`UPDATE event_members SET status = 'left', emergency_contact = NULL, tracking_active = false WHERE user_id = $1 AND status IN ('invited','pending','approved')`, [me.id]);
    await revokeAllSessions(me.id, t);
    await t.query(
      `UPDATE users SET email = 'deleted-' || id || '@invalid', password_hash = 'deleted', nickname = 'deleted-' || substr(md5(id::text), 1, 12),
              first_name = NULL, last_name = NULL, date_of_birth = NULL, country = NULL, avatar_url = NULL, club_id = NULL, club_name = NULL,
              bio = NULL, emergency_contact = NULL, emergency_contact_enabled = false, custom_role = NULL, deleted_at = now(), updated_at = now()
        WHERE id = $1`,
      [me.id],
    );
  });
  void sendAccountDeletedEmail(u.email, requestLang());
  clearSessionCookies(res);
  res.json({ ok: true });
});
