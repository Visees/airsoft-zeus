# Build progress / handoff

Last update: 2026-10-23 — Free topographic map (MapLibre) replaces Google Maps.

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
  shared components incl. `TacticalMap` (MapLibre topo/satellite map + offline schematic renderer), app shell,
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

## Event attachments (2026-10-22)

* GMs share documents with the players (game book, briefing, maps): `event_attachments`
  (migration 0004), routes in `routes/attachments.ts` — list, upload (multipart `file` + UTF-8
  `name` field), delete, download `/events/:id/attachments/:attId/file`.
* Only GMs and approved members can list or download; everyone who can see the event gets
  `attachmentCount` (the event page tells others to join). Files live in
  `<UPLOAD_DIR>/attachments`, never under the public `/api/files` route, and are downloaded with
  the bearer token (blob) under their original name.
* Types are checked on the content: PDF, JPEG, PNG, WebP, and Office/OpenDocument files (ZIP
  signature + docx/xlsx/pptx/odt/ods/odp extension). `MAX_ATTACHMENT_BYTES` (default 25 MB),
  20 files per event, uploads share the 60/hour upload rate limit. No uploads on finished events.
* UI: wizard step 1 (files picked before the draft exists upload right after "Create draft"),
  editor tab "Attachments", event page section "Attachments", live More screen.
* Deleting an event deletes its files. Duplicate / templates do not copy attachments.
* E2E test "shares event attachments only with GMs and approved players…"; verified in the
  browser at 390 px (wizard → editor → player joins → download identical to the original).

## Rename to AirsoftHub (2026-10-22)

* Every user-visible "Airsoft Zeus" / "Zeus" is now "AirsoftHub" (UI, page titles, PWA manifest,
  emails, PDF report, legal text, share texts, data export file `airsofthub-data.json`); the logo
  mark is "AH". `airsofthub` is a reserved nickname (`zeus` stays reserved).
* Kept on purpose (internal, renaming breaks existing data or devices): QR payload prefix
  `zeus:obj:` (printed codes keep working), `zeus_rt` / `zeus_session` cookies (no forced
  logout), `zeus.*` localStorage keys, `X-Zeus-View` header, `zeus.allow_purge` /
  `zeus.allow_anonymize` DB settings, JWT issuer, Postgres db/user `zeus`, `zeus-` component
  selectors, demo accounts `@airsoftzeus.test` and their password, repo/folder name.
* AirsoftHub icon and splash (2026-10-22) for Android, iOS, PWA icons and favicon; sources in
  `frontend/assets/` (see README, native apps).

## Admin: users and per-user features (2026-10-22)

* Admin → Users (`/admin/users`): every account (deleted ones hidden), search by nickname, email
  or name, filters all / custom access / not verified / admins, newest first. "Last active" is the
  latest refresh-token rotation. Dashboard tiles: users, new this week.
* User page (`/admin/users/:userId`): account details, events played / run, support count,
  latest 10 events, stats, and a switch per feature, saved at once (`PATCH
  /api/admin/users/:id/features`, audit log action `user.features`).
* Features (`backend/src/auth/features.ts`, mirrored by `Feature` in models.ts): each has a
  default for everyone; `users.features` (migration 0007) stores only the overrides that differ
  from it, so changing a default later applies to everyone not set by hand. ADMIN_EMAILS users
  always have every feature and can't be changed (409). Current list:
  - `discover_events` (on) — Discover tab and `GET /events/discover`; without it, join by code or invitation.
  - `create_events` (on) — create, duplicate, create from template. Events already run stay editable
    (the wizard with `?eventId=` is allowed).
  - `create_clubs` (on) — `POST /clubs` and `/clubs/new`; joining a club is always allowed.
  - `support` (on) — new conversations and replies; the history stays readable.
  - `manage_news` (off) — News editor: write/edit/delete News and see drafts (was admins only).
* The server checks on every request (`requireFeature(key)`; the user row is already loaded
  for the token check, so no extra query) and answers 403 `feature_disabled`. The app hides
  entries with `auth.can(key)` and guards routes with `featureGuard(key)`; it sees a change at
  its next session refresh (app start or within minutes).
