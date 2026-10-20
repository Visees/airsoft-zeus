import { many, one, pool, tx, type Queryable, type Tx } from '../db.js';
import { forbidden, precondition } from '../errors.js';
import { distanceM } from '../lib/geo.js';
import { consume } from '../lib/rate-limit.js';
import { hub } from '../realtime/hub.js';
import { FRESH_MS, validateSamples, type Accepted, type InSample, type SampleFlag } from './anticheat.js';
import { eventContext, type EventContext } from './context.js';
import { geofence as geofenceOf, rewards as rewardsOf, type Precision } from './defaults.js';
import { advance, fromRow, majorityLeader, toRow } from './geofence.js';
import { activity, alert, eventPlayers, notify } from './journal.js';
import { applyLedger } from './ledger.js';
import { performCapture, statusOf, type ObjRow } from './objectives.js';
import { captureBlock, degrade, objectiveVisible, type Sample } from './rules.js';

const RING_MAX = 90;
const RING_WINDOW_MS = 20 * 60_000;

export interface GeofenceStatusDto {
  objectiveId: string;
  inside: boolean;
  distanceM: number;
  progressSec: number;
  requiredSec: number;
  contested: boolean;
  armed: boolean;
  captured: boolean;
  multiplier: number;
  /** Why a player who may be in the zone is not counted (shown on the capture screen). */
  blocked: 'low_accuracy' | 'screen_closed' | null;
  /** Worst GPS accuracy (m) this objective accepts. */
  maxAccuracyM: number;
  /** Majority rule: another team has more players inside, so this team's hold is paused. */
  outnumbered: boolean;
}

export interface ReportResult {
  accepted: number;
  rejected: number;
  flags: SampleFlag[];
  geofence: GeofenceStatusDto[];
  serverNow: string;
}

export function presenceTtlMs(intervalSec: number): number {
  return Math.max(2.5 * intervalSec * 1000, 20_000);
}

