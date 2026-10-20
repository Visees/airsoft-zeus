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
import { LatLng, Objective, Poi, Team, VisiblePosition, Zone } from '../../core/api/models';
import { MapsLoaderService } from '../../core/maps/maps-loader.service';
import { objectiveMarker, playerMarker, poiMarker, selfMarker, zoneLabel } from '../../core/maps/markers';
import { ThemeService } from '../../core/theme/theme.service';
import { bounds } from '../../core/util/geo';

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

type Renderer = 'loading' | 'google' | 'schematic';

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG_EQ = 111_320;

/**
 * Tactical map used by every map screen.
 *
 * Renders with Google Maps (AdvancedMarkerElement) when the API key is configured and the
 * device is online; otherwise with a built-in schematic SVG renderer that works offline from
 * the cached event data (zones, objectives, POIs, positions on a metric grid).
 *
 * Everything shown is already filtered by the server for the viewer; this component never
 * decides visibility.
 */
@Component({
  selector: 'zeus-tactical-map',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block overflow-hidden bg-muted', role: 'region', '[attr.aria-label]': 'ariaLabel()' },
  template: `
    <div #googleHost class="absolute inset-0" [class.invisible]="renderer() !== 'google'"></div>

    @if (renderer() === 'schematic') {
      <div
        #schematicHost
        class="absolute inset-0 touch-none select-none overflow-hidden"
        [style.background]="'var(--background)'"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerUp($event)"
        (wheel)="onWheel($event)"
      >
        <svg class="absolute inset-0 size-full" aria-hidden="true">
          <defs>
            <pattern id="zeus-grid" [attr.width]="gridPx()" [attr.height]="gridPx()" patternUnits="userSpaceOnUse"
              [attr.x]="gridOffset().x" [attr.y]="gridOffset().y">
              <path [attr.d]="'M ' + gridPx() + ' 0 L 0 0 0 ' + gridPx()" fill="none" stroke="var(--border)" stroke-width="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#zeus-grid)" />
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
          <span>· Schematic view{{ mapsState() === 'unavailable' ? ' (map tiles unavailable)' : '' }}</span>
        </div>
      </div>
    }

    @if (renderer() === 'loading') {
      <div class="absolute inset-0 grid place-items-center text-sm text-muted-foreground" role="status">Loading map…</div>
    }

    <div class="absolute right-2 top-2 z-[1] flex flex-col gap-1.5" [class.!top-auto]="controlsBottom()" [class.!bottom-24]="controlsBottom()">
      @if (renderer() === 'schematic') {
        <button type="button" class="hud grid size-11 place-items-center" (click)="zoomBy(1.4)" aria-label="Zoom in">
          <ng-icon name="lucidePlus" size="18" aria-hidden="true" />
        </button>
        <button type="button" class="hud grid size-11 place-items-center" (click)="zoomBy(1 / 1.4)" aria-label="Zoom out">
          <ng-icon name="lucideMinus" size="18" aria-hidden="true" />
        </button>
      }
      <button type="button" class="hud grid size-11 place-items-center" (click)="fitAll()" aria-label="Show the whole area">
        <ng-icon name="lucideMaximize2" size="18" aria-hidden="true" />
      </button>
      @if (self()) {
        <button type="button" class="hud grid size-11 place-items-center text-nav" (click)="centerOnSelf()" aria-label="Center on my position">
          <ng-icon name="lucideLocateFixed" size="18" aria-hidden="true" />
        </button>
      }
      @if (allowRendererToggle() && mapsState() === 'ready') {
        <button type="button" class="hud grid size-11 place-items-center" (click)="toggleRenderer()"
          [attr.aria-label]="renderer() === 'google' ? 'Switch to schematic view' : 'Switch to satellite map'">
          <ng-icon [name]="renderer() === 'google' ? 'lucideLayers' : 'lucideMap'" size="18" aria-hidden="true" />
        </button>
      }
    </div>
  `,
})
export class TacticalMap {
  private readonly loader = inject(MapsLoaderService);
  private readonly theme = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);
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
  readonly mapType = input<'hybrid' | 'roadmap' | 'satellite' | 'terrain'>('hybrid');

  readonly objectiveClick = output<Objective>();
  readonly poiClick = output<Poi>();
  readonly playerClick = output<VisiblePosition>();
  readonly zoneClick = output<Zone>();
  readonly mapClick = output<LatLng>();
  readonly markerMoved = output<MarkerMove>();

  protected readonly renderer = signal<Renderer>('loading');
  protected readonly mapsState = this.loader.state;
  private readonly userPrefersSchematic = signal(false);

  private readonly googleHost = viewChild<ElementRef<HTMLDivElement>>('googleHost');
  private readonly schematicHost = viewChild<ElementRef<HTMLDivElement>>('schematicHost');
  private readonly schematicOverlay = viewChild<ElementRef<HTMLDivElement>>('schematicOverlay');

  /** The Google map instance, for editors that add their own listeners. */
  map: google.maps.Map | null = null;
  private readonly markers = new Map<string, { marker: google.maps.marker.AdvancedMarkerElement; sig: string }>();
  private readonly shapes = new Map<string, { shape: google.maps.MVCObject & { setMap(m: google.maps.Map | null): void }; sig: string }>();
  private listeners: google.maps.MapsEventListener[] = [];

  // schematic view state: origin (lat/lng of projection), scale px/m, pan offset px
  private readonly origin = signal<LatLng>({ lat: 45.0, lng: 9.0 });
  private readonly scale = signal(0.6);
  private readonly pan = signal({ x: 0, y: 0 });
  private readonly size = signal({ w: 400, h: 400 });
  private pointers = new Map<number, { x: number; y: number }>();
  private dragStart: { x: number; y: number; pan: { x: number; y: number }; moved: boolean } | null = null;
  private pinchStart: { dist: number; scale: number } | null = null;

  protected readonly ariaLabel = computed(
    () =>
      `Tactical map: ${this.objectives().length} objectives, ${this.positions().length} players visible` +
      (this.renderer() === 'schematic' ? ', schematic view' : ''),
  );

  constructor() {
    afterNextRender(() => void this.init());

    // Google renderer sync
    effect(() => {
      const r = this.renderer();
      const data = {
        objectives: this.objectives(),
        pois: this.pois(),
        zones: this.zones(),
        positions: this.positions(),
        teams: this.teams(),
        self: this.self(),
        selected: this.selectedId(),
        geof: this.showGeofences(),
        labels: this.showLabels(),
        draft: this.draft(),
        editable: this.editable(),
      };
      if (r === 'google' && this.map) untracked(() => this.syncGoogle(data));
    });
    effect(() => {
      const dark = this.theme.isDark();
      if (this.map && this.renderer() === 'google') untracked(() => this.applyColorScheme(dark));
    });
    // Schematic overlay sync (markers are DOM nodes positioned over the SVG)
    effect(() => {
      if (this.renderer() !== 'schematic') return;
      this.objectives();
      this.pois();
      this.positions();
      this.zones();
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
      this.listeners.forEach((l) => l.remove());
      this.markers.forEach((m) => (m.marker.map = null));
      this.shapes.forEach((s) => s.shape.setMap(null));
    });
  }

  // ------------------------------------------------------------------ public API

  panTo(p: LatLng, zoom?: number): void {
    if (this.renderer() === 'google' && this.map) {
      this.map.panTo(p);
      if (zoom) this.map.setZoom(zoom);
    } else if (this.renderer() === 'schematic') {
      const { w, h } = this.size();
      const pt = this.project(p);
      this.pan.set({ x: w / 2 - pt.x * this.scale(), y: h / 2 - pt.y * this.scale() });
    }
  }

  centerOnSelf(): void {
    const s = this.self();
    if (s) this.panTo(s, Math.max(this.map?.getZoom() ?? 17, 17));
  }

  fitAll(): void {
    const pts = this.contentPoints();
    if (!pts.length) {
      const c = this.center();
      if (c) this.panTo(c, this.zoom());
      return;
    }
    if (this.renderer() === 'google' && this.map) {
      if (pts.length === 1) {
        this.map.setCenter(pts[0]);
        this.map.setZoom(17);
        return;
      }
      const b = bounds(pts)!;
      this.map.fitBounds({ north: b.north, south: b.south, east: b.east, west: b.west }, 48);
    } else if (this.renderer() === 'schematic') {
      const b = bounds(pts)!;
      const center = { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };
      this.origin.set(center);
      const ne = this.project({ lat: b.north, lng: b.east });
      const sw = this.project({ lat: b.south, lng: b.west });
      const widthM = Math.max(60, Math.abs(ne.x - sw.x));
      const heightM = Math.max(60, Math.abs(ne.y - sw.y));
      const { w, h } = this.size();
      this.scale.set(Math.min((w - 64) / widthM, (h - 64) / heightM));
      this.pan.set({ x: w / 2, y: h / 2 });
    }
  }

  // ------------------------------------------------------------------ init

  private async init(): Promise<void> {
    if (!this.isBrowser) return;
    this.observeSize();
    const ok = !this.forceSchematic() && (await this.loader.load());
    if (ok && this.googleHost()) {
      this.createGoogleMap();
      this.renderer.set('google');
    } else {
      this.renderer.set('schematic');
    }
    setTimeout(() => (this.center() ? this.panTo(this.center()!, this.zoom()) : this.fitAll()));
  }

  protected toggleRenderer(): void {
    const next = this.renderer() === 'google' ? 'schematic' : 'google';
    if (next === 'google' && !this.map && this.googleHost()) this.createGoogleMap();
    this.userPrefersSchematic.set(next === 'schematic');
    this.renderer.set(next);
    setTimeout(() => this.fitAll());
  }

  private observeSize(): void {
    const host = (this.googleHost()?.nativeElement.parentElement ?? null) as HTMLElement | null;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const prev = this.size();
      this.size.set({ w: width, h: height });
      if (prev.w === 400 && prev.h === 400 && this.renderer() === 'schematic') this.fitAll();
    });
    ro.observe(host);
    this.destroyRef.onDestroy(() => ro.disconnect());
  }

  // ------------------------------------------------------------------ Google renderer

  private createGoogleMap(): void {
    const host = this.googleHost()!.nativeElement;
    const center = this.center() ?? this.contentPoints()[0] ?? { lat: 45.4642, lng: 9.19 };
    this.map = new google.maps.Map(host, {
      center,
      zoom: this.zoom(),
      mapId: this.loader.mapId ?? 'DEMO_MAP_ID',
      mapTypeId: this.mapType(),
      disableDefaultUI: true,
      zoomControl: true,
      scaleControl: true,
      rotateControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: 'greedy',
      colorScheme: this.theme.isDark() ? google.maps.ColorScheme.DARK : google.maps.ColorScheme.LIGHT,
    });
    this.listeners.push(
      this.map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) this.mapClick.emit({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      }),
    );
  }

  private applyColorScheme(_dark: boolean): void {
    // colorScheme is fixed at construction time for vector maps; hybrid imagery is unaffected.
  }

  private syncGoogle(d: {
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
  }): void {
    const map = this.map!;
    const teamById = new Map(d.teams.map((t) => [t.id, t]));
    const seenM = new Set<string>();
    const seenS = new Set<string>();

    const upsertMarker = (
      key: string,
      pos: LatLng,
      sig: string,
      build: () => HTMLElement,
      opts: { z: number; onClick?: () => void; draggable?: boolean; onDragEnd?: (p: LatLng) => void },
    ) => {
      seenM.add(key);
      const existing = this.markers.get(key);
      if (existing) {
        existing.marker.position = pos;
        if (existing.sig !== sig) {
          existing.marker.content = build();
          existing.sig = sig;
        }
        existing.marker.gmpDraggable = !!opts.draggable;
        return;
      }
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: pos,
        content: build(),
        zIndex: opts.z,
        gmpDraggable: !!opts.draggable,
      });
      if (opts.onClick) marker.addListener('click', opts.onClick);
      if (opts.onDragEnd) {
        marker.addListener('dragend', () => {
          const p = marker.position as google.maps.LatLngLiteral | google.maps.LatLng | null;
          if (!p) return;
          const ll = p instanceof google.maps.LatLng ? { lat: p.lat(), lng: p.lng() } : { lat: p.lat, lng: p.lng };
          opts.onDragEnd!(ll);
        });
      }
      this.markers.set(key, { marker, sig });
    };

    const upsertShape = (key: string, sig: string, build: () => google.maps.MVCObject & { setMap(m: google.maps.Map | null): void }, onClick?: () => void) => {
      seenS.add(key);
      const existing = this.shapes.get(key);
      if (existing && existing.sig === sig) return;
      existing?.shape.setMap(null);
      const shape = build();
      shape.setMap(map);
      if (onClick) google.maps.event.addListener(shape, 'click', onClick);
      this.shapes.set(key, { shape, sig });
    };

    // zones
    for (const z of d.zones) {
      const style = zoneStyle(z);
      const sig = JSON.stringify([z.points, z.radiusM, z.color, z.fillOpacity, z.strokeWidth, z.kind, z.geometry]);
      const click = () => this.zoneClick.emit(z);
      if (z.geometry === 'polygon' && z.points.length >= 3) {
        upsertShape(`z:${z.id}`, sig, () => new google.maps.Polygon({ paths: z.points, ...style.poly, clickable: true }), click);
      } else if (z.geometry === 'polyline' && z.points.length >= 2) {
        upsertShape(`z:${z.id}`, sig, () => new google.maps.Polyline({ path: z.points, ...style.line, clickable: true }), click);
      } else if (z.geometry === 'circle' && z.points[0] && z.radiusM) {
        upsertShape(`z:${z.id}`, sig, () => new google.maps.Circle({ center: z.points[0], radius: z.radiusM!, ...style.poly, clickable: true }), click);
      }
      const labelAt = z.geometry === 'point' || z.kind === 'label' ? z.points[0] : null;
      if ((labelAt || (d.labels && z.label)) && z.points[0]) {
        const at = labelAt ?? centroidOf(z.points);
        upsertMarker(`zl:${z.id}`, at, `${z.label}|${z.color}`, () => zoneLabel(z.label || z.kind, z.color), { z: 10, onClick: click });
      }
    }

    // objectives + geofence rings
    for (const o of d.objectives) {
      const owner = o.ownerTeamId ? (teamById.get(o.ownerTeamId) ?? null) : null;
      const selected = d.selected === o.id;
      const sig = JSON.stringify([o.status, o.ownerTeamId, o.color, o.name, o.jammedUntil, selected, d.labels, owner?.color]);
      upsertMarker(`o:${o.id}`, { lat: o.lat, lng: o.lng }, sig, () => objectiveMarker(o, owner, selected, d.labels), {
        z: 300,
        onClick: () => this.objectiveClick.emit(o),
        draggable: d.editable,
        onDragEnd: (p) => this.markerMoved.emit({ kind: 'objective', id: o.id, position: p }),
      });
      if (d.geof && (o.methods.includes('geofence') || o.requireGeofence) && o.geofence.radiusM > 0) {
        const color = o.status === 'contested' ? cssVar('--destructive') : o.color;
        upsertShape(`g:${o.id}`, JSON.stringify([o.lat, o.lng, o.geofence.radiusM, color]), () =>
          new google.maps.Circle({
            center: { lat: o.lat, lng: o.lng },
            radius: o.geofence.radiusM,
            strokeColor: color,
            strokeOpacity: 0.9,
            strokeWeight: 2,
            fillColor: color,
            fillOpacity: 0.12,
            clickable: false,
          }),
        );
      }
    }

    // POIs
    for (const p of d.pois) {
      const selected = d.selected === p.id;
      upsertMarker(`p:${p.id}`, { lat: p.lat, lng: p.lng }, JSON.stringify([p.type, p.color, p.name, selected, d.labels]), () => poiMarker(p, selected, d.labels), {
        z: 200,
        onClick: () => this.poiClick.emit(p),
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
        onClick: () => this.playerClick.emit(pos),
      });
      if (pos.radiusM && pos.radiusM > 0) {
        const color = pos.kind === 'ally' ? (team?.color ?? '#888') : cssVar('--destructive');
        upsertShape(`a:${key}`, JSON.stringify([pos.lat, pos.lng, pos.radiusM, color]), () =>
          new google.maps.Circle({
            center: { lat: pos.lat, lng: pos.lng },
            radius: pos.radiusM!,
            strokeColor: color,
            strokeOpacity: 0.7,
            strokeWeight: 1,
            fillColor: color,
            fillOpacity: 0.15,
            clickable: false,
          }),
        );
      }
    }

    // self
    if (d.self) {
      upsertMarker('self', d.self, `self|${Math.round((d.self.heading ?? -1) / 10)}`, () => selfMarker(d.self!.heading), { z: 1000 });
      upsertShape('acc', JSON.stringify([d.self.lat.toFixed(6), d.self.lng.toFixed(6), Math.round(d.self.accuracy)]), () =>
        new google.maps.Circle({
          center: d.self!,
          radius: d.self!.accuracy,
          strokeColor: cssVar('--nav'),
          strokeOpacity: 0.6,
          strokeWeight: 1,
          fillColor: cssVar('--nav'),
          fillOpacity: 0.1,
          clickable: false,
        }),
      );
    }

    // draft shape (editor)
    if (d.draft && d.draft.points.length) {
      const dr = d.draft;
      const sig = JSON.stringify(dr);
      if (dr.geometry === 'polygon') {
        upsertShape('draft', sig, () =>
          dr.points.length >= 3
            ? new google.maps.Polygon({ paths: dr.points, strokeColor: dr.color, strokeWeight: 2, fillColor: dr.color, fillOpacity: 0.2, clickable: false })
            : new google.maps.Polyline({ path: dr.points, strokeColor: dr.color, strokeWeight: 2, clickable: false }),
        );
      } else if (dr.geometry === 'polyline') {
        upsertShape('draft', sig, () => new google.maps.Polyline({ path: dr.points, strokeColor: dr.color, strokeWeight: 3, clickable: false }));
      } else if (dr.geometry === 'circle' && dr.radiusM) {
        upsertShape('draft', sig, () =>
          new google.maps.Circle({ center: dr.points[0], radius: dr.radiusM!, strokeColor: dr.color, strokeWeight: 2, fillColor: dr.color, fillOpacity: 0.2, clickable: false }),
        );
      }
      dr.points.forEach((p, i) =>
        upsertMarker(`dv:${i}`, p, `dv|${dr.color}`, () => vertexDot(dr.color), { z: 2000 }),
      );
    }

    for (const [k, m] of this.markers) {
      if (!seenM.has(k)) {
        m.marker.map = null;
        this.markers.delete(k);
      }
    }
    for (const [k, s] of this.shapes) {
      if (!seenS.has(k)) {
        s.shape.setMap(null);
        this.shapes.delete(k);
      }
    }
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
    for (const z of this.zones()) {
      const st = zoneStyle(z);
      const dash = z.kind === 'restricted' || z.kind === 'line' ? '6 4' : z.kind === 'route' ? '2 4' : null;
      if (z.geometry === 'polygon' && z.points.length >= 3) {
        list.push({ id: z.id, kind: 'polygon', points: pts(z.points), color: z.color, fillOpacity: st.poly.fillOpacity, strokeWidth: z.strokeWidth, dash });
      } else if (z.geometry === 'polyline' && z.points.length >= 2) {
        list.push({ id: z.id, kind: 'polyline', points: pts(z.points), color: z.color, fillOpacity: 0, strokeWidth: z.strokeWidth + 1, dash });
      } else if (z.geometry === 'circle' && z.points[0] && z.radiusM) {
        const c = this.toScreen(z.points[0]);
        list.push({ id: z.id, kind: 'circle', cx: c.x, cy: c.y, r: z.radiusM * s, color: z.color, fillOpacity: st.poly.fillOpacity, strokeWidth: z.strokeWidth, dash });
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
    const self = this.self();
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
      // markers are built for Google's bottom-centre anchor; centre them here instead
      node.style.transform = 'translate(-50%, -50%)';
      node.style.zIndex = String(z);
      host.appendChild(node);
    };
    const teamById = new Map(this.teams().map((t) => [t.id, t]));
    const labels = this.showLabels();
    for (const z of this.zones()) {
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
      const node = objectiveMarker(o, owner, this.selectedId() === o.id, labels);
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
    if (self) place(selfMarker(self.heading), self, 100);
  }

  protected onPointerDown(e: PointerEvent): void {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
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
      if (Math.abs(dx) + Math.abs(dy) > 4) this.dragStart.moved = true;
      this.pan.set({ x: this.dragStart.pan.x + dx, y: this.dragStart.pan.y + dy });
    }
  }

  protected onPointerUp(e: PointerEvent): void {
    const wasTap = this.dragStart && !this.dragStart.moved && this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (wasTap && e.type === 'pointerup') {
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

function zoneStyle(z: Zone) {
  const fill = z.kind === 'playable' ? Math.min(z.fillOpacity, 0.08) : z.fillOpacity;
  return {
    poly: { strokeColor: z.color, strokeOpacity: 0.95, strokeWeight: z.strokeWidth, fillColor: z.color, fillOpacity: fill },
    line: {
      strokeColor: z.color,
      strokeOpacity: z.kind === 'line' || z.kind === 'route' ? 0 : 0.95,
      strokeWeight: z.strokeWidth + 1,
      icons:
        z.kind === 'line' || z.kind === 'route'
          ? [
              {
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: z.color, scale: z.strokeWidth + 1 },
                offset: '0',
                repeat: z.kind === 'route' ? '10px' : '16px',
              },
            ]
          : undefined,
    },
  };
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