* Adding a feature (e.g. a field-manager dashboard): key + default in `features.ts`, key in
  `Feature` + labels in `FEATURE_LABELS` / `FEATURE_HINTS` (format.ts), `requireFeature` on its
  routes, `can()` / `featureGuard` in the UI. It shows up on the admin user page by itself.
* Not done: roles (named bundles of features, e.g. "Field manager") — worth adding once several
  users need the same set; admin rights still come only from ADMIN_EMAILS.

## Maps: free topographic map instead of Google (2026-10-23)

* `TacticalMap` renders with MapLibre GL (lazy chunk, ~230 kB gzipped, loaded only on map
  screens) instead of Google Maps. Styles in `core/maps/map-style.ts`: OpenFreeMap's Liberty
  style (vendored in `core/maps/liberty.json`) recoloured like OpenTopoMap, hatched buildings,
  tree symbols in woods, dashed paths, peaks with heights, and relief + 10 m contour lines
  computed in the browser from the AWS open elevation tiles (`maplibre-contour`). A real dark
  "tactical night" style follows the theme (and live mode). Everything is free, no key.
* Map type button on every map: Topographic / Satellite / Schematic; topo vs satellite is
  remembered per device (`zeus.mapBase`). Satellite (Esri World Imagery) appears only when
  `ESRI_API_KEY` is set (free ArcGIS Location Platform account); `/api/config` sends it as
  `esriApiKey`. Not tried with a real key yet.
* Place search (map editor, event form address) uses Photon (free OpenStreetMap search),
  debounced. Directions links still open Google Maps in a new tab (no API use).
* Inputs, saved event areas and `panTo` keep the classic zoom scale (Google/Leaflet);
  `TacticalMap` converts to MapLibre's (one level lower) internally.
* The service worker caches viewed map and elevation tiles (`ngsw-config.json` dataGroups), so
  a field seen once online loads from cache. Offline download of a whole event area before a
  game is the next step (OpenFreeMap allows up to 3,000 tiles / 50 MB per download).
* CSP (`frontend/src/server.ts`) allows tiles.openfreemap.org, s3.amazonaws.com,
  ibasemaps-api.arcgis.com, photon.komoot.io; all Google hosts removed.

## Known limits / next ideas

* Satellite map not yet tested with a real `ESRI_API_KEY`.
* Offline download of the event area's map (see "Maps" above).
* Background GPS with the screen locked: Android/iOS app (Capacitor), see "Native apps" below.
* Single API instance (in-process rate limits and socket rooms); scaling out needs a
  Redis adapter for Socket.IO and a shared rate-limit store.
* Not yet walked through in the browser: every GM editor form field by field, the QR
  scanner with a real camera, Web Push delivery on a phone.


## Italian translation (2026-10-22)

The whole app is in English and Italian: screens, server errors, emails, notifications, the
activity feed and the PDF report. Rules for new code: docs/FRONTEND_GUIDE.md ("Translations")
and the notes below.

* Frontend: `@angular/localize` with runtime translations, one build. `main.ts` picks the language
  (`zeus.lang` in localStorage → browser → English), loads `src/locale/messages.it.json`, then
  imports the app. Switching stores the choice and reloads (Settings → Appearance → Language, Edit
  profile, the "English / Italiano" link on signed-out screens). Signed in, the profile language
  wins: on app start or after login a different profile language is stored and the page reloads
  once. Sign-up stores the current UI language in the profile. Dates and numbers follow the UI
  language.
* SSR (only `/r/:token`) renders in Italian (`src/server-i18n.ts`); a browser in English renders
  that page again instead of hydrating it (`data-ssr-lang`, app.config.ts).
* `npm run i18n:check` (frontend) extracts the 3,260 messages and fails on any without Italian
  text or with different placeholders.
* Backend: `src/i18n/`. The `tr` tag translates in the request language (`Accept-Language`, sent by
  the app on every call). Texts for other people are a `Msg` (`(tr) => tr…`): `notify()` inserts one
  row per recipient language; activity, GM alerts and ledger reasons store every language
  (`data.messages`, `ledger_entries.reason_i18n`, migration 0005) and the API answers in the
  reader's; socket broadcasts carry all languages and the client picks its own. Emails use the
  recipient's profile language (support emails: each admin's). Zod: built-in messages via its
  Italian locale, schema messages translated by exact match. `test/i18n.test.ts` fails when a
  message has no Italian text; `npm run i18n:missing` lists them.
