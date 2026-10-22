/**
 * Demo data for previews and screenshots. Everything is flagged is_test_data = true and the
 * demo accounts use the @airsoftzeus.test domain, so it never mixes with real data.
 *
 *   SEED_DEMO_DATA=true          seed on API start when there are no events
 *   npm run seed                 seed now (refuses if demo data exists)
 *
 * Demo password for every account: SEED_PASSWORD (default "zeus-demo-2026").
 */
import { hashPassword } from '../auth/password.js';
import { one, pool, tx } from '../db.js';
import { eventContext } from '../domain/context.js';
import { defaultPerks, DEFAULT_SCORING, DEFAULT_TRACKING, DEFAULT_VISIBILITY } from '../domain/defaults.js';
import { transition } from '../domain/lifecycle.js';
import { performCapture } from '../domain/objectives.js';
import { offset } from '../lib/geo.js';
import { readableCode } from '../lib/ids.js';
import { logger } from '../logger.js';

const CENTER = { lat: 45.7812, lng: 8.8301 }; // woodland field near Varese, IT
const PLAYERS: [string, string, string][] = [
  ['Kestrel', 'rifleman', 'A'],
  ['Mako', 'squad_leader', 'A'],
  ['Juniper', 'medic', 'A'],
  ['Talon', 'sniper', 'A'],
  ['Brick', 'support_gunner', 'A'],
  ['Wren', 'scout', 'A'],
  ['Sable', 'squad_leader', 'B'],
  ['Ironside', 'support_gunner', 'B'],
  ['Moth', 'medic', 'B'],
  ['Viper', 'rifleman', 'B'],
  ['Quill', 'radio_operator', 'B'],
  ['Basalt', 'rifleman', 'B'],
];

export async function seedIfEmpty(): Promise<void> {
  const any = await one('SELECT 1 FROM events LIMIT 1');
  if (any) return;
  await seed();
}

