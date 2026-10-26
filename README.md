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
flagged `is_test_data` and using `@airsofthub.test` addresses. Password for every demo
account: `airsofthub-demo-2026`.

| Account | Role |
| --- | --- |
| `overwatch@airsofthub.test` | Game Master of "Operation Pinewood" (live), "Night Raid at Quarry 7" (registration open) and "Spring Offensive" (completed) |
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
   exact address (e.g. `https://airsofthub.eu`). HTTPS is automatic once the domain's DNS
   A record points at the server.
3. Paste the variables from `.env.example` with real values. Required: `SITE_URL`,
   `POSTGRES_PASSWORD`, `JWT_SECRET` (≥ 32 random chars: `openssl rand -base64 48`).
   Strongly recommended: SMTP settings on port 587 (Brevo, Resend, Mailjet…; port 25 is
   blocked on Oracle/AWS), `VAPID_*` keys (`npx web-push generate-vapid-keys`) for push
   notifications, `FCM_SERVICE_ACCOUNT` for push in the apps (see below). Optional: `ESRI_API_KEY` (free ArcGIS Location Platform key, restricted to
   your domain) adds the satellite map; the topographic map needs no key. Keep
   `SEED_DEMO_DATA=false`.
4. Enable **auto-deploy on push**.
5. Turn on **scheduled backups** for the `postgres` service with an S3-compatible
   destination off the server. If the installed Coolify version cannot back up a compose
   database, add a Coolify scheduled task on the `postgres` service:

   ```bash
   pg_dump -U zeus -d zeus -Fc > /tmp/airsofthub-$(date +%F).dump   # then upload with your S3 tool
   ```

   Also back up the `uploads` volume (profile pictures, covers, objective images).

**Restore:** stop the `api` service, then on the server

```bash
docker compose exec -T postgres pg_restore -U zeus -d zeus --clean --if-exists < airsofthub-YYYY-MM-DD.dump
```

and start `api` again. The schema file only runs on an empty volume; later schema changes
go in `backend/migrations/NNNN-name.sql` and are applied by the API on start.

The same compose file works on any Docker host without Coolify: put a reverse proxy with
TLS in front of `frontend:4000` and run `docker compose -f docker-compose.yml up -d --build`.
The API runs as a single instance (in-process rate limits, Socket.IO rooms and the engine
tick, which is also guarded by a Postgres advisory lock).

## Mobile apps and background tracking

The web app is an installable PWA (Android, iOS, desktop). Browsers stop GPS when the screen
is locked, so during a game it keeps the screen awake (Screen Wake Lock) and tells players
to keep it open.

The Android and iOS apps (`frontend/android`, `frontend/ios`, Capacitor 8) keep sharing
with the screen off. They are a native shell that loads the live site, so a web deploy
updates them too; only a change to the native projects or plugins needs a new store build.
In the app, `LocationTracker` takes fixes from
`@capacitor-community/background-geolocation` (on Android a foreground service with a
notification, so no "allow all the time" permission) and sends reports through native HTTP,
which Android doesn't throttle in the background. It does so only when the event's tracking
setting "Background tracking" is on (default); otherwise the app keeps the screen awake like
the browser. Files to download open the share sheet. No backend change was needed.

Push in the app: the WebView has no Web Push, so the app registers a Firebase Cloud Messaging
token (`@capacitor/push-notifications`) and the API sends to it through the FCM HTTP API
(`backend/src/fcm.ts`, no Firebase SDK on the server). Firebase is used only to deliver
notifications. Setup, once:

