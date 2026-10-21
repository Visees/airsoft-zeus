import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  ActivityItem,
  AdjustBalanceRequest,
  Announcement,
  AnnouncementRequest,
  AppConfig,
  AppNotification,
  AuditLogEntry,
  AuthResponse,
  Capture,
  CaptureRequest,
  CaptureResult,
  Club,
  ConsentKind,
  Effect,
  EventDetail,
  EventInput,
  EventResults,
  EventSummary,
  EventTemplate,
  ExportKind,
  GmAlert,
  GmObjectiveAction,
  HomeDashboard,
  LedgerEntry,
  LedgerKind,
  LiveSnapshot,
  LocationReportRequest,
  LocationReportResponse,
  MapImportRequest,
  MapTemplate,
  Member,
  MeUser,
  MyStats,
  News,
  NewsInput,
  Objective,
  ObjectiveInput,
  SupportStatus,
  SupportTicket,
  SupportTicketDetail,
  SupportTicketInput,
  ObjectiveQr,
  Page,
  Perk,
  PerkInput,
  PerkPurchase,
  Poi,
  PoiInput,
  PublicProfile,
  PurchaseRequest,
  RegisterRequest,
  Squad,
  Team,
  TeamInput,
  UpdateMyMembershipRequest,
  UpdateProfileRequest,
  Uuid,
  Zone,
  ZoneInput,
} from './models';

