# AirsoftHub

Organise and run live airsoft events. Game Masters build an event (teams, squads, tactical
map, objectives, perk store), run it from a live control center, and publish the results.
Players join with a code, see what the rules allow them to see on a live tactical map,
capture objectives by code, QR code or by holding a zone, and spend team credits on perks.

| Part | Stack |
| --- | --- |
| `frontend/` | Angular 22 (standalone, signals, zoneless), Tailwind 4, Spartan UI, PWA (service worker, Web Push). The Node SSR server serves the app, proxies `/api` and `/socket.io` to the API, and server-renders the public results page `/r/:token`. |
| `backend/` | Node 24, Express 5, TypeScript, PostgreSQL 17, Socket.IO. All game rules run here. |
| `backend/schema.sql` | Postgres base schema, applied by the api on an empty database. |
| `docs/` | `ARCHITECTURE.md` (how it works), `FRONTEND_GUIDE.md` (how screens are built), `PROGRESS.md`. Design system in `DESIGN.md`. |

## Run locally

Requirements: Docker Desktop. (For working on the code outside Docker: Node 24.)

```bash
cp .env.example .env            # then fill POSTGRES_PASSWORD, JWT_SECRET, VAPID keys
docker compose up -d --build
```

* App: http://localhost:8080 (frontend container, published by `docker-compose.override.yml`)
* API: http://localhost:3000/api/health
* Emails (verification, password reset) land in Mailpit: http://localhost:8025
* Postgres: `localhost:5433`, database/user `zeus`

With `SEED_DEMO_DATA=true` (the local default) the API creates demo data on first start, all
flagged `is_test_data` and using `@airsoftzeus.test` addresses. Password for every demo
account: `zeus-demo-2026`.

| Account | Role |
| --- | --- |
| `overwatch@airsoftzeus.test` | Game Master of "Operation Pinewood" (live), "Night Raid at Quarry 7" (registration open) and "Spring Offensive" (completed) |
| `kestrel@…`, `mako@…` (squad leader), `juniper@…`, `talon@…`, `brick@…`, `wren@…` | Team Alpha |
| `sable@…` (squad leader), `ironside@…`, `moth@…`, `viper@…`, `quill@…`, `basalt@…` | Team Bravo |

To start from an empty database: `docker compose down -v && docker compose up -d`.

### Developing without rebuilding images

```bash
docker compose up -d postgres mailpit api   # or run the API with: cd backend && npm run dev
cd frontend && npm start                    # ng serve on :4200, proxies /api and /socket.io to :3000
```

### Tests

```bash
cd backend
npm test                                    # unit tests: rules, visibility, geofence, anti-cheat
E2E_API=http://localhost:3000 npx vitest run test/api.e2e.test.ts
```

The end-to-end suite runs against a freshly seeded stack (it spends the demo teams'
credits); reset with `docker compose down -v` before rerunning. It checks what each role
can see, that capture codes and QR tokens never reach players, idempotent captures and
purchases, GPS anti-cheat, UAV visibility and expiry, theft approval and ledger clamping.

```bash
cd frontend && npx ng build                 # production build incl. SSR server
```

## Who changes what

* **Game Masters (in the app):** everything about their events — details, rules, teams,
  squads, map, objectives and codes, perks and prices, visibility and tracking settings,
  live scores (every change is in the append-only ledger and audit log).
* **Players (in the app):** their profile, privacy settings, location consent per event,
  account deletion and data export.
* **Developer (in code):** game rules (`backend/src/domain/`), default perks and settings
  (`backend/src/domain/defaults.ts`), terms and privacy texts
  (`frontend/src/app/features/onboarding/legal-text.ts`, bump `TERMS_VERSION`/`PRIVACY_VERSION`
  so users accept the new version), design tokens (`frontend/src/styles.css`, `DESIGN.md`).

## Deploy with Coolify

1. **New resource → Docker Compose**, from this repository and branch. Coolify defaults to
   `/docker-compose.yaml`: set the location to **`/docker-compose.yml`**.
2. Assign the domain to the **`frontend`** service, port **4000**, and set `SITE_URL` to that
   exact address (e.g. `https://zeus.example.com`). HTTPS is automatic once the domain's DNS
   A record points at the server.
3. Paste the variables from `.env.example` with real values. Required: `SITE_URL`,
   `POSTGRES_PASSWORD`, `JWT_SECRET` (≥ 32 random chars: `openssl rand -base64 48`).
   Strongly recommended: SMTP settings on port 587 (Brevo, Resend, Mailjet…; port 25 is
   blocked on Oracle/AWS), `VAPID_*` keys (`npx web-push generate-vapid-keys`) for push
   notifications, `GOOGLE_MAPS_API_KEY` restricted to your domain (without it the app uses
   its schematic map). Keep `SEED_DEMO_DATA=false`.
4. Enable **auto-deploy on push**.
5. Turn on **scheduled backups** for the `postgres` service with an S3-compatible
   destination off the server. If the installed Coolify version cannot back up a compose
   database, add a Coolify scheduled task on the `postgres` service:

   ```bash
   pg_dump -U zeus -d zeus -Fc > /tmp/zeus-$(date +%F).dump   # then upload with your S3 tool
   ```

   Also back up the `uploads` volume (profile pictures, covers, objective images).

**Restore:** stop the `api` service, then on the server

```bash
docker compose exec -T postgres pg_restore -U zeus -d zeus --clean --if-exists < zeus-YYYY-MM-DD.dump
```

and start `api` again. The schema file only runs on an empty volume; later schema changes
go in `backend/migrations/NNNN-name.sql` and are applied by the API on start.

The same compose file works on any Docker host without Coolify: put a reverse proxy with
TLS in front of `frontend:4000` and run `docker compose -f docker-compose.yml up -d --build`.
The API runs as a single instance (in-process rate limits, Socket.IO rooms and the engine
tick, which is also guarded by a Postgres advisory lock).

## Mobile apps and background tracking

The app is an installable PWA (Android, iOS, desktop). Browsers stop GPS when the screen
is locked, so during a game the app keeps the screen awake (Screen Wake Lock) and tells
players to keep it open. True background tracking needs a native shell: wrap the built
frontend with Capacitor and add a background-geolocation plugin feeding the same
`POST /api/events/:id/locations` endpoint — no backend change needed.