* Profile language choices are now English and Italiano (older de/fr/es values are still accepted
  and get English).
* **Legal texts** (terms of service and privacy policy, `legal-text.ts`) were translated by us and
  **must be checked by a lawyer** before the Italian version is relied on.
* Not translated on purpose: CSV export headers (data), demo seed data, server log lines, the
  `DELETE` / `END` words the API itself checks (the UI asks for ELIMINA / FINE in Italian).
* Checked: frontend type check and build, i18n checks, backend unit tests, E2E suite on a fresh
  isolated stack, browser walkthrough at 390 px (home, settings language switch both ways, control
  center, sign-in, shared results page with an English browser).

## Native apps (2026-10-22)

* Capacitor 8 in `frontend/` (`capacitor.config.ts`, `android/`, `ios/`). The apps load the live
  site (`server.url` = `APP_URL` at `cap sync`) instead of bundling it: same origin, so the
  refresh cookie, Socket.IO, SSR and the service worker work unchanged and web deploys update
  the apps. Offline start shows `native/www/index.html` (errorPath).
* `core/native/native-app.ts`: `isNativeApp()` (the bridge's `window.Capacitor`), plugins loaded
  with dynamic imports (not in the web bundle), `NativeLocation` (injectable for tests),
  `nativePost` (CapacitorHttp), `shareFile` (Filesystem + Share).
* `LocationTracker` in the app: background watcher (`@capacitor-community/background-geolocation`,
  1 Hz, best accuracy) instead of `watchPosition`; one-off fixes and the permission check/prompt
  from `@capacitor/geolocation`. With the event's `tracking.background` on (default) it runs with
  the screen off (Android foreground service + notification, `android.useLegacyBridge`) and takes
  no wake lock; off → foreground only + wake lock. Changing the setting mid-game restarts the
  watcher. A report the WebView's timers held back goes out with the next fix. `isMocked` is sent
  for simulated positions. Tests: `location-tracker.native.spec.ts`.
* Capacitor plugins are proxies that forward every property, `then` included, to native code:
  never resolve a promise with a plugin (it hangs, logging "then() is not implemented"). The
  loaders in `native-app.ts` resolve to `{ plugin }` and `NativeLocation` calls the methods.
  Found on a Galaxy S10e (GPS stuck on "Starting GPS"); unit tests use plain fakes and can't catch it.
* `ApiService.reportLocation` in the app uses native HTTP and adds what the interceptors would:
  bearer token, Accept-Language, `X-Zeus-View`, one refresh + retry on 401. The token refresh
  also goes over native HTTP in the app (cookies are shared with the WebView, rotation works).
* Screen off (measured on a Galaxy S10e, Android 12, 2026-10-23 via a debug build and
  `chrome://inspect`-style CDP): about a minute after locking, the WebView stops running its own
  tasks. Microtasks still run, but `setTimeout`, `import()`, `fetch` and XHR never complete; only
  callbacks from native code (watcher fixes, CapacitorHttp answers) get through. So the report path
  started from a fix must await nothing but native calls and already-resolved promises:
  `native-app.ts` imports each module once and keeps the promise. Before this, `nativePost` started
  an `import('@capacitor/core')` that never finished, `sending` stayed true and the player turned
  ◐ ~2 min after locking. With the screen off Android delivers fixes about every 8 s, so reports
  go out about every 16 s. A report with nothing queued sends the newest watch fix instead of
  calling `getCurrentPosition`.
* `downloadBlob` opens the share sheet in the app (attachments, exports, QR PNG).
* `APP_URL` defaults to the production site https://airsoftzeus.visedev.it. The app runs the
  deployed frontend, so the native code works only once this frontend is deployed. App id
  `app.airsofthub` (not final until published). Icons/splash are Capacitor defaults.
* Not done: native push (FCM/APNs; Web Push doesn't exist in WebViews, the app shows push as
  unsupported), QR print window in the app, Italian Info.plist texts. Not yet built or run on a
  device (no Android SDK on the dev machine; iOS needs a Mac).
