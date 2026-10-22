import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../api/api.service';
import { ApiError } from '../api/api-error';
import {
  ActivityItem,
  Announcement,
  Effect,
  EventDetail,
  GameClock,
  GmAlert,
  LiveSnapshot,
  Member,
  Objective,
  Perk,
  PerkPurchase,
  Poi,
  Team,
  Uuid,
  VisiblePosition,
  Zone,
} from '../api/models';
import { AuthService } from '../auth/auth.service';
import { ConnectivityService } from '../net/connectivity.service';
import { InvalidateScope } from '../realtime/realtime-events';
import { RealtimeService } from '../realtime/realtime.service';
import { activeLanguage } from '../i18n/language';
import { safeStorage } from '../util/storage';

type Cached = Omit<LiveSnapshot, 'positions' | 'alerts'> & { cachedAt: number };

/**
 * State of one event while it is being played or run. Provide it on the route
 * (`providers: [LiveStore]`) and call `load(eventId)` once.
 *
 * - REST snapshot first, then socket pushes keep it fresh.
 * - `invalidate` messages trigger a debounced refetch of only the affected resources.
 * - The last snapshot (without positions) is cached in localStorage so the map,
 *   objectives and rules stay available when the signal drops.
 */
@Injectable()
export class LiveStore {
  private readonly api = inject(ApiService);
  private readonly realtime = inject(RealtimeService);
  private readonly auth = inject(AuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly destroyRef = inject(DestroyRef);

  readonly eventId = signal<Uuid | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  /** true when the data shown comes from the offline cache */
  readonly fromCache = signal(false);
  readonly cachedAt = signal<number | null>(null);

  readonly event = signal<EventDetail | null>(null);
  readonly teams = signal<Team[]>([]);
  readonly members = signal<Member[]>([]);
  readonly objectives = signal<Objective[]>([]);
  readonly pois = signal<Poi[]>([]);
  readonly zones = signal<Zone[]>([]);
  readonly perks = signal<Perk[]>([]);
  readonly purchases = signal<PerkPurchase[]>([]);
  readonly effects = signal<Effect[]>([]);
  readonly announcements = signal<Announcement[]>([]);
  readonly positions = signal<VisiblePosition[]>([]);
  readonly alerts = signal<GmAlert[]>([]);
  readonly activity = signal<ActivityItem[]>([]);
  readonly clock = signal<GameClock | null>(null);
  /** serverNow − deviceNow, in ms. Add to Date.now() to get server time. */
  readonly serverOffsetMs = signal(0);
  /** Increments when the server says ledgers changed; screens showing a ledger refetch on change. */
  readonly ledgerVersion = signal(0);
  /** Latest announcement not yet dismissed, for the banner. */
  readonly bannerAnnouncement = signal<Announcement | null>(null);

  readonly isGm = computed(() => this.event()?.isGm ?? false);
  readonly me = computed(() => this.event()?.me ?? null);
  readonly myTeam = computed(() => {
    const teamId = this.me()?.teamId;
    return teamId ? (this.teams().find((t) => t.id === teamId) ?? null) : null;
  });
  readonly mySquad = computed(() => {
    const squadId = this.me()?.squadId;
    return squadId ? (this.event()?.squads.find((s) => s.id === squadId) ?? null) : null;
  });
  readonly teamById = computed(() => new Map(this.teams().map((t) => [t.id, t])));
  readonly objectiveById = computed(() => new Map(this.objectives().map((o) => [o.id, o])));
  readonly activeEffects = computed(() => this.effects().filter((e) => e.status === 'active'));
  readonly isLive = computed(() => this.clock()?.status === 'live');

  private pending = new Set<InvalidateScope>();
  private subscribedTo: Uuid | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      if (this.realtime.connected() && untracked(() => this.fromCache()) && untracked(() => this.eventId())) void untracked(() => this.reload());
    });
    this.realtime
      .on('positions')
      .pipe(takeUntilDestroyed())
      .subscribe((p) => {
        if (p.eventId !== this.eventId()) return;
        this.positions.set(p.positions);
        this.setServerNow(p.serverNow);
      });
    this.realtime
      .on('teams')
      .pipe(takeUntilDestroyed())
      .subscribe((p) => p.eventId === this.eventId() && this.teams.set(p.teams));
    this.realtime
      .on('clock')
      .pipe(takeUntilDestroyed())
      .subscribe((p) => {
        if (p.eventId !== this.eventId()) return;
        this.clock.set(p.clock);
        this.setServerNow(p.clock.serverNow);
        this.queue(['event']);
      });
    this.realtime
      .on('invalidate')
      .pipe(takeUntilDestroyed())
      .subscribe((p) => p.eventId === this.eventId() && this.queue(p.scopes));
    this.realtime
      .on('announcement')
      .pipe(takeUntilDestroyed())
      .subscribe((p) => {
        if (p.eventId !== this.eventId()) return;
        this.announcements.update((list) => [p.announcement, ...list.filter((a) => a.id !== p.announcement.id)].slice(0, 50));
        this.bannerAnnouncement.set(p.announcement);
      });
    this.realtime
      .on('activity')
      .pipe(takeUntilDestroyed())
      .subscribe((p) => p.eventId === this.eventId() && this.activity.update((l) => [inMyLanguage(p.item), ...l].slice(0, 200)));
    this.realtime
      .on('alert')
      .pipe(takeUntilDestroyed())
      .subscribe((p) => p.eventId === this.eventId() && this.alerts.update((l) => [inMyLanguage(p.alert), ...l.filter((a) => a.id !== p.alert.id)]));
  }

  /** Server time in epoch ms. */
  now(): number {
    return Date.now() + this.serverOffsetMs();
  }

  async load(eventId: Uuid): Promise<void> {
    this.eventId.set(eventId);
    this.loading.set(true);
    this.error.set(null);
    if (this.subscribedTo !== eventId) {
      this.subscribedTo = eventId;
      void this.realtime.subscribe(eventId, this.destroyRef);
    }
    try {
      const snap = await this.api.live(eventId);
      this.applySnapshot(snap);
      this.fromCache.set(false);
      this.connectivity.markSynced();
      safeStorage.set(this.cacheKey(eventId), { ...snap, positions: undefined, alerts: undefined, cachedAt: Date.now() });
    } catch (e) {
      const err = ApiError.from(e);
      const cached = safeStorage.get<Cached>(this.cacheKey(eventId));
      if (err.isNetwork && cached) {
        this.applySnapshot({ ...cached, positions: [] });
        this.fromCache.set(true);
        this.cachedAt.set(cached.cachedAt);
      } else {
        this.error.set(err);
      }
    } finally {
      this.loading.set(false);
    }
    void this.loadActivity();
  }

  reload(): Promise<void> {
    const id = this.eventId();
    return id ? this.load(id) : Promise.resolve();
  }

  /** Refetch specific resources now (e.g. after an action the user just took). */
  refresh(...scopes: InvalidateScope[]): void {
    this.queue(scopes, 0);
  }

  dismissBanner(): void {
    this.bannerAnnouncement.set(null);
  }

  private async loadActivity(): Promise<void> {
    const id = this.eventId();
    if (!id) return;
    try {
      const page = await this.api.activity(id);
      this.activity.set(page.items);
    } catch {
      /* activity feed is optional */
    }
  }

  private applySnapshot(s: LiveSnapshot): void {
    this.event.set(s.event);
    this.teams.set(s.event.teams);
    this.clock.set(s.event.clock);
    this.members.set(s.members);
    this.objectives.set(s.objectives);
    this.pois.set(s.pois);
    this.zones.set(s.zones);
    this.perks.set(s.perks);
    this.purchases.set(s.purchases);
    this.effects.set(s.effects);
    this.announcements.set(s.announcements);
    this.positions.set(s.positions);
    this.alerts.set(s.alerts ?? []);
    this.setServerNow(s.serverNow);
  }

  private setServerNow(iso: string): void {
    const offset = new Date(iso).getTime() - Date.now();
    // Smooth out jitter: only move when the difference is meaningful.
    if (Math.abs(offset - this.serverOffsetMs()) > 750) this.serverOffsetMs.set(offset);
  }

  private queue(scopes: InvalidateScope[], delay = 250): void {
    scopes.forEach((s) => this.pending.add(s));
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), delay);
  }

  private async flush(): Promise<void> {
    const id = this.eventId();
    if (!id) return;
    const scopes = new Set(this.pending);
    this.pending.clear();
    const jobs: Promise<unknown>[] = [];
    const run = <T>(p: Promise<T>, apply: (v: T) => void) => jobs.push(p.then(apply).catch(() => undefined));

    if (scopes.has('event') || scopes.has('me') || scopes.has('squads')) {
      run(this.api.event(id), (e) => {
        this.event.set(e);
        this.teams.set(e.teams);
        this.clock.set(e.clock);
        this.setServerNow(e.clock.serverNow);
      });
    }
    if (scopes.has('members')) run(this.api.members(id), (m) => this.members.set(m));
    if (scopes.has('objectives') || scopes.has('captures')) run(this.api.objectives(id), (o) => this.objectives.set(o));
    if (scopes.has('pois')) run(this.api.pois(id), (p) => this.pois.set(p));
    if (scopes.has('zones')) run(this.api.zones(id), (z) => this.zones.set(z));
    if (scopes.has('perks')) run(this.api.perks(id), (p) => this.perks.set(p));
    if (scopes.has('purchases')) run(this.api.purchases(id), (p) => this.purchases.set(p));
    if (scopes.has('effects')) run(this.api.effects(id), (e) => this.effects.set(e));
    if (scopes.has('alerts') && this.isGm()) run(this.api.alerts(id), (a) => this.alerts.set(a.items));
    if (scopes.has('ledger')) this.ledgerVersion.update((v) => v + 1);
    await Promise.all(jobs);
    this.connectivity.markSynced();
  }

  private cacheKey(eventId: Uuid): string {
    return `zeus.live.${this.auth.user()?.id ?? 'anon'}.${eventId}`;
  }
}

/**
 * Socket items are serialized once for everyone; system messages carry every language in
 * data.messages (HTTP responses are already in the reader's language).
 */
function inMyLanguage<T extends { message: string; data: Record<string, unknown> }>(item: T): T {
  const messages = item.data['messages'] as Record<string, string> | undefined;
  const message = messages?.[activeLanguage()];
  return message ? { ...item, message } : item;
}
