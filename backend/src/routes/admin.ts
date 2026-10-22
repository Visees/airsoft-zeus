import { Router } from 'express';
import { one } from '../db.js';

/**
 * Platform admin dashboard (ADMIN_EMAILS). Mounted behind requireAdmin. The lists themselves come
 * from /support?all=true and /news?all=true; this only adds the counters.
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
  res.json({
    tickets: { open: tickets!.open, answered: tickets!.answered, closed: tickets!.closed, openBugs: tickets!.open_bugs },
    news: { drafts: news!.drafts, scheduled: news!.scheduled, published: news!.published },
  });
});
