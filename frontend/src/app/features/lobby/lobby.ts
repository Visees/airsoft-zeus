import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { Announcement, EventDetail, Member } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { LocationTracker } from '../../core/location/location-tracker.service';
import { InvalidateScope } from '../../core/realtime/realtime-events';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { GAME_MODE_LABELS, formatDate, formatTime } from '../../core/util/format';
import { AnnouncementBanner } from '../../shared/announcement-banner';
import { GameTimer, nowSignal } from '../../shared/game-timer';
import { ConnectionStatus } from '../../shared/link-status';
import { ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { StatusChip, eventStatusChip } from '../../shared/status-chip';
import { LobbyChecklist } from './lobby-checklist';
import { LobbyGmControls } from './lobby-gm-controls';
import { LobbyGmPlay } from './lobby-gm-play';
import { LobbyRoster } from './lobby-roster';

/** Pre-game room: checklist, roster, announcements; GM tools to run the start. */
@Component({
  selector: 'zeus-lobby-screen',
  imports: [
    RouterLink,
    NgIcon,
    HlmButton,
    AnnouncementBanner,
    GameTimer,
    ConnectionStatus,
    ErrorState,
    LoadingSkeleton,
    PageHeader,
    StatusChip,
    LobbyChecklist,
    LobbyGmControls,
    LobbyGmPlay,
    LobbyRoster,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (loading() && !event()) {
        <div class="mb-4 h-10 w-2/3 animate-pulse rounded-sm bg-muted" aria-hidden="true"></div>
        <zeus-loading-skeleton [rows]="6" [avatar]="true" />
      } @else if (error() && !event()) {
        <zeus-page-header title="Lobby" [back]="'/events/' + eventId()" backLabel="Event" i18n-title i18n-backLabel />
        <zeus-error-state [error]="error()" (retry)="loadAll()" />
      } @else if (event(); as e) {
        <zeus-page-header [title]="e.name" eyebrow="Lobby" [back]="'/events/' + e.id" backLabel="Event details" i18n-eyebrow i18n-backLabel>
          <zeus-status-chip [spec]="statusChip()" />
          <zeus-connection-status [compact]="true" [quietOnline]="true" />
        </zeus-page-header>

        @if (offline()) {
          <div class="mb-3 flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning-surface px-3 py-2 text-sm" role="status">
            <span i18n>Showing the last data loaded. Changes need a connection.</span>
            <zeus-connection-status />
          </div>
        }

        <!-- Status banners -->
        @switch (e.status) {
          @case ('live') {
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary bg-primary/10 p-4" role="alert">
              <div>
                <p class="font-bold uppercase" i18n>● The game is live</p>
                @if (!e.isGm && !myTeamId()) {
                  <p class="text-sm text-muted-foreground" i18n>You have no team yet. Ask a Game Master to assign you.</p>
                }
              </div>
              @if (e.isGm) {
                <a hlmBtn class="h-12" [routerLink]="['/gm/events', e.id, 'control']"><ng-icon name="lucideLayoutDashboard" size="18" aria-hidden="true" /> <ng-container i18n>Control center</ng-container></a>
              } @else {
                <a hlmBtn class="h-12" [routerLink]="['/events', e.id, 'live']"><ng-icon name="lucideMap" size="18" aria-hidden="true" /> <ng-container i18n>Open live map</ng-container></a>
              }
            </div>
          }
          @case ('paused') {
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning bg-warning-surface p-4" role="status">
              <p class="font-bold uppercase" i18n>❚❚ Game paused</p>
              <a hlmBtn class="h-12" [routerLink]="e.isGm ? ['/gm/events', e.id, 'control'] : ['/events', e.id, 'live']">{{ e.isGm ? txt.controlCenter : txt.openLiveMap }}</a>
            </div>
          }
          @case ('completed') {
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted p-4" role="status">
              <p class="font-bold uppercase" i18n>✓ The game has ended</p>
              <a hlmBtn class="h-11" [routerLink]="['/events', e.id, 'results']"><ng-icon name="lucideTrophy" size="16" aria-hidden="true" /> <ng-container i18n>View results</ng-container></a>
            </div>
          }
          @case ('cancelled') {
            <div class="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-4" role="alert">
              <p class="font-bold uppercase" i18n>✕ Event cancelled</p>
              <p class="text-sm text-muted-foreground" i18n>The Game Master cancelled this event. No game takes place and nothing is tracked.</p>
            </div>
          }
        }

        <!-- Summary -->
        <section class="panel mb-4 grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center" aria-label="Event summary" i18n-aria-label>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt class="label-caps" i18n>Mode</dt>
              <dd class="font-semibold">{{ modeLabel() }}</dd>
            </div>
            <div>
              <dt class="label-caps" i18n>Start</dt>
              <dd class="font-semibold">{{ dateLabel() }}</dd>
              <dd class="num text-muted-foreground">{{ timeLabel() }}</dd>
            </div>
            <div>
              <dt class="label-caps" i18n>Players</dt>
              <dd class="font-semibold"><span class="num">{{ playerCount() }}/{{ e.maxPlayers }}</span></dd>
              <dd class="text-muted-foreground" i18n>min <span class="num">{{ e.minPlayers }}</span> · <span class="num">{{ readyCount() }}</span> ready</dd>
            </div>
            @if (e.meetingAddress || e.meetingLat !== null) {
              <div class="col-span-2 sm:col-span-3">
                <dt class="label-caps" i18n>Meeting point</dt>
                <dd class="flex flex-wrap items-center gap-2">
                  <span>{{ e.meetingAddress || txt.pinnedLocation }}</span>
                  @if (e.meetingLat !== null && e.meetingLng !== null) {
                    <a class="hit inline-flex items-center gap-1 text-sm font-semibold text-nav underline-offset-4 hover:underline" [href]="'https://www.google.com/maps/dir/?api=1&destination=' + e.meetingLat + ',' + e.meetingLng" target="_blank" rel="noopener noreferrer">
                      <ng-icon name="lucideNavigation" size="14" aria-hidden="true" /> <ng-container i18n>Directions<span class="sr-only"> (opens Google Maps)</span></ng-container>
                    </a>
                  }
                </dd>
              </div>
            }
          </dl>
          @if (e.status !== 'cancelled' && e.status !== 'completed') {
            <div class="flex flex-col items-start gap-1 border-t border-border pt-3 sm:items-end sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
              <zeus-game-timer [clock]="e.clock" [startAt]="e.startAt" [serverOffsetMs]="serverOffset()" size="lg" />
              @if (startOverdue()) {
                <p class="text-xs text-warning" i18n>▲ Start time passed — waiting for the Game Master</p>
              }
            </div>
          }
        </section>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
          <div class="flex min-w-0 flex-col gap-4">
            @if (!e.isGm && e.me && preGame()) {
              <zeus-lobby-checklist [event]="e" (memberChange)="onMemberChange($event)" />
            }
            <zeus-lobby-roster
              [event]="e"
              [members]="members()"
              [isGm]="e.isGm"
              [selfId]="selfId()"
              [unavailable]="membersUnavailable()"
              (changed)="refresh(['members', 'event'])"
            />
          </div>

          <div class="flex flex-col gap-4">
            @if (e.isGm && preGame()) {
              <zeus-lobby-gm-controls
                [event]="e"
                [members]="members()"
                (eventChange)="onEventChange($event)"
                (announcementSent)="addAnnouncement($event)"
                (membersChanged)="refresh(['members', 'event'])"
              />
            }
            @if (e.isGm && e.me && e.status !== 'completed' && e.status !== 'cancelled') {
              <zeus-lobby-gm-play [event]="e" (memberChange)="onMemberChange($event)" />
            }

            <section aria-labelledby="ann-list-title">
              <h2 id="ann-list-title" class="label-caps mb-2" i18n>Announcements · <span class="num">{{ announcements().length }}</span></h2>
              @if (!announcements().length) {
                <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground" i18n>No announcements yet. Messages from the Game Master appear here.</p>
              } @else {
                <ul class="flex flex-col gap-2" aria-live="polite">
                  @for (a of announcements(); track a.id) {
                    <li><zeus-announcement-banner [announcement]="a" [dismissible]="false" /></li>
                  }
                </ul>
                @if (annCursor()) {
                  <button hlmBtn variant="ghost" type="button" class="tap mt-2 w-full" [disabled]="annLoading()" (click)="loadOlderAnnouncements()">
                    {{ annLoading() ? txt.loading : txt.olderAnnouncements }}
                  </button>
                }
              }
            </section>

            @if (!e.isGm && preGame()) {
              <button hlmBtn variant="ghost" type="button" class="tap self-start text-destructive" [disabled]="leaving()" (click)="leave()">
                <ng-icon name="lucideLogOut" size="16" aria-hidden="true" /> <ng-container i18n>Leave event</ng-container>
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class LobbyScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    controlCenter: $localize`Control center`,
    openLiveMap: $localize`Open live map`,
    pinnedLocation: $localize`Pinned location`,
    loading: $localize`Loading…`,
    olderAnnouncements: $localize`Older announcements`,
  };

  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly realtime = inject(RealtimeService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly tracker = inject(LocationTracker);

  readonly eventId = input.required<string>();

  protected readonly event = signal<EventDetail | null>(null);
  protected readonly members = signal<Member[]>([]);
  protected readonly membersUnavailable = signal(false);
  protected readonly announcements = signal<Announcement[]>([]);
  protected readonly annCursor = signal<string | null>(null);
  protected readonly annLoading = signal(false);
  protected readonly loading = signal(true);
  protected readonly error = signal<unknown>(null);
  protected readonly leaving = signal(false);
  /** Server clock minus device clock, from the last GameClock payload. */
  protected readonly serverOffset = signal(0);

  protected readonly offline = computed(() => {
    const e = this.error();
    return !!e && !!this.event() && ApiError.from(e).isNetwork;
  });
  protected readonly statusChip = computed(() => eventStatusChip(this.event()!.status));
  protected readonly modeLabel = computed(() => {
    const e = this.event();
    return e ? e.customModeName || GAME_MODE_LABELS[e.gameMode] : '';
  });
  protected readonly dateLabel = computed(() => formatDate(this.event()?.startAt));
  protected readonly timeLabel = computed(() => `${formatTime(this.event()?.startAt)}–${formatTime(this.event()?.endAt)}`);
  protected readonly preGame = computed(() => {
    const s = this.event()?.status;
    return s === 'draft' || s === 'published' || s === 'registration_open' || s === 'lobby';
  });
  protected readonly selfId = computed(() => this.auth.user()?.id ?? this.event()?.me?.userId ?? null);
  protected readonly myTeamId = computed(() => this.event()?.me?.teamId ?? this.event()?.myTeamId ?? null);
  private readonly approvedPlayers = computed(() => this.members().filter((m) => m.status === 'approved' && m.role === 'player'));
  protected readonly playerCount = computed(() => (this.membersUnavailable() ? (this.event()?.approvedCount ?? 0) : this.approvedPlayers().length));
  protected readonly readyCount = computed(() => this.approvedPlayers().filter((m) => m.ready).length);
  protected readonly startOverdue = computed(() => {
    const e = this.event();
    return !!e && this.preGame() && new Date(e.startAt).getTime() < this.now() + this.serverOffset() - 60_000;
  });

  private readonly now = nowSignal(15_000);
  private requestId = 0;
  private redirected = false;
  private pendingScopes = new Set<InvalidateScope>();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
    });
    // Load and join the event's realtime rooms; leave them when the id changes or the screen closes.
    effect((onCleanup) => {
      const id = this.eventId();
      untracked(() => {
        this.event.set(null);
        this.members.set([]);
        this.announcements.set([]);
        this.redirected = false;
        void this.loadAll();
        void this.realtime.subscribe(id);
      });
      onCleanup(() => this.realtime.unsubscribe(id));
    });

    // After a reconnect we may have missed pushes: refetch everything once.
    let wasConnected: boolean | null = null;
    effect(() => {
      const connected = this.realtime.connected();
      untracked(() => {
        if (wasConnected === false && connected && this.event()) this.refresh(['event', 'members']);
        wasConnected = connected;
      });
    });

    this.realtime
      .on('invalidate')
      .pipe(takeUntilDestroyed())
      .subscribe((p) => {
        if (p.eventId === this.eventId()) this.refresh(p.scopes);
      });
    this.realtime
      .on('clock')
      .pipe(takeUntilDestroyed())
      .subscribe((p) => {
        if (p.eventId !== this.eventId()) return;
        this.serverOffset.set(new Date(p.clock.serverNow).getTime() - Date.now());
        this.event.update((e) => (e ? { ...e, status: p.clock.status, clock: p.clock } : e));
        this.checkLive(true);
      });
    this.realtime
      .on('announcement')
      .pipe(takeUntilDestroyed())
      .subscribe((p) => {
        if (p.eventId === this.eventId()) this.addAnnouncement(p.announcement);
      });
    this.realtime
      .on('teams')
      .pipe(takeUntilDestroyed())
      .subscribe((p) => {
        if (p.eventId !== this.eventId()) return;
        this.event.update((e) => (e ? { ...e, teams: e.teams.map((t) => p.teams.find((x) => x.id === t.id) ?? t) } : e));
      });
    this.realtime
      .on('kicked')
      .pipe(takeUntilDestroyed())
      .subscribe((p) => {
        if (p.eventId !== this.eventId()) return;
        this.toast.warning($localize`You were removed from this event`, p.reason || undefined);
        void this.router.navigate(['/events', p.eventId], { replaceUrl: true });
      });
  }

  async loadAll(): Promise<void> {
    const id = this.eventId();
    const req = ++this.requestId;
    this.loading.set(true);
    try {
      const [event, members, anns] = await Promise.all([
        this.api.event(id),
        this.api.members(id).catch((err: unknown) => ({ failed: err })),
        this.api.announcements(id).catch(() => null),
      ]);
      if (req !== this.requestId) return;
      if (!this.allowed(event)) return;
      this.applyEvent(event);
      if (Array.isArray(members)) {
        this.members.set(members);
        this.membersUnavailable.set(false);
      } else {
        // Players may not be allowed to list members; show counts only.
        this.membersUnavailable.set(true);
      }
      if (anns) {
        this.announcements.set(anns.items);
        this.annCursor.set(anns.nextCursor);
      }
      this.error.set(null);
      this.checkLive(false);
    } catch (err) {
      if (req === this.requestId) this.error.set(err);
    } finally {
      if (req === this.requestId) this.loading.set(false);
    }
  }

  /** Coalesce invalidations into one refetch per scope group. */
  protected refresh(scopes: readonly InvalidateScope[]): void {
    for (const s of scopes) this.pendingScopes.add(s);
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      const set = this.pendingScopes;
      this.pendingScopes = new Set();
      if (set.has('event') || set.has('me') || set.has('squads') || set.has('members')) void this.reloadEvent();
      if (set.has('members')) void this.reloadMembers();
    }, 250);
  }

  private async reloadEvent(): Promise<void> {
    try {
      const e = await this.api.event(this.eventId());
      if (!this.allowed(e)) return;
      this.applyEvent(e);
      this.error.set(null);
      this.checkLive(true);
    } catch (err) {
      this.error.set(err);
    }
  }

  private async reloadMembers(): Promise<void> {
    if (this.membersUnavailable()) return;
    try {
      this.members.set(await this.api.members(this.eventId()));
    } catch {
      /* keep the last list */
    }
  }

  protected async loadOlderAnnouncements(): Promise<void> {
    const cursor = this.annCursor();
    if (!cursor) return;
    this.annLoading.set(true);
    try {
      const page = await this.api.announcements(this.eventId(), cursor);
      const seen = new Set(this.announcements().map((a) => a.id));
      this.announcements.update((list) => [...list, ...page.items.filter((a) => !seen.has(a.id))]);
      this.annCursor.set(page.nextCursor);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.annLoading.set(false);
    }
  }

  protected addAnnouncement(a: Announcement): void {
    this.announcements.update((list) => (list.some((x) => x.id === a.id) ? list : [a, ...list]));
  }

  protected onEventChange(e: EventDetail): void {
    this.applyEvent(e);
    this.checkLive(true);
  }

  protected onMemberChange(m: Member): void {
    const previousTeam = this.myTeamId();
    this.event.update((e) => (e ? { ...e, me: m, myTeamId: m.teamId } : e));
    this.members.update((list) => (list.some((x) => x.userId === m.userId) ? list.map((x) => (x.userId === m.userId ? m : x)) : list));
    // Team counts change when a player picks a team.
    if (m.teamId !== previousTeam) this.refresh(['event', 'members']);
  }

  protected async leave(): Promise<void> {
    const e = this.event();
    if (!e) return;
    const team = e.teams.find((t) => t.id === this.myTeamId());
    const ok = await this.confirm.ask({
      title: $localize`Leave ${e.name}:name:?`,
      consequences: [
        team ? $localize`You give up your place in ${team.name}:name:.` : $localize`You give up your place in this event.`,
        $localize`Your location will not be tracked for this event.`,
        e.requiresApproval ? $localize`Coming back needs a new request and Game Master approval.` : $localize`You can join again while registration is open.`,
      ],
      confirmLabel: $localize`Leave event`,
      destructive: true,
    });
    if (!ok) return;
    this.leaving.set(true);
    try {
      await this.api.leaveEvent(e.id);
      if (this.tracker.eventId() === e.id) this.tracker.stop();
      this.toast.info($localize`You left ${e.name}:name:`);
      void this.router.navigate(['/events/mine']);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.leaving.set(false);
    }
  }

  private applyEvent(e: EventDetail): void {
    this.event.set(e);
    this.serverOffset.set(new Date(e.clock.serverNow).getTime() - Date.now());
  }

  /** Players who are not (or no longer) approved members go back to the event page. */
  private allowed(e: EventDetail): boolean {
    if (e.isGm || e.me?.status === 'approved') return true;
    if (!this.redirected) {
      this.redirected = true;
      this.toast.info(e.me?.status === 'pending' ? $localize`Your registration is waiting for approval` : $localize`Join the event to enter the lobby`);
      void this.router.navigate(['/events', e.id], { replaceUrl: true });
    }
    return false;
  }

  /** Approved players with a team go to the live map as soon as the game starts. */
  private checkLive(announce: boolean): void {
    const e = this.event();
    if (!e || e.isGm || this.redirected) return;
    if (e.status !== 'live' || e.me?.status !== 'approved' || !this.myTeamId()) return;
    this.redirected = true;
    if (announce) this.toast.success($localize`The game has started`, $localize`Opening the live map.`);
    void this.router.navigate(['/events', e.id, 'live']);
  }
}
