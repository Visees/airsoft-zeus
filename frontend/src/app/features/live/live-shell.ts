import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { LiveStore } from '../../core/live/live-store';
import { LocationTracker } from '../../core/location/location-tracker.service';
import { ConnectivityService } from '../../core/net/connectivity.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { ThemeService } from '../../core/theme/theme.service';
import { ToastService } from '../../core/ui/toast.service';
import { formatTime } from '../../core/util/format';
import { AnnouncementBanner } from '../../shared/announcement-banner';
import { CurrencyDisplay } from '../../shared/currency-display';
import { GameTimer } from '../../shared/game-timer';
import { ConnectionStatus, GpsStatus } from '../../shared/link-status';
import { ScoreDisplay } from '../../shared/score-display';
import { ErrorState, LoadingSkeleton } from '../../shared/states';
import { StatusChip, eventStatusChip } from '../../shared/status-chip';
import { TeamBadge } from '../../shared/team-badge';
import { TeamSwatch } from '../../shared/team-swatch';
import { LiveSession } from './live-session';
import { LiveSheet } from './live-sheet';
import { liveLink, sharingAudience } from './live-util';

interface NavItem {
  label: string;
  icon: string;
  link: string[];
  exact: boolean;
  badge: number;
  badgeLabel: string;
}

type SharingAction = 'sheet' | 'more' | null;

interface SharingIndicator {
  label: string;
  glyph: string;
  tone: string;
  action: SharingAction;
}

/**
 * Parent of every live screen: HUD strip, bottom navigation, banners, consent and
 * permission sheet, end-of-game panel. Owns the GPS tracker lifecycle for the event.
 */
