import { Router } from 'express';
import { z } from 'zod';
import { requireFeature } from '../auth/features.js';
import { currentUser, requireVerified } from '../auth/middleware.js';
import { many, one } from '../db.js';
import { notFound } from '../errors.js';
import { decodeCursor, encodeCursor } from '../lib/pagination.js';
import { body, idParam, isoDate, longText, queryOf, shortText } from '../lib/validate.js';
import * as dto from '../domain/serialize.js';
import { tr } from '../i18n/index.js';

export const newsRouter = Router();

export const NEWS_SELECT = `n.*, u.nickname AS author_nickname`;
const FROM = `FROM news n LEFT JOIN users u ON u.id = n.author_id`;
const PUBLISHED = `n.published_at IS NOT NULL AND n.published_at <= now()`;

/** Latest published news for the home page: pinned first, then newest. */
export async function latestNews(limit: number) {
  const rows = await many(`SELECT ${NEWS_SELECT} ${FROM} WHERE ${PUBLISHED} ORDER BY n.pinned DESC, n.published_at DESC LIMIT $1`, [limit]);
  return rows.map(dto.news);
}

const link = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^\/(?!\/)/.test(v) || /^https?:\/\//i.test(v), 'Use a full https:// address or an app path like /events/discover');

const newsInput = z.object({
  title: shortText(140).min(1, 'Enter a title'),
  summary: shortText(300),
  body: longText(20_000),
  category: z.enum(['update', 'sponsor', 'announcement', 'event']),
  imageUrl: z.string().max(500).startsWith('/api/files/', 'Upload the image first').nullable(),
  linkUrl: link.nullable(),
  linkLabel: shortText(40).nullable(),
  pinned: z.boolean(),
  /** null = draft. */
  publishedAt: isoDate.nullable(),
});

const COLUMNS: Record<keyof z.infer<typeof newsInput>, string> = {
  title: 'title',
  summary: 'summary',
  body: 'body',
  category: 'category',
  imageUrl: 'image_url',
  linkUrl: 'link_url',
  linkLabel: 'link_label',
  pinned: 'pinned',
  publishedAt: 'published_at',
};

async function newsById(id: string) {
  const row = await one(`SELECT ${NEWS_SELECT} ${FROM} WHERE n.id = $1`, [id]);
  if (!row) throw notFound(tr`News not found.`);
  return dto.news(row);
}

/** Published news, newest first. News editors (manage_news) with ?all=true also get drafts and scheduled posts. */
newsRouter.get('/', requireVerified, async (req, res) => {
  const me = currentUser(req);
  const q = queryOf(req, z.object({ cursor: z.string().optional(), all: z.enum(['true', 'false']).optional() }));
  const all = q.all === 'true' && me.features.manage_news;
  const c = decodeCursor(q.cursor);
  // Drafts have no published_at: they sort by creation time.
  const at = 'coalesce(n.published_at, n.created_at)';
  const where = [all ? 'true' : PUBLISHED];
  if (c) where.push(`(${at}, n.id) < ($1::timestamptz, $2::uuid)`);
  const rows = await many(
    `SELECT ${NEWS_SELECT}, ${at} AS sort_at ${FROM} WHERE ${where.join(' AND ')} ORDER BY ${at} DESC, n.id DESC LIMIT 21`,
    c ? [c.at, c.id] : [],
  );
  const hasMore = rows.length > 20;
  const items = rows.slice(0, 20);
  const last = items[items.length - 1];
  res.json({ items: items.map(dto.news), nextCursor: hasMore && last ? encodeCursor(last.sort_at, last.id) : null });
});

newsRouter.get('/:newsId', requireVerified, async (req, res) => {
  const me = currentUser(req);
  const n = await newsById(idParam(req, 'newsId'));
  const live = n.publishedAt !== null && Date.parse(n.publishedAt) <= Date.now();
  if (!live && !me.features.manage_news) throw notFound(tr`News not found.`);
  res.json(n);
});

newsRouter.post('/', requireVerified, requireFeature('manage_news'), async (req, res) => {
  const me = currentUser(req);
  const b = body(req, newsInput);
  const row = await one<{ id: string }>(
    `INSERT INTO news (title, summary, body, category, image_url, link_url, link_label, pinned, published_at, author_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [b.title, b.summary, b.body, b.category, b.imageUrl, b.linkUrl || null, b.linkLabel || null, b.pinned, b.publishedAt, me.id],
  );
  res.status(201).json(await newsById(row!.id));
});

newsRouter.patch('/:newsId', requireVerified, requireFeature('manage_news'), async (req, res) => {
  const id = idParam(req, 'newsId');
  const b = body(req, newsInput.partial());
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [k, col] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    if (b[k] === undefined) continue;
    params.push(k === 'linkUrl' || k === 'linkLabel' ? b[k] || null : b[k]);
    sets.push(`${col} = $${params.length}`);
  }
  if (sets.length) {
    const r = await many(`UPDATE news SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING id`, params);
    if (!r.length) throw notFound(tr`News not found.`);
  }
  res.json(await newsById(id));
});

newsRouter.delete('/:newsId', requireVerified, requireFeature('manage_news'), async (req, res) => {
  const r = await many('DELETE FROM news WHERE id = $1 RETURNING id', [idParam(req, 'newsId')]);
  if (!r.length) throw notFound(tr`News not found.`);
  res.json({ ok: true });
});
