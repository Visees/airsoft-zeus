# Build progress / handoff

Last update: 2026-10-22 — Game Masters can play on a team.

## Stack (decided)

Angular 22 + Tailwind 4 + Spartan UI (frontend, SSR server proxies `/api` and `/socket.io`),
Express 5 + TypeScript + PostgreSQL + Socket.IO (backend), Docker Compose for Coolify.
No Flutter, no Firebase. Node 24 needed locally for the Angular CLI (`fnm install 24`).

## Done

* `backend/schema.sql` — full schema (users, events, members, teams, squads,
  objectives, capture states, POIs, zones, perks, purchases, effects, intel, ledgers (append-only
  triggers), locations + history, announcements, activity, alerts, audit, templates, idempotency).
* `DESIGN.md`, `docs/FRONTEND_GUIDE.md` — design system "Field Ops" and frontend conventions.
* Frontend core: API contract (`core/api/models.ts`, `api.service.ts`), auth (memory access token +
  refresh cookie, interceptor, guards), realtime service, `LiveStore`, `LocationTracker`
  (batching, offline queue, wake lock), push, theme, connectivity, confirm/toast services,
  shared components incl. `TacticalMap` (Google Maps + offline schematic renderer), app shell,
  route table, SSR server with proxy + security headers. `ng build` passes (before agents).
* Backend complete and type-checked: domain engine (rules, geofence, anti-cheat, ledger,
  objectives, locations, perks, lifecycle, tick, results/exports), realtime hub, all routes
  matching `api.service.ts`, seed data, migrations runner.
* Docker: `docker-compose.yml` (Coolify), `docker-compose.override.yml` (local: ports, Mailpit,
  demo data), Dockerfiles, `.env.example`. Postgres + API + Mailpit verified running.
* Tests: 41 unit tests + 13 end-to-end API tests (fresh stack) passing.
* Docs: README (run, deploy, backups), docs/ARCHITECTURE.md.

## Frontend

All screens built (5 parallel feature areas), strict TypeScript + strict templates on,
production build passes. Browser walkthrough done at 375 px and 1280 px with the demo
accounts: welcome, login, home, live map (schematic), objectives, code capture (wrong and
right code), store, control center, map editor, creation wizard; public results page
server-rendered (verified with Traefik-style forwarded headers). Fixes from the walkthrough
are in (map sizing in the control center, aria-invalid, copy, session restore, PWA updates).

## News and home notifications (2026-10-21)

* News: `news` table (migration 0002), `/api/news` (read: verified users; write: admins),
  screens `/news`, `/news/:id`, `/news/:id/edit` ('new' allowed). Admins = emails in
  `ADMIN_EMAILS` (env, comma-separated); `MeUser.isAdmin`. Drafts and scheduled posts
  (future `publishedAt`) are visible to admins only. Home shows the latest 3, pinned first.
* Home "Event updates" shows only event-level notification types (`HOME_NOTIFICATION_TYPES`
  in routes/me.ts); in-game ones stay on /notifications and in the live screens.
* New types: `event_published` (public event leaves draft → every other verified user,
  in-app only, once per event) and `event_cancelled` (was `announcement`).

## Help & feedback (2026-10-21)

* Players write to the platform admins from Profile → Help & feedback (`/support`): category
  bug / report / general, subject, message; bug reports can attach device details (page,
  browser, screen). Player abuse reports stay on the profile Report dialog (`/api/reports`).
* `support_tickets` + `support_messages` (migration 0003), `/api/support`. Each ticket is a
  private thread between its author and the admins (others get 404). Status: open (waiting
  for the team) → answered (admin replied) → closed; the author can close and reopen.
* Admins (`ADMIN_EMAILS`) get an email for every new message and player reply, and an Inbox
  tab with status filters on `/support`. An admin reply sends the `support_reply`
  notification (in-app + push, shown on the home page) linking to `/support/:id`.
* Rate limits: 5 new conversations and 30 replies per user per hour.

## Game Masters can play (2026-10-22)

* A GM joins a team from the lobby panel "Play in a team" (uses `POST /members/:me/assign`;
  `assign` now accepts approved GM rows). Role stays `gm`; "plays" = approved and
  (`role = 'player'` or `team_id IS NOT NULL`) — `playsIn()` in `domain/context.ts` and
  `core/util/members.ts`. Playing GMs capture, buy perks, share GPS, score and get stats;
  they don't take a player place (max players, ready counts) and can't be removed as players.
* Fair player view: the live shell marks its event in `PlayerViewService`; requests to
  `/api/events/<id>/…` then carry `X-Zeus-View: player` and the socket subscribes with
  `{ view: 'player' }`. For a GM on a team the server builds the context with `isGm = false`
  (request-scoped via AsyncLocalStorage, `runWithView` in app.ts), so they see what the team
  sees. The control center (no header) keeps the full GM view. System work (tick) and socket
  re-joins pass the view explicitly so they never inherit a request's view.
