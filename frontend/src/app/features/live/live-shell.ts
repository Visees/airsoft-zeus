import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { LiveStore } from '../../core/live/live-store';
import { PlayerViewService } from '../../core/live/player-view';
import { LocationTracker } from '../../core/location/location-tracker.service';
import { isNativeApp, setImmersive } from '../../core/native/native-app';
import { ConnectivityService } from '../../core/net/connectivity.service';
import { KeepAliveRouteStrategy, LIVE_MAP_KEEP_ALIVE } from '../../core/routing/keep-alive-route-strategy';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { ThemeService } from '../../core/theme/theme.service';
import { ToastService } from '../../core/ui/toast.service';
import { formatTime } from '../../core/util/format';
import { playsIn } from '../../core/util/members';
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
  selector: 'ah-live-shell',
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
  // Phone held sideways (compact:): the tab bar becomes a rail on the left and the HUD one line.
  host: { class: 'flex h-dvh flex-col overflow-hidden bg-background text-foreground compact:grid compact:grid-cols-[auto_1fr] compact:grid-rows-[auto_1fr]' },
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
    @media (orientation: landscape) and (max-height: 500px) {
      .nav-item.is-active::before {
        inset-inline: auto;
        inset-block: 22%;
        left: 0;
        width: 3px;
        height: auto;
        border-radius: 0 2px 2px 0;
      }
    }
  `,
  template: `
    @if (!store.event()) {
      @if (store.loading()) {
        <div class="flex flex-1 items-center justify-center p-6 compact:col-span-2 compact:row-span-2">
          <div class="w-full max-w-md">
            <p class="label-caps mb-3" i18n>Joining the game…</p>
            <ah-loading-skeleton [rows]="4" />
          </div>
        </div>
      } @else {
        <div class="flex flex-1 items-center justify-center p-6 compact:col-span-2 compact:row-span-2">
          <div class="w-full max-w-md">
            <ah-error-state [error]="store.error()" title="Could not load the game" (retry)="store.reload()" i18n-title>
              <a hlmBtn variant="ghost" class="tap" [routerLink]="['/events', eventId()]" i18n>Back to event</a>
            </ah-error-state>
          </div>
        </div>
      }
    } @else {
      @let ev = store.event()!;
      <!-- HUD strip -->
      <header
        class="hud z-20 shrink-0 rounded-none border-x-0 border-t-0 pb-2 compact:col-start-2 compact:row-start-1 compact:pb-1"
        [class.hidden]="session.mapOnly()"
        [style.padding-top]="'calc(var(--safe-top) + 0.5rem)'"
        [style.padding-left]="'max(0.75rem, env(safe-area-inset-left))'"
        [style.padding-right]="'max(0.75rem, env(safe-area-inset-right))'"
      >
        <h1 class="sr-only" i18n>{{ ev.name }} — live game</h1>
        <!-- Compact: one line, timer · GPS and sharing · team, the first row's children joining the line -->
        <div class="flex flex-col compact:flex-row compact:items-center compact:gap-3">
        <div class="flex items-center justify-between gap-3 compact:contents">
          <div class="flex min-w-0 items-center gap-1 compact:order-1">
            <a [routerLink]="backLink()" class="tap -my-2 -ml-2 grid shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground compact:my-0 compact:size-8 compact:min-h-8 compact:min-w-8" aria-label="Back to event" i18n-aria-label>
              <ng-icon name="lucideArrowLeft" size="20" aria-hidden="true" />
            </a>
            <ah-game-timer [clock]="store.clock()" [startAt]="ev.startAt" [serverOffsetMs]="store.serverOffsetMs()" size="md" [stacked]="true" />
          </div>
          @if (store.isGm()) {
            <span class="rounded-sm bg-primary/15 px-1.5 py-0.5 text-xs font-bold text-primary compact:order-3" i18n>GAME MASTER</span>
          } @else if (store.myTeam(); as team) {
            <div class="flex min-w-0 items-center gap-3 compact:order-3">
              <span class="flex min-w-0 items-center gap-1.5">
                <ah-team-swatch [color]="team.color" [pattern]="team.pattern" [size]="18" />
                <span class="hidden max-w-28 truncate text-sm font-bold sm:inline">{{ team.name }}</span>
                <span class="sr-only sm:hidden">{{ team.name }}</span>
              </span>
              <ah-score-display [points]="team.points" size="md" [showUnit]="false" />
              @if (team.currency !== null) {
                <ah-currency-display [amount]="team.currency" size="md" [showUnit]="false" />
              }
            </div>
          } @else {
            <span class="text-sm font-bold text-warning compact:order-3" i18n>○ No team</span>
          }
        </div>
        <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 compact:order-2 compact:mt-0 compact:min-w-0 compact:flex-1">
          <ah-gps-status [showTracking]="false" />
          <ah-connection-status [compact]="true" [showSync]="false" />
          @if (sharing(); as s) {
            <button
              type="button"
              class="-my-2 inline-flex h-11 items-center rounded-sm text-xs font-bold compact:my-0 compact:h-8"
              [disabled]="!s.action"
              (click)="onSharingTap(s.action)"
              ariaLabel="Location sharing: {{ s.label }}{{ s.action ? txt.openOptions : '' }}" i18n-ariaLabel
            >
              <!-- The tone (border, fill) sits on the chip, the button around it is the 44px tap area -->
              <span class="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5" [class]="s.tone"><span aria-hidden="true">{{ s.glyph }}</span>{{ s.label }}</span>
            </button>
          }
          @if (status() === 'paused') {
            <ah-status-chip [spec]="pausedChip" />
          }
        </div>
        </div>
      </header>

      <div class="relative flex min-h-0 flex-1 flex-col compact:col-start-2 compact:row-start-2">
        <main #liveMain id="live-main" class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <router-outlet (activate)="liveMain.scrollTop = 0" />
        </main>

        <!-- Top overlays: offline, announcement, GM prompt -->
        <div class="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2 p-2">
          @if (store.fromCache()) {
            <div class="pointer-events-auto flex items-center gap-3 rounded-md border border-warning bg-warning-surface px-3 py-2 shadow-lg" role="status">
              <ng-icon name="lucideWifiOff" size="18" class="shrink-0 text-warning" aria-hidden="true" />
              <p class="min-w-0 flex-1 text-sm font-semibold" i18n>
                Showing data saved at <span class="num">{{ cachedAtLabel() }}</span> — reconnecting
              </p>
              <button hlmBtn variant="outline" size="sm" class="tap shrink-0" type="button" (click)="store.reload()" [disabled]="store.loading()">
                {{ store.loading() ? txt.retrying : txt.retry }}
              </button>
            </div>
          }
          @if (store.bannerAnnouncement(); as a) {
            <ah-announcement-banner class="pointer-events-auto" [announcement]="a" (dismiss)="store.dismissBanner()" />
          }
          @if (showGmPrompt()) {
            <section class="panel pointer-events-auto p-4 shadow-lg" aria-labelledby="gm-prompt-title">
              <p class="label-caps" i18n>Game Master</p>
              <h2 id="gm-prompt-title" class="text-lg uppercase" i18n>You are not on a team</h2>
              <p class="mt-1 text-sm text-muted-foreground" i18n>
                To run the game, open the control center. To play, join a team from the event lobby: this view then shows only
                what your team sees.
              </p>
              <div class="mt-3 flex flex-col gap-2 sm:flex-row">
                <a hlmBtn class="h-12 sm:flex-1" [routerLink]="['/gm/events', eventId(), 'control']">
                  <ng-icon name="lucideLayoutDashboard" size="18" aria-hidden="true" /> <ng-container i18n>Open control center</ng-container>
                </a>
                <button hlmBtn variant="outline" class="h-12 sm:flex-1" type="button" (click)="gmPromptDismissed.set(true)" i18n>Stay in player view</button>
              </div>
            </section>
          }
        </div>

        <!-- End of game -->
        @if (ended() && !endDismissed()) {
          <div class="absolute inset-x-0 bottom-0 z-30 p-2" aria-live="polite">
            <section class="panel mx-auto w-full max-w-md p-5 shadow-2xl" aria-labelledby="end-title">
              <p class="label-caps">{{ status() === 'cancelled' ? txt.cancelled : txt.gameOver }}</p>
              <h2 id="end-title" class="text-2xl uppercase">{{ status() === 'cancelled' ? txt.theGameWasCancelled : txt.theGameHasEnded }}</h2>
              @if (winner(); as w) {
                <p class="mt-2 flex flex-wrap items-center gap-2">
                  <span class="label-caps" i18n>Winner</span>
                  <ah-team-badge [team]="w" size="lg" />
                </p>
              }
              @if (store.myTeam(); as team) {
                <p class="mt-2 text-sm" i18n>
                  Your team finished with <span class="num font-bold">{{ team.points }}</span> points.
                </p>
              }
              <p class="mt-2 text-sm text-muted-foreground" i18n>Location sharing has stopped.</p>
              <div class="mt-4 flex flex-col gap-2">
                <a hlmBtn class="h-12" [routerLink]="['/events', eventId(), 'results']">
                  <ng-icon name="lucideTrophy" size="18" aria-hidden="true" /> <ng-container i18n>View results</ng-container>
                </a>
                <button hlmBtn variant="outline" class="h-12" type="button" (click)="endDismissed.set(true)" i18n>Keep viewing the map</button>
              </div>
            </section>
          </div>
        }
      </div>

      <!-- Bottom navigation -->
      <nav
        class="z-20 shrink-0 border-t border-border bg-card compact:col-start-1 compact:row-span-2 compact:row-start-1 compact:border-t-0 compact:border-r compact:pl-[env(safe-area-inset-left)]"
        [class.hidden]="session.mapOnly()"
        aria-label="Game sections"
        [style.padding-bottom]="'var(--safe-bottom)'"
        i18n-aria-label
      >
        <ul class="mx-auto flex h-16 max-w-3xl compact:h-full compact:w-14 compact:flex-col">
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
                <span class="text-xs font-bold tracking-wide compact:sr-only">{{ item.label }}</span>
                @if (item.badge > 0) {
                  <span class="sr-only">, {{ item.badge }} {{ item.badgeLabel }}</span>
                }
              </a>
            </li>
          }
        </ul>
      </nav>

      <!-- Consent / permission sheet -->
      <ah-live-sheet
        [open]="session.sheetOpen()"
        [heading]="sheetMode() === 'consent' ? txt.shareYourLocation : sheetMode() === 'denied' ? txt.locationIsBlocked : txt.gpsNotAvailable"
        eyebrow="Location sharing"
        (closed)="closeSheet()" i18n-eyebrow
      >
        @switch (sheetMode()) {
          @case ('consent') {
            <div class="flex flex-col gap-3 text-sm">
              <p i18n>While this game runs, the app sends your GPS position to the server so the game can work.</p>
              <ul class="flex flex-col gap-2 rounded-sm border border-border bg-muted p-3">
                <li class="flex gap-2">
                  <span class="text-nav" aria-hidden="true">▸</span>
                  <span i18n>
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
                    <ng-container i18n><strong>Stops</strong> when you leave the live screens, when the game ends, or when you tap “Stop sharing” in More.</ng-container>
                    @if (ev.tracking.keepHistory) {
                      <ng-container i18n>Your track is kept for <span class="num">{{ ev.tracking.retentionDays }}</span> days.</ng-container>
                    } @else {
                      <ng-container i18n>No track history is kept.</ng-container>
                    }
                  </span>
                </li>
              </ul>
              <p class="text-muted-foreground">
                <ng-container i18n>Without it you can still play, but objectives you capture by holding a zone will not count your presence.</ng-container>
                @if (tracker.native && ev.tracking.background) {
                  <ng-container i18n>Sharing continues with the screen off; a notification shows while it runs.</ng-container>
                } @else {
                  <ng-container i18n>The app keeps the screen awake while sharing.</ng-container>
                }
              </p>
              <div class="flex flex-col gap-2">
                <button hlmBtn type="button" class="h-12" (click)="shareLocation()" [disabled]="consentSaving()">
                  <ng-icon name="lucideLocateFixed" size="18" aria-hidden="true" />
                  {{ consentSaving() ? txt.saving : txt.shareMyLocation }}
                </button>
                <button hlmBtn variant="outline" type="button" class="h-12" (click)="declineSharing()" [disabled]="consentSaving()" i18n>Not now</button>
              </div>
            </div>
          }
          @case ('denied') {
            <div class="flex flex-col gap-3 text-sm">
              <p i18n>Your browser is blocking location for this site, so your team and the Game Master cannot see you and zone captures will not count you.</p>
              <ol class="flex list-decimal flex-col gap-1.5 rounded-sm border border-border bg-muted p-3 pl-7">
                <li i18n>Tap the lock or settings icon next to the address bar (or open the app's site settings).</li>
                <li i18n>Set <strong>Location</strong> to <strong>Allow</strong>.</li>
                <li i18n>On Android also check that Location is on in quick settings; on iPhone check Settings → Privacy → Location Services → your browser.</li>
                <li i18n>Come back here and tap “Try again”.</li>
              </ol>
              <div class="flex flex-col gap-2">
                <button hlmBtn type="button" class="h-12" (click)="retryGps()">
                  <ng-icon name="lucideRefreshCw" size="18" aria-hidden="true" /> <ng-container i18n>Try again</ng-container>
                </button>
                <button hlmBtn variant="outline" type="button" class="h-12" (click)="closeSheet()" i18n>Close</button>
              </div>
            </div>
          }
          @default {
            <div class="flex flex-col gap-3 text-sm">
              <p i18n>This device or browser does not provide GPS. You can keep playing with codes and QR captures; zone captures need a phone with location.</p>
              <button hlmBtn variant="outline" type="button" class="h-12" (click)="closeSheet()" i18n>Close</button>
            </div>
          }
        }
      </ah-live-sheet>
    }
  `,
})
export class LiveShell {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    retrying: $localize`Retrying…`,
    retry: $localize`Retry`,
    cancelled: $localize`Cancelled`,
    gameOver: $localize`Game over`,
    theGameWasCancelled: $localize`The game was cancelled`,
    theGameHasEnded: $localize`The game has ended`,
    saving: $localize`Saving…`,
    shareMyLocation: $localize`Share my location`,
    openOptions: $localize`. Open options`,
    shareYourLocation: $localize`Share your location?`,
    locationIsBlocked: $localize`Location is blocked`,
    gpsNotAvailable: $localize`GPS not available`,
  };

  readonly eventId = input.required<string>();

  protected readonly store = inject(LiveStore);
  protected readonly session = inject(LiveSession);
  protected readonly tracker = inject(LocationTracker);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly theme = inject(ThemeService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly realtime = inject(RealtimeService);
  private readonly playerView = inject(PlayerViewService);

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
  /** Only players (and Game Masters on a team) share a position; the server rejects other reports with tracking_not_allowed. */
  private readonly isPlayer = computed(() => playsIn(this.me()));
  protected readonly consented = computed(() => !!this.me()?.trackingConsented || this.session.hasConsented(this.eventId()));
  private readonly stoppedByUser = computed(() => this.session.isStopped(this.eventId()));

  /** Run the GPS tracker: game running, approved member, consent given, not stopped by the player. */
  private readonly wantsTracking = computed(
    () => this.running() && this.isPlayer() && this.consented() && !this.stoppedByUser(),
  );

  private readonly gmView = this.router.routerState.snapshot.root.queryParams['view'] === 'gm';
  /** HUD back arrow: the event page, or the control center for a Game Master who opened the GM view from there. */
  protected readonly backLink = computed(() =>
    this.gmView ? ['/gm/events', this.eventId(), 'control'] : ['/events', this.eventId()],
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
    if (!this.consented()) return { label: $localize`Not sharing`, glyph: '○', tone: 'border border-warning/60 text-warning', action: 'sheet' };
    if (this.stoppedByUser()) return { label: $localize`Sharing off`, glyph: '○', tone: 'border border-warning/60 text-warning', action: 'more' };
    if (state === 'denied') return { label: $localize`Location blocked`, glyph: '✕', tone: 'border border-destructive/60 text-destructive', action: 'sheet' };
    if (state === 'unavailable') return { label: $localize`No GPS`, glyph: '✕', tone: 'border border-destructive/60 text-destructive', action: 'sheet' };
    if (!this.running()) return { label: $localize`Sharing at start`, glyph: '◌', tone: 'text-muted-foreground', action: 'more' };
    if (mine && state === 'tracking') return { label: $localize`Sharing location`, glyph: '●', tone: 'bg-nav/15 text-nav', action: 'more' };
    if (mine && state === 'paused') return { label: $localize`Sharing paused`, glyph: '❚❚', tone: 'text-warning', action: 'more' };
    if (mine && state === 'error') return { label: $localize`GPS problem`, glyph: '◐', tone: 'text-warning', action: 'more' };
    return { label: $localize`Starting GPS`, glyph: '◐', tone: 'text-warning', action: 'more' };
  });

  protected readonly navItems = computed<NavItem[]>(() => {
    const id = this.eventId();
    const available = this.store.objectives().filter((o) => o.status === 'active' && o.canCapture).length;
    const teamId = this.me()?.teamId;
    const ready = this.store.purchases().filter((p) => p.status === 'ready' && p.teamId === teamId).length;
    return [
      { label: $localize`Map`, icon: 'lucideMap', link: liveLink(id), exact: true, badge: 0, badgeLabel: '' },
      { label: $localize`Objectives`, icon: 'lucideCrosshair', link: liveLink(id, 'objectives'), exact: false, badge: available, badgeLabel: $localize`available` },
      { label: $localize`Team`, icon: 'lucideUsers', link: liveLink(id, 'team'), exact: false, badge: 0, badgeLabel: '' },
      { label: $localize`Store`, icon: 'lucideStore', link: liveLink(id, 'store'), exact: false, badge: ready, badgeLabel: $localize`ready to activate` },
      { label: $localize`More`, icon: 'lucideEllipsis', link: liveLink(id, 'more'), exact: false, badge: 0, badgeLabel: '' },
    ];
  });

  constructor() {
    this.theme.setLiveMode(true);
    const destroyRef = inject(DestroyRef);
    // The live map is kept alive across tabs (one billed map load per game); drop it with the shell.
    const reuse = inject(KeepAliveRouteStrategy);
    destroyRef.onDestroy(() => reuse.release(LIVE_MAP_KEEP_ALIVE));

    // Map-only view: leaving the live screens brings the phone's bars back; leaving browser
    // fullscreen (Esc, back gesture) ends the view.
    destroyRef.onDestroy(() => {
      if (!this.session.mapOnly()) return;
      this.session.mapOnly.set(false);
      setImmersive(false);
    });
    if (typeof document !== 'undefined') {
      const onFullscreen = () => {
        if (!document.fullscreenElement && this.session.mapOnly() && !isNativeApp()) this.session.mapOnly.set(false);
      };
      document.addEventListener('fullscreenchange', onFullscreen);
      destroyRef.onDestroy(() => document.removeEventListener('fullscreenchange', onFullscreen));
    }

    // A Game Master on a team sees these screens as their team does (see PlayerViewService),
    // unless the shell was opened with ?view=gm: then it keeps the Game Master view until it closes.
    let viewing: string | null = null;
    destroyRef.onDestroy(() => viewing && this.playerView.leave(viewing));

    // Load (and reload if the route is reused for another event).
    effect(() => {
      const id = this.eventId();
      untracked(() => {
        if (viewing !== id) {
          if (viewing) this.playerView.leave(viewing);
          if (this.router.routerState.snapshot.root.queryParams['view'] !== 'gm') this.playerView.enter(id);
          viewing = id;
        }
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
          this.toast.warning($localize`You are not a confirmed player of this event`);
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
        this.toast.error($localize`You were removed from this event`, p.reason || undefined);
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
    this.toast.info($localize`Location not shared`, $localize`Tap “Not sharing” at the top to change your mind.`);
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
      this.toast.success($localize`Sharing your location while the game runs`);
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