1. [Firebase console](https://console.firebase.google.com): a project with an Android app
   `app.airsofthub`. Its `google-services.json` is committed in `frontend/android/app/` (no
   secrets in it); without it the build has no push. Not needed: SHA-1, Analytics, the Gradle
   snippets (the Capacitor project already applies the plugin when the file exists).
2. Project settings → Service accounts → Generate new private key. Keep the file out of git; put
   it base64-encoded in Coolify as `FCM_SERVICE_ACCOUNT`
   (`[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))` in PowerShell). The API
   config then reports `nativePush: true` and the app offers push.
3. iOS (later): an APNs key from the Apple Developer account uploaded to Firebase (Project
   settings → Cloud Messaging), the Push Notifications capability in Xcode, and
   `GoogleService-Info.plist`.

Android channels (created by the app; users can tune them in the phone's settings):
`emergency` (GM emergencies), `alerts` (game start/pause, objectives, perks), `general`.
As on the web, the API pushes only to users without an open socket, except emergencies.

Links open the app (from 1.0.5): links to `https://airsofthub.eu/gm/…`, `/events/…`, `/r/…`,
`/auth/…` and the other app pages (list in `APP_LINK_PATHS`, `frontend/src/server.ts`, and in the
manifest's App Links filter) open the installed app on that page (`core/native/deep-links.ts`, plugin
`@capacitor/app`). Android checks `https://airsofthub.eu/.well-known/assetlinks.json`, served by the
frontend server with the release key's SHA-256; if the app is ever published with Play app signing,
add Play's key in Coolify as `ANDROID_CERT_SHA256` (comma-separated, replaces the default). Android
verifies at install: after the first deploy with the file, reinstall or run
`adb shell pm verify-app-links --re-verify app.airsofthub`. iOS (later, on a Mac): set
`APPLE_TEAM_ID` in Coolify (the server then serves `apple-app-site-association`) and add the
Associated Domains capability `applinks:airsofthub.eu` in Xcode.

Not in the app yet: printing QR codes from the objective editor (GMs use the website).

Build (from `frontend/`):

```bash
npm install
npx cap sync                                  # loads https://airsofthub.eu; other site: APP_URL=https://… npx cap sync
npm run app:android                           # opens Android Studio: Run, or Build > Generate Signed App Bundle/APK
npm run app:ios                               # macOS only: opens Xcode
```

* The site URL (`APP_URL`, default the production site) is baked into the native projects at
  `cap sync` (`capacitor.config.ts`); run it
  again after changing it or after adding a plugin. To test against a dev machine, use its LAN
  address (e.g. `http://192.168.1.20:4200`, served with `ng serve --host 0.0.0.0`).
* App id `app.airsofthub` (`capacitor.config.ts`) is permanent once published.
* Android: Android Studio (bundles the SDK) and JDK 21. An APK can be shared directly; Google
  Play needs the foreground-service (location) declaration in Play Console.
* iOS: a Mac with Xcode and an Apple Developer account. Location and camera texts are in
  `ios/App/App/Info.plist` (English only for now); background mode `location` is on.
* App icons and splash come from `frontend/assets/` (`icon-only`, `icon-foreground`,
  `icon-background` 1024 px; `splash`, `splash-dark` 2732 px). After changing them run
  `npx @capacitor/assets generate --android --ios` in `frontend/` (revert the reformatted
  `AndroidManifest.xml` it leaves), then a new APK. Android 12+ shows the icon on
  `splash_background` (`res/values*/splash_background.xml`) instead of the splash image. The PWA
  icons in `public/icons` and `public/favicon.ico` are resized from `icon-only.png`.

### Releasing and updating the Android app

The app loads the live site, so **most changes need no new app**:

* Changes under `frontend/src` or `backend/`: push and deploy as usual. Apps pick up the new
  site the next time they open (the service worker shows the update, like the PWA).
* A new APK is needed only when the native side changes: `capacitor.config.ts` (site URL, app id),
  adding or updating a Capacitor plugin, or anything under `frontend/android` (permissions,
  icons, texts). Web code that uses a new plugin must still work in older installed apps.

New APK:

```powershell
cd frontend
npx cap sync
# raise versionCode (and versionName) in android/app/build.gradle
cd android; .\gradlew assembleRelease     # → app/build/outputs/apk/release/airsofthub-<versionName>-release.apk
```

Players install it over the old one (same signing key, higher versionCode). The release key is
`%USERPROFILE%\.airsofthub\airsofthub-release.jks` with its passwords in `keystore.properties`
(copy in `frontend/android/keystore.properties`, not in git). Back both up: without them, installed
apps can't be updated and players must uninstall first. Debug builds (Android Studio ▶) use a
different key, so a phone with a debug build must uninstall it before installing a release APK.
