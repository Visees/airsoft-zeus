# Build progress / handoff

Last update: 2026-10-20 — first complete version.

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

## Known limits / next ideas

* No Google Maps key configured locally: the walkthrough used the schematic renderer.
  Test the Google renderer (markers, drawing, drag) once a key is set.
* Background GPS with the screen locked needs a native wrapper (Capacitor) — see README.
* UI is English only; the profile stores a preferred language for a future i18n pass.
* Single API instance (in-process rate limits and socket rooms); scaling out needs a
  Redis adapter for Socket.IO and a shared rate-limit store.
* Not yet walked through in the browser: every GM editor form field by field, the QR
  scanner with a real camera, Web Push delivery on a phone.
