import webpush from 'web-push';
import { config } from './config.js';
import { many, pool } from './db.js';
import { fcmEnabled, sendFcm } from './fcm.js';
import { logger } from './logger.js';

const webEnabled = !!(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
if (webEnabled) webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  priority: 'normal' | 'high' | 'emergency';
  tag?: string;
}

interface Subscription {
  id: string;
  kind: 'web' | 'fcm';
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
}

/**
 * Send a push to every subscription of the users: Web Push for browsers, FCM for the native apps.
 * Dead subscriptions (Web Push 404/410, FCM unregistered token) are removed.
 */
export async function sendPush(userIds: string[], p: PushPayload): Promise<void> {
  if ((!webEnabled && !fcmEnabled) || userIds.length === 0) return;
  const subs = await many<Subscription>(
    'SELECT id, kind, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::uuid[])',
    [userIds],
  );
  const webPayload = JSON.stringify(angularPayload(p));
  await Promise.all(
    subs.map(async (s) => {
      if (s.kind === 'fcm') {
        if (fcmEnabled && (await sendFcm(s.endpoint, p)) === 'gone') await remove(s.id);
        return;
      }
      if (!webEnabled) return;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh!, auth: s.auth! } }, webPayload, {
          TTL: p.priority === 'emergency' ? 3600 : 600,
          urgency: p.priority === 'normal' ? 'normal' : 'high',
        });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await remove(s.id);
        else logger.warn({ status }, 'web push failed');
      }
    }),
  );
}

/** The Angular service worker's format ({ notification: {...} }). */
function angularPayload(p: PushPayload) {
  return {
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
  };
}

async function remove(id: string): Promise<void> {
  await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [id]);
}
