import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { currentUser, requireVerified } from '../auth/middleware.js';
import { many, one, pool, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { idempotent } from '../lib/idempotency.js';
import { normalizeCode, randomToken, readableCode, safeEqual } from '../lib/ids.js';
import { decodeCursor, page } from '../lib/pagination.js';
import { consume, remaining } from '../lib/rate-limit.js';
import { body, clientTxId, hexColor, idParam, isoDate, lat, lng, playerRole, queryOf, shortText, uuid } from '../lib/validate.js';
import { hub } from '../realtime/hub.js';
import { eventContext, FINISHED, playsIn, requireGm, requireMember, type EventContext } from '../domain/context.js';
import { copyMapContent, insertObjective } from '../domain/copy.js';
import { geofenceSchema, merge, rewardsSchema, DEFAULT_GEOFENCE, DEFAULT_REWARDS } from '../domain/defaults.js';
import { alert, audit } from '../domain/journal.js';
import { loadObjectives, objectiveDto, objectiveDtos, OBJECTIVE_SELECT, performCapture, statusOf, type ObjRow } from '../domain/objectives.js';
import { contentVisible, objectiveVisible } from '../domain/rules.js';
import * as dto from '../domain/serialize.js';
import { tr } from '../i18n/index.js';

export const contentRouter = Router();

// ------------------------------------------------------------------ objectives

const visibilityObj = z.object({ mode: z.enum(['all', 'teams', 'after_prerequisites', 'gm_only']), teamIds: z.array(uuid).max(16).default([]) });
const objectiveInput = z.object({
  name: shortText(120).min(1, 'Name the objective'),
  description: z.string().max(5000),
  instructions: z.string().max(5000),
  sortOrder: z.number().int().min(0).max(10_000),
  lat,
  lng,
  icon: shortText(40),
  color: hexColor,
  type: z.enum(['domination', 'ctf', 'vip', 'search_destroy', 'bomb_defusal', 'attack_defense', 'recon', 'intel', 'custom']),
  imageUrl: z.string().max(500).startsWith('/api/files/').nullable(),
  documentUrl: z.string().max(500).startsWith('/api/files/').nullable(),
  methods: z.array(z.enum(['code', 'qr', 'geofence'])).min(1, 'Choose at least one capture method').max(3),
  requireGeofence: z.boolean(),
  geofence: geofenceSchema.partial(),
  rewards: rewardsSchema.partial(),
  availabilityStart: isoDate.nullable(),
  availabilityEnd: isoDate.nullable(),
  cooldownSec: z.number().int().min(0).max(86_400),
  maxCaptures: z.number().int().min(0).max(1000),
  allowedTeamIds: z.array(uuid).max(16),
  visibility: visibilityObj,
  prerequisiteIds: z.array(uuid).max(50),
  nextObjectiveId: uuid.nullable(),
  enabled: z.boolean(),
  captureCode: z.string().trim().max(32).nullable(),
});

const OBJ_COLS: Record<string, string> = {
  name: 'name',
  description: 'description',
  instructions: 'instructions',
  sortOrder: 'sort_order',
  lat: 'lat',
  lng: 'lng',
  icon: 'icon',
  color: 'color',
  type: 'type',
  imageUrl: 'image_url',
  documentUrl: 'document_url',
  methods: 'methods',
  requireGeofence: 'require_geofence',
  availabilityStart: 'availability_start',
  availabilityEnd: 'availability_end',
  cooldownSec: 'cooldown_sec',
  maxCaptures: 'max_captures',
  allowedTeamIds: 'allowed_team_ids',
  prerequisiteIds: 'prerequisite_ids',
  nextObjectiveId: 'next_objective_id',
  enabled: 'enabled',
};

function checkCode(code: string | null | undefined): string | null {
  if (code === undefined || code === null || code === '') return null;
  const c = normalizeCode(code);
  if (!/^[A-Z0-9]{4,32}$/.test(c)) throw badRequest(tr`Codes use 4–32 letters and digits.`, 'invalid_argument', { captureCode: tr`4–32 letters and digits` });
  return c;
}

async function gmObjective(ctx: EventContext, objectiveId: string) {
  const set = await loadObjectives(ctx.event.id);
  const row = set.rows.find((r) => r.id === objectiveId);
  if (!row) throw notFound(tr`Objective not found.`);
  return objectiveDto(ctx, row, statusOf(row, set.counts), set);
}

contentRouter.get('/:eventId/objectives', async (req, res) => {
  const ctx = await requireMember(idParam(req, 'eventId'), currentUser(req).id);
  res.json(objectiveDtos(ctx, await loadObjectives(ctx.event.id)));
});

contentRouter.get('/:eventId/objectives/:objectiveId', async (req, res) => {
  const ctx = await requireMember(idParam(req, 'eventId'), currentUser(req).id);
  const objectiveId = idParam(req, 'objectiveId');
  const set = await loadObjectives(ctx.event.id);
  const row = set.rows.find((r) => r.id === objectiveId);
  const status = row ? statusOf(row, set.counts) : null;
  if (!row || !status || !objectiveVisible(row, status, ctx.viewer, { status: ctx.event.status, phase: ctx.event.phase, rules: ctx.rules })) throw notFound(tr`Objective not found.`);
  const captures = await many(`SELECT ${dto.CAPTURE_SELECT} WHERE c.objective_id = $1 ORDER BY c.created_at DESC LIMIT 30`, [objectiveId]);
  res.json({ objective: objectiveDto(ctx, row, status, set), captures: captures.map(dto.capture) });
});

contentRouter.post('/:eventId/objectives', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, objectiveInput.partial().required({ name: true, lat: true, lng: true }));
  const id = await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t);
    if (FINISHED.includes(ctx.event.status)) throw conflict(tr`This event is over.`, 'event_finished');
    const n = await one<{ n: number }>('SELECT count(*)::int AS n FROM objectives WHERE event_id = $1', [eventId], t);
    if ((n?.n ?? 0) >= 500) throw conflict(tr`An event can have at most 500 objectives.`, 'too_many');
    const code = checkCode(b.captureCode);
    const objId = await insertObjective(t, eventId, {
      name: b.name,
      description: b.description,
      instructions: b.instructions,
      sort_order: b.sortOrder ?? n?.n ?? 0,
      lat: b.lat,
      lng: b.lng,
      icon: b.icon,
      color: b.color,
      type: b.type,
      image_url: b.imageUrl,
      document_url: b.documentUrl,
      methods: b.methods ?? ['code'],
      require_geofence: b.requireGeofence,
      geofence: merge(DEFAULT_GEOFENCE, b.geofence ?? {}),
      rewards: merge(DEFAULT_REWARDS, b.rewards ?? {}),
      availability_start: b.availabilityStart,
      availability_end: b.availabilityEnd,
      cooldown_sec: b.cooldownSec,
      max_captures: b.maxCaptures,
      allowed_team_ids: [],
      visibility: b.visibility ?? { mode: 'all', teamIds: [] },
      enabled: b.enabled,
    });
    await t.query(
      `UPDATE objectives SET allowed_team_ids = $2, prerequisite_ids = $3, next_objective_id = $4,
              capture_code = COALESCE($5, capture_code) WHERE id = $1`,
      [objId, b.allowedTeamIds ?? [], b.prerequisiteIds ?? [], b.nextObjectiveId ?? null, code ?? ((b.methods ?? ['code']).includes('code') ? readableCode(6) : null)],
    );
    await audit(t, eventId, me.id, 'objective.create', { type: 'objective', id: objId, after: { ...b, captureCode: b.captureCode ? '***' : undefined } });
    return objId;
  }).catch(uniqueCode);
  hub.invalidate(eventId, ['objectives']);
  res.status(201).json(await gmObjective(await eventContext(eventId, me.id), id));
});