@Component({
  selector: 'zeus-live-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    NgIcon,
    HlmButton,
    GameTimer,
    ScoreDisplay,
    CurrencyDisplay,
    TeamSwatch,
    TeamBadge,
    GpsStatus,
    ConnectionStatus,
    AnnouncementBanner,
    LoadingSkeleton,
    ErrorState,
    StatusChip,
    LiveSheet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-dvh flex-col overflow-hidden bg-background text-foreground' },
  styles: `
    .nav-item {
      position: relative;
      display: flex;
      height: 100%;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
      color: var(--muted-foreground);
      transition: color 120ms ease-out;
    }
    .nav-item:hover {
      color: var(--foreground);
    }
    .nav-item.is-active {
      color: var(--primary);
    }
    .nav-item.is-active::before {
      content: '';
      position: absolute;
      inset-inline: 22%;
      top: 0;
      height: 3px;
      border-radius: 0 0 2px 2px;
      background: var(--primary);
    }
    .nav-item:focus-visible {
      outline-offset: -3px;
    }
  `,
  template: `
    @if (!store.event()) {
      @if (store.loading()) {
        <div class="flex flex-1 items-center justify-center p-6">
          <div class="w-full max-w-md">
            <p class="label-caps mb-3">Joining the game…</p>
            <zeus-loading-skeleton [rows]="4" />
          </div>
        </div>
      } @else {
        <div class="flex flex-1 items-center justify-center p-6">
          <div class="w-full max-w-md">
            <zeus-error-state [error]="store.error()" title="Could not load the game" (retry)="store.reload()">
              <a hlmBtn variant="ghost" class="tap" [routerLink]="['/events', eventId()]">Back to event</a>
            </zeus-error-state>
          </div>
        </div>
      }
    } @else {
      @let ev = store.event()!;
      <!-- HUD strip -->
      <header
        class="hud z-20 shrink-0 rounded-none border-x-0 border-t-0 pb-2"
        [style.padding-top]="'calc(var(--safe-top) + 0.5rem)'"
        [style.padding-left]="'max(0.75rem, env(safe-area-inset-left))'"
        [style.padding-right]="'max(0.75rem, env(safe-area-inset-right))'"
      >
        <h1 class="sr-only">{{ ev.name }} — live game</h1>
        <div class="flex items-center justify-between gap-3">
          <zeus-game-timer [clock]="store.clock()" [startAt]="ev.startAt" [serverOffsetMs]="store.serverOffsetMs()" size="md" />
          @if (store.myTeam(); as team) {
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex min-w-0 items-center gap-1.5">
                <zeus-team-swatch [color]="team.color" [pattern]="team.pattern" [size]="18" />
                <span class="hidden max-w-28 truncate text-sm font-bold sm:inline">{{ team.name }}</span>
                <span class="sr-only sm:hidden">{{ team.name }}</span>
              </span>
              <zeus-score-display [points]="team.points" size="md" [showUnit]="false" />
              @if (team.currency !== null) {
                <zeus-currency-display [amount]="team.currency" size="md" [showUnit]="false" />
              }
            </div>
          } @else if (store.isGm()) {
            <span class="rounded-sm bg-primary/15 px-1.5 py-0.5 text-xs font-bold text-primary">GAME MASTER</span>
          } @else {
            <span class="text-sm font-bold text-warning">○ No team</span>
          }
        </div>
        <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <zeus-gps-status [showTracking]="false" />
          <zeus-connection-status [compact]="true" [showSync]="false" />
          @if (sharing(); as s) {
            <button
              type="button"
              class="-my-2 inline-flex h-11 items-center gap-1 rounded-sm px-1.5 text-xs font-bold"
              [class]="s.tone"
              [disabled]="!s.action"
              (click)="onSharingTap(s.action)"
              [attr.aria-label]="'Location sharing: ' + s.label + (s.action ? '. Open options' : '')"
            >
              <span aria-hidden="true">{{ s.glyph }}</span>{{ s.label }}
            </button>
          }
          @if (status() === 'paused') {
            <zeus-status-chip [spec]="pausedChip" />
          }
        </div>
      </header>

      <div class="relative flex min-h-0 flex-1 flex-col">
        <main #liveMain id="live-main" class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <router-outlet (activate)="liveMain.scrollTop = 0" />
        </main>

        <!-- Top overlays: offline, announcement, GM prompt -->
        <div class="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2 p-2">
          @if (store.fromCache()) {
            <div class="pointer-events-auto flex items-center gap-3 rounded-md border border-warning bg-warning-surface px-3 py-2 shadow-lg" role="status">
              <ng-icon name="lucideWifiOff" size="18" class="shrink-0 text-warning" aria-hidden="true" />
              <p class="min-w-0 flex-1 text-sm font-semibold">
                Showing data saved at <span class="num">{{ cachedAtLabel() }}</span> — reconnecting
              </p>
              <button hlmBtn variant="outline" size="sm" class="tap shrink-0" type="button" (click)="store.reload()" [disabled]="store.loading()">
                {{ store.loading() ? 'Retrying…' : 'Retry' }}
              </button>
            </div>
          }
          @if (store.bannerAnnouncement(); as a) {
            <zeus-announcement-banner class="pointer-events-auto" [announcement]="a" (dismiss)="store.dismissBanner()" />
          }
          @if (showGmPrompt()) {
            <section class="panel pointer-events-auto p-4 shadow-lg" aria-labelledby="gm-prompt-title">
              <p class="label-caps">Game Master</p>
              <h2 id="gm-prompt-title" class="text-lg uppercase">You are not on a team</h2>
              <p class="mt-1 text-sm text-muted-foreground">
                The player view shows what a team member sees. To run the game, open the control center.
              </p>
              <div class="mt-3 flex flex-col gap-2 sm:flex-row">
                <a hlmBtn class="h-12 flex-1" [routerLink]="['/gm/events', eventId(), 'control']">
                  <ng-icon name="lucideLayoutDashboard" size="18" aria-hidden="true" /> Open control center
                </a>
                <button hlmBtn variant="outline" class="h-12 flex-1" type="button" (click)="gmPromptDismissed.set(true)">Stay in player view</button>
              </div>
            </section>
          }
        </div>

        <!-- End of game -->
        @if (ended() && !endDismissed()) {
          <div class="absolute inset-x-0 bottom-0 z-30 p-2" aria-live="polite">
            <section class="panel mx-auto w-full max-w-md p-5 shadow-2xl" aria-labelledby="end-title">
              <p class="label-caps">{{ status() === 'cancelled' ? 'Cancelled' : 'Game over' }}</p>
              <h2 id="end-title" class="text-2xl uppercase">{{ status() === 'cancelled' ? 'The game was cancelled' : 'The game has ended' }}</h2>
              @if (winner(); as w) {
                <p class="mt-2 flex flex-wrap items-center gap-2">
                  <span class="label-caps">Winner</span>
                  <zeus-team-badge [team]="w" size="lg" />
                </p>
              }
              @if (store.myTeam(); as team) {
                <p class="mt-2 text-sm">
                  Your team finished with <span class="num font-bold">{{ team.points }}</span> points.
                </p>
              }
              <p class="mt-2 text-sm text-muted-foreground">Location sharing has stopped.</p>
              <div class="mt-4 flex flex-col gap-2">
                <a hlmBtn class="h-12" [routerLink]="['/events', eventId(), 'results']">
                  <ng-icon name="lucideTrophy" size="18" aria-hidden="true" /> View results
                </a>
                <button hlmBtn variant="outline" class="h-12" type="button" (click)="endDismissed.set(true)">Keep viewing the map</button>
              </div>
            </section>
          </div>
        }
      </div>

      <!-- Bottom navigation -->
      <nav class="z-20 shrink-0 border-t border-border bg-card" aria-label="Game sections" [style.padding-bottom]="'var(--safe-bottom)'">
        <ul class="mx-auto flex h-16 max-w-3xl">
          @for (item of navItems(); track item.label) {
            <li class="min-w-0 flex-1">
              <a
                class="nav-item"
                [routerLink]="item.link"
                routerLinkActive="is-active"
                [routerLinkActiveOptions]="{ exact: item.exact }"
                ariaCurrentWhenActive="page"
              >
                <span class="relative">
                  <ng-icon [name]="item.icon" size="24" aria-hidden="true" />
                  @if (item.badge > 0) {
                    <span
                      class="num absolute -top-1.5 -right-3 grid h-5 min-w-5 place-items-center rounded-full bg-warning px-1 text-[0.7rem] font-bold text-warning-foreground"
                      aria-hidden="true"
                      >{{ item.badge > 99 ? '99+' : item.badge }}</span
                    >
                  }
                </span>
                <span class="text-xs font-bold tracking-wide">{{ item.label }}</span>
                @if (item.badge > 0) {
                  <span class="sr-only">, {{ item.badge }} {{ item.badgeLabel }}</span>
                }
              </a>
            </li>
          }
        </ul>
      </nav>

      <!-- Consent / permission sheet -->
      <zeus-live-sheet
        [open]="session.sheetOpen()"
        [heading]="sheetMode() === 'consent' ? 'Share your location?' : sheetMode() === 'denied' ? 'Location is blocked' : 'GPS not available'"
        eyebrow="Location sharing"
        (closed)="closeSheet()"
      >
        @switch (sheetMode()) {
          @case ('consent') {
            <div class="flex flex-col gap-3 text-sm">
              <p>While this game runs, the app sends your GPS position to the server so the game can work.</p>
              <ul class="flex flex-col gap-2 rounded-sm border border-border bg-muted p-3">
                <li class="flex gap-2">
                  <span class="text-nav" aria-hidden="true">▸</span>
                  <span>
                    <strong>What:</strong> your position and its accuracy, about every
                    <span class="num">{{ ev.tracking.intervalSec }}</span> s, only while the game is live.
                  </span>
                </li>
                @for (line of audience(); track $index) {
                  <li class="flex gap-2"><span class="text-nav" aria-hidden="true">▸</span><span>{{ line }}</span></li>
                }
                <li class="flex gap-2">
                  <span class="text-nav" aria-hidden="true">▸</span>
                  <span>
                    <strong>Stops</strong> when you leave the live screens, when the game ends, or when you tap “Stop sharing” in More.
                    @if (ev.tracking.keepHistory) {
                      Your track is kept for <span class="num">{{ ev.tracking.retentionDays }}</span> days.
                    } @else {
                      No track history is kept.
                    }
                  </span>
                </li>
              </ul>
              <p class="text-muted-foreground">
                Without it you can still play, but objectives you capture by holding a zone will not count your presence. The app keeps the
                screen awake while sharing.
              </p>
              <div class="flex flex-col gap-2">
                <button hlmBtn type="button" class="h-12" (click)="shareLocation()" [disabled]="consentSaving()">
                  <ng-icon name="lucideLocateFixed" size="18" aria-hidden="true" />
                  {{ consentSaving() ? 'Saving…' : 'Share my location' }}
                </button>
                <button hlmBtn variant="outline" type="button" class="h-12" (click)="declineSharing()" [disabled]="consentSaving()">Not now</button>
              </div>
            </div>
          }
          @case ('denied') {
            <div class="flex flex-col gap-3 text-sm">
              <p>Your browser is blocking location for this site, so your team and the Game Master cannot see you and zone captures will not count you.</p>
              <ol class="flex list-decimal flex-col gap-1.5 rounded-sm border border-border bg-muted p-3 pl-7">
                <li>Tap the lock or settings icon next to the address bar (or open the app's site settings).</li>
                <li>Set <strong>Location</strong> to <strong>Allow</strong>.</li>
                <li>On Android also check that Location is on in quick settings; on iPhone check Settings → Privacy → Location Services → your browser.</li>
                <li>Come back here and tap “Try again”.</li>
              </ol>
              <div class="flex flex-col gap-2">
                <button hlmBtn type="button" class="h-12" (click)="retryGps()">
                  <ng-icon name="lucideRefreshCw" size="18" aria-hidden="true" /> Try again
                </button>
                <button hlmBtn variant="outline" type="button" class="h-12" (click)="closeSheet()">Close</button>
              </div>
            </div>
          }
          @default {
            <div class="flex flex-col gap-3 text-sm">
              <p>This device or browser does not provide GPS. You can keep playing with codes and QR captures; zone captures need a phone with location.</p>
              <button hlmBtn variant="outline" type="button" class="h-12" (click)="closeSheet()">Close</button>
            </div>
          }
        }
      </zeus-live-sheet>
    }
  `,
})
export class LiveShell {
  readonly eventId = input.required<string>();