export async function reportLocation(eventId: string, userId: string, samples: InSample[], screenObjectiveId: string | null): Promise<ReportResult> {
  const ctx = await eventContext(eventId, userId);
  const m = ctx.member;
  if (!m || m.status !== 'approved' || m.role !== 'player') throw forbidden('Only players of this event share their location.', 'tracking_not_allowed');
  if (!m.tracking_consent_at) throw forbidden('Turn on location sharing for this event first.', 'tracking_not_allowed');
  const status = ctx.event.status;
  if (status === 'paused' && ctx.tracking.stopWhenPaused) throw precondition('The game is paused; location sharing resumes with the game.', 'tracking_paused');
  if (status !== 'live' && status !== 'paused') throw precondition('Location is only shared while the game is running.', 'not_live');

  await consume('loc', `${eventId}:${userId}`, 1, Math.max(1, Math.floor(ctx.tracking.intervalSec / 2)), 'Location updates are too frequent.');

  const now = Date.now();
  const prevRow = await one('SELECT * FROM player_locations WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
  const prev = prevRow ? { lat: prevRow.lat, lng: prevRow.lng, accuracy: prevRow.accuracy, t: new Date(prevRow.sample_at).getTime() } : null;
  const v = validateSamples(prev, samples, now, ctx.tracking);

  let newest: Accepted | null = null;
  await tx(async (t) => {
    if (v.accepted.length) {
      newest = v.accepted[v.accepted.length - 1];
      const ring: Sample[] = [...((prevRow?.ring ?? []) as Sample[]), ...v.accepted.filter((a) => !a.lowAccuracy).map((a) => ({ lat: a.lat, lng: a.lng, accuracy: a.accuracy, t: a.t }))]
        .filter((s) => now - s.t <= RING_WINDOW_MS)
        .slice(-RING_MAX);
      await t.query(
        `INSERT INTO player_locations (event_id, user_id, lat, lng, accuracy, speed, heading, altitude, sample_at, received_at, ring)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000.0), now(), $10)
         ON CONFLICT (event_id, user_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, accuracy = EXCLUDED.accuracy, speed = EXCLUDED.speed,
           heading = EXCLUDED.heading, altitude = EXCLUDED.altitude, sample_at = EXCLUDED.sample_at, received_at = now(), ring = EXCLUDED.ring`,
        [eventId, userId, newest.lat, newest.lng, newest.accuracy, newest.speed, newest.heading, newest.altitude, newest.t, JSON.stringify(ring)],
      );
      if (ctx.tracking.keepHistory) {
        await t.query(
          `INSERT INTO location_history (event_id, user_id, lat, lng, accuracy, sample_at, flags)
           SELECT $1, $2, s.lat, s.lng, s.accuracy, to_timestamp(s.t/1000.0), CASE WHEN s.low THEN ARRAY['low_accuracy'] ELSE '{}'::text[] END
             FROM jsonb_to_recordset($3::jsonb) AS s(lat float8, lng float8, accuracy float8, t float8, low boolean)`,
          [eventId, userId, JSON.stringify(v.accepted.map((a) => ({ lat: a.lat, lng: a.lng, accuracy: a.accuracy, t: a.t, low: a.lowAccuracy })))],
        );
      }
      await t.query(
        `UPDATE event_members SET last_location_at = now(), last_seen_at = now(), gps_accuracy = $3, tracking_active = true WHERE event_id = $1 AND user_id = $2`,
        [eventId, userId, newest.accuracy],
      );
    }
    if (v.suspicious.length) {
      await t.query(
        `INSERT INTO player_locations (event_id, user_id, lat, lng, accuracy, sample_at, suspicious_count, last_flag_at)
         VALUES ($1,$2,0,0,9999,now(),$3,now())
         ON CONFLICT (event_id, user_id) DO UPDATE SET suspicious_count = player_locations.suspicious_count + $3, last_flag_at = now()`,
        [eventId, userId, v.suspicious.length],
      );
      const first = v.suspicious[0];
      await alert(t, eventId, {
        type: 'gps_suspicious',
        severity: first.flag === 'mock' ? 'critical' : 'warning',
        userId,
        message: `Suspicious location data: ${first.detail}`,
        data: { flags: v.suspicious.map((s) => s.flag), details: v.suspicious.map((s) => s.detail) },
        dedupeKey: `gps:${userId}`,
      });
    }
    t.afterCommit(() => hub.positionsDirty(eventId));
  });

  let geofence: GeofenceStatusDto[] = [];
  const fix = newest as Accepted | null;
  if (fix && v.fresh && status === 'live' && m.team_id && now - fix.t <= FRESH_MS) {
    geofence = await processGeofences(ctx, userId, m.team_id, fix, screenObjectiveId, now);
    await writeIntel(ctx, userId, m.team_id, now);
  }
  return { accepted: v.accepted.length, rejected: v.rejected, flags: v.flags, geofence, serverNow: new Date().toISOString() };
}

async function processGeofences(ctx: EventContext, userId: string, teamId: string, fix: Accepted, screenObjectiveId: string | null, now: number): Promise<GeofenceStatusDto[]> {
  const eventId = ctx.event.id;
  const objectives = await many<ObjRow>(`SELECT * FROM objectives WHERE event_id = $1 AND ('geofence' = ANY(methods) OR require_geofence)`, [eventId]);
  if (!objectives.length) return [];
  const counts = new Map((await many<{ id: string; capture_count: number }>('SELECT id, capture_count FROM objectives WHERE event_id = $1', [eventId])).map((r) => [r.id, r.capture_count]));
  const states = new Map((await many('SELECT * FROM capture_states WHERE event_id = $1', [eventId])).map((s) => [s.objective_id as string, s]));
  const out: GeofenceStatusDto[] = [];
  const ttl = presenceTtlMs(ctx.tracking.intervalSec);

  for (const o of objectives) {
    const status = statusOf(o, counts, now);
    if (!objectiveVisible(o, status, ctx.viewer, { status: ctx.event.status, phase: ctx.event.phase, rules: ctx.rules })) continue;
    const cfg = geofenceOf(o.geofence);
    const d = distanceM(fix, o);
    const accuracyOk = fix.accuracy <= cfg.maxAccuracyM && !fix.lowAccuracy;
    const screenOk = !cfg.requireScreenOpen || screenObjectiveId === o.id;
    const inside = d <= cfg.radiusM && accuracyOk && screenOk;
    // With a poor fix the player may really be inside even when the reported point is not.
    const maybeInside = d <= cfg.radiusM + fix.accuracy;
    const blocked = !maybeInside ? null : !accuracyOk ? 'low_accuracy' : d <= cfg.radiusM && !screenOk ? 'screen_closed' : null;
    const prev = fromRow(states.get(o.id));
    const wasPresent = !!prev.present[teamId]?.[userId];
    const near = d <= cfg.radiusM * 3 + 50 || maybeInside;
    const dto = (s: typeof prev, captured: boolean, multiplier = 1): GeofenceStatusDto => {
      const leader = majorityLeader(s.present, cfg);
      return {
        objectiveId: o.id,
        inside,
        distanceM: Math.round(d),
        progressSec: Math.min(cfg.durationSec, Math.round((s.progress[teamId]?.s ?? 0) * 10) / 10),
        requiredSec: cfg.durationSec,
        contested: s.contested,
        armed: !!s.armed[teamId],
        captured,
        multiplier,
        blocked,
        maxAccuracyM: cfg.maxAccuracyM,
        outnumbered: !!s.present[teamId] && leader !== null && leader !== teamId,
      };
    };
    if (!inside && !wasPresent) {
      if (near) out.push(dto(prev, false));
      continue;
    }

    const result = await tx(async (t) => {
      await t.query(`INSERT INTO capture_states (objective_id, event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [o.id, eventId]);
      const row = await one('SELECT * FROM capture_states WHERE objective_id = $1 FOR UPDATE', [o.id], t);
      const live = await one<ObjRow>('SELECT * FROM objectives WHERE id = $1', [o.id], t);
      if (!live) return null;
      const liveStatus = statusOf(live, counts, now);
      const adv = advance(fromRow(row), {
        now,
        cfg,
        presenceTtlMs: ttl,
        maxGapMs: ttl,
        canAccrue: (team) => captureBlock(live, liveStatus, ctx.event.status, team, now, 'geofence') === null,
        report: { userId, teamId, inside },
      });
      let captured = false;
      if (adv.completedBy) {
        const codeLike = live.methods.includes('code') || live.methods.includes('qr');
        if (live.require_geofence && codeLike && !live.methods.includes('geofence')) {
          adv.state.armed[adv.completedBy] = true;
          await notify(t, await eventPlayers(t, eventId, adv.completedBy), {
            type: 'objective_captured',
            title: `${live.name}: zone secured`,
            body: 'Enter the code or scan the QR code to capture it.',
            priority: 'high',
            eventId,
            url: `/events/${eventId}/live/objectives/${o.id}`,
          });
        } else {
          adv.state.armed[adv.completedBy] = true; // also satisfies requireGeofence for code/QR
          await saveState(t, o.id, adv.state);
          await performCapture(t, { ctx, objectiveId: o.id, teamId: adv.completedBy, userId: adv.completedBy === teamId ? userId : null, method: 'geofence', now });
          captured = true;
        }
      }
      if (!captured && adv.changed) await saveState(t, o.id, adv.state);
      // contest started / ended
      if (adv.state.contested !== live.contested) {
        await t.query('UPDATE objectives SET contested = $2, updated_at = now() WHERE id = $1', [o.id, adv.state.contested]);
        if (adv.state.contested) {
          await activity(t, eventId, { type: 'objective_contested', message: `${live.name} is contested`, scope: 'all', objectiveId: o.id });
          const defenders = live.owner_team_id ? await eventPlayers(t, eventId, live.owner_team_id) : [];
          await notify(t, defenders, {
            type: 'objective_contested',
            title: `${live.name} is contested`,
            body: 'Enemies are inside the zone.',
            priority: 'high',
            eventId,
            url: `/events/${eventId}/live/objectives/${o.id}`,
          });
        }
        t.afterCommit(() => hub.invalidate(eventId, ['objectives']));
      }
      if (adv.contestEndedAfterMs !== null && adv.contestEndedAfterMs >= 20_000 && live.owner_team_id && adv.state.present[live.owner_team_id]) {
        const r = rewardsOf(live.rewards);
        if (r.defenseBonus) {
          await applyLedger(t, { eventId, teamId: live.owner_team_id, kind: 'points', type: 'defense_bonus', amount: r.defenseBonus, scoring: ctx.scoring, objectiveId: o.id, reason: `Defended ${live.name}` });
        }
      }
      return { state: adv.state, captured, multiplier: adv.multiplier[teamId] ?? 1 };
    });
    if (!result) continue;
    out.push(dto(result.state, result.captured, result.multiplier));
  }
  return out;
}

async function saveState(t: Tx, objectiveId: string, s: ReturnType<typeof fromRow>): Promise<void> {
  const r = toRow(s);
  await t.query('UPDATE capture_states SET progress = $2, present = $3, armed = $4, contested = $5, updated_at = now() WHERE objective_id = $1', [
    objectiveId,
    JSON.stringify(r.progress),
    JSON.stringify(r.present),
    JSON.stringify(r.armed),
    r.contested,
  ]);
}

/** UAV: while an effect targets this player's team, store a degraded snapshot for the buying team. */
async function writeIntel(ctx: EventContext, userId: string, teamId: string, now: number): Promise<void> {
  const effects = await many(
    `SELECT e.*, (SELECT written_at FROM intel_positions i WHERE i.effect_id = e.id AND i.user_id = $3) AS last_written
       FROM effects e
      WHERE e.event_id = $1 AND e.type = 'uav' AND e.status = 'active' AND e.starts_at <= now() AND e.expires_at > now()
        AND e.team_id <> $2 AND (e.target_team_id = $2 OR e.target_team_id IS NULL)`,
    [ctx.event.id, teamId, userId],
  );
  if (!effects.length || ctx.rules.enemies === 'never') return;
  const loc = await one('SELECT * FROM player_locations WHERE event_id = $1 AND user_id = $2', [ctx.event.id, userId]);
  if (!loc) return;
  for (const e of effects) {
    const cfg = (e.config?.uav ?? {}) as { refreshSec?: number; precision?: Precision; delaySec?: number; areaRadiusM?: number };
    const refreshMs = Math.max(2, cfg.refreshSec ?? 10) * 1000;
    if (e.last_written && now - new Date(e.last_written).getTime() < refreshMs) continue;
    await upsertIntel(ctx.event.id, { id: e.id, team_id: e.team_id }, userId, loc as never, cfg, now);
  }
}

export async function upsertIntel(
  eventId: string,
  effect: { id: string; team_id: string },
  userId: string,
  loc: { lat: number; lng: number; accuracy: number; sample_at: Date; received_at: Date; ring: unknown; suspicious_count: number; last_flag_at: Date | null },
  cfg: { precision?: Precision; delaySec?: number; areaRadiusM?: number },
  now: number,
  q: Queryable = pool,
): Promise<void> {
  const precision = cfg.precision ?? 'exact';
  const d = degrade(
    {
      userId,
      lat: loc.lat,
      lng: loc.lng,
      accuracy: loc.accuracy,
      sampleAt: new Date(loc.sample_at).getTime(),
      receivedAt: new Date(loc.received_at).getTime(),
      ring: (loc.ring ?? []) as Sample[],
      suspiciousCount: loc.suspicious_count,
      lastFlagAt: null,
    },
    precision,
    { approxRadiusM: cfg.areaRadiusM ?? 75, delaySec: cfg.delaySec ?? 60 },
    now,
  );
  if (!d) return;
  await q.query(
    `INSERT INTO intel_positions (effect_id, user_id, event_id, viewer_team_id, lat, lng, radius_m, precision, sample_at, written_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000.0), now())
     ON CONFLICT (effect_id, user_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, radius_m = EXCLUDED.radius_m,
       precision = EXCLUDED.precision, sample_at = EXCLUDED.sample_at, written_at = now()`,
    [effect.id, userId, eventId, effect.team_id, d.lat, d.lng, d.radiusM, precision, d.sampleAt],
  );
  hub.positionsDirty(eventId);
}

export async function stopTracking(eventId: string, userId: string): Promise<void> {
  await one('UPDATE event_members SET tracking_active = false WHERE event_id = $1 AND user_id = $2 RETURNING user_id', [eventId, userId]);
  hub.positionsDirty(eventId);
}
