# Frontend guide (Angular)

How screens in `frontend/` are built. Read this before adding or changing a screen.

## Stack and conventions

* Angular 22, **standalone components only**, **zoneless** (`provideZonelessChangeDetection`).
  All component state lives in **signals** (`signal`, `computed`, `effect`, `input()`,
  `output()`, `model()`); never rely on zone.js to refresh the view after a `setTimeout`
  or a promise — set a signal instead.
* `ChangeDetectionStrategy.OnPush` on every component. `inject()` instead of constructor
  parameters. New control flow (`@if`, `@for` with `track`, `@switch`, `@let`).
* Route params arrive as component inputs (`withComponentInputBinding`), e.g.
  `readonly eventId = input.required<string>();` for `events/:eventId`.
  Query params work the same way (`readonly tab = input<string>()`).
* Forms: `ReactiveFormsModule` with typed `FormGroup`/`nonNullable` controls. Visible
  `<label hlmLabel for=…>` for every field, errors under the field (`.field-error`), keep
  the user's input on error, disable the submit button while saving and show "Saving…".
* All HTTP goes through `ApiService` (`core/api/api.service.ts`), which returns Promises.
  Errors are `ApiError` (`core/api/api-error.ts`): `err.message` is user-presentable,
  `err.fields` maps field names to messages for 400 validation errors,
  `err.isNetwork` means offline.
* Types: `core/api/models.ts` is the API contract. Don't redefine API types locally.
* Selector prefix `zeus-`. One screen per file under `features/<area>/`.
* UI copy is written in English and translated to Italian (see "Translations" below). No lorem ipsum.

## Building blocks (read-only for feature work)

| Need | Use |
| --- | --- |
| Session, current user | `AuthService` (`user()`, `isLoggedIn()`, `login()`, `register()`, `logout()`, `reloadUser()`, `setUser()`, `can(feature)`) |
| Per-user features | `auth.can('create_events')` in templates/computed to hide entries; `featureGuard(feature, unless?)` on routes. Keys: `Feature` in models.ts, labels `FEATURE_LABELS`/`FEATURE_HINTS` in format.ts; the server list and defaults are in `backend/src/auth/features.ts` |
| Runtime config (Maps key, VAPID, terms version) | `ConfigService.load()` / `config()` |
| Live event state | `LiveStore` (`core/live/live-store.ts`) — provided on the live and control-center routes; `inject(LiveStore)` in children. `load(eventId)`, signals for event/teams/members/objectives/pois/zones/perks/purchases/effects/announcements/positions/alerts/activity/clock, `now()` = server time, `refresh(...scopes)` after an action |
| Realtime | `RealtimeService.on('notification' \| 'positions' \| …)`, `subscribe(eventId, destroyRef)` |
| GPS tracking | `LocationTracker` (root): `start(eventId, tracking)`, `stop()`, `lastFix()`, `geofence()`, `screenObjectiveId.set(id)`, `flushNow()`, `permissionState()`, `requestPermission()`, `gpsQuality()` |
| Network state | `ConnectivityService` (`state()`, `lastSyncAt()`) |
| Push | `PushService` (`enable()`, `disable()`, `supported`, `permission()`) |
| Toasts | `ToastService.success/info/warning/error(msgOrError)` |
| Confirmations | `ConfirmService.ask({...})` → boolean, `askReason({... reason: {label, required}})` → reason or null. **Every destructive or game-changing action** goes through it, with `consequences: [...]` spelled out. |
| Theme | `ThemeService` (`setPreference`, `setLiveMode(true)` on live screens) |
| Labels & formatting | `core/util/format.ts` (enum labels, `formatDuration`, `formatClock`, `formatDistance`, `formatDateTime`, `formatRelative`, `toLocalInput`/`fromLocalInput`, `downloadBlob`, `initials`) |
| Geo maths | `core/util/geo.ts` (`distanceM`, `bearingDeg`, `compassPoint`, `parseLatLng`, `polygonAreaM2`, …) |
| Idempotency key | `newClientTxId()` from `core/util/ids.ts` — create once per user intent and **reuse it on retry** |

### Shared components (`src/app/shared/`)

| Selector | Inputs (outputs) |
| --- | --- |
| `zeus-tactical-map` (`shared/map/tactical-map.ts`) | `objectives, pois, zones, positions, teams, self, selectedId, center, zoom, showGeofences, showLabels, editable, draft, fitKey, forceSchematic, controlsBottom` (`objectiveClick, poiClick, playerClick, zoneClick, mapClick, markerMoved`). Public: `panTo(latLng, zoom?)`, `fitAll()`, `map` (google.maps.Map or null). Give it an explicit height. |
| `zeus-event-card` | `event`, `link?` |
| `zeus-player-list-item` | `member, team, squad, isSelf, showPresence, showGps` + projected actions |
| `zeus-objective-card` | `objective, distanceM, teams, now` (`open, navigate`) |
| `zeus-perk-card` | `perk` (`buy`) — uses `perk.availability` |
| `zeus-team-badge` / `zeus-team-swatch` | `team` (`name,color,pattern,icon`), `size` — colour **+ pattern + icon**. `TEAM_ICONS`, `TEAM_PATTERNS`, `TEAM_COLORS` exported from `team-badge.ts` |
| `zeus-squad-badge` | `squad, leader` |
| `zeus-status-chip` | `[spec]="eventStatusChip(s)"` / `objectiveStatusChip` / `purchaseStatusChip`, or `label, glyph, tone` |
| `zeus-score-display` / `zeus-currency-display` | `points` / `amount` (null = hidden), `label, size` |
| `zeus-game-timer` | `clock, startAt, serverOffsetMs, size` — `nowSignal()` helper exported from the same file |
| `zeus-capture-progress` | `status: GeofenceStatus` |
| `zeus-gps-status`, `zeus-connection-status` | live indicators |
| `zeus-announcement-banner` | `announcement` (`dismiss`) |
| `zeus-loading-skeleton` | `rows, avatar` |
| `zeus-empty-state` | `icon, title, message` + projected action buttons |
| `zeus-error-state` | `error` (`retry`) |
| `zeus-page-header` | `title, subtitle, eyebrow, back, backLabel` + projected actions |

