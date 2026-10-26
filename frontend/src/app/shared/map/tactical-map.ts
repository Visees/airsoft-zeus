import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { GeoJSONSource, ImageSource, Map as MlMap, Marker as MlMarker } from 'maplibre-gl';
import { LatLng, MapLayer, MapOverlay, Objective, Poi, Team, VisiblePosition, Zone } from '../../core/api/models';
import { MapEngine, MapEngineService } from '../../core/maps/map-engine.service';
import type { BaseLayer } from '../../core/maps/map-style';
import { LiveStore } from '../../core/live/live-store';
import { capturePct, objectiveMarker, playerMarker, poiMarker, selfMarker, setCaptureFill, zoneLabel } from '../../core/maps/markers';
import { ThemeService } from '../../core/theme/theme.service';
import { nowSignal } from '../game-timer';
import { bounds, distanceM } from '../../core/util/geo';

const SELF_GLIDE_MS = 800;
const BASE_LAYER_KEY = 'airsofthub.mapBase';
const OVERLAY_KEY = 'airsofthub.mapOverlay';
/** Map layers (add-ons) switched on or off on this device: { [layer id]: shown } */
const LAYERS_KEY = 'airsofthub.mapLayers';
/** Past this many zone labels the small ones wait for a closer zoom, so a dense field map stays readable. */
const DENSE_LABELS = 40;
const SMALL_LABEL_ZOOM = 18;

export interface SelfFix {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
}

/** In-progress shape drawn by an editor (polygon/polyline/circle/point). */
export interface DraftShape {
  geometry: 'point' | 'circle' | 'polygon' | 'polyline';
  points: LatLng[];
  radiusM?: number | null;
  color: string;
}

export interface MarkerMove {
  kind: 'objective' | 'poi';
  id: string;
  position: LatLng;
}

type Renderer = 'loading' | 'map' | 'schematic';
type LayerChoice = BaseLayer | 'schematic';

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG_EQ = 111_320;

/**
 * Zoom levels in inputs, events and saved event areas use the classic web-map scale (256 px tiles,
 * as Google and Leaflet); MapLibre's scale uses 512 px tiles, one level lower for the same view.
 */
const toMl = (zoom: number) => zoom - 1;
const fromMl = (zoom: number) => zoom + 1;

/** Line styles of game shapes; separate layers because the dash pattern can't vary per feature. */
const DASHES = { solid: null, dash: [3, 2], dot: [0.6, 2] } as const;
type Dash = keyof typeof DASHES;

interface MarkerEntry {
  marker: MlMarker;
  el: HTMLElement;
  sig: string;
  /** Where the marker is drawn now, and where it is heading (the latest position). */
  cur: LatLng;
  to: LatLng;
  /** When the latest position arrived (performance.now()). */
  lastAt: number;
  anim?: { from: LatLng; start: number; dur: number };
}

interface ShapeProps {
  zoneId: string | null;
  color: string;
  fill: boolean;
  fillOpacity: number;
  width: number;
  lineOpacity: number;
  dash: Dash;
}

/**
 * Tactical map used by every map screen.
 *
 * Renders a topographic map with MapLibre (free OpenStreetMap data from OpenFreeMap, contour lines
 * and relief from open elevation data, see core/maps/map-style.ts), a satellite map when an ArcGIS
 * key is configured, and otherwise a built-in schematic SVG renderer that works offline from the
 * cached event data (zones, objectives, POIs, positions on a metric grid).
 *
 * Everything shown is already filtered by the server for the viewer; this component never
 * decides visibility.
 */
