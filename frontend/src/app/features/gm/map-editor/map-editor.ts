import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleDashed, lucideFileUp, lucideLayoutTemplate, lucideMousePointer2, lucideType } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { ApiService } from '../../../core/api/api.service';
import { ApiError } from '../../../core/api/api-error';
import {
  ContentVisibility,
  EventDetail,
  LatLng,
  MapTemplate,
  Objective,
  ObjectiveType,
  Poi,
  PoiType,
  Zone,
  ZoneGeometry,
  ZoneInput,
  ZoneKind,
} from '../../../core/api/models';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { ToastService } from '../../../core/ui/toast.service';
import { OBJECTIVE_STATUS_GLYPHS, OBJECTIVE_TYPE_LABELS, POI_TYPE_LABELS, ZONE_KIND_LABELS, formatDateTime } from '../../../core/util/format';
import { centroid, formatLatLng, offset, parseLatLng, pathLengthM, polygonAreaM2 } from '../../../core/util/geo';
import { DraftShape, MarkerMove, TacticalMap } from '../../../shared/map/tactical-map';
import { EmptyState, ErrorState } from '../../../shared/states';
import { StatusChip, objectiveStatusChip } from '../../../shared/status-chip';
import { ColorField } from '../ops/color-field';
import { controlError, targetChecked, toggleIn } from '../ops/forms';
import {
  AREA_KINDS,
  CIRCLE_KINDS,
  LINE_KINDS,
  POI_TYPE_COLORS,
  ZONE_KIND_COLORS,
  ZONE_KIND_FILL,
  circlePath,
  zoneSizeLabel,
} from '../ops/map-defaults';
import { OpsDialog } from '../ops/ops-dialog';

type Tool = 'select' | 'objective' | 'poi' | 'area' | 'line' | 'circle' | 'label';
type SelKind = 'objective' | 'poi' | 'zone';
interface Sel {
  kind: SelKind;
  id: string;
}
interface Layers {
  objectives: boolean;
  geofences: boolean;
  pois: boolean;
  zones: boolean;
  labels: boolean;
}

const TOOLS: { id: Tool; label: string; short: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select and move', short: 'Select', key: 'V', icon: 'lucideMousePointer2' },
  { id: 'objective', label: 'Add objective', short: 'Objective', key: 'O', icon: 'lucideTarget' },
  { id: 'poi', label: 'Add point of interest', short: 'POI', key: 'P', icon: 'lucideMapPin' },
  { id: 'area', label: 'Draw area', short: 'Area', key: 'A', icon: 'lucidePentagon' },
  { id: 'line', label: 'Draw route or defensive line', short: 'Line', key: 'L', icon: 'lucideRoute' },
  { id: 'circle', label: 'Circle zone', short: 'Circle', key: 'C', icon: 'lucideCircleDashed' },
  { id: 'label', label: 'Text label', short: 'Label', key: 'T', icon: 'lucideType' },
];

const LAYER_LABELS: { key: keyof Layers; label: string }[] = [
  { key: 'objectives', label: 'Objectives' },
  { key: 'geofences', label: 'Geofence rings' },
  { key: 'pois', label: 'Points of interest' },
  { key: 'zones', label: 'Areas and lines' },
  { key: 'labels', label: 'Labels' },
];

const SELECT_CLASS = 'h-11 w-full rounded-md border border-input bg-transparent px-2 dark:bg-input/30';

/**
 * Tactical map editor (full screen, outside the shell): place objectives and POIs, draw
 * areas, routes, circles and labels, move and edit them, import/export via templates.
 */
