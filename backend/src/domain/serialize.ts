/**
 * Row → API DTO mappers. Output shapes match frontend/src/app/core/api/models.ts exactly.
 * Secrets (capture codes, QR tokens, join codes, personal data) are only emitted where the
 * caller explicitly asks for the GM/owner variant.
 */
import { effectiveFeatures } from '../auth/features.js';
import { isAdminEmail } from '../auth/middleware.js';
import type { Row } from '../db.js';
import { geofence, rewards, scoring, tracking, visibility } from './defaults.js';
import type { CaptureBlockReason, ObjectiveStatus } from './rules.js';
import { pick, tr } from '../i18n/index.js';

export const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

export const BADGES = (): Record<string, { label: string; description: string }> => ({
  first_game: { label: tr`First deployment`, description: tr`Played a first event to the end.` },
  first_capture: { label: tr`First capture`, description: tr`Captured a first objective.` },
  ten_captures: { label: tr`Objective runner`, description: tr`Captured 10 objectives.` },
  fifty_captures: { label: tr`Objective specialist`, description: tr`Captured 50 objectives.` },
  veteran: { label: tr`Veteran`, description: tr`Played 10 events.` },
  winner: { label: tr`Winning side`, description: tr`Was on the winning team.` },
  mvp: { label: tr`Event MVP`, description: tr`Earned the most points in an event.` },
  game_master: { label: tr`Game Master`, description: tr`Ran an event to completion.` },
});

export function badge(r: Row) {
  const meta = BADGES()[r.code] ?? { label: r.code, description: '' };
  return { code: r.code, label: meta.label, description: meta.description, awardedAt: iso(r.awarded_at)!, eventId: r.event_id ?? null };
}

const DEFAULT_STATS = { gamesPlayed: 0, objectivesCaptured: 0, totalPoints: 0, wins: 0, losses: 0, draws: 0 };
const DEFAULT_PRIVACY = { showClub: true, showStats: true, showRole: true, showCountry: true, shareEmergencyWithGm: false };

export function meUser(u: Row, badges: Row[]) {
  return {
    id: u.id,
    email: u.email,
    emailVerified: !!u.email_verified_at,
    nickname: u.nickname,
    firstName: u.first_name,
    lastName: u.last_name,
    dateOfBirth: u.date_of_birth,
    country: u.country,
    language: u.language,
    avatarUrl: u.avatar_url,
    clubId: u.club_id,
    clubName: u.club_name,
    playerRole: u.player_role,
    customRole: u.custom_role,
    bio: u.bio,
    emergencyContact: u.emergency_contact ?? null,
    emergencyContactEnabled: u.emergency_contact_enabled,
    privacy: { ...DEFAULT_PRIVACY, ...(u.privacy ?? {}) },
    locationRetentionDays: u.location_retention_days,
    onboardingDone: u.onboarding_done,
    termsAccepted: !!u.terms_accepted_at,
    stats: { ...DEFAULT_STATS, ...(u.stats ?? {}) },
    badges: badges.map(badge),
    isAdmin: isAdminEmail(u.email),
    features: effectiveFeatures(u.features, isAdminEmail(u.email)),
    createdAt: iso(u.created_at)!,
  };
}

export function publicProfile(u: Row, badges: Row[]) {
  if (u.deleted_at) {
    return { id: u.id, nickname: tr`Deleted player`, avatarUrl: null, clubId: null, clubName: null, playerRole: null, customRole: null, bio: null, country: null, stats: null, badges: [], deleted: true };
  }
  const p = { ...DEFAULT_PRIVACY, ...(u.privacy ?? {}) };
  return {
    id: u.id,
    nickname: u.nickname,
    avatarUrl: u.avatar_url,
    clubId: p.showClub ? u.club_id : null,
    clubName: p.showClub ? u.club_name : null,
    playerRole: p.showRole ? u.player_role : null,
    customRole: p.showRole ? u.custom_role : null,
    bio: u.bio,
    country: p.showCountry ? u.country : null,
    stats: p.showStats ? { ...DEFAULT_STATS, ...(u.stats ?? {}) } : null,
    badges: p.showStats ? badges.map(badge) : [],
    deleted: false,
  };
}

