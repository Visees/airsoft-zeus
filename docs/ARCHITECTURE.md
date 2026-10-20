# Airsoft Zeus — Architecture & Contract

This document is the single source of truth for the data model, the security
model and the client ↔ server API. The Flutter app (`app/`) and the Firebase
backend (`functions/`, `firestore.rules`) are both built against it.

## 1. Stack

| Concern | Technology |
| --- | --- |
| Client | Flutter (Android, iOS, tablet, web). Riverpod for state, go_router for navigation. |
| Auth | Firebase Authentication (email + password, email verification) |
| Database | Cloud Firestore (offline persistence enabled on mobile) |
| Files | Firebase Storage (avatars, covers, team icons, objective images/docs) |
| Server logic | Cloud Functions for Firebase v2 (TypeScript, Node 22), region `europe-west1` |
| Push | Firebase Cloud Messaging |
| Maps | Google Maps (`google_maps_flutter`) + custom drawing layer |
| QR | `barcode_widget` (generation, same lib as FlutterFlow's Barcode widget), `mobile_scanner` (scanning) |

### State separation

* **Backend state** — Firestore documents. Only read through typed streams in
  `app/lib/core/state/` (Riverpod `StreamProvider`s). Never mutated directly for
  anything game-relevant: the client calls Cloud Functions.
* **Application state** — session-wide: signed-in user, active event id,
  tracking status, connectivity, pending offline queue (`Notifier`s).
* **UI state** — local to widgets (`StatefulWidget` / `ConsumerStatefulWidget`):
  form fields, selected tab, dialog visibility.

## 2. Roles & trust model

* **Player** — any signed-in user with a verified email. Becomes an event
  *member* by joining.
* **Game Master (GM)** — `uid ∈ events/{id}.gmIds`. The creator is the first GM
  and can add co-GMs.
* **Cloud Functions** — the only writer of anything that affects the game
  outcome: scores, currency, objective ownership/status, captures, perk
  purchases/effects, membership status, team assignment, projected positions,
  audit logs, transaction ledgers.

The client can never assign itself points, currency, ownership, GM privileges
or perk effects. Firestore rules deny those writes; functions validate every
action against server time and server state.

## 3. Firestore data model

Paths in `code` font. `(fn)` = written only by Cloud Functions. `(gm)` = GM may
write directly through rules. `(owner)` = the user may write.

### 3.1 Users

| Path | Content | Read | Write |
| --- | --- | --- | --- |
| `users/{uid}` | Private profile: `email, firstName, lastName, dateOfBirth?, country, language, emergencyContact{name,phone,relation}, emergencyContactEnabled, privacy{showClub, showStats, showRole, shareEmergencyWithGm}, consents{termsVersion, privacyVersion, acceptedAt}, onboardingDone, createdAt, updatedAt` | owner | owner (not `consents`, not `email`) |
| `users/{uid}/devices/{token}` | `token, platform, updatedAt` | owner | owner |
| `users/{uid}/notifications/{id}` | `type, title, body, eventId?, objectiveId?, priority, read, createdAt` | owner | (fn); owner may only flip `read` |
| `users/{uid}/consentLog/{id}` | immutable: `kind (terms/privacy/location/notifications), version, granted, at` | owner | owner create only, `at == request.time` |
| `publicProfiles/{uid}` | Public: `nickname, nicknameLower, avatarUrl, clubId, clubName, playerRole, customRole, bio, country, stats{gamesPlayed, objectivesCaptured, totalPoints, wins, losses}, badges[], deleted` | signed-in | owner: `avatarUrl, clubId, clubName, playerRole, customRole, bio, country`; (fn): nickname, stats, badges |
| `nicknames/{nicknameLower}` | `uid, createdAt` — uniqueness index | signed-in (`get` only) | (fn) |
| `clubs/{clubId}` | `name, nameLower, country, city, description, logoUrl, website, ownerUid, adminUids[], memberCount` | signed-in | create: any (`ownerUid == uid`); update: admins |

Personal data (names, email, DOB, emergency contact) lives **only** in
`users/{uid}`, which nobody but the owner can read. When a member opts in
(`shareEmergencyWithGm`), the function `joinEvent` copies the emergency contact
into `events/{e}/memberPrivate/{uid}` which only GMs of that event can read; it
is deleted when the member leaves or the event is purged.

### 3.2 Events

`events/{eventId}`

```
name, nameLower, coverUrl, description,
gameMode: domination|conquest|ctf|search_destroy|koth|escort|extraction|tdm|custom,
customModeName, customModeRules,
startAt, endAt (expected), meetingLocation{address, lat, lng},
minPlayers, maxPlayers,
visibility: public|private, requiresApproval,
rules, safetyRules, requiredEquipment, chronoInfo,
status: draft|published|registration_open|lobby|live|paused|completed|cancelled   (fn)
ownerUid, gmIds[]                                                                  (fn)
teamSelection: gm|auto|player, teamsLocked, registrationLocked                    (gm)
area{lat, lng, zoom}                                                               (gm)
tracking{...}  visibilityRules{...}  scoring{...}  store{enabled}                  (gm)
phase: string (custom GM phase label used by POI phase visibility)                 (gm)
counts{approved, pending}                                                          (fn)
clock{startedAt, pausedAt, pausedTotalMs, endsAt, endedAt}                         (fn)
winnerTeamId, resultsPublished                                                     (fn)
isTestData, createdAt, updatedAt
```

Readable by: GMs, members, and any signed-in user when
`visibility == public && status != draft`. **No join code is stored here.**

#### tracking

```
intervalSec 10, minDistanceM 5, maxAccuracyM 50, background true,
stopWhenPaused true, staleAfterSec 60, hideAfterSec 600, showLastKnown true,
batterySaver false, highAccuracy true, maxSpeedMps 12, retentionDays 7,
keepHistory true
```

#### visibilityRules

```
allies: none|squad|team|alliance          what a regular player sees of their own side
squadLeadersSeeSquad: bool                 squad leaders additionally see their squad
enemies: never|perk_only|always
allyPrecision / enemyPrecision: exact|approximate|delayed|area
approxRadiusM 50, delaySec 60
showNicknames, showRoles, showEnemyBases: bool
capturedObjectives: visible|hidden|owner_only
```

#### scoring

```
startingPoints 0, startingCurrency 0, maxCurrency 0 (0 = unlimited),
allowNegativePoints false, winCondition: points|objectives
```

| Path | Content | Read | Write |
| --- | --- | --- | --- |
| `events/{e}/private/secrets` | `joinCode` | GM | (fn) |
| `events/{e}/members/{uid}` | `uid, nickname, avatarUrl, role (gm/player), status (pending/approved/rejected/removed/left), teamId, squadId, isSquadLeader, playerRole, allianceId, ready, rulesAcceptedAt, permissions{location, notifications}, trackingConsentAt, trackingActive, lastSeenAt, lastLocationAt, gpsAccuracy, stats{points, captures, currencyEarned}, joinedAt` | GM; approved members of the event; the member themself | (fn); owner may update only `ready, rulesAcceptedAt, permissions, trackingConsentAt, trackingActive, lastSeenAt, playerRole` |
| `events/{e}/memberPrivate/{uid}` | emergency contact (opt-in) | GM | (fn) |
| `events/{e}/teams/{teamId}` | `name, color (hex), icon, pattern, capacity, order, allianceId, baseLocation{lat,lng}?, points (fn), currency (fn), memberCount (fn), objectivesHeld (fn)` | anyone who can read the event | GM: config fields only |
| `events/{e}/squads/{squadId}` | `teamId, name, callsign, icon, leaderUid (fn)` | members + GM | GM |
| `events/{e}/objectives/{id}` | see 3.3; `audience[]` (fn) | GM, or member whose tokens ∈ `audience` | GM: config fields only |
| `events/{e}/objectiveSecrets/{id}` | `code, qrToken, qrVersion, updatedAt` | GM | (fn) |
| `events/{e}/pois/{id}` | `name, type, description, position, icon, color, imageUrl, visibility{mode, teamIds, squadIds, roles, phases, activeFrom, activeUntil}, audience (fn)` | GM / audience | GM (not `audience`) |
| `events/{e}/zones/{id}` | `kind (playable/restricted/safe/spawn/respawn/base/extraction/route/line/sector/label), geometry (point/circle/polygon/polyline), points[{lat,lng}], radiusM, label, description, color, fillOpacity, strokeWidth, icon, teamId?, visibility{...}, audience (fn)` | GM / audience | GM (not `audience`) |
| `events/{e}/perks/{id}` | see 3.5; `remainingQuantity` (fn) | GM; approved members when `store.enabled` | GM (not `remainingQuantity`) |
| `events/{e}/perkPurchases/{id}` | see 3.5 | GM / audience | (fn) |
| `events/{e}/effects/{id}` | active perk effects | GM / audience | (fn) |
| `events/{e}/objectiveCaptures/{id}` | `objectiveId, objectiveName, teamId, uid, nickname, method, points, currency, at, revoked, audience` | GM / audience | (fn) |
| `events/{e}/captureStates/{objectiveId}` | geofence state: `progress{teamId: seconds}, present{teamId: [uid]}, contested, armed{teamId: bool}, updatedAt, audience` | GM / audience | (fn) |
| `events/{e}/scoreTransactions/{id}` | immutable ledger, see 3.4 | GM / audience | (fn), never updated |
| `events/{e}/currencyTransactions/{id}` | immutable ledger, see 3.4 | GM / audience | (fn), never updated |
| `events/{e}/positions/{id}` | projected positions, see §5 | GM / audience | (fn) |
| `events/{e}/rawLocations/{uid}` | latest exact samples ring buffer + anti-cheat state | GM | (fn) |
| `events/{e}/locationHistory/{id}` | exact history (retention-limited) | GM | (fn) |
| `events/{e}/announcements/{id}` | `title, body, priority (normal/high/emergency), scope (all/team/player), teamId?, targetUid?, authorUid, authorNickname, createdAt, audience` | GM / audience | (fn) |
| `events/{e}/activity/{id}` | feed: `type, message, teamId?, uid?, objectiveId?, perkId?, at, audience` | GM / audience | (fn) |
| `events/{e}/alerts/{id}` | GM alerts: `type (gps_suspicious/disconnected/capture/purchase_request/emergency), severity, uid?, message, data, at, acknowledged` | GM | (fn); GM may set `acknowledged` |
| `events/{e}/auditLogs/{id}` | `actorUid, action, target, before, after, reason, at` | GM | (fn) |
| `events/{e}/runtime/live` | compact cache used by location processing: active effects, geofence objectives | GM | (fn) |
| `publicResults/{eventId}` | sanitized results for the shareable page | anyone | (fn) |
| `mapTemplates/{id}` | `ownerUid, name, area, zones[], pois[], objectivePins[]` | owner | owner |
| `eventTemplates/{id}` | `ownerUid, name, event{...}, teams[], objectives[], pois[], zones[], perks[]` | owner | owner |
| `reports/{id}` | abuse reports: `reporterUid, eventId?, targetUid?, reason, details, createdAt, status` | reporter | create by reporter |
| `idempotency/{key}` · `rateLimits/{key}` | server bookkeeping | none | (fn) |

Mapping to the requested collection names: `eventMembers → events/{e}/members`,
`playerLocations → events/{e}/positions + rawLocations + locationHistory`,
`mapZones → events/{e}/zones`, `notifications → users/{uid}/notifications`,
everything else keeps its name as an event subcollection. Subcollections keep
every event's data isolated and let security rules resolve the event once.

### 3.3 Objectives

```
name, description, instructions, order,
position{lat, lng}, icon, color, type: control_point|intel|sabotage|flag|extraction|custom,
imageUrl?, documentUrl?,
methods: [code, qr, geofence]           any non-empty subset
requireGeofence: bool                    code/QR only accepted after the team completed the geofence dwell
geofence{radiusM 25, durationSec 60, resetOnExit true, multiPlayerBoost false,
         boostPerExtraPlayer 0.5, maxMultiplier 3, contestable true,
         requireScreenOpen false, maxAccuracyM 30}
rewards{points, currency, perTeam{teamId:{points, currency}},
        recurringPointsPerMinute, recurringCurrencyPerMinute,
        captureBonus (first capture only), defenseBonus, completionBonus}
availability{startAt?, endAt?}, cooldownSec, maxCaptures (0 = unlimited),
allowedTeamIds[] (empty = all teams),
visibility{mode: all|teams|after_prerequisites|gm_only, teamIds[]},
prerequisiteIds[], nextObjectiveId?,
enabled (GM initial switch)

-- runtime (fn) --
status: inactive|active|locked|contested|captured|disabled|completed
ownerTeamId, captureCount, lastCapturedAt, lastCapturedByUid, lastCapturedByNickname,
jammedFor{teamId: millisUntil}, shieldedUntil, contested, recurringLastAt,
audience[]
```

The capture code and QR token are **never** in this document — they live in
`objectiveSecrets/{id}`, readable only by GMs.

Status derivation (server, `functions/src/domain/objectives.ts`):
`disabled` (GM) > `completed` (maxCaptures reached) > `locked` (prerequisites
not captured) > `inactive` (outside availability window) > `contested` >
`captured` (has owner) > `active`.

### 3.4 Ledgers

Every change of `teams.points` or `teams.currency` is done by
`functions/src/domain/ledger.ts` inside the same Firestore transaction that
appends an immutable entry:

```
scoreTransactions / currencyTransactions:
  eventId, teamId, teamName, uid?, nickname?, type, amount (signed), balanceAfter,
  objectiveId?, perkId?, purchaseId?, captureId?, reason, actorUid (GM or 'system'),
  at (server timestamp), clientTxId?, audience
type: starting_balance | capture | capture_bonus | recurring | defense_bonus |
      completion_bonus | gm_adjustment | penalty | perk_purchase | perk_refund |
      theft_in | theft_out
```

Victory points and currency are separate fields and separate ledgers. Currency
never goes below 0 and never above `scoring.maxCurrency` (when > 0); the
clamped amount is what gets logged.

### 3.5 Perks

```
perks/{id}:
  name, description, icon, type: uav|jammer|theft|shield|double_points|recon|
        instant_respawn|supply_drop|comms_jammer|custom,
  price, durationSec, cooldownSec (per team), totalQuantity (0 = unlimited),
  remainingQuantity (fn), perTeamLimit (0 = unlimited),
  eligible: any|squad_leaders|roles, eligibleRoles[],
  requiresApproval, activation: immediate|manual, enabled, order,
  target: none|enemy_team|objective,
  config{ uav{refreshSec, precision, delaySec, areaRadiusM},
          theft{mode: fixed|percent, amount, protectionSec},
          doublePoints{multiplier}, recon{precision} }

perkPurchases/{id}:
  perkId, perkName, perkType, price, teamId, buyerUid, buyerNickname,
  targetTeamId?, targetObjectiveId?, clientTxId,
  status: pending_approval|ready|active|completed|expired|rejected|cancelled,
  refunded, createdAt, activatedAt?, expiresAt?, resolvedBy?, reason?, audience

effects/{id}:
  type, purchaseId, teamId (beneficiary), targetTeamId?, objectiveId?,
  startsAt, expiresAt, config, status: active|expired|cancelled, audience
```

Default perk behaviour (`functions/src/domain/perks.ts`):

* **UAV** — while active, every accepted location report from a member of the
  target team (and once at activation) writes an `intel` position visible only
  to the purchasing team, at most every `refreshSec`, degraded according to
  `precision`. Intel documents carry `expiresAt`; they are deleted on expiry.
  No intel is ever written before activation or after expiry.
* **Recon scan** — a single UAV snapshot.
* **Objective jammer** — sets `objectives.jammedFor[targetTeam] = expiry`; the
  capture function refuses captures by that team until expiry. The tick clears it.
* **Currency theft** — moves `min(amount, targetBalance)` (fixed or percent)
  from the target team; writes `theft_out` / `theft_in` ledger entries; target
  gets `theftProtectedUntil` for `protectionSec`.
* **Shield** — `objectives.shieldedUntil` blocks captures by other teams.
* **Double points** — capture/recurring points for the team are multiplied.
* **Instant respawn / supply drop / comms jammer / custom** — an effect record
  plus a GM alert; the GM fulfils it in the field.

## 4. Audience tokens (visibility enforcement)

Each member document carries fields from which a fixed set of tokens is derived:

```
all · uid:{uid} · team:{teamId} · squad:{squadId} · sqlead:{squadId}
role:{playerRole} · ally:{allianceId}
```

Every visibility-restricted document (objectives, POIs, zones, positions,
captures, purchases, effects, ledgers, announcements, activity) has an
`audience` array computed **by the server** from the event's visibility rules.
Firestore rules grant `read` to a member only if one of their tokens is in
`resource.data.audience` (GMs read everything). The client queries
`where('audience', 'array-contains', token)` once per token and merges results
(`app/lib/core/services/audience_query.dart`), so every query is provably
authorized and unauthorized data never leaves the server.

Audience recomputation happens in Firestore triggers (config changes, captures,
phase/status changes) and in the minute tick (time windows).

## 5. Live location pipeline

```
device ──reportLocation(samples[])──▶ function
   validate: auth, approved member, event live (or paused && !stopWhenPaused),
             trackingConsentAt set, rate limit, sample timestamps vs server time,
             accuracy ≤ maxAccuracyM, speed ≤ maxSpeedMps, isMocked flag,
             teleport detection → alerts
   write rawLocations/{uid} (ring buffer, GM only)
   write locationHistory (if keepHistory)
   project positions/{uid}            audience per visibilityRules.allies, degraded per allyPrecision
   project positions/enemy_{uid}      when enemies == always
   project positions/intel_{team}_{uid} for each active UAV targeting the player's team
   advance geofence captureStates (server time deltas only)
   return { accepted, flags, geofence[] }
```

Precision degradation: `exact`; `approximate` (deterministic per-minute jitter
within `approxRadiusM`); `delayed` (sample from ≥ `delaySec` ago out of the
ring buffer); `area` (rounded to a grid cell, rendered as a circle).

Geofence progress only advances using samples whose device timestamp is within
30 s of server time and between consecutive accepted reports (max gap 2×
interval), so queued/offline samples cannot complete a capture.

Positions carry `updatedAt` (server time); the client renders `online` (<
`staleAfterSec`), `stale`, or hides after `hideAfterSec` (if
`showLastKnown == false` stale markers are hidden immediately).

## 6. Callable functions

All callables: region `europe-west1`, require auth + verified email (except
`completeRegistration`), validate input with zod, return JSON, throw
`HttpsError` codes (`invalid-argument`, `permission-denied`,
`failed-precondition`, `already-exists`, `resource-exhausted`, `not-found`).
Mutating game actions take `clientTxId` (UUID v4) and are idempotent: a retry
returns the stored result.

| Function | Input | Output |
| --- | --- | --- |
| `completeRegistration` | `nickname, termsVersion, privacyVersion` | `{ok}` |
| `changeNickname` | `nickname` | `{ok}` |
| `createEvent` | `{event fields}` | `{eventId}` |
| `duplicateEvent` | `eventId, asTemplate?` | `{eventId}` / `{templateId}` |
| `createEventFromTemplate` | `templateId, name, startAt` | `{eventId}` |
| `setEventStatus` | `eventId, status, reason?` | `{status}` |
| `extendGame` | `eventId, minutes` | `{endsAt}` |
| `regenerateJoinCode` | `eventId` | `{joinCode}` |
| `findEventByCode` | `code` | `{eventId}` |
| `joinEvent` | `eventId, joinCode?` | `{status}` |
| `leaveEvent` | `eventId` | `{ok}` |
| `reviewMember` | `eventId, uid, approve` | `{status}` |
| `removeMember` | `eventId, uid, reason` | `{ok}` |
| `assignMember` | `eventId, uid, teamId?, squadId?, isSquadLeader?` | `{ok}` |
| `chooseTeam` | `eventId, teamId` | `{ok}` |
| `autoBalanceTeams` | `eventId` | `{assigned}` |
| `addGameMaster` | `eventId, nickname` | `{ok}` |
| `setObjectiveCode` | `eventId, objectiveId, code` | `{ok}` |
| `regenerateObjectiveQr` | `eventId, objectiveId` | `{qrPayload, qrVersion}` |
| `captureObjective` | `eventId, objectiveId, method (code/qr), code?, qrPayload?, clientTxId` | `{captured, captureId, points, currency}` |
| `reportLocation` | `eventId, samples[{lat,lng,accuracy,speed?,heading?,altitude?,timestamp,isMocked?}], screenObjectiveId?, clientTxId` | `{accepted, flags[], geofence[{objectiveId, inside, distanceM, progressSec, requiredSec, contested, captured}]}` |
| `stopTracking` | `eventId` | `{ok}` |
| `gmAdjustBalance` | `eventId, teamId, kind (points/currency), amount, reason, uid?, clientTxId` | `{balance}` |
| `gmObjectiveAction` | `eventId, objectiveId, action (activate/disable/set_owner/clear_owner/contest/uncontest/reset), teamId?, reason` | `{ok}` |
| `gmRevokeCapture` | `eventId, captureId, reverseRewards, reason` | `{ok}` |
| `purchasePerk` | `eventId, perkId, targetTeamId?, targetObjectiveId?, clientTxId` | `{purchaseId, status}` |
| `reviewPerkPurchase` | `eventId, purchaseId, approve, reason?` | `{status}` |
| `activatePerk` | `eventId, purchaseId` | `{status, expiresAt}` |
| `cancelPerk` | `eventId, purchaseId, refund, reason` | `{status}` |
| `sendAnnouncement` | `eventId, scope (all/team/player), teamId?, targetUid?, title, body, priority` | `{announcementId}` |
| `exportResults` | `eventId, format (csv/json)` | `{files:[{name, content}]}` |
| `publishResults` | `eventId` | `{url}` |
| `exportMyData` | – | `{json}` |
| `deleteMyAccount` | `confirm: "DELETE"` | `{ok}` |

Scheduled: `gameTick` (every minute): recurring/defense rewards, effect &
jammer & shield expiry, availability windows, disconnected-player alerts,
auto-end at `clock.endsAt`. `dailyMaintenance`: location retention, idempotency
and rate-limit cleanup, auto-anonymize history of completed events.

Triggers: objective/POI/zone writes → recompute `audience`, refresh
`runtime/live`; event status/phase change → recompute audiences + notify;
member writes → counts + member-derived audience; user notification created →
FCM push.

## 7. Offline & idempotency

* Firestore offline persistence caches the event, map configuration, objective
  descriptions, team/squad data.
* Location reports are queued on device (`LocationService`) and sent in batches
  of ≤ 10 when connectivity returns; the server uses them for the history and
  last-known position but not for geofence progress.
* Captures and purchases are never optimistically confirmed. The UI shows
  "Waiting for server…" and keeps the `clientTxId`; retries are safe because
  the function stores the result under `idempotency/{uid}_{clientTxId}`.
* The UI shows connection status and the last successful sync time.

## 8. Rate limits (per user)

| Action | Limit |
| --- | --- |
| `captureObjective` (code) | 5 attempts / objective / minute, 30 / hour; wrong codes logged |
| `captureObjective` (qr) | 10 / minute |
| `reportLocation` | 1 per (intervalSec × 0.5) |
| `purchasePerk` | 10 / minute |
| `joinEvent` / `findEventByCode` | 10 / minute |
| `sendAnnouncement` | 30 / minute |