### Spartan UI (helm)

Generated in `frontend/libs/ui/*`, imported as `@spartan-ng/helm/<name>`:
button (`hlmBtn`, `variant`: default/outline/secondary/ghost/destructive/link, `size`),
input (`hlmInput`), label (`hlmLabel`), textarea (`hlmTextarea`), select, switch,
checkbox, radio-group, tabs, sheet, dialog, alert-dialog, dropdown-menu, popover,
tooltip, badge, card, skeleton, progress, separator, avatar, sonner.
Read the component's file in `libs/ui/<name>/src/lib/` for its selectors before using it.
Native `<select class="…">`, `<input type="checkbox">` styled with Tailwind are fine where
a Spartan primitive is awkward — keep them ≥ 44px tall.

### Icons

`<ng-icon name="lucideX" size="18" aria-hidden="true" />` (import `NgIcon` from
`@ng-icons/core`). The app-wide set is in `core/ui/icons.ts`. For an icon that is not
there, add `providers: [provideIcons({ lucideX })]` to the component.
Decorative icons get `aria-hidden="true"`; icon-only buttons get `aria-label`.

## Design rules (see DESIGN.md)

* Mobile first: base styles for 375px, `sm:`/`md:`/`lg:` add layout. Phones get stacked
  lists and bottom sheets; ≥1024px may use side panels and tables.
* Containers: `.page` (wide) or `.page-narrow` (forms). They leave room for the bottom
  nav. Live screens are full-bleed.
* Touch targets ≥ 44px (`.tap`, `h-11`, `h-12` for primary actions on live screens).
* Headings: uppercase condensed (h1/h2 are styled globally). Section labels:
  `<h2 class="label-caps">OBJECTIVES · 4 ACTIVE</h2>`.
* Numbers (scores, timers, distances, codes, coordinates): `.num`.
* Panels: `.panel` (card + hairline). Floating map overlays: `.hud`.
* Colour roles: `primary` (olive) actions/own team/success, `warning` (amber) active
  objectives/cooldowns, `destructive` (red) **only** danger/enemies/destructive actions,
  `nav` (cyan) **only** own location/navigation. Never colour alone — add a glyph or label.
* Every data view: loading (`zeus-loading-skeleton`), empty (`zeus-empty-state`),
  error (`zeus-error-state` with retry), offline (show cached data + `zeus-connection-status`).
* Respect `prefers-reduced-motion` (global CSS already does); keep transitions ≤ 200ms.

## Copy

Plain and specific. Name the action ("Capture objective", "Send to Team Bravo"), state
facts in empty states ("No objectives yet"), no rhetorical-question placeholders, no
"unlock / seamless / elevate / journey / dive in".

## Translations (English + Italian)

The app uses Angular's `@angular/localize` with translations loaded at runtime: one build,
English written inline, Italian in `src/locale/messages.it.json`. The language is picked in
`main.ts` (stored choice `zeus.lang` → browser → English) before the app is imported, and is
fixed for the page load: `switchLanguage()` (`core/i18n/language.ts`) stores it and reloads.
Signed in, the profile language wins (`AuthService`); Settings and Edit profile change it.

* Every text in a template gets `i18n` (element text) or `i18n-<attr>` (`aria-label`, `title`,
  `placeholder`, `alt`, and component inputs that show text such as `title`, `message`,
  `backLabel`). Wrap text next to icons or inside `@if` blocks in `<ng-container i18n>`.
* No English inside template expressions (`{{ busy() ? 'Saving…' : 'Save' }}`): put the strings
  in the component (`protected readonly txt = { saving: $localize\`Saving…\`, … }`), or use
  `@if` with `i18n` blocks, or ICU (`{n, plural, =1 {1 player} other {{{ n }} players}}`).
* Strings in TypeScript use `` $localize`…` ``; name placeholders: `` $localize`${n}:count: players` ``.
  Build whole sentences per case instead of gluing fragments (`'Join ' + name`), so Italian can
  change the word order. Plurals: two messages (`n === 1 ? … : …`) or ICU in templates.
* Short words whose Italian form depends on gender or context get a meaning:
  `` $localize`:event status|:Completed` `` / `i18n="event status|"`. The `|` is required —
  without it the text is only a description and both uses share one translation.
* Dates and numbers: the helpers in `core/util/format.ts` (they use `activeLocale()`), never
  `toLocaleString()` without a locale or `toFixed()` for shown numbers (`formatDecimal`).
* Server texts (errors, notifications, the activity feed) come translated from the API, which
  reads `Accept-Language` (sent by `authInterceptor`).

After changing UI text:

```bash
cd frontend
npm run i18n:check     # extracts messages; lists ones missing from messages.it.json or with wrong placeholders
```

New or changed English messages get new ids: add their Italian text to `src/locale/messages.it.json`
(`node tools/i18n/check.mjs --prune` drops ids that no longer exist). `tools/i18n/` also has the
scripts used for the first pass (marking templates, wrapping strings).

## Checking your work

```bash
cd frontend
npx ngc -p tsconfig.app.json --noEmit   # full type + template check, fast, safe to run in parallel
npm run i18n:check                       # every message has an Italian text
npx ng build                             # production bundle (run once at the end)
```
