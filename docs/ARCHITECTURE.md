# Architecture

## Overview

```
 phone / tablet / desktop (Angular PWA)
        │  HTTPS: REST /api/*  ·  WebSocket /socket.io
        ▼
 frontend container (Node SSR server :4000)  ── proxies ──▶  api container (Express + Socket.IO :3000)
        serves the app, renders /r/:token                       │   game engine tick (5 s)
                                                                ▼
                                                        PostgreSQL 17 (+ uploads volume)
```

* **The server decides everything that affects the game**: scores, credits, objective
  ownership, captures, perk effects, membership, visibility. Clients only send intents
  (enter this code, I am here, buy this perk) and render what the server returns.
* **The server filters everything a viewer receives.** REST handlers and socket pushes run
  data through the pure functions in `backend/src/domain/rules.ts`. Restricted data (enemy
  positions, hidden objectives, other teams' balances, capture codes) never leaves the server.

## Code map (backend)

| Path | Responsibility |
| --- | --- |
| `src/domain/rules.ts` | Pure rules: objective status, capture eligibility, objective/POI/zone visibility, per-viewer position projection and precision degradation. Unit-tested. |
| `src/domain/geofence.ts` | Pure zone-hold state machine (server-time accrual, presence TTL, contest, multi-player boost, arming). |
| `src/domain/anticheat.ts` | Pure GPS sample validation (timestamps, speed/teleport, mock flag, accuracy). |
| `src/domain/ledger.ts` | The only code that changes team points/credits: row lock, clamping, append-only entry. |
| `src/domain/objectives.ts` | Capture transaction (code, QR, zone, GM), recurring rewards, revocation. |
| `src/domain/locations.ts` | Location report pipeline → storage, alerts, geofence, UAV intel. |
| `src/domain/perks.ts` | Store availability, purchase, approval, activation per perk type, cancel/refund, expiry. |
| `src/domain/lifecycle.ts` | Event state machine and its side effects (start balances, pause clock, end game, stats, badges). |
| `src/domain/tick.ts` | Engine heartbeat: recurring rewards, effect expiry, time windows, presence decay, disconnect alerts, auto-end, "starting soon", retention. |
| `src/domain/journal.ts` | Activity feed, GM alerts, audit log, notifications (DB + socket + Web Push / FCM for the apps, `push.ts`) — emitted after commit. |
| `src/realtime/hub.ts` | Socket.IO: auth, rooms, filtered emits, positions broadcaster. |
| `src/routes/*` | HTTP API (contract: `frontend/src/app/core/api/models.ts` + `api.service.ts`). |

## Data model

Schema: `backend/schema.sql`. Main tables:

* `users` (private profile, privacy settings, stats), `user_badges`, `clubs`, `consent_log`
  (append-only), `auth_tokens` (hashed refresh/verify/reset tokens), `push_subscriptions`,
  `notifications`.
* `events` (settings as JSONB: `tracking`, `visibility_rules`, `scoring`; clock columns;
  `join_code`), `event_members` (role gm/player, status, team, squad, consent, readiness,
  per-event counters, opt-in emergency contact copy for GMs), `teams` (points, currency),
  `squads`.
* `objectives` (config + runtime; secret `capture_code` and `qr_token` columns are never
  serialized for players), `capture_states` (geofence JSON), `objective_captures`,
  `capture_attempts`, `pois`, `zones`.
* `ledger_entries` (kind `points` | `currency`, requested vs applied amount, balance after,
  actor — append-only via trigger), `perks`, `perk_purchases`, `effects`, `intel_positions`.
* `player_locations` (latest + ring buffer), `location_history` (retention-limited),
  `announcements`, `activity`, `alerts`, `audit_logs` (append-only), `reports`,
  `map_templates`, `event_templates`, `idempotency_keys`.

JSON is camelCase at the API, snake_case in the database; `src/domain/serialize.ts` maps rows
to the exact DTOs of the frontend contract.

## Security model

* **Auth:** email + password (scrypt). Access token: 15-minute JWT kept in memory by the
  app. Refresh token: random, stored hashed, httpOnly `SameSite=Strict` cookie scoped to
  `/api/auth`, rotated on every use; reuse of an old token revokes the whole session family.
  `token_version` revokes all sessions on password change/reset and account deletion.
  Email must be verified and the current terms accepted before any event route.
* **Roles:** Game Masters are `event_members.role = 'gm'` (the owner is always one). Every
  GM endpoint calls `requireGm`; player endpoints `requireMember` (approved).
* **Secrets:** capture codes and QR tokens are compared server-side in constant time. QR
  payload `zeus:obj:<eventId>:<objectiveId>:<token>`; regenerating replaces the token, so
  printed old codes stop working. Join codes are only returned to GMs.
* **Idempotency:** captures, purchases and GM adjustments take a `clientTxId`; the first
  result is stored in the same transaction and returned for any retry.
* **Concurrency:** captures lock the objective row, purchases the perk and team rows,
  ledger writes the team row — two simultaneous captures can't both win, balances can't
  race.
* **Rate limits** (per user unless noted): login 8/15 min per email + 30/15 min per IP,
  code captures 5/min and 30/h per objective, QR 10/min, purchases 10/min, location
  reports 1 per half interval, announcements 30/min, uploads 60/h.
* **Uploads:** type sniffed from magic bytes (JPEG/PNG/WebP, PDF only for objective
  documents), random names, served with `nosniff` and a sandbox CSP.
* **Anti-cheat:** samples with future/very old timestamps, impossible speed (with accuracy
  slack) or a mock-location flag are rejected and raise a GM alert; zone captures only use
  fresh samples and server time.
* **Audit:** every GM action (status changes, edits, adjustments, overrides, approvals,
  removals) is in `audit_logs`; score/credit changes are in the append-only ledger.

## Visibility

Settings (`events.visibility_rules`): allies none/squad/team/alliance, squad leaders see
their squad, enemies never/perk_only/always, ally and enemy precision
(exact/approximate/delayed/area, with radius and delay), nicknames, roles, enemy bases,
captured objectives visible/hidden/owner-only, objectives before start, enemy currency.

* **Positions** — `projectPositions(viewer, …)` builds the full list a viewer may see,
  already degraded: approximate = deterministic offset inside the radius (stable for two
  minutes), area = grid cell centre, delayed = ring-buffer sample at least N seconds old.
  GMs get everyone exactly with anti-cheat flags. UAV/recon: `intel_positions` snapshots
  taken only while the effect is active, readable only by the buying team and only until
  `expires_at` (checked at read time, rows deleted on expiry/cancel).
* **Objectives** — hidden by mode (teams, GM only, after prerequisites), by captured rule,
  and before the game unless revealed. Players only receive objectives that pass.
* **POIs/zones** — mode, teams, squads, roles, phases (event status or custom GM phase),
  time window; enemy team bases hidden unless allowed.
* **Balances** — enemy currency is `null` unless allowed; ledgers are per team.

## Live location pipeline

`POST /api/events/:id/locations` with up to 20 samples:
validate (consent, approved player, game live or paused-but-tracking) → anti-cheat → store
latest + ring buffer (+ history if enabled) → alerts → geofence state for nearby zone
objectives (one transaction each; completion captures or arms the objective) → UAV intel
for active effects targeting the player's team → mark the event's positions dirty.
The broadcaster pushes each subscribed socket its own projection every 2 s when dirty
(every 10 s otherwise, to refresh online/stale status).

## Realtime

Socket.IO on the same origin. Rooms per user, per event, per event GM, per event team.
Server → client: `positions` (per socket), `teams` (currency filtered per room), `clock`,
`announcement`, `activity`, `alert` (GMs), `notification` (user), `kicked`, and
`invalidate { scopes }` telling the client which REST resources to refetch (those are
filtered per viewer by the REST handlers). Membership/team changes re-join the user's rooms.

## Offline and poor coverage

* The live store caches the last snapshot (event, rules, map content, objectives, perks)
  in local storage; the UI shows "Showing data saved at HH:MM" when it falls back to it.
* The map falls back to a built-in schematic renderer when the map engine can't load (offline
  at start); map and elevation tiles already viewed are served from the service worker cache.
* Location samples queue on the device and are sent in batches when the signal returns;
  late samples update history and last position but never count for zone captures.
* Captures and purchases are never shown as successful until the server answers; the
  `clientTxId` makes retries safe.
* The connection indicator shows online / reconnecting / offline and the last sync time.

## Privacy

* Location is processed only for approved players who consented for that event, while the
  game is live (or paused when the event keeps tracking during pauses). Stopping sharing or
  leaving the event marks tracking inactive immediately.
* Other players never receive names, email, date of birth, emergency contacts or location
  history. Emergency contacts reach GMs only when the player opts in.
* Precise history is deleted after the shorter of the event's and the player's retention
  period (hourly job); last positions of finished events after one day.
* Users can export their data (JSON) and delete their account (personal data erased, an
  anonymous "Deleted player" row keeps results consistent). Consents are logged with
  version, time, IP and user agent.
