import { many, type Tx } from '../db.js';
import { sendPush } from '../push.js';
import { type Lang, type Msg, render, renderAll, toLang } from '../i18n/index.js';
import { hub } from '../realtime/hub.js';
import * as dto from './serialize.js';

/**
 * Writers for the activity feed, GM alerts, audit log and notifications. Each writes in the
 * caller's transaction and pushes to sockets / Web Push only after the commit.
 */

export interface ActivityInput {
  type: string;
  message: Msg;
  scope?: 'all' | 'team' | 'gm';
  teamId?: string | null;
  userId?: string | null;
  objectiveId?: string | null;
  data?: Record<string, unknown>;
}

export async function activity(t: Tx, eventId: string, a: ActivityInput): Promise<void> {
  const scope = a.scope ?? 'all';
  const { rows } = await t.query(
    `INSERT INTO activity (event_id, type, message, scope, team_id, user_id, objective_id, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [eventId, a.type, render(a.message, 'en'), scope, a.teamId ?? null, a.userId ?? null, a.objectiveId ?? null, JSON.stringify(withMessages(a.data, a.message))],
  );
  const item = dto.activity(rows[0]);
  t.afterCommit(() => {
    if (scope === 'all') hub.emit(eventId, 'activity', { eventId, item });
    else if (scope === 'team') hub.emit(eventId, 'activity', { eventId, item }, ['gm', { teamId: a.teamId ?? null }]);
    else hub.emit(eventId, 'activity', { eventId, item }, ['gm']);
  });
}

export interface AlertInput {
  type: 'gps_suspicious' | 'disconnected' | 'capture' | 'purchase_request' | 'perk_fulfil' | 'emergency' | 'capture_failed';
  severity?: 'info' | 'warning' | 'critical';
  userId?: string | null;
  message: Msg;
  data?: Record<string, unknown>;
  /** At most one unacknowledged alert per key. */
  dedupeKey?: string;
}

export async function alert(t: Tx, eventId: string, a: AlertInput): Promise<void> {
  const { rows } = await t.query(
    `INSERT INTO alerts (event_id, type, severity, user_id, message, data, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (event_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND acknowledged_at IS NULL DO NOTHING
     RETURNING *, (SELECT nickname FROM users WHERE id = $4) AS nickname`,
    [eventId, a.type, a.severity ?? 'info', a.userId ?? null, render(a.message, 'en'), JSON.stringify(withMessages(a.data, a.message)), a.dedupeKey ?? null],
  );
  if (!rows[0]) return;
  const item = dto.alert(rows[0]);
  t.afterCommit(() => hub.emit(eventId, 'alert', { eventId, alert: item }, ['gm']));
}

export async function audit(
  t: Tx,
  eventId: string | null,
  actorId: string | null,
  action: string,
  target: { type?: string; id?: string | null; before?: unknown; after?: unknown; reason?: string | null; ip?: string | null } = {},
): Promise<void> {
  await t.query(
    `INSERT INTO audit_logs (event_id, actor_id, action, target_type, target_id, before, after, reason, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      eventId,
      actorId,
      action,
      target.type ?? null,
      target.id ?? null,
      target.before === undefined ? null : JSON.stringify(target.before),
      target.after === undefined ? null : JSON.stringify(target.after),
      target.reason ?? null,
      target.ip ?? null,
    ],
  );
}

export interface NotifyInput {
  type: string;
  /** Rendered in each recipient's language. */
  title: Msg;
  body?: Msg;
  priority?: 'normal' | 'high' | 'emergency';
  eventId?: string | null;
  data?: Record<string, unknown>;
  /** Path the push notification opens. */
  url?: string;
  push?: boolean;
}

export async function notify(t: Tx, userIds: string[], n: NotifyInput): Promise<void> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  // One insert per language, so every recipient reads it in their own.
  const byLang = new Map<Lang, string[]>();
  if (typeof n.title === 'string' && typeof (n.body ?? '') === 'string') byLang.set('en', ids);
  else {
    const users = await many<{ id: string; language: string }>('SELECT id, language FROM users WHERE id = ANY($1::uuid[])', [ids], t);
    for (const u of users) {
      const lang = toLang(u.language);
      byLang.set(lang, [...(byLang.get(lang) ?? []), u.id]);
    }
  }
  for (const [lang, group] of byLang) {
    const title = render(n.title, lang);
    const body = render(n.body ?? '', lang);
    const { rows } = await t.query(
      `INSERT INTO notifications (user_id, type, title, body, priority, event_id, data)
       SELECT u, $2, $3, $4, $5, $6, $7 FROM unnest($1::uuid[]) AS u
       RETURNING *`,
      [group, n.type, title, body, n.priority ?? 'normal', n.eventId ?? null, JSON.stringify(n.data ?? {})],
    );
    t.afterCommit(async () => {
      for (const r of rows) hub.toUser(r.user_id, 'notification', dto.notification(r));
      if (n.push !== false) {
        const url = n.url ?? (n.eventId ? `/events/${n.eventId}` : '/notifications');
        // Push only to users without an open app connection; connected users get the socket toast.
        const offline = group.filter((id) => !hub.isOnline(id) || n.priority === 'emergency');
        void sendPush(offline, { title, body, url, priority: n.priority ?? 'normal', tag: n.type });
      }
    });
  }
}

/** Stores every language of a system message next to the English text (`data.messages`). */
function withMessages(data: Record<string, unknown> | undefined, message: Msg): Record<string, unknown> {
  return typeof message === 'string' ? (data ?? {}) : { ...data, messages: renderAll(message) };
}

/** Ids of who plays in an event (players and GMs on a team), optionally limited to a team. */
export async function eventPlayers(t: Tx, eventId: string, teamId?: string | null): Promise<string[]> {
  const rows = await many<{ user_id: string }>(
    `SELECT user_id FROM event_members WHERE event_id = $1 AND status = 'approved' AND (role = 'player' OR team_id IS NOT NULL)${teamId ? ' AND team_id = $2' : ''}`,
    teamId ? [eventId, teamId] : [eventId],
    t,
  );
  return rows.map((r) => r.user_id);
}

export async function eventGms(t: Tx, eventId: string): Promise<string[]> {
  const rows = await many<{ user_id: string }>(`SELECT user_id FROM event_members WHERE event_id = $1 AND status = 'approved' AND role = 'gm'`, [eventId], t);
  return rows.map((r) => r.user_id);
}
