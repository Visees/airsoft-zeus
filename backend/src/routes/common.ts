import { Router } from 'express';
import multer from 'multer';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { currentUser, requireVerified } from '../auth/middleware.js';
import { config } from '../config.js';
import { many, one } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { randomToken } from '../lib/ids.js';
import { consume } from '../lib/rate-limit.js';
import { body, idParam, queryOf, shortText, uuid } from '../lib/validate.js';
import { computeResults } from '../domain/results.js';
import * as dto from '../domain/serialize.js';

export const commonRouter = Router();
export const uploadDir = resolve(config.UPLOAD_DIR);

commonRouter.get('/config', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    googleMapsApiKey: config.GOOGLE_MAPS_API_KEY,
    googleMapsMapId: config.GOOGLE_MAPS_MAP_ID || null,
    vapidPublicKey: config.VAPID_PUBLIC_KEY || null,
    termsVersion: config.TERMS_VERSION,
    privacyVersion: config.PRIVACY_VERSION,
    maxUploadBytes: config.MAX_UPLOAD_BYTES,
  });
});

// ---------------------------------------------------------------- profiles, clubs

commonRouter.get('/users/:userId/profile', requireVerified, async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id = $1', [idParam(req, 'userId')]);
  if (!u) throw notFound('Player not found.');
  const badges = await many('SELECT * FROM user_badges WHERE user_id = $1 ORDER BY awarded_at', [u.id]);
  res.json(dto.publicProfile(u, badges));
});

const CLUB_SELECT = `c.*, (SELECT count(*) FROM users u WHERE u.club_id = c.id AND u.deleted_at IS NULL) AS member_count`;

commonRouter.get('/clubs', requireVerified, async (req, res) => {
  const q = queryOf(req, z.object({ q: z.string().max(80).optional() }));
  const rows = await many(
    `SELECT ${CLUB_SELECT} FROM clubs c WHERE ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%') ORDER BY c.name LIMIT 30`,
    [q.q?.trim() || null],
  );
  res.json(rows.map((c) => dto.club(c)));
});

commonRouter.get('/clubs/:clubId', requireVerified, async (req, res) => {
  const c = await one(`SELECT ${CLUB_SELECT} FROM clubs c WHERE c.id = $1`, [idParam(req, 'clubId')]);
  if (!c) throw notFound('Club not found.');
  const members = await many(`SELECT id, nickname, avatar_url, player_role, privacy FROM users WHERE club_id = $1 AND deleted_at IS NULL AND (privacy->>'showClub')::boolean IS NOT FALSE ORDER BY nickname LIMIT 200`, [c.id]);
  res.json(dto.club(c, members));
});

const clubInput = z.object({
  name: shortText(100).min(2, 'At least 2 characters'),
  country: shortText(60).nullable().optional(),
  city: shortText(80).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  logoUrl: z.string().max(500).startsWith('/api/files/').nullable().optional(),
  website: z.string().url().max(300).nullable().optional().or(z.literal('').transform(() => null)),
});

