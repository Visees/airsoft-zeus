// API contract between the Angular app and the Express backend.
// JSON is camelCase; timestamps are ISO-8601 strings; ids are UUIDs.
// The backend serializers in backend/src/lib/serialize.ts produce exactly these shapes.

export type Uuid = string;
export type IsoDate = string;

export type EventStatus =
  | 'draft'
  | 'published'
  | 'registration_open'
  | 'lobby'
  | 'live'
  | 'paused'
  | 'completed'
  | 'cancelled';

export type GameMode =
  | 'sunday'
  | 'milsim'
  | 'scenario'
  | 'championship'
  | 'plr'
  | 'pcr'
  | 'custom';

export type PlayerRole =
  | 'rifleman'
  | 'medic'
  | 'support_gunner'
  | 'sniper'
  | 'scout'
  | 'squad_leader'
  | 'radio_operator'
  | 'custom';

export type MemberRole = 'gm' | 'player';
export type MemberStatus = 'invited' | 'pending' | 'approved' | 'rejected' | 'removed' | 'left';
export type PermissionState = 'unknown' | 'granted' | 'denied' | 'prompt';
export type TeamPattern = 'solid' | 'stripes' | 'dots' | 'chevron' | 'cross' | 'grid';
export type Precision = 'exact' | 'approximate' | 'delayed' | 'area';
export type Priority = 'normal' | 'high' | 'emergency';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Config, auth, users
// ---------------------------------------------------------------------------

export interface AppConfig {
  googleMapsApiKey: string;
  googleMapsMapId: string | null;
  vapidPublicKey: string | null;
  termsVersion: string;
  privacyVersion: string;
  maxUploadBytes: number;
  maxAttachmentBytes: number;
}

