import { config } from '../config.js';
import { many, one, pool, tx, withAdvisoryLock } from '../db.js';
import { logger } from '../logger.js';
import { hub } from '../realtime/hub.js';
import { eventContext } from './context.js';
import { geofence as geofenceOf } from './defaults.js';
import { advance, fromRow, toRow } from './geofence.js';
import { activity, alert, eventPlayers, notify } from './journal.js';
import { transition } from './lifecycle.js';
import { presenceTtlMs } from './locations.js';
import { loadObjectives, settleRecurring, statusOf, type ObjRow } from './objectives.js';
import { expireEffects } from './perks.js';
import { captureBlock } from './rules.js';

const ENGINE_LOCK = 730_301;
let timer: NodeJS.Timeout | null = null;
let lastMaintenance = 0;
let running = false;

/**
 * Game engine heartbeat. Guarded by a Postgres advisory lock so only one API instance runs it.
 * Every rule that depends on time is also checked at request time (captures, purchases,
 * intel visibility), so a late tick never grants anything it shouldn't.
 */
export function startEngine(): void {
  timer = setInterval(() => void tickOnce(), config.TICK_MS);
}

export function stopEngine(): void {
  if (timer) clearInterval(timer);
}

export async function tickOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await withAdvisoryLock(ENGINE_LOCK, async () => {
      const events = await many<{ id: string; status: string }>(`SELECT id, status FROM events WHERE status IN ('live','paused')`);
      for (const e of events) {
        try {
          await tickEvent(e.id);
        } catch (err) {
          logger.error({ err, eventId: e.id }, 'tick failed for event');
        }
      }
      await startingSoon();
      if (Date.now() - lastMaintenance > 60 * 60_000) {
        lastMaintenance = Date.now();
        await maintenance();
      }
    });
  } catch (err) {
    logger.error({ err }, 'engine tick failed');
  } finally {
    running = false;
  }
}

async function tickEvent(eventId: string): Promise<void> {
  const owner = await one<{ owner_id: string }>('SELECT owner_id FROM events WHERE id = $1', [eventId]);
  if (!owner) return;
  const now = Date.now();

  await tx(async (t) => {
    await expireEffects(t, eventId);
  });

  // System work: always the full GM context, whatever request scheduled it.
  const ctx = await eventContext(eventId, owner.owner_id, undefined, false, false);
  if (ctx.event.status !== 'live') return;

  // Auto end
  if (ctx.event.auto_end && ctx.event.ends_at && new Date(ctx.event.ends_at).getTime() <= now) {
    await tx(async (t) => {
      const locked = await eventContext(eventId, owner.owner_id, t, true, false);
      if (locked.event.status === 'live') await transition(t, locked, 'completed', null, 'Time is up');
    });
    return;
  }

  // Recurring rewards for held objectives
  const due = await many<ObjRow>(
    `SELECT * FROM objectives WHERE event_id = $1 AND owner_team_id IS NOT NULL AND recurring_last_at <= now() - interval '60 seconds'
       AND ((rewards->>'recurringPointsPerMinute')::int > 0 OR (rewards->>'recurringCurrencyPerMinute')::int > 0)`,
    [eventId],
  );
  for (const o of due) {
    await tx(async (t) => {
      const row = await one<ObjRow>('SELECT * FROM objectives WHERE id = $1 FOR UPDATE', [o.id], t);
      if (row?.owner_team_id) await settleRecurring(t, ctx, row, now);
    });
  }

  // Status changes driven by time (availability windows) → notify once
  const set = await loadObjectives(eventId);
  let changed = false;
  for (const o of set.rows) {
    const status = statusOf(o, set.counts, now);
    if (status === o.last_status) continue;
    changed = true;
    await tx(async (t) => {
      await t.query('UPDATE objectives SET last_status = $2 WHERE id = $1', [o.id, status]);
      if (status === 'active' && (o.last_status === 'inactive' || o.last_status === 'locked')) {
        await activity(t, eventId, { type: 'objective_available', message: `${o.name} is now available`, scope: o.visibility?.mode === 'all' ? 'all' : 'gm', objectiveId: o.id });
        if ((o.visibility?.mode ?? 'all') === 'all') {
          await notify(t, await eventPlayers(t, eventId), {
            type: 'objective_available',
            title: 'New objective available',
            body: o.name,
            eventId,
            url: `/events/${eventId}/live/objectives/${o.id}`,
          });
        }
      }
    });
  }
  if (changed) hub.invalidate(eventId, ['objectives']);

  // Zone presence decays when players stop reporting
  const ttl = presenceTtlMs(ctx.tracking.intervalSec);
  const states = await many(`SELECT * FROM capture_states WHERE event_id = $1 AND (present <> '{}' OR progress <> '{}' OR contested)`, [eventId]);
  for (const s of states) {
    await tx(async (t) => {
      const row = await one('SELECT * FROM capture_states WHERE objective_id = $1 FOR UPDATE', [s.objective_id], t);
      const o = await one<ObjRow>('SELECT * FROM objectives WHERE id = $1', [s.objective_id], t);
      if (!row || !o) return;
      const status = statusOf(o, set.counts, now);
      const adv = advance(fromRow(row), {
        now,
        cfg: geofenceOf(o.geofence),
        presenceTtlMs: ttl,
        maxGapMs: ttl,
        canAccrue: (team) => captureBlock(o, status, 'live', team, now, 'geofence') === null,
      });
      if (!adv.changed) return;
      const r = toRow(adv.state);
      await t.query('UPDATE capture_states SET progress = $2, present = $3, armed = $4, contested = $5, updated_at = now() WHERE objective_id = $1', [
        o.id,
        JSON.stringify(r.progress),
        JSON.stringify(r.present),
        JSON.stringify(r.armed),
        r.contested,
      ]);
      if (o.contested !== r.contested) {
        await t.query('UPDATE objectives SET contested = $2 WHERE id = $1', [o.id, r.contested]);
        t.afterCommit(() => hub.invalidate(eventId, ['objectives']));
      }
    });
  }

  // Players who stopped sending positions
  const lost = await many<{ user_id: string; nickname: string; last_location_at: Date }>(
    `SELECT m.user_id, u.nickname, m.last_location_at FROM event_members m JOIN users u ON u.id = m.user_id
      WHERE m.event_id = $1 AND m.status = 'approved' AND (m.role = 'player' OR m.team_id IS NOT NULL) AND m.tracking_active
        AND m.last_location_at < now() - make_interval(secs => $2)`,
    [eventId, Math.max(120, ctx.tracking.staleAfterSec * 2)],
  );
  if (lost.length) {
    await tx(async (t) => {
      for (const l of lost) {
        await alert(t, eventId, {
          type: 'disconnected',
          severity: 'warning',
          userId: l.user_id,
          message: `${l.nickname} has not sent a position since ${new Date(l.last_location_at).toISOString().slice(11, 16)} UTC`,
          dedupeKey: `disc:${l.user_id}`,
        });
      }
    });
  }
}