export function club(c: Row, members?: Row[]) {
  return {
    id: c.id,
    name: c.name,
    country: c.country,
    city: c.city,
    description: c.description,
    logoUrl: c.logo_url,
    website: c.website,
    ownerId: c.owner_id,
    memberCount: Number(c.member_count ?? members?.length ?? 0),
    ...(members
      ? { members: members.map((m) => ({ id: m.id, nickname: m.nickname, avatarUrl: m.avatar_url, playerRole: m.privacy?.showRole === false ? null : m.player_role })) }
      : {}),
  };
}

export function notification(n: Row) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    priority: n.priority,
    eventId: n.event_id,
    data: n.data ?? {},
    read: !!n.read_at,
    createdAt: iso(n.created_at)!,
  };
}

export function news(n: Row) {
  return {
    id: n.id,
    title: n.title,
    summary: n.summary,
    body: n.body,
    category: n.category,
    imageUrl: n.image_url,
    linkUrl: n.link_url,
    linkLabel: n.link_label,
    pinned: n.pinned,
    publishedAt: iso(n.published_at),
    authorNickname: n.author_nickname ?? null,
    createdAt: iso(n.created_at)!,
    updatedAt: iso(n.updated_at)!,
  };
}

export function supportTicket(t: Row, admin = false) {
  return {
    id: t.id,
    category: t.category,
    subject: t.subject,
    status: t.status,
    /** Author nickname: admins only (players only ever see their own tickets). */
    userNickname: admin ? (t.user_nickname ?? null) : null,
    context: t.context ?? {},
    messageCount: t.message_count ?? 0,
    createdAt: iso(t.created_at)!,
    lastMessageAt: iso(t.last_message_at)!,
  };
}

export function supportMessage(m: Row) {
  return {
    id: m.id,
    fromAdmin: m.from_admin,
    authorNickname: m.from_admin ? null : (m.author_nickname ?? null),
    body: m.body,
    createdAt: iso(m.created_at)!,
  };
}

export function clock(e: Row, now = new Date()) {
  return {
    status: e.status,
    startedAt: iso(e.started_at),
    pausedAt: iso(e.paused_at),
    pausedTotalMs: Number(e.paused_total_ms ?? 0),
    endsAt: iso(e.ends_at),
    endedAt: iso(e.ended_at),
    serverNow: now.toISOString(),
  };
}

/** `e` may carry aggregates: approved_count, pending_count, team_count, my_status, my_team_id, is_gm */
export function eventSummary(e: Row) {
  return {
    id: e.id,
    name: e.name,
    coverUrl: e.cover_url,
    gameMode: e.game_mode,
    customModeName: e.custom_mode_name,
    startAt: iso(e.start_at)!,
    endAt: iso(e.end_at)!,
    status: e.status,
    visibility: e.visibility,
    meetingAddress: e.meeting_address,
    meetingLat: e.meeting_lat,
    meetingLng: e.meeting_lng,
    minPlayers: e.min_players,
    maxPlayers: e.max_players,
    approvedCount: Number(e.approved_count ?? 0),
    pendingCount: Number(e.pending_count ?? 0),
    teamCount: Number(e.team_count ?? 0),
    isGm: !!e.is_gm,
    myStatus: e.my_status ?? null,
    myTeamId: e.my_team_id ?? null,
    isTestData: !!e.is_test_data,
  };
}

/** SQL fragment adding the aggregates eventSummary expects; $1 = viewer user id. */
export const EVENT_SUMMARY_SELECT = `
  e.*,
  (SELECT count(*) FROM event_members m WHERE m.event_id = e.id AND m.role = 'player' AND m.status = 'approved') AS approved_count,
  (SELECT count(*) FROM event_members m WHERE m.event_id = e.id AND m.status = 'pending') AS pending_count,
  (SELECT count(*) FROM teams t WHERE t.event_id = e.id) AS team_count,
  (SELECT m.status FROM event_members m WHERE m.event_id = e.id AND m.user_id = $1) AS my_status,
  (SELECT m.team_id FROM event_members m WHERE m.event_id = e.id AND m.user_id = $1) AS my_team_id,
  (e.owner_id = $1 OR EXISTS (SELECT 1 FROM event_members m WHERE m.event_id = e.id AND m.user_id = $1 AND m.role = 'gm' AND m.status = 'approved')) AS is_gm
`;

