/**
 * End-to-end tests against a running stack seeded with demo data:
 *
 *   docker compose up -d --build postgres api mailpit
 *   E2E_API=http://localhost:3000 E2E_MAIL=http://localhost:8025 npx vitest run test/api.e2e.test.ts
 *
 * They exercise the security rules through the real HTTP API: what each role can see,
 * secrets never leaving the server, idempotency, anti-cheat and the ledger.
 * The suite mutates the demo "Operation Pinewood" game; reseed with a fresh volume to rerun.
 */
import { io } from 'socket.io-client';
import { beforeAll, describe, expect, it } from 'vitest';

const API = process.env.E2E_API;
const MAIL = process.env.E2E_MAIL ?? 'http://localhost:8025';
const PASSWORD = process.env.SEED_PASSWORD ?? 'zeus-demo-2026';
const run = API ? describe : describe.skip;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

class Client {
  token = '';
  /** 'player': requests carry X-Zeus-View like the live player screens */
  view: 'gm' | 'player' = 'gm';
  constructor(readonly name: string) {}
  async call(method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
    const res = await fetch(`${API}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(this.view === 'player' ? { 'x-zeus-view': 'player' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  }
  get = (p: string) => this.call('GET', p);
  post = (p: string, b: unknown = {}) => this.call('POST', p, b);
  patch = (p: string, b: unknown) => this.call('PATCH', p, b);
  del = (p: string) => this.call('DELETE', p);
  async login(email: string, password = PASSWORD) {
    const r = await this.post('/auth/login', { email, password });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    this.token = r.body.accessToken;
    return r.body.user;
  }
}

const tx = () => crypto.randomUUID();
const near = (lat: number, lng: number, meters: number, bearing = 0) => {
  const d = meters / 6_371_008.8;
  const br = (bearing * Math.PI) / 180;
  const la1 = (lat * Math.PI) / 180;
  const lo1 = (lng * Math.PI) / 180;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: (la2 * 180) / Math.PI, lng: (lo2 * 180) / Math.PI };
};

run('API end-to-end', () => {
  const gm = new Client('gm');
  const alpha = new Client('Kestrel (Alpha)');
  const alpha2 = new Client('Talon (Alpha)');
  const bravo = new Client('Viper (Bravo)');
  let eventId = '';
  let gmLive: Json;

  beforeAll(async () => {
    await gm.login('overwatch@airsoftzeus.test');
    await alpha.login('kestrel@airsoftzeus.test');
    await alpha2.login('talon@airsoftzeus.test');
    await bravo.login('viper@airsoftzeus.test');
    const mine = await gm.get('/events/mine?filter=gm');
    eventId = mine.body.find((e: Json) => e.name === 'Operation Pinewood').id;
    gmLive = (await gm.get(`/events/${eventId}/live`)).body;
  });

  it('requires a verified email for event routes, and verification works through the email link', async () => {
    const c = new Client('new');
    const nick = `e2e${Date.now() % 1_000_000}`;
    const email = `${nick}@example.test`;
    const reg = await c.post('/auth/register', { email, password: 'correct horse battery', nickname: nick, acceptTerms: true, termsVersion: '2026-10', privacyVersion: '2026-10' });
    expect(reg.status).toBe(201);
    c.token = reg.body.accessToken;
    expect((await c.get('/events/mine')).body.error.code).toBe('email_not_verified');
    expect((await c.post('/auth/register', { email, password: 'correct horse battery', nickname: nick + 'x', acceptTerms: true, termsVersion: 'x', privacyVersion: 'x' })).status).toBe(409);

    await new Promise((r) => setTimeout(r, 800));
    const list = (await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`)).json()) as Json;
    const msg = (await (await fetch(`${MAIL}/api/v1/message/${list.messages[0].ID}`)).json()) as Json;
    const token = /token=([A-Za-z0-9_-]+)/.exec(msg.Text)![1];
    expect((await c.post('/auth/verify-email', { token })).status).toBe(200);
    expect((await c.post('/auth/verify-email', { token })).status).toBe(400); // single use
    await c.login(email, 'correct horse battery');
    expect((await c.get('/events/mine')).status).toBe(200);
    // not a member: no access to the live data of the event
    expect((await c.get(`/events/${eventId}/live`)).body.error.code).toBe('not_member');
  });

  it('opens a private event only with its join code', async () => {
    const created = await gm.post('/events', {
      name: 'Private e2e game',
      gameMode: 'championship',
      visibility: 'private',
      startAt: new Date(Date.now() + 86400_000).toISOString(),
      endAt: new Date(Date.now() + 90000_000).toISOString(),
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const code = created.body.joinCode;
    await gm.post(`/events/${id}/status`, { status: 'registration_open' });
    expect((await alpha.get(`/events/${id}`)).status).toBe(404);
    expect((await alpha.get(`/events/${id}?code=WRONG123`)).status).toBe(404);
    const withCode = await alpha.get(`/events/${id}?code=${code.toLowerCase()}`);
    expect(withCode.status).toBe(200);
    expect(withCode.body.joinCode).toBeNull();
    expect((await alpha.post(`/events/${id}/join`, { joinCode: 'NOPE' })).status).toBe(403);
    expect((await alpha.post(`/events/${id}/join`, { joinCode: code })).body.status).toBe('approved');
  });

  it('never sends capture codes or QR tokens to players', async () => {
    const live = (await alpha.get(`/events/${eventId}/live`)).body;
    const raw = JSON.stringify(live);
    for (const o of gmLive.objectives) {
      if (o.captureCode) expect(raw).not.toContain(o.captureCode);
    }
    expect(live.objectives.every((o: Json) => !('captureCode' in o))).toBe(true);
    expect(gmLive.objectives.some((o: Json) => typeof o.captureCode === 'string')).toBe(true);
    expect(live.event.joinCode).toBeNull();
  });

  it('filters positions and balances per viewer', async () => {
    const live = (await alpha.get(`/events/${eventId}/live`)).body;
    const myTeam = live.event.me.teamId;
    expect(live.positions.length).toBeGreaterThan(0);
    expect(live.positions.every((p: Json) => p.teamId === myTeam)).toBe(true);
    expect(live.positions.some((p: Json) => p.kind === 'enemy' || p.kind === 'intel')).toBe(false);
    const teams = live.event.teams as Json[];
    expect(teams.find((t) => t.id === myTeam)!.currency).not.toBeNull();
    expect(teams.filter((t) => t.id !== myTeam).every((t) => t.currency === null)).toBe(true);
    expect(gmLive.positions).toHaveLength(12);
    expect(gmLive.alerts).toBeDefined();
    expect(live.alerts).toBeUndefined();
  });

  it('hides objectives until their prerequisites are captured', async () => {
    const bunker = gmLive.objectives.find((o: Json) => o.name === 'Bunker');
    const crossroads = gmLive.objectives.find((o: Json) => o.name === 'Crossroads'); // never captured in the seed
    await gm.patch(`/events/${eventId}/objectives/${bunker.id}`, { prerequisiteIds: [crossroads.id] });
    const names = (await alpha.get(`/events/${eventId}/objectives`)).body.map((o: Json) => o.name);
    expect(names).not.toContain('Bunker');
    expect((await alpha.get(`/events/${eventId}/objectives/${bunker.id}`)).status).toBe(404);
    expect((await gm.get(`/events/${eventId}/objectives`)).body.map((o: Json) => o.name)).toContain('Bunker');
    await gm.patch(`/events/${eventId}/objectives/${bunker.id}`, { prerequisiteIds: bunker.prerequisiteIds });
  });

  it('players cannot read another team’s ledger', async () => {
    const other = gmLive.event.teams.find((t: Json) => t.name === 'Bravo').id;
    expect((await alpha.get(`/events/${eventId}/ledger?teamId=${other}`)).status).toBe(403);
    expect((await alpha.get(`/events/${eventId}/ledger`)).status).toBe(200);
    expect((await alpha.get(`/events/${eventId}/alerts`)).status).toBe(403);
  });

  it('validates codes on the server, captures once, and replays idempotently', async () => {
    const radio = gmLive.objectives.find((o: Json) => o.name === 'Radio mast');
    await gm.patch(`/events/${eventId}/objectives/${radio.id}`, { cooldownSec: 0 }); // seed captures are recent
    const before = (await gm.get(`/events/${eventId}/live`)).body.event.teams.find((t: Json) => t.name === 'Bravo').points;
    const wrong = await bravo.post(`/events/${eventId}/objectives/${radio.id}/capture`, { method: 'code', code: 'NOPE99', clientTxId: tx() });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('wrong_code');

    const id = tx();
    const ok = await bravo.post(`/events/${eventId}/objectives/${radio.id}/capture`, { method: 'code', code: radio.captureCode.toLowerCase(), clientTxId: id });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.captured).toBe(true);
    const replay = await bravo.post(`/events/${eventId}/objectives/${radio.id}/capture`, { method: 'code', code: radio.captureCode, clientTxId: id });
    expect(replay.body.captureId).toBe(ok.body.captureId);
    const again = await bravo.post(`/events/${eventId}/objectives/${radio.id}/capture`, { method: 'code', code: radio.captureCode, clientTxId: tx() });
    expect(again.status).toBe(409);
    expect(['already_owned', 'cooldown']).toContain(again.body.error.code);

    const after = (await gm.get(`/events/${eventId}/live`)).body.event.teams.find((t: Json) => t.name === 'Bravo').points;
    expect(after - before).toBeGreaterThanOrEqual(ok.body.points);
    const ledger = (await gm.get(`/events/${eventId}/ledger?kind=points`)).body.items.filter((l: Json) => l.objectiveId === radio.id && l.type === 'capture');
    expect(ledger.filter((l: Json) => l.createdAt >= new Date(Date.now() - 60_000).toISOString())).toHaveLength(1);
  });

  it('verifies QR payloads and invalidates old codes after regeneration', async () => {
    const sawmill = gmLive.objectives.find((o: Json) => o.name === 'Old sawmill');
    await gm.patch(`/events/${eventId}/objectives/${sawmill.id}`, { cooldownSec: 0 });
    const qr = (await gm.get(`/events/${eventId}/objectives/${sawmill.id}/qr`)).body;
    expect(qr.payload).toMatch(/^zeus:obj:/);
    expect(qr.svg).toContain('<svg');
    const forged = qr.payload.replace(eventId, '00000000-0000-4000-8000-000000000000');
    expect((await alpha2.post(`/events/${eventId}/objectives/${sawmill.id}/capture`, { method: 'qr', qrPayload: forged, clientTxId: tx() })).body.error.code).toBe('wrong_event');
    await gm.post(`/events/${eventId}/objectives/${sawmill.id}/qr/regenerate`);
    expect((await alpha2.post(`/events/${eventId}/objectives/${sawmill.id}/capture`, { method: 'qr', qrPayload: qr.payload, clientTxId: tx() })).body.error.code).toBe('invalid_qr');
    const fresh = (await gm.get(`/events/${eventId}/objectives/${sawmill.id}/qr`)).body;
    const ok = await alpha2.post(`/events/${eventId}/objectives/${sawmill.id}/capture`, { method: 'qr', qrPayload: fresh.payload, clientTxId: tx() });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('rejects teleporting GPS samples and alerts the GM', async () => {
    const live = (await alpha.get(`/events/${eventId}/live`)).body;
    const self = live.positions.find((p: Json) => p.kind === 'self');
    const now = Date.now();
    const a = await alpha.post(`/events/${eventId}/locations`, { samples: [{ lat: self.lat, lng: self.lng, accuracy: 5, timestamp: now - 1000 }] });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.accepted).toBe(1);
    await new Promise((r) => setTimeout(r, 5200)); // per-player rate limit (interval/2)
    const far = near(self.lat, self.lng, 3000, 45);
    const b = await alpha.post(`/events/${eventId}/locations`, { samples: [{ ...far, accuracy: 5, timestamp: Date.now() }] });
    expect(b.body.flags).toContain('speed');
    expect(b.body.accepted).toBe(0);
    const alerts = (await gm.get(`/events/${eventId}/alerts`)).body.items;
    expect(alerts.some((x: Json) => x.type === 'gps_suspicious')).toBe(true);
  });

  it('UAV reveals the target team only to the buyer, only while active', async () => {
    const uav = (await bravo.get(`/events/${eventId}/perks`)).body.find((p: Json) => p.type === 'uav');
    expect(uav.availability.canBuy, JSON.stringify(uav.availability)).toBe(true);
    const alphaTeam = gmLive.event.teams.find((t: Json) => t.name === 'Alpha').id;
    const id = tx();
    const p = await bravo.post(`/events/${eventId}/perks/${uav.id}/purchase`, { targetTeamId: alphaTeam, clientTxId: id });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.status).toBe('active');
    const replay = await bravo.post(`/events/${eventId}/perks/${uav.id}/purchase`, { targetTeamId: alphaTeam, clientTxId: id });
    expect(replay.body.id).toBe(p.body.id);
    const bravoView = (await bravo.get(`/events/${eventId}/live`)).body.positions;
    expect(bravoView.some((x: Json) => x.kind === 'intel' && x.teamId === alphaTeam)).toBe(true);
    const alphaView = (await alpha.get(`/events/${eventId}/live`)).body.positions;
    expect(alphaView.some((x: Json) => x.kind === 'intel')).toBe(false);
    // GM cancels with refund: intel disappears immediately
    await gm.post(`/events/${eventId}/purchases/${p.body.id}/cancel`, { refund: true, reason: 'test' });
    const after = (await bravo.get(`/events/${eventId}/live`)).body.positions;
    expect(after.some((x: Json) => x.kind === 'intel')).toBe(false);
  });

  it('currency theft needs approval and never makes a balance negative', async () => {
    const theft = (await bravo.get(`/events/${eventId}/perks`)).body.find((p: Json) => p.type === 'theft');
    const alphaTeam = gmLive.event.teams.find((t: Json) => t.name === 'Alpha');
    const p = await bravo.post(`/events/${eventId}/perks/${theft.id}/purchase`, { targetTeamId: alphaTeam.id, clientTxId: tx() });
    expect(p.body.status).toBe('pending_approval');
    const before = (await gm.get(`/events/${eventId}/live`)).body.event.teams.find((t: Json) => t.id === alphaTeam.id).currency;
    const r = await gm.post(`/events/${eventId}/purchases/${p.body.id}/review`, { approve: true });
    expect(r.body.status).toBe('completed');
    const afterTeams = (await gm.get(`/events/${eventId}/live`)).body.event.teams;
    const after = afterTeams.find((t: Json) => t.id === alphaTeam.id).currency;
    expect(after).toBe(before - Math.floor(before * 0.2));
    expect(after).toBeGreaterThanOrEqual(0);
    const again = await bravo.post(`/events/${eventId}/perks/${theft.id}/purchase`, { targetTeamId: alphaTeam.id, clientTxId: tx() });
    expect(again.status).toBe(409);
  });

  it('GM adjustments are clamped, logged and idempotent', async () => {
    const team = gmLive.event.teams.find((t: Json) => t.name === 'Alpha');
    const id = tx();
    const r = await gm.post(`/events/${eventId}/gm/adjust`, { teamId: team.id, kind: 'currency', amount: -999999, reason: 'Test clamp', clientTxId: id });
    expect(r.status).toBe(200);
    expect(r.body.balance).toBe(0);
    const again = await gm.post(`/events/${eventId}/gm/adjust`, { teamId: team.id, kind: 'currency', amount: -999999, reason: 'Test clamp', clientTxId: id });
    expect(again.body).toEqual(r.body);
    const entry = (await gm.get(`/events/${eventId}/ledger?kind=currency&teamId=${team.id}`)).body.items[0];
    expect(entry.type).toBe('gm_adjustment');
    expect(entry.requested).toBe(-999999);
    expect(entry.amount).toBe(r.body.applied);
    expect(entry.actorNickname).toBe('Overwatch');
    expect((await alpha.post(`/events/${eventId}/gm/adjust`, { teamId: team.id, kind: 'points', amount: 100, reason: 'cheat', clientTxId: tx() })).status).toBe(403);
  });

  it('pushes only permitted positions over the socket', async () => {
    const socket = io(API!, { path: '/socket.io', transports: ['websocket'], auth: { token: alpha.token } });
    const ack = await new Promise<Json>((resolve) => socket.on('connect', () => socket.emit('subscribe', eventId, resolve)));
    expect(ack.ok).toBe(true);
    const msg = await new Promise<Json>((resolve) => socket.once('positions', resolve));
    const myTeam = (await alpha.get(`/events/${eventId}`)).body.me.teamId;
    expect(msg.positions.every((p: Json) => p.teamId === myTeam)).toBe(true);
    socket.disconnect();

    const bad = io(API!, { path: '/socket.io', transports: ['websocket'], auth: { token: 'forged' } });
    const err = await new Promise<Error>((resolve) => bad.on('connect_error', resolve));
    expect(err.message).toBe('unauthorized');
    bad.disconnect();
  });
  it('lets a GM play on a team, seeing only what the team sees in the player view', async () => {
    const gmId = gmLive.event.me.userId;
    const alphaTeam = gmLive.event.teams.find((t: Json) => t.name === 'Alpha').id;
    const radio = gmLive.objectives.find((o: Json) => o.name === 'Radio mast');
    const joined = await gm.post(`/events/${eventId}/members/${gmId}/assign`, { teamId: alphaTeam });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body).toMatchObject({ role: 'gm', teamId: alphaTeam });

    // Control center: still the full GM view.
    const full = (await gm.get(`/events/${eventId}/live`)).body;
    expect(full.event.isGm).toBe(true);
    expect(full.alerts).toBeDefined();
    expect(full.objectives.some((o: Json) => typeof o.captureCode === 'string')).toBe(true);
    // Capturing needs the player view.
    expect((await gm.post(`/events/${eventId}/objectives/${radio.id}/capture`, { method: 'code', code: 'NOPE99', clientTxId: tx() })).body.error.code).toBe('not_player');

    const player = new Client('Overwatch (player view)');
    player.token = gm.token;
    player.view = 'player';
    const live = (await player.get(`/events/${eventId}/live`)).body;
    expect(live.event.isGm).toBe(false);
    expect(live.event.me).toMatchObject({ role: 'gm', teamId: alphaTeam });
    expect(live.event.joinCode).toBeNull();
    expect(live.alerts).toBeUndefined();
    expect(live.objectives.every((o: Json) => !('captureCode' in o))).toBe(true);
    expect(live.positions.length).toBeGreaterThan(0);
    expect(live.positions.every((p: Json) => p.teamId === alphaTeam)).toBe(true);
    expect(live.event.teams.filter((t: Json) => t.id !== alphaTeam).every((t: Json) => t.currency === null)).toBe(true);
    expect((await player.get(`/events/${eventId}/alerts`)).status).toBe(403);
    expect((await player.post(`/events/${eventId}/objectives/${radio.id}/capture`, { method: 'code', code: 'NOPE99', clientTxId: tx() })).body.error.code).toBe('wrong_code');

    const socket = io(API!, { path: '/socket.io', transports: ['websocket'], auth: { token: gm.token } });
    const ack = await new Promise<Json>((resolve) => socket.on('connect', () => socket.emit('subscribe', eventId, { view: 'player' }, resolve)));
    expect(ack).toMatchObject({ ok: true, role: 'player' });
    const msg = await new Promise<Json>((resolve) => socket.once('positions', resolve));
    expect(msg.positions.every((p: Json) => p.teamId === alphaTeam)).toBe(true);
    socket.disconnect();

    // Off the team, the player view header changes nothing: a GM who does not play sees everything.
    await gm.post(`/events/${eventId}/members/${gmId}/assign`, { teamId: null });
    expect((await player.get(`/events/${eventId}/live`)).body.event.isGm).toBe(true);
    expect((await alpha.post(`/events/${eventId}/members/${gmId}/assign`, { teamId: alphaTeam })).status).toBe(403);
  });

  it('stores Web Push subscriptions and native app FCM tokens per user, and removes them', async () => {
    const token = `fcm-${tx()}:APA91b-test`;
    expect((await alpha.post('/me/push-subscriptions', { fcmToken: token })).status).toBe(200);
    expect((await alpha.post('/me/push-subscriptions', { fcmToken: 'bad token!' })).status).toBe(400);
    // The same device signing in as someone else moves the token to them.
    expect((await alpha2.post('/me/push-subscriptions', { fcmToken: token })).status).toBe(200);
    const endpoints = async (c: Client) => ((await c.get('/me/export')).body.pushSubscriptions as Json[]).map((s) => s.endpoint);
    expect(await endpoints(alpha)).not.toContain(token);
    expect(await endpoints(alpha2)).toContain(token);
    expect((await alpha2.call('DELETE', '/me/push-subscriptions', { endpoint: token })).status).toBe(200);
    expect(await endpoints(alpha2)).not.toContain(token);
  });

  it('keeps support conversations private between the author and the admins', async () => {
    const created = await alpha.post('/support', { category: 'bug', subject: 'E2E map does not load', body: 'Steps: open the lobby.', context: { page: '/home' } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id;
    expect(created.body.status).toBe('open');
    expect(created.body.messages).toHaveLength(1);
    expect(created.body.userNickname).toBeNull();
    expect((await alpha2.get(`/support/${id}`)).status).toBe(404);
    expect((await alpha2.post(`/support/${id}/messages`, { body: 'hi' })).status).toBe(404);
    expect((await alpha2.get('/support?all=true')).body.items.some((t: Json) => t.id === id)).toBe(false);
    expect((await alpha.get('/support')).body.items[0].id).toBe(id);

    expect((await alpha.get('/admin/overview')).status).toBe(403);

    // The admin part needs ADMIN_EMAILS=overwatch@airsoftzeus.test on the API.
    if (!(await gm.get('/me')).body.isAdmin) return;
    const overview = (await gm.get('/admin/overview')).body;
    expect(overview.tickets.open).toBeGreaterThanOrEqual(1);
    expect(overview.tickets.openBugs).toBeGreaterThanOrEqual(1);
    expect(typeof overview.news.drafts).toBe('number');
    const inbox = await gm.get('/support?all=true&status=open');
    const row = inbox.body.items.find((t: Json) => t.id === id);
    expect(row.userNickname).toBe('Kestrel');
    const answered = await gm.post(`/support/${id}/messages`, { body: 'Fixed in the next release.' });
    expect(answered.body.status).toBe('answered');
    expect(answered.body.asStaff).toBe(true);
    expect(answered.body.messages[1]).toMatchObject({ fromAdmin: true, authorNickname: null });
    const notes = (await alpha.get('/me/notifications')).body.items;
    expect(notes.find((n: Json) => n.type === 'support_reply' && n.data.ticketId === id)).toBeTruthy();
    expect((await alpha.post(`/support/${id}/messages`, { body: 'Thanks!' })).body.status).toBe('open');
    expect((await alpha.patch(`/support/${id}`, { status: 'answered' })).status).toBe(403);
    expect((await alpha.patch(`/support/${id}`, { status: 'closed' })).body.status).toBe('closed');
  });

  it('lets platform admins delete any event, and only them', async () => {
    const created = await alpha.post('/events', {
      name: 'E2E event to moderate',
      gameMode: 'sunday',
      startAt: new Date(Date.now() + 86400_000).toISOString(),
      endAt: new Date(Date.now() + 90000_000).toISOString(),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id;
    await alpha.post(`/events/${id}/status`, { status: 'registration_open' });
    expect((await alpha2.post(`/events/${id}/join`, {})).body.status).toBe('approved');
    expect((await alpha2.del(`/events/${id}`)).status).toBe(403);
    expect((await alpha.del(`/events/${id}`)).body.error.code).toBe('invalid_state');

    // The admin part needs ADMIN_EMAILS=overwatch@airsoftzeus.test on the API.
    if (!(await gm.get('/me')).body.isAdmin) return;
    expect((await gm.del(`/events/${id}`)).status).toBe(200);
    expect((await alpha2.get(`/events/${id}`)).status).toBe(404);
    const notes = (await alpha2.get('/me/notifications')).body.items;
    expect(notes.find((n: Json) => n.type === 'event_removed' && n.title.includes('E2E event to moderate'))).toBeTruthy();
  });

  it('lets admins list users and switch features on or off per user, enforced by the server', async () => {
    const me = (await bravo.get('/me')).body;
    expect(me.features).toMatchObject({ discover_events: true, create_events: true, create_clubs: true, support: true, manage_news: false });
    expect((await bravo.get('/admin/users')).status).toBe(403);
    expect((await bravo.post('/news', {})).status).toBe(403);

    // The admin part needs ADMIN_EMAILS=overwatch@airsoftzeus.test on the API.
    if (!(await gm.get('/me')).body.isAdmin) return;
    const list = await gm.get('/admin/users?q=viper');
    expect(list.status).toBe(200);
    const row = list.body.items.find((u: Json) => u.nickname === 'Viper');
    expect(row).toMatchObject({ isAdmin: false, customAccess: false });
    const self = (await gm.get('/admin/users?filter=admins')).body.items;
    expect(self.some((u: Json) => u.email === 'overwatch@airsoftzeus.test')).toBe(true);

    try {
      const changed = await gm.patch(`/admin/users/${row.id}/features`, { features: { create_events: false, discover_events: false, manage_news: true } });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect(changed.body.customAccess).toBe(true);
      const byKey = Object.fromEntries(changed.body.features.map((f: Json) => [f.key, f]));
      expect(byKey.create_events).toMatchObject({ enabled: false, default: true, custom: true });
      expect(byKey.manage_news).toMatchObject({ enabled: true, default: false, custom: true });
      expect(byKey.support).toMatchObject({ enabled: true, custom: false });

      const start = new Date(Date.now() + 86400_000).toISOString();
      const end = new Date(Date.now() + 90000_000).toISOString();
      const denied = await bravo.post('/events', { name: 'E2E not allowed', gameMode: 'sunday', startAt: start, endAt: end });
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('feature_disabled');
      expect((await bravo.get('/events/discover')).status).toBe(403);
      expect((await bravo.get('/news?all=true')).status).toBe(200);
      expect((await bravo.get('/me')).body.features).toMatchObject({ create_events: false, discover_events: false, manage_news: true });

      // Admins can't be restricted; unknown features are rejected.
      const admin = self.find((u: Json) => u.email === 'overwatch@airsoftzeus.test');
      expect((await gm.patch(`/admin/users/${admin.id}/features`, { features: { support: false } })).status).toBe(409);
      expect((await gm.patch(`/admin/users/${row.id}/features`, { features: { fly: true } })).status).toBe(400);
    } finally {
      // Back to the defaults: null and the default value both drop the override.
      const reset = await gm.patch(`/admin/users/${row.id}/features`, { features: { create_events: null, discover_events: true, manage_news: null } });
      expect(reset.body.customAccess).toBe(false);
    }
    expect((await bravo.get('/events/discover')).status).toBe(200);
  });

  it('lets removed players join again, but not banned ones until they are invited', async () => {
    const created = await alpha.post('/events', {
      name: 'E2E remove and ban',
      gameMode: 'sunday',
      startAt: new Date(Date.now() + 86400_000).toISOString(),
      endAt: new Date(Date.now() + 90000_000).toISOString(),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id;
    await alpha.post(`/events/${id}/status`, { status: 'registration_open' });
    const playerId = (await alpha2.get('/me')).body.id;
    expect((await alpha2.post(`/events/${id}/join`, {})).body.status).toBe('approved');

    expect((await alpha.post(`/events/${id}/members/${playerId}/remove`, { reason: 'Wrong date' })).status).toBe(200);
    expect((await alpha2.post(`/events/${id}/join`, {})).body.status).toBe('approved');

    expect((await alpha.post(`/events/${id}/members/${playerId}/remove`, { reason: 'Safety violation', ban: true })).status).toBe(200);
    expect((await alpha2.post(`/events/${id}/join`, {})).body.error.code).toBe('not_allowed');
    const notes = (await alpha2.get('/me/notifications')).body.items;
    expect(notes.find((n: Json) => n.type === 'removed_from_event' && n.title.includes('Banned from E2E remove and ban'))).toBeTruthy();

    const nickname = (await alpha2.get('/me')).body.nickname;
    expect((await alpha.post(`/events/${id}/members/invite`, { nickname })).status).toBe(201);
    expect((await alpha2.post(`/events/${id}/invitation`, { accept: true })).body.status).toBe('approved');
  });

  it('shares event attachments only with GMs and approved players, checking the real file type', async () => {
    const send = async (c: Client, method: string, path: string, form?: FormData) => {
      const res = await fetch(`${API}/api${path}`, { method, headers: { authorization: `Bearer ${c.token}` }, body: form });
      return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
    };
    const file = (bytes: Buffer, name: string) => {
      const f = new FormData();
      f.append('name', name);
      f.append('file', new Blob([bytes]), name);
      return f;
    };
    const created = await alpha.post('/events', {
      name: 'E2E attachments',
      gameMode: 'sunday',
      startAt: new Date(Date.now() + 86400_000).toISOString(),
      endAt: new Date(Date.now() + 90000_000).toISOString(),
    });
    const id = created.body.id;
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1000, 65)]);
    const up = await send(alpha, 'POST', `/events/${id}/attachments`, file(pdf, 'Game book città.pdf'));
    expect(up.status).toBe(201);
    const att = JSON.parse(up.bytes.toString());
    expect(att.fileName).toBe('Game book città.pdf');
    // The content decides, not the name.
    expect((await send(alpha, 'POST', `/events/${id}/attachments`, file(Buffer.from('<script>'), 'x.pdf'))).status).toBe(400);

    await alpha.post(`/events/${id}/status`, { status: 'registration_open' });
    const outside = (await bravo.get(`/events/${id}`)).body;
    expect(outside.attachmentCount).toBe(1);
    expect(outside.attachments).toEqual([]);
    expect((await send(bravo, 'GET', `/events/${id}/attachments/${att.id}/file`)).status).toBe(403);
    expect((await send(bravo, 'POST', `/events/${id}/attachments`, file(pdf, 'p.pdf'))).status).toBe(403);

    expect((await alpha2.post(`/events/${id}/join`, {})).body.status).toBe('approved');
    const dl = await send(alpha2, 'GET', `/events/${id}/attachments/${att.id}/file`);
    expect(dl.status).toBe(200);
    expect(dl.bytes.equals(pdf)).toBe(true);
    expect(dl.headers.get('content-disposition')).toContain("filename*=UTF-8''Game%20book%20citt%C3%A0.pdf");
    expect((await alpha2.del(`/events/${id}/attachments/${att.id}`)).status).toBe(403);
    expect((await alpha.del(`/events/${id}/attachments/${att.id}`)).status).toBe(200);
    expect((await send(alpha2, 'GET', `/events/${id}/attachments/${att.id}/file`)).status).toBe(404);
  });
});
