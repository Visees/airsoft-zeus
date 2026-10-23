import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { logger } from './logger.js';
import type { PushPayload } from './push.js';

/**
 * Firebase Cloud Messaging (HTTP v1) for the native apps, called directly: a service account signs
 * a JWT, Google trades it for an access token (valid one hour), and each message is one POST.
 */

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function parseServiceAccount(raw: string): ServiceAccount | null {
  if (!raw.trim()) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const sa = JSON.parse(text) as ServiceAccount;
    if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error('missing fields');
    return sa;
  } catch (err) {
    logger.error({ err }, 'FCM_SERVICE_ACCOUNT is not a valid service account key; native push is off');
    return null;
  }
}

const account = parseServiceAccount(config.FCM_SERVICE_ACCOUNT);
export const fcmEnabled = !!account;

let accessToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now()) return accessToken.value;
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const assertion = jwt.sign({ scope: 'https://www.googleapis.com/auth/firebase.messaging' }, sa.private_key, {
    algorithm: 'RS256',
    issuer: sa.client_email,
    audience: tokenUri,
    expiresIn: 3600,
  });
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`FCM auth failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
  return accessToken.value;
}

/** Android notification channels, created by the app (PushService); same ids there. */
export const ANDROID_CHANNEL = { normal: 'general', high: 'alerts', emergency: 'emergency' } as const;

export function fcmMessage(token: string, p: PushPayload) {
  const urgent = p.priority !== 'normal';
  const ttlSec = p.priority === 'emergency' ? 3600 : 600;
  return {
    message: {
      token,
      notification: { title: p.title, body: p.body },
      // Read by the app when the notification is tapped (PushService opens `url`).
      data: { url: p.url, type: p.tag ?? '', priority: p.priority },
      android: {
        priority: urgent ? 'HIGH' : 'NORMAL',
        ttl: `${ttlSec}s`,
        notification: {
          channel_id: ANDROID_CHANNEL[p.priority],
          icon: 'ic_stat_notify',
          color: '#4A5A1F',
          tag: p.tag,
          notification_priority: p.priority === 'emergency' ? 'PRIORITY_MAX' : urgent ? 'PRIORITY_HIGH' : 'PRIORITY_DEFAULT',
        },
      },
      apns: {
        headers: { 'apns-priority': urgent ? '10' : '5', 'apns-expiration': String(Math.floor(Date.now() / 1000) + ttlSec) },
        payload: {
          aps: {
            sound: 'default',
            ...(p.tag ? { 'thread-id': p.tag } : {}),
            ...(p.priority === 'emergency' ? { 'interruption-level': 'time-sensitive' } : {}),
          },
        },
      },
    },
  };
}

/** 'gone' when the token no longer exists (app uninstalled, data cleared): delete it. */
export async function sendFcm(token: string, p: PushPayload): Promise<'ok' | 'gone' | 'failed'> {
  if (!account) return 'failed';
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getAccessToken(account)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fcmMessage(token, p)),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return 'ok';
    const text = await res.text();
    if (res.status === 401) accessToken = null;
    if (res.status === 404 || text.includes('UNREGISTERED') || text.includes('SENDER_ID_MISMATCH')) return 'gone';
    logger.warn({ status: res.status, body: text.slice(0, 500) }, 'FCM push failed');
    return 'failed';
  } catch (err) {
    logger.warn({ err }, 'FCM push failed');
    return 'failed';
  }
}