export function team(t: Row, opts: { showCurrency: boolean }) {
  return {
    id: t.id,
    name: t.name,
    color: t.color,
    icon: t.icon,
    pattern: t.pattern,
    capacity: t.capacity,
    sortOrder: t.sort_order,
    allianceId: t.alliance_id,
    baseLat: t.base_lat,
    baseLng: t.base_lng,
    points: Number(t.points),
    currency: opts.showCurrency ? Number(t.currency) : null,
    memberCount: Number(t.member_count ?? 0),
    objectivesHeld: Number(t.objectives_held ?? 0),
  };
}

export const TEAM_SELECT = `
  t.*,
  (SELECT count(*) FROM event_members m WHERE m.team_id = t.id AND m.status = 'approved') AS member_count,
  (SELECT count(*) FROM objectives o WHERE o.owner_team_id = t.id) AS objectives_held
`;

export function squad(s: Row) {
  return { id: s.id, teamId: s.team_id, name: s.name, callsign: s.callsign, icon: s.icon, leaderId: s.leader_id };
}

export function attachment(a: Row) {
  return { id: a.id, fileName: a.file_name, mimeType: a.mime_type, sizeBytes: a.size_bytes, createdAt: iso(a.created_at) };
}

/** `m` joined with users: nickname, avatar_url. */
export function member(m: Row, opts: { viewerIsGm: boolean; showRole: boolean; online: boolean }) {
  return {
    userId: m.user_id,
    nickname: m.nickname,
    avatarUrl: m.avatar_url,
    role: m.role,
    status: m.status,
    teamId: m.team_id,
    squadId: m.squad_id,
    isSquadLeader: m.is_squad_leader,
    playerRole: opts.showRole || opts.viewerIsGm ? m.player_role : null,
    ready: m.ready,
    rulesAccepted: !!m.rules_accepted_at,
    locationPermission: m.location_permission,
    notificationPermission: m.notification_permission,
    trackingConsented: !!m.tracking_consent_at,
    trackingActive: m.tracking_active,
    online: opts.online,
    lastSeenAt: iso(m.last_seen_at),
    lastLocationAt: iso(m.last_location_at),
    gpsAccuracy: m.gps_accuracy,
    points: Number(m.points),
    captures: m.captures,
    joinedAt: iso(m.joined_at)!,
    ...(opts.viewerIsGm ? { emergencyContact: m.emergency_contact ?? null } : {}),
  };
}

export interface ObjectiveComputed {
  status: ObjectiveStatus;
  canCapture: boolean;
  blockedReason: CaptureBlockReason | null;
  cooldownUntil: number | null;
  viewerTeamId: string | null;
  lastCapturedByNickname: string | null;
}