export async function seed(): Promise<void> {
  const exists = await one(`SELECT 1 FROM users WHERE email LIKE '%@airsoftzeus.test' LIMIT 1`);
  if (exists) {
    logger.info('demo data already present, skipping');
    return;
  }
  const hash = await hashPassword(process.env.SEED_PASSWORD || 'zeus-demo-2026');
  const user = async (nickname: string, role: string, extra: Record<string, unknown> = {}) => {
    const u = await one<{ id: string }>(
      `INSERT INTO users (email, password_hash, email_verified_at, nickname, first_name, last_name, country, player_role, club_name, bio, onboarding_done,
                          terms_version, privacy_version, terms_accepted_at, is_test_data)
       VALUES ($1,$2,now(),$3,$4,$5,'Italy',$6,$7,$8,true,'2026-10','2026-10',now(),true) RETURNING id`,
      [`${nickname.toLowerCase()}@airsoftzeus.test`, hash, nickname, extra.first ?? 'Demo', extra.last ?? nickname, role, extra.club ?? 'ASD Lupi del Ticino', extra.bio ?? null],
    );
    return u!.id;
  };

  const gmId = await user('Overwatch', 'squad_leader', { first: 'Giulia', last: 'Ferri', bio: 'Runs milsim weekends at the Varese woods since 2015.' });
  const playerIds = new Map<string, string>();
  for (const [nick, role] of PLAYERS) playerIds.set(nick, await user(nick, role));
  const club = await one<{ id: string }>(
    `INSERT INTO clubs (name, country, city, description, owner_id) VALUES ('ASD Lupi del Ticino','Italy','Varese','Weekend skirmish and milsim club.', $1) RETURNING id`,
    [gmId],
  );
  await pool.query(`UPDATE users SET club_id = $1 WHERE email LIKE '%@airsoftzeus.test'`, [club!.id]);

  const now = Date.now();
  const live = await createEvent(gmId, {
    name: 'Operation Pinewood',
    status: 'lobby',
    start: new Date(now - 45 * 60_000),
    end: new Date(now + 2.25 * 3600_000),
    mode: 'scenario',
  });
  const upcoming = await createEvent(gmId, {
    name: 'Night Raid at Quarry 7',
    status: 'registration_open',
    start: new Date(now + 6 * 86400_000),
    end: new Date(now + 6 * 86400_000 + 4 * 3600_000),
    mode: 'milsim',
  });
  const past = await createEvent(gmId, {
    name: 'Spring Offensive',
    status: 'lobby',
    start: new Date(now - 30 * 86400_000),
    end: new Date(now - 30 * 86400_000 + 3 * 3600_000),
    mode: 'sunday',
  });

  for (const ev of [live, past]) {
    for (const [nick, , team] of PLAYERS) {
      const uid = playerIds.get(nick)!;
      const squad = team === 'A' ? ev.squads.A : ev.squads.B;
      await pool.query(
        `INSERT INTO event_members (event_id, user_id, role, status, team_id, squad_id, is_squad_leader, player_role, ready, rules_accepted_at,
                                    location_permission, notification_permission, tracking_consent_at, tracking_active)
         VALUES ($1,$2,'player','approved',$3,$4,$5,$6,true,now(),'granted','granted',now(),true)`,
        [ev.id, uid, ev.teams[team as 'A' | 'B'], squad, nick === 'Mako' || nick === 'Sable', PLAYERS.find((p) => p[0] === nick)![1]],
      );
      if (nick === 'Mako' || nick === 'Sable') await pool.query('UPDATE squads SET leader_id = $2 WHERE id = $1', [squad, uid]);
    }
  }
  for (const nick of ['Kestrel', 'Viper', 'Quill']) {
    await pool.query(`INSERT INTO event_members (event_id, user_id, role, status, player_role) VALUES ($1,$2,'player','approved','rifleman')`, [upcoming.id, playerIds.get(nick)]);
  }
  await pool.query(`INSERT INTO event_members (event_id, user_id, role, status, player_role) VALUES ($1,$2,'player','pending','scout')`, [upcoming.id, playerIds.get('Wren')]);

  // Start both games, capture some objectives, finish the old one.
  for (const ev of [live, past]) {
    await tx(async (t) => {
      const ctx = await eventContext(ev.id, gmId, t, true);
      await transition(t, ctx, 'live', gmId, null);
    });
    await pool.query(`UPDATE events SET started_at = $2, ends_at = $3, end_at = $3 WHERE id = $1`, [ev.id, ev.start, ev.end]);
    const caps: [number, string, string][] = [
      [0, 'A', 'Kestrel'],
      [1, 'B', 'Sable'],
      [3, 'A', 'Mako'],
    ];
    for (const [i, team, nick] of caps) {
      await tx(async (t) => {
        const ctx = await eventContext(ev.id, playerIds.get(nick)!, t);
        await performCapture(t, { ctx, objectiveId: ev.objectives[i], teamId: ev.teams[team as 'A' | 'B'], userId: playerIds.get(nick)!, method: 'code', now: Date.now() });
      });
    }
  }
  await tx(async (t) => {
    const ctx = await eventContext(past.id, gmId, t, true);
    await transition(t, ctx, 'completed', gmId, null);
  });
  await pool.query(`UPDATE events SET ended_at = end_at WHERE id = $1`, [past.id]);

  // Positions for the live game: team A near the west, team B east.
  for (const [i, [nick, , team]] of PLAYERS.entries()) {
    const base = offset(CENTER, 180, team === 'A' ? 250 : 70);
    const p = offset(base, 25 + (i % 6) * 22, (i * 61) % 360);
    const ring = [-90_000, -60_000, -30_000, 0].map((dt, k) => ({ ...offset(p, (3 - k) * 12, 200), accuracy: 6, t: now + dt }));
    await pool.query(
      `INSERT INTO player_locations (event_id, user_id, lat, lng, accuracy, sample_at, received_at, ring)
       VALUES ($1,$2,$3,$4,$5, now() - make_interval(secs => $6), now() - make_interval(secs => $6), $7)`,
      [live.id, playerIds.get(nick), p.lat, p.lng, 5 + (i % 4) * 3, i === 4 ? 140 : 5, JSON.stringify(ring)],
    );
    await pool.query(`UPDATE event_members SET last_location_at = now(), gps_accuracy = $3 WHERE event_id = $1 AND user_id = $2`, [live.id, playerIds.get(nick), 5 + (i % 4) * 3]);
  }
  await pool.query(
    `INSERT INTO announcements (event_id, scope, title, body, priority, author_id) VALUES ($1,'all','Safe zone moved','The safe zone is now by the car park. Barrel bags on before leaving it.','high',$2)`,
    [live.id, gmId],
  );
  logger.info({ live: live.id, upcoming: upcoming.id, past: past.id }, 'demo data seeded (password: SEED_PASSWORD or zeus-demo-2026)');
}