* Removing a co-GM keeps their team (results), stops tracking and squad leadership.
* E2E: new test "lets a GM play on a team…". The capture-ledger test can fail when run
  within 60 s of seeding (it counts the seed's own captures) — wait a minute or ignore.

## GPS stability (2026-10-22)

* Zone decisions (`readZone` in `domain/geofence.ts`, used by `processGeofences`): the last 3
  precise fixes (accuracy ≤ objective `maxAccuracyM`, within the presence TTL, from
  `player_locations.ring`) vote; the state changes only when 2 agree, so one stray fix never
  brings a player in (no false contests) or throws one out. A counted player votes outside only
  past `exitMarginM` (fix accuracy, 5–10 m, ≤ radius). A newest fix that is too imprecise sends no
  report (counted players stay until presence expires). New `blocked: 'confirming'` = one fix
  inside, waiting for the second. `GeofenceStatus.inside` means "counted by the server".
* Why these numbers: phone `accuracy` is a ~68% radius (Android `getAccuracy`, passed through
  unscaled by Chrome; iOS similar), field studies give 2–5 m error in the open and 5–11 m RMSE
  under leaf-on canopy, and the error is time-correlated (minutes) when standing still. Seeded
  simulations (Gaussian noise, with and without correlation) chose the 10 m margin cap and show
  the vote cuts in/out flips 20–100× — but it can't remove slow drift, so zone size matters most:
  the objective editor warns under 20 m (open ground only) and 10 m (too small), and when max
  accuracy > radius. Defaults: radius 25 m (editor was 15), max accuracy 25 m (server was 30).
  No "far away = out at once" rule: a live test showed a single 20 m spike removing a holder.
* Client (`core/location/fix-filter.ts`): `OutlierFilter` drops coarse fixes right after a good
  one and impossible jumps (gives up after 15 s); `PositionSmoother` (Kalman) smooths the
  displayed position only — samples sent to the server stay raw. The own marker glides between
  fixes in both renderers (`glideSelf`/`moveSelf` in `TacticalMap`).
* Capture screen shows the live ±m and, when the error is over half the radius, sky-view advice
  (standing still doesn't help: the error is correlated over minutes).
* Phone clock: fix timestamps follow the phone's clock (Chrome passes `Location.getTime()`), so a
  phone set minutes off had its samples dropped as stale or flagged as spoofing. The client now
  sends `sentAt` with each batch and the server shifts samples onto its clock (`toServerClock` in
  `domain/anticheat.ts`); old clients without `sentAt` are unchanged.
* iPhones without a working Screen Wake Lock (iOS < 16.4, or a Home Screen app before 18.4 —
  WebKit bug 254545) can't keep the screen on and GPS stops when it locks:
  `LocationTracker.wakeLockUnreliable` shows an "Auto-Lock → Never" warning on the capture
  screen and in More.
* Report timing (simulated with mobile latency, lost requests and slow GPS fixes: the old timing
  dropped a player standing in a zone 2–11 times an hour, and "reset on exit" wiped their hold):
  - the tracker sends on a fixed rhythm (start to start), so a slow fix or request no longer
    pushes the next report later; location requests time out after 8 s (`reportLocation`) and
    are retried instead of hanging and blocking later reports;
  - `presenceTtlMs` (now in `domain/geofence.ts`) = 3.5 report intervals, min 30 s, and counts
    battery saver's doubled interval (it used 2.5 × intervalSec, so battery-saver clients
    reporting every 20 s were dropped constantly);
  - a team that only goes silent is paused, not reset: `advance()` resets on exit only when a
    player is seen leaving, or after 2 min of silence (`TeamProgress.idle`).
  Verified live: 45 s of silence keeps the hold (it used to reset), walking out still resets.
* Audit fixes (tracker): state goes back from 'error' to 'tracking' when fixes arrive after a
  slow first fix (the bar said "GPS problem" all game); a paused game is retried at the normal
  rhythm instead of a 2→60 s backoff (reports resume as soon as the GM resumes); answers for an
  event no longer tracked are ignored; fix timestamps are rounded to whole ms. Capture bar and
  ring say "No answer from the server" when the last answer is older than 2.5 intervals instead
  of freezing on "Holding". `location-tracker.service.spec.ts` covers rhythm, timeouts, pause,
  error recovery and event switches (each test fails if its fix is undone).
* Audit 2026-10-22 on an isolated fresh stack (`docker compose -p zeus-audit`, other ports, own
  volume): E2E suite 16/16 passing (run it ≥ 60 s after seeding, see the ledger-test note).
  Load: 120 and 400 players reporting every 10 s (half holding zones) — all 200, p99 11–13 ms,
  max 50 ms, no server errors, on a dev machine. The service worker doesn't touch location
  POSTs (no API dataGroups).
* Known, not fixed (minor): a player moved to another team mid-game leaves a ghost presence in a
  zone for up to one presence TTL; one account on two phones trips its own rate limit; the
  tracking form doesn't warn about intervals > 30 s or max speed < 5 m/s.
* Checked with a simulation of the whole pipeline (2 Hz fixes with drift and multipath spikes →
  client OutlierFilter/queue → server speed check → `readZone`): under trees a holder 7 m inside
  is counted 98% of the time with ~5 flips/h (newest-fix-only: 84%, ~60 flips/h). Spacing the
  votes apart in time made it no better. Cost: in dense forest an enemy standing on the exit line
  is counted more often (8% → 17%).
* Verified through the HTTP API on temporary live games ("GPS check (temp)", "GPS check 2
  (temp)", left completed in the local DB): entering, a stray 45 m fix, an imprecise fix, jitter
  around the edge, leaving, and a phone clock 5 minutes slow. Not yet tested on a phone in the
  field; E2E suite not rerun.

## Known limits / next ideas

* No Google Maps key configured locally: the walkthrough used the schematic renderer.
  Test the Google renderer (markers, drawing, drag) once a key is set.
* Background GPS with the screen locked needs a native wrapper (Capacitor) — see README.
* UI is English only; the profile stores a preferred language for a future i18n pass.
* Single API instance (in-process rate limits and socket rooms); scaling out needs a
  Redis adapter for Socket.IO and a shared rate-limit store.
* Not yet walked through in the browser: every GM editor form field by field, the QR
  scanner with a real camera, Web Push delivery on a phone.
