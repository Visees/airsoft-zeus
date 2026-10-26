import { randomUUID } from 'node:crypto';
import { many, one, type Queryable, type Row, type Tx } from '../db.js';
import { readableCode } from '../lib/ids.js';

/**
 * Portable snapshot of an event's configuration (no players, scores or runtime state).
 * Used for duplicate, event templates and (zones/POIs/objective pins only) map templates.
 */
export interface EventSnapshot {
  event: Record<string, unknown>;
  teams: Row[];
  squads: Row[];
  objectives: Row[];
  pois: Row[];
  zones: Row[];
  perks: Row[];
}

const EVENT_FIELDS = [
  'name', 'cover_url', 'description', 'game_mode', 'custom_mode_name', 'custom_mode_rules', 'start_at', 'end_at', 'meeting_address', 'meeting_lat',
  'meeting_lng', 'min_players', 'max_players', 'visibility', 'requires_approval', 'rules', 'safety_rules', 'required_equipment', 'chrono_info',
  'team_selection', 'area_lat', 'area_lng', 'area_zoom', 'tracking', 'visibility_rules', 'scoring', 'store_enabled', 'auto_end', 'map_overlay', 'map_layers',
];
const OBJECTIVE_FIELDS = [
  'id', 'name', 'description', 'instructions', 'sort_order', 'lat', 'lng', 'icon', 'color', 'type', 'image_url', 'document_url', 'methods',
  'require_geofence', 'geofence', 'rewards', 'availability_start', 'availability_end', 'cooldown_sec', 'max_captures', 'allowed_team_ids',
  'visibility', 'prerequisite_ids', 'next_objective_id', 'enabled',
];

const pick = (r: Row, fields: string[]) => Object.fromEntries(fields.map((f) => [f, r[f]]));

export async function snapshotEvent(eventId: string, q: Queryable): Promise<EventSnapshot> {
  const ev = await one('SELECT * FROM events WHERE id = $1', [eventId], q);
  return {
    event: pick(ev!, EVENT_FIELDS),
    teams: await many('SELECT id, name, color, icon, pattern, capacity, sort_order, alliance_id, base_lat, base_lng FROM teams WHERE event_id = $1', [eventId], q),
    squads: await many('SELECT id, team_id, name, callsign, icon FROM squads WHERE event_id = $1', [eventId], q),
    objectives: (await many('SELECT * FROM objectives WHERE event_id = $1 ORDER BY sort_order', [eventId], q)).map((o) => pick(o, OBJECTIVE_FIELDS)),
    pois: await many('SELECT name, type, description, lat, lng, icon, color, image_url, team_id, visibility FROM pois WHERE event_id = $1', [eventId], q),
    zones: await many(
      'SELECT kind, geometry, points, radius_m, label, description, color, fill_opacity, stroke_width, icon, team_id, visibility, layer FROM zones WHERE event_id = $1',
      [eventId],
      q,
    ),
    perks: await many(
      `SELECT name, description, icon, type, price, duration_sec, cooldown_sec, total_quantity, per_team_limit, eligible, eligible_roles,
              requires_approval, activation, target, config, enabled, sort_order FROM perks WHERE event_id = $1`,
      [eventId],
      q,
    ),
  };
}

function remapIds(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remapIds(v, map)).filter((v) => typeof v !== 'string' || !/^[0-9a-f-]{36}$/.test(v) || [...map.values()].includes(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [map.get(k) ?? k, remapIds(v, map)]));
  }
  return value;
}

