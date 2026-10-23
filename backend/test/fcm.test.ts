import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

let fcm: typeof import('../src/fcm.js');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://unused';
  process.env.JWT_SECRET ??= 'x'.repeat(32);
  // Base64, as it is stored in Coolify.
  process.env.FCM_SERVICE_ACCOUNT = Buffer.from(
    JSON.stringify({ project_id: 'demo-project', client_email: 'sender@demo-project.iam.gserviceaccount.com', private_key: privateKey }),
  ).toString('base64');
  fcm = await import('../src/fcm.js');
});

afterEach(() => vi.unstubAllGlobals());

const payload = { title: 'EMERGENCY: stop', body: 'Injury at the bridge', url: '/events/e1/live', priority: 'emergency' as const, tag: 'emergency' };

describe('FCM', () => {
  it('maps priority to the Android channel, FCM priority and TTL, with the tap URL in data', () => {
    const m = fcm.fcmMessage('tok', payload).message;
    expect(m.token).toBe('tok');
    expect(m.notification).toEqual({ title: payload.title, body: payload.body });
    expect(m.data).toEqual({ url: '/events/e1/live', type: 'emergency', priority: 'emergency' });
    expect(m.android).toMatchObject({ priority: 'HIGH', ttl: '3600s', notification: { channel_id: 'emergency', icon: 'ic_stat_notify' } });
    const normal = fcm.fcmMessage('tok', { ...payload, priority: 'normal' }).message;
    expect(normal.android).toMatchObject({ priority: 'NORMAL', ttl: '600s', notification: { channel_id: 'general' } });
    expect(normal.apns.headers['apns-priority']).toBe('5');
  });

  it('signs in with the service account once, then sends; an unregistered token is reported gone', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url.startsWith('https://oauth2.googleapis.com/')) return Response.json({ access_token: 'at-1', expires_in: 3600 });
        if (JSON.parse(String(init.body)).message.token === 'dead') {
          return Response.json({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 });
        }
        return Response.json({ name: 'projects/demo-project/messages/1' });
      }),
    );
    expect(fcm.fcmEnabled).toBe(true);
    expect(await fcm.sendFcm('live', payload)).toBe('ok');
    expect(await fcm.sendFcm('dead', payload)).toBe('gone');

    const auth = calls.filter((c) => c.url.startsWith('https://oauth2.googleapis.com/'));
    expect(auth).toHaveLength(1);
    const assertion = new URLSearchParams(String(auth[0]!.init.body)).get('assertion')!;
    const claims = jwt.verify(assertion, publicKey, { algorithms: ['RS256'] }) as jwt.JwtPayload;
    expect(claims).toMatchObject({ iss: 'sender@demo-project.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging' });

    const send = calls.find((c) => c.url.includes('/messages:send'))!;
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/demo-project/messages:send');
    expect((send.init.headers as Record<string, string>).Authorization).toBe('Bearer at-1');
  });

  it('reports other failures without dropping the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503 })));
    expect(await fcm.sendFcm('live', payload)).toBe('failed');
  });
});
