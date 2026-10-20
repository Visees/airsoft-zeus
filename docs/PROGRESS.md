# Build progress / handoff

Last update: 2026-10-20 (session paused at the usage limit; resets 15:20 Europe/Warsaw).

## Stack (decided)

Angular 22 + Tailwind 4 + Spartan UI (frontend, SSR server proxies `/api` and `/socket.io`),
Express 5 + TypeScript + PostgreSQL + Socket.IO (backend), Docker Compose for Coolify.
No Flutter, no Firebase. Node 24 needed locally for the Angular CLI (`fnm install 24`).

## Done

* `docker/postgres/init/01-schema.sql` — full schema (users, events, members, teams, squads,
  objectives, capture states, POIs, zones, perks, purchases, effects, intel, ledgers (append-only
  triggers), locations + history, announcements, activity, alerts, audit, templates, idempotency).
* `DESIGN.md`, `docs/FRONTEND_GUIDE.md` — design system "Field Ops" and frontend conventions.
* Frontend core: API contract (`core/api/models.ts`, `api.service.ts`), auth (memory access token +
  refresh cookie, interceptor, guards), realtime service, `LiveStore`, `LocationTracker`
  (batching, offline queue, wake lock), push, theme, connectivity, confirm/toast services,
  shared components incl. `TacticalMap` (Google Maps + offline schematic renderer), app shell,
  route table, SSR server with proxy + security headers. `ng build` passes (before agents).
* Backend so far (not yet type-checked as a whole):
  `config, logger, errors, db (tx + afterCommit + advisory lock)`, `lib/*` (validate, ids, geo,
  rate-limit, idempotency, pagination), `auth/*` (scrypt, JWT, rotating refresh tokens, middleware),
  `domain/defaults, rules (pure: status, capture eligibility, visibility, position projection),
  geofence (pure), anticheat (pure), context, serialize, journal (activity/alerts/audit/notify),
  ledger, objectives (capture transaction, recurring, revoke), locations (report pipeline,
  geofence, UAV intel), perks (availability, purchase, approval, activation, cancel, expiry),
  lifecycle (transitions, complete game, stats/badges, extend)`, `realtime/hub.ts`, `push.ts`, `mail.ts`.
* `backend/test/rules.test.ts` — 41 unit tests, passing.

## In progress — frontend screens (5 agents stopped at the limit; partial work is on disk)

| Area | Last step reached | Still stubs / unfinished |
| --- | --- | --- |
| Account (auth, onboarding, home, notifications, profile, clubs, settings, system) | edit-profile | edit-profile?, statistics?, public-profile?, clubs/club, settings, privacy-settings, system/* |
| Events, lobby, results | post-game stats | post-game-stats, export-results, public-results |
| Live player | More screen | live/more.ts |
| GM setup (wizard, editor, teams, perks, players) | event editor | event-editor, team-squad-manager, perk-editor, player-management |
| GM map & ops | objective editor | objective-editor, poi-editor, control-center, score-manager, activity-log |

Stub files contain the comment `// STUB`. Run `npx ngc -p tsconfig.app.json --noEmit` in
`frontend/` to see what does not compile yet.

## Next steps

1. Backend: `domain/tick.ts` (recurring rewards, expiries, availability notifications,
   disconnected alerts, auto-end, retention cleanup), `domain/results.ts` (results, CSV/PDF export,
   public results), all `routes/*` matching `api.service.ts`, `app.ts`, `index.ts`, uploads,
   seed data (`is_test_data`), `npm run typecheck`, integration tests against Postgres.
2. Finish the frontend screens listed above; full `ng build`.
3. Dockerfiles (frontend, backend), `docker-compose.yml` + override (Mailpit for dev email),
   `.env.example`, README (run locally, Coolify deploy, backups/restores).
4. `docs/ARCHITECTURE.md` for the new stack.
5. Run the stack, seed demo data, Playwright walkthrough at 375/1280, fix.