  protected readonly store = inject(LiveStore);
  protected readonly session = inject(LiveSession);
  private readonly tracker = inject(LocationTracker);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly theme = inject(ThemeService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly realtime = inject(RealtimeService);

  protected readonly pausedChip = eventStatusChip('paused');
  protected readonly gmPromptDismissed = signal(false);
  protected readonly endDismissed = signal(false);
  protected readonly consentSaving = signal(false);

  private redirected = false;
  private autoSheetShown = false;
  private deniedSheetShown = false;
  private lastReconnectReload = 0;

  protected readonly status = computed(() => this.store.clock()?.status ?? this.store.event()?.status ?? null);
  protected readonly running = computed(() => this.status() === 'live' || this.status() === 'paused');
  protected readonly ended = computed(() => this.status() === 'completed' || this.status() === 'cancelled');
  private readonly me = this.store.me;
  private readonly isMember = computed(() => this.me()?.status === 'approved');
  /** Only players share a position (the server rejects Game Master reports with tracking_not_allowed). */
  private readonly isPlayer = computed(() => this.isMember() && this.me()?.role === 'player');
  protected readonly consented = computed(() => !!this.me()?.trackingConsented || this.session.hasConsented(this.eventId()));
  private readonly stoppedByUser = computed(() => this.session.isStopped(this.eventId()));

  /** Run the GPS tracker: game running, approved member, consent given, not stopped by the player. */
  private readonly wantsTracking = computed(
    () => this.running() && this.isPlayer() && this.consented() && !this.stoppedByUser(),
  );

  protected readonly showGmPrompt = computed(
    () => this.store.isGm() && !this.me()?.teamId && !this.gmPromptDismissed() && !this.ended(),
  );

  protected readonly winner = computed(() => {
    const id = this.store.event()?.winnerTeamId;
    return id ? (this.store.teamById().get(id) ?? null) : null;
  });

  protected readonly cachedAtLabel = computed(() => {
    const at = this.store.cachedAt();
    return at ? formatTime(new Date(at).toISOString()) : '—';
  });

  protected readonly audience = computed(() => {
    const rules = this.store.event()?.visibilityRules;
    return rules ? sharingAudience(rules) : [];
  });

  protected readonly sheetMode = computed<'consent' | 'denied' | 'unavailable'>(() => {
    if (!this.consented()) return 'consent';
    const s = this.tracker.state();
    if (s === 'denied') return 'denied';
    if (s === 'unavailable') return 'unavailable';
    return 'consent';
  });

  protected readonly sharing = computed<SharingIndicator | null>(() => {
    if (!this.isPlayer() || this.ended()) return null;
    const mine = this.tracker.eventId() === this.eventId();
    const state = this.tracker.state();
    if (!this.consented()) return { label: 'Not sharing', glyph: '○', tone: 'border border-warning/60 text-warning', action: 'sheet' };
    if (this.stoppedByUser()) return { label: 'Sharing off', glyph: '○', tone: 'border border-warning/60 text-warning', action: 'more' };
    if (state === 'denied') return { label: 'Location blocked', glyph: '✕', tone: 'border border-destructive/60 text-destructive', action: 'sheet' };
    if (state === 'unavailable') return { label: 'No GPS', glyph: '✕', tone: 'border border-destructive/60 text-destructive', action: 'sheet' };
    if (!this.running()) return { label: 'Sharing at start', glyph: '◌', tone: 'text-muted-foreground', action: 'more' };
    if (mine && state === 'tracking') return { label: 'Sharing location', glyph: '●', tone: 'bg-nav/15 text-nav', action: 'more' };
    if (mine && state === 'paused') return { label: 'Sharing paused', glyph: '❚❚', tone: 'text-warning', action: 'more' };
    if (mine && state === 'error') return { label: 'GPS problem', glyph: '◐', tone: 'text-warning', action: 'more' };
    return { label: 'Starting GPS', glyph: '◐', tone: 'text-warning', action: 'more' };
  });

  protected readonly navItems = computed<NavItem[]>(() => {
    const id = this.eventId();
    const available = this.store.objectives().filter((o) => o.status === 'active' && o.canCapture).length;
    const teamId = this.me()?.teamId;
    const ready = this.store.purchases().filter((p) => p.status === 'ready' && p.teamId === teamId).length;
    return [
      { label: 'Map', icon: 'lucideMap', link: liveLink(id), exact: true, badge: 0, badgeLabel: '' },
      { label: 'Objectives', icon: 'lucideCrosshair', link: liveLink(id, 'objectives'), exact: false, badge: available, badgeLabel: 'available' },
      { label: 'Team', icon: 'lucideUsers', link: liveLink(id, 'team'), exact: false, badge: 0, badgeLabel: '' },
      { label: 'Store', icon: 'lucideStore', link: liveLink(id, 'store'), exact: false, badge: ready, badgeLabel: 'ready to activate' },
      { label: 'More', icon: 'lucideEllipsis', link: liveLink(id, 'more'), exact: false, badge: 0, badgeLabel: '' },
    ];
  });

  constructor() {
    this.theme.setLiveMode(true);
    const destroyRef = inject(DestroyRef);

    // Load (and reload if the route is reused for another event).
    effect(() => {
      const id = this.eventId();
      untracked(() => {
        this.redirected = false;
        this.autoSheetShown = false;
        this.endDismissed.set(false);
        void this.store.load(id);
      });
    });

    // Only approved members (and Game Masters) play.
    effect(() => {
      const ev = this.store.event();
      if (!ev || this.store.loading() || this.redirected) return;
      if (!ev.isGm && ev.me?.status !== 'approved') {
        this.redirected = true;
        untracked(() => {
          this.toast.warning('You are not a confirmed player of this event');
          void this.router.navigate(['/events', this.eventId()]);
        });
      }
    });

    // GPS tracker lifecycle.
    effect(() => {
      const id = this.eventId();
      const want = this.wantsTracking();
      const settings = this.store.event()?.tracking;
      const ended = this.ended();
      untracked(() => {
        if (want && settings) {
          if (this.tracker.state() !== 'denied') this.tracker.start(id, settings);
        } else if (ended && this.tracker.eventId() === id) {
          this.tracker.stop(false);
        }
      });
    });

    // Ask for consent once per visit while the game runs.
    effect(() => {
      const ask = this.running() && this.isPlayer() && !this.consented() && !this.session.hasDeclined(this.eventId());
      if (ask && !this.autoSheetShown) {
        this.autoSheetShown = true;
        untracked(() => this.session.sheetOpen.set(true));
      }
    });

    // Permission denied while we want to track: show the instructions once.
    effect(() => {
      const denied = this.tracker.state() === 'denied';
      if (denied && this.wantsTracking() && !this.deniedSheetShown) {
        this.deniedSheetShown = true;
        untracked(() => this.session.sheetOpen.set(true));
      }
    });

    // Back online after starting from the offline cache: fetch a fresh snapshot.
    effect(() => {
      const online = this.connectivity.state() === 'online';
      if (online && this.store.fromCache() && !this.store.loading() && Date.now() - this.lastReconnectReload > 15_000) {
        this.lastReconnectReload = Date.now();
        untracked(() => void this.store.reload());
      }
    });

    this.realtime
      .on('kicked')
      .pipe(takeUntilDestroyed())
      .subscribe((p) => {
        if (p.eventId !== this.eventId()) return;
        if (this.tracker.eventId() === p.eventId) this.tracker.stop(false);
        this.toast.error('You were removed from this event', p.reason || undefined);
        void this.router.navigate(['/events', p.eventId]);
      });

    destroyRef.onDestroy(() => {
      this.theme.setLiveMode(false);
      this.session.sheetOpen.set(false);
      // Leaving the live screens means not playing: stop sharing and tell the server.
      const id = this.tracker.eventId();
      if (id && id === this.store.eventId()) this.tracker.stop(true);
    });
  }

  protected onSharingTap(action: SharingAction): void {
    if (action === 'sheet') {
      this.session.sheetOpen.set(true);
    } else if (action === 'more') {
      void this.router.navigate(liveLink(this.eventId(), 'more'));
    }
  }

  protected closeSheet(): void {
    if (this.sheetMode() === 'consent' && !this.consented()) this.session.setDeclined(this.eventId(), true);
    this.session.sheetOpen.set(false);
  }

  protected declineSharing(): void {
    this.session.setDeclined(this.eventId(), true);
    this.session.sheetOpen.set(false);
    this.toast.info('Location not shared', 'Tap “Not sharing” at the top to change your mind.');
  }

  protected async shareLocation(): Promise<void> {
    const id = this.eventId();
    this.consentSaving.set(true);
    try {
      const [member] = await Promise.all([
        this.api.updateMyMembership(id, { trackingConsent: true }),
        this.api.recordConsent('tracking', true, undefined, id),
      ]);
      this.store.event.update((e) => (e ? { ...e, me: member } : e));
      this.session.markConsented(id);
      this.session.setDeclined(id, false);
      this.session.setStopped(id, false);
      this.session.sheetOpen.set(false);
      this.store.refresh('me', 'members');
      this.toast.success('Sharing your location while the game runs');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.consentSaving.set(false);
    }
  }

  protected retryGps(): void {
    const settings = this.store.event()?.tracking;
    this.session.sheetOpen.set(false);
    this.deniedSheetShown = false;
    if (settings) this.tracker.start(this.eventId(), settings);
  }
}