function uniqueCode(err: unknown): never {
  if ((err as { code?: string; constraint?: string }).code === '23505' && (err as { constraint?: string }).constraint === 'objectives_code_per_event') {
    throw conflict(tr`Another objective already uses this code.`, 'code_taken', { captureCode: tr`Already used by another objective` });
  }
  throw err;
}

contentRouter.patch('/:eventId/objectives/:objectiveId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const objectiveId = idParam(req, 'objectiveId');
  const b = body(req, objectiveInput.partial());
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t);
    if (FINISHED.includes(ctx.event.status)) throw conflict(tr`This event is over.`, 'event_finished');
    const cur = await one<ObjRow>('SELECT * FROM objectives WHERE id = $1 AND event_id = $2 FOR UPDATE', [objectiveId, eventId], t);
    if (!cur) throw notFound(tr`Objective not found.`);
    if (b.prerequisiteIds?.includes(objectiveId) || b.nextObjectiveId === objectiveId) {
      throw badRequest(tr`An objective cannot depend on itself.`, 'invalid_argument', { prerequisiteIds: tr`Remove this objective` });
    }
    const sets: string[] = [];
    const params: unknown[] = [objectiveId];
    for (const [k, col] of Object.entries(OBJ_COLS)) {
      const v = (b as Record<string, unknown>)[k];
      if (v !== undefined) {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (b.geofence) {
      params.push(JSON.stringify(merge(merge(DEFAULT_GEOFENCE, cur.geofence ?? {}), b.geofence)));
      sets.push(`geofence = $${params.length}`);
    }
    if (b.rewards) {
      params.push(JSON.stringify(merge(merge(DEFAULT_REWARDS, cur.rewards ?? {}), b.rewards)));
      sets.push(`rewards = $${params.length}`);
    }
    if (b.visibility) {
      params.push(JSON.stringify(b.visibility));
      sets.push(`visibility = $${params.length}`);
    }
    if (b.captureCode !== undefined) {
      params.push(checkCode(b.captureCode));
      sets.push(`capture_code = $${params.length}`);
    }
    if (!sets.length) return;
    await t.query(`UPDATE objectives SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
    await audit(t, eventId, me.id, 'objective.update', { type: 'objective', id: objectiveId, after: { ...b, captureCode: b.captureCode !== undefined ? '***' : undefined } });
  }).catch(uniqueCode);
  hub.invalidate(eventId, ['objectives']);
  res.json(await gmObjective(await eventContext(eventId, me.id), objectiveId));
});

contentRouter.delete('/:eventId/objectives/:objectiveId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const objectiveId = idParam(req, 'objectiveId');
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t, true);
    if (ctx.event.started_at) throw conflict(tr`Objectives cannot be deleted after the game started. Disable it instead.`, 'game_started');
    await t.query('UPDATE objectives SET prerequisite_ids = array_remove(prerequisite_ids, $2) WHERE event_id = $1', [eventId, objectiveId]);
    const r = await t.query('DELETE FROM objectives WHERE id = $1 AND event_id = $2', [objectiveId, eventId]);
    if (!r.rowCount) throw notFound(tr`Objective not found.`);
    await audit(t, eventId, me.id, 'objective.delete', { type: 'objective', id: objectiveId });
  });
  hub.invalidate(eventId, ['objectives']);
  res.json({ ok: true });
});

contentRouter.post('/:eventId/objectives/:objectiveId/duplicate', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const objectiveId = idParam(req, 'objectiveId');
  const id = await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const o = await one('SELECT * FROM objectives WHERE id = $1 AND event_id = $2', [objectiveId, eventId], t);
    if (!o) throw notFound(tr`Objective not found.`);
    const newId = await insertObjective(t, eventId, { ...o, id: null, name: tr`${o.name} (copy)`.slice(0, 120), lat: o.lat + 0.00013, lng: o.lng + 0.00013 });
    await t.query('UPDATE objectives SET allowed_team_ids = $2, prerequisite_ids = $3, capture_code = $4 WHERE id = $1', [
      newId,
      o.allowed_team_ids,
      o.prerequisite_ids,
      o.methods.includes('code') ? readableCode(6) : null,
    ]);
    return newId;
  });
  hub.invalidate(eventId, ['objectives']);
  res.status(201).json(await gmObjective(await eventContext(eventId, me.id), id));
});

async function qrFor(eventId: string, objectiveId: string) {
  const o = await one<{ qr_token: string; qr_version: number }>('SELECT qr_token, qr_version FROM objectives WHERE id = $1 AND event_id = $2', [objectiveId, eventId]);
  if (!o) throw notFound(tr`Objective not found.`);
  const payload = `airsofthub:obj:${eventId}:${objectiveId}:${o.qr_token}`;
  const opts = { errorCorrectionLevel: 'M' as const, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } };
  return {
    payload,
    qrVersion: o.qr_version,
    svg: await QRCode.toString(payload, { ...opts, type: 'svg' }),
    pngDataUrl: await QRCode.toDataURL(payload, { ...opts, width: 1024 }),
  };
}

contentRouter.get('/:eventId/objectives/:objectiveId/qr', async (req, res) => {
  const eventId = idParam(req, 'eventId');
  await requireGm(eventId, currentUser(req).id);
  res.setHeader('Cache-Control', 'no-store');
  res.json(await qrFor(eventId, idParam(req, 'objectiveId')));
});

contentRouter.post('/:eventId/objectives/:objectiveId/qr/regenerate', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const objectiveId = idParam(req, 'objectiveId');
  await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const r = await t.query('UPDATE objectives SET qr_token = $3, qr_version = qr_version + 1, updated_at = now() WHERE id = $1 AND event_id = $2', [
      objectiveId,
      eventId,
      randomToken(18),
    ]);
    if (!r.rowCount) throw notFound(tr`Objective not found.`);
    await audit(t, eventId, me.id, 'objective.qr.regenerate', { type: 'objective', id: objectiveId });
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json(await qrFor(eventId, objectiveId));
});

/** Parse `airsofthub:obj:<eventId>:<objectiveId>:<token>` (codes printed before the rename start with `zeus:obj:`). */
function parseQr(payload: string) {
  const m = payload.trim().match(/^(?:airsofthub|zeus):obj:([0-9a-f-]{36}):([0-9a-f-]{36}):([A-Za-z0-9_-]{16,64})$/i);
  return m ? { eventId: m[1].toLowerCase(), objectiveId: m[2].toLowerCase(), token: m[3] } : null;
}

contentRouter.post('/:eventId/objectives/:objectiveId/capture', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const objectiveId = idParam(req, 'objectiveId');
  const b = body(req, z.object({ method: z.enum(['code', 'qr']), code: z.string().max(64).optional(), qrPayload: z.string().max(300).optional(), clientTxId }));
  const ctx = await requireMember(eventId, me.id);
  if (ctx.isGm || !ctx.member || !playsIn(ctx.member)) throw forbidden(tr`Game Masters capture objectives from the control center.`, 'not_player');
  if (!ctx.member.team_id) throw conflict(tr`You are not on a team.`, 'no_team');

  const attemptKey = `${me.id}:${objectiveId}`;
  if (b.method === 'code') {
    await consume('cap-code-min', attemptKey, 5, 60, tr`Too many code attempts. Wait a minute.`);
    await consume('cap-code-hour', attemptKey, 30, 3600, tr`Too many code attempts on this objective. Ask the Game Master.`);
  } else {
    await consume('cap-qr', me.id, 10, 60, tr`Too many scans. Wait a minute.`);
  }

  // Secret check happens before the transaction so failed attempts are always recorded.
  const o = await one<{ methods: string[]; capture_code: string | null; qr_token: string }>(
    'SELECT methods, capture_code, qr_token FROM objectives WHERE id = $1 AND event_id = $2',
    [objectiveId, eventId],
  );
  if (!o) throw notFound(tr`Objective not found.`);
  let failure: { code: string; message: string } | null = null;
  if (b.method === 'code') {
    if (!o.methods.includes('code')) failure = { code: 'method_not_allowed', message: tr`This objective is not captured with a code.` };
    else if (!b.code || !o.capture_code || !safeEqual(normalizeCode(b.code), normalizeCode(o.capture_code))) failure = { code: 'wrong_code', message: tr`Wrong code.` };
  } else {
    const qr = b.qrPayload ? parseQr(b.qrPayload) : null;
    if (!o.methods.includes('qr')) failure = { code: 'method_not_allowed', message: tr`This objective is not captured with a QR code.` };
    else if (!qr) failure = { code: 'invalid_qr', message: tr`This is not an AirsoftHub objective code.` };
    else if (qr.eventId !== eventId) failure = { code: 'wrong_event', message: tr`This QR code belongs to another event.` };
    else if (qr.objectiveId !== objectiveId) failure = { code: 'wrong_objective', message: tr`This QR code belongs to another objective.` };
    else if (!safeEqual(qr.token, o.qr_token)) failure = { code: 'invalid_qr', message: tr`This QR code was replaced by the Game Master.` };
  }
  if (failure) {
    await pool.query('INSERT INTO capture_attempts (event_id, objective_id, user_id, method, success, reason) VALUES ($1,$2,$3,$4,false,$5)', [
      eventId,
      objectiveId,
      me.id,
      b.method,
      failure.code,
    ]);
    const left = b.method === 'code' ? await remaining('cap-code-hour', attemptKey, 30, 3600) : null;
    if (left !== null && left <= 20) {
      await tx((t) =>
        alert(t, eventId, {
          type: 'capture_failed',
          severity: left <= 5 ? 'warning' : 'info',
          userId: me.id,
          message: (tr) => tr`${me.nickname} entered ${30 - left} wrong codes on an objective`,
          data: { objectiveId },
          dedupeKey: `codes:${me.id}:${objectiveId}`,
        }),
      );
    }
    throw badRequest(failure.message, failure.code);
  }

  const { result } = await tx(async (t) => {
    const locked = await eventContext(eventId, me.id, t);
    return idempotent(t, me.id, b.clientTxId, 'capture', () =>
      performCapture(t, { ctx: locked, objectiveId, teamId: ctx.member!.team_id!, userId: me.id, method: b.method, clientTxId: b.clientTxId, now: Date.now() }),
    );
  });
  await pool.query('INSERT INTO capture_attempts (event_id, objective_id, user_id, method, success) VALUES ($1,$2,$3,$4,true)', [eventId, objectiveId, me.id, b.method]);
  res.json(result);
});

contentRouter.get('/:eventId/captures', async (req, res) => {
  const ctx = await requireMember(idParam(req, 'eventId'), currentUser(req).id);
  const q = queryOf(req, z.object({ cursor: z.string().optional() }));
  const c = decodeCursor(q.cursor);
  const rows = await many(
    `SELECT ${dto.CAPTURE_SELECT} WHERE c.event_id = $1 ${c ? 'AND (c.created_at, c.id) < ($2::timestamptz, $3::uuid)' : ''} ORDER BY c.created_at DESC, c.id DESC LIMIT 51`,
    c ? [ctx.event.id, c.at, c.id] : [ctx.event.id],
  );
  let visible = rows;
  if (!ctx.isGm) {
    const set = await loadObjectives(ctx.event.id);
    const ok = new Set(
      set.rows.filter((o) => objectiveVisible(o, statusOf(o, set.counts), ctx.viewer, { status: ctx.event.status, phase: ctx.event.phase, rules: ctx.rules })).map((o) => o.id),
    );
    visible = rows.filter((r) => ok.has(r.objective_id));
  }
  const p = page(rows, 50, (r) => r);
  res.json({ items: visible.slice(0, 50).map(dto.capture), nextCursor: p.nextCursor });
});

// ------------------------------------------------------------------ POIs & zones

const contentVisibility = z.object({
  mode: z.enum(['all', 'teams', 'gm_only']).default('all'),
  teamIds: z.array(uuid).max(16).optional(),
  squadIds: z.array(uuid).max(100).optional(),
  roles: z.array(playerRole).max(8).optional(),
  phases: z.array(shortText(40)).max(20).optional(),
  activeFrom: isoDate.nullable().optional(),
  activeUntil: isoDate.nullable().optional(),
});

const poiInput = z.object({
  name: shortText(120).min(1, 'Name the point'),
  type: z.enum(['ammo', 'medic', 'respawn', 'safe_zone', 'team_base', 'vehicle', 'supply', 'extraction', 'restricted', 'custom']),
  description: z.string().max(5000),
  lat,
  lng,
  icon: shortText(40),
  color: hexColor,
  imageUrl: z.string().max(500).startsWith('/api/files/').nullable(),
  teamId: uuid.nullable(),
  visibility: contentVisibility,
});
const POI_COLS: Record<string, string> = { name: 'name', type: 'type', description: 'description', lat: 'lat', lng: 'lng', icon: 'icon', color: 'color', imageUrl: 'image_url', teamId: 'team_id' };

const zoneInput = z.object({
  kind: z.enum(['playable', 'restricted', 'safe', 'spawn', 'respawn', 'base', 'extraction', 'route', 'line', 'sector', 'label']),
  geometry: z.enum(['point', 'circle', 'polygon', 'polyline']),
  points: z.array(z.object({ lat, lng })).max(500),
  radiusM: z.number().min(1).max(20_000).nullable(),
  label: shortText(120),
  description: z.string().max(5000),
  color: hexColor,
  fillOpacity: z.number().min(0).max(1),
  strokeWidth: z.number().min(0).max(20),
  icon: shortText(40).nullable(),
  teamId: uuid.nullable(),
  visibility: contentVisibility,
});
const ZONE_COLS: Record<string, string> = {
  kind: 'kind',
  geometry: 'geometry',
  radiusM: 'radius_m',
  label: 'label',
  description: 'description',
  color: 'color',
  fillOpacity: 'fill_opacity',
  strokeWidth: 'stroke_width',
  icon: 'icon',
  teamId: 'team_id',
};

function checkGeometry(geometry: string, points: { lat: number; lng: number }[], radius: number | null | undefined) {
  const need = geometry === 'polygon' ? 3 : geometry === 'polyline' ? 2 : 1;
  if (points.length < need) throw badRequest(tr`This shape needs at least ${need} points.`, 'invalid_argument', { points: tr`Not enough points` });
  if (geometry === 'circle' && !radius) throw badRequest(tr`A circle needs a radius.`, 'invalid_argument', { radiusM: tr`Required` });
}

function teamAllianceFn(teams: { id: string; alliance_id: string | null }[]) {
  const m = new Map(teams.map((t) => [t.id, t.alliance_id]));
  return (id: string) => m.get(id) ?? null;
}

contentRouter.get('/:eventId/pois', async (req, res) => {
  const ctx = await requireMember(idParam(req, 'eventId'), currentUser(req).id);
  res.json(await visiblePois(ctx));
});

export async function visiblePois(ctx: EventContext) {
  const rows = await many('SELECT * FROM pois WHERE event_id = $1 ORDER BY created_at', [ctx.event.id]);
  const teams = await many<{ id: string; alliance_id: string | null }>('SELECT id, alliance_id FROM teams WHERE event_id = $1', [ctx.event.id]);
  const ev = { status: ctx.event.status, phase: ctx.event.phase, rules: ctx.rules };
  const now = Date.now();
  return rows.filter((p) => contentVisible(p.visibility, ctx.viewer, ev, now, p.team_id, p.type === 'team_base', teamAllianceFn(teams))).map(dto.poi);
}

export async function visibleZones(ctx: EventContext) {
  const rows = await many('SELECT * FROM zones WHERE event_id = $1 ORDER BY created_at', [ctx.event.id]);
  const teams = await many<{ id: string; alliance_id: string | null }>('SELECT id, alliance_id FROM teams WHERE event_id = $1', [ctx.event.id]);
  const ev = { status: ctx.event.status, phase: ctx.event.phase, rules: ctx.rules };
  const now = Date.now();
  return rows.filter((z) => contentVisible(z.visibility, ctx.viewer, ev, now, z.team_id, z.kind === 'base', teamAllianceFn(teams))).map(dto.zone);
}

contentRouter.post('/:eventId/pois', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, poiInput.partial().required({ name: true, lat: true, lng: true }));
  const row = await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const r = await one(
      `INSERT INTO pois (event_id, name, type, description, lat, lng, icon, color, image_url, team_id, visibility)
       VALUES ($1,$2,COALESCE($3,'custom'),COALESCE($4,''),$5,$6,COALESCE($7,'map-pin'),COALESCE($8,'#C9CDBF'),$9,$10,COALESCE($11,'{"mode":"all"}'::jsonb)) RETURNING *`,
      [eventId, b.name, b.type ?? null, b.description ?? null, b.lat, b.lng, b.icon ?? null, b.color ?? null, b.imageUrl ?? null, b.teamId ?? null, b.visibility ? JSON.stringify(b.visibility) : null],
      t,
    );
    await audit(t, eventId, me.id, 'poi.create', { type: 'poi', id: r!.id, after: b });
    return r!;
  });
  hub.invalidate(eventId, ['pois']);
  res.status(201).json(dto.poi(row));
});

contentRouter.patch('/:eventId/pois/:poiId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const poiId = idParam(req, 'poiId');
  const b = body(req, poiInput.partial());
  const row = await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const sets: string[] = [];
    const params: unknown[] = [poiId, eventId];
    for (const [k, col] of Object.entries(POI_COLS)) {
      const v = (b as Record<string, unknown>)[k];
      if (v !== undefined) {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (b.visibility) {
      params.push(JSON.stringify(b.visibility));
      sets.push(`visibility = $${params.length}`);
    }
    const r = await one(`UPDATE pois SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 AND event_id = $2 RETURNING *`, params, t);
    if (!r) throw notFound(tr`Point not found.`);
    await audit(t, eventId, me.id, 'poi.update', { type: 'poi', id: poiId, after: b });
    return r;
  });
  hub.invalidate(eventId, ['pois']);
  res.json(dto.poi(row));
});

contentRouter.delete('/:eventId/pois/:poiId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const r = await t.query('DELETE FROM pois WHERE id = $1 AND event_id = $2', [idParam(req, 'poiId'), eventId]);
    if (!r.rowCount) throw notFound(tr`Point not found.`);
    await audit(t, eventId, me.id, 'poi.delete', { type: 'poi', id: req.params.poiId });
  });
  hub.invalidate(eventId, ['pois']);
  res.json({ ok: true });
});

contentRouter.get('/:eventId/zones', async (req, res) => {
  const ctx = await requireMember(idParam(req, 'eventId'), currentUser(req).id);
  res.json(await visibleZones(ctx));
});

contentRouter.post('/:eventId/zones', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, zoneInput.partial().required({ kind: true, geometry: true, points: true }));
  checkGeometry(b.geometry, b.points, b.radiusM);
  const row = await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const n = await one<{ n: number }>('SELECT count(*)::int AS n FROM zones WHERE event_id = $1', [eventId], t);
    if ((n?.n ?? 0) >= 500) throw conflict(tr`An event can have at most 500 map shapes.`, 'too_many');
    const r = await one(
      `INSERT INTO zones (event_id, kind, geometry, points, radius_m, label, description, color, fill_opacity, stroke_width, icon, team_id, visibility)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,''),COALESCE($7,''),COALESCE($8,'#9DAE5C'),COALESCE($9,0.15),COALESCE($10,2),$11,$12,COALESCE($13,'{"mode":"all"}'::jsonb)) RETURNING *`,
      [eventId, b.kind, b.geometry, JSON.stringify(b.points), b.radiusM ?? null, b.label ?? null, b.description ?? null, b.color ?? null, b.fillOpacity ?? null,
        b.strokeWidth ?? null, b.icon ?? null, b.teamId ?? null, b.visibility ? JSON.stringify(b.visibility) : null],
      t,
    );
    await audit(t, eventId, me.id, 'zone.create', { type: 'zone', id: r!.id, after: { kind: b.kind, geometry: b.geometry } });
    return r!;
  });
  hub.invalidate(eventId, ['zones']);
  res.status(201).json(dto.zone(row));
});

contentRouter.patch('/:eventId/zones/:zoneId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const zoneId = idParam(req, 'zoneId');
  const b = body(req, zoneInput.partial());
  const row = await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const cur = await one('SELECT geometry, points, radius_m FROM zones WHERE id = $1 AND event_id = $2', [zoneId, eventId], t);
    if (!cur) throw notFound(tr`Shape not found.`);
    checkGeometry(b.geometry ?? cur.geometry, b.points ?? cur.points, b.radiusM === undefined ? cur.radius_m : b.radiusM);
    const sets: string[] = [];
    const params: unknown[] = [zoneId];
    for (const [k, col] of Object.entries(ZONE_COLS)) {
      const v = (b as Record<string, unknown>)[k];
      if (v !== undefined) {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (b.points) {
      params.push(JSON.stringify(b.points));
      sets.push(`points = $${params.length}`);
    }
    if (b.visibility) {
      params.push(JSON.stringify(b.visibility));
      sets.push(`visibility = $${params.length}`);
    }
    const r = await one(`UPDATE zones SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1 RETURNING *`, params, t);
    await audit(t, eventId, me.id, 'zone.update', { type: 'zone', id: zoneId });
    return r!;
  });
  hub.invalidate(eventId, ['zones']);
  res.json(dto.zone(row));
});

contentRouter.delete('/:eventId/zones/:zoneId', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    const r = await t.query('DELETE FROM zones WHERE id = $1 AND event_id = $2', [idParam(req, 'zoneId'), eventId]);
    if (!r.rowCount) throw notFound(tr`Shape not found.`);
    await audit(t, eventId, me.id, 'zone.delete', { type: 'zone', id: req.params.zoneId });
  });
  hub.invalidate(eventId, ['zones']);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ import & map templates

const ZONE_KINDS = new Set(['playable', 'restricted', 'safe', 'spawn', 'respawn', 'base', 'extraction', 'route', 'line', 'sector', 'label']);
const POI_TYPES = new Set(['ammo', 'medic', 'respawn', 'safe_zone', 'team_base', 'vehicle', 'supply', 'extraction', 'restricted', 'custom']);

interface Parsed {
  objectives: { name: string; lat: number; lng: number; description: string }[];
  pois: { name: string; type: string; lat: number; lng: number; description: string }[];
  zones: { kind: string; geometry: string; points: { lat: number; lng: number }[]; label: string; description: string; radius_m: number | null }[];
}

function validLatLng(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function parseImport(format: 'geojson' | 'csv', content: string): Parsed {
  const out: Parsed = { objectives: [], pois: [], zones: [] };
  const add = (type: string, name: string, desc: string, geom: string, coords: { lat: number; lng: number }[], radius: number | null) => {
    if (!coords.length || !coords.every((c) => validLatLng(c.lat, c.lng))) return;
    const t = type.toLowerCase().trim();
    if (geom === 'point' && t === 'objective') out.objectives.push({ name, lat: coords[0].lat, lng: coords[0].lng, description: desc });
    else if (geom === 'point' && (POI_TYPES.has(t) || t === 'poi' || !ZONE_KINDS.has(t)))
      out.pois.push({ name, type: POI_TYPES.has(t) ? t : 'custom', lat: coords[0].lat, lng: coords[0].lng, description: desc });
    else out.zones.push({ kind: ZONE_KINDS.has(t) ? t : geom === 'polyline' ? 'route' : geom === 'point' ? 'label' : 'playable', geometry: geom, points: coords, label: name, description: desc, radius_m: radius });
  };
  if (format === 'geojson') {
    let gj: { type?: string; features?: { geometry?: { type: string; coordinates: unknown }; properties?: Record<string, unknown> }[] };
    try {
      gj = JSON.parse(content);
    } catch {
      throw badRequest(tr`This is not valid GeoJSON.`, 'invalid_import');
    }
    const features = gj.type === 'FeatureCollection' ? (gj.features ?? []) : gj.type === 'Feature' ? [gj as never] : [];
    for (const f of features.slice(0, 1000)) {
      const p = f.properties ?? {};
      const name = String(p.name ?? p.title ?? tr`Imported`).slice(0, 120);
      const desc = String(p.description ?? '').slice(0, 2000);
      const type = String(p.type ?? p.kind ?? '');
      const g = f.geometry;
      if (!g) continue;
      const pt = (c: unknown) => ({ lat: Number((c as number[])[1]), lng: Number((c as number[])[0]) });
      if (g.type === 'Point') add(type || 'poi', name, desc, p.radius ? 'circle' : 'point', [pt(g.coordinates)], p.radius ? Number(p.radius) : null);
      else if (g.type === 'LineString') add(type || 'route', name, desc, 'polyline', (g.coordinates as unknown[]).map(pt), null);
      else if (g.type === 'Polygon') add(type || 'playable', name, desc, 'polygon', ((g.coordinates as unknown[][])[0] ?? []).slice(0, -1).map(pt), null);
    }
  } else {
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0]?.toLowerCase().split(/[;,]/).map((h) => h.trim()) ?? [];
    const idx = (n: string) => header.indexOf(n);
    if (idx('lat') < 0 || idx('lng') < 0) throw badRequest(tr`The CSV needs a header with type,name,lat,lng[,description].`, 'invalid_import');
    for (const line of lines.slice(1, 1001)) {
      const cells = line.split(/[;,](?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, ''));
      add(cells[idx('type')] ?? 'poi', (cells[idx('name')] ?? tr`Imported`).slice(0, 120), (cells[idx('description')] ?? '').slice(0, 2000), 'point', [
        { lat: Number(cells[idx('lat')]), lng: Number(cells[idx('lng')]) },
      ], null);
    }
  }
  return out;
}

contentRouter.post('/:eventId/map/import', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, z.object({ format: z.enum(['geojson', 'csv']), content: z.string().max(2_000_000) }));
  const parsed = parseImport(b.format, b.content);
  if (!parsed.objectives.length && !parsed.pois.length && !parsed.zones.length) throw badRequest(tr`Nothing to import: no valid coordinates found.`, 'invalid_import');
  await tx(async (t) => {
    await requireGm(eventId, me.id, t);
    for (const o of parsed.objectives) {
      const id = await insertObjective(t, eventId, { ...o, methods: ['code'], rewards: DEFAULT_REWARDS, geofence: DEFAULT_GEOFENCE });
      await t.query('UPDATE objectives SET capture_code = $2 WHERE id = $1', [id, readableCode(6)]);
    }
    await copyMapContent(t, eventId, { pois: parsed.pois, zones: parsed.zones });
    await audit(t, eventId, me.id, 'map.import', { after: { objectives: parsed.objectives.length, pois: parsed.pois.length, zones: parsed.zones.length } });
  });
  hub.invalidate(eventId, ['objectives', 'pois', 'zones']);
  res.json({ objectives: parsed.objectives.length, pois: parsed.pois.length, zones: parsed.zones.length });
});

contentRouter.post('/:eventId/map/save-template', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, z.object({ name: shortText(120).min(2) }));
  await requireGm(eventId, me.id);
  const data = {
    area: await one('SELECT area_lat AS lat, area_lng AS lng, area_zoom AS zoom FROM events WHERE id = $1', [eventId]),
    zones: await many('SELECT kind, geometry, points, radius_m, label, description, color, fill_opacity, stroke_width, icon FROM zones WHERE event_id = $1', [eventId]),
    pois: await many('SELECT name, type, description, lat, lng, icon, color, image_url FROM pois WHERE event_id = $1', [eventId]),
    objectives: await many(
      'SELECT name, description, instructions, lat, lng, icon, color, type, methods, require_geofence, geofence, rewards, cooldown_sec, max_captures FROM objectives WHERE event_id = $1',
      [eventId],
    ),
  };
  const row = await one('INSERT INTO map_templates (owner_id, name, data) VALUES ($1,$2,$3) RETURNING id, name, created_at', [me.id, b.name, JSON.stringify(data)]);
  res.status(201).json({ id: row!.id, name: row!.name, createdAt: dto.iso(row!.created_at), zoneCount: data.zones.length, poiCount: data.pois.length, objectiveCount: data.objectives.length });
});

contentRouter.post('/:eventId/map/apply-template', async (req, res) => {
  const me = currentUser(req);
  const eventId = idParam(req, 'eventId');
  const b = body(req, z.object({ templateId: uuid }));
  const tpl = await one('SELECT data FROM map_templates WHERE id = $1 AND owner_id = $2', [b.templateId, me.id]);
  if (!tpl) throw notFound(tr`Template not found.`);
  const data = tpl.data as { area?: { lat: number; lng: number; zoom: number }; zones: never[]; pois: never[]; objectives: Record<string, unknown>[] };
  await tx(async (t) => {
    const ctx = await requireGm(eventId, me.id, t);
    if (FINISHED.includes(ctx.event.status)) throw conflict(tr`This event is over.`, 'event_finished');
    for (const o of data.objectives ?? []) {
      const id = await insertObjective(t, eventId, o);
      if ((o.methods as string[] | undefined)?.includes('code')) await t.query('UPDATE objectives SET capture_code = $2 WHERE id = $1', [id, readableCode(6)]);
    }
    await copyMapContent(t, eventId, { pois: data.pois ?? [], zones: data.zones ?? [] });
    if (data.area?.lat !== null && data.area?.lat !== undefined && ctx.event.area_lat === null) {
      await t.query('UPDATE events SET area_lat = $2, area_lng = $3, area_zoom = $4 WHERE id = $1', [eventId, data.area.lat, data.area.lng, data.area.zoom]);
    }
    await audit(t, eventId, me.id, 'map.apply_template', { type: 'map_template', id: b.templateId });
  });
  hub.invalidate(eventId, ['objectives', 'pois', 'zones', 'event']);
  res.json({ objectives: data.objectives?.length ?? 0, pois: data.pois?.length ?? 0, zones: data.zones?.length ?? 0 });
});

