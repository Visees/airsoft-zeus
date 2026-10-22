# AirsoftHub

Live airsoft events: GMs build and run events, players join, track on a tactical map, capture objectives, buy perks.
Stack: Angular 22 (standalone, signals, zoneless) + Tailwind 4 + Spartan UI, PWA + Capacitor apps; Express 5 + TypeScript + PostgreSQL 17 + Socket.IO; Docker Compose, deployed with Coolify.

## Start here
- `docs/PROGRESS.md`: what is done and what is next (read first when resuming)
- `docs/ARCHITECTURE.md`: data model, security, visibility, realtime, location pipeline
- `docs/FRONTEND_GUIDE.md`: how screens are built, shared components, i18n rules (EN + IT)
- `DESIGN.md`: tokens and design rules; `README.md`: run, test, deploy, native apps

## Where things are
- `backend/src/domain/`: all game rules (rules, visibility `views.ts`, ledger, tick, anticheat, defaults)
- `backend/src/routes/`: REST endpoints; `realtime/`: Socket.IO; `auth/`, `i18n/`, `seed/`
- `backend/schema.sql` base schema; `backend/migrations/NNNN-name.sql` later changes
- `frontend/src/app/core/`: api, auth, live, location, realtime, push, native, i18n services
- `frontend/src/app/features/`: one folder per area (events, gm, live, lobby, results, admin…)
- `frontend/src/app/shared/`: reusable components, `shared/map/` tactical map
- `frontend/libs/ui/`: Spartan helm components; `frontend/src/styles.css`: tokens
- `frontend/src/locale/`: translations; `frontend/android`, `frontend/ios`: Capacitor shells

## Commands
- Run all: `docker compose up -d --build` (app :8080, API :3000, Mailpit :8025)
- Dev: `docker compose up -d postgres mailpit api` then `cd frontend && npm start` (:4200)
- Reset DB (reseeds demo data): `docker compose down -v && docker compose up -d`
- Backend: `npm run typecheck`, `npm test` (in `backend/`)
- Frontend type + template check: `npx ngc -p tsconfig.app.json --noEmit`; i18n: `npm run i18n:check`
- Production build (once at the end): `cd frontend && npx ng build`

## Don't read whole
Skip: `node_modules`, `dist`, `.angular`, `package-lock.json`, `.playwright-mcp/`, `frontend/android/app/build`, `frontend/android/.gradle`.
`frontend/src/locale/messages*.json` (~220 KB each): grep the key, read only those lines, edit them there.

## Browser checks
Measure with `browser_evaluate` first; screenshot only screens that changed or failed (375 wide by default).