@Component({
  selector: 'ah-tactical-map',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The host takes the consumer's sizing/positioning classes (e.g. "absolute inset-0" or "h-56");
  // the inner wrapper is the positioning context for the map layers and controls.
  host: {
    class: 'block overflow-hidden bg-muted',
    role: 'region',
    '[attr.aria-label]': 'ariaLabel()',
    '(document:keydown.escape)': 'layersOpen.set(false)',
  },
  template: `
    <div class="relative size-full min-h-40">
    <!-- isolate: marker z-indexes stay inside the map, under the map buttons and menus -->
    <div #mapHost class="absolute inset-0 isolate" [class.invisible]="renderer() !== 'map'"></div>

    @if (renderer() === 'schematic') {
      <div
        #schematicHost
        class="absolute inset-0 touch-none select-none overflow-clip"
        [style.background]="'var(--background)'"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerUp($event)"
        (wheel)="onWheel($event)"
      >
        <svg class="absolute inset-0 size-full" aria-hidden="true">
          <defs>
            <pattern id="ah-grid" [attr.width]="gridPx()" [attr.height]="gridPx()" patternUnits="userSpaceOnUse"
              [attr.x]="gridOffset().x" [attr.y]="gridOffset().y">
              <path [attr.d]="'M ' + gridPx() + ' 0 L 0 0 0 ' + gridPx()" fill="none" stroke="var(--border)" stroke-width="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#ah-grid)" />
          @if (schematicImage(); as im) {
            <image [attr.href]="im.url" [attr.x]="im.x" [attr.y]="im.y" [attr.width]="im.w" [attr.height]="im.h" [attr.opacity]="im.opacity" preserveAspectRatio="none" />
          }
          @for (z of schematicZones(); track z.id) {
            @if (z.kind === 'circle') {
              <circle [attr.cx]="z.cx" [attr.cy]="z.cy" [attr.r]="z.r" [attr.fill]="z.color" [attr.fill-opacity]="z.fillOpacity"
                [attr.stroke]="z.color" [attr.stroke-width]="z.strokeWidth" [attr.stroke-dasharray]="z.dash" />
            } @else if (z.kind === 'polygon') {
              <polygon [attr.points]="z.points" [attr.fill]="z.color" [attr.fill-opacity]="z.fillOpacity" [attr.stroke]="z.color"
                [attr.stroke-width]="z.strokeWidth" [attr.stroke-dasharray]="z.dash" />
            } @else if (z.kind === 'polyline') {
              <polyline [attr.points]="z.points" fill="none" [attr.stroke]="z.color" [attr.stroke-width]="z.strokeWidth"
                [attr.stroke-dasharray]="z.dash" stroke-linejoin="round" stroke-linecap="round" />
            }
          }
        </svg>
        <div #schematicOverlay class="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto"></div>
        <div class="pointer-events-none absolute bottom-2 left-2 flex items-center gap-2 rounded-sm bg-hud px-2 py-1 text-xs text-muted-foreground">
          <span class="inline-block h-1 border-x border-b border-current" [style.width.px]="gridPx()"></span>
          <span class="num">{{ gridMeters() }} m</span>
          <span class="hidden sm:inline" i18n>· Schematic view{{ mapsState() === 'unavailable' ? txt.mapTilesUnavailable : '' }}</span>
        </div>
      </div>
    }

    @if (renderer() === 'loading') {
      <div class="absolute inset-0 grid place-items-center text-sm text-muted-foreground" role="status" i18n>Loading map…</div>
    }

    <!-- Map buttons; screens add their own with the mapControl attribute. Smaller on a phone held sideways so they fit. -->
    <div
      class="absolute top-2 right-[max(0.5rem,env(safe-area-inset-right))] z-[1] flex flex-col gap-1.5 compact:gap-1 compact:[&>button]:size-10"
      [class.!top-auto]="controlsBottom()"
      [class.!bottom-24]="controlsBottom()"
    >
      <ng-content select="[mapControl]" />
      @if (renderer() !== 'loading') {
        <button type="button" class="hud grid size-11 place-items-center" (click)="zoomBy(1.4)" aria-label="Zoom in" i18n-aria-label>
          <ng-icon name="lucidePlus" size="18" aria-hidden="true" />
        </button>
        <button type="button" class="hud grid size-11 place-items-center" (click)="zoomBy(1 / 1.4)" aria-label="Zoom out" i18n-aria-label>
          <ng-icon name="lucideMinus" size="18" aria-hidden="true" />
        </button>
      }
      <button type="button" class="hud grid size-11 place-items-center" (click)="fitAll()" aria-label="Show the whole area" i18n-aria-label>
        <ng-icon name="lucideMaximize2" size="18" aria-hidden="true" />
      </button>
      @if (self()) {
        <button type="button" class="hud grid size-11 place-items-center text-nav" (click)="centerOnSelf()" aria-label="Center on my position" i18n-aria-label>
          <ng-icon name="lucideLocateFixed" size="18" aria-hidden="true" />
        </button>
      }
      @if (allowRendererToggle() && mapsState() === 'ready') {
        <div class="relative">
          <button type="button" class="hud grid size-11 place-items-center compact:size-10" (click)="layersOpen.set(!layersOpen())"
            [attr.aria-expanded]="layersOpen()" aria-haspopup="menu" aria-label="Map type" i18n-aria-label>
            <ng-icon name="lucideLayers" size="18" aria-hidden="true" />
          </button>
          @if (layersOpen()) {
            <div class="hud absolute top-0 right-full mr-1.5 flex min-w-40 flex-col p-1" role="menu" aria-label="Map type" i18n-aria-label>
              @for (o of layerOptions(); track o.id) {
                <button type="button" role="menuitemradio" [attr.aria-checked]="activeLayer() === o.id"
                  class="flex min-h-11 items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-muted"
                  [class.font-semibold]="activeLayer() === o.id" (click)="chooseLayer(o.id)">
                  <ng-icon [name]="o.icon" size="16" aria-hidden="true" />
                  <span class="flex-1">{{ o.label }}</span>
                  @if (activeLayer() === o.id) {
                    <ng-icon name="lucideCheck" size="16" class="text-nav" aria-hidden="true" />
                  }
                </button>
              }
              @if (overlay()) {
                <div class="my-1 border-t border-border" role="separator"></div>
                <button type="button" role="menuitemcheckbox" [attr.aria-checked]="overlayShown()"
                  class="flex min-h-11 items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-muted"
                  [class.font-semibold]="overlayShown()" (click)="toggleOverlay()">
                  <ng-icon name="lucideImage" size="16" aria-hidden="true" />
                  <span class="flex-1" i18n>Venue map</span>
                  @if (overlayShown()) {
                    <ng-icon name="lucideCheck" size="16" class="text-nav" aria-hidden="true" />
                  }
                </button>
              }
              @if (layerSwitches().length) {
                @if (!overlay()) {
                  <div class="my-1 border-t border-border" role="separator"></div>
                }
                @for (l of layerSwitches(); track l.id) {
                  <button type="button" role="menuitemcheckbox" [attr.aria-checked]="l.on"
                    class="flex min-h-11 items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-muted"
                    [class.font-semibold]="l.on" (click)="toggleMapLayer(l.id, !l.on)">
                    <ng-icon name="lucideLayers" size="16" aria-hidden="true" />
                    <span class="max-w-56 flex-1">{{ l.name }}</span>
                    @if (l.on) {
                      <ng-icon name="lucideCheck" size="16" class="text-nav" aria-hidden="true" />
                    }
                  </button>
                }
              }
            </div>
          }
        </div>
      }
    </div>
    </div>
  `,
})
export class TacticalMap {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    mapTilesUnavailable: $localize` (map tiles unavailable)`,
  };

  private readonly engines = inject(MapEngineService);
  private readonly theme = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Live screens provide it: server time for running captures (editors show the fill as loaded). */
  private readonly live = inject(LiveStore, { optional: true });
  private readonly tick = nowSignal(1000);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly objectives = input<Objective[]>([]);
  readonly pois = input<Poi[]>([]);
  readonly zones = input<Zone[]>([]);
  readonly positions = input<VisiblePosition[]>([]);
  readonly teams = input<Team[]>([]);
  readonly self = input<SelfFix | null>(null);
  readonly selectedId = input<string | null>(null);
  readonly center = input<LatLng | null>(null);
  readonly zoom = input(16);
  readonly showGeofences = input(true);
  readonly showLabels = input(true);
  /** Objective/POI markers can be dragged (editor). */
  readonly editable = input(false);
  readonly draft = input<DraftShape | null>(null);
  /** Change this value to re-fit the map to the content. */
  readonly fitKey = input<unknown>(null);
  readonly forceSchematic = input(false);
  readonly allowRendererToggle = input(true);
  readonly controlsBottom = input(false);
  /** false: taps inside zones go to mapClick (placing points inside an area). */
  readonly shapesClickable = input(true);
  /** 'cooperative' for small embedded previews so one-finger scrolling scrolls the page. */
  readonly gestureHandling = input<'greedy' | 'cooperative'>('greedy');
  /** The field's own printed map, drawn under the shapes (anyone can hide it from the layers menu). */
  readonly overlay = input<MapOverlay | null>(null);
  /** Optional layers (add-ons such as a grid): their zones show only while the layer is on. */
  readonly mapLayers = input<MapLayer[]>([]);
  /** Editor: the overlay's corners get handles that can be dragged. */
  readonly overlayEditable = input(false);

  readonly objectiveClick = output<Objective>();
  readonly poiClick = output<Poi>();
  readonly playerClick = output<VisiblePosition>();
  readonly zoneClick = output<Zone>();
  readonly mapClick = output<LatLng>();
  readonly markerMoved = output<MarkerMove>();
  readonly overlayCornersChange = output<MapOverlay['corners']>();

  /** Which renderer is showing: 'map' (MapLibre), 'schematic' or 'loading'. */
  readonly renderer = signal<Renderer>('loading');
  protected readonly mapsState = this.engines.state;
  protected readonly layersOpen = signal(false);
  /** Venue map shown or hidden, remembered on this device. */
  protected readonly overlayShown = signal(readOverlayShown());
  /** Layers switched on or off on this device; a layer not listed follows its `shown`. */
  private readonly layerChoice = signal<Record<string, boolean>>(readLayerChoice());
  /** The layers that have zones on this map, with whether they show. */
  protected readonly layerSwitches = computed(() => {
    const used = new Set(this.zones().map((z) => z.layer).filter(Boolean));
    const choice = this.layerChoice();
    return this.mapLayers()
      .filter((l) => used.has(l.id))
      .map((l) => ({ id: l.id, name: l.name, on: choice[l.id] ?? l.shown }));
  });
  /** The zones drawn: those of hidden layers are left out. */
  private readonly shownZones = computed(() => {
    const off = new Set(this.layerSwitches().filter((l) => !l.on).map((l) => l.id));
    return off.size ? this.zones().filter((z) => !z.layer || !off.has(z.layer)) : this.zones();
  });
  /** Topo or satellite, remembered on this device. */
  private readonly baseLayer = signal<BaseLayer>(readBaseLayer());
  private readonly effectiveBase = computed<BaseLayer>(() => (this.baseLayer() === 'satellite' && this.engines.satelliteAvailable() ? 'satellite' : 'topo'));
  protected readonly activeLayer = computed<LayerChoice>(() => (this.renderer() === 'schematic' ? 'schematic' : this.effectiveBase()));
  protected readonly layerOptions = computed(() => {
    const opts: { id: LayerChoice; label: string; icon: string }[] = [{ id: 'topo', label: $localize`:map type|:Topographic`, icon: 'lucideMountain' }];
    if (this.engines.satelliteAvailable()) opts.push({ id: 'satellite', label: $localize`:map type|:Satellite`, icon: 'lucideSatellite' });
    opts.push({ id: 'schematic', label: $localize`:map type|:Schematic`, icon: 'lucideGrid3x3' });
    return opts;
  });

  private readonly mapHost = viewChild<ElementRef<HTMLDivElement>>('mapHost');
  private readonly schematicHost = viewChild<ElementRef<HTMLDivElement>>('schematicHost');
  private readonly schematicOverlay = viewChild<ElementRef<HTMLDivElement>>('schematicOverlay');

  /** The MapLibre map (it stays alive when the schematic view is shown). */
  private map: MlMap | null = null;
  private engine: MapEngine | null = null;
  private readonly markers = new Map<string, MarkerEntry>();
  /** Frame loop that glides other players' markers between position updates. */
  private markerAnim = 0;
  /** Game shapes (zones, rings, draft) and the own accuracy circle, re-added after a style change. */
  private shapeData: FeatureCollection<Geometry, ShapeProps> = { type: 'FeatureCollection', features: [] };
  private selfData: FeatureCollection = { type: 'FeatureCollection', features: [] };
  /** The field (playable areas) painted with the page background while the venue map is hidden. */
  private maskData: FeatureCollection = { type: 'FeatureCollection', features: [] };
  private styleReady = false;
  private applied: { base: BaseLayer; dark: boolean } | null = null;
  /** A marker drag ends with a click on the marker; it must not count as a tap. */
  private suppressClickUntil = 0;
  /** Where the own dot is drawn: it glides to each new fix instead of jumping. */
  private readonly selfDrawn = signal<SelfFix | null>(null);
  private selfAnim = 0;
  private selfNode: HTMLElement | null = null;
  /** Overlay corners while a handle is dragged (the input changes only after the editor saves). */
  private overlayCorners: MapOverlay['corners'] | null = null;
  private overlayHandles: MlMarker[] = [];
  /** Zone label markers that wait for a closer zoom on dense maps. */
  private readonly labelMinZoom = new Map<string, number>();

  // schematic view state: origin (lat/lng of projection), scale px/m, pan offset px
  private readonly origin = signal<LatLng>({ lat: 45.0, lng: 9.0 });
  private readonly scale = signal(0.6);
  private readonly pan = signal({ x: 0, y: 0 });
  private readonly size = signal({ w: 0, h: 0 });
  private pointers = new Map<number, { x: number; y: number }>();
  private fitPending = false;
  private dragStart: { x: number; y: number; pan: { x: number; y: number }; moved: boolean } | null = null;
  private pinchStart: { dist: number; scale: number } | null = null;

  protected readonly ariaLabel = computed(
    () =>
      $localize`Tactical map: ${this.objectives().length}:length: objectives, ${this.positions().length}:length2: players visible` +
      (this.renderer() === 'schematic' ? $localize`, schematic view` : ''),
  );

  constructor() {
    afterNextRender(() => void this.init());

    // Map renderer sync
    effect(() => {
      const r = this.renderer();
      const data = {
        objectives: this.objectives(),
        pois: this.pois(),
        zones: this.shownZones(),
        positions: this.positions(),
        teams: this.teams(),
        self: this.self(),
        selected: this.selectedId(),
        geof: this.showGeofences(),
        labels: this.showLabels(),
        draft: this.draft(),
        editable: this.editable(),
        shapesClickable: this.shapesClickable(),
      };
      if (r === 'map' && this.map) untracked(() => this.syncMap(data));
    });
    // Own position: glide towards the latest fix, moving only the dot and its accuracy circle
    effect(() => {
      const target = this.self();
      untracked(() => this.glideSelf(target));
    });
    effect(() => {
      const s = this.selfDrawn();
      const r = this.renderer();
      if (s) untracked(() => this.moveSelf(s, r));
    });
    // Venue map image and its corner handles
    effect(() => {
      const o = this.overlay();
      const shown = this.overlayShown();
      const editable = this.overlayEditable();
      if (this.renderer() !== 'map') return;
      untracked(() => {
        this.overlayCorners = o ? ([...o.corners] as MapOverlay['corners']) : null;
        this.syncOverlay(o, shown || editable);
        this.syncOverlayHandles(o && editable ? o : null);
      });
    });
    // With the venue map hidden, the field gets a plain background instead of the topo map's woods
    // (never on satellite: there the imagery is the point)
    effect(() => {
      const on = !!this.overlay() && !this.overlayShown() && !this.overlayEditable() && this.effectiveBase() === 'topo';
      const field = on ? this.shownZones().filter((z) => z.kind === 'playable' && z.geometry === 'polygon' && z.points.length >= 3) : [];
      if (this.renderer() !== 'map') return;
      this.maskData = { type: 'FeatureCollection', features: field.map((z) => ({ type: 'Feature', properties: {}, geometry: polygon(z.points) })) };
      untracked(() => this.pushMask());
    });
    // Light/dark theme and topo/satellite switch the map style
    effect(() => {
      const dark = this.theme.isDark();
      const base = this.effectiveBase();
      untracked(() => this.applyStyle(base, dark));
    });
    // Schematic overlay sync (markers are DOM nodes positioned over the SVG)
    effect(() => {
      if (this.renderer() !== 'schematic') return;
      this.objectives();
      this.pois();
      this.positions();
      this.shownZones();
      this.self();
      this.selectedId();
      this.showLabels();
      this.scale();
      this.pan();
      this.size();
      this.origin();
      this.draft();
      untracked(() => this.syncSchematicOverlay());
    });
    // Running zone captures: move the diamond fills every second (markers are rebuilt only on changes)
    effect(() => {
      const capturing = this.objectives().filter((o) => o.capture);
      if (!capturing.length) return;
      if (capturing.some((o) => o.capture!.rate > 0)) this.tick();
      this.renderer();
      untracked(() => {
        const now = this.serverNow();
        for (const o of capturing) {
          const pct = capturePct(o.capture!, now);
          this.host.nativeElement.querySelectorAll<HTMLElement>(`[data-capture-fill="${o.id}"]`).forEach((n) => setCaptureFill(n, pct));
        }
      });
    });
    // Re-fit when asked
    effect(() => {
      this.fitKey();
      untracked(() => {
        if (this.renderer() !== 'loading') this.fitAll();
      });
    });
    effect(() => {
      const c = this.center();
      if (!c) return;
      untracked(() => this.panTo(c, this.zoom()));
    });

    this.destroyRef.onDestroy(() => {
      if (this.isBrowser) {
        cancelAnimationFrame(this.selfAnim);
        cancelAnimationFrame(this.markerAnim);
      }
      this.markers.forEach((m) => m.marker.remove());
      this.map?.remove();
    });
  }

  private serverNow(): number {
    return this.live?.now() ?? Date.now();
  }

  // ------------------------------------------------------------------ public API

  panTo(p: LatLng, zoom?: number): void {
    if (this.renderer() === 'map' && this.map) {
      this.map.easeTo({ center: [p.lng, p.lat], ...(zoom ? { zoom: toMl(zoom) } : {}), duration: 300 });
    } else if (this.renderer() === 'schematic') {
      const { w, h } = this.size();
      const pt = this.project(p);
      this.pan.set({ x: w / 2 - pt.x * this.scale(), y: h / 2 - pt.y * this.scale() });
    }
  }

  /** Frame an area (a place found by search); the schematic view centres on it. */
  fitBounds(b: { north: number; south: number; east: number; west: number }): void {
    if (this.renderer() === 'map' && this.map) {
      this.map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: this.fitPadding(), maxZoom: toMl(18), duration: 300 });
    } else {
      this.panTo({ lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 });
    }
  }

  /** Centre and zoom of the visible map, or null when the schematic view is showing. */
  /** The area on screen, or null while the map has no size yet. */
  viewBounds(): { north: number; south: number; east: number; west: number } | null {
    if (this.renderer() === 'map' && this.map) {
      const b = this.map.getBounds();
      return { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
    }
    const { w, h } = this.size();
    if (this.renderer() !== 'schematic' || !w || !h) return null;
    const nw = this.unproject(0, 0);
    const se = this.unproject(w, h);
    return { north: nw.lat, south: se.lat, east: se.lng, west: nw.lng };
  }

  viewState(): { lat: number; lng: number; zoom: number } | null {
    if (this.renderer() !== 'map' || !this.map) return null;
    const c = this.map.getCenter();
    return { lat: c.lat, lng: c.lng, zoom: Math.round(fromMl(this.map.getZoom())) };
  }

  /**
   * Call after the map's host was taken out of the document and put back (the live map is kept
   * alive between tabs): the map measures its size again. Markers are plain DOM and stay.
   */
  reattach(): void {
    this.map?.resize();
  }

  private glideSelf(target: SelfFix | null): void {
    const from = this.selfDrawn();
    if (this.isBrowser) cancelAnimationFrame(this.selfAnim);
    // big jumps (first fix after a while) and reduced motion: no glide
    if (!this.isBrowser || !target || !from || distanceM(from, target) > 150 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.selfDrawn.set(target);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / SELF_GLIDE_MS);
      const e = 1 - (1 - t) ** 3;
      this.selfDrawn.set({
        ...target,
        lat: from.lat + (target.lat - from.lat) * e,
        lng: from.lng + (target.lng - from.lng) * e,
        accuracy: from.accuracy + (target.accuracy - from.accuracy) * e,
      });
      if (t < 1) this.selfAnim = requestAnimationFrame(step);
    };
    this.selfAnim = requestAnimationFrame(step);
  }

  /** Move the existing own marker in place (the full syncs rebuild it only when the fix itself changes). */
  private moveSelf(s: SelfFix, renderer: string): void {
    if (renderer === 'map') {
      this.markers.get('self')?.marker.setLngLat([s.lng, s.lat]);
      this.selfData = { type: 'FeatureCollection', features: [circleFeature(s, s.accuracy, {})] };
      this.pushSelf();
    } else if (renderer === 'schematic' && this.selfNode) {
      const p = this.toScreen(s);
      this.selfNode.style.left = `${p.x}px`;
      this.selfNode.style.top = `${p.y}px`;
    }
  }

  centerOnSelf(): void {
    const s = this.self();
    const current = this.map ? fromMl(this.map.getZoom()) : 17;
    if (s) this.panTo(s, Math.max(current, 17));
  }

  fitAll(): void {
    const pts = this.contentPoints();
    if (!pts.length) {
      const c = this.center();
      if (c) this.panTo(c, this.zoom());
      return;
    }
    if (this.renderer() === 'map' && this.map) {
      if (pts.length === 1) {
        this.map.jumpTo({ center: [pts[0].lng, pts[0].lat], zoom: toMl(17) });
        return;
      }
      const b = bounds(pts)!;
      this.map.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: this.fitPadding(), maxZoom: toMl(19), animate: false });
    } else if (this.renderer() === 'schematic') {
      const { w: viewW, h: viewH } = this.size();
      if (viewW < 80 || viewH < 80) {
        this.fitPending = true; // not laid out yet: fit when the size is known
        return;
      }
      this.fitPending = false;
      const b = bounds(pts)!;
      const center = { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };
      this.origin.set(center);
      const ne = this.project({ lat: b.north, lng: b.east });
      const sw = this.project({ lat: b.south, lng: b.west });
      const widthM = Math.max(60, Math.abs(ne.x - sw.x));
      const heightM = Math.max(60, Math.abs(ne.y - sw.y));
      const { w, h } = this.size();
      this.scale.set(Math.max(0.02, Math.min((w - 64) / widthM, (h - 64) / heightM)));
      this.pan.set({ x: w / 2, y: h / 2 });
    }
  }

  // ------------------------------------------------------------------ init

  private async init(): Promise<void> {
    if (!this.isBrowser) return;
    this.observeSize();
    const engine = this.forceSchematic() ? null : await this.engines.load();
    if (engine && this.mapHost()) {
      this.engine = engine;
      this.createMap();
      this.renderer.set('map');
    } else {
      this.renderer.set('schematic');
    }
    setTimeout(() => (this.center() ? this.panTo(this.center()!, this.zoom()) : this.fitAll()));
  }

  protected chooseLayer(choice: LayerChoice): void {
    this.layersOpen.set(false);
    if (choice === 'schematic') {
      this.renderer.set('schematic');
    } else {
      this.baseLayer.set(choice);
      try {
        localStorage.setItem(BASE_LAYER_KEY, choice);
      } catch {
        /* private mode: the choice lasts for this page only */
      }
      if (!this.map && this.engine && this.mapHost()) this.createMap();
      this.renderer.set(this.map ? 'map' : 'schematic');
    }
    setTimeout(() => this.fitAll());
  }

  private observeSize(): void {
    const host = (this.mapHost()?.nativeElement.parentElement ?? null) as HTMLElement | null;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.size.set({ w: width, h: height });
      if (this.fitPending && width >= 80 && height >= 80) this.fitAll();
    });
    ro.observe(host);
    this.destroyRef.onDestroy(() => ro.disconnect());
  }

  /** Padding around fitted content, smaller on small embedded maps. */
  private fitPadding(): number {
    const { w, h } = this.size();
    return Math.max(8, Math.min(48, w / 5, h / 5));
  }

  // ------------------------------------------------------------------ MapLibre renderer

  private createMap(): void {
    const engine = this.engine!;
    const host = this.mapHost()!.nativeElement;
    const center = this.center() ?? this.contentPoints()[0] ?? { lat: 45.4642, lng: 9.19 };
    const base = this.effectiveBase();
    const dark = this.theme.isDark();
    this.applied = { base, dark };
    const map = new engine.maplibregl.Map({
      container: host,
      style: engine.style(base, dark),
      center: [center.lng, center.lat],
      zoom: toMl(this.zoom()),
      minZoom: 2,
      maxZoom: toMl(20),
      // North stays up: there is no compass to turn it back.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      keyboard: false,
      cooperativeGestures: this.gestureHandling() === 'cooperative',
      // Map data credits stay visible: the OpenStreetMap and imagery licences require them.
      attributionControl: { compact: false },
      locale: {
        'Map.Title': $localize`Map`,
        'Marker.Title': $localize`Map marker`,
        'AttributionControl.ToggleAttribution': $localize`Map credits`,
        'CooperativeGesturesHandler.WindowsHelpText': $localize`Use Ctrl + scroll to zoom the map`,
        'CooperativeGesturesHandler.MacHelpText': $localize`Use ⌘ + scroll to zoom the map`,
        'CooperativeGesturesHandler.MobileHelpText': $localize`Use two fingers to move the map`,
      },
    });
    map.touchZoomRotate.disableRotation();
    map.on('styleimagemissing', (e) => {
      if (map.hasImage(e.id)) return;
      const img = this.engine?.patternImage(e.id, this.applied?.dark ?? false);
      // a few POI icons the base style names are not in its sprite: draw nothing for them
      map.addImage(e.id, img ?? { width: 1, height: 1, data: new Uint8Array(4) }, { pixelRatio: img ? 2 : 1 });
    });
    map.on('style.load', () => {
      this.addGameLayers();
      this.styleReady = true;
      this.pushShapes();
      this.pushSelf();
      this.pushMask();
      this.syncOverlay(this.overlay(), this.overlayShown() || this.overlayEditable());
    });
    map.on('zoomend', () => this.declutterLabels());
    // Tiles that fail offline are expected; the markers and shapes keep working.
    map.on('error', () => undefined);
    map.on('click', (e) => {
      this.layersOpen.set(false);
      if (Date.now() < this.suppressClickUntil) return;
      const hit = this.shapesClickable()
        ? map.queryRenderedFeatures(e.point, { layers: SHAPE_LAYERS }).find((f) => f.properties?.['zoneId'])
        : undefined;
      const zoneId = hit?.properties?.['zoneId'] as string | undefined;
      const zone = zoneId ? this.zones().find((z) => z.id === zoneId) : undefined;
      if (zone) this.zoneClick.emit(zone);
      else this.mapClick.emit({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    this.map = map;
  }

  private applyStyle(base: BaseLayer, dark: boolean): void {
    if (!this.map || !this.engine) return;
    if (this.applied?.base === base && this.applied.dark === dark) return;
    this.applied = { base, dark };
    this.styleReady = false;
    this.map.setStyle(this.engine.style(base, dark), { diff: false });
  }

  /** Game shapes draw above the base map and its labels, below the markers (DOM). */
  private addGameLayers(): void {
    const map = this.map!;
    map.addSource('ah-shapes', { type: 'geojson', data: this.shapeData });
    map.addSource('ah-self', { type: 'geojson', data: this.selfData });
    map.addSource('ah-mask', { type: 'geojson', data: this.maskData });
    // under the base map's roads and buildings: it hides woods, fields and terrain patterns, not the paths
    const above = map.getStyle().layers.find((l) => ['waterway', 'transportation', 'building', 'aeroway'].includes((l as { 'source-layer'?: string })['source-layer'] ?? ''));
    map.addLayer({ id: 'ah-mask', type: 'fill', source: 'ah-mask', paint: { 'fill-color': cssVar('--background'), 'fill-opacity': 0.88 } }, above?.id);
    map.addLayer({
      id: 'ah-fill',
      type: 'fill',
      source: 'ah-shapes',
      filter: ['==', ['get', 'fill'], true],
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] },
    });
    // A halo under every game line, so olive or green zones still read over woods and fields.
    map.addLayer({
      id: 'ah-casing',
      type: 'line',
      source: 'ah-shapes',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': this.applied?.dark ? '#000000' : '#ffffff', 'line-opacity': 0.7, 'line-width': ['+', ['get', 'width'], 3] },
    });
    for (const dash of Object.keys(DASHES) as Dash[]) {
      const pattern = DASHES[dash];
      map.addLayer({
        id: `ah-line-${dash}`,
        type: 'line',
        source: 'ah-shapes',
        filter: ['==', ['get', 'dash'], dash],
        layout: { 'line-join': 'round', 'line-cap': dash === 'dot' ? 'round' : 'butt' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
          'line-opacity': ['get', 'lineOpacity'],
          ...(pattern ? { 'line-dasharray': [...pattern] } : {}),
        },
      });
    }
    const nav = cssVar('--nav');
    map.addLayer({ id: 'ah-self-fill', type: 'fill', source: 'ah-self', paint: { 'fill-color': nav, 'fill-opacity': 0.1 } });
    map.addLayer({ id: 'ah-self-line', type: 'line', source: 'ah-self', paint: { 'line-color': nav, 'line-opacity': 0.6, 'line-width': 1 } });
  }

  private pushShapes(): void {
    if (this.styleReady) (this.map?.getSource('ah-shapes') as GeoJSONSource | undefined)?.setData(this.shapeData);
  }

  private pushMask(): void {
    if (this.styleReady) (this.map?.getSource('ah-mask') as GeoJSONSource | undefined)?.setData(this.maskData);
  }

  private pushSelf(): void {
    if (this.styleReady) (this.map?.getSource('ah-self') as GeoJSONSource | undefined)?.setData(this.selfData);
  }

  protected toggleMapLayer(id: string, on: boolean): void {
    const next = { ...this.layerChoice(), [id]: on };
    this.layerChoice.set(next);
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  }

  protected toggleOverlay(): void {
    const next = !this.overlayShown();
    this.overlayShown.set(next);
    try {
      localStorage.setItem(OVERLAY_KEY, next ? 'on' : 'off');
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  }

  /** The venue map is a raster layer right under the game shapes, so zones stay readable on top of it. */
  private syncOverlay(o: MapOverlay | null, shown: boolean): void {
    const map = this.map;
    if (!map || !this.styleReady) return;
    const src = map.getSource('ah-overlay') as ImageSource | undefined;
    if (!o || !shown) {
      if (map.getLayer('ah-overlay')) map.removeLayer('ah-overlay');
      if (src) map.removeSource('ah-overlay');
      return;
    }
    const corners = (this.overlayCorners ?? o.corners).map((c) => [c.lng, c.lat]) as [[number, number], [number, number], [number, number], [number, number]];
    if (src && src.url === o.url) {
      src.setCoordinates(corners);
      map.setPaintProperty('ah-overlay', 'raster-opacity', o.opacity);
      return;
    }
    if (src) {
      map.removeLayer('ah-overlay');
      map.removeSource('ah-overlay');
    }
    map.addSource('ah-overlay', { type: 'image', url: o.url, coordinates: corners });
    map.addLayer({ id: 'ah-overlay', type: 'raster', source: 'ah-overlay', paint: { 'raster-opacity': o.opacity, 'raster-fade-duration': 0 } }, 'ah-fill');
  }

  /** Four draggable corner handles; the image follows while dragging, the editor saves on release. */
  private syncOverlayHandles(o: MapOverlay | null): void {
    this.overlayHandles.forEach((m) => m.remove());
    this.overlayHandles = [];
    if (!o || !this.map || !this.engine) return;
    const ml = this.engine.maplibregl;
    const names = [$localize`Top-left corner`, $localize`Top-right corner`, $localize`Bottom-right corner`, $localize`Bottom-left corner`];
    o.corners.forEach((c, i) => {
      const el = cornerHandle();
      el.setAttribute('aria-label', names[i]);
      const marker = new ml.Marker({ element: el, draggable: true }).setLngLat([c.lng, c.lat]).addTo(this.map!);
      const update = () => {
        const p = marker.getLngLat();
        const next = [...(this.overlayCorners ?? o.corners)] as MapOverlay['corners'];
        next[i] = { lat: p.lat, lng: p.lng };
        this.overlayCorners = next;
        (this.map?.getSource('ah-overlay') as ImageSource | undefined)?.setCoordinates(next.map((q) => [q.lng, q.lat]) as never);
      };
      marker.on('drag', update);
      marker.on('dragend', () => {
        update();
        this.suppressClickUntil = Date.now() + 300;
        this.overlayCornersChange.emit(this.overlayCorners!);
      });
      this.overlayHandles.push(marker);
    });
  }

  /** On dense maps, labels of small zones and free text labels appear only from SMALL_LABEL_ZOOM. */
  private declutterLabels(): void {
    const z = this.map ? fromMl(this.map.getZoom()) : Infinity;
    for (const [key, min] of this.labelMinZoom) {
      const m = this.markers.get(key);
      if (m) m.el.style.display = z >= min ? '' : 'none';
    }
  }

  /**
   * Move a player's marker to a new position over the time since its previous update, so a
   * player seen every few seconds walks across the map instead of jumping. Large jumps and
   * reduced motion skip the glide.
   */
  private glideMarker(m: MarkerEntry, to: LatLng): void {
    const now = performance.now();
    if (Math.abs(to.lat - m.to.lat) < 1e-7 && Math.abs(to.lng - m.to.lng) < 1e-7) return;
    const gap = now - m.lastAt;
    m.lastAt = now;
    m.to = to;
    if (!this.isBrowser || distanceM(m.cur, to) > 150 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      m.anim = undefined;
      m.cur = to;
      m.marker.setLngLat([to.lng, to.lat]);
      return;
    }
    m.anim = { from: m.cur, start: now, dur: Math.min(3000, Math.max(300, gap)) };
    if (!this.markerAnim) this.markerAnim = requestAnimationFrame((t) => this.stepMarkers(t));
  }

  private stepMarkers(now: number): void {
    let moving = false;
    for (const m of this.markers.values()) {
      if (!m.anim) continue;
      const t = Math.min(1, (now - m.anim.start) / m.anim.dur);
      m.cur = { lat: m.anim.from.lat + (m.to.lat - m.anim.from.lat) * t, lng: m.anim.from.lng + (m.to.lng - m.anim.from.lng) * t };
      m.marker.setLngLat([m.cur.lng, m.cur.lat]);
      if (t < 1) moving = true;
      else m.anim = undefined;
    }
    this.markerAnim = moving ? requestAnimationFrame((t) => this.stepMarkers(t)) : 0;
  }

  private syncMap(d: {
    objectives: Objective[];
    pois: Poi[];
    zones: Zone[];
    positions: VisiblePosition[];
    teams: Team[];
    self: SelfFix | null;
    selected: string | null;
    geof: boolean;
    labels: boolean;
    draft: DraftShape | null;
    editable: boolean;
    shapesClickable: boolean;
  }): void {
    const map = this.map!;
    const ml = this.engine!.maplibregl;
    const teamById = new Map(d.teams.map((t) => [t.id, t]));
    const seenM = new Set<string>();
    const shapes: Feature<Geometry, ShapeProps>[] = [];

    const upsertMarker = (
      key: string,
      pos: LatLng,
      sig: string,
      build: () => HTMLElement,
      opts: { z: number; onClick?: () => void; draggable?: boolean; onDragEnd?: (p: LatLng) => void; glide?: boolean },
    ) => {
      seenM.add(key);
      const existing = this.markers.get(key);
      if (existing) {
        if (opts.glide) this.glideMarker(existing, pos);
        else {
          existing.anim = undefined;
          existing.cur = pos;
          existing.marker.setLngLat([pos.lng, pos.lat]);
        }
        if (existing.sig !== sig) {
          setMarkerContent(existing.el, build());
          existing.sig = sig;
        }
        existing.marker.setDraggable(!!opts.draggable);
        return;
      }
      // MapLibre positions the wrapper; the marker node keeps its own transform (bottom-centre anchor,
      // as the marker builders expect).
      const el = document.createElement('div');
      el.style.zIndex = String(opts.z);
      setMarkerContent(el, build());
      const marker = new ml.Marker({ element: el, anchor: 'bottom', draggable: !!opts.draggable }).setLngLat([pos.lng, pos.lat]).addTo(map);
      el.addEventListener('click', (e) => {
        // the map must not also see this tap as a tap on the empty map
        e.stopPropagation();
        if (opts.onClick && Date.now() >= this.suppressClickUntil) opts.onClick();
      });
      if (opts.onDragEnd) {
        marker.on('dragend', () => {
          this.suppressClickUntil = Date.now() + 300;
          const p = marker.getLngLat();
          opts.onDragEnd!({ lat: p.lat, lng: p.lng });
        });
      }
      this.markers.set(key, { marker, el, sig, cur: pos, to: pos, lastAt: performance.now() });
    };

    const shape = (geometry: Geometry, p: Partial<ShapeProps> & { color: string }) =>
      shapes.push({
        type: 'Feature',
        geometry,
        properties: { zoneId: null, fill: false, fillOpacity: 0, width: 2, lineOpacity: 0.95, dash: 'solid', ...p },
      });

    // zones
    this.labelMinZoom.clear();
    const dense = d.zones.filter((z) => z.label || z.kind === 'label').length > DENSE_LABELS;
    for (const z of d.zones) {
      const fillOpacity = z.kind === 'playable' ? Math.min(z.fillOpacity, 0.08) : z.fillOpacity;
      const dash: Dash = z.kind === 'restricted' || z.kind === 'line' ? 'dash' : z.kind === 'route' ? 'dot' : 'solid';
      const zoneId = d.shapesClickable ? z.id : null;
      const click = d.shapesClickable ? () => this.zoneClick.emit(this.zones().find((x) => x.id === z.id) ?? z) : undefined;
      if (z.geometry === 'polygon' && z.points.length >= 3) {
        shape(polygon(z.points), { zoneId, color: z.color, fill: true, fillOpacity, width: z.strokeWidth, dash });
      } else if (z.geometry === 'polyline' && z.points.length >= 2) {
        shape(line(z.points), { zoneId, color: z.color, width: z.strokeWidth + 1, dash });
      } else if (z.geometry === 'circle' && z.points[0] && z.radiusM) {
        shape(circle(z.points[0], z.radiusM), { zoneId, color: z.color, fill: true, fillOpacity, width: z.strokeWidth, dash });
      }
      const labelAt = z.geometry === 'point' || z.kind === 'label' ? z.points[0] : null;
      if ((labelAt || (d.labels && z.label)) && z.points[0]) {
        const at = labelAt ?? centroidOf(z.points);
        upsertMarker(`zl:${z.id}`, at, `${z.label}|${z.color}`, () => zoneLabel(z.label || z.kind, z.color), { z: 10, onClick: click ?? (() => this.zoneClick.emit(z)) });
        if (dense && (labelAt || spanM(z.points) < 80)) this.labelMinZoom.set(`zl:${z.id}`, SMALL_LABEL_ZOOM);
      }
    }

    // objectives + geofence rings
    for (const o of d.objectives) {
      const owner = o.ownerTeamId ? (teamById.get(o.ownerTeamId) ?? null) : null;
      const capturing = o.capture ? (teamById.get(o.capture.teamId) ?? null) : null;
      const selected = d.selected === o.id;
      const sig = JSON.stringify([o.status, o.ownerTeamId, o.color, o.name, o.jammedUntil, selected, d.labels, owner?.color, capturing?.id, capturing?.color]);
      const build = () => objectiveMarker(o, owner, selected, d.labels, capturing, o.capture ? capturePct(o.capture, this.serverNow()) : 0);
      upsertMarker(`o:${o.id}`, { lat: o.lat, lng: o.lng }, sig, build, {
        z: 300,
        onClick: () => this.objectiveClick.emit(this.objectives().find((x) => x.id === o.id) ?? o),
        draggable: d.editable,
        onDragEnd: (p) => this.markerMoved.emit({ kind: 'objective', id: o.id, position: p }),
      });
      if (d.geof && (o.methods.includes('geofence') || o.requireGeofence) && o.geofence.radiusM > 0) {
        const color = o.status === 'contested' ? cssVar('--destructive') : o.color;
        shape(circle(o, o.geofence.radiusM), { color, fill: true, fillOpacity: 0.12, width: 2, lineOpacity: 0.9 });
      }
    }

    // POIs
    for (const p of d.pois) {
      const selected = d.selected === p.id;
      upsertMarker(`p:${p.id}`, { lat: p.lat, lng: p.lng }, JSON.stringify([p.type, p.color, p.name, selected, d.labels]), () => poiMarker(p, selected, d.labels), {
        z: 200,
        onClick: () => this.poiClick.emit(this.pois().find((x) => x.id === p.id) ?? p),
        draggable: d.editable,
        onDragEnd: (pos) => this.markerMoved.emit({ kind: 'poi', id: p.id, position: pos }),
      });
    }

    // players
    for (const pos of d.positions) {
      if (pos.kind === 'self') continue; // the live GPS fix is drawn separately
      const key = `u:${pos.userId}:${pos.kind}`;
      const team = pos.teamId ? (teamById.get(pos.teamId) ?? null) : null;
      const selected = d.selected === pos.userId;
      const sig = JSON.stringify([pos.status, pos.kind, pos.nickname, pos.playerRole, team?.color, selected, d.labels]);
      upsertMarker(key, { lat: pos.lat, lng: pos.lng }, sig, () => playerMarker(pos, team, { selected, showLabel: d.labels }), {
        z: pos.kind === 'ally' ? 500 : 450,
        onClick: () => this.playerClick.emit(this.positions().find((x) => x.userId === pos.userId && x.kind === pos.kind) ?? pos),
        glide: true,
      });
      if (pos.radiusM && pos.radiusM > 0) {
        const color = pos.kind === 'ally' ? (team?.color ?? '#888') : cssVar('--destructive');
        shape(circle(pos, pos.radiusM), { color, fill: true, fillOpacity: 0.15, width: 1, lineOpacity: 0.7, dash: 'dash' });
      }
    }

    // self (the dot and its accuracy circle are moved in place by moveSelf())
    if (d.self) {
      const at = this.selfDrawn() ?? d.self;
      upsertMarker('self', at, `self|${Math.round((d.self.heading ?? -1) / 10)}`, () => selfMarker(d.self!.heading), { z: 1000 });
      this.selfData = { type: 'FeatureCollection', features: [circleFeature(at, at.accuracy, {})] };
    } else {
      this.selfData = { type: 'FeatureCollection', features: [] };
    }

    // draft shape (editor)
    if (d.draft && d.draft.points.length) {
      const dr = d.draft;
      if (dr.geometry === 'polygon') {
        if (dr.points.length >= 3) shape(polygon(dr.points), { color: dr.color, fill: true, fillOpacity: 0.2, width: 2, dash: 'dash' });
        else if (dr.points.length === 2) shape(line(dr.points), { color: dr.color, width: 2, dash: 'dash' });
      } else if (dr.geometry === 'polyline' && dr.points.length >= 2) {
        shape(line(dr.points), { color: dr.color, width: 3, dash: 'dash' });
      } else if (dr.geometry === 'circle' && dr.radiusM) {
        shape(circle(dr.points[0], dr.radiusM), { color: dr.color, fill: true, fillOpacity: 0.2, width: 2, dash: 'dash' });
      }
      dr.points.forEach((p, i) => upsertMarker(`dv:${i}`, p, `dv|${dr.color}`, () => vertexDot(dr.color), { z: 2000 }));
    }

    for (const [k, m] of this.markers) {
      if (!seenM.has(k)) {
        m.marker.remove();
        this.markers.delete(k);
      }
    }
    this.shapeData = { type: 'FeatureCollection', features: shapes };
    this.pushShapes();
    this.pushSelf();
    this.declutterLabels();
  }

  // ------------------------------------------------------------------ schematic renderer

  private project(p: LatLng): { x: number; y: number } {
    const o = this.origin();
    return {
      x: (p.lng - o.lng) * M_PER_DEG_LNG_EQ * Math.cos((o.lat * Math.PI) / 180),
      y: -(p.lat - o.lat) * M_PER_DEG_LAT,
    };
  }

  private unproject(px: number, py: number): LatLng {
    const o = this.origin();
    const s = this.scale();
    const pan = this.pan();
    const mx = (px - pan.x) / s;
    const my = (py - pan.y) / s;
    return {
      lat: o.lat - my / M_PER_DEG_LAT,
      lng: o.lng + mx / (M_PER_DEG_LNG_EQ * Math.cos((o.lat * Math.PI) / 180)),
    };
  }

  private toScreen(p: LatLng): { x: number; y: number } {
    const m = this.project(p);
    const pan = this.pan();
    const s = this.scale();
    return { x: m.x * s + pan.x, y: m.y * s + pan.y };
  }

  protected readonly gridMeters = computed(() => {
    const target = 90 / this.scale(); // aim for ~90px cells
    const steps = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
    return steps.find((s) => s >= target) ?? 10000;
  });
  protected readonly gridPx = computed(() => this.gridMeters() * this.scale());
  protected readonly gridOffset = computed(() => {
    const g = this.gridPx();
    const pan = this.pan();
    return { x: ((pan.x % g) + g) % g, y: ((pan.y % g) + g) % g };
  });

  /** The venue map in the schematic view: only for images placed north-up (as the field tools make them). */
  protected readonly schematicImage = computed(() => {
    const o = this.overlay();
    if (!o || !this.overlayShown()) return null;
    this.scale();
    this.pan();
    this.origin();
    const [tl, tr, br, bl] = o.corners;
    const eps = 1e-6;
    if (Math.abs(tl.lat - tr.lat) > eps || Math.abs(bl.lat - br.lat) > eps || Math.abs(tl.lng - bl.lng) > eps || Math.abs(tr.lng - br.lng) > eps) return null;
    const a = this.toScreen(tl);
    const b = this.toScreen(br);
    return { url: o.url, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, opacity: o.opacity };
  });

  protected readonly schematicZones = computed(() => {
    this.scale();
    this.pan();
    this.origin();
    const s = this.scale();
    const list: {
      id: string;
      kind: 'circle' | 'polygon' | 'polyline';
      points?: string;
      cx?: number;
      cy?: number;
      r?: number;
      color: string;
      fillOpacity: number;
      strokeWidth: number;
      dash: string | null;
    }[] = [];
    const pts = (arr: LatLng[]) => arr.map((p) => this.toScreen(p)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    for (const z of this.shownZones()) {
      const fillOpacity = z.kind === 'playable' ? Math.min(z.fillOpacity, 0.08) : z.fillOpacity;
      const dash = z.kind === 'restricted' || z.kind === 'line' ? '6 4' : z.kind === 'route' ? '2 4' : null;
      if (z.geometry === 'polygon' && z.points.length >= 3) {
        list.push({ id: z.id, kind: 'polygon', points: pts(z.points), color: z.color, fillOpacity, strokeWidth: z.strokeWidth, dash });
      } else if (z.geometry === 'polyline' && z.points.length >= 2) {
        list.push({ id: z.id, kind: 'polyline', points: pts(z.points), color: z.color, fillOpacity: 0, strokeWidth: z.strokeWidth + 1, dash });
      } else if (z.geometry === 'circle' && z.points[0] && z.radiusM) {
        const c = this.toScreen(z.points[0]);
        list.push({ id: z.id, kind: 'circle', cx: c.x, cy: c.y, r: z.radiusM * s, color: z.color, fillOpacity, strokeWidth: z.strokeWidth, dash });
      }
    }
    if (this.showGeofences()) {
      for (const o of this.objectives()) {
        if ((o.methods.includes('geofence') || o.requireGeofence) && o.geofence.radiusM > 0) {
          const c = this.toScreen(o);
          const color = o.status === 'contested' ? cssVar('--destructive') : o.color;
          list.push({ id: `g:${o.id}`, kind: 'circle', cx: c.x, cy: c.y, r: o.geofence.radiusM * s, color, fillOpacity: 0.12, strokeWidth: 2, dash: null });
        }
      }
    }
    for (const p of this.positions()) {
      if (p.radiusM) {
        const c = this.toScreen(p);
        const team = this.teams().find((t) => t.id === p.teamId);
        const color = p.kind === 'ally' ? (team?.color ?? '#888') : cssVar('--destructive');
        list.push({ id: `a:${p.userId}:${p.kind}`, kind: 'circle', cx: c.x, cy: c.y, r: p.radiusM * s, color, fillOpacity: 0.15, strokeWidth: 1, dash: '3 3' });
      }
    }
    const self = this.selfDrawn();
    if (self) {
      const c = this.toScreen(self);
      list.push({ id: 'acc', kind: 'circle', cx: c.x, cy: c.y, r: self.accuracy * s, color: cssVar('--nav'), fillOpacity: 0.1, strokeWidth: 1, dash: null });
    }
    const dr = this.draft();
    if (dr && dr.points.length) {
      if (dr.geometry === 'circle' && dr.radiusM) {
        const c = this.toScreen(dr.points[0]);
        list.push({ id: 'draft', kind: 'circle', cx: c.x, cy: c.y, r: dr.radiusM * s, color: dr.color, fillOpacity: 0.2, strokeWidth: 2, dash: '4 3' });
      } else if (dr.points.length >= 2) {
        list.push({
          id: 'draft',
          kind: dr.geometry === 'polygon' && dr.points.length >= 3 ? 'polygon' : 'polyline',
          points: pts(dr.points),
          color: dr.color,
          fillOpacity: 0.2,
          strokeWidth: 2,
          dash: '4 3',
        });
      }
    }
    return list;
  });

  private syncSchematicOverlay(): void {
    const host = this.schematicOverlay()?.nativeElement;
    if (!host) return;
    host.replaceChildren();
    const { w, h } = this.size();
    const place = (node: HTMLElement, p: LatLng, z: number) => {
      const s = this.toScreen(p);
      if (s.x < -60 || s.y < -60 || s.x > w + 60 || s.y > h + 60) return;
      node.style.position = 'absolute';
      node.style.left = `${s.x}px`;
      node.style.top = `${s.y}px`;
      // markers are built for a bottom-centre anchor; centre them here instead
      node.style.transform = 'translate(-50%, -50%)';
      node.style.zIndex = String(z);
      host.appendChild(node);
    };
    const teamById = new Map(this.teams().map((t) => [t.id, t]));
    const labels = this.showLabels();
    for (const z of this.shownZones()) {
      if ((z.geometry === 'point' || z.kind === 'label' || (labels && z.label)) && z.points[0]) {
        const node = zoneLabel(z.label || z.kind, z.color);
        node.addEventListener('click', () => this.zoneClick.emit(z));
        place(node, z.geometry === 'point' || z.kind === 'label' ? z.points[0] : centroidOf(z.points), 10);
      }
    }
    for (const p of this.pois()) {
      const node = poiMarker(p, this.selectedId() === p.id, labels);
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        this.poiClick.emit(p);
      });
      place(node, p, 20);
    }
    for (const o of this.objectives()) {
      const owner = o.ownerTeamId ? (teamById.get(o.ownerTeamId) ?? null) : null;
      const capturing = o.capture ? (teamById.get(o.capture.teamId) ?? null) : null;
      const node = objectiveMarker(o, owner, this.selectedId() === o.id, labels, capturing, o.capture ? capturePct(o.capture, this.serverNow()) : 0);
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        this.objectiveClick.emit(o);
      });
      place(node, o, 30);
    }
    for (const pos of this.positions()) {
      if (pos.kind === 'self') continue;
      const team = pos.teamId ? (teamById.get(pos.teamId) ?? null) : null;
      const node = playerMarker(pos, team, { selected: this.selectedId() === pos.userId, showLabel: labels });
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        this.playerClick.emit(pos);
      });
      place(node, pos, pos.kind === 'ally' ? 50 : 45);
    }
    const dr = this.draft();
    dr?.points.forEach((p) => place(vertexDot(dr.color), p, 90));
    const self = this.self();
    this.selfNode = self ? selfMarker(self.heading) : null;
    if (this.selfNode) place(this.selfNode, this.selfDrawn() ?? self!, 100);
  }

  protected onPointerDown(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragStart = { x: e.clientX, y: e.clientY, pan: this.pan(), moved: false };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: this.scale() };
      this.dragStart = null;
    }
  }

  protected onPointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && this.pinchStart) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = this.schematicHost()!.nativeElement.getBoundingClientRect();
      this.zoomAround(this.pinchStart.scale * (dist / this.pinchStart.dist), (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
    } else if (this.dragStart) {
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      if (!this.dragStart.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        this.dragStart.moved = true;
        // Captured only once it is a drag: a capture from pointerdown sends a tap's click to the
        // map instead of the marker under the finger.
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }
      this.pan.set({ x: this.dragStart.pan.x + dx, y: this.dragStart.pan.y + dy });
    }
  }

  protected onPointerUp(e: PointerEvent): void {
    const wasTap = this.dragStart && !this.dragStart.moved && this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    // A tap on a marker is the marker's click, not a tap on the empty map.
    if (wasTap && e.type === 'pointerup' && !(e.target as Element).closest('button, [role="button"]')) {
      const rect = this.schematicHost()!.nativeElement.getBoundingClientRect();
      this.mapClick.emit(this.unproject(e.clientX - rect.left, e.clientY - rect.top));
    }
    this.dragStart = null;
  }

  protected onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.schematicHost()!.nativeElement.getBoundingClientRect();
    this.zoomAround(this.scale() * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - rect.left, e.clientY - rect.top);
  }

  protected zoomBy(f: number): void {
    if (this.renderer() === 'map' && this.map) {
      this.map.zoomTo(this.map.getZoom() + (f > 1 ? 1 : -1), { duration: 200 });
      return;
    }
    const { w, h } = this.size();
    this.zoomAround(this.scale() * f, w / 2, h / 2);
  }

  private zoomAround(newScale: number, cx: number, cy: number): void {
    const s = Math.min(20, Math.max(0.02, newScale));
    const pan = this.pan();
    const k = s / this.scale();
    this.pan.set({ x: cx - (cx - pan.x) * k, y: cy - (cy - pan.y) * k });
    this.scale.set(s);
  }

  // ------------------------------------------------------------------ helpers

  private contentPoints(): LatLng[] {
    const playable = this.zones().filter((z) => z.kind === 'playable').flatMap((z) => z.points);
    if (playable.length) return playable;
    return [
      ...this.zones().flatMap((z) => z.points),
      ...this.objectives().map((o) => ({ lat: o.lat, lng: o.lng })),
      ...this.pois().map((p) => ({ lat: p.lat, lng: p.lng })),
      ...(this.self() ? [this.self()!] : []),
      ...(this.center() ? [this.center()!] : []),
    ];
  }
}

