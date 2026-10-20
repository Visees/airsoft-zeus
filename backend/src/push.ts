import webpush from 'web-push';
import { config } from './config.js';
import { many, pool } from './db.js';
import { logger } from './logger.js';

const enabled = !!(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
if (enabled) webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);

export const pushEnabled = enabled;

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  priority: 'normal' | 'high' | 'emergency';
  tag?: string;
}

/**
 * Send a Web Push to every subscription of the users. Payload follows the Angular service
 * worker format ({ notification: {...} }). Dead subscriptions (404/410) are removed.
 */
export async function sendPush(userIds: string[], p: PushPayload): Promise<void> {
  if (!enabled || userIds.length === 0) return;
  const subs = await many<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::uuid[])',
    [userIds],
  );
  const payload = JSON.stringify({
    notification: {
      title: p.title,
      body: p.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-96x96.png',
      tag: p.tag,
      renotify: p.priority !== 'normal',
      requireInteraction: p.priority === 'emergency',
      vibrate: p.priority === 'emergency' ? [300, 120, 300, 120, 300] : p.priority === 'high' ? [150] : undefined,
      data: { url: p.url, onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: p.url } } },
    },
  });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: p.priority === 'emergency' ? 3600 : 600,
          urgency: p.priority === 'normal' ? 'normal' : 'high',
        });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
        else logger.warn({ status }, 'web push failed');
      }
    }),
  );
}