/**
 * Typed client for the REST API (all paths relative to /api).
 * Every method returns a Promise; errors are ApiError (see api-error.ts) thrown by the interceptor.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  private get<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>): Promise<T> {
    return firstValueFrom(this.http.get<T>(this.base + path, { params: toParams(params) }));
  }
  private post<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.base + path, body));
  }
  private patch<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(this.base + path, body));
  }
  private delete<T>(path: string, body?: unknown): Promise<T> {
    return firstValueFrom(this.http.delete<T>(this.base + path, { body }));
  }
  private ev(eventId: Uuid, path = ''): string {
    return `/events/${encodeURIComponent(eventId)}${path}`;
  }

  // --- config & auth ------------------------------------------------------
  config() {
    return this.get<AppConfig>('/config');
  }
  register(body: RegisterRequest) {
    return this.post<AuthResponse>('/auth/register', body);
  }
  login(email: string, password: string) {
    return this.post<AuthResponse>('/auth/login', { email, password });
  }
  refresh() {
    return this.post<AuthResponse>('/auth/refresh');
  }
  logout() {
    return this.post<{ ok: true }>('/auth/logout');
  }
  verifyEmail(token: string) {
    return this.post<{ ok: true }>('/auth/verify-email', { token });
  }
  resendVerification() {
    return this.post<{ ok: true }>('/auth/resend-verification');
  }
  forgotPassword(email: string) {
    return this.post<{ ok: true }>('/auth/forgot-password', { email });
  }
  resetPassword(token: string, password: string) {
    return this.post<{ ok: true }>('/auth/reset-password', { token, password });
  }
  /** Returns a fresh session: all other sessions are signed out. Use AuthService.changePassword. */
  changePassword(currentPassword: string, newPassword: string) {
    return this.post<AuthResponse>('/auth/change-password', { currentPassword, newPassword });
  }
  unreadCount() {
    return this.get<{ unread: number }>('/me/notifications/unread-count');
  }
  nicknameAvailable(nickname: string) {
    return this.get<{ available: boolean; reason: string | null }>('/auth/nickname-available', { nickname });
  }

  // --- me -----------------------------------------------------------------
  me() {
    return this.get<MeUser>('/me');
  }
  updateMe(body: UpdateProfileRequest) {
    return this.patch<MeUser>('/me', body);
  }
  changeNickname(nickname: string) {
    return this.post<MeUser>('/me/nickname', { nickname });
  }
  recordConsent(kind: ConsentKind, granted: boolean, version?: string, eventId?: Uuid) {
    return this.post<{ ok: true }>('/me/consents', { kind, granted, version, eventId });
  }
  home() {
    return this.get<HomeDashboard>('/me/home');
  }
  myStats() {
    return this.get<MyStats>('/me/stats');
  }
  exportMyData() {
    return firstValueFrom(this.http.get(this.base + '/me/export', { responseType: 'blob' }));
  }
  deleteAccount(password: string) {
    return this.delete<{ ok: true }>('/me', { password, confirm: 'DELETE' });
  }
  notifications(cursor?: string | null) {
    return this.get<Page<AppNotification>>('/me/notifications', { cursor });
  }
  markNotificationsRead(ids: Uuid[] | 'all') {
    return this.post<{ ok: true }>('/me/notifications/read', ids === 'all' ? { all: true } : { ids });
  }
  savePushSubscription(subscription: PushSubscriptionJSON) {
    return this.post<{ ok: true }>('/me/push-subscriptions', subscription);
  }
  deletePushSubscription(endpoint: string) {
    return this.delete<{ ok: true }>('/me/push-subscriptions', { endpoint });
  }

  // --- users, clubs, uploads, reports ---------------------------------------
  publicProfile(userId: Uuid) {
    return this.get<PublicProfile>(`/users/${userId}/profile`);
  }
  clubs(q?: string) {
    return this.get<Club[]>('/clubs', { q });
  }
  club(id: Uuid) {
    return this.get<Club>(`/clubs/${id}`);
  }
  createClub(body: Partial<Club>) {
    return this.post<Club>('/clubs', body);
  }
  updateClub(id: Uuid, body: Partial<Club>) {
    return this.patch<Club>(`/clubs/${id}`, body);
  }
  upload(file: File, purpose: 'avatar' | 'cover' | 'team_icon' | 'objective_image' | 'objective_document' | 'poi_image' | 'club_logo' | 'news_image') {
    const form = new FormData();
    form.append('file', file);
    form.append('purpose', purpose);
    return this.post<{ url: string }>('/uploads', form);
  }
  report(body: { eventId?: Uuid; targetUserId?: Uuid; reason: string; details?: string }) {
    return this.post<{ ok: true }>('/reports', body);
  }

  // --- news -----------------------------------------------------------------
  /** Published news; `all` (admins only) also returns drafts and scheduled posts. */
  news(cursor?: string | null, all = false) {
    return this.get<Page<News>>('/news', { cursor, all: all || null });
  }
  newsItem(id: Uuid) {
    return this.get<News>(`/news/${encodeURIComponent(id)}`);
  }
  createNews(body: NewsInput) {
    return this.post<News>('/news', body);
  }
  updateNews(id: Uuid, body: Partial<NewsInput>) {
    return this.patch<News>(`/news/${encodeURIComponent(id)}`, body);
  }
  deleteNews(id: Uuid) {
    return this.delete<{ ok: true }>(`/news/${encodeURIComponent(id)}`);
  }

  // --- support --------------------------------------------------------------
  /** My conversations; `all` (admins only) returns every ticket. */
  supportTickets(opts: { cursor?: string | null; all?: boolean; status?: SupportStatus | null } = {}) {
    return this.get<Page<SupportTicket>>('/support', { cursor: opts.cursor, all: opts.all || null, status: opts.status });
  }
  supportTicket(id: Uuid) {
    return this.get<SupportTicketDetail>(`/support/${encodeURIComponent(id)}`);
  }
  createSupportTicket(body: SupportTicketInput) {
    return this.post<SupportTicketDetail>('/support', body);
  }
  replySupportTicket(id: Uuid, body: string) {
    return this.post<SupportTicketDetail>(`/support/${encodeURIComponent(id)}/messages`, { body });
  }
  setSupportStatus(id: Uuid, status: SupportStatus) {
    return this.patch<SupportTicketDetail>(`/support/${encodeURIComponent(id)}`, { status });
  }

  // --- events ---------------------------------------------------------------
  discover(params: { q?: string; mode?: string; from?: string; cursor?: string | null } = {}) {
    return this.get<Page<EventSummary>>('/events/discover', params);
  }
  myEvents(filter: 'upcoming' | 'past' | 'gm' | 'invitations' = 'upcoming') {
    return this.get<EventSummary[]>('/events/mine', { filter });
  }
  createEvent(body: EventInput) {
    return this.post<EventDetail>('/events', body);
  }
  /** `joinCode` lets someone who received the code open a private event before joining. */
  event(eventId: Uuid, joinCode?: string) {
    return this.get<EventDetail>(this.ev(eventId), { code: joinCode });
  }
  updateEvent(eventId: Uuid, body: Partial<EventInput>) {
    return this.patch<EventDetail>(this.ev(eventId), body);
  }
  deleteEvent(eventId: Uuid) {
    return this.delete<{ ok: true }>(this.ev(eventId));
  }
  setEventStatus(eventId: Uuid, status: EventDetail['status'], reason?: string) {
    return this.post<EventDetail>(this.ev(eventId, '/status'), { status, reason });
  }
  extendGame(eventId: Uuid, minutes: number) {
    return this.post<EventDetail>(this.ev(eventId, '/gm/extend'), { minutes });
  }
  duplicateEvent(eventId: Uuid) {
    return this.post<EventDetail>(this.ev(eventId, '/duplicate'));
  }
  saveEventTemplate(eventId: Uuid, name: string) {
    return this.post<EventTemplate>(this.ev(eventId, '/template'), { name });
  }
  eventTemplates() {
    return this.get<EventTemplate[]>('/templates/events');
  }
  createEventFromTemplate(templateId: Uuid, body: { name: string; startAt: string; endAt: string }) {
    return this.post<EventDetail>(`/templates/events/${templateId}/instantiate`, body);
  }
  deleteEventTemplate(templateId: Uuid) {
    return this.delete<{ ok: true }>(`/templates/events/${templateId}`);
  }
  regenerateJoinCode(eventId: Uuid) {
    return this.post<{ joinCode: string }>(this.ev(eventId, '/join-code/regenerate'));
  }
  findEventByCode(code: string) {
    return this.post<{ eventId: Uuid }>('/events/find-by-code', { code });
  }
  joinEvent(eventId: Uuid, joinCode?: string) {
    return this.post<{ status: Member['status'] }>(this.ev(eventId, '/join'), { joinCode });
  }
  leaveEvent(eventId: Uuid) {
    return this.post<{ ok: true }>(this.ev(eventId, '/leave'));
  }
  respondToInvitation(eventId: Uuid, accept: boolean) {
    return this.post<{ status: Member['status'] }>(this.ev(eventId, '/invitation'), { accept });
  }
  updateMyMembership(eventId: Uuid, body: UpdateMyMembershipRequest) {
    return this.patch<Member>(this.ev(eventId, '/me'), body);
  }

  // --- members (GM unless noted) ------------------------------------------
  members(eventId: Uuid) {
    return this.get<Member[]>(this.ev(eventId, '/members'));
  }
  invitePlayer(eventId: Uuid, nickname: string) {
    return this.post<Member>(this.ev(eventId, '/members/invite'), { nickname });
  }
  reviewMember(eventId: Uuid, userId: Uuid, approve: boolean) {
    return this.post<Member>(this.ev(eventId, `/members/${userId}/review`), { approve });
  }
  removeMember(eventId: Uuid, userId: Uuid, reason: string) {
    return this.post<{ ok: true }>(this.ev(eventId, `/members/${userId}/remove`), { reason });
  }
  assignMember(eventId: Uuid, userId: Uuid, body: { teamId: Uuid | null; squadId?: Uuid | null; isSquadLeader?: boolean }) {
    return this.post<Member>(this.ev(eventId, `/members/${userId}/assign`), body);
  }
  /** Player action when teamSelection == 'player'. */
  chooseTeam(eventId: Uuid, teamId: Uuid) {
    return this.post<Member>(this.ev(eventId, '/choose-team'), { teamId });
  }
  autoBalance(eventId: Uuid) {
    return this.post<{ assigned: number }>(this.ev(eventId, '/auto-balance'));
  }
  addGameMaster(eventId: Uuid, nickname: string) {
    return this.post<{ ok: true }>(this.ev(eventId, '/game-masters'), { nickname });
  }
  removeGameMaster(eventId: Uuid, userId: Uuid) {
    return this.delete<{ ok: true }>(this.ev(eventId, `/game-masters/${userId}`));
  }

  // --- teams & squads (GM) --------------------------------------------------
  createTeam(eventId: Uuid, body: TeamInput) {
    return this.post<Team>(this.ev(eventId, '/teams'), body);
  }
  updateTeam(eventId: Uuid, teamId: Uuid, body: TeamInput) {
    return this.patch<Team>(this.ev(eventId, `/teams/${teamId}`), body);
  }
  deleteTeam(eventId: Uuid, teamId: Uuid) {
    return this.delete<{ ok: true }>(this.ev(eventId, `/teams/${teamId}`));
  }
  createSquad(eventId: Uuid, body: Partial<Squad>) {
    return this.post<Squad>(this.ev(eventId, '/squads'), body);
  }
  updateSquad(eventId: Uuid, squadId: Uuid, body: Partial<Squad>) {
    return this.patch<Squad>(this.ev(eventId, `/squads/${squadId}`), body);
  }
  deleteSquad(eventId: Uuid, squadId: Uuid) {
    return this.delete<{ ok: true }>(this.ev(eventId, `/squads/${squadId}`));
  }

  // --- objectives -------------------------------------------------------------
  objectives(eventId: Uuid) {
    return this.get<Objective[]>(this.ev(eventId, '/objectives'));
  }
  objective(eventId: Uuid, objectiveId: Uuid) {
    return this.get<{ objective: Objective; captures: Capture[] }>(this.ev(eventId, `/objectives/${objectiveId}`));
  }
  createObjective(eventId: Uuid, body: ObjectiveInput) {
    return this.post<Objective>(this.ev(eventId, '/objectives'), body);
  }
  updateObjective(eventId: Uuid, objectiveId: Uuid, body: ObjectiveInput) {
    return this.patch<Objective>(this.ev(eventId, `/objectives/${objectiveId}`), body);
  }
  deleteObjective(eventId: Uuid, objectiveId: Uuid) {
    return this.delete<{ ok: true }>(this.ev(eventId, `/objectives/${objectiveId}`));
  }
  duplicateObjective(eventId: Uuid, objectiveId: Uuid) {
    return this.post<Objective>(this.ev(eventId, `/objectives/${objectiveId}/duplicate`));
  }
  objectiveQr(eventId: Uuid, objectiveId: Uuid) {
    return this.get<ObjectiveQr>(this.ev(eventId, `/objectives/${objectiveId}/qr`));
  }
  regenerateObjectiveQr(eventId: Uuid, objectiveId: Uuid) {
    return this.post<ObjectiveQr>(this.ev(eventId, `/objectives/${objectiveId}/qr/regenerate`));
  }
  capture(eventId: Uuid, objectiveId: Uuid, body: CaptureRequest) {
    return this.post<CaptureResult>(this.ev(eventId, `/objectives/${objectiveId}/capture`), body);
  }
  captures(eventId: Uuid, cursor?: string | null) {
    return this.get<Page<Capture>>(this.ev(eventId, '/captures'), { cursor });
  }

  // --- POIs, zones, map templates ---------------------------------------------
  pois(eventId: Uuid) {
    return this.get<Poi[]>(this.ev(eventId, '/pois'));
  }
  createPoi(eventId: Uuid, body: PoiInput) {
    return this.post<Poi>(this.ev(eventId, '/pois'), body);
  }
  updatePoi(eventId: Uuid, poiId: Uuid, body: PoiInput) {
    return this.patch<Poi>(this.ev(eventId, `/pois/${poiId}`), body);
  }
  deletePoi(eventId: Uuid, poiId: Uuid) {
    return this.delete<{ ok: true }>(this.ev(eventId, `/pois/${poiId}`));
  }
  zones(eventId: Uuid) {
    return this.get<Zone[]>(this.ev(eventId, '/zones'));
  }
  createZone(eventId: Uuid, body: ZoneInput) {
    return this.post<Zone>(this.ev(eventId, '/zones'), body);
  }
  updateZone(eventId: Uuid, zoneId: Uuid, body: ZoneInput) {
    return this.patch<Zone>(this.ev(eventId, `/zones/${zoneId}`), body);
  }
  deleteZone(eventId: Uuid, zoneId: Uuid) {
    return this.delete<{ ok: true }>(this.ev(eventId, `/zones/${zoneId}`));
  }
  importMap(eventId: Uuid, body: MapImportRequest) {
    return this.post<{ objectives: number; pois: number; zones: number }>(this.ev(eventId, '/map/import'), body);
  }
  mapTemplates() {
    return this.get<MapTemplate[]>('/templates/maps');
  }
  saveMapTemplate(eventId: Uuid, name: string) {
    return this.post<MapTemplate>(this.ev(eventId, '/map/save-template'), { name });
  }
  applyMapTemplate(eventId: Uuid, templateId: Uuid) {
    return this.post<{ objectives: number; pois: number; zones: number }>(this.ev(eventId, '/map/apply-template'), { templateId });
  }
  deleteMapTemplate(templateId: Uuid) {
    return this.delete<{ ok: true }>(`/templates/maps/${templateId}`);
  }

  // --- perks ----------------------------------------------------------------
  perks(eventId: Uuid) {
    return this.get<Perk[]>(this.ev(eventId, '/perks'));
  }
  createPerk(eventId: Uuid, body: PerkInput) {
    return this.post<Perk>(this.ev(eventId, '/perks'), body);
  }
  addDefaultPerks(eventId: Uuid) {
    return this.post<Perk[]>(this.ev(eventId, '/perks/defaults'));
  }
  updatePerk(eventId: Uuid, perkId: Uuid, body: PerkInput) {
    return this.patch<Perk>(this.ev(eventId, `/perks/${perkId}`), body);
  }
  deletePerk(eventId: Uuid, perkId: Uuid) {
    return this.delete<{ ok: true }>(this.ev(eventId, `/perks/${perkId}`));
  }
  purchasePerk(eventId: Uuid, perkId: Uuid, body: PurchaseRequest) {
    return this.post<PerkPurchase>(this.ev(eventId, `/perks/${perkId}/purchase`), body);
  }
  purchases(eventId: Uuid) {
    return this.get<PerkPurchase[]>(this.ev(eventId, '/purchases'));
  }
  reviewPurchase(eventId: Uuid, purchaseId: Uuid, approve: boolean, reason?: string) {
    return this.post<PerkPurchase>(this.ev(eventId, `/purchases/${purchaseId}/review`), { approve, reason });
  }
  activatePurchase(eventId: Uuid, purchaseId: Uuid) {
    return this.post<PerkPurchase>(this.ev(eventId, `/purchases/${purchaseId}/activate`));
  }
  cancelPurchase(eventId: Uuid, purchaseId: Uuid, refund: boolean, reason: string) {
    return this.post<PerkPurchase>(this.ev(eventId, `/purchases/${purchaseId}/cancel`), { refund, reason });
  }
  effects(eventId: Uuid) {
    return this.get<Effect[]>(this.ev(eventId, '/effects'));
  }

  // --- live -------------------------------------------------------------------
  live(eventId: Uuid) {
    return this.get<LiveSnapshot>(this.ev(eventId, '/live'));
  }
  reportLocation(eventId: Uuid, body: LocationReportRequest) {
    return this.post<LocationReportResponse>(this.ev(eventId, '/locations'), body);
  }
  stopTracking(eventId: Uuid) {
    return this.post<{ ok: true }>(this.ev(eventId, '/tracking/stop'));
  }
  ledger(eventId: Uuid, params: { kind?: LedgerKind; teamId?: Uuid; cursor?: string | null } = {}) {
    return this.get<Page<LedgerEntry>>(this.ev(eventId, '/ledger'), params);
  }
  activity(eventId: Uuid, cursor?: string | null) {
    return this.get<Page<ActivityItem>>(this.ev(eventId, '/activity'), { cursor });
  }
  announcements(eventId: Uuid, cursor?: string | null) {
    return this.get<Page<Announcement>>(this.ev(eventId, '/announcements'), { cursor });
  }
  sendAnnouncement(eventId: Uuid, body: AnnouncementRequest) {
    return this.post<Announcement>(this.ev(eventId, '/announcements'), body);
  }
  alerts(eventId: Uuid, cursor?: string | null) {
    return this.get<Page<GmAlert>>(this.ev(eventId, '/alerts'), { cursor });
  }
  acknowledgeAlert(eventId: Uuid, alertId: Uuid) {
    return this.post<{ ok: true }>(this.ev(eventId, `/alerts/${alertId}/ack`));
  }
  auditLog(eventId: Uuid, cursor?: string | null) {
    return this.get<Page<AuditLogEntry>>(this.ev(eventId, '/audit'), { cursor });
  }

  // --- GM live actions ----------------------------------------------------------
  adjustBalance(eventId: Uuid, body: AdjustBalanceRequest) {
    return this.post<{ balance: number; applied: number }>(this.ev(eventId, '/gm/adjust'), body);
  }
  gmObjectiveAction(eventId: Uuid, objectiveId: Uuid, action: GmObjectiveAction, reason: string, teamId?: Uuid | null) {
    return this.post<Objective>(this.ev(eventId, `/gm/objectives/${objectiveId}`), { action, reason, teamId });
  }
  revokeCapture(eventId: Uuid, captureId: Uuid, reverseRewards: boolean, reason: string) {
    return this.post<{ ok: true }>(this.ev(eventId, `/gm/captures/${captureId}/revoke`), { reverseRewards, reason });
  }

  // --- results ------------------------------------------------------------------
  results(eventId: Uuid) {
    return this.get<EventResults>(this.ev(eventId, '/results'));
  }
  publishResults(eventId: Uuid) {
    return this.post<{ token: string; url: string }>(this.ev(eventId, '/results/publish'));
  }
  unpublishResults(eventId: Uuid) {
    return this.post<{ ok: true }>(this.ev(eventId, '/results/unpublish'));
  }
  publicResults(token: string) {
    return this.get<EventResults>(`/public/results/${encodeURIComponent(token)}`);
  }
  /** Returns a Blob (text/csv or application/pdf) to save. */
  exportFile(eventId: Uuid, format: 'csv' | 'pdf', kind: ExportKind = 'leaderboard') {
    return firstValueFrom(
      this.http.get(`${this.base}${this.ev(eventId, '/export')}`, {
        params: toParams({ format, kind }),
        responseType: 'blob',
      }),
    );
  }
}

function toParams(params?: Record<string, string | number | boolean | null | undefined>): HttpParams {
  let p = new HttpParams();
  if (!params) return p;
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  }
  return p;
}