const SHAPE_LAYERS = ['ah-fill', ...Object.keys(DASHES).map((d) => `ah-line-${d}`)];

function readLayerChoice(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? '{}');
    return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, on]) => typeof on === 'boolean')) as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

function readOverlayShown(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(OVERLAY_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Largest extent of a shape, in metres (bounding box diagonal). */
function spanM(points: LatLng[]): number {
  if (points.length < 2) return 0;
  const b = bounds(points)!;
  return distanceM({ lat: b.south, lng: b.west }, { lat: b.north, lng: b.east });
}

function cornerHandle(): HTMLElement {
  const d = document.createElement('div');
  Object.assign(d.style, {
    width: '22px',
    height: '22px',
    borderRadius: '4px',
    background: 'rgba(255,255,255,0.9)',
    border: '3px solid #E6B04F',
    boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
    cursor: 'move',
  });
  return d;
}

function readBaseLayer(): BaseLayer {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(BASE_LAYER_KEY) === 'satellite' ? 'satellite' : 'topo';
  } catch {
    return 'topo';
  }
}

/**
 * Put a marker node into its MapLibre wrapper. The wrapper is the element MapLibre gives
 * role="button", so it takes the node's accessible name and the node stops being a second button.
 */
function setMarkerContent(wrapper: HTMLElement, node: HTMLElement): void {
  const label = node.getAttribute('aria-label') ?? node.title;
  if (label) wrapper.setAttribute('aria-label', label);
  node.removeAttribute('role');
  node.removeAttribute('aria-label');
  wrapper.replaceChildren(node);
}

function polygon(points: LatLng[]): Geometry {
  const ring = points.map((p) => [p.lng, p.lat]);
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

function line(points: LatLng[]): Geometry {
  return { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) };
}

/** A circle on the ground as a 64-sided polygon. */
function circle(c: LatLng, radiusM: number): Geometry {
  const ring: number[][] = [];
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = radiusM / (M_PER_DEG_LNG_EQ * Math.cos((c.lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    ring.push([c.lng + dLng * Math.cos(a), c.lat + dLat * Math.sin(a)]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

function circleFeature(c: LatLng, radiusM: number, properties: Record<string, unknown>): Feature {
  return { type: 'Feature', geometry: circle(c, radiusM), properties };
}

function centroidOf(points: LatLng[]): LatLng {
  const s = points.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: s.lat / points.length, lng: s.lng / points.length };
}

function vertexDot(color: string): HTMLElement {
  const d = document.createElement('div');
  Object.assign(d.style, {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    background: '#fff',
    border: `3px solid ${color}`,
    transform: 'translateY(50%)',
  });
  return d;
}

function cssVar(name: string): string {
  if (typeof getComputedStyle === 'undefined') return '#f0595c';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#f0595c';
}