/** Create a draft event from a snapshot; returns the new event id. */
export async function materialize(t: Tx, ownerId: string, snap: EventSnapshot, overrides: { name?: string; startAt?: string; endAt?: string } = {}): Promise<string> {
  const e = snap.event as Row;
  const ev = await one<{ id: string }>(
    `INSERT INTO events (owner_id, name, cover_url, description, game_mode, custom_mode_name, custom_mode_rules, start_at, end_at, meeting_address,
                         meeting_lat, meeting_lng, min_players, max_players, visibility, requires_approval, rules, safety_rules, required_equipment,
                         chrono_info, team_selection, area_lat, area_lng, area_zoom, tracking, visibility_rules, scoring, store_enabled, auto_end, join_code, map_overlay, map_layers)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32) RETURNING id`,
    [
      ownerId, overrides.name ?? e.name, e.cover_url, e.description, e.game_mode, e.custom_mode_name, e.custom_mode_rules,
      overrides.startAt ?? e.start_at, overrides.endAt ?? e.end_at, e.meeting_address, e.meeting_lat, e.meeting_lng, e.min_players, e.max_players,
      e.visibility, e.requires_approval, e.rules, e.safety_rules, e.required_equipment, e.chrono_info, e.team_selection, e.area_lat, e.area_lng,
      e.area_zoom, JSON.stringify(e.tracking ?? {}), JSON.stringify(e.visibility_rules ?? {}), JSON.stringify(e.scoring ?? {}), e.store_enabled ?? true,
      e.auto_end ?? true, readableCode(8), e.map_overlay ? JSON.stringify(e.map_overlay) : null, JSON.stringify(e.map_layers ?? []),
    ],
    t,
  );
  const eventId = ev!.id;
  await t.query(`INSERT INTO event_members (event_id, user_id, role, status) VALUES ($1,$2,'gm','approved')`, [eventId, ownerId]);
  const map = new Map<string, string>();
  for (const tm of snap.teams) map.set(tm.id, randomUUID());
  for (const s of snap.squads) map.set(s.id, randomUUID());
  for (const o of snap.objectives) map.set(o.id as string, randomUUID());

  for (const tm of snap.teams) {
    await t.query(
      `INSERT INTO teams (id, event_id, name, color, icon, pattern, capacity, sort_order, alliance_id, base_lat, base_lng) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [map.get(tm.id), eventId, tm.name, tm.color, tm.icon, tm.pattern, tm.capacity, tm.sort_order, tm.alliance_id, tm.base_lat, tm.base_lng],
    );
  }
  for (const s of snap.squads) {
    if (!map.has(s.team_id)) continue;
    await t.query('INSERT INTO squads (id, event_id, team_id, name, callsign, icon) VALUES ($1,$2,$3,$4,$5,$6)', [map.get(s.id), eventId, map.get(s.team_id), s.name, s.callsign, s.icon]);
  }
  // objectives: insert without links first, then set links (they can reference each other)
  for (const o of snap.objectives) {
    await insertObjective(t, eventId, { ...o, id: map.get(o.id as string) }, map);
  }
  for (const o of snap.objectives) {
    await t.query('UPDATE objectives SET prerequisite_ids = $2, next_objective_id = $3 WHERE id = $1', [
      map.get(o.id as string),
      ((o.prerequisite_ids as string[]) ?? []).map((id) => map.get(id)).filter(Boolean),
      o.next_objective_id ? (map.get(o.next_objective_id as string) ?? null) : null,
    ]);
  }
  await copyMapContent(t, eventId, { pois: snap.pois, zones: snap.zones }, map);
  for (const p of snap.perks) {
    await t.query(
      `INSERT INTO perks (event_id, name, description, icon, type, price, duration_sec, cooldown_sec, total_quantity, remaining_quantity, per_team_limit,
                          eligible, eligible_roles, requires_approval, activation, target, config, enabled, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [eventId, p.name, p.description, p.icon, p.type, p.price, p.duration_sec, p.cooldown_sec, p.total_quantity, p.per_team_limit, p.eligible,
        p.eligible_roles, p.requires_approval, p.activation, p.target, JSON.stringify(p.config ?? {}), p.enabled, p.sort_order],
    );
  }
  return eventId;
}

export async function insertObjective(t: Tx, eventId: string, o: Row, map = new Map<string, string>()): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO objectives (id, event_id, name, description, instructions, sort_order, lat, lng, icon, color, type, image_url, document_url, methods,
                             require_geofence, geofence, rewards, availability_start, availability_end, cooldown_sec, max_captures, allowed_team_ids,
                             visibility, enabled)
     VALUES (COALESCE($1, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id`,
    [
      o.id ?? null, eventId, o.name, o.description ?? '', o.instructions ?? '', o.sort_order ?? 0, o.lat, o.lng, o.icon ?? 'flag', o.color ?? '#E0A84A',
      o.type ?? 'domination', o.image_url ?? null, o.document_url ?? null, o.methods ?? ['code'], o.require_geofence ?? false,
      JSON.stringify(o.geofence ?? {}), JSON.stringify(remapIds(o.rewards ?? {}, map)), o.availability_start ?? null, o.availability_end ?? null,
      o.cooldown_sec ?? 0, o.max_captures ?? 0, ((o.allowed_team_ids as string[]) ?? []).map((id) => map.get(id)).filter(Boolean),
      JSON.stringify(remapIds(o.visibility ?? { mode: 'all' }, map)), o.enabled ?? true,
    ],
    t,
  );
  return row!.id;
}

export async function copyMapContent(t: Tx, eventId: string, content: { pois: Row[]; zones: Row[] }, map = new Map<string, string>()): Promise<void> {
  for (const p of content.pois) {
    await t.query(
      `INSERT INTO pois (event_id, name, type, description, lat, lng, icon, color, image_url, team_id, visibility) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [eventId, p.name, p.type, p.description ?? '', p.lat, p.lng, p.icon ?? 'map-pin', p.color ?? '#C9CDBF', p.image_url ?? null,
        p.team_id ? (map.get(p.team_id) ?? null) : null, JSON.stringify(remapIds(p.visibility ?? { mode: 'all' }, map))],
    );
  }
  for (const z of content.zones) {
    await t.query(
      `INSERT INTO zones (event_id, kind, geometry, points, radius_m, label, description, color, fill_opacity, stroke_width, icon, team_id, visibility, layer)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [eventId, z.kind, z.geometry, JSON.stringify(z.points ?? []), z.radius_m ?? null, z.label ?? '', z.description ?? '', z.color ?? '#9DAE5C',
        z.fill_opacity ?? 0.15, z.stroke_width ?? 2, z.icon ?? null, z.team_id ? (map.get(z.team_id) ?? null) : null,
        JSON.stringify(remapIds(z.visibility ?? { mode: 'all' }, map)), z.layer ?? null],
    );
  }
}