export function objective(o: Row, c: ObjectiveComputed, gm: boolean) {
  const jammedFor: Record<string, string> = {};
  const now = Date.now();
  for (const [teamId, until] of Object.entries((o.jammed_for ?? {}) as Record<string, number>)) {
    if (until > now) jammedFor[teamId] = new Date(until).toISOString();
  }
  const myJam = c.viewerTeamId ? jammedFor[c.viewerTeamId] : undefined;
  return {
    id: o.id,
    name: o.name,
    description: o.description,
    instructions: o.instructions,
    sortOrder: o.sort_order,
    lat: o.lat,
    lng: o.lng,
    icon: o.icon,
    color: o.color,
    type: o.type,
    imageUrl: o.image_url,
    documentUrl: o.document_url,
    methods: o.methods,
    requireGeofence: o.require_geofence,
    geofence: geofence(o.geofence),
    rewards: rewards(o.rewards),
    availabilityStart: iso(o.availability_start),
    availabilityEnd: iso(o.availability_end),
    cooldownSec: o.cooldown_sec,
    maxCaptures: o.max_captures,
    allowedTeamIds: o.allowed_team_ids ?? [],
    visibility: { teamIds: [], ...(o.visibility ?? { mode: 'all' }) },
    prerequisiteIds: o.prerequisite_ids ?? [],
    nextObjectiveId: o.next_objective_id,
    enabled: o.enabled,
    status: c.status,
    ownerTeamId: o.owner_team_id,
    captureCount: o.capture_count,
    lastCapturedAt: iso(o.last_captured_at),
    lastCapturedByNickname: c.lastCapturedByNickname,
    cooldownUntil: c.cooldownUntil && c.cooldownUntil > now ? new Date(c.cooldownUntil).toISOString() : null,
    contested: o.contested || o.contested_by_gm,
    jammedUntil: gm ? null : (myJam ?? null),
    jammedFor: gm ? jammedFor : myJam && c.viewerTeamId ? { [c.viewerTeamId]: myJam } : {},
    shieldedUntil: o.shielded_until && new Date(o.shielded_until).getTime() > now ? iso(o.shielded_until) : null,
    shieldedTeamId: o.shielded_until && new Date(o.shielded_until).getTime() > now ? o.shielded_team_id : null,
    canCapture: c.canCapture,
    blockedReason: c.blockedReason,
    ...(gm ? { captureCode: o.capture_code ?? null, qrVersion: o.qr_version } : {}),
  };
}

export function poi(p: Row) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    description: p.description,
    lat: p.lat,
    lng: p.lng,
    icon: p.icon,
    color: p.color,
    imageUrl: p.image_url,
    teamId: p.team_id,
    visibility: p.visibility ?? { mode: 'all' },
  };
}

export function zone(z: Row) {
  return {
    id: z.id,
    kind: z.kind,
    geometry: z.geometry,
    points: z.points ?? [],
    radiusM: z.radius_m,
    label: z.label,
    description: z.description,
    color: z.color,
    fillOpacity: z.fill_opacity,
    strokeWidth: z.stroke_width,
    icon: z.icon,
    teamId: z.team_id,
    visibility: z.visibility ?? { mode: 'all' },
  };
}

export function perk(p: Row, availability?: unknown) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    icon: p.icon,
    type: p.type,
    price: Number(p.price),
    durationSec: p.duration_sec,
    cooldownSec: p.cooldown_sec,
    totalQuantity: p.total_quantity,
    remainingQuantity: p.total_quantity > 0 ? p.remaining_quantity : null,
    perTeamLimit: p.per_team_limit,
    eligible: p.eligible,
    eligibleRoles: p.eligible_roles ?? [],
    requiresApproval: p.requires_approval,
    activation: p.activation,
    target: p.target,
    config: p.config ?? {},
    enabled: p.enabled,
    sortOrder: p.sort_order,
    ...(availability ? { availability } : {}),
  };
}

/** `p` joined with perks (perk_name, perk_type, perk_icon) and users (buyer_nickname). */
export function purchase(p: Row) {
  return {
    id: p.id,
    perkId: p.perk_id,
    perkName: p.perk_name,
    perkType: p.perk_type,
    perkIcon: p.perk_icon,
    teamId: p.team_id,
    buyerId: p.buyer_id,
    buyerNickname: p.buyer_nickname ?? null,
    price: Number(p.price),
    targetTeamId: p.target_team_id,
    targetObjectiveId: p.target_objective_id,
    status: p.status,
    refunded: p.refunded,
    activatedAt: iso(p.activated_at),
    expiresAt: iso(p.expires_at),
    reason: p.reason,
    createdAt: iso(p.created_at)!,
  };
}

export const PURCHASE_SELECT = `
  pp.*, pk.name AS perk_name, pk.type AS perk_type, pk.icon AS perk_icon, u.nickname AS buyer_nickname
  FROM perk_purchases pp
  JOIN perks pk ON pk.id = pp.perk_id
  LEFT JOIN users u ON u.id = pp.buyer_id
`;