async function createEvent(gmId: string, o: { name: string; status: string; start: Date; end: Date; mode: string }) {
  const ev = await one<{ id: string }>(
    `INSERT INTO events (owner_id, name, description, game_mode, start_at, end_at, meeting_address, meeting_lat, meeting_lng, min_players, max_players,
                         visibility, rules, safety_rules, required_equipment, chrono_info, status, area_lat, area_lng, area_zoom,
                         tracking, visibility_rules, scoring, join_code, is_test_data)
     VALUES ($1,$2,$3,$4,$5,$6,'Car park, Via dei Boschi 12, Varese',$7,$8,8,40,'public',$9,$10,$11,$12,$13,$7,$8,16,$14,$15,$16,$17,true) RETURNING id`,
    [
      gmId,
      o.name,
      'Two teams fight for five control points in mixed pine woodland. Hold points to earn points every minute and credits for the perk store.',
      o.mode,
      o.start,
      o.end,
      CENTER.lat,
      CENTER.lng,
      'Hits are called loudly with a raised hand. Medics revive with a 30 s bandage. No blind firing.',
      'Eye protection on at all times outside the safe zone. Barrel bags in the safe zone. Minimum engagement distance 20 m for DMRs.',
      'Full-seal eye protection, red dead rag, charged phone with the app, water.',
      'AEG max 1.2 J with 0.20 g, DMR max 1.88 J (semi only, 20 m MED), bolt sniper max 2.3 J (30 m MED).',
      o.status,
      JSON.stringify({ ...DEFAULT_TRACKING, intervalSec: 10 }),
      JSON.stringify({ ...DEFAULT_VISIBILITY, allies: 'team', enemies: 'perk_only' }),
      JSON.stringify({ ...DEFAULT_SCORING, startingCurrency: 300 }),
      readableCode(8),
    ],
  );
  const id = ev!.id;
  await pool.query(`INSERT INTO event_members (event_id, user_id, role, status) VALUES ($1,$2,'gm','approved')`, [id, gmId]);
  const teamA = await one<{ id: string }>(`INSERT INTO teams (event_id, name, color, icon, pattern, capacity, sort_order) VALUES ($1,'Alpha','#3B82C4','shield','stripes',20,0) RETURNING id`, [id]);
  const teamB = await one<{ id: string }>(`INSERT INTO teams (event_id, name, color, icon, pattern, capacity, sort_order) VALUES ($1,'Bravo','#D9822B','star','dots',20,1) RETURNING id`, [id]);
  const squadA = await one<{ id: string }>(`INSERT INTO squads (event_id, team_id, name, callsign) VALUES ($1,$2,'Squad 1','Viking') RETURNING id`, [id, teamA!.id]);
  const squadB = await one<{ id: string }>(`INSERT INTO squads (event_id, team_id, name, callsign) VALUES ($1,$2,'Squad 1','Hornet') RETURNING id`, [id, teamB!.id]);

  const area = [0, 72, 144, 216, 288].map((b) => offset(CENTER, 420, b + 20));
  await pool.query(
    `INSERT INTO zones (event_id, kind, geometry, points, label, color, fill_opacity) VALUES ($1,'playable','polygon',$2,'Playable area','#9DAE5C',0.06)`,
    [id, JSON.stringify(area)],
  );
  const restricted = [offset(CENTER, 260, 160), offset(CENTER, 330, 175), offset(CENTER, 300, 200), offset(CENTER, 240, 190)];
  await pool.query(
    `INSERT INTO zones (event_id, kind, geometry, points, label, description, color, fill_opacity) VALUES ($1,'restricted','polygon',$2,'Farm buildings','Private property: do not enter.','#F0595C',0.2)`,
    [id, JSON.stringify(restricted)],
  );
  await pool.query(
    `INSERT INTO zones (event_id, kind, geometry, points, radius_m, label, color, team_id) VALUES ($1,'base','circle',$2,40,'Alpha HQ','#3B82C4',$3), ($1,'base','circle',$4,40,'Bravo HQ','#D9822B',$5)`,
    [id, JSON.stringify([offset(CENTER, 330, 270)]), teamA!.id, JSON.stringify([offset(CENTER, 330, 90)]), teamB!.id],
  );
  await pool.query(
    `INSERT INTO zones (event_id, kind, geometry, points, label, color) VALUES ($1,'route','polyline',$2,'Logging track','#C9CDBF')`,
    [id, JSON.stringify([offset(CENTER, 380, 300), offset(CENTER, 120, 330), offset(CENTER, 60, 30), offset(CENTER, 380, 60)])],
  );
  await pool.query(
    `INSERT INTO pois (event_id, name, type, lat, lng, color, description) VALUES
       ($1,'Safe zone','safe_zone',$2,$3,'#4FC7DD','Car park. Barrel bags on.'),
       ($1,'Medic tent','medic',$4,$5,'#E9ECE6','Respawn after 2 min.'),
       ($1,'Ammo crate','ammo',$6,$7,'#E6B04F','Mid-cap refills only.')`,
    [id, ...ll(offset(CENTER, 470, 200)), ...ll(offset(CENTER, 90, 240)), ...ll(offset(CENTER, 110, 110))],
  );
  const objectiveSpecs = [
    { name: 'Radio mast', bearing: 0, dist: 150, methods: ['code'], rec: 5 },
    { name: 'Old sawmill', bearing: 300, dist: 200, methods: ['qr'], rec: 5 },
    { name: 'Crossroads', bearing: 0, dist: 0, methods: ['geofence'], rec: 10 },
    { name: 'Water tower', bearing: 120, dist: 210, methods: ['code', 'qr'], rec: 5 },
    { name: 'Bunker', bearing: 210, dist: 160, methods: ['code'], rec: 0, hidden: true },
  ];
  const objectives: string[] = [];
  for (const [i, s] of objectiveSpecs.entries()) {
    const p = offset(CENTER, s.dist, s.bearing);
    const o = await one<{ id: string }>(
      `INSERT INTO objectives (event_id, name, description, instructions, sort_order, lat, lng, color, methods, geofence, rewards, capture_code, visibility, cooldown_sec)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [
        id,
        s.name,
        `Control point ${String.fromCharCode(65 + i)}.`,
        s.methods.includes('geofence') ? 'Stay inside the circle for 90 seconds with the objective screen open.' : 'Find the code plate on the post and enter it.',
        i,
        p.lat,
        p.lng,
        ['#E0A84A', '#E0A84A', '#C75B9B', '#E0A84A', '#8E7CC3'][i],
        s.methods,
        JSON.stringify({ radiusM: 25, durationSec: 90, multiPlayerBoost: true }),
        JSON.stringify({ points: 100, currency: 50, recurringPointsPerMinute: s.rec, captureBonus: 25, defenseBonus: 20 }),
        s.methods.includes('code') ? readableCode(6) : null,
        JSON.stringify(s.hidden ? { mode: 'after_prerequisites', teamIds: [] } : { mode: 'all', teamIds: [] }),
        120,
      ],
    );
    objectives.push(o!.id);
  }
  await pool.query('UPDATE objectives SET prerequisite_ids = $2 WHERE id = $1', [objectives[4], [objectives[0], objectives[3]]]);
  for (const [i, p] of defaultPerks().entries()) {
    await pool.query(
      `INSERT INTO perks (event_id, name, description, icon, type, price, duration_sec, cooldown_sec, target, requires_approval, eligible, config, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, p.name, p.description, p.icon, p.type, p.price, p.durationSec, p.cooldownSec, p.target, 'requiresApproval' in p ? p.requiresApproval : false,
        'eligible' in p ? p.eligible : 'any', JSON.stringify(p.config), i],
    );
  }
  return { id, start: o.start, end: o.end, teams: { A: teamA!.id, B: teamB!.id }, squads: { A: squadA!.id, B: squadB!.id }, objectives };
}

function ll(p: { lat: number; lng: number }): [number, number] {
  return [p.lat, p.lng];
}

if (process.argv[1]?.endsWith('seed.js') || process.argv[1]?.endsWith('seed.ts')) {
  seed()
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      logger.error({ err }, 'seed failed');
      await pool.end();
      process.exit(1);
    });
}