@Component({
  selector: 'zeus-map-editor-screen',
  imports: [
    ReactiveFormsModule,
    NgTemplateOutlet,
    RouterLink,
    NgIcon,
    HlmButton,
    HlmInput,
    HlmLabel,
    HlmTextarea,
    HlmTooltip,
    TacticalMap,
    EmptyState,
    ErrorState,
    StatusChip,
    OpsDialog,
    ColorField,
  ],
  providers: [provideIcons({ lucideMousePointer2, lucideType, lucideCircleDashed, lucideFileUp, lucideLayoutTemplate })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fixed inset-0 flex flex-col bg-background text-foreground', '(document:keydown)': 'onKey($event)' },
  template: `
    <!-- ======================= top bar ======================= -->
    <header class="flex min-h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 py-1.5 lg:px-3">
      <a [routerLink]="['/gm/events', eventId()]" hlmBtn variant="ghost" size="icon" class="size-11 shrink-0" aria-label="Back to the event editor">
        <ng-icon name="lucideArrowLeft" size="20" aria-hidden="true" />
      </a>
      <div class="min-w-0 flex-1 sm:flex-none">
        <p class="label-caps leading-none">Map editor</p>
        <h1 class="truncate text-base uppercase lg:text-lg">{{ event()?.name ?? 'Loading…' }}</h1>
      </div>

      <form class="ml-auto hidden max-w-md flex-1 items-center gap-1 md:flex" (submit)="$event.preventDefault(); submitSearch()" role="search">
        <label for="map-search" class="sr-only">Search a place or coordinates</label>
        <div class="relative flex-1">
          <ng-icon name="lucideSearch" size="16" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            #searchInput
            hlmInput
            id="map-search"
            class="h-10 pl-8"
            placeholder="Place or 45.4642, 9.1900"
            autocomplete="off"
            [value]="searchText()"
            (input)="searchText.set($any($event.target).value)"
            (focus)="attachAutocomplete()"
          />
        </div>
      </form>
      <button hlmBtn variant="ghost" size="icon" class="size-11 md:hidden" type="button" (click)="mobileSearch.set(!mobileSearch())" aria-label="Search a place">
        <ng-icon name="lucideSearch" size="18" aria-hidden="true" />
      </button>
      <button hlmBtn variant="ghost" size="icon" class="size-11" type="button" (click)="useMyLocation()" hlmTooltip="Use my location" aria-label="Use my location">
        <ng-icon name="lucideLocateFixed" size="18" aria-hidden="true" />
      </button>
      <div class="relative">
        <button hlmBtn variant="ghost" size="icon" class="size-11" type="button" (click)="toggleMenu('layers')" [attr.aria-expanded]="menu() === 'layers'" aria-controls="layers-menu" hlmTooltip="Layers" aria-label="Layers">
          <ng-icon name="lucideLayers" size="18" aria-hidden="true" />
        </button>
        @if (menu() === 'layers') {
          <div id="layers-menu" class="panel absolute right-0 top-12 z-40 w-60 p-2 shadow-xl">
            <p class="label-caps px-2 py-1">Layers</p>
            @for (l of layerLabels; track l.key) {
              <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2 hover:bg-muted">
                <input type="checkbox" class="size-5 accent-primary" [checked]="layers()[l.key]" (change)="setLayer(l.key, $any($event.target).checked)" />
                {{ l.label }}
              </label>
            }
          </div>
        }
      </div>
      <div class="relative">
        <button hlmBtn variant="ghost" size="icon" class="size-11" type="button" (click)="toggleMenu('more')" [attr.aria-expanded]="menu() === 'more'" aria-controls="more-menu" aria-label="More map actions">
          <ng-icon name="lucideEllipsisVertical" size="18" aria-hidden="true" />
        </button>
        @if (menu() === 'more') {
          <div id="more-menu" class="panel absolute right-0 top-12 z-40 flex w-64 flex-col p-1 shadow-xl" role="menu">
            <button type="button" role="menuitem" class="flex min-h-11 items-center gap-3 rounded-sm px-3 text-left text-sm hover:bg-muted" (click)="setEventArea()">
              <ng-icon name="lucideCrosshair" size="16" aria-hidden="true" /> Set as event area
            </button>
            <button type="button" role="menuitem" class="flex min-h-11 items-center gap-3 rounded-sm px-3 text-left text-sm hover:bg-muted" (click)="openDialog('import')">
              <ng-icon name="lucideFileUp" size="16" aria-hidden="true" /> Import GeoJSON or CSV
            </button>
            <button type="button" role="menuitem" class="flex min-h-11 items-center gap-3 rounded-sm px-3 text-left text-sm hover:bg-muted" (click)="openDialog('saveTpl')">
              <ng-icon name="lucideSave" size="16" aria-hidden="true" /> Save as map template
            </button>
            <button type="button" role="menuitem" class="flex min-h-11 items-center gap-3 rounded-sm px-3 text-left text-sm hover:bg-muted" (click)="openDialog('applyTpl')">
              <ng-icon name="lucideLayoutTemplate" size="16" aria-hidden="true" /> Apply a map template
            </button>
            <hr class="my-1 border-border" />
            <a [routerLink]="['/gm/events', eventId(), 'control']" role="menuitem" class="flex min-h-11 items-center gap-3 rounded-sm px-3 text-sm hover:bg-muted">
              <ng-icon name="lucideLayoutDashboard" size="16" aria-hidden="true" /> Control center
            </a>
          </div>
        }
      </div>
    </header>

    @if (mobileSearch()) {
      <form class="flex items-center gap-2 border-b border-border bg-card p-2 md:hidden" (submit)="$event.preventDefault(); submitSearch()" role="search">
        <label for="map-search-m" class="sr-only">Search a place or coordinates</label>
        <input
          #searchInputMobile
          hlmInput
          id="map-search-m"
          class="h-11 flex-1"
          placeholder="Place or 45.4642, 9.1900"
          autocomplete="off"
          [value]="searchText()"
          (input)="searchText.set($any($event.target).value)"
          (focus)="attachAutocomplete(true)"
        />
        <button hlmBtn type="submit" class="h-11">Go</button>
      </form>
    }

    @if (loading()) {
      <div class="grid flex-1 place-items-center text-sm text-muted-foreground" role="status">Loading map content…</div>
    } @else if (error()) {
      <div class="mx-auto w-full max-w-lg p-4"><zeus-error-state [error]="error()" (retry)="load()" /></div>
    } @else {
      <div class="relative flex min-h-0 flex-1 flex-col-reverse lg:flex-row">
        <!-- ======================= tools ======================= -->
        <nav
          class="z-30 flex h-16 shrink-0 items-stretch overflow-x-auto border-t border-border bg-card lg:h-auto lg:w-16 lg:flex-col lg:overflow-visible lg:border-r lg:border-t-0 lg:py-2"
          aria-label="Map tools"
        >
          @for (t of tools; track t.id) {
            <button
              type="button"
              class="flex min-w-12 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[0.68rem] font-semibold lg:min-h-14 lg:flex-none"
              [class]="tool() === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'"
              [attr.aria-pressed]="tool() === t.id"
              [attr.aria-keyshortcuts]="t.key"
              [hlmTooltip]="t.label + ' (' + t.key + ')'"
              position="right"
              (click)="setTool(t.id)"
            >
              <ng-icon [name]="t.icon" size="20" aria-hidden="true" />
              <span>{{ t.short }}</span>
            </button>
          }
          <button
            type="button"
            class="flex min-w-12 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[0.68rem] font-semibold text-muted-foreground hover:bg-muted lg:mt-auto lg:min-h-14 lg:flex-none"
            [attr.aria-pressed]="listOpen()"
            aria-controls="element-list"
            (click)="listOpen.set(!listOpen())"
            hlmTooltip="Element list"
            position="right"
          >
            <ng-icon name="lucideList" size="20" aria-hidden="true" />
            <span>List</span>
          </button>
        </nav>

        <!-- ======================= element list ======================= -->
        @if (listOpen()) {
          <aside
            id="element-list"
            class="absolute inset-x-0 bottom-16 top-0 z-20 flex flex-col overflow-hidden border-border bg-card lg:static lg:w-72 lg:shrink-0 lg:border-r"
            aria-label="Map elements"
          >
            <div class="flex items-center justify-between border-b border-border px-3 py-2">
              <h2 class="label-caps">Elements · {{ totalCount() }}</h2>
              <button hlmBtn variant="ghost" size="icon" class="size-10" type="button" (click)="listOpen.set(false)" aria-label="Close the element list">
                <ng-icon name="lucideX" size="16" aria-hidden="true" />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto p-2">
              @if (totalCount() === 0) {
                <zeus-empty-state icon="lucideMapPinned" title="The map is empty" message="Pick a tool and tap the map, or import a GeoJSON/CSV file." />
              }
              @for (g of groups(); track g.title) {
                @if (g.items.length) {
                  <section class="mb-3">
                    <h3 class="label-caps px-1 py-1">{{ g.title }} · {{ g.items.length }}{{ g.meta ? ' · ' + g.meta : '' }}</h3>
                    <ul class="flex flex-col">
                      @for (it of g.items; track it.id) {
                        <li>
                          <button
                            type="button"
                            class="flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-muted"
                            [class.bg-muted]="selection()?.id === it.id"
                            [attr.aria-current]="selection()?.id === it.id ? 'true' : null"
                            (click)="selectFromList(it.kind, it.id)"
                          >
                            <span class="inline-block size-3 shrink-0 rounded-sm border border-border" [style.background]="it.color" aria-hidden="true"></span>
                            <span class="num w-4 shrink-0 text-center text-xs" aria-hidden="true">{{ it.glyph }}</span>
                            <span class="min-w-0 flex-1 truncate">{{ it.name }}</span>
                            <span class="num shrink-0 text-xs text-muted-foreground">{{ it.info }}</span>
                          </button>
                        </li>
                      }
                    </ul>
                  </section>
                }
              }
            </div>
          </aside>
        }

        <!-- ======================= map ======================= -->
        <main class="relative min-h-0 min-w-0 flex-1">
          <zeus-tactical-map
            #map
            class="absolute inset-0"
            [objectives]="mapObjectives()"
            [pois]="mapPois()"
            [zones]="mapZones()"
            [teams]="teams()"
            [selectedId]="selection()?.id ?? null"
            [center]="areaCenter()"
            [zoom]="event()?.area?.zoom ?? 16"
            [showGeofences]="layers().geofences"
            [showLabels]="layers().labels"
            [editable]="dragEnabled()"
            [draft]="draft()"
            [fitKey]="fitKey()"
            (mapClick)="onMapClick($event)"
            (objectiveClick)="onObjectiveClick($event)"
            (poiClick)="onPoiClick($event)"
            (zoneClick)="onZoneClick($event)"
            (markerMoved)="onMarkerMoved($event)"
          />

          @if (hint(); as h) {
            <div class="hud absolute left-2 right-16 top-2 z-10 mx-auto flex max-w-xl flex-wrap items-center gap-2 px-3 py-2 text-sm" role="status" aria-live="polite">
              <span class="min-w-0 flex-1">{{ h }}</span>
              @if (drawingPoints()) {
                <span class="num text-xs text-muted-foreground">{{ draftPoints().length }} pts{{ draftMeasure() ? ' · ' + draftMeasure() : '' }}</span>
                <div class="flex w-full gap-1.5 sm:w-auto">
                  <button hlmBtn type="button" variant="outline" class="h-10 flex-1 sm:flex-none" (click)="undoPoint()" [disabled]="!draftPoints().length" aria-keyshortcuts="Backspace">
                    <ng-icon name="lucideUndo2" size="16" aria-hidden="true" /> Undo point
                  </button>
                  <button hlmBtn type="button" class="h-10 flex-1 sm:flex-none" (click)="finishDrawing()" [disabled]="!canFinish()" aria-keyshortcuts="Enter">
                    <ng-icon name="lucideCheck" size="16" aria-hidden="true" /> Finish
                  </button>
                  <button hlmBtn type="button" variant="ghost" class="h-10 flex-1 sm:flex-none" (click)="cancelDrawing()" aria-keyshortcuts="Escape">Cancel</button>
                </div>
              } @else if (moveTarget() || pendingPoi() || tool() !== 'select') {
                <button hlmBtn type="button" variant="ghost" class="h-10" (click)="escape()" aria-keyshortcuts="Escape">Cancel</button>
              }
            </div>
          }
          @if (busy()) {
            <div class="hud absolute bottom-3 left-1/2 z-10 -translate-x-1/2 px-3 py-1.5 text-sm" role="status">Saving…</div>
          }
        </main>

        <!-- ======================= properties ======================= -->
        <aside
          class="absolute inset-x-0 bottom-16 z-20 max-h-[58dvh] overflow-y-auto rounded-t-md border-t border-border bg-card shadow-2xl lg:static lg:block lg:max-h-none lg:w-80 lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none xl:w-96"
          [class.hidden]="panelMode() === 'help'"
          aria-label="Properties"
        >
          @switch (panelMode()) {
            @case ('zoneDetails') {
              <form [formGroup]="zoneForm" (ngSubmit)="saveDraftZone()" class="flex flex-col gap-4 p-4" novalidate>
                <div class="flex items-center justify-between gap-2">
                  <h2 class="text-base uppercase">{{ editingZoneId() ? 'Edit zone' : 'New ' + toolNoun() }}</h2>
                  <button hlmBtn type="button" variant="ghost" size="icon" class="size-10" (click)="cancelDrawing()" aria-label="Cancel">
                    <ng-icon name="lucideX" size="16" aria-hidden="true" />
                  </button>
                </div>
                @if (!editingZoneId()) {
                  <div class="flex flex-col gap-1.5">
                    <label hlmLabel for="zd-kind">Kind</label>
                    <select id="zd-kind" formControlName="kind" [class]="selectClass">
                      @for (k of kindOptions(); track k) {
                        <option [value]="k">{{ zoneKindLabels[k] }}</option>
                      }
                    </select>
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <label hlmLabel for="zd-label">{{ tool() === 'label' ? 'Text' : 'Label' }}@if (tool() === 'label') {<span aria-hidden="true"> *</span>}</label>
                    <input hlmInput id="zd-label" formControlName="label" class="h-11" maxlength="60" autocomplete="off" />
                    @if (zoneErr('label', 'Text'); as e) {
                      <p class="field-error">{{ e }}</p>
                    }
                  </div>
                }
                @if (tool() === 'circle') {
                  <div class="flex flex-col gap-1.5">
                    <label hlmLabel for="zd-radius">Radius (m)</label>
                    <div class="flex items-center gap-3">
                      <input type="range" min="5" max="500" step="5" class="flex-1 accent-primary" formControlName="radiusM" aria-label="Radius slider" />
                      <input hlmInput id="zd-radius" type="number" min="1" max="5000" formControlName="radiusM" class="num h-11 w-24" />
                    </div>
                    <p class="text-sm text-muted-foreground">Tap the map again to move the centre.</p>
                  </div>
                }
                @if (!editingZoneId()) {
                  @if (zoneValue().kind === 'base') {
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="zd-team">Team</label>
                      <select id="zd-team" formControlName="teamId" [class]="selectClass">
                        <option value="">No team</option>
                        @for (t of teams(); track t.id) {
                          <option [value]="t.id">{{ t.name }}</option>
                        }
                      </select>
                    </div>
                  }
                  <div class="flex flex-col gap-1.5">
                    <span hlmLabel>Colour</span>
                    <zeus-color-field formControlName="color" label="Zone colour" />
                  </div>
                }
                <p class="num text-sm text-muted-foreground">{{ draftMeasure() }}</p>
                <div class="flex gap-2">
                  <button hlmBtn type="submit" class="h-11 flex-1" [disabled]="busy()">{{ busy() ? 'Saving…' : editingZoneId() ? 'Save shape' : 'Create' }}</button>
                  <button hlmBtn type="button" variant="outline" class="h-11" (click)="cancelDrawing()">Cancel</button>
                </div>
              </form>
            }

            @case ('poiType') {
              <div class="flex flex-col gap-3 p-4">
                <div class="flex items-center justify-between gap-2">
                  <h2 class="text-base uppercase">Point of interest type</h2>
                  <button hlmBtn type="button" variant="ghost" size="icon" class="size-10" (click)="pendingPoi.set(null)" aria-label="Cancel">
                    <ng-icon name="lucideX" size="16" aria-hidden="true" />
                  </button>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  @for (pt of poiTypes; track pt) {
                    <button hlmBtn type="button" variant="outline" class="h-12 justify-start gap-2" (click)="createPoi(pt)" [disabled]="busy()">
                      <span class="inline-block size-3 rounded-full" [style.background]="poiColors[pt]" aria-hidden="true"></span>
                      <span class="truncate">{{ poiTypeLabels[pt] }}</span>
                    </button>
                  }
                </div>
              </div>
            }

            @case ('objective') {
              @if (selectedObjective(); as o) {
                <div class="flex flex-col gap-4 p-4">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="label-caps">Objective</p>
                      <h2 class="truncate text-base uppercase">{{ o.name }}</h2>
                    </div>
                    <button hlmBtn type="button" variant="ghost" size="icon" class="size-10 shrink-0" (click)="selection.set(null)" aria-label="Close properties">
                      <ng-icon name="lucideX" size="16" aria-hidden="true" />
                    </button>
                  </div>
                  <div class="flex flex-wrap items-center gap-2 text-sm">
                    <zeus-status-chip [spec]="objectiveChip(o)" />
                    <span class="text-muted-foreground">{{ o.methods.length ? o.methods.join(' · ').toUpperCase() : 'No capture method' }}</span>
                  </div>
                  <form [formGroup]="objForm" (ngSubmit)="saveObjective(o)" class="flex flex-col gap-3" novalidate>
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="op-name">Name</label>
                      <input hlmInput id="op-name" formControlName="name" class="h-11" maxlength="80" />
                      @if (objErr('name', 'Name'); as e) {
                        <p class="field-error">{{ e }}</p>
                      }
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="op-type">Type</label>
                      <select id="op-type" formControlName="type" [class]="selectClass">
                        @for (t of objectiveTypes; track t) {
                          <option [value]="t">{{ objectiveTypeLabels[t] }}</option>
                        }
                      </select>
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <span hlmLabel>Marker colour</span>
                      <zeus-color-field formControlName="color" label="Marker colour" />
                    </div>
                    <label class="flex min-h-11 cursor-pointer items-center gap-3">
                      <input type="checkbox" formControlName="enabled" class="size-5 accent-primary" /> Enabled (players can see and capture it)
                    </label>
                    <button hlmBtn type="submit" class="h-11" [disabled]="busy() || objForm.pristine">{{ busy() ? 'Saving…' : 'Save changes' }}</button>
                  </form>
                  <a
                    hlmBtn
                    variant="outline"
                    class="h-11"
                    [routerLink]="['/gm/events', eventId(), 'objectives', o.id]"
                    [queryParams]="{ returnTo: mapUrl() }"
                  >
                    <ng-icon name="lucideSettings2" size="16" aria-hidden="true" /> Full objective editor
                  </a>
                  <p class="text-sm text-muted-foreground">Capture code, QR, geofence, rewards, chain and visibility are set in the full editor.</p>
                  <ng-container [ngTemplateOutlet]="elementActions" [ngTemplateOutletContext]="{ $implicit: o.lat, lng: o.lng, kind: 'objective', id: o.id }" />
                </div>
              }
            }

            @case ('poi') {
              @if (selectedPoi(); as p) {
                <div class="flex flex-col gap-4 p-4">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="label-caps">Point of interest</p>
                      <h2 class="truncate text-base uppercase">{{ p.name }}</h2>
                    </div>
                    <button hlmBtn type="button" variant="ghost" size="icon" class="size-10 shrink-0" (click)="selection.set(null)" aria-label="Close properties">
                      <ng-icon name="lucideX" size="16" aria-hidden="true" />
                    </button>
                  </div>
                  <form [formGroup]="poiForm" (ngSubmit)="savePoi(p)" class="flex flex-col gap-3" novalidate>
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="pp-name">Name</label>
                      <input hlmInput id="pp-name" formControlName="name" class="h-11" maxlength="80" />
                      @if (poiErr('name', 'Name'); as e) {
                        <p class="field-error">{{ e }}</p>
                      }
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="pp-type">Type</label>
                      <select id="pp-type" formControlName="type" [class]="selectClass">
                        @for (t of poiTypes; track t) {
                          <option [value]="t">{{ poiTypeLabels[t] }}</option>
                        }
                      </select>
                    </div>
                    @if (poiValue().type === 'team_base') {
                      <div class="flex flex-col gap-1.5">
                        <label hlmLabel for="pp-team">Owning team</label>
                        <select id="pp-team" formControlName="teamId" [class]="selectClass">
                          <option value="">No team</option>
                          @for (t of teams(); track t.id) {
                            <option [value]="t.id">{{ t.name }}</option>
                          }
                        </select>
                      </div>
                    }
                    <div class="flex flex-col gap-1.5">
                      <span hlmLabel>Colour</span>
                      <zeus-color-field formControlName="color" label="POI colour" />
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="pp-desc">Description</label>
                      <textarea hlmTextarea id="pp-desc" formControlName="description" rows="2" maxlength="500"></textarea>
                    </div>
                    <ng-container [ngTemplateOutlet]="visibilityFields" [ngTemplateOutletContext]="{ $implicit: poiForm, prefix: 'pp' }" />
                    <button hlmBtn type="submit" class="h-11" [disabled]="busy() || poiForm.pristine">{{ busy() ? 'Saving…' : 'Save changes' }}</button>
                  </form>
                  <a hlmBtn variant="outline" class="h-11" [routerLink]="['/gm/events', eventId(), 'pois', p.id]" [queryParams]="{ returnTo: mapUrl() }">
                    <ng-icon name="lucideSettings2" size="16" aria-hidden="true" /> Full POI editor
                  </a>
                  <ng-container [ngTemplateOutlet]="elementActions" [ngTemplateOutletContext]="{ $implicit: p.lat, lng: p.lng, kind: 'poi', id: p.id }" />
                </div>
              }
            }

            @case ('zone') {
              @if (selectedZone(); as z) {
                <div class="flex flex-col gap-4 p-4">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="label-caps">{{ zoneKindLabels[z.kind] }} · {{ geometryLabel(z.geometry) }}</p>
                      <h2 class="truncate text-base uppercase">{{ z.label || zoneKindLabels[z.kind] }}</h2>
                      <p class="num text-sm text-muted-foreground">{{ sizeLabel(z) }}</p>
                    </div>
                    <button hlmBtn type="button" variant="ghost" size="icon" class="size-10 shrink-0" (click)="selection.set(null)" aria-label="Close properties">
                      <ng-icon name="lucideX" size="16" aria-hidden="true" />
                    </button>
                  </div>
                  <form [formGroup]="zoneEditForm" (ngSubmit)="saveZone(z)" class="flex flex-col gap-3" novalidate>
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="zp-kind">Kind</label>
                      <select id="zp-kind" formControlName="kind" [class]="selectClass">
                        @for (k of kindsForGeometry(z.geometry); track k) {
                          <option [value]="k">{{ zoneKindLabels[k] }}</option>
                        }
                      </select>
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="zp-label">{{ z.geometry === 'point' ? 'Text' : 'Label' }}</label>
                      <input hlmInput id="zp-label" formControlName="label" class="h-11" maxlength="60" />
                      @if (zoneEditErr('label', 'Label'); as e) {
                        <p class="field-error">{{ e }}</p>
                      }
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="zp-desc">Description</label>
                      <textarea hlmTextarea id="zp-desc" formControlName="description" rows="2" maxlength="500"></textarea>
                    </div>
                    @if (zoneEditValue().kind === 'base') {
                      <div class="flex flex-col gap-1.5">
                        <label hlmLabel for="zp-team">Team</label>
                        <select id="zp-team" formControlName="teamId" [class]="selectClass">
                          <option value="">No team</option>
                          @for (t of teams(); track t.id) {
                            <option [value]="t.id">{{ t.name }}</option>
                          }
                        </select>
                      </div>
                    }
                    @if (z.geometry === 'circle') {
                      <div class="flex flex-col gap-1.5">
                        <label hlmLabel for="zp-radius">Radius (m)</label>
                        <input hlmInput id="zp-radius" type="number" min="1" max="5000" formControlName="radiusM" class="num h-11" />
                      </div>
                    }
                    <div class="flex flex-col gap-1.5">
                      <span hlmLabel>Colour</span>
                      <zeus-color-field formControlName="color" label="Zone colour" />
                    </div>
                    @if (z.geometry === 'polygon' || z.geometry === 'circle') {
                      <div class="flex flex-col gap-1.5">
                        <label hlmLabel for="zp-fill">Fill opacity <span class="num text-muted-foreground">{{ zoneEditValue().fillOpacity }}</span></label>
                        <input id="zp-fill" type="range" min="0" max="0.8" step="0.05" formControlName="fillOpacity" class="h-11 accent-primary" />
                      </div>
                    }
                    @if (z.geometry !== 'point') {
                      <div class="flex flex-col gap-1.5">
                        <label hlmLabel for="zp-stroke">Line width <span class="num text-muted-foreground">{{ zoneEditValue().strokeWidth }} px</span></label>
                        <input id="zp-stroke" type="range" min="1" max="8" step="1" formControlName="strokeWidth" class="h-11 accent-primary" />
                      </div>
                    }
                    <ng-container [ngTemplateOutlet]="visibilityFields" [ngTemplateOutletContext]="{ $implicit: zoneEditForm, prefix: 'zp' }" />
                    <button hlmBtn type="submit" class="h-11" [disabled]="busy() || zoneEditForm.pristine">{{ busy() ? 'Saving…' : 'Save changes' }}</button>
                  </form>
                  @if (z.geometry === 'polygon' || z.geometry === 'polyline' || z.geometry === 'circle') {
                    <button hlmBtn type="button" variant="outline" class="h-11" (click)="editVertices(z)">
                      <ng-icon name="lucideWaypoints" size="16" aria-hidden="true" /> {{ z.geometry === 'circle' ? 'Edit centre and radius' : 'Edit vertices' }}
                    </button>
                  }
                  <ng-container [ngTemplateOutlet]="elementActions" [ngTemplateOutletContext]="{ $implicit: zoneAnchor(z).lat, lng: zoneAnchor(z).lng, kind: 'zone', id: z.id }" />
                </div>
              }
            }

            @default {
              <div class="hidden flex-col gap-4 p-4 lg:flex">
                <h2 class="label-caps">Properties</h2>
                <p class="text-sm text-muted-foreground">Select an element on the map or in the list to edit it. Drag objectives and POIs to move them.</p>
                <div>
                  <h3 class="label-caps mb-2">Keyboard</h3>
                  <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                    @for (t of tools; track t.id) {
                      <dt><kbd class="num rounded-sm border border-border bg-muted px-1.5 text-xs">{{ t.key }}</kbd></dt>
                      <dd>{{ t.label }}</dd>
                    }
                    <dt><kbd class="num rounded-sm border border-border bg-muted px-1.5 text-xs">Enter</kbd></dt>
                    <dd>Finish the shape</dd>
                    <dt><kbd class="num rounded-sm border border-border bg-muted px-1.5 text-xs">Esc</kbd></dt>
                    <dd>Cancel drawing or moving</dd>
                    <dt><kbd class="num rounded-sm border border-border bg-muted px-1.5 text-xs">⌫</kbd></dt>
                    <dd>Undo point while drawing, otherwise delete the selection</dd>
                  </dl>
                </div>
                @if (event()?.area; as a) {
                  <p class="text-sm text-muted-foreground">Event area: <span class="num">{{ fmtLatLng(a) }}</span> · zoom {{ a.zoom }}</p>
                } @else {
                  <p class="text-sm text-muted-foreground">No event area yet. Frame the field and choose "Set as event area" in the ⋮ menu so players' maps open there.</p>
                }
              </div>
            }
          }
        </aside>
      </div>
    }

    <!-- shared: move / duplicate / delete -->
    <ng-template #elementActions let-lat let-lng="lng" let-kind="kind" let-id="id">
      <div class="flex flex-col gap-2 border-t border-border pt-3">
        <p class="num text-xs text-muted-foreground">{{ fmtLatLng({ lat: lat, lng: lng }) }}</p>
        <div class="grid grid-cols-3 gap-2">
          <button
            hlmBtn
            type="button"
            [variant]="moveTarget()?.id === id ? 'default' : 'outline'"
            class="h-11"
            [attr.aria-pressed]="moveTarget()?.id === id"
            (click)="toggleMove(kind, id)"
          >
            <ng-icon name="lucideMove" size="16" aria-hidden="true" /> Move here
          </button>
          <button hlmBtn type="button" variant="outline" class="h-11" (click)="duplicate(kind, id)" [disabled]="busy()">
            <ng-icon name="lucideCopy" size="16" aria-hidden="true" /> Duplicate
          </button>
          <button hlmBtn type="button" variant="destructive" class="h-11" (click)="remove(kind, id)" [disabled]="busy()" aria-keyshortcuts="Delete">
            <ng-icon name="lucideTrash2" size="16" aria-hidden="true" /> Delete
          </button>
        </div>
      </div>
    </ng-template>

    <!-- shared: visibility mode + teams -->
    <ng-template #visibilityFields let-form let-prefix="prefix">
      <fieldset class="flex flex-col gap-1.5" [formGroup]="form">
        <legend class="mb-1.5 text-sm font-medium">Who sees it</legend>
        <select [id]="prefix + '-vis'" formControlName="visMode" [class]="selectClass" aria-label="Who sees it">
          <option value="all">Everyone</option>
          <option value="teams">Selected teams only</option>
          <option value="gm_only">Game Masters only</option>
        </select>
        @if (form.value.visMode === 'teams') {
          <div class="flex flex-col">
            @for (t of teams(); track t.id) {
              <label class="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  class="size-5 accent-primary"
                  [checked]="form.value.visTeamIds?.includes(t.id)"
                  (change)="toggleTeam(form.controls.visTeamIds, t.id, $event)"
                />
                <span class="inline-block size-3 rounded-sm" [style.background]="t.color" aria-hidden="true"></span>{{ t.name }}
              </label>
            }
          </div>
        }
      </fieldset>
    </ng-template>

    <!-- ======================= dialogs ======================= -->
    <zeus-ops-dialog [open]="dialog() === 'import'" title="Import map elements" subtitle="Elements are added to the current map; nothing is replaced." (closed)="dialog.set(null)">
      @if (dialog() === 'import') {
        <form [formGroup]="importForm" (ngSubmit)="runImport()" class="flex flex-col gap-4" novalidate>
          <fieldset>
            <legend class="mb-1.5 text-sm font-medium">Format</legend>
            <div class="grid grid-cols-2 gap-2">
              <label class="flex h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 has-checked:border-primary has-checked:bg-primary/10">
                <input type="radio" formControlName="format" value="geojson" class="size-4 accent-primary" /> GeoJSON
              </label>
              <label class="flex h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 has-checked:border-primary has-checked:bg-primary/10">
                <input type="radio" formControlName="format" value="csv" class="size-4 accent-primary" /> CSV
              </label>
            </div>
          </fieldset>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="imp-file">File</label>
            <input id="imp-file" type="file" accept=".geojson,.json,.csv,text/csv,application/json,application/geo+json" class="text-sm file:mr-3 file:h-10 file:rounded-md file:border file:border-border file:bg-muted file:px-3" (change)="onImportFile($event)" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="imp-content">Or paste the content</label>
            <textarea hlmTextarea id="imp-content" formControlName="content" rows="7" class="num text-xs" spellcheck="false"></textarea>
            @if (importForm.value.format === 'csv') {
              <p class="text-sm text-muted-foreground">
                Header <span class="num">type,name,lat,lng,description</span>. Type is <span class="num">objective</span>, <span class="num">poi</span> or a zone kind
                (<span class="num">safe</span>, <span class="num">spawn</span>, …).
              </p>
            } @else {
              <p class="text-sm text-muted-foreground">A FeatureCollection: points become objectives or POIs, polygons areas, lines routes (use a <span class="num">type</span> property to choose).</p>
            }
            @if (importError()) {
              <p class="field-error" role="alert">{{ importError() }}</p>
            }
          </div>
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button hlmBtn type="button" variant="outline" class="h-11" (click)="dialog.set(null)">Cancel</button>
            <button hlmBtn type="submit" class="h-11" [disabled]="busy()">{{ busy() ? 'Importing…' : 'Import' }}</button>
          </div>
        </form>
      }
    </zeus-ops-dialog>

    <zeus-ops-dialog [open]="dialog() === 'saveTpl'" title="Save as map template" subtitle="Saves objectives, POIs and zones so you can reuse this field in other events." (closed)="dialog.set(null)">
      @if (dialog() === 'saveTpl') {
        <form (submit)="$event.preventDefault(); saveTemplate()" class="flex flex-col gap-4" novalidate>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="tpl-name">Template name</label>
            <input hlmInput id="tpl-name" class="h-11" [formControl]="templateName" maxlength="80" autocomplete="off" />
            @if (tplNameErr(); as e) {
              <p class="field-error">{{ e }}</p>
            }
          </div>
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button hlmBtn type="button" variant="outline" class="h-11" (click)="dialog.set(null)">Cancel</button>
            <button hlmBtn type="submit" class="h-11" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save template' }}</button>
          </div>
        </form>
      }
    </zeus-ops-dialog>

    <zeus-ops-dialog [open]="dialog() === 'applyTpl'" title="Apply a map template" subtitle="The template's elements are added to this map." (closed)="dialog.set(null)">
      @if (dialog() === 'applyTpl') {
        @if (templates() === null) {
          <p class="py-6 text-center text-sm text-muted-foreground" role="status">Loading templates…</p>
        } @else if (templatesError()) {
          <zeus-error-state [error]="templatesError()" (retry)="loadTemplates()" />
        } @else if (!templates()!.length) {
          <zeus-empty-state icon="lucideLayoutTemplate" title="No map templates yet" message="Use “Save as map template” on a finished map to reuse it here." />
        } @else {
          <ul class="flex flex-col gap-2">
            @for (t of templates(); track t.id) {
              <li class="panel flex flex-wrap items-center gap-3 p-3">
                <div class="min-w-0 flex-1">
                  <p class="truncate font-semibold">{{ t.name }}</p>
                  <p class="num text-xs text-muted-foreground">{{ t.objectiveCount }} obj · {{ t.poiCount }} POI · {{ t.zoneCount }} zones · {{ fmtDate(t.createdAt) }}</p>
                </div>
                <button hlmBtn type="button" class="h-10" (click)="applyTemplate(t)" [disabled]="busy()">Apply</button>
                <button hlmBtn type="button" variant="ghost" size="icon" class="size-10" (click)="deleteTemplate(t)" [attr.aria-label]="'Delete template ' + t.name">
                  <ng-icon name="lucideTrash2" size="16" aria-hidden="true" />
                </button>
              </li>
            }
          </ul>
        }
      }
    </zeus-ops-dialog>
  `,
})
export class MapEditorScreen implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);

  readonly eventId = input.required<string>();

  // ---- static option lists
  protected readonly tools = TOOLS;
  protected readonly layerLabels = LAYER_LABELS;
  protected readonly selectClass = SELECT_CLASS;
  protected readonly zoneKindLabels = ZONE_KIND_LABELS;
  protected readonly poiTypeLabels = POI_TYPE_LABELS;
  protected readonly poiColors = POI_TYPE_COLORS;
  protected readonly poiTypes = Object.keys(POI_TYPE_LABELS) as PoiType[];
  protected readonly objectiveTypeLabels = OBJECTIVE_TYPE_LABELS;
  protected readonly objectiveTypes = Object.keys(OBJECTIVE_TYPE_LABELS) as ObjectiveType[];
  protected readonly fmtLatLng = (p: LatLng) => formatLatLng(p);
  protected readonly fmtDate = formatDateTime;
  protected readonly sizeLabel = zoneSizeLabel;
  protected readonly objectiveChip = (o: Objective) => objectiveStatusChip(o.status);

  // ---- data
  protected readonly loading = signal(true);
  protected readonly error = signal<unknown>(null);
  protected readonly event = signal<EventDetail | null>(null);
  protected readonly objectives = signal<Objective[]>([]);
  protected readonly pois = signal<Poi[]>([]);
  protected readonly zones = signal<Zone[]>([]);
  protected readonly teams = computed(() => this.event()?.teams ?? []);
  protected readonly fitKey = signal(0);

  // ---- editor state
  protected readonly tool = signal<Tool>('select');
  protected readonly selection = signal<Sel | null>(null);
  protected readonly draftPoints = signal<LatLng[]>([]);
  protected readonly drawStage = signal<'points' | 'details'>('points');
  protected readonly editingZoneId = signal<string | null>(null);
  protected readonly moveTarget = signal<Sel | null>(null);
  protected readonly pendingPoi = signal<LatLng | null>(null);
  protected readonly busy = signal(false);
  protected readonly layers = signal<Layers>({ objectives: true, geofences: true, pois: true, zones: true, labels: true });
  protected readonly listOpen = signal(false);
  protected readonly menu = signal<'layers' | 'more' | null>(null);
  protected readonly mobileSearch = signal(false);
  protected readonly searchText = signal('');
  protected readonly dialog = signal<'import' | 'saveTpl' | 'applyTpl' | null>(null);
  protected readonly importError = signal<string | null>(null);
  protected readonly templates = signal<MapTemplate[] | null>(null);
  protected readonly templatesError = signal<unknown>(null);

  private readonly mapRef = viewChild<TacticalMap>('map');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly searchInputMobile = viewChild<ElementRef<HTMLInputElement>>('searchInputMobile');
  private autocompletes = new WeakSet<HTMLInputElement>();

  // ---- forms
  /** New zone details (also used for circle radius while editing a circle). */
  protected readonly zoneForm = new FormGroup({
    kind: new FormControl<ZoneKind>('playable', { nonNullable: true }),
    label: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
    color: new FormControl(ZONE_KIND_COLORS.playable, { nonNullable: true }),
    teamId: new FormControl('', { nonNullable: true }),
    radiusM: new FormControl<number>(25, { nonNullable: true, validators: [Validators.min(1)] }),
  });
  private zoneColorTouched = false;

  protected readonly objForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    type: new FormControl<ObjectiveType>('control_point', { nonNullable: true }),
    color: new FormControl('#E6B04F', { nonNullable: true }),
    enabled: new FormControl(true, { nonNullable: true }),
  });

  protected readonly poiForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    type: new FormControl<PoiType>('custom', { nonNullable: true }),
    color: new FormControl('#9DAE5C', { nonNullable: true }),
    description: new FormControl('', { nonNullable: true }),
    teamId: new FormControl('', { nonNullable: true }),
    visMode: new FormControl<ContentVisibility['mode']>('all', { nonNullable: true }),
    visTeamIds: new FormControl<string[]>([], { nonNullable: true }),
  });

  protected readonly zoneEditForm = new FormGroup({
    kind: new FormControl<ZoneKind>('playable', { nonNullable: true }),
    label: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
    description: new FormControl('', { nonNullable: true }),
    color: new FormControl('#9DAE5C', { nonNullable: true }),
    fillOpacity: new FormControl(0.2, { nonNullable: true }),
    strokeWidth: new FormControl(2, { nonNullable: true }),
    teamId: new FormControl('', { nonNullable: true }),
    radiusM: new FormControl<number>(25, { nonNullable: true }),
    visMode: new FormControl<ContentVisibility['mode']>('all', { nonNullable: true }),
    visTeamIds: new FormControl<string[]>([], { nonNullable: true }),
  });

  protected readonly importForm = new FormGroup({
    format: new FormControl<'geojson' | 'csv'>('geojson', { nonNullable: true }),
    content: new FormControl('', { nonNullable: true }),
  });
  protected readonly templateName = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] });

  protected readonly zoneValue = toSignal(this.zoneForm.valueChanges, { initialValue: this.zoneForm.getRawValue() });
  protected readonly poiValue = toSignal(this.poiForm.valueChanges, { initialValue: this.poiForm.getRawValue() });
  protected readonly zoneEditValue = toSignal(this.zoneEditForm.valueChanges, { initialValue: this.zoneEditForm.getRawValue() });

  // ---- derived
  protected readonly selectedObjective = computed(() => {
    const s = this.selection();
    return s?.kind === 'objective' ? (this.objectives().find((o) => o.id === s.id) ?? null) : null;
  });
  protected readonly selectedPoi = computed(() => {
    const s = this.selection();
    return s?.kind === 'poi' ? (this.pois().find((p) => p.id === s.id) ?? null) : null;
  });
  protected readonly selectedZone = computed(() => {
    const s = this.selection();
    return s?.kind === 'zone' ? (this.zones().find((z) => z.id === s.id) ?? null) : null;
  });

  protected readonly isDrawTool = computed(() => ['area', 'line', 'circle', 'label'].includes(this.tool()));
  protected readonly drawingPoints = computed(() => (this.tool() === 'area' || this.tool() === 'line') && this.drawStage() === 'points');
  protected readonly placing = computed(() => this.tool() !== 'select' || this.moveTarget() !== null);
  protected readonly dragEnabled = computed(() => this.tool() === 'select' && !this.moveTarget());

  protected readonly panelMode = computed<'zoneDetails' | 'poiType' | SelKind | 'help'>(() => {
    if (this.isDrawTool() && this.drawStage() === 'details') return 'zoneDetails';
    if (this.pendingPoi()) return 'poiType';
    const s = this.selection();
    if (s) return s.kind;
    return 'help';
  });

  protected readonly canFinish = computed(() => {
    const n = this.draftPoints().length;
    return this.tool() === 'area' ? n >= 3 : this.tool() === 'line' ? n >= 2 : n >= 1;
  });

  protected readonly draftMeasure = computed(() => {
    const pts = this.draftPoints();
    const t = this.tool();
    if (t === 'area' && pts.length >= 3) return `${(polygonAreaM2(pts) / 10_000).toFixed(2)} ha`;
    if (t === 'line' && pts.length >= 2) return `${Math.round(pathLengthM(pts))} m`;
    if (t === 'circle' && pts.length) return zoneSizeLabel({ geometry: 'circle', points: pts, radiusM: this.zoneValue().radiusM ?? 25 });
    return '';
  });

  protected readonly draft = computed<DraftShape | null>(() => {
    const pts = this.draftPoints();
    if (!pts.length) return null;
    const color = this.zoneValue().color || ZONE_KIND_COLORS.playable;
    switch (this.tool()) {
      case 'area':
        return { geometry: 'polygon', points: pts, color };
      case 'line':
        return { geometry: 'polyline', points: pts, color };
      case 'circle':
        return { geometry: 'circle', points: pts.slice(0, 1), radiusM: this.zoneValue().radiusM ?? 25, color };
      case 'label':
        return { geometry: 'point', points: pts.slice(0, 1), color };
      default:
        return null;
    }
  });

  protected readonly hint = computed<string | null>(() => {
    const mv = this.moveTarget();
    if (mv) return `Tap the map to move the selected ${mv.kind === 'poi' ? 'point of interest' : mv.kind}.`;
    if (this.pendingPoi()) return 'Choose the type of point of interest.';
    switch (this.tool()) {
      case 'objective':
        return 'Tap the map to place an objective.';
      case 'poi':
        return 'Tap the map to place a point of interest.';
      case 'area':
        return this.drawStage() === 'points' ? 'Tap to add corners. Enter finishes, Esc cancels.' : 'Set the kind and label of the area.';
      case 'line':
        return this.drawStage() === 'points' ? 'Tap to add points along the route. Enter finishes.' : 'Set the kind and label of the line.';
      case 'circle':
        return this.drawStage() === 'points' ? 'Tap the centre of the circle zone.' : 'Set the radius; tap again to move the centre.';
      case 'label':
        return this.drawStage() === 'points' ? 'Tap where the label goes.' : 'Type the label text.';
      default:
        return null;
    }
  });

  protected readonly kindOptions = computed<ZoneKind[]>(() => {
    switch (this.tool()) {
      case 'line':
        return LINE_KINDS;
      case 'circle':
        return CIRCLE_KINDS;
      case 'label':
        return ['label'];
      default:
        return AREA_KINDS;
    }
  });

  protected readonly toolNoun = computed(() => ({ area: 'area', line: 'line', circle: 'circle zone', label: 'label' })[this.tool() as 'area'] ?? 'zone');

  protected readonly areaCenter = computed(() => {
    const a = this.event()?.area;
    return a ? { lat: a.lat, lng: a.lng } : null;
  });

  protected readonly mapUrl = computed(() => `/gm/events/${this.eventId()}/map`);

  protected readonly mapObjectives = computed(() => (this.layers().objectives ? this.objectives() : []));
  protected readonly mapPois = computed(() => (this.layers().pois ? this.pois() : []));
  protected readonly mapZones = computed(() => {
    const L = this.layers();
    const editing = this.editingZoneId();
    let zs = this.zones().filter((z) => z.id !== editing);
    if (!L.zones) zs = zs.filter((z) => z.kind === 'label' || z.geometry === 'point');
    if (!L.labels) zs = zs.filter((z) => z.kind !== 'label' && z.geometry !== 'point');
    // While placing, filled shapes would swallow taps on the Google map: draw them as outlines.
    if (this.placing()) zs = zs.map(outlineZone);
    return zs;
  });

  protected readonly totalCount = computed(() => this.objectives().length + this.pois().length + this.zones().length);

  protected readonly groups = computed(() => {
    type Item = { kind: SelKind; id: string; name: string; info: string; color: string; glyph: string };
    const objectives: Item[] = this.objectives().map((o) => ({
      kind: 'objective',
      id: o.id,
      name: o.name,
      info: OBJECTIVE_TYPE_LABELS[o.type],
      color: o.color,
      glyph: OBJECTIVE_STATUS_GLYPHS[o.status],
    }));
    const pois: Item[] = this.pois().map((p) => ({ kind: 'poi', id: p.id, name: p.name, info: POI_TYPE_LABELS[p.type], color: p.color, glyph: '•' }));
    const zoneItem = (z: Zone): Item => ({
      kind: 'zone',
      id: z.id,
      name: z.label || ZONE_KIND_LABELS[z.kind],
      info: z.geometry === 'point' ? '' : `${z.label ? ZONE_KIND_LABELS[z.kind] + ' · ' : ''}${zoneSizeLabel(z)}`,
      color: z.color,
      glyph: z.geometry === 'circle' ? '○' : z.geometry === 'polyline' ? '╱' : z.geometry === 'point' ? 'T' : '⬠',
    });
    const zs = this.zones();
    const areas = zs.filter((z) => z.geometry === 'polygon' || z.geometry === 'circle');
    const lines = zs.filter((z) => z.geometry === 'polyline');
    const labels = zs.filter((z) => z.geometry === 'point');
    const totalHa = areas
      .filter((z) => z.kind === 'playable')
      .reduce((s, z) => s + (z.geometry === 'polygon' ? polygonAreaM2(z.points) : Math.PI * (z.radiusM ?? 0) ** 2), 0);
    const totalLen = lines.reduce((s, z) => s + pathLengthM(z.points), 0);
    return [
      { title: 'Objectives', meta: '', items: objectives },
      { title: 'Points of interest', meta: '', items: pois },
      { title: 'Areas', meta: totalHa ? `playable ${(totalHa / 10_000).toFixed(2)} ha` : '', items: areas.map(zoneItem) },
      { title: 'Lines and routes', meta: totalLen ? `${Math.round(totalLen)} m` : '', items: lines.map(zoneItem) },
      { title: 'Labels', meta: '', items: labels.map(zoneItem) },
    ];
  });

  constructor() {
    afterNextRender(() => {
      if (typeof matchMedia !== 'undefined' && matchMedia('(min-width: 1024px)').matches) this.listOpen.set(true);
    });

    // Default colour follows the kind until the user picks one.
    this.zoneForm.controls.kind.valueChanges.pipe(takeUntilDestroyed()).subscribe((k) => {
      if (!this.zoneColorTouched) this.zoneForm.controls.color.setValue(ZONE_KIND_COLORS[k], { emitEvent: true });
    });
    this.zoneForm.controls.color.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.zoneForm.controls.color.dirty) this.zoneColorTouched = true;
    });
    // POI default colour follows the type until changed by hand.
    this.poiForm.controls.type.valueChanges.pipe(takeUntilDestroyed()).subscribe((t) => {
      if (!this.poiForm.controls.color.dirty) this.poiForm.controls.color.setValue(POI_TYPE_COLORS[t]);
    });

    // Load the selected element into its form when the selection changes.
    effect(() => {
      const s = this.selection();
      untracked(() => {
        if (!s) return;
        if (s.kind === 'objective') {
          const o = this.objectives().find((x) => x.id === s.id);
          if (o) this.objForm.reset({ name: o.name, type: o.type, color: o.color, enabled: o.enabled });
        } else if (s.kind === 'poi') {
          const p = this.pois().find((x) => x.id === s.id);
          if (p)
            this.poiForm.reset({
              name: p.name,
              type: p.type,
              color: p.color,
              description: p.description,
              teamId: p.teamId ?? '',
              visMode: p.visibility?.mode ?? 'all',
              visTeamIds: p.visibility?.teamIds ?? [],
            });
        } else {
          const z = this.zones().find((x) => x.id === s.id);
          if (z)
            this.zoneEditForm.reset({
              kind: z.kind,
              label: z.label,
              description: z.description,
              color: z.color,
              fillOpacity: z.fillOpacity,
              strokeWidth: z.strokeWidth,
              teamId: z.teamId ?? '',
              radiusM: z.radiusM ?? 25,
              visMode: z.visibility?.mode ?? 'all',
              visTeamIds: z.visibility?.teamIds ?? [],
            });
        }
      });
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  // ------------------------------------------------------------------ data

  async load(): Promise<void> {
    this.loading.set(this.event() === null);
    this.error.set(null);
    const id = this.eventId();
    try {
      const [event, objectives, pois, zones] = await Promise.all([this.api.event(id), this.api.objectives(id), this.api.pois(id), this.api.zones(id)]);
      this.event.set(event);
      this.objectives.set(objectives);
      this.pois.set(pois);
      this.zones.set(zones);
      if (!event.area) this.fitKey.update((k) => k + 1);
    } catch (e) {
      this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }

  // ------------------------------------------------------------------ tools

  protected setTool(t: Tool): void {
    this.resetDrawing();
    this.moveTarget.set(null);
    this.pendingPoi.set(null);
    this.menu.set(null);
    this.tool.set(t);
    if (t !== 'select') this.listOpen.update((open) => open && this.isWide());
  }

  protected setLayer(key: keyof Layers, on: boolean): void {
    this.layers.update((l) => ({ ...l, [key]: on }));
  }

  protected toggleMenu(m: 'layers' | 'more'): void {
    this.menu.update((cur) => (cur === m ? null : m));
  }

  protected openDialog(d: 'import' | 'saveTpl' | 'applyTpl'): void {
    this.menu.set(null);
    this.importError.set(null);
    if (d === 'import') this.importForm.reset({ format: 'geojson', content: '' });
    if (d === 'saveTpl') this.templateName.reset(this.event()?.name ?? '');
    if (d === 'applyTpl') void this.loadTemplates();
    this.dialog.set(d);
  }

  private isWide(): boolean {
    return typeof matchMedia !== 'undefined' && matchMedia('(min-width: 1024px)').matches;
  }

  private resetDrawing(): void {
    this.draftPoints.set([]);
    this.drawStage.set('points');
    this.editingZoneId.set(null);
  }

  /** Esc: cancel the innermost mode. */
  protected escape(): void {
    if (this.menu()) return this.menu.set(null);
    if (this.moveTarget()) return this.moveTarget.set(null);
    if (this.pendingPoi()) return this.pendingPoi.set(null);
    if (this.isDrawTool() && (this.draftPoints().length || this.drawStage() === 'details')) return this.cancelDrawing();
    if (this.tool() !== 'select') return this.setTool('select');
    this.selection.set(null);
  }

  protected cancelDrawing(): void {
    const wasEditing = this.editingZoneId();
    this.resetDrawing();
    if (wasEditing) this.tool.set('select');
  }

  protected undoPoint(): void {
    this.draftPoints.update((p) => p.slice(0, -1));
  }

  protected finishDrawing(): void {
    if (!this.canFinish()) return;
    if (this.editingZoneId()) {
      void this.saveEditedShape();
      return;
    }
    this.startDetails();
  }

  private startDetails(): void {
    if (this.drawStage() === 'details') return;
    const t = this.tool();
    const hasPlayable = this.zones().some((z) => z.kind === 'playable');
    const kind: ZoneKind = t === 'line' ? 'route' : t === 'circle' ? 'spawn' : t === 'label' ? 'label' : hasPlayable ? 'sector' : 'playable';
    this.zoneColorTouched = false;
    this.zoneForm.reset({ kind, label: '', color: ZONE_KIND_COLORS[kind], teamId: '', radiusM: 25 });
    this.drawStage.set('details');
    setTimeout(() => document.getElementById(t === 'label' ? 'zd-label' : 'zd-kind')?.focus());
  }

  // ------------------------------------------------------------------ map events

  protected onMapClick(p: LatLng): void {
    this.menu.set(null);
    const mv = this.moveTarget();
    if (mv) {
      void this.moveTo(mv, p);
      return;
    }
    switch (this.tool()) {
      case 'select':
        this.selection.set(null);
        break;
      case 'objective':
        void this.createObjectiveAt(p);
        break;
      case 'poi':
        this.selection.set(null);
        this.pendingPoi.set(p);
        break;
      case 'area':
      case 'line':
        if (this.drawStage() === 'points') this.draftPoints.update((pts) => [...pts, p]);
        break;
      case 'circle':
      case 'label':
        this.draftPoints.set([p]);
        if (!this.editingZoneId()) this.startDetails();
        break;
    }
  }

  protected onObjectiveClick(o: Objective): void {
    if (this.drawingPoints()) {
      // snap a vertex onto the objective
      this.draftPoints.update((pts) => [...pts, { lat: o.lat, lng: o.lng }]);
      return;
    }
    if (this.moveTarget()) return;
    this.pendingPoi.set(null);
    this.selection.set({ kind: 'objective', id: o.id });
  }

  protected onPoiClick(p: Poi): void {
    if (this.drawingPoints()) {
      this.draftPoints.update((pts) => [...pts, { lat: p.lat, lng: p.lng }]);
      return;
    }
    if (this.moveTarget()) return;
    this.pendingPoi.set(null);
    this.selection.set({ kind: 'poi', id: p.id });
  }

  protected onZoneClick(z: Zone): void {
    if (this.placing()) return;
    this.selection.set({ kind: 'zone', id: z.id });
  }

  protected onMarkerMoved(m: MarkerMove): void {
    void this.moveTo({ kind: m.kind, id: m.id }, m.position);
  }

  protected selectFromList(kind: SelKind, id: string): void {
    this.setTool('select');
    this.selection.set({ kind, id });
    const at = this.anchorOf({ kind, id });
    if (at) this.mapRef()?.panTo(at);
    if (!this.isWide()) this.listOpen.set(false);
  }

  private anchorOf(s: Sel): LatLng | null {
    if (s.kind === 'objective') {
      const o = this.objectives().find((x) => x.id === s.id);
      return o ? { lat: o.lat, lng: o.lng } : null;
    }
    if (s.kind === 'poi') {
      const p = this.pois().find((x) => x.id === s.id);
      return p ? { lat: p.lat, lng: p.lng } : null;
    }
    const z = this.zones().find((x) => x.id === s.id);
    return z ? this.zoneAnchor(z) : null;
  }

  protected zoneAnchor(z: Zone): LatLng {
    if (z.geometry === 'point' || z.geometry === 'circle') return z.points[0] ?? { lat: 0, lng: 0 };
    return centroid(z.points) ?? { lat: 0, lng: 0 };
  }

  protected geometryLabel(g: ZoneGeometry): string {
    return { point: 'Label', circle: 'Circle', polygon: 'Polygon', polyline: 'Line' }[g];
  }

  protected kindsForGeometry(g: ZoneGeometry): ZoneKind[] {
    if (g === 'polyline') return LINE_KINDS;
    if (g === 'circle') return CIRCLE_KINDS;
    if (g === 'point') return ['label'];
    return AREA_KINDS;
  }

  // ------------------------------------------------------------------ create

  private async createObjectiveAt(p: LatLng): Promise<void> {
    if (this.busy()) return;
    const names = new Set(this.objectives().map((o) => o.name));
    let n = this.objectives().length + 1;
    while (names.has(`Objective ${n}`)) n++;
    this.busy.set(true);
    try {
      const o = await this.api.createObjective(this.eventId(), { name: `Objective ${n}`, lat: p.lat, lng: p.lng, methods: ['code'] });
      this.objectives.update((l) => [...l, o]);
      this.selection.set({ kind: 'objective', id: o.id });
      this.toast.success(`${o.name} added`, 'Set its capture code and rewards in the full objective editor.');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async createPoi(type: PoiType): Promise<void> {
    const p = this.pendingPoi();
    if (!p || this.busy()) return;
    this.busy.set(true);
    try {
      const poi = await this.api.createPoi(this.eventId(), {
        name: POI_TYPE_LABELS[type],
        type,
        description: '',
        lat: p.lat,
        lng: p.lng,
        color: POI_TYPE_COLORS[type],
        imageUrl: null,
        teamId: null,
        visibility: { mode: 'all' },
      });
      this.pois.update((l) => [...l, poi]);
      this.pendingPoi.set(null);
      this.selection.set({ kind: 'poi', id: poi.id });
      this.toast.success(`${poi.name} added`);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveDraftZone(): Promise<void> {
    if (this.editingZoneId()) {
      await this.saveEditedShape();
      return;
    }
    const v = this.zoneForm.getRawValue();
    const t = this.tool();
    if (t === 'label' && !v.label.trim()) {
      this.zoneForm.controls.label.setErrors({ required: true });
      this.zoneForm.controls.label.markAsTouched();
      return;
    }
    const pts = this.draftPoints();
    const geometry: ZoneGeometry = t === 'area' ? 'polygon' : t === 'line' ? 'polyline' : t === 'circle' ? 'circle' : 'point';
    if ((geometry === 'polygon' && pts.length < 3) || (geometry === 'polyline' && pts.length < 2) || !pts.length) {
      this.toast.warning('Add more points first');
      return;
    }
    const body: ZoneInput = {
      kind: v.kind,
      geometry,
      points: geometry === 'circle' || geometry === 'point' ? pts.slice(0, 1) : pts,
      radiusM: geometry === 'circle' ? Math.max(1, Number(v.radiusM) || 25) : null,
      label: v.label.trim(),
      description: '',
      color: v.color,
      fillOpacity: geometry === 'polyline' || geometry === 'point' ? 0 : (ZONE_KIND_FILL[v.kind] ?? 0.2),
      strokeWidth: geometry === 'polyline' ? 3 : 2,
      icon: null,
      teamId: v.kind === 'base' && v.teamId ? v.teamId : null,
      visibility: { mode: 'all' },
    };
    this.busy.set(true);
    try {
      const z = await this.api.createZone(this.eventId(), body);
      this.zones.update((l) => [...l, z]);
      this.resetDrawing();
      this.tool.set('select');
      this.selection.set({ kind: 'zone', id: z.id });
      this.toast.success(`${z.label || ZONE_KIND_LABELS[z.kind]} added`, zoneSizeLabel(z) || undefined);
    } catch (e) {
      const err = ApiError.from(e);
      if (err.fields['label']) this.zoneForm.controls.label.setErrors({ server: err.fields['label'] });
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  // ------------------------------------------------------------------ edit

  protected objErr(path: string, label: string): string | null {
    return controlError(this.objForm.get(path), label);
  }
  protected poiErr(path: string, label: string): string | null {
    return controlError(this.poiForm.get(path), label);
  }
  protected zoneErr(path: string, label: string): string | null {
    return controlError(this.zoneForm.get(path), label);
  }
  protected zoneEditErr(path: string, label: string): string | null {
    return controlError(this.zoneEditForm.get(path), label);
  }
  protected tplNameErr(): string | null {
    return controlError(this.templateName, 'Name');
  }

  protected toggleTeam(ctrl: FormControl<string[]>, id: string, e: Event): void {
    toggleIn(ctrl, id, targetChecked(e));
  }

  protected async saveObjective(o: Objective): Promise<void> {
    this.objForm.markAllAsTouched();
    if (this.objForm.invalid) return;
    const v = this.objForm.getRawValue();
    await this.persist(
      () => this.api.updateObjective(this.eventId(), o.id, { name: v.name.trim(), type: v.type, color: v.color, enabled: v.enabled }),
      (saved) => {
        this.objectives.update((l) => l.map((x) => (x.id === saved.id ? saved : x)));
        this.objForm.markAsPristine();
      },
      this.objForm,
    );
  }

  protected async savePoi(p: Poi): Promise<void> {
    this.poiForm.markAllAsTouched();
    if (this.poiForm.invalid) return;
    const v = this.poiForm.getRawValue();
    await this.persist(
      () =>
        this.api.updatePoi(this.eventId(), p.id, {
          name: v.name.trim(),
          type: v.type,
          color: v.color,
          description: v.description,
          teamId: v.type === 'team_base' && v.teamId ? v.teamId : null,
          visibility: { ...p.visibility, mode: v.visMode, teamIds: v.visMode === 'teams' ? v.visTeamIds : [] },
        }),
      (saved) => {
        this.pois.update((l) => l.map((x) => (x.id === saved.id ? saved : x)));
        this.poiForm.markAsPristine();
      },
      this.poiForm,
    );
  }

  protected async saveZone(z: Zone): Promise<void> {
    this.zoneEditForm.markAllAsTouched();
    if (this.zoneEditForm.invalid) return;
    const v = this.zoneEditForm.getRawValue();
    await this.persist(
      () =>
        this.api.updateZone(this.eventId(), z.id, {
          kind: v.kind,
          label: v.label.trim(),
          description: v.description,
          color: v.color,
          fillOpacity: Number(v.fillOpacity),
          strokeWidth: Number(v.strokeWidth),
          teamId: v.kind === 'base' && v.teamId ? v.teamId : null,
          radiusM: z.geometry === 'circle' ? Math.max(1, Number(v.radiusM) || 1) : z.radiusM,
          visibility: { ...z.visibility, mode: v.visMode, teamIds: v.visMode === 'teams' ? v.visTeamIds : [] },
        }),
      (saved) => {
        this.zones.update((l) => l.map((x) => (x.id === saved.id ? saved : x)));
        this.zoneEditForm.markAsPristine();
      },
      this.zoneEditForm,
    );
  }

  private async persist<T>(call: () => Promise<T>, apply: (v: T) => void, form?: FormGroup): Promise<boolean> {
    this.busy.set(true);
    try {
      apply(await call());
      this.toast.success('Saved');
      return true;
    } catch (e) {
      const err = ApiError.from(e);
      if (form) {
        for (const [k, msg] of Object.entries(err.fields)) form.get(k)?.setErrors({ server: msg });
      }
      this.toast.error(err);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected editVertices(z: Zone): void {
    this.selection.set(null);
    this.moveTarget.set(null);
    this.tool.set(z.geometry === 'polygon' ? 'area' : z.geometry === 'polyline' ? 'line' : 'circle');
    this.editingZoneId.set(z.id);
    this.draftPoints.set(z.geometry === 'circle' ? z.points.slice(0, 1) : [...z.points]);
    this.zoneColorTouched = true;
    this.zoneForm.reset({ kind: z.kind, label: z.label, color: z.color, teamId: z.teamId ?? '', radiusM: z.radiusM ?? 25 });
    this.drawStage.set(z.geometry === 'circle' ? 'details' : 'points');
    if (z.geometry !== 'circle') this.toast.info('Editing vertices', 'Undo removes the last point; tap to add points; Finish saves.');
  }

  private async saveEditedShape(): Promise<void> {
    const id = this.editingZoneId();
    const z = this.zones().find((x) => x.id === id);
    if (!z || !this.canFinish()) return;
    const pts = this.draftPoints();
    const body: ZoneInput =
      z.geometry === 'circle' ? { points: pts.slice(0, 1), radiusM: Math.max(1, Number(this.zoneForm.controls.radiusM.value) || 1) } : { points: pts };
    const ok = await this.persist(
      () => this.api.updateZone(this.eventId(), z.id, body),
      (saved) => this.zones.update((l) => l.map((x) => (x.id === saved.id ? saved : x))),
    );
    if (ok) {
      this.resetDrawing();
      this.tool.set('select');
      this.selection.set({ kind: 'zone', id: z.id });
    }
  }

  // ------------------------------------------------------------------ move / duplicate / delete

  protected toggleMove(kind: SelKind, id: string): void {
    const cur = this.moveTarget();
    this.moveTarget.set(cur?.id === id ? null : { kind, id });
    if (!cur || cur.id !== id) this.tool.set('select');
  }

  private async moveTo(target: Sel, p: LatLng): Promise<void> {
    this.moveTarget.set(null);
    const id = this.eventId();
    if (target.kind === 'objective') {
      const prev = this.objectives();
      this.objectives.update((l) => l.map((o) => (o.id === target.id ? { ...o, lat: p.lat, lng: p.lng } : o)));
      try {
        const saved = await this.api.updateObjective(id, target.id, { lat: p.lat, lng: p.lng });
        this.objectives.update((l) => l.map((o) => (o.id === saved.id ? saved : o)));
        this.toast.success('Moved');
      } catch (e) {
        this.objectives.set(prev);
        this.toast.error(e);
      }
    } else if (target.kind === 'poi') {
      const prev = this.pois();
      this.pois.update((l) => l.map((x) => (x.id === target.id ? { ...x, lat: p.lat, lng: p.lng } : x)));
      try {
        const saved = await this.api.updatePoi(id, target.id, { lat: p.lat, lng: p.lng });
        this.pois.update((l) => l.map((x) => (x.id === saved.id ? saved : x)));
        this.toast.success('Moved');
      } catch (e) {
        this.pois.set(prev);
        this.toast.error(e);
      }
    } else {
      const z = this.zones().find((x) => x.id === target.id);
      if (!z) return;
      const from = this.zoneAnchor(z);
      const dLat = p.lat - from.lat;
      const dLng = p.lng - from.lng;
      const points = z.points.map((q) => ({ lat: q.lat + dLat, lng: q.lng + dLng }));
      const prev = this.zones();
      this.zones.update((l) => l.map((x) => (x.id === z.id ? { ...x, points } : x)));
      try {
        const saved = await this.api.updateZone(id, z.id, { points });
        this.zones.update((l) => l.map((x) => (x.id === saved.id ? saved : x)));
        this.toast.success('Moved');
      } catch (e) {
        this.zones.set(prev);
        this.toast.error(e);
      }
    }
  }

  protected async duplicate(kind: SelKind, elementId: string): Promise<void> {
    if (this.busy()) return;
    const id = this.eventId();
    this.busy.set(true);
    try {
      if (kind === 'objective') {
        const o = await this.api.duplicateObjective(id, elementId);
        this.objectives.update((l) => [...l, o]);
        this.selection.set({ kind, id: o.id });
        this.toast.success(`${o.name} created`, 'Duplicates get their own capture code and QR.');
      } else if (kind === 'poi') {
        const src = this.pois().find((p) => p.id === elementId);
        if (!src) return;
        const { id: _omit, ...rest } = src;
        const at = offset(src, 15, 135);
        const p = await this.api.createPoi(id, { ...rest, name: `${src.name} (copy)`, lat: at.lat, lng: at.lng });
        this.pois.update((l) => [...l, p]);
        this.selection.set({ kind, id: p.id });
        this.toast.success(`${p.name} created`);
      } else {
        const src = this.zones().find((z) => z.id === elementId);
        if (!src) return;
        const { id: _omit, ...rest } = src;
        const z = await this.api.createZone(id, {
          ...rest,
          label: src.label ? `${src.label} (copy)` : '',
          points: src.points.map((q) => offset(q, 15, 135)),
        });
        this.zones.update((l) => [...l, z]);
        this.selection.set({ kind, id: z.id });
        this.toast.success(`${z.label || ZONE_KIND_LABELS[z.kind]} created`);
      }
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(kind: SelKind, elementId: string): Promise<void> {
    const id = this.eventId();
    let name = '';
    const consequences: string[] = [];
    if (kind === 'objective') {
      const o = this.objectives().find((x) => x.id === elementId);
      if (!o) return;
      name = o.name;
      consequences.push('Players no longer see it and its capture code and QR stop working.');
      const dependants = this.objectives().filter((x) => x.prerequisiteIds.includes(o.id) || x.nextObjectiveId === o.id);
      if (dependants.length) consequences.push(`It is removed from the chain of ${dependants.map((d) => d.name).join(', ')}.`);
      if (o.captureCount) consequences.push(`Its ${o.captureCount} capture(s) stay in the ledger and results.`);
    } else if (kind === 'poi') {
      const p = this.pois().find((x) => x.id === elementId);
      if (!p) return;
      name = p.name;
      consequences.push('Players no longer see it on their map.');
    } else {
      const z = this.zones().find((x) => x.id === elementId);
      if (!z) return;
      name = z.label || ZONE_KIND_LABELS[z.kind];
      consequences.push('Players no longer see it on their map.');
      if (z.kind === 'playable') consequences.push('Players are no longer warned when they leave this playable area.');
    }
    consequences.push('This cannot be undone.');
    const ok = await this.confirm.ask({ title: `Delete ${name}?`, consequences, confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    this.busy.set(true);
    try {
      if (kind === 'objective') {
        await this.api.deleteObjective(id, elementId);
        this.objectives.update((l) => l.filter((x) => x.id !== elementId));
      } else if (kind === 'poi') {
        await this.api.deletePoi(id, elementId);
        this.pois.update((l) => l.filter((x) => x.id !== elementId));
      } else {
        await this.api.deleteZone(id, elementId);
        this.zones.update((l) => l.filter((x) => x.id !== elementId));
      }
      if (this.selection()?.id === elementId) this.selection.set(null);
      if (this.moveTarget()?.id === elementId) this.moveTarget.set(null);
      this.toast.success(`${name} deleted`);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  // ------------------------------------------------------------------ search & location

  protected attachAutocomplete(mobile = false): void {
    const input = (mobile ? this.searchInputMobile() : this.searchInput())?.nativeElement;
    if (!input || this.autocompletes.has(input)) return;
    if (!(typeof google !== 'undefined' && google.maps && google.maps.places?.Autocomplete)) return;
    try {
      const ac = new google.maps.places.Autocomplete(input, { fields: ['geometry', 'name'] });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        const loc = place.geometry?.location;
        if (loc) {
          this.searchText.set(place.name ?? input.value);
          const vp = place.geometry?.viewport;
          const gmap = this.mapRef()?.activeMap();
          if (vp && gmap) gmap.fitBounds(vp);
          else this.mapRef()?.panTo({ lat: loc.lat(), lng: loc.lng() }, 17);
          this.mobileSearch.set(false);
        }
      });
      this.autocompletes.add(input);
    } catch {
      /* Places library unavailable: coordinates still work */
    }
  }

  protected async submitSearch(): Promise<void> {
    const q = this.searchText().trim();
    if (!q) return;
    const ll = parseLatLng(q);
    if (ll) {
      this.mapRef()?.panTo(ll, 17);
      this.mobileSearch.set(false);
      return;
    }
    if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
      try {
        const res = await new google.maps.Geocoder().geocode({ address: q });
        const loc = res.results[0]?.geometry.location;
        if (loc) {
          this.mapRef()?.panTo({ lat: loc.lat(), lng: loc.lng() }, 16);
          this.mobileSearch.set(false);
          return;
        }
      } catch {
        /* fall through */
      }
      this.toast.warning('No place found', 'Try another name, or coordinates such as 45.4642, 9.1900.');
      return;
    }
    this.toast.info('Place search needs the online map', 'Enter coordinates such as 45.4642, 9.1900.');
  }

  protected useMyLocation(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.toast.warning('Location is not available on this device');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.mapRef()?.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 17);
        this.toast.info('Centred on your location', `Accuracy ±${Math.round(pos.coords.accuracy)} m`);
      },
      (err) => this.toast.warning('Could not get your location', err.code === err.PERMISSION_DENIED ? 'Allow location access in the browser settings.' : err.message),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }

  protected async setEventArea(): Promise<void> {
    this.menu.set(null);
    let area: { lat: number; lng: number; zoom: number } | null = null;
    const gmap = this.mapRef()?.activeMap();
    const c = gmap?.getCenter();
    if (gmap && c) {
      area = { lat: c.lat(), lng: c.lng(), zoom: Math.round(gmap.getZoom() ?? 16) };
    } else {
      const pts = [
        ...this.zones().flatMap((z) => z.points),
        ...this.objectives().map((o) => ({ lat: o.lat, lng: o.lng })),
        ...this.pois().map((p) => ({ lat: p.lat, lng: p.lng })),
      ];
      const ctr = centroid(pts);
      if (!ctr) {
        this.toast.warning('Nothing to centre on', 'Add elements first, or use the satellite map and frame the field.');
        return;
      }
      area = { ...ctr, zoom: 16 };
    }
    try {
      const ev = await this.api.updateEvent(this.eventId(), { area });
      this.event.set(ev);
      this.toast.success('Event area saved', `Players' maps open at ${formatLatLng(area)}.`);
    } catch (e) {
      this.toast.error(e);
    }
  }

  // ------------------------------------------------------------------ import & templates

  protected onImportFile(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
    void file.text().then((text) => {
      this.importForm.patchValue({ content: text, format: isCsv ? 'csv' : 'geojson' });
      this.importError.set(null);
    });
  }

  protected async runImport(): Promise<void> {
    const v = this.importForm.getRawValue();
    const content = v.content.trim();
    if (!content) {
      this.importError.set('Choose a file or paste the content.');
      return;
    }
    if (v.format === 'geojson') {
      try {
        JSON.parse(content);
      } catch {
        this.importError.set('This is not valid JSON. Check the file or switch the format to CSV.');
        return;
      }
    }
    this.busy.set(true);
    this.importError.set(null);
    try {
      const res = await this.api.importMap(this.eventId(), { format: v.format, content });
      this.toast.success('Map imported', `${res.objectives} objectives, ${res.pois} POIs, ${res.zones} zones added.`);
      this.dialog.set(null);
      await this.load();
      this.fitKey.update((k) => k + 1);
    } catch (e) {
      const err = ApiError.from(e);
      const details = Object.values(err.fields);
      this.importError.set([err.message, ...details].join(' '));
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveTemplate(): Promise<void> {
    this.templateName.markAsTouched();
    if (this.templateName.invalid || !this.templateName.value.trim()) {
      this.templateName.setErrors({ required: true });
      return;
    }
    this.busy.set(true);
    try {
      const t = await this.api.saveMapTemplate(this.eventId(), this.templateName.value.trim());
      this.toast.success(`Template "${t.name}" saved`, `${t.objectiveCount} objectives, ${t.poiCount} POIs, ${t.zoneCount} zones.`);
      this.dialog.set(null);
    } catch (e) {
      const err = ApiError.from(e);
      if (err.fields['name']) this.templateName.setErrors({ server: err.fields['name'] });
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  async loadTemplates(): Promise<void> {
    this.templates.set(null);
    this.templatesError.set(null);
    try {
      this.templates.set(await this.api.mapTemplates());
    } catch (e) {
      this.templatesError.set(e);
      this.templates.set([]);
    }
  }

  protected async applyTemplate(t: MapTemplate): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Apply "${t.name}"?`,
      consequences: [
        `Adds ${t.objectiveCount} objectives, ${t.poiCount} points of interest and ${t.zoneCount} zones to this map.`,
        'Existing elements are kept; check for duplicates afterwards.',
        'Objectives from the template get new capture codes and QR codes.',
      ],
      confirmLabel: 'Add elements',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const res = await this.api.applyMapTemplate(this.eventId(), t.id);
      this.toast.success('Template applied', `${res.objectives} objectives, ${res.pois} POIs, ${res.zones} zones added.`);
      this.dialog.set(null);
      await this.load();
      this.fitKey.update((k) => k + 1);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async deleteTemplate(t: MapTemplate): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Delete template "${t.name}"?`,
      consequences: ['Maps already created from it are not affected.', 'This cannot be undone.'],
      confirmLabel: 'Delete template',
      destructive: true,
    });
    if (!ok) return;
    try {
      await this.api.deleteMapTemplate(t.id);
      this.templates.update((l) => (l ?? []).filter((x) => x.id !== t.id));
      this.toast.success('Template deleted');
    } catch (e) {
      this.toast.error(e);
    }
  }

  // ------------------------------------------------------------------ keyboard

  protected onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (typeof document !== 'undefined' && document.querySelector('dialog[open]')) return;
    const target = e.target as HTMLElement | null;
    const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
    if (e.key === 'Escape') {
      if (typing) target?.blur();
      this.escape();
      return;
    }
    if (typing) return;
    if (e.key === 'Enter') {
      if (target?.closest('button, a')) return;
      if (this.isDrawTool() && this.drawStage() === 'points' && this.canFinish()) {
        e.preventDefault();
        this.finishDrawing();
      }
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (this.drawingPoints() && this.draftPoints().length) {
        e.preventDefault();
        this.undoPoint();
        return;
      }
      const s = this.selection();
      if (s) {
        e.preventDefault();
        void this.remove(s.kind, s.id);
      }
      return;
    }
    const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (t) {
      e.preventDefault();
      this.setTool(t.id);
    }
  }
}

/** Filled shapes become outlines so taps inside them reach the map while placing. */
function outlineZone(z: Zone): Zone {
  if (z.geometry === 'polygon' && z.points.length >= 3) return { ...z, geometry: 'polyline', points: [...z.points, z.points[0]] };
  if (z.geometry === 'circle' && z.points[0] && z.radiusM) return { ...z, geometry: 'polyline', points: circlePath(z.points[0], z.radiusM) };
  return z;
}