commonRouter.post('/clubs', requireVerified, async (req, res) => {
  const me = currentUser(req);
  const b = body(req, clubInput);
  await consume('club-create', me.id, 5, 86400);
  const exists = await one('SELECT 1 FROM clubs WHERE lower(name) = lower($1)', [b.name]);
  if (exists) throw badRequest('A club with this name already exists.', 'club_exists', { name: 'Already exists' });
  const c = await one(
    `INSERT INTO clubs (name, country, city, description, logo_url, website, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.name, b.country ?? null, b.city ?? null, b.description ?? null, b.logoUrl ?? null, b.website ?? null, me.id],
  );
  await one('UPDATE users SET club_id = $2, club_name = $3 WHERE id = $1 RETURNING id', [me.id, c!.id, c!.name]);
  res.status(201).json(dto.club({ ...c, member_count: 1 }));
});

commonRouter.patch('/clubs/:clubId', requireVerified, async (req, res) => {
  const me = currentUser(req);
  const id = idParam(req, 'clubId');
  const c = await one('SELECT owner_id FROM clubs WHERE id = $1', [id]);
  if (!c) throw notFound('Club not found.');
  if (c.owner_id !== me.id) throw forbidden('Only the club owner can edit it.');
  const b = body(req, clubInput.partial());
  const cols: Record<string, string> = { name: 'name', country: 'country', city: 'city', description: 'description', logoUrl: 'logo_url', website: 'website' };
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [k, col] of Object.entries(cols)) {
    const v = (b as Record<string, unknown>)[k];
    if (v !== undefined) {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    }
  }
  const row = await one(`UPDATE clubs SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 RETURNING *`, params);
  await one('UPDATE users SET club_name = $2 WHERE club_id = $1 RETURNING id', [id, row!.name]);
  const full = await one(`SELECT ${CLUB_SELECT} FROM clubs c WHERE c.id = $1`, [id]);
  res.json(dto.club(full!));
});

// ---------------------------------------------------------------- uploads

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 } });

/** Detect the real type from the file's first bytes; the client's MIME type is not trusted. */
function sniff(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' };
  return null;
}

const PURPOSES = ['avatar', 'cover', 'team_icon', 'objective_image', 'objective_document', 'poi_image', 'club_logo'] as const;

commonRouter.post('/uploads', requireVerified, upload.single('file'), async (req, res) => {
  const me = currentUser(req);
  await consume('upload', me.id, 60, 3600, 'Too many uploads. Try again later.');
  const purpose = z.enum(PURPOSES).safeParse(req.body?.purpose);
  if (!purpose.success) throw badRequest('Unknown upload purpose.');
  const file = req.file;
  if (!file) throw badRequest('Choose a file to upload.', 'no_file');
  const kind = sniff(file.buffer);
  const allowPdf = purpose.data === 'objective_document';
  if (!kind || (kind.ext === 'pdf' && !allowPdf)) {
    throw badRequest(allowPdf ? 'Upload a JPEG, PNG, WebP or PDF file.' : 'Upload a JPEG, PNG or WebP image.', 'unsupported_type');
  }
  await mkdir(uploadDir, { recursive: true });
  const name = `${purpose.data}-${randomToken(18)}.${kind.ext}`;
  await writeFile(resolve(uploadDir, name), file.buffer, { flag: 'wx' });
  res.status(201).json({ url: `/api/files/${name}` });
});

commonRouter.get('/files/:name', (req, res) => {
  const name = req.params.name;
  if (!/^[a-z_]+-[A-Za-z0-9_-]{24}\.(jpg|png|webp|pdf)$/.test(name)) throw notFound();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.sendFile(name, { root: uploadDir, maxAge: '365d', immutable: true }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: { code: 'not_found', message: 'File not found.' } });
  });
});

// ---------------------------------------------------------------- reports, public results, templates

commonRouter.post('/reports', requireVerified, async (req, res) => {
  const me = currentUser(req);
  const b = body(req, z.object({ eventId: uuid.optional(), targetUserId: uuid.optional(), reason: shortText(80).min(2), details: z.string().max(2000).optional() }));
  await consume('report', me.id, 10, 3600);
  await one('INSERT INTO reports (reporter_id, event_id, target_user_id, reason, details) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
    me.id,
    b.eventId ?? null,
    b.targetUserId ?? null,
    b.reason,
    b.details ?? '',
  ]);
  res.status(201).json({ ok: true });
});

commonRouter.get('/public/results/:token', async (req, res) => {
  const token = req.params.token;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound('These results are not published.');
  const ev = await one<{ id: string }>('SELECT id FROM events WHERE results_token = $1 AND results_published_at IS NOT NULL', [token]);
  if (!ev) throw notFound('These results are not published.');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(await computeResults(ev.id, { publicView: true }));
});

commonRouter.get('/templates/events', requireVerified, async (req, res) => {
  const rows = await many(`SELECT id, name, created_at, data->'event'->>'game_mode' AS game_mode FROM event_templates WHERE owner_id = $1 ORDER BY created_at DESC`, [
    currentUser(req).id,
  ]);
  res.json(rows.map((r) => ({ id: r.id, name: r.name, createdAt: dto.iso(r.created_at), gameMode: r.game_mode ?? 'custom' })));
});

commonRouter.delete('/templates/events/:id', requireVerified, async (req, res) => {
  await one('DELETE FROM event_templates WHERE id = $1 AND owner_id = $2 RETURNING id', [idParam(req, 'id'), currentUser(req).id]);
  res.json({ ok: true });
});

commonRouter.get('/templates/maps', requireVerified, async (req, res) => {
  const rows = await many(`SELECT id, name, created_at, data FROM map_templates WHERE owner_id = $1 ORDER BY created_at DESC`, [currentUser(req).id]);
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: dto.iso(r.created_at),
      zoneCount: r.data?.zones?.length ?? 0,
      poiCount: r.data?.pois?.length ?? 0,
      objectiveCount: r.data?.objectives?.length ?? 0,
    })),
  );
});

commonRouter.delete('/templates/maps/:id', requireVerified, async (req, res) => {
  await one('DELETE FROM map_templates WHERE id = $1 AND owner_id = $2 RETURNING id', [idParam(req, 'id'), currentUser(req).id]);
  res.json({ ok: true });
});
