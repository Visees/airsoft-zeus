import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, FormRecord, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { ApiService } from '../../core/api/api.service';
import { ApiError } from '../../core/api/api-error';
import { CaptureMethod, EventDetail, GeofenceConfig, LatLng, Objective, ObjectiveInput, ObjectiveQr, ObjectiveType, ObjectiveVisibility } from '../../core/api/models';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { OBJECTIVE_TYPE_LABELS, fromLocalInput, toLocalInput } from '../../core/util/format';
import { formatLatLng } from '../../core/util/geo';
import { TacticalMap } from '../../shared/map/tactical-map';
import { ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { StatusChip, objectiveStatusChip } from '../../shared/status-chip';
import { TeamSwatch } from '../../shared/team-swatch';
import { ColorField } from './ops/color-field';
import { applyServerErrors, controlError, num, safeReturn, targetChecked, toggleIn } from './ops/forms';
import { DEFAULT_GEOFENCE, DEFAULT_REWARDS, MAP_ICONS, escapeHtml, generateCaptureCode } from './ops/map-defaults';

type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed';

const SECTIONS = [
  { id: 'obj-basics', label: 'Basics' },
  { id: 'obj-position', label: 'Position' },
  { id: 'obj-methods', label: 'Capture methods' },
  { id: 'obj-geofence', label: 'Geofence' },
  { id: 'obj-rewards', label: 'Rewards' },
  { id: 'obj-availability', label: 'Availability' },
  { id: 'obj-visibility', label: 'Visibility' },
  { id: 'obj-chain', label: 'Chain' },
];

const SELECT_CLASS = 'h-11 w-full rounded-md border border-input bg-transparent px-2 dark:bg-input/30';

function teamOverrideGroup(points = 0, currency = 0, override = false) {
  return new FormGroup({
    override: new FormControl(override, { nonNullable: true }),
    points: new FormControl<number>(points, { nonNullable: true }),
    currency: new FormControl<number>(currency, { nonNullable: true }),
  });
}

/** Full objective editor (GM). Route: /gm/events/:eventId/objectives/:objectiveId ('new' allowed). */
@Component({
  selector: 'zeus-objective-editor-screen',
  imports: [
    ReactiveFormsModule,
    NgTemplateOutlet,
    NgIcon,
    HlmButton,
    HlmInput,
    HlmLabel,
    HlmSwitch,
    HlmTextarea,
    TacticalMap,
    LoadingSkeleton,
    ErrorState,
    PageHeader,
    StatusChip,
    TeamSwatch,
    ColorField,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  template: `
    <div class="page max-w-5xl!">
      <zeus-page-header
        [title]="isNew() ? 'New objective' : (objective()?.name ?? 'Objective')"
        [eyebrow]="event()?.name ?? 'Objective editor'"
        [back]="backUrl()"
        backLabel="Back"
      >
        @if (objective(); as o) {
          <zeus-status-chip [spec]="chip(o)" />
        }
      </zeus-page-header>

      @if (loading()) {
        <zeus-loading-skeleton [rows]="6" />
      } @else if (loadError()) {
        <zeus-error-state [error]="loadError()" (retry)="load()" />
      } @else {
        <div class="lg:grid lg:grid-cols-[11rem_1fr] lg:gap-8">
          <nav class="sticky top-4 hidden self-start lg:block" aria-label="Sections">
            <ul class="flex flex-col gap-0.5 text-sm">
              @for (s of sections; track s.id) {
                <li><a [href]="'#' + s.id" (click)="jump($event, s.id)" class="flex h-10 items-center rounded-sm px-2 text-muted-foreground hover:bg-muted hover:text-foreground">{{ s.label }}</a></li>
              }
              @if (showQrSection()) {
                <li><a href="#obj-qr" (click)="jump($event, 'obj-qr')" class="flex h-10 items-center rounded-sm px-2 text-muted-foreground hover:bg-muted hover:text-foreground">QR code</a></li>
              }
            </ul>
          </nav>

          <form [formGroup]="form" (ngSubmit)="save(true)" class="flex min-w-0 flex-col gap-6" novalidate>
            <!-- ============ Basics ============ -->
            <section id="obj-basics" class="panel flex scroll-mt-20 flex-col gap-4 p-4" aria-labelledby="h-basics">
              <h2 id="h-basics" class="label-caps">Basics</h2>
              <div class="flex flex-col gap-1.5">
                <label hlmLabel for="o-name">Name <span aria-hidden="true">*</span></label>
                <input hlmInput id="o-name" formControlName="name" class="h-11" maxlength="80" autocomplete="off" />
                @if (e('name', 'Name'); as m) {
                  <p class="field-error">{{ m }}</p>
                }
              </div>
              <div class="flex flex-col gap-1.5">
                <label hlmLabel for="o-type">Type</label>
                <select id="o-type" formControlName="type" [class]="selectClass">
                  @for (t of types; track t) {
                    <option [value]="t">{{ typeLabels[t] }}</option>
                  }
                </select>
              </div>
              <div class="flex flex-col gap-1.5">
                <label hlmLabel for="o-desc">Description <span class="font-normal text-muted-foreground">(players see it)</span></label>
                <textarea hlmTextarea id="o-desc" formControlName="description" rows="3" maxlength="2000"></textarea>
                @if (e('description', 'Description'); as m) {
                  <p class="field-error">{{ m }}</p>
                }
              </div>
              <div class="flex flex-col gap-1.5">
                <label hlmLabel for="o-instr">Capture instructions</label>
                <textarea hlmTextarea id="o-instr" formControlName="instructions" rows="3" maxlength="2000" placeholder="e.g. The code is on the back of the radio crate."></textarea>
              </div>
              <div class="flex flex-col gap-1.5">
                <span hlmLabel>Marker colour</span>
                <zeus-color-field formControlName="color" label="Marker colour" />
              </div>
              <fieldset class="flex flex-col gap-1.5">
                <legend class="mb-1.5 text-sm font-medium">Icon</legend>
                <div class="flex flex-wrap gap-1.5">
                  @for (i of icons; track i.value) {
                    <label class="grid size-11 cursor-pointer place-items-center rounded-md border border-border has-checked:border-primary has-checked:bg-primary/15" [title]="i.label">
                      <input type="radio" formControlName="icon" [value]="i.value" class="sr-only" [attr.aria-label]="i.label" />
                      <ng-icon [name]="i.icon" size="18" aria-hidden="true" />
                    </label>
                  }
                </div>
              </fieldset>
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="flex flex-col gap-1.5">
                  <span hlmLabel id="lbl-img">Image</span>
                  @if (value().imageUrl) {
                    <img [src]="value().imageUrl" alt="Objective image" class="aspect-video w-full rounded-md border border-border object-cover" />
                    <button hlmBtn type="button" variant="outline" class="h-10" (click)="clearUpload('imageUrl')">Remove image</button>
                  } @else {
                    <label class="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input text-sm hover:bg-muted">
                      <ng-icon name="lucideImage" size="16" aria-hidden="true" />
                      {{ uploading() === 'imageUrl' ? 'Uploading…' : 'Upload image' }}
                      <input type="file" accept="image/*" class="sr-only" aria-labelledby="lbl-img" (change)="upload($event, 'imageUrl')" [disabled]="!!uploading()" />
                    </label>
                  }
                </div>
                <div class="flex flex-col gap-1.5">
                  <span hlmLabel id="lbl-doc">Document <span class="font-normal text-muted-foreground">(briefing, intel)</span></span>
                  @if (value().documentUrl) {
                    <a [href]="value().documentUrl" target="_blank" rel="noopener" class="flex h-11 items-center gap-2 truncate rounded-md border border-border px-3 text-sm underline-offset-4 hover:underline">
                      <ng-icon name="lucideFileText" size="16" aria-hidden="true" /> Open document
                    </a>
                    <button hlmBtn type="button" variant="outline" class="h-10" (click)="clearUpload('documentUrl')">Remove document</button>
                  } @else {
                    <label class="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input text-sm hover:bg-muted">
                      <ng-icon name="lucideUpload" size="16" aria-hidden="true" />
                      {{ uploading() === 'documentUrl' ? 'Uploading…' : 'Upload document' }}
                      <input type="file" accept=".pdf,image/*,.txt,.md" class="sr-only" aria-labelledby="lbl-doc" (change)="upload($event, 'documentUrl')" [disabled]="!!uploading()" />
                    </label>
                  }
                </div>
              </div>
            </section>

            <!-- ============ Position ============ -->
            <section id="obj-position" class="panel flex scroll-mt-20 flex-col gap-4 p-4" aria-labelledby="h-pos">
              <h2 id="h-pos" class="label-caps">Position</h2>
              <div class="grid grid-cols-2 gap-3">
                <div class="flex flex-col gap-1.5">
                  <label hlmLabel for="o-lat">Latitude</label>
                  <input hlmInput id="o-lat" type="number" step="0.00001" formControlName="lat" class="num h-11" />
                  @if (e('lat', 'Latitude'); as m) {
                    <p class="field-error">{{ m }}</p>
                  }
                </div>
                <div class="flex flex-col gap-1.5">
                  <label hlmLabel for="o-lng">Longitude</label>
                  <input hlmInput id="o-lng" type="number" step="0.00001" formControlName="lng" class="num h-11" />
                  @if (e('lng', 'Longitude'); as m) {
                    <p class="field-error">{{ m }}</p>
                  }
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>Tap the map to place the objective. Other objectives are shown in grey.</span>
                <button hlmBtn type="button" variant="outline" class="h-10" (click)="useMyPosition()">
                  <ng-icon name="lucideLocateFixed" size="16" aria-hidden="true" /> Use my position
                </button>
              </div>
              <zeus-tactical-map
                class="h-72 rounded-md border border-border"
                [objectives]="mapObjectives()"
                [zones]="zones()"
                [teams]="event()?.teams ?? []"
                [selectedId]="objective()?.id ?? 'draft'"
                [center]="mapCenter()"
                [zoom]="17"
                [showLabels]="true"
                [shapesClickable]="false"
                (mapClick)="setPosition($event)"
              />
            </section>

            <!-- ============ Capture methods ============ -->
            <section id="obj-methods" class="panel flex scroll-mt-20 flex-col gap-4 p-4" aria-labelledby="h-methods" formGroupName="methods">
              <h2 id="h-methods" class="label-caps">Capture methods</h2>
              <div class="grid gap-2 sm:grid-cols-3">
                <label class="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border px-3 has-checked:border-primary has-checked:bg-primary/10">
                  <input type="checkbox" formControlName="code" class="size-5 accent-primary" />
                  <span><span class="font-semibold">Manual code</span><br /><span class="text-xs text-muted-foreground">Players type a code found on site</span></span>
                </label>
                <label class="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border px-3 has-checked:border-primary has-checked:bg-primary/10">
                  <input type="checkbox" formControlName="qr" class="size-5 accent-primary" />
                  <span><span class="font-semibold">QR code</span><br /><span class="text-xs text-muted-foreground">Players scan a printed code</span></span>
                </label>
                <label class="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border px-3 has-checked:border-primary has-checked:bg-primary/10">
                  <input type="checkbox" formControlName="geofence" class="size-5 accent-primary" />
                  <span><span class="font-semibold">Geofence</span><br /><span class="text-xs text-muted-foreground">Hold the zone for a time</span></span>
                </label>
              </div>
              @if (methodsError()) {
                <p class="field-error" role="alert">{{ methodsError() }}</p>
              }
            </section>

            <section class="panel -mt-4 flex flex-col gap-4 border-t-0 p-4 pt-0" aria-label="Capture rules">
              @if (value().methods?.code || value().methods?.qr) {
                <label class="flex min-h-11 cursor-pointer items-start gap-3">
                  <input type="checkbox" formControlName="requireGeofence" class="mt-1 size-5 accent-primary" />
                  <span>
                    Require holding the zone before the code or QR works
                    <span class="block text-sm text-muted-foreground">The player must be inside the geofence radius (with good GPS) for the required time; only then does the server accept the code or QR. Stops players from sharing codes over the radio.</span>
                  </span>
                </label>
              }
              @if (value().methods?.code) {
                <div class="flex flex-col gap-1.5">
                  <label hlmLabel for="o-code">Manual capture code</label>
                  <div class="flex gap-2">
                    <input
                      hlmInput
                      id="o-code"
                      formControlName="captureCode"
                      class="num h-11 uppercase tracking-widest"
                      maxlength="32"
                      autocomplete="off"
                      autocapitalize="characters"
                      spellcheck="false"
                      (input)="upperCode()"
                    />
                    <button hlmBtn type="button" variant="outline" class="h-11" (click)="generateCode()">
                      <ng-icon name="lucideRefreshCw" size="16" aria-hidden="true" /> Generate
                    </button>
                  </div>
                  @if (e('captureCode', 'Code'); as m) {
                    <p class="field-error">{{ m }}</p>
                  }
                  <p class="text-sm text-muted-foreground">4–32 letters and digits, unique within this event. Never shown to players; checked on the server. Generated codes avoid look-alike characters (0/O, 1/I/L). Left empty on a new objective, the server generates one.</p>
                </div>
              }
            </section>

            <!-- ============ QR ============ -->
            @if (showQrSection()) {
              <section id="obj-qr" class="panel flex scroll-mt-20 flex-col gap-4 p-4" aria-labelledby="h-qr">
                <h2 id="h-qr" class="label-caps">QR code{{ qr() ? ' · version ' + qr()!.qrVersion : '' }}</h2>
                @if (!objective()?.methods?.includes('qr')) {
                  <p class="text-sm text-muted-foreground">Save the objective with QR enabled to generate its QR code.</p>
                } @else if (qrError()) {
                  <zeus-error-state [error]="qrError()" (retry)="loadQr()" />
                } @else if (!qr()) {
                  <p class="text-sm text-muted-foreground" role="status">Loading QR code…</p>
                } @else {
                  <div class="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                    <div class="w-64 max-w-full rounded-md bg-white p-3 [&_svg]:h-auto [&_svg]:w-full" [innerHTML]="qrSvg()" role="img" [attr.aria-label]="'QR code for ' + (objective()?.name ?? 'objective')"></div>
                    <div class="flex w-full flex-col gap-2 sm:w-auto">
                      <button hlmBtn type="button" variant="outline" class="h-11 justify-start" (click)="downloadPng()">
                        <ng-icon name="lucideDownload" size="16" aria-hidden="true" /> Download PNG
                      </button>
                      <button hlmBtn type="button" variant="outline" class="h-11 justify-start" (click)="printQr()">
                        <ng-icon name="lucidePrinter" size="16" aria-hidden="true" /> Print
                      </button>
                      <button hlmBtn type="button" variant="destructive" class="h-11 justify-start" (click)="regenerateQr()" [disabled]="qrBusy()">
                        <ng-icon name="lucideRotateCcw" size="16" aria-hidden="true" /> {{ qrBusy() ? 'Regenerating…' : 'Regenerate' }}
                      </button>
                      <p class="max-w-xs text-sm text-muted-foreground">Print it, laminate it and fix it at the objective. Regenerate if a printed copy leaks.</p>
                    </div>
                  </div>
                }
              </section>
            }

            <!-- ============ Geofence ============ -->
            <section id="obj-geofence" class="panel flex scroll-mt-20 flex-col gap-4 p-4" aria-labelledby="h-geo" formGroupName="geofence">
              <h2 id="h-geo" class="label-caps">Geofence{{ geofenceUsed() ? '' : ' · not used' }}</h2>
              @if (!geofenceUsed()) {
                <p class="text-sm text-muted-foreground">Enable the geofence method or "Require holding the zone" to use these settings.</p>
              }
              <div class="grid gap-4 sm:grid-cols-3" [class.opacity-60]="!geofenceUsed()">
                <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: g.radiusM, id: 'g-radius', label: 'Radius (m)', min: 3, path: 'geofence.radiusM' }" />
                <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: g.durationSec, id: 'g-dur', label: 'Required time (s)', min: 0, path: 'geofence.durationSec' }" />
                <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: g.maxAccuracyM, id: 'g-acc', label: 'Max GPS accuracy (m)', min: 1, path: 'geofence.maxAccuracyM' }" />
              </div>
              @if (geofenceUsed()) {
                @for (w of geofenceWarnings(); track w) {
                  <p class="text-sm text-warning" role="status">▲ {{ w }}</p>
                }
              }
              <div class="flex flex-col" [class.opacity-60]="!geofenceUsed()">
                <label class="flex min-h-11 cursor-pointer items-start gap-3 py-1">
                  <input type="checkbox" formControlName="resetOnExit" class="mt-1 size-5 accent-primary" />
                  <span>Reset progress when the player leaves the zone <span class="block text-sm text-muted-foreground">Otherwise progress pauses and resumes on return.</span></span>
                </label>
                <label class="flex min-h-11 cursor-pointer items-start gap-3 py-1">
                  <input type="checkbox" formControlName="contestable" class="mt-1 size-5 accent-primary" />
                  <span>Enemies in the zone contest it <span class="block text-sm text-muted-foreground">Another team inside the zone affects the capture, as chosen below.</span></span>
                </label>
                @if (g.contestable.value) {
                  <fieldset class="ml-8 flex flex-col">
                    <legend class="sr-only">When several teams are inside</legend>
                    <label class="flex min-h-11 cursor-pointer items-start gap-3 py-1">
                      <input type="radio" formControlName="contestRule" value="pause" class="mt-1 size-5 accent-primary" />
                      <span>Nobody progresses <span class="block text-sm text-muted-foreground">The zone is contested while two or more teams are inside.</span></span>
                    </label>
                    <label class="flex min-h-11 cursor-pointer items-start gap-3 py-1">
                      <input type="radio" formControlName="contestRule" value="majority" class="mt-1 size-5 accent-primary" />
                      <span>Majority captures (domination) <span class="block text-sm text-muted-foreground">The team with the most players inside keeps capturing; a tie contests the zone.</span></span>
                    </label>
                  </fieldset>
                }
                <label class="flex min-h-11 cursor-pointer items-start gap-3 py-1">
                  <input type="checkbox" formControlName="requireScreenOpen" class="mt-1 size-5 accent-primary" />
                  <span>Player must keep the objective screen open <span class="block text-sm text-muted-foreground">Progress only counts while the objective is open in the app.</span></span>
                </label>
                <label class="flex min-h-11 cursor-pointer items-start gap-3 py-1">
                  <input type="checkbox" formControlName="multiPlayerBoost" class="mt-1 size-5 accent-primary" />
                  <span>More players capture faster</span>
                </label>
              </div>
              @if (value().geofence?.multiPlayerBoost) {
                <div class="grid gap-4 sm:grid-cols-2">
                  <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: g.boostPerExtraPlayer, id: 'g-boost', label: 'Speed-up per extra player (×)', min: 0, step: 0.05, path: 'geofence.boostPerExtraPlayer', hint: '0.25 = each extra player adds 25%' }" />
                  <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: g.maxMultiplier, id: 'g-maxm', label: 'Maximum multiplier (×)', min: 1, step: 0.25, path: 'geofence.maxMultiplier' }" />
                </div>
              }
            </section>

            <!-- ============ Rewards ============ -->
            <section id="obj-rewards" class="panel flex scroll-mt-20 flex-col gap-4 p-4" aria-labelledby="h-rew" formGroupName="rewards">
              <h2 id="h-rew" class="label-caps">Rewards</h2>
              <div class="grid gap-4 sm:grid-cols-2">
                <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: r.points, id: 'r-pts', label: 'Victory points per capture', min: 0, path: 'rewards.points' }" />
                <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: r.currency, id: 'r-cur', label: 'Credits per capture', min: 0, path: 'rewards.currency' }" />
                <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: r.recurringPointsPerMinute, id: 'r-rpts', label: 'Points per minute while held', min: 0, path: 'rewards.recurringPointsPerMinute' }" />
                <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: r.recurringCurrencyPerMinute, id: 'r-rcur', label: 'Credits per minute while held', min: 0, path: 'rewards.recurringCurrencyPerMinute' }" />
                <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: r.captureBonus, id: 'r-first', label: 'First-capture bonus (points)', min: 0, path: 'rewards.captureBonus' }" />
                <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: r.defenseBonus, id: 'r-def', label: 'Defense bonus (points)', min: 0, path: 'rewards.defenseBonus', hint: 'For holding it until the end of the game' }" />
                <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: r.completionBonus, id: 'r-comp', label: 'Completion bonus (points)', min: 0, path: 'rewards.completionBonus', hint: 'When the last allowed capture is made' }" />
              </div>
              @if (event()?.teams?.length) {
                <div>
                  <h3 class="mb-2 text-sm font-semibold">Per-team overrides</h3>
                  <div class="overflow-x-auto">
                    <table class="w-full min-w-88 text-sm">
                      <thead>
                        <tr class="text-left text-muted-foreground">
                          <th class="py-1.5 pr-2 font-medium">Team</th>
                          <th class="py-1.5 pr-2 font-medium">Override</th>
                          <th class="py-1.5 pr-2 font-medium">Points</th>
                          <th class="py-1.5 font-medium">Credits</th>
                        </tr>
                      </thead>
                      <tbody formGroupName="perTeam">
                        @for (t of event()!.teams; track t.id) {
                          <tr class="border-t border-border" [formGroupName]="t.id">
                            <td class="py-1.5 pr-2">
                              <span class="inline-flex items-center gap-1.5"><zeus-team-swatch [color]="t.color" [pattern]="t.pattern" />{{ t.name }}</span>
                            </td>
                            <td class="py-1.5 pr-2">
                              <input type="checkbox" formControlName="override" class="size-5 accent-primary" [attr.aria-label]="'Override rewards for ' + t.name" />
                            </td>
                            <td class="py-1.5 pr-2">
                              <input hlmInput type="number" min="0" formControlName="points" class="num h-10 w-24" [attr.aria-label]="'Points for ' + t.name" />
                            </td>
                            <td class="py-1.5">
                              <input hlmInput type="number" min="0" formControlName="currency" class="num h-10 w-24" [attr.aria-label]="'Credits for ' + t.name" />
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  <p class="mt-1 text-sm text-muted-foreground">Teams without an override get the default rewards above.</p>
                </div>
              }
            </section>

            <!-- ============ Availability ============ -->
            <section id="obj-availability" class="panel flex scroll-mt-20 flex-col gap-4 p-4" aria-labelledby="h-av">
              <h2 id="h-av" class="label-caps">Availability and limits</h2>
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="flex flex-col gap-1.5">
                  <label hlmLabel for="o-start">Available from</label>
                  <input hlmInput id="o-start" type="datetime-local" formControlName="availabilityStart" class="h-11" />
                  @if (e('availabilityStart', 'Start'); as m) {
                    <p class="field-error">{{ m }}</p>
                  }
                </div>
                <div class="flex flex-col gap-1.5">
                  <label hlmLabel for="o-end">Available until</label>
                  <input hlmInput id="o-end" type="datetime-local" formControlName="availabilityEnd" class="h-11" />
                  @if (e('availabilityEnd', 'End'); as m) {
                    <p class="field-error">{{ m }}</p>
                  }
                </div>
                <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: form.controls.cooldownSec, id: 'o-cd', label: 'Cooldown after a capture (s)', min: 0, path: 'cooldownSec' }" />
                <ng-container [ngTemplateOutlet]="numField" [ngTemplateOutletContext]="{ $implicit: form.controls.maxCaptures, id: 'o-max', label: 'Maximum captures', min: 0, path: 'maxCaptures', hint: '0 = unlimited' }" />
              </div>
              <p class="-mt-2 text-sm text-muted-foreground">Leave the dates empty to make it available for the whole game.</p>
              <fieldset>
                <legend class="mb-1 text-sm font-medium">Teams allowed to capture</legend>
                <p class="mb-1 text-sm text-muted-foreground">None selected = every team.</p>
                <div class="flex flex-wrap gap-x-4">
                  @for (t of event()?.teams ?? []; track t.id) {
                    <label class="flex min-h-11 cursor-pointer items-center gap-2">
                      <input type="checkbox" class="size-5 accent-primary" [checked]="value().allowedTeamIds?.includes(t.id)" (change)="toggle(form.controls.allowedTeamIds, t.id, $event)" />
                      <zeus-team-swatch [color]="t.color" [pattern]="t.pattern" />{{ t.name }}
                    </label>
                  }
                </div>
              </fieldset>
            </section>

            <!-- ============ Visibility ============ -->
            <section id="obj-visibility" class="panel flex scroll-mt-20 flex-col gap-3 p-4" aria-labelledby="h-vis" formGroupName="visibility">
              <h2 id="h-vis" class="label-caps">Visibility</h2>
              @for (m of visibilityModes; track m.value) {
                <label class="flex min-h-11 cursor-pointer items-start gap-3">
                  <input type="radio" formControlName="mode" [value]="m.value" class="mt-1 size-4 accent-primary" />
                  <span>{{ m.label }}<span class="block text-sm text-muted-foreground">{{ m.hint }}</span></span>
                </label>
              }
              @if (value().visibility?.mode === 'teams') {
                <div class="ml-7 flex flex-wrap gap-x-4">
                  @for (t of event()?.teams ?? []; track t.id) {
                    <label class="flex min-h-11 cursor-pointer items-center gap-2">
                      <input type="checkbox" class="size-5 accent-primary" [checked]="value().visibility?.teamIds?.includes(t.id)" (change)="toggle(form.controls.visibility.controls.teamIds, t.id, $event)" />
                      <zeus-team-swatch [color]="t.color" [pattern]="t.pattern" />{{ t.name }}
                    </label>
                  }
                </div>
              }
              @if (value().visibility?.mode === 'after_prerequisites' && !value().prerequisiteIds?.length) {
                <p class="text-sm text-warning">Choose prerequisite objectives in the Chain section, otherwise it is visible from the start.</p>
              }
            </section>

            <!-- ============ Chain ============ -->
            <section id="obj-chain" class="panel flex scroll-mt-20 flex-col gap-4 p-4" aria-labelledby="h-chain">
              <h2 id="h-chain" class="label-caps">Chain</h2>
              <fieldset>
                <legend class="mb-1 text-sm font-medium">Prerequisites</legend>
                <p class="mb-1 text-sm text-muted-foreground">It stays locked until a team has captured all of these.</p>
                @if (otherObjectives().length) {
                  <div class="flex flex-col">
                    @for (o of otherObjectives(); track o.id) {
                      <label class="flex min-h-11 cursor-pointer items-center gap-3">
                        <input type="checkbox" class="size-5 accent-primary" [checked]="value().prerequisiteIds?.includes(o.id)" (change)="toggle(form.controls.prerequisiteIds, o.id, $event)" />
                        <span class="inline-block size-3 rotate-45 rounded-xs border-2" [style.border-color]="o.color" aria-hidden="true"></span>{{ o.name }}
                      </label>
                    }
                  </div>
                } @else {
                  <p class="text-sm text-muted-foreground">No other objectives in this event yet.</p>
                }
              </fieldset>
              <div class="flex flex-col gap-1.5">
                <label hlmLabel for="o-next">Next objective <span class="font-normal text-muted-foreground">(revealed or activated after this one)</span></label>
                <select id="o-next" formControlName="nextObjectiveId" [class]="selectClass">
                  <option value="">None</option>
                  @for (o of otherObjectives(); track o.id) {
                    <option [value]="o.id">{{ o.name }}</option>
                  }
                </select>
                @if (chainWarning()) {
                  <p class="text-sm text-warning">{{ chainWarning() }}</p>
                }
              </div>
            </section>

            <section class="panel flex items-center justify-between gap-3 p-4">
              <label for="o-enabled" class="flex flex-col">
                <span class="font-semibold">Enabled</span>
                <span class="text-sm text-muted-foreground">Disabled objectives are hidden from players and cannot be captured.</span>
              </label>
              <hlm-switch inputId="o-enabled" formControlName="enabled" />
            </section>

            @if (!isNew()) {
              <section class="flex flex-wrap gap-2">
                <button hlmBtn type="button" variant="outline" class="h-11" (click)="duplicate()" [disabled]="saveState() === 'saving'">
                  <ng-icon name="lucideCopy" size="16" aria-hidden="true" /> Duplicate
                </button>
                <button hlmBtn type="button" variant="destructive" class="h-11" (click)="remove()" [disabled]="saveState() === 'saving'">
                  <ng-icon name="lucideTrash2" size="16" aria-hidden="true" /> Delete objective
                </button>
              </section>
            }

            <!-- sticky save bar -->
            <div class="hud sticky bottom-[calc(4.5rem+var(--safe-bottom))] z-10 flex flex-wrap items-center gap-2 p-2 lg:bottom-3" role="region" aria-label="Save">
              <p class="flex min-w-0 flex-1 items-center gap-2 px-1 text-sm" role="status" aria-live="polite">
                <span aria-hidden="true" [class]="saveStateTone()">{{ saveStateGlyph() }}</span>
                <span>{{ saveStateLabel() }}</span>
              </p>
              <button hlmBtn type="button" variant="outline" class="h-11" (click)="save(false)" [disabled]="saveState() === 'saving'">Save</button>
              <button hlmBtn type="submit" class="h-11" [disabled]="saveState() === 'saving'">
                {{ saveState() === 'saving' ? 'Saving…' : isNew() ? 'Create objective' : 'Save and close' }}
              </button>
            </div>
          </form>
        </div>
      }
    </div>

    <ng-template #numField let-c let-id="id" let-label="label" let-min="min" let-step="step" let-hint="hint" let-path="path">
      <div class="flex flex-col gap-1.5">
        <label hlmLabel [for]="id">{{ label }}</label>
        <input hlmInput type="number" inputmode="decimal" [id]="id" [formControl]="c" [attr.min]="min" [attr.step]="step ?? 1" class="num h-11" />
        @if (hint) {
          <p class="text-xs text-muted-foreground">{{ hint }}</p>
        }
        @if (e(path, label); as m) {
          <p class="field-error">{{ m }}</p>
        }
      </div>
    </ng-template>
  `,
})
export class ObjectiveEditorScreen {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly eventId = input.required<string>();
  readonly objectiveId = input.required<string>();
  readonly lat = input<string>();
  readonly lng = input<string>();
  readonly returnTo = input<string>();

  protected readonly sections = SECTIONS;
  protected readonly selectClass = SELECT_CLASS;
  protected readonly types = Object.keys(OBJECTIVE_TYPE_LABELS) as ObjectiveType[];
  protected readonly typeLabels = OBJECTIVE_TYPE_LABELS;
  protected readonly icons = MAP_ICONS;
  protected readonly visibilityModes: { value: ObjectiveVisibility['mode']; label: string; hint: string }[] = [
    { value: 'all', label: 'Everyone', hint: 'All players see it on the map from the start.' },
    { value: 'teams', label: 'Selected teams', hint: 'Only the chosen teams see it.' },
    { value: 'after_prerequisites', label: 'Hidden until prerequisites are captured', hint: 'Appears when its prerequisite objectives are captured.' },
    { value: 'gm_only', label: 'Game Masters only', hint: 'Hidden from every player.' },
  ];
  protected readonly chip = (o: Objective) => objectiveStatusChip(o.status);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<unknown>(null);
  protected readonly event = signal<EventDetail | null>(null);
  protected readonly objective = signal<Objective | null>(null);
  protected readonly allObjectives = signal<Objective[]>([]);
  protected readonly zones = signal<import('../../core/api/models').Zone[]>([]);
  protected readonly mapCenter = signal<LatLng | null>(null);
  protected readonly saveState = signal<SaveState>('clean');
  protected readonly uploading = signal<'imageUrl' | 'documentUrl' | null>(null);
  protected readonly methodsError = signal<string | null>(null);
  protected readonly qr = signal<ObjectiveQr | null>(null);
  protected readonly qrError = signal<unknown>(null);
  protected readonly qrBusy = signal(false);
  private patching = false;

  protected readonly isNew = computed(() => this.objectiveId() === 'new');

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    type: new FormControl<ObjectiveType>('domination', { nonNullable: true }),
    description: new FormControl('', { nonNullable: true }),
    instructions: new FormControl('', { nonNullable: true }),
    color: new FormControl('#E6B04F', { nonNullable: true }),
    icon: new FormControl('flag', { nonNullable: true }),
    imageUrl: new FormControl<string | null>(null),
    documentUrl: new FormControl<string | null>(null),
    lat: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(-90), Validators.max(90)] }),
    lng: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(-180), Validators.max(180)] }),
    methods: new FormGroup({
      code: new FormControl(true, { nonNullable: true }),
      qr: new FormControl(false, { nonNullable: true }),
      geofence: new FormControl(false, { nonNullable: true }),
    }),
    requireGeofence: new FormControl(false, { nonNullable: true }),
    captureCode: new FormControl('', { nonNullable: true, validators: [Validators.minLength(4), Validators.maxLength(32), Validators.pattern(/^[A-Za-z0-9]*$/)] }),
    geofence: new FormGroup({
      radiusM: new FormControl<number>(DEFAULT_GEOFENCE.radiusM, { nonNullable: true, validators: [Validators.min(3)] }),
      durationSec: new FormControl<number>(DEFAULT_GEOFENCE.durationSec, { nonNullable: true, validators: [Validators.min(0)] }),
      resetOnExit: new FormControl(DEFAULT_GEOFENCE.resetOnExit, { nonNullable: true }),
      multiPlayerBoost: new FormControl(DEFAULT_GEOFENCE.multiPlayerBoost, { nonNullable: true }),
      boostPerExtraPlayer: new FormControl<number>(DEFAULT_GEOFENCE.boostPerExtraPlayer, { nonNullable: true, validators: [Validators.min(0)] }),
      maxMultiplier: new FormControl<number>(DEFAULT_GEOFENCE.maxMultiplier, { nonNullable: true, validators: [Validators.min(1)] }),
      contestable: new FormControl(DEFAULT_GEOFENCE.contestable, { nonNullable: true }),
      contestRule: new FormControl<GeofenceConfig['contestRule']>(DEFAULT_GEOFENCE.contestRule, { nonNullable: true }),
      requireScreenOpen: new FormControl(DEFAULT_GEOFENCE.requireScreenOpen, { nonNullable: true }),
      maxAccuracyM: new FormControl<number>(DEFAULT_GEOFENCE.maxAccuracyM, { nonNullable: true, validators: [Validators.min(1)] }),
    }),
    rewards: new FormGroup({
      points: new FormControl<number>(DEFAULT_REWARDS.points, { nonNullable: true, validators: [Validators.min(0)] }),
      currency: new FormControl<number>(DEFAULT_REWARDS.currency, { nonNullable: true, validators: [Validators.min(0)] }),
      recurringPointsPerMinute: new FormControl<number>(0, { nonNullable: true, validators: [Validators.min(0)] }),
      recurringCurrencyPerMinute: new FormControl<number>(0, { nonNullable: true, validators: [Validators.min(0)] }),
      captureBonus: new FormControl<number>(0, { nonNullable: true, validators: [Validators.min(0)] }),
      defenseBonus: new FormControl<number>(0, { nonNullable: true, validators: [Validators.min(0)] }),
      completionBonus: new FormControl<number>(0, { nonNullable: true, validators: [Validators.min(0)] }),
      perTeam: new FormRecord<ReturnType<typeof teamOverrideGroup>>({}),
    }),
    availabilityStart: new FormControl('', { nonNullable: true }),
    availabilityEnd: new FormControl('', { nonNullable: true }),
    cooldownSec: new FormControl<number>(0, { nonNullable: true, validators: [Validators.min(0)] }),
    maxCaptures: new FormControl<number>(0, { nonNullable: true, validators: [Validators.min(0)] }),
    allowedTeamIds: new FormControl<string[]>([], { nonNullable: true }),
    visibility: new FormGroup({
      mode: new FormControl<ObjectiveVisibility['mode']>('all', { nonNullable: true }),
      teamIds: new FormControl<string[]>([], { nonNullable: true }),
    }),
    prerequisiteIds: new FormControl<string[]>([], { nonNullable: true }),
    nextObjectiveId: new FormControl('', { nonNullable: true }),
    enabled: new FormControl(true, { nonNullable: true }),
  });
  protected readonly g = this.form.controls.geofence.controls;
  protected readonly r = this.form.controls.rewards.controls;

  protected readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly geofenceUsed = computed(() => !!(this.value().methods?.geofence || this.value().requireGeofence));
  protected readonly showQrSection = computed(() => !this.isNew() && !!(this.value().methods?.qr || this.objective()?.methods.includes('qr')));
  protected readonly qrSvg = computed<SafeHtml | null>(() => {
    const q = this.qr();
    // Server-generated SVG for this objective only; nothing user-provided is inserted.
    return q ? this.sanitizer.bypassSecurityTrustHtml(q.svg) : null;
  });

  protected readonly otherObjectives = computed(() => this.allObjectives().filter((o) => o.id !== this.objective()?.id));

  protected readonly chainWarning = computed(() => {
    const v = this.value();
    if (v.nextObjectiveId && v.prerequisiteIds?.includes(v.nextObjectiveId)) return 'The next objective is also a prerequisite: the chain can never progress.';
    return null;
  });

  /**
   * Phone GPS is typically 2–5 m off in the open and 5–20 m under trees (field studies), and the
   * reported accuracy is only a ~68% radius; zones much smaller than that can't be held reliably.
   */
  protected readonly geofenceWarnings = computed(() => {
    const g = this.value().geofence;
    const radius = Number(g?.radiusM);
    const acc = Number(g?.maxAccuracyM);
    const out: string[] = [];
    if (radius > 0 && radius < 10) {
      out.push('Too small for GPS: phones are often 5 m off even in the open, so players inside will drop in and out. Use 20 m or more, or capture by code or QR.');
    } else if (radius >= 10 && radius < 20) {
      out.push('Reliable only in open ground. Under trees phones are often 10 m or more off and players inside may drop out; use 20–30 m there.');
    }
    if (acc > 0 && radius > 0 && acc > radius) {
      out.push(`Max GPS accuracy (±${acc} m) is larger than the zone: a fix that rough can't tell inside from outside. Keep it at or below the radius.`);
    } else if (acc > 0 && acc < 10) {
      out.push('Under trees phones often report ±10 m or worse, so players there may never be counted.');
    }
    return out;
  });

  protected readonly mapObjectives = computed<Objective[]>(() => {
    const v = this.value();
    const me = this.objective();
    const others = this.otherObjectives().map((o) => ({ ...o, color: '#8A8F86', ownerTeamId: null }));
    if (typeof v.lat !== 'number' || typeof v.lng !== 'number') return others;
    const methods = methodsOf(v.methods);
    const current: Objective = {
      ...(me ?? blankObjective()),
      id: me?.id ?? 'draft',
      name: v.name || 'New objective',
      lat: v.lat,
      lng: v.lng,
      color: v.color ?? '#E6B04F',
      methods,
      requireGeofence: !!v.requireGeofence,
      geofence: { ...DEFAULT_GEOFENCE, ...(me?.geofence ?? {}), radiusM: num(v.geofence?.radiusM ?? null, DEFAULT_GEOFENCE.radiusM) },
      ownerTeamId: null,
    };
    return [...others, current];
  });

  protected readonly backUrl = computed(() => safeReturn(this.returnTo()) ?? `/gm/events/${this.eventId()}/map`);

  protected readonly saveStateLabel = computed(() => {
    switch (this.saveState()) {
      case 'dirty':
        return 'Unsaved changes';
      case 'saving':
        return 'Saving…';
      case 'saved':
        return 'All changes saved';
      case 'failed':
        return 'Not saved: check the highlighted fields';
      default:
        return this.isNew() ? 'New objective, not saved yet' : 'No changes';
    }
  });
  protected readonly saveStateGlyph = computed(() => ({ clean: '○', dirty: '◐', saving: '◌', saved: '●', failed: '▲' })[this.saveState()]);
  protected readonly saveStateTone = computed(() =>
    this.saveState() === 'failed' ? 'text-destructive' : this.saveState() === 'dirty' ? 'text-warning' : this.saveState() === 'saved' ? 'text-primary' : 'text-muted-foreground',
  );

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.patching) return;
      if (this.saveState() !== 'saving') this.saveState.set('dirty');
      if (this.methodsError() && methodsOf(this.form.controls.methods.getRawValue()).length) this.methodsError.set(null);
    });
    // (Re)load when the route params change (e.g. after "Save" on a new objective).
    effect(() => {
      this.eventId();
      this.objectiveId();
      untracked(() => void this.load());
    });
    // Load the QR when the saved objective has QR enabled.
    effect(() => {
      const o = this.objective();
      untracked(() => {
        this.qr.set(null);
        this.qrError.set(null);
        if (o && o.methods.includes('qr')) void this.loadQr();
      });
    });
  }

  // ------------------------------------------------------------------ load

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    const eventId = this.eventId();
    try {
      const [event, objectives, zones] = await Promise.all([this.api.event(eventId), this.api.objectives(eventId), this.api.zones(eventId).catch(() => [])]);
      this.event.set(event);
      this.allObjectives.set(objectives);
      this.zones.set(zones);
      let o: Objective | null = null;
      if (!this.isNew()) {
        const res = await this.api.objective(eventId, this.objectiveId());
        o = res.objective;
      }
      this.objective.set(o);
      this.fillForm(o, event);
    } catch (e) {
      this.loadError.set(e);
    } finally {
      this.loading.set(false);
    }
  }

  private fillForm(o: Objective | null, event: EventDetail): void {
    this.patching = true;
    const perTeam = this.form.controls.rewards.controls.perTeam;
    Object.keys(perTeam.controls).forEach((k) => perTeam.removeControl(k, { emitEvent: false }));
    for (const t of event.teams) {
      const ov = o?.rewards.perTeam?.[t.id];
      perTeam.addControl(t.id, teamOverrideGroup(ov?.points ?? o?.rewards.points ?? DEFAULT_REWARDS.points, ov?.currency ?? o?.rewards.currency ?? DEFAULT_REWARDS.currency, !!ov), {
        emitEvent: false,
      });
    }

    const qLat = Number(this.lat());
    const qLng = Number(this.lng());
    const prefill = this.lat() !== undefined && isFinite(qLat) && isFinite(qLng) ? { lat: qLat, lng: qLng } : null;
    const pos = o ? { lat: o.lat, lng: o.lng } : (prefill ?? (event.area ? { lat: event.area.lat, lng: event.area.lng } : null));
    const src = o ?? blankObjective();
    const gf = { ...DEFAULT_GEOFENCE, ...src.geofence };
    const rw = { ...DEFAULT_REWARDS, ...src.rewards };
    this.form.reset({
      name: o ? o.name : `Objective ${this.allObjectives().length + 1}`,
      type: src.type,
      description: src.description,
      instructions: src.instructions,
      color: src.color,
      icon: src.icon || 'flag',
      imageUrl: src.imageUrl,
      documentUrl: src.documentUrl,
      lat: pos ? round6(pos.lat) : null,
      lng: pos ? round6(pos.lng) : null,
      methods: { code: src.methods.includes('code'), qr: src.methods.includes('qr'), geofence: src.methods.includes('geofence') },
      requireGeofence: src.requireGeofence,
      captureCode: o?.captureCode ?? (o ? '' : generateCaptureCode()),
      geofence: gf,
      rewards: {
        points: rw.points,
        currency: rw.currency,
        recurringPointsPerMinute: rw.recurringPointsPerMinute,
        recurringCurrencyPerMinute: rw.recurringCurrencyPerMinute,
        captureBonus: rw.captureBonus,
        defenseBonus: rw.defenseBonus,
        completionBonus: rw.completionBonus,
      },
      availabilityStart: toLocalInput(src.availabilityStart),
      availabilityEnd: toLocalInput(src.availabilityEnd),
      cooldownSec: src.cooldownSec,
      maxCaptures: src.maxCaptures,
      allowedTeamIds: src.allowedTeamIds ?? [],
      visibility: { mode: src.visibility?.mode ?? 'all', teamIds: src.visibility?.teamIds ?? [] },
      prerequisiteIds: src.prerequisiteIds ?? [],
      nextObjectiveId: src.nextObjectiveId ?? '',
      enabled: src.enabled,
    });
    this.mapCenter.set(pos);
    this.patching = false;
    this.methodsError.set(null);
    this.saveState.set('clean');
  }

  // ------------------------------------------------------------------ helpers

  protected e(path: string, label: string): string | null {
    return controlError(this.form.get(path), label);
  }

  protected toggle(ctrl: FormControl<string[]>, id: string, ev: Event): void {
    toggleIn(ctrl, id, targetChecked(ev));
  }

  protected jump(ev: Event, id: string): void {
    ev.preventDefault();
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.querySelector<HTMLElement>('input, select, textarea, button')?.focus({ preventScroll: true });
  }

  protected setPosition(p: LatLng): void {
    this.form.patchValue({ lat: round6(p.lat), lng: round6(p.lng) });
    this.form.controls.lat.markAsDirty();
  }

  protected useMyPosition(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.toast.warning('Location is not available on this device');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        this.setPosition(p);
        this.mapCenter.set(p);
        this.toast.info('Position set from your GPS', `${formatLatLng(p)} · ±${Math.round(pos.coords.accuracy)} m`);
      },
      (err) => this.toast.warning('Could not get your location', err.message),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  protected generateCode(): void {
    this.form.controls.captureCode.setValue(generateCaptureCode());
    this.form.controls.captureCode.markAsDirty();
  }

  protected upperCode(): void {
    const c = this.form.controls.captureCode;
    const up = c.value.toUpperCase();
    if (up !== c.value) c.setValue(up, { emitEvent: true });
  }

  protected async upload(ev: Event, field: 'imageUrl' | 'documentUrl'): Promise<void> {
    const inputEl = ev.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (!file) return;
    this.uploading.set(field);
    try {
      const res = await this.api.upload(file, field === 'imageUrl' ? 'objective_image' : 'objective_document');
      this.form.controls[field].setValue(res.url);
      this.form.controls[field].markAsDirty();
      this.toast.success(field === 'imageUrl' ? 'Image uploaded' : 'Document uploaded', 'Save the objective to keep it.');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.uploading.set(null);
      inputEl.value = '';
    }
  }

  protected clearUpload(field: 'imageUrl' | 'documentUrl'): void {
    this.form.controls[field].setValue(null);
    this.form.controls[field].markAsDirty();
  }

  protected onBeforeUnload(ev: BeforeUnloadEvent): void {
    if (this.saveState() === 'dirty' || this.saveState() === 'failed') ev.preventDefault();
  }

  // ------------------------------------------------------------------ save

  private buildBody(): ObjectiveInput | null {
    this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    const methods = methodsOf(v.methods);
    let ok = true;
    if (!methods.length) {
      this.methodsError.set('Choose at least one capture method.');
      ok = false;
    }
    if (methods.includes('code') && !v.captureCode.trim() && !this.isNew() && this.objective()?.captureCode) {
      this.form.controls.captureCode.setErrors({ message: 'Enter a code or press Generate.' });
      ok = false;
    }
    const start = fromLocalInput(v.availabilityStart);
    const end = fromLocalInput(v.availabilityEnd);
    if (start && end && new Date(end) <= new Date(start)) {
      this.form.controls.availabilityEnd.setErrors({ message: 'The end must be after the start.' });
      ok = false;
    }
    if (this.form.invalid || !ok) {
      this.saveState.set('failed');
      this.scrollToFirstError();
      return null;
    }
    const perTeam: Record<string, { points: number; currency: number }> = {};
    for (const [teamId, grp] of Object.entries(this.form.controls.rewards.controls.perTeam.controls)) {
      const t = grp.getRawValue();
      if (t.override) perTeam[teamId] = { points: num(t.points), currency: num(t.currency) };
    }
    const geofenceOn = methods.includes('geofence') || v.requireGeofence;
    const body: ObjectiveInput = {
      name: v.name.trim(),
      type: v.type,
      description: v.description,
      instructions: v.instructions,
      color: v.color,
      icon: v.icon,
      imageUrl: v.imageUrl,
      documentUrl: v.documentUrl,
      lat: num(v.lat),
      lng: num(v.lng),
      methods,
      requireGeofence: v.requireGeofence && methods.some((m) => m === 'code' || m === 'qr'),
      geofence: {
        radiusM: num(v.geofence.radiusM, DEFAULT_GEOFENCE.radiusM),
        durationSec: num(v.geofence.durationSec, DEFAULT_GEOFENCE.durationSec),
        resetOnExit: v.geofence.resetOnExit,
        multiPlayerBoost: v.geofence.multiPlayerBoost,
        boostPerExtraPlayer: num(v.geofence.boostPerExtraPlayer, DEFAULT_GEOFENCE.boostPerExtraPlayer),
        maxMultiplier: num(v.geofence.maxMultiplier, DEFAULT_GEOFENCE.maxMultiplier),
        contestable: v.geofence.contestable,
        contestRule: v.geofence.contestRule,
        requireScreenOpen: v.geofence.requireScreenOpen,
        maxAccuracyM: num(v.geofence.maxAccuracyM, DEFAULT_GEOFENCE.maxAccuracyM),
      },
      rewards: {
        points: num(v.rewards.points),
        currency: num(v.rewards.currency),
        perTeam,
        recurringPointsPerMinute: num(v.rewards.recurringPointsPerMinute),
        recurringCurrencyPerMinute: num(v.rewards.recurringCurrencyPerMinute),
        captureBonus: num(v.rewards.captureBonus),
        defenseBonus: num(v.rewards.defenseBonus),
        completionBonus: num(v.rewards.completionBonus),
      },
      availabilityStart: start,
      availabilityEnd: end,
      cooldownSec: Math.max(0, Math.round(num(v.cooldownSec))),
      maxCaptures: Math.max(0, Math.round(num(v.maxCaptures))),
      allowedTeamIds: v.allowedTeamIds,
      visibility: { mode: v.visibility.mode, teamIds: v.visibility.mode === 'teams' ? v.visibility.teamIds : [] },
      prerequisiteIds: v.prerequisiteIds,
      nextObjectiveId: v.nextObjectiveId || null,
      enabled: v.enabled,
    };
    if (!geofenceOn) delete body.geofence;
    // The code is only sent when the code method is on (and when it changed, for existing objectives).
    const code = v.captureCode.trim().toUpperCase();
    if (methods.includes('code') && code && (this.isNew() || code !== (this.objective()?.captureCode ?? ''))) body.captureCode = code;
    return body;
  }

  private scrollToFirstError(): void {
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>('zeus-objective-editor-screen .field-error, zeus-objective-editor-screen [role="alert"]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  async save(close: boolean): Promise<void> {
    const body = this.buildBody();
    if (!body) return;
    const eventId = this.eventId();
    this.saveState.set('saving');
    try {
      const saved = this.isNew() ? await this.api.createObjective(eventId, body) : await this.api.updateObjective(eventId, this.objectiveId(), body);
      this.objective.set(saved);
      this.allObjectives.update((l) => (l.some((o) => o.id === saved.id) ? l.map((o) => (o.id === saved.id ? saved : o)) : [...l, saved]));
      this.form.markAsPristine();
      this.saveState.set('saved');
      this.toast.success(this.isNew() ? `${saved.name} created` : `${saved.name} saved`);
      if (close) {
        await this.router.navigateByUrl(this.backUrl());
      } else if (this.isNew()) {
        await this.router.navigate(['/gm/events', eventId, 'objectives', saved.id], {
          queryParams: { returnTo: this.returnTo() ?? null },
          replaceUrl: true,
        });
      } else {
        this.fillForm(saved, this.event()!);
        this.saveState.set('saved');
      }
    } catch (e) {
      const err = ApiError.from(e);
      this.saveState.set('failed');
      const rest = applyServerErrors(this.form, err, { code: 'captureCode', 'geofence.radius': 'geofence.radiusM' });
      if (err.code === 'code_taken' && !err.fields['captureCode']) {
        this.form.controls.captureCode.setErrors({ server: 'Another objective in this event already uses this code. Generate a new one.' });
        this.form.controls.captureCode.markAsTouched();
      }
      if (err.fields['methods']) this.methodsError.set(err.fields['methods']);
      this.toast.error(err, rest.join(' ') || undefined);
      this.scrollToFirstError();
    }
  }

  protected async duplicate(): Promise<void> {
    const o = this.objective();
    if (!o) return;
    if (this.saveState() === 'dirty') {
      const ok = await this.confirm.ask({
        title: 'Duplicate without your changes?',
        consequences: ['The copy is made from the last saved version; unsaved changes here are not copied.'],
        confirmLabel: 'Duplicate',
      });
      if (!ok) return;
    }
    try {
      const copy = await this.api.duplicateObjective(this.eventId(), o.id);
      this.toast.success(`${copy.name} created`, 'The copy has its own capture code and QR.');
      await this.router.navigate(['/gm/events', this.eventId(), 'objectives', copy.id], { queryParams: { returnTo: this.returnTo() ?? null } });
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected async remove(): Promise<void> {
    const o = this.objective();
    if (!o) return;
    const dependants = this.allObjectives().filter((x) => x.id !== o.id && (x.prerequisiteIds.includes(o.id) || x.nextObjectiveId === o.id));
    const consequences = ['Players no longer see it; its capture code and QR stop working.'];
    if (dependants.length) consequences.push(`It is removed from the chain of ${dependants.map((d) => d.name).join(', ')}.`);
    if (o.captureCount) consequences.push(`Its ${o.captureCount} capture(s) stay in the ledger and results.`);
    consequences.push('This cannot be undone.');
    const ok = await this.confirm.ask({ title: `Delete ${o.name}?`, consequences, confirmLabel: 'Delete objective', destructive: true });
    if (!ok) return;
    try {
      await this.api.deleteObjective(this.eventId(), o.id);
      this.saveState.set('clean');
      this.toast.success(`${o.name} deleted`);
      await this.router.navigateByUrl(this.backUrl());
    } catch (e) {
      this.toast.error(e);
    }
  }

  // ------------------------------------------------------------------ QR

  async loadQr(): Promise<void> {
    const o = this.objective();
    if (!o) return;
    this.qrError.set(null);
    try {
      this.qr.set(await this.api.objectiveQr(this.eventId(), o.id));
    } catch (e) {
      this.qrError.set(e);
    }
  }

  protected downloadPng(): void {
    const q = this.qr();
    const o = this.objective();
    if (!q || !o) return;
    const a = document.createElement('a');
    a.href = q.pngDataUrl;
    a.download = `${slug(o.name)}-qr-v${q.qrVersion}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  protected printQr(): void {
    const q = this.qr();
    const o = this.objective();
    if (!q || !o) return;
    const w = window.open('', '_blank', 'width=820,height=1000');
    if (!w) {
      this.toast.warning('The print window was blocked', 'Allow pop-ups for this site, or download the PNG and print it.');
      return;
    }
    const name = escapeHtml(o.name);
    const eventName = escapeHtml(this.event()?.name ?? '');
    const instructions = o.instructions ? `<p class="instr">${escapeHtml(o.instructions)}</p>` : '';
    w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name} · QR code</title>
<style>
  @page { margin: 12mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #000; background: #fff; text-align: center; margin: 0; padding: 16px; }
  h1 { font-size: 30pt; margin: 8px 0 2px; text-transform: uppercase; letter-spacing: .02em; }
  .event { font-size: 13pt; color: #333; margin: 0 0 12px; }
  img { width: 13cm; max-width: 92vw; height: auto; image-rendering: pixelated; }
  .how { font-size: 14pt; font-weight: 700; margin: 12px 0 4px; }
  p { font-size: 12pt; margin: 4px auto; max-width: 16cm; }
  .instr { font-style: italic; }
  .meta { font-size: 9pt; color: #555; margin-top: 14px; }
</style></head><body>
<h1>${name}</h1><p class="event">${eventName}</p>
<img src="${q.pngDataUrl}" alt="QR code">
<p class="how">Capture: open Airsoft Zeus → ${name} → Scan QR code</p>
<p>Scan this code with the Airsoft Zeus app to capture the objective for your team.</p>
${instructions}
<p class="meta">QR version ${q.qrVersion}. Regenerating the code in the app makes this sheet stop working.</p>
</body></html>`);
    w.document.close();
    const img = w.document.images[0];
    const go = () => {
      w.focus();
      w.print();
    };
    if (!img || img.complete) setTimeout(go, 50);
    else img.addEventListener('load', go, { once: true });
  }

  protected async regenerateQr(): Promise<void> {
    const o = this.objective();
    if (!o) return;
    const ok = await this.confirm.ask({
      title: 'Regenerate the QR code?',
      consequences: ['Printed copies of the old QR stop working immediately.', 'You need to print and place the new QR at the objective.', 'The manual code is not changed.'],
      confirmLabel: 'Regenerate QR',
      destructive: true,
    });
    if (!ok) return;
    this.qrBusy.set(true);
    try {
      this.qr.set(await this.api.regenerateObjectiveQr(this.eventId(), o.id));
      this.toast.success('New QR code generated', 'Print it and replace the old one.');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.qrBusy.set(false);
    }
  }
}

function methodsOf(m: { code?: boolean; qr?: boolean; geofence?: boolean } | undefined): CaptureMethod[] {
  const out: CaptureMethod[] = [];
  if (m?.code) out.push('code');
  if (m?.qr) out.push('qr');
  if (m?.geofence) out.push('geofence');
  return out;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'objective';
}

function blankObjective(): Objective {
  return {
    id: 'draft',
    name: '',
    description: '',
    instructions: '',
    sortOrder: 0,
    lat: 0,
    lng: 0,
    icon: 'flag',
    color: '#E6B04F',
    type: 'domination',
    imageUrl: null,
    documentUrl: null,
    methods: ['code'],
    requireGeofence: false,
    geofence: { ...DEFAULT_GEOFENCE },
    rewards: { ...DEFAULT_REWARDS, perTeam: {} },
    availabilityStart: null,
    availabilityEnd: null,
    cooldownSec: 0,
    maxCaptures: 0,
    allowedTeamIds: [],
    visibility: { mode: 'all', teamIds: [] },
    prerequisiteIds: [],
    nextObjectiveId: null,
    enabled: true,
    status: 'inactive',
    ownerTeamId: null,
    captureCount: 0,
    lastCapturedAt: null,
    lastCapturedByNickname: null,
    cooldownUntil: null,
    contested: false,
    jammedUntil: null,
    jammedFor: {},
    shieldedUntil: null,
    shieldedTeamId: null,
    canCapture: false,
    blockedReason: null,
  };
}
