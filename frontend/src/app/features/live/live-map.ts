import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { LatLng, Objective, Poi, VisiblePosition } from '../../core/api/models';
import { LiveStore } from '../../core/live/live-store';
import { LocationTracker } from '../../core/location/location-tracker.service';
import {
  BLOCK_REASON_LABELS,
  PLAYER_ROLE_LABELS,
  POI_TYPE_LABELS,
  PRECISION_LABELS,
  formatDistance,
  formatNumber,
  formatRelative,
} from '../../core/util/format';
import { COMPACT_LANDSCAPE_QUERY, mediaQuery } from '../../core/ui/media';
import { setImmersive } from '../../core/native/native-app';
import { CaptureBar, showCaptureBar, zoneCanAccrue } from '../../shared/capture-bar';
import { GameTimer, nowSignal } from '../../shared/game-timer';
import { GpsStatus } from '../../shared/link-status';
import { TacticalMap } from '../../shared/map/tactical-map';
import { StatusChip, objectiveStatusChip } from '../../shared/status-chip';
import { TeamBadge } from '../../shared/team-badge';
import { LiveSession } from './live-session';
import { bearingLabel, distanceFrom, liveLink, positionKindLabel, positionStatusChip, remaining } from './live-util';

type Selection = { kind: 'objective'; id: string } | { kind: 'player'; id: string; posKind: VisiblePosition['kind'] } | { kind: 'poi'; id: string };

const sameLatLng = (a: LatLng | null, b: LatLng | null) => a === b || (!!a && !!b && a.lat === b.lat && a.lng === b.lng);

/**
 * Full-bleed tactical map with perk chips, recent activity and a preview panel for the tapped marker.
 * Map-only view (button with the map controls) hides everything but the map, the timer and GPS.
 */
