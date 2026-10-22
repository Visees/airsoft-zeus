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

## Known limits / next ideas

* No Google Maps key configured locally: the walkthrough used the schematic renderer.
  Test the Google renderer (markers, drawing, drag) once a key is set.
* Background GPS with the screen locked needs a native wrapper (Capacitor) — see README.
* UI is English only; the profile stores a preferred language for a future i18n pass.
* Single API instance (in-process rate limits and socket rooms); scaling out needs a
  Redis adapter for Socket.IO and a shared rate-limit store.
* Not yet walked through in the browser: every GM editor form field by field, the QR
  scanner with a real camera, Web Push delivery on a phone.
