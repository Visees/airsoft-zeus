import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireVerified, userIsAdmin } from '../auth/middleware.js';
import { config } from '../config.js';
import { many, one, tx } from '../db.js';
import { notify } from '../domain/journal.js';
import * as dto from '../domain/serialize.js';
import { forbidden, notFound } from '../errors.js';
import { consume } from '../lib/rate-limit.js';
import { decodeCursor, encodeCursor } from '../lib/pagination.js';
import { body, idParam, queryOf, shortText } from '../lib/validate.js';
import { sendSupportEmail } from '../mail.js';

/**
 * Support messages from the players to the platform admins (ADMIN_EMAILS): bugs, reports,
 * general messages. Each ticket is a private thread between its author and the admins.
 */
export const supportRouter = Router();
supportRouter.use(requireVerified);

const TICKET_SELECT = `t.*, u.nickname AS user_nickname,
  (SELECT count(*)::int FROM support_messages m WHERE m.ticket_id = t.id) AS message_count`;
const FROM = `FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id`;

const message = z.string().trim().min(1, 'Write a message').max(5000);

const ticketInput = z.object({
  category: z.enum(['bug', 'report', 'general']),
  subject: shortText(140).min(3, 'Write a short subject'),
  body: message,
  context: z
    .object({
      page: shortText(300).optional(),
      userAgent: shortText(400).optional(),
      screen: shortText(40).optional(),
    })
    .optional(),
});

/** The ticket if the viewer is its author or an admin; 404 otherwise (no existence leak). */
async function visibleTicket(id: string, userId: string) {
  const row = await one(`SELECT ${TICKET_SELECT} ${FROM} WHERE t.id = $1`, [id]);
  const admin = await userIsAdmin(userId);
  if (!row || (row.user_id !== userId && !admin)) throw notFound('Conversation not found.');
  return { row, admin };
}

/** `admin` = the viewer is a platform admin; `asStaff` = an admin answering someone else's ticket. */
async function ticketDetail(id: string, admin: boolean, viewerId: string) {
  const row = await one(`SELECT ${TICKET_SELECT} ${FROM} WHERE t.id = $1`, [id]);
  if (!row) throw notFound('Conversation not found.');
  const messages = await many(
    `SELECT m.*, u.nickname AS author_nickname FROM support_messages m LEFT JOIN users u ON u.id = m.author_id
     WHERE m.ticket_id = $1 ORDER BY m.created_at, m.id`,
    [id],
  );
  return { ...dto.supportTicket(row, admin), asStaff: admin && row.user_id !== viewerId, messages: messages.map(dto.supportMessage) };
}

/** My conversations; admins with ?all=true get every ticket, optionally filtered by status. */
supportRouter.get('/', async (req, res) => {
  const me = currentUser(req);
  const q = queryOf(
    req,
    z.object({ cursor: z.string().optional(), all: z.enum(['true', 'false']).optional(), status: z.enum(['open', 'answered', 'closed']).optional() }),
  );
  const all = q.all === 'true' && (await userIsAdmin(me.id));
  const c = decodeCursor(q.cursor);
  const where: string[] = [];
  const params: unknown[] = [];
  if (!all) {
    params.push(me.id);
    where.push(`t.user_id = $${params.length}`);
  }
  if (q.status) {
    params.push(q.status);
    where.push(`t.status = $${params.length}`);
  }
  if (c) {
    params.push(c.at, c.id);
    where.push(`(t.last_message_at, t.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const rows = await many(
    `SELECT ${TICKET_SELECT} ${FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.last_message_at DESC, t.id DESC LIMIT 21`,
    params,
  );
  const hasMore = rows.length > 20;
  const items = rows.slice(0, 20);
  const last = items[items.length - 1];
  res.json({ items: items.map((r) => dto.supportTicket(r, all)), nextCursor: hasMore && last ? encodeCursor(last.last_message_at, last.id) : null });
});

supportRouter.post('/', async (req, res) => {
  const me = currentUser(req);
  const b = body(req, ticketInput);
  await consume('support', me.id, 5, 3600, 'You sent several messages in the last hour. Try again later, or add to an open conversation.');
  const id = await tx(async (t) => {
    const ticket = await one<{ id: string }>(
      'INSERT INTO support_tickets (user_id, category, subject, context) VALUES ($1,$2,$3,$4) RETURNING id',
      [me.id, b.category, b.subject, JSON.stringify(b.context ?? {})],
      t,
    );
    await one('INSERT INTO support_messages (ticket_id, author_id, body) VALUES ($1,$2,$3) RETURNING id', [ticket!.id, me.id, b.body], t);
    return ticket!.id;
  });
  void sendSupportEmail(config.ADMIN_EMAILS, { id, subject: b.subject, category: b.category }, me.nickname, b.body);
  res.status(201).json(await ticketDetail(id, false, me.id));
});

supportRouter.get('/:ticketId', async (req, res) => {
  const me = currentUser(req);
  const { row, admin } = await visibleTicket(idParam(req, 'ticketId'), me.id);
  res.json(await ticketDetail(row.id, admin, me.id));
});

/**
 * Reply in the thread. An admin reply marks the ticket answered and notifies the author;
 * a reply from the author (re)opens it and emails the admins.
 */
supportRouter.post('/:ticketId/messages', async (req, res) => {
  const me = currentUser(req);
  const { row, admin } = await visibleTicket(idParam(req, 'ticketId'), me.id);
  const b = body(req, z.object({ body: message }));
  await consume('support-reply', me.id, 30, 3600);
  const fromAdmin = admin && row.user_id !== me.id;
  await tx(async (t) => {
    await one('INSERT INTO support_messages (ticket_id, author_id, from_admin, body) VALUES ($1,$2,$3,$4) RETURNING id', [row.id, me.id, fromAdmin, b.body], t);
    await one(`UPDATE support_tickets SET status = $2, last_message_at = now() WHERE id = $1 RETURNING id`, [row.id, fromAdmin ? 'answered' : 'open'], t);
    if (fromAdmin && row.user_id) {
      await notify(t, [row.user_id], {
        type: 'support_reply',
        title: `Reply from the AirsoftHub team: ${row.subject}`,
        body: b.body.length > 200 ? `${b.body.slice(0, 200)}…` : b.body,
        data: { ticketId: row.id },
        url: `/support/${row.id}`,
      });
    }
  });
  if (!fromAdmin) void sendSupportEmail(config.ADMIN_EMAILS, { id: row.id, subject: row.subject, category: row.category }, me.nickname, b.body);
  res.status(201).json(await ticketDetail(row.id, admin, me.id));
});

/** Close or reopen. The author can close their own ticket; admins can set any status. */
supportRouter.patch('/:ticketId', async (req, res) => {
  const me = currentUser(req);
  const { row, admin } = await visibleTicket(idParam(req, 'ticketId'), me.id);
  const b = body(req, z.object({ status: z.enum(['open', 'answered', 'closed']) }));
  if (!admin && b.status !== 'closed' && b.status !== 'open') throw forbidden('Only the AirsoftHub team can do that.');
  await one('UPDATE support_tickets SET status = $2 WHERE id = $1 RETURNING id', [row.id, b.status]);
  res.json(await ticketDetail(row.id, admin, me.id));
});