export interface PlayerStats {
  gamesPlayed: number;
  objectivesCaptured: number;
  totalPoints: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface Badge {
  code: string;
  label: string;
  description: string;
  awardedAt: IsoDate;
  eventId: Uuid | null;
}

export interface PrivacySettings {
  showClub: boolean;
  showStats: boolean;
  showRole: boolean;
  showCountry: boolean;
  /** Copy the emergency contact to Game Masters of events I join. */
  shareEmergencyWithGm: boolean;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relation: string;
}

export interface MeUser {
  id: Uuid;
  email: string;
  emailVerified: boolean;
  nickname: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null; // YYYY-MM-DD
  country: string | null;
  language: string;
  avatarUrl: string | null;
  clubId: Uuid | null;
  clubName: string | null;
  playerRole: PlayerRole;
  customRole: string | null;
  bio: string | null;
  emergencyContact: EmergencyContact | null;
  emergencyContactEnabled: boolean;
  privacy: PrivacySettings;
  locationRetentionDays: number;
  onboardingDone: boolean;
  termsAccepted: boolean;
  stats: PlayerStats;
  badges: Badge[];
  /** Platform admin (ADMIN_EMAILS on the server): can publish News. */
  isAdmin: boolean;
  createdAt: IsoDate;
}

export interface AuthResponse {
  user: MeUser;
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface RegisterRequest {
  email: string;
  password: string;
  nickname: string;
  acceptTerms: true;
  termsVersion: string;
  privacyVersion: string;
}

export interface PublicProfile {
  id: Uuid;
  nickname: string;
  avatarUrl: string | null;
  clubId: Uuid | null;
  clubName: string | null; // null when hidden by privacy
  playerRole: PlayerRole | null;
  customRole: string | null;
  bio: string | null;
  country: string | null;
  stats: PlayerStats | null;
  badges: Badge[];
  deleted: boolean;
}

export interface UpdateProfileRequest {
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  country?: string | null;
  language?: string;
  avatarUrl?: string | null;
  clubId?: Uuid | null;
  clubName?: string | null;
  playerRole?: PlayerRole;
  customRole?: string | null;
  bio?: string | null;
  emergencyContact?: EmergencyContact | null;
  emergencyContactEnabled?: boolean;
  privacy?: Partial<PrivacySettings>;
  locationRetentionDays?: number;
  onboardingDone?: boolean;
}

export interface Club {
  id: Uuid;
  name: string;
  country: string | null;
  city: string | null;
  description: string | null;
  logoUrl: string | null;
  website: string | null;
  ownerId: Uuid | null;
  memberCount: number;
  members?: { id: Uuid; nickname: string; avatarUrl: string | null; playerRole: PlayerRole | null }[];
}

export type ConsentKind = 'terms' | 'privacy' | 'location' | 'notifications' | 'emergency_share' | 'tracking';

export interface GameHistoryItem {
  eventId: Uuid;
  eventName: string;
  endedAt: IsoDate | null;
  teamName: string | null;
  teamColor: string | null;
  result: 'win' | 'loss' | 'draw' | null;
  points: number;
  captures: number;
}

export interface MyStats {
  stats: PlayerStats;
  badges: Badge[];
  history: GameHistoryItem[];
}

export interface AppNotification {
  id: Uuid;
  type: NotificationType;
  title: string;
  body: string;
  priority: Priority;
  eventId: Uuid | null;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: IsoDate;
}

export type NotificationType =
  | 'event_published'
  | 'event_cancelled'
  | 'event_removed'
  | 'event_invitation'
  | 'registration_approved'
  | 'registration_rejected'
  | 'team_assigned'
  | 'event_starting_soon'
  | 'game_started'
  | 'game_paused'
  | 'game_resumed'
  | 'game_ended'
  | 'objective_available'
  | 'objective_captured'
  | 'objective_contested'
  | 'objective_lost'
  | 'perk_purchased'
  | 'perk_activated'
  | 'perk_expired'
  | 'perk_rejected'
  | 'team_announcement'
  | 'gm_message'
  | 'announcement'
  | 'emergency'
  | 'removed_from_event'
  /** An admin answered a support message; data.ticketId. */
  | 'support_reply';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface TrackingSettings {
  intervalSec: number;
  minDistanceM: number;
  maxAccuracyM: number;
  /** Keep tracking with the screen locked (only possible in a native wrapper; the PWA keeps the screen awake instead). */
  background: boolean;
  stopWhenPaused: boolean;
  staleAfterSec: number;
  hideAfterSec: number;
  showLastKnown: boolean;
  batterySaver: boolean;
  highAccuracy: boolean;
  maxSpeedMps: number;
  retentionDays: number;
  keepHistory: boolean;
}

export interface VisibilityRules {
  allies: 'none' | 'squad' | 'team' | 'alliance';
  squadLeadersSeeSquad: boolean;
  enemies: 'never' | 'perk_only' | 'always';
  allyPrecision: Precision;
  enemyPrecision: Precision;
  approxRadiusM: number;
  delaySec: number;
  showNicknames: boolean;
  showRoles: boolean;
  showEnemyBases: boolean;
  capturedObjectives: 'visible' | 'hidden' | 'owner_only';
  revealObjectivesBeforeStart: boolean;
  showEnemyCurrency: boolean;
}

export interface ScoringSettings {
  startingPoints: number;
  startingCurrency: number;
  /** 0 = unlimited */
  maxCurrency: number;
  allowNegativePoints: boolean;
  winCondition: 'points' | 'objectives';
}

export interface GameClock {
  status: EventStatus;
  startedAt: IsoDate | null;
  pausedAt: IsoDate | null;
  pausedTotalMs: number;
  endsAt: IsoDate | null;
  endedAt: IsoDate | null;
  /** Server time when this payload was produced; use it to correct the device clock. */
  serverNow: IsoDate;
}

export interface EventSummary {
  id: Uuid;
  name: string;
  coverUrl: string | null;
  gameMode: GameMode;
  customModeName: string | null;
  startAt: IsoDate;
  endAt: IsoDate;
  status: EventStatus;
  visibility: 'public' | 'private';
  meetingAddress: string | null;
  meetingLat: number | null;
  meetingLng: number | null;
  minPlayers: number;
  maxPlayers: number;
  approvedCount: number;
  pendingCount: number;
  teamCount: number;
  isGm: boolean;
  myStatus: MemberStatus | null;
  myTeamId: Uuid | null;
  isTestData: boolean;
}

export interface EventDetail extends EventSummary {
  description: string;
  customModeRules: string | null;
  requiresApproval: boolean;
  rules: string;
  safetyRules: string;
  requiredEquipment: string;
  chronoInfo: string;
  teamSelection: 'gm' | 'auto' | 'player';
  teamsLocked: boolean;
  registrationLocked: boolean;
  area: { lat: number; lng: number; zoom: number } | null;
  tracking: TrackingSettings;
  visibilityRules: VisibilityRules;
  scoring: ScoringSettings;
  storeEnabled: boolean;
  phase: string | null;
  autoEnd: boolean;
  clock: GameClock;
  winnerTeamId: Uuid | null;
  resultsToken: string | null;
  /** The public results page at /r/:resultsToken is live. */
  resultsPublished: boolean;
  gameMasters: { id: Uuid; nickname: string; avatarUrl: string | null }[];
  teams: Team[];
  squads: Squad[];
  me: Member | null;
  /** Only for Game Masters. */
  joinCode: string | null;
  /** Visible to everyone who can see the event. */
  attachmentCount: number;
  /** Only for Game Masters and approved members; empty for everyone else. */
  attachments: EventAttachment[];
}

/** A document shared with the players of an event (game book, briefing, maps). */
export interface EventAttachment {
  id: Uuid;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: IsoDate;
}

export interface EventInput {
  name: string;
  coverUrl?: string | null;
  description?: string;
  gameMode: GameMode;
  customModeName?: string | null;
  customModeRules?: string | null;
  startAt: IsoDate;
  endAt: IsoDate;
  meetingAddress?: string | null;
  meetingLat?: number | null;
  meetingLng?: number | null;
  minPlayers?: number;
  maxPlayers?: number;
  visibility?: 'public' | 'private';
  requiresApproval?: boolean;
  rules?: string;
  safetyRules?: string;
  requiredEquipment?: string;
  chronoInfo?: string;
  teamSelection?: 'gm' | 'auto' | 'player';
  teamsLocked?: boolean;
  registrationLocked?: boolean;
  area?: { lat: number; lng: number; zoom: number } | null;
  tracking?: Partial<TrackingSettings>;
  visibilityRules?: Partial<VisibilityRules>;
  scoring?: Partial<ScoringSettings>;
  storeEnabled?: boolean;
  phase?: string | null;
  autoEnd?: boolean;
}

export interface Team {
  id: Uuid;
  name: string;
  color: string;
  icon: string;
  pattern: TeamPattern;
  capacity: number;
  sortOrder: number;
  allianceId: string | null;
  baseLat: number | null;
  baseLng: number | null;
  points: number;
  /** null when the viewer is not allowed to see this team's currency */
  currency: number | null;
  memberCount: number;
  objectivesHeld: number;
}

export type TeamInput = Partial<Pick<Team, 'name' | 'color' | 'icon' | 'pattern' | 'capacity' | 'sortOrder' | 'allianceId' | 'baseLat' | 'baseLng'>>;

export interface Squad {
  id: Uuid;
  teamId: Uuid;
  name: string;
  callsign: string | null;
  icon: string | null;
  leaderId: Uuid | null;
}

export interface Member {
  userId: Uuid;
  nickname: string;
  avatarUrl: string | null;
  role: MemberRole;
  status: MemberStatus;
  teamId: Uuid | null;
  squadId: Uuid | null;
  isSquadLeader: boolean;
  /** null when roles are hidden for this viewer */
  playerRole: PlayerRole | null;
  ready: boolean;
  rulesAccepted: boolean;
  locationPermission: PermissionState;
  notificationPermission: PermissionState;
  /** The player consented to location tracking for this event. */
  trackingConsented: boolean;
  trackingActive: boolean;
  online: boolean;
  lastSeenAt: IsoDate | null;
  lastLocationAt: IsoDate | null;
  gpsAccuracy: number | null;
  points: number;
  captures: number;
  joinedAt: IsoDate;
  /** GM only, when the player opted in. */
  emergencyContact?: EmergencyContact | null;
}

export interface UpdateMyMembershipRequest {
  ready?: boolean;
  rulesAccepted?: boolean;
  locationPermission?: PermissionState;
  notificationPermission?: PermissionState;
  playerRole?: PlayerRole;
  /** true = I consent to location tracking for this event. */
  trackingConsent?: boolean;
}

// ---------------------------------------------------------------------------
// Map content
// ---------------------------------------------------------------------------

export type CaptureMethod = 'code' | 'qr' | 'geofence';
export type ObjectiveStatus = 'inactive' | 'active' | 'locked' | 'contested' | 'captured' | 'disabled' | 'completed';
export type ObjectiveType =
  | 'domination'
  | 'ctf'
  | 'vip'
  | 'search_destroy'
  | 'bomb_defusal'
  | 'attack_defense'
  | 'recon'
  | 'intel'
  | 'custom';

export interface GeofenceConfig {
  radiusM: number;
  durationSec: number;
  resetOnExit: boolean;
  multiPlayerBoost: boolean;
  boostPerExtraPlayer: number;
  maxMultiplier: number;
  contestable: boolean;
  /** Several teams inside: 'pause' = nobody progresses; 'majority' = the team with most players inside does. */
  contestRule: 'pause' | 'majority';
  requireScreenOpen: boolean;
  maxAccuracyM: number;
}

export interface Rewards {
  points: number;
  currency: number;
  perTeam: Record<Uuid, { points: number; currency: number }>;
  recurringPointsPerMinute: number;
  recurringCurrencyPerMinute: number;
  captureBonus: number;
  defenseBonus: number;
  completionBonus: number;
}

export interface ObjectiveVisibility {
  mode: 'all' | 'teams' | 'after_prerequisites' | 'gm_only';
  teamIds: Uuid[];
}

export interface Objective {
  id: Uuid;
  name: string;
  description: string;
  instructions: string;
  sortOrder: number;
  lat: number;
  lng: number;
  icon: string;
  color: string;
  type: ObjectiveType;
  imageUrl: string | null;
  documentUrl: string | null;
  methods: CaptureMethod[];
  requireGeofence: boolean;
  geofence: GeofenceConfig;
  rewards: Rewards;
  availabilityStart: IsoDate | null;
  availabilityEnd: IsoDate | null;
  cooldownSec: number;
  maxCaptures: number;
  allowedTeamIds: Uuid[];
  visibility: ObjectiveVisibility;
  prerequisiteIds: Uuid[];
  nextObjectiveId: Uuid | null;
  enabled: boolean;
  // runtime
  status: ObjectiveStatus;
  ownerTeamId: Uuid | null;
  captureCount: number;
  lastCapturedAt: IsoDate | null;
  lastCapturedByNickname: string | null;
  cooldownUntil: IsoDate | null;
  contested: boolean;
  /** Jam expiry for the viewer's team (players) or per team (GM). */
  jammedUntil: IsoDate | null;
  jammedFor: Record<Uuid, IsoDate>;
  shieldedUntil: IsoDate | null;
  shieldedTeamId: Uuid | null;
  /** Can the viewer's team capture it right now, and if not why. */
  canCapture: boolean;
  blockedReason: CaptureBlockReason | null;
  /** GM only */
  captureCode?: string | null;
  qrVersion?: number;
}

export type CaptureBlockReason =
  | 'not_live'
  | 'no_team'
  | 'disabled'
  | 'completed'
  | 'locked'
  | 'inactive'
  | 'contested'
  | 'already_owned'
  | 'team_not_allowed'
  | 'cooldown'
  | 'jammed'
  | 'shielded'
  | 'geofence_required';

export type ObjectiveInput = Partial<
  Pick<
    Objective,
    | 'name'
    | 'description'
    | 'instructions'
    | 'sortOrder'
    | 'lat'
    | 'lng'
    | 'icon'
    | 'color'
    | 'type'
    | 'imageUrl'
    | 'documentUrl'
    | 'methods'
    | 'requireGeofence'
    | 'availabilityStart'
    | 'availabilityEnd'
    | 'cooldownSec'
    | 'maxCaptures'
    | 'allowedTeamIds'
    | 'visibility'
    | 'prerequisiteIds'
    | 'nextObjectiveId'
    | 'enabled'
  >
> & {
  geofence?: Partial<GeofenceConfig>;
  rewards?: Partial<Rewards>;
  /** GM sets the manual capture code (unique within the event). */
  captureCode?: string | null;
};

export interface ObjectiveQr {
  payload: string;
  qrVersion: number;
  /** SVG markup of the QR code */
  svg: string;
  /** PNG data URL, 1024px, for download/print */
  pngDataUrl: string;
}

export interface Capture {
  id: Uuid;
  objectiveId: Uuid;
  objectiveName: string;
  teamId: Uuid;
  userId: Uuid | null;
  nickname: string | null;
  method: CaptureMethod | 'gm';
  points: number;
  currency: number;
  revoked: boolean;
  createdAt: IsoDate;
}

export interface CaptureRequest {
  method: 'code' | 'qr';
  code?: string;
  qrPayload?: string;
  clientTxId: string;
}

export interface CaptureResult {
  captured: boolean;
  captureId: Uuid;
  objectiveId: Uuid;
  points: number;
  currency: number;
}

export type PoiType = 'ammo' | 'medic' | 'respawn' | 'safe_zone' | 'team_base' | 'vehicle' | 'supply' | 'extraction' | 'restricted' | 'custom';

export interface ContentVisibility {
  mode: 'all' | 'teams' | 'gm_only';
  teamIds?: Uuid[];
  squadIds?: Uuid[];
  roles?: PlayerRole[];
  /** Event statuses (e.g. 'lobby', 'live') or custom phase labels in which the item is shown. Empty = always. */
  phases?: string[];
  activeFrom?: IsoDate | null;
  activeUntil?: IsoDate | null;
}

export interface Poi {
  id: Uuid;
  name: string;
  type: PoiType;
  description: string;
  lat: number;
  lng: number;
  icon: string;
  color: string;
  imageUrl: string | null;
  teamId: Uuid | null;
  visibility: ContentVisibility;
}

export type PoiInput = Partial<Omit<Poi, 'id'>>;

export type ZoneKind = 'playable' | 'restricted' | 'safe' | 'spawn' | 'respawn' | 'base' | 'extraction' | 'route' | 'line' | 'sector' | 'label';
export type ZoneGeometry = 'point' | 'circle' | 'polygon' | 'polyline';

export interface Zone {
  id: Uuid;
  kind: ZoneKind;
  geometry: ZoneGeometry;
  points: LatLng[];
  radiusM: number | null;
  label: string;
  description: string;
  color: string;
  fillOpacity: number;
  strokeWidth: number;
  icon: string | null;
  teamId: Uuid | null;
  visibility: ContentVisibility;
}

export type ZoneInput = Partial<Omit<Zone, 'id'>>;

export interface MapTemplate {
  id: Uuid;
  name: string;
  createdAt: IsoDate;
  zoneCount: number;
  poiCount: number;
  objectiveCount: number;
}

export interface EventTemplate {
  id: Uuid;
  name: string;
  createdAt: IsoDate;
  gameMode: GameMode;
}

export interface MapImportRequest {
  format: 'geojson' | 'csv';
  /** GeoJSON FeatureCollection, or CSV with header: type,name,lat,lng[,description] (type = objective|poi|<zone kind>) */
  content: string;
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

export type PerkType =
  | 'uav'
  | 'jammer'
  | 'theft'
  | 'shield'
  | 'double_points'
  | 'recon'
  | 'instant_respawn'
  | 'supply_drop'
  | 'comms_jammer'
  | 'custom';

export interface PerkConfig {
  uav?: { refreshSec: number; precision: Precision; delaySec: number; areaRadiusM: number };
  theft?: { mode: 'fixed' | 'percent'; amount: number; protectionSec: number };
  doublePoints?: { multiplier: number };
  recon?: { precision: Precision; revealSec: number };
}

export interface Perk {
  id: Uuid;
  name: string;
  description: string;
  icon: string;
  type: PerkType;
  price: number;
  durationSec: number;
  cooldownSec: number;
  totalQuantity: number;
  remainingQuantity: number | null;
  perTeamLimit: number;
  eligible: 'any' | 'squad_leaders' | 'roles';
  eligibleRoles: PlayerRole[];
  requiresApproval: boolean;
  activation: 'immediate' | 'manual';
  target: 'none' | 'enemy_team' | 'objective';
  config: PerkConfig;
  enabled: boolean;
  sortOrder: number;
  /** Viewer-specific availability (players). */
  availability?: {
    canBuy: boolean;
    reason: 'store_disabled' | 'not_live' | 'not_eligible' | 'sold_out' | 'team_limit' | 'cooldown' | 'insufficient_funds' | 'disabled' | 'no_team' | null;
    cooldownUntil: IsoDate | null;
    teamPurchases: number;
  };
}

export type PerkInput = Partial<Omit<Perk, 'id' | 'remainingQuantity' | 'availability'>>;

export type PurchaseStatus = 'pending_approval' | 'ready' | 'active' | 'completed' | 'expired' | 'rejected' | 'cancelled';

export interface PerkPurchase {
  id: Uuid;
  perkId: Uuid;
  perkName: string;
  perkType: PerkType;
  perkIcon: string;
  teamId: Uuid;
  buyerId: Uuid | null;
  buyerNickname: string | null;
  price: number;
  targetTeamId: Uuid | null;
  targetObjectiveId: Uuid | null;
  status: PurchaseStatus;
  refunded: boolean;
  activatedAt: IsoDate | null;
  expiresAt: IsoDate | null;
  reason: string | null;
  createdAt: IsoDate;
}

export interface PurchaseRequest {
  targetTeamId?: Uuid | null;
  targetObjectiveId?: Uuid | null;
  clientTxId: string;
}

export interface Effect {
  id: Uuid;
  type: PerkType;
  purchaseId: Uuid | null;
  teamId: Uuid;
  targetTeamId: Uuid | null;
  objectiveId: Uuid | null;
  startsAt: IsoDate;
  expiresAt: IsoDate;
  status: 'active' | 'expired' | 'cancelled';
  label: string;
}

export type LedgerKind = 'points' | 'currency';
export type LedgerType =
  | 'starting_balance'
  | 'capture'
  | 'capture_bonus'
  | 'recurring'
  | 'defense_bonus'
  | 'completion_bonus'
  | 'gm_adjustment'
  | 'penalty'
  | 'perk_purchase'
  | 'perk_refund'
  | 'theft_in'
  | 'theft_out'
  | 'capture_revoked';

export interface LedgerEntry {
  id: Uuid;
  teamId: Uuid;
  kind: LedgerKind;
  type: LedgerType;
  amount: number;
  requested: number;
  balanceAfter: number;
  userId: Uuid | null;
  nickname: string | null;
  objectiveId: Uuid | null;
  objectiveName: string | null;
  perkId: Uuid | null;
  purchaseId: Uuid | null;
  reason: string;
  actorId: Uuid | null;
  actorNickname: string | null;
  createdAt: IsoDate;
}

export interface AdjustBalanceRequest {
  teamId: Uuid;
  kind: LedgerKind;
  amount: number;
  reason: string;
  /** Mark as penalty instead of a generic adjustment (negative amounts). */
  penalty?: boolean;
  userId?: Uuid | null;
  clientTxId: string;
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

export interface LocationSample {
  lat: number;
  lng: number;
  accuracy: number;
  speed?: number | null;
  heading?: number | null;
  altitude?: number | null;
  /** Device time in epoch ms */
  timestamp: number;
  isMocked?: boolean;
}

export interface LocationReportRequest {
  samples: LocationSample[];
  screenObjectiveId?: Uuid | null;
  /** Device clock (epoch ms) when sent; the server uses it to correct a wrong phone clock. */
  sentAt?: number;
}

export interface GeofenceStatus {
  objectiveId: Uuid;
  inside: boolean;
  distanceM: number;
  progressSec: number;
  requiredSec: number;
  contested: boolean;
  armed: boolean;
  captured: boolean;
  multiplier: number;
  /** Why a player who may be in the zone is not counted; 'confirming' = one fix inside, waiting for a second. */
  blocked: 'low_accuracy' | 'screen_closed' | 'confirming' | null;
  /** Worst GPS accuracy (m) this objective accepts. */
  maxAccuracyM: number;
  /** Majority rule: another team has more players inside, so this team's hold is paused. */
  outnumbered: boolean;
}

export interface LocationReportResponse {
  accepted: number;
  rejected: number;
  flags: ('future_timestamp' | 'too_old' | 'low_accuracy' | 'speed' | 'mock' | 'stale')[];
  geofence: GeofenceStatus[];
  serverNow: IsoDate;
}

export type PositionStatus = 'online' | 'stale' | 'offline';

export interface VisiblePosition {
  userId: Uuid;
  nickname: string | null;
  teamId: Uuid | null;
  squadId: Uuid | null;
  playerRole: PlayerRole | null;
  kind: 'self' | 'ally' | 'enemy' | 'intel';
  precision: Precision;
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** For approximate/area precision: radius of the uncertainty circle. */
  radiusM: number | null;
  sampleAt: IsoDate;
  receivedAt: IsoDate;
  status: PositionStatus;
  /** GM only */
  flags?: string[];
  suspicious?: boolean;
}

export interface Announcement {
  id: Uuid;
  scope: 'all' | 'team' | 'player';
  teamId: Uuid | null;
  targetUserId: Uuid | null;
  title: string;
  body: string;
  priority: Priority;
  authorNickname: string | null;
  createdAt: IsoDate;
}

export interface AnnouncementRequest {
  scope: 'all' | 'team' | 'player';
  teamId?: Uuid | null;
  targetUserId?: Uuid | null;
  title: string;
  body: string;
  priority: Priority;
}

export interface ActivityItem {
  id: string;
  type: string;
  message: string;
  scope: 'all' | 'team' | 'gm';
  teamId: Uuid | null;
  userId: Uuid | null;
  objectiveId: Uuid | null;
  data: Record<string, unknown>;
  createdAt: IsoDate;
}

export interface GmAlert {
  id: Uuid;
  type: 'gps_suspicious' | 'disconnected' | 'capture' | 'purchase_request' | 'perk_fulfil' | 'emergency' | 'capture_failed';
  severity: 'info' | 'warning' | 'critical';
  userId: Uuid | null;
  nickname: string | null;
  message: string;
  data: Record<string, unknown>;
  acknowledged: boolean;
  createdAt: IsoDate;
}

export interface AuditLogEntry {
  id: string;
  actorId: Uuid | null;
  actorNickname: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: IsoDate;
}

/** Everything the live screens need in one request; then kept fresh over the socket. */
export interface LiveSnapshot {
  event: EventDetail;
  members: Member[];
  objectives: Objective[];
  pois: Poi[];
  zones: Zone[];
  perks: Perk[];
  purchases: PerkPurchase[];
  effects: Effect[];
  announcements: Announcement[];
  positions: VisiblePosition[];
  /** GM only */
  alerts?: GmAlert[];
  serverNow: IsoDate;
}

export type GmObjectiveAction = 'activate' | 'disable' | 'set_owner' | 'clear_owner' | 'contest' | 'uncontest' | 'reset';

// ---------------------------------------------------------------------------
// Home, results
// ---------------------------------------------------------------------------

export interface HomeDashboard {
  activeEvent: EventSummary | null;
  nextEvent: EventSummary | null;
  invitations: EventSummary[];
  recentEvents: EventSummary[];
  stats: PlayerStats;
  unreadNotifications: number;
  /** Event-related only (new events, invitations, registrations, start/end); no in-game ones. */
  latestNotifications: AppNotification[];
  /** Latest published News, pinned first. */
  news: News[];
  gm: {
    drafts: EventSummary[];
    published: EventSummary[];
    live: EventSummary[];
    pendingApprovals: { eventId: Uuid; eventName: string; count: number }[];
  } | null;
}

export interface TeamResult {
  teamId: Uuid;
  name: string;
  color: string;
  icon: string;
  pattern: TeamPattern;
  rank: number;
  points: number;
  currency: number;
  objectivesCaptured: number;
  objectivesHeld: number;
  perksPurchased: number;
}

export interface PlayerResult {
  userId: Uuid | null;
  nickname: string;
  teamId: Uuid | null;
  points: number;
  captures: number;
  currencyEarned: number;
}

export interface EventResults {
  eventId: Uuid;
  eventName: string;
  gameMode: GameMode;
  status: EventStatus;
  startedAt: IsoDate | null;
  endedAt: IsoDate | null;
  durationMs: number;
  winnerTeamId: Uuid | null;
  isDraw: boolean;
  teams: TeamResult[];
  players: PlayerResult[];
  timeline: Capture[];
  perks: PerkPurchase[];
  adjustments: LedgerEntry[];
  resultsToken: string | null;
}

export type ExportKind = 'leaderboard' | 'players' | 'captures' | 'ledger' | 'perks';

// ---------------------------------------------------------------------------
// News (written by the platform admins)
// ---------------------------------------------------------------------------

export type NewsCategory = 'update' | 'sponsor' | 'announcement' | 'event';

export interface News {
  id: Uuid;
  title: string;
  summary: string;
  /** Plain text; blank lines separate paragraphs. */
  body: string;
  category: NewsCategory;
  imageUrl: string | null;
  /** https://… or an app path like /events/discover */
  linkUrl: string | null;
  linkLabel: string | null;
  pinned: boolean;
  /** null = draft; in the future = scheduled. */
  publishedAt: IsoDate | null;
  authorNickname: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export type NewsInput = Pick<News, 'title' | 'summary' | 'body' | 'category' | 'imageUrl' | 'linkUrl' | 'linkLabel' | 'pinned' | 'publishedAt'>;

// ---------------------------------------------------------------------------
// Support (players write to the platform admins)
// ---------------------------------------------------------------------------

export type SupportCategory = 'bug' | 'report' | 'general';
/** open = waiting for the team, answered = waiting for the player, closed = done. */
export type SupportStatus = 'open' | 'answered' | 'closed';

/** Device details attached to a bug report, only when the player agrees. */
export interface SupportContext {
  page?: string;
  userAgent?: string;
  screen?: string;
}

export interface SupportTicket {
  id: Uuid;
  category: SupportCategory;
  subject: string;
  status: SupportStatus;
  /** Author nickname, admins only. */
  userNickname: string | null;
  context: SupportContext;
  messageCount: number;
  createdAt: IsoDate;
  lastMessageAt: IsoDate;
}

export interface SupportMessage {
  id: Uuid;
  /** Written by the Airsoft Zeus team. */
  fromAdmin: boolean;
  /** Player nickname; null for admin messages. */
  authorNickname: string | null;
  body: string;
  createdAt: IsoDate;
}

export interface SupportTicketDetail extends SupportTicket {
  /** The viewer is an admin answering someone else's conversation. */
  asStaff: boolean;
  messages: SupportMessage[];
}

export interface SupportTicketInput {
  category: SupportCategory;
  subject: string;
  body: string;
  context?: SupportContext;
}

// ---------------------------------------------------------------------------
// Admin dashboard (ADMIN_EMAILS)
// ---------------------------------------------------------------------------

export interface AdminOverview {
  tickets: { open: number; answered: number; closed: number; openBugs: number };
  news: { drafts: number; scheduled: number; published: number };
}