@Component({
  selector: 'zeus-live-map',
  imports: [NgIcon, HlmButton, TacticalMap, StatusChip, TeamBadge, CaptureBar, GameTimer, GpsStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block h-full' },
  template: `
    <h2 class="sr-only" i18n>Map</h2>
    <!-- isolate: marker z-indexes stay inside the map, under the panels below -->
    <div class="absolute inset-0 isolate">
      <zeus-tactical-map
        #map
        class="h-full w-full"
        [objectives]="store.objectives()"
        [pois]="store.pois()"
        [zones]="store.zones()"
        [positions]="store.positions()"
        [teams]="store.teams()"
        [self]="self()"
        [selectedId]="selectedId()"
        [center]="center()"
        [zoom]="mapZoom()"
        (objectiveClick)="select({ kind: 'objective', id: $event.id })"
        (playerClick)="select({ kind: 'player', id: $event.userId, posKind: $event.kind })"
        (poiClick)="select({ kind: 'poi', id: $event.id })"
        (mapClick)="clearSelection()"
      >
        <button
          mapControl
          type="button"
          class="hud grid size-11 place-items-center"
          (click)="toggleMapOnly()"
          [attr.aria-pressed]="session.mapOnly()"
          [attr.aria-label]="session.mapOnly() ? txt.showInterface : txt.mapOnly"
        >
          <ng-icon [name]="session.mapOnly() ? 'lucideShrink' : 'lucideFullscreen'" size="18" aria-hidden="true" />
        </button>
      </zeus-tactical-map>
    </div>

    @if (session.mapOnly()) {
      <!-- Map-only view: just the clock and GPS -->
      <div class="hud pointer-events-none absolute top-2 z-[2] flex items-center gap-3 px-2.5 py-1" [style.left]="'max(0.5rem, env(safe-area-inset-left))'">
        <zeus-game-timer [clock]="store.clock()" [startAt]="store.event()?.startAt ?? null" [serverOffsetMs]="store.serverOffsetMs()" size="sm" [showCaption]="false" />
        <zeus-gps-status [showTracking]="false" />
      </div>
    }

    <!-- Active effects -->
    @if (effects().length && !session.mapOnly()) {
      <ul class="pointer-events-none absolute top-2 left-2 z-[2] flex max-w-[calc(100%-4.5rem)] flex-col items-start gap-1.5" aria-label="Active perks" i18n-aria-label>
        @for (e of effects(); track e.id) {
          <li class="hud pointer-events-auto flex items-center gap-1.5 px-2 py-1.5 text-xs font-bold" [class.border-destructive]="e.hostile">
            <span aria-hidden="true" [class]="e.hostile ? 'text-destructive' : 'text-primary'">{{ e.hostile ? '▲' : '●' }}</span>
            <span class="truncate">{{ e.label }}</span>
            @if (e.hostile) {
              <span class="sr-only" i18n>(used against your team)</span>
            }
            @if (e.left) {
              <span class="num text-warning">{{ e.left }}</span>
            }
          </li>
        }
      </ul>
    }

    <!-- Recent activity -->
    @if (activity().length && !selection() && !session.mapOnly()) {
      <section
        class="hud absolute bottom-12 left-2 z-[2] w-[min(22rem,calc(100%-4.5rem))]"
        [class.!w-auto]="compact() && !activityOpen()"
        aria-label="Recent activity"
        i18n-aria-label
      >
        <button
          type="button"
          class="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left"
          (click)="activityOpen.set(!activityOpen())"
          [attr.aria-expanded]="activityOpen()"
          aria-controls="map-activity-list"
        >
          <ng-icon name="lucideActivity" size="16" class="shrink-0 text-muted-foreground" aria-hidden="true" />
          @if (activityOpen()) {
            <span class="label-caps flex-1" i18n>Activity · {{ activity().length }}</span>
          } @else if (compact()) {
            <!-- Phone held sideways: just the count, so the strip doesn't cover the map -->
            <span class="num text-sm font-bold">{{ activity().length }}</span>
            <span class="sr-only">{{ activity()[0].message }}</span>
          } @else {
            <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ activity()[0].message }}</span>
          }
          <ng-icon [name]="activityOpen() ? 'lucideChevronDown' : 'lucideChevronUp'" size="16" aria-hidden="true" />
        </button>
        @if (activityOpen()) {
          <ol id="map-activity-list" class="flex flex-col gap-1.5 border-t border-border px-3 pt-2 pb-3">
            @for (a of activity(); track a.id) {
              <li class="text-sm">
                <span class="font-semibold">{{ a.message }}</span>
                <span class="num ml-1 text-xs text-muted-foreground">{{ rel(a.createdAt) }}</span>
              </li>
            }
          </ol>
        }
      </section>
    }

    <!-- Preview panel -->
    @if (selection()) {
      <section
        #panel
        class="hud absolute inset-x-2 bottom-2 z-[3] mx-auto max-w-lg p-4 compact:right-auto compact:mx-0 compact:max-h-[calc(100%-1rem)] compact:w-[min(22rem,55%)] compact:overflow-y-auto"
        aria-labelledby="map-preview-title"
        (keydown.escape)="clearSelection()"
      >
        <button type="button" class="tap absolute top-1 right-1 grid place-items-center rounded-sm" (click)="clearSelection()" aria-label="Close preview" i18n-aria-label>
          <ng-icon name="lucideX" size="20" aria-hidden="true" />
        </button>

        @if (selectedObjective(); as o) {
          <div class="pr-10">
            <div class="flex flex-wrap items-center gap-1.5">
              <zeus-status-chip [spec]="chip(o)" />
              @if (owner(o); as t) {
                <span class="inline-flex items-center gap-1 text-xs"><span class="label-caps" i18n>Held by</span><zeus-team-badge [team]="t" size="sm" [showIcon]="false" /></span>
              }
            </div>
            <h3 id="map-preview-title" tabindex="-1" class="mt-1 text-xl font-bold uppercase outline-none">{{ o.name }}</h3>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span class="num font-bold" i18n><span class="text-primary">+{{ fmt(o.rewards.points) }}</span> pts</span>
            <span class="num font-bold" i18n><span class="text-warning">+{{ fmt(o.rewards.currency) }}</span> cr</span>
            @if (o.rewards.recurringPointsPerMinute) {
              <span class="num" i18n>+{{ o.rewards.recurringPointsPerMinute }} pts/min held</span>
            }
          </div>
          @if (showBar(selectedCapture())) {
            <zeus-capture-bar class="mt-2" [status]="selectedCapture()!" [canAccrue]="canAccrue(o)" />
          }
          <div class="mt-2 flex items-center gap-2 text-nav">
            @if (dirTo(o); as d) {
              <ng-icon name="lucideNavigation2" size="20" aria-hidden="true" [style.transform]="'rotate(' + d.deg + 'deg)'" />
              <span class="num text-lg font-bold">{{ dist(o) }}</span>
              <span class="num font-semibold">{{ d.point }} · {{ d.deg }}°</span>
              <span class="sr-only" i18n>from your position</span>
            } @else {
              <ng-icon name="lucideLocateOff" size="18" class="text-muted-foreground" aria-hidden="true" />
              <span class="text-sm text-muted-foreground" i18n>Waiting for GPS to show distance and direction</span>
            }
          </div>
          @if (!o.canCapture && o.blockedReason) {
            <p class="mt-2 text-sm text-muted-foreground">{{ blocked(o) }}</p>
          }
          <div class="mt-3 flex gap-2">
            <button hlmBtn type="button" class="h-12 flex-1" (click)="openObjective(o)">
              <ng-icon name="lucideCrosshair" size="18" aria-hidden="true" /> <ng-container i18n>Open objective</ng-container>
            </button>
            <button hlmBtn variant="outline" type="button" class="h-12" (click)="centerOn(o)">
              <ng-icon name="lucideLocate" size="18" aria-hidden="true" /> <ng-container i18n>Center</ng-container>
            </button>
          </div>
        } @else if (selectedPlayer(); as p) {
          <div class="pr-10">
            <div class="flex flex-wrap items-center gap-1.5">
              <zeus-status-chip
                [label]="kindLabel(p.kind)"
                [glyph]="p.kind === 'enemy' ? '▲' : p.kind === 'intel' ? '◇' : '●'"
                [tone]="p.kind === 'enemy' || p.kind === 'intel' ? 'danger' : 'primary'"
              />
              <zeus-status-chip [spec]="posChip(p)" />
            </div>
            <h3 id="map-preview-title" tabindex="-1" class="mt-1 text-xl font-bold outline-none">{{ p.nickname || txt.unknownPlayer }}</h3>
          </div>
          <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            @if (teamOf(p); as t) {
              <dt class="label-caps self-center" i18n>Team</dt>
              <dd><zeus-team-badge [team]="t" size="sm" /></dd>
            }
            @if (p.playerRole) {
              <dt class="label-caps self-center" i18n>Role</dt>
              <dd>{{ roleLabel(p.playerRole) }}</dd>
            }
            <dt class="label-caps self-center" i18n>Updated</dt>
            <dd class="num">{{ rel(p.sampleAt) }}</dd>
            @if (p.precision !== 'exact') {
              <dt class="label-caps self-center" i18n>Precision</dt>
              <dd>{{ precisionLabel(p.precision) }}@if (p.radiusM) { · ±<span class="num">{{ p.radiusM }}</span> m }</dd>
            }
            @if (dirTo(p); as d) {
              <dt class="label-caps self-center" i18n>Distance</dt>
              <dd class="num font-semibold text-nav">{{ dist(p) }} · {{ d.point }}</dd>
            }
          </dl>
        } @else if (selectedPoi(); as poi) {
          <div class="pr-10">
            <p class="label-caps">{{ poiLabel(poi) }}</p>
            <h3 id="map-preview-title" tabindex="-1" class="mt-1 text-xl font-bold uppercase outline-none">{{ poi.name }}</h3>
          </div>
          @if (poi.description) {
            <p class="mt-1 text-sm text-muted-foreground">{{ poi.description }}</p>
          }
          @if (dirTo(poi); as d) {
            <p class="mt-2 flex items-center gap-2 text-nav">
              <ng-icon name="lucideNavigation2" size="18" aria-hidden="true" [style.transform]="'rotate(' + d.deg + 'deg)'" />
              <span class="num font-bold">{{ dist(poi) }}</span>
              <span class="num">{{ d.point }} · {{ d.deg }}°</span>
            </p>
          }
          <button hlmBtn variant="outline" type="button" class="mt-3 h-12 w-full" (click)="centerOn(poi)">
            <ng-icon name="lucideLocate" size="18" aria-hidden="true" /> <ng-container i18n>Center</ng-container>
          </button>
        } @else {
          <p id="map-preview-title" class="pr-10 text-sm text-muted-foreground" i18n>This item is no longer visible.</p>
        }
      </section>
    }
  `,
})
export class LiveMapScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    unknownPlayer: $localize`Unknown player`,
    mapOnly: $localize`Map only: hide the interface`,
    showInterface: $localize`Show the interface`,
  };

  protected readonly store = inject(LiveStore);
  protected readonly tracker = inject(LocationTracker);
  protected readonly session = inject(LiveSession);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly mapRef = viewChild<TacticalMap>('map');
  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  private readonly tick = nowSignal();
  protected readonly serverNow = computed(() => this.tick() + this.store.serverOffsetMs());

  protected readonly selection = signal<Selection | null>(null);
  protected readonly activityOpen = signal(false);
  /** Phone held sideways. */
  protected readonly compact = mediaQuery(COMPACT_LANDSCAPE_QUERY);
  private readonly focusCenter = signal<LatLng | null>(null, { equal: sameLatLng });
  /** Latest ?focus=<objectiveId> request; seq makes repeated requests for the same id distinct. */
  private readonly focusRequest = signal<{ id: string; seq: number } | null>(null);
  private handledFocus = 0;

  protected readonly fmt = formatNumber;

  /** Own GPS fix, hidden when older than 2 minutes so a stale dot never looks live. */
  protected readonly self = computed(() => {
    const fix = this.tracker.lastFix();
    return fix && this.tick() - fix.timestamp < 120_000 ? fix : null;
  });

  private readonly areaCenter = computed<LatLng | null>(
    () => {
      const a = this.store.event()?.area;
      return a ? { lat: a.lat, lng: a.lng } : null;
    },
    { equal: sameLatLng },
  );
  private readonly hasContent = computed(() => this.store.objectives().length + this.store.zones().length + this.store.pois().length > 0);
  /** Focused objective, else the event area when there is nothing to fit the map to. */
  protected readonly center = computed(() => this.focusCenter() ?? (this.hasContent() ? null : this.areaCenter()), { equal: sameLatLng });
  protected readonly mapZoom = computed(() => (this.focusCenter() ? 18 : (this.store.event()?.area?.zoom ?? 17)));

  protected readonly selectedId = computed(() => this.selection()?.id ?? null);

  protected readonly selectedObjective = computed(() => {
    const s = this.selection();
    return s?.kind === 'objective' ? (this.store.objectiveById().get(s.id) ?? null) : null;
  });
  /** Viewer's zone capture state for the selected objective. */
  protected readonly selectedCapture = computed(() => {
    const o = this.selectedObjective();
    return o ? (this.tracker.geofence().find((g) => g.objectiveId === o.id) ?? null) : null;
  });
  protected readonly showBar = showCaptureBar;
  protected readonly canAccrue = zoneCanAccrue;

  protected readonly selectedPlayer = computed(() => {
    const s = this.selection();
    if (s?.kind !== 'player') return null;
    return this.store.positions().find((p) => p.userId === s.id && p.kind === s.posKind) ?? null;
  });
  protected readonly selectedPoi = computed(() => {
    const s = this.selection();
    return s?.kind === 'poi' ? (this.store.pois().find((p) => p.id === s.id) ?? null) : null;
  });

  protected readonly effects = computed(() => {
    const teamId = this.store.me()?.teamId;
    if (!teamId) return [];
    const now = this.serverNow();
    return this.store
      .activeEffects()
      .filter((e) => e.teamId === teamId || e.targetTeamId === teamId)
      .filter((e) => new Date(e.expiresAt).getTime() > now)
      .map((e) => ({ id: e.id, label: e.label, hostile: e.teamId !== teamId, left: remaining(e.expiresAt, now) }));
  });

  protected readonly activity = computed(() => this.store.activity().slice(0, 3));

  constructor() {
    // This screen is kept alive between tabs (KeepAliveRouteStrategy), so every navigation that
    // carries ?focus=<objectiveId> is a new request, even for the same id as last time.
    let seq = 0;
    let wasShown = false;
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => {
      // Back on the map tab after another tab: the kept map was out of the page, so its markers need rebuilding.
      const shown = this.host.nativeElement.isConnected;
      if (shown && !wasShown) this.mapRef()?.reattach();
      wasShown = shown;
      // The other tabs need the HUD and the tab bar: leaving the map ends the map-only view.
      if (!shown && this.session.mapOnly()) this.setMapOnly(false);
      const id: unknown = this.router.routerState.snapshot.root.queryParams['focus'];
      if (typeof id === 'string' && id) this.focusRequest.set({ id, seq: ++seq });
    });

    // Select the requested objective and pan to it, once per request (waits for objectives to load).
    effect(() => {
      const req = this.focusRequest();
      const o = req ? this.store.objectiveById().get(req.id) : undefined;
      if (!req || !o || req.seq === this.handledFocus) return;
      this.handledFocus = req.seq;
      const id = req.id;
      untracked(() => {
        this.focusCenter.set({ lat: o.lat, lng: o.lng });
        this.select({ kind: 'objective', id });
        this.mapRef()?.panTo({ lat: o.lat, lng: o.lng }, 18);
      });
    });
  }

  protected select(sel: Selection): void {
    this.selection.set(sel);
    afterNextRender(() => this.panelRef()?.nativeElement.querySelector<HTMLElement>('#map-preview-title')?.focus(), {
      injector: this.injector,
    });
  }

  protected clearSelection(): void {
    this.selection.set(null);
  }

  protected toggleMapOnly(): void {
    this.setMapOnly(!this.session.mapOnly());
  }

  private setMapOnly(on: boolean): void {
    this.session.mapOnly.set(on);
    setImmersive(on);
  }

  protected openObjective(o: Objective): void {
    void this.router.navigate(liveLink(this.store.eventId(), 'objectives', o.id));
  }

  protected centerOn(p: LatLng): void {
    this.mapRef()?.panTo({ lat: p.lat, lng: p.lng }, 18);
  }

  protected chip(o: Objective) {
    return objectiveStatusChip(o.status);
  }
  protected owner(o: Objective) {
    return o.ownerTeamId ? (this.store.teamById().get(o.ownerTeamId) ?? null) : null;
  }
  protected blocked(o: Objective): string {
    return o.blockedReason ? BLOCK_REASON_LABELS[o.blockedReason] : '';
  }
  protected dirTo(p: LatLng) {
    return bearingLabel(this.self(), p);
  }
  protected dist(p: LatLng): string {
    return formatDistance(distanceFrom(this.self(), p));
  }
  protected rel(iso: string): string {
    return formatRelative(iso, this.serverNow());
  }
  protected posChip(p: VisiblePosition) {
    return positionStatusChip(p.status);
  }
  protected kindLabel(k: VisiblePosition['kind']): string {
    return positionKindLabel(k);
  }
  protected teamOf(p: VisiblePosition) {
    return p.teamId ? (this.store.teamById().get(p.teamId) ?? null) : null;
  }
  protected roleLabel(r: keyof typeof PLAYER_ROLE_LABELS): string {
    return PLAYER_ROLE_LABELS[r];
  }
  protected precisionLabel(p: VisiblePosition['precision']): string {
    return PRECISION_LABELS[p];
  }
  protected poiLabel(p: Poi): string {
    return POI_TYPE_LABELS[p.type];
  }
}