const EFFECT_LABELS = (): Record<string, string> => ({
  uav: tr`UAV active`,
  recon: tr`Recon scan`,
  jammer: tr`Objective jammed`,
  shield: tr`Objective shielded`,
  double_points: tr`Double points`,
  instant_respawn: tr`Instant respawn`,
  supply_drop: tr`Supply drop`,
  comms_jammer: tr`Comms jammer`,
  custom: tr`Perk active`,
  theft: tr`Currency theft`,
});

export function effect(e: Row) {
  return {
    id: e.id,
    type: e.type,
    purchaseId: e.purchase_id,
    teamId: e.team_id,
    targetTeamId: e.target_team_id,
    objectiveId: e.objective_id,
    startsAt: iso(e.starts_at)!,
    expiresAt: iso(e.expires_at)!,
    status: e.status,
    label: e.perk_name ?? EFFECT_LABELS()[e.type] ?? e.type,
  };
}

/** `l` joined: nickname, objective_name, actor_nickname */
export function ledger(l: Row) {
  return {
    id: l.id,
    teamId: l.team_id,
    kind: l.kind,
    type: l.type,
    amount: Number(l.amount),
    requested: Number(l.requested),
    balanceAfter: Number(l.balance_after),
    userId: l.user_id,
    nickname: l.nickname ?? null,
    objectiveId: l.objective_id,
    objectiveName: l.objective_name ?? null,
    perkId: l.perk_id,
    purchaseId: l.purchase_id,
    reason: pick(l.reason_i18n, l.reason),
    actorId: l.actor_id,
    actorNickname: l.actor_nickname ?? null,
    createdAt: iso(l.created_at)!,
  };
}

export const LEDGER_SELECT = `
  l.*, u.nickname, o.name AS objective_name, a.nickname AS actor_nickname
  FROM ledger_entries l
  LEFT JOIN users u ON u.id = l.user_id
  LEFT JOIN objectives o ON o.id = l.objective_id
  LEFT JOIN users a ON a.id = l.actor_id
`;

/** `c` joined: objective_name, nickname */
export function capture(c: Row) {
  return {
    id: c.id,
    objectiveId: c.objective_id,
    objectiveName: c.objective_name,
    teamId: c.team_id,
    userId: c.user_id,
    nickname: c.nickname ?? null,
    method: c.method,
    points: Number(c.points),
    currency: Number(c.currency),
    revoked: !!c.revoked_at,
    createdAt: iso(c.created_at)!,
  };
}

export const CAPTURE_SELECT = `
  c.*, o.name AS objective_name, u.nickname
  FROM objective_captures c
  JOIN objectives o ON o.id = c.objective_id
  LEFT JOIN users u ON u.id = c.user_id
`;

export function announcement(a: Row) {
  return {
    id: a.id,
    scope: a.scope,
    teamId: a.team_id,
    targetUserId: a.target_user_id,
    title: a.title,
    body: a.body,
    priority: a.priority,
    authorNickname: a.author_nickname ?? null,
    createdAt: iso(a.created_at)!,
  };
}

export function activity(a: Row) {
  return {
    id: String(a.id),
    type: a.type,
    // Reader's language; data.messages has all of them for socket broadcasts.
    message: pick(a.data?.messages, a.message),
    scope: a.scope,
    teamId: a.team_id,
    userId: a.user_id,
    objectiveId: a.objective_id,
    data: a.data ?? {},
    createdAt: iso(a.created_at)!,
  };
}

export function alert(a: Row) {
  return {
    id: a.id,
    type: a.type,
    severity: a.severity,
    userId: a.user_id,
    nickname: a.nickname ?? null,
    message: pick(a.data?.messages, a.message),
    data: a.data ?? {},
    acknowledged: !!a.acknowledged_at,
    createdAt: iso(a.created_at)!,
  };
}

export function audit(a: Row) {
  return {
    id: String(a.id),
    actorId: a.actor_id,
    actorNickname: a.actor_nickname ?? null,
    action: a.action,
    targetType: a.target_type,
    targetId: a.target_id,
    before: a.before,
    after: a.after,
    reason: a.reason,
    createdAt: iso(a.created_at)!,
  };
}

export function settings(e: Row) {
  return { tracking: tracking(e.tracking), visibilityRules: visibility(e.visibility_rules), scoring: scoring(e.scoring) };
}