async function startingSoon(): Promise<void> {
  const soon = await many<{ id: string; name: string }>(
    `UPDATE events SET starting_soon_notified_at = now()
      WHERE status IN ('published','registration_open','lobby') AND starting_soon_notified_at IS NULL
        AND start_at BETWEEN now() AND now() + interval '30 minutes'
      RETURNING id, name`,
  );
  for (const e of soon) {
    await tx(async (t) => {
      await notify(t, await eventPlayers(t, e.id), {
        type: 'event_starting_soon',
        title: `${e.name} starts soon`,
        body: 'Open the lobby, accept the rules and turn on location.',
        priority: 'high',
        eventId: e.id,
        url: `/events/${e.id}/lobby`,
      });
    });
  }
}

/** Retention: precise location history is deleted after the shorter of the event's and the player's retention. */
export async function maintenance(): Promise<void> {
  const r1 = await pool.query(
    `DELETE FROM location_history h USING events e, users u
      WHERE h.event_id = e.id AND h.user_id = u.id
        AND h.received_at < now() - make_interval(days => LEAST(COALESCE((e.tracking->>'retentionDays')::int, 7), u.location_retention_days))`,
  );
  const r2 = await pool.query(`DELETE FROM location_history WHERE user_id IS NULL`);
  const r3 = await pool.query(
    `DELETE FROM player_locations pl USING events e WHERE pl.event_id = e.id AND e.status IN ('completed','cancelled') AND COALESCE(e.ended_at, e.updated_at) < now() - interval '1 day'`,
  );
  await pool.query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '3 days'`);
  await pool.query(`DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'`);
  await pool.query(`DELETE FROM notifications WHERE created_at < now() - interval '180 days'`);
  await pool.query(`DELETE FROM capture_attempts WHERE created_at < now() - interval '30 days'`);
  logger.info({ history: r1.rowCount, orphanHistory: r2.rowCount, lastPositions: r3.rowCount }, 'maintenance done');
}
