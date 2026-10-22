import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { ApiService } from '../../core/api/api.service';
import { ApiError } from '../../core/api/api-error';
import { ContentVisibility, EventDetail, LatLng, Objective, PlayerRole, Poi, PoiInput, PoiType, Zone } from '../../core/api/models';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { EVENT_STATUS_LABELS, PLAYER_ROLE_LABELS, POI_TYPE_LABELS, fromLocalInput, toLocalInput } from '../../core/util/format';
import { formatLatLng } from '../../core/util/geo';
import { TacticalMap } from '../../shared/map/tactical-map';
import { ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { TeamSwatch } from '../../shared/team-swatch';
import { ColorField } from './ops/color-field';
import { applyServerErrors, controlError, num, safeReturn, targetChecked, toggleIn } from './ops/forms';
import { MAP_ICONS, POI_TYPE_COLORS } from './ops/map-defaults';

const SELECT_CLASS = 'h-11 w-full rounded-md border border-input bg-transparent px-2 dark:bg-input/30';
const STATUS_PHASES = ['lobby', 'live', 'paused', 'completed'] as const;

/** POI editor (GM). Route: /gm/events/:eventId/pois/:poiId ('new' allowed, ?lat=&lng= prefill). */
@Component({
  selector: 'zeus-poi-editor-screen',
  imports: [ReactiveFormsModule, NgIcon, HlmButton, HlmInput, HlmLabel, HlmTextarea, TacticalMap, LoadingSkeleton, ErrorState, PageHeader, TeamSwatch, ColorField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  template: `
    <div class="page-narrow">
      <zeus-page-header [title]="isNew() ? txt.newPointOfInterest : (poi()?.name ?? txt.pointOfInterest)" [eyebrow]="event()?.name ?? txt.poiEditor" [back]="backUrl()" />

      @if (loading()) {
        <zeus-loading-skeleton [rows]="5" />
      } @else if (loadError()) {
        <zeus-error-state [error]="loadError()" (retry)="load()" />
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-6" novalidate>
          <section class="panel flex flex-col gap-4 p-4" aria-labelledby="h-poi-basics">
            <h2 id="h-poi-basics" class="label-caps" i18n>Basics</h2>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="p-name"><ng-container i18n>Name</ng-container> <span aria-hidden="true">*</span></label>
              <input hlmInput id="p-name" formControlName="name" class="h-11" maxlength="120" autocomplete="off" />
              @if (e('name', 'Name'); as m) {
                <p class="field-error">{{ m }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="p-type" i18n>Type</label>
              <select id="p-type" formControlName="type" [class]="selectClass">
                @for (t of types; track t) {
                  <option [value]="t">{{ typeLabels[t] }}</option>
                }
              </select>
            </div>
            @if (value().type === 'team_base') {
              <div class="flex flex-col gap-1.5">
                <label hlmLabel for="p-team" i18n>Owning team</label>
                <select id="p-team" formControlName="teamId" [class]="selectClass">
                  <option value="" i18n>No team</option>
                  @for (t of event()?.teams ?? []; track t.id) {
                    <option [value]="t.id">{{ t.name }}</option>
                  }
                </select>
                <p class="text-sm text-muted-foreground" i18n>Enemy team bases follow the event's "show enemy bases" rule.</p>
              </div>
            }
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="p-desc" i18n>Description</label>
              <textarea hlmTextarea id="p-desc" formControlName="description" rows="3" maxlength="5000"></textarea>
            </div>
            <div class="flex flex-col gap-1.5">
              <span hlmLabel i18n>Colour</span>
              <zeus-color-field formControlName="color" label="POI colour" i18n-label />
            </div>
            <fieldset>
              <legend class="mb-1.5 text-sm font-medium" i18n>Icon</legend>
              <div class="flex flex-wrap gap-1.5">
                @for (i of icons; track i.value) {
                  <label class="grid size-11 cursor-pointer place-items-center rounded-md border border-border has-checked:border-primary has-checked:bg-primary/15" [title]="i.label">
                    <input type="radio" formControlName="icon" [value]="i.value" class="sr-only" [attr.aria-label]="i.label" />
                    <ng-icon [name]="i.icon" size="18" aria-hidden="true" />
                  </label>
                }
              </div>
            </fieldset>
            <div class="flex flex-col gap-1.5">
              <span hlmLabel id="lbl-poi-img" i18n>Image</span>
              @if (value().imageUrl) {
                <img [src]="value().imageUrl" alt="Point of interest image" class="aspect-video w-full rounded-md border border-border object-cover" i18n-alt />
                <button hlmBtn type="button" variant="outline" class="h-10" (click)="clearImage()" i18n>Remove image</button>
              } @else {
                <label class="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input text-sm hover:bg-muted">
                  <ng-icon name="lucideImage" size="16" aria-hidden="true" />
                  {{ uploading() ? txt.uploading : txt.uploadImage }}
                  <input type="file" accept="image/*" class="sr-only" aria-labelledby="lbl-poi-img" (change)="upload($event)" [disabled]="uploading()" />
                </label>
              }
            </div>
          </section>

          <section class="panel flex flex-col gap-4 p-4" aria-labelledby="h-poi-pos">
            <h2 id="h-poi-pos" class="label-caps" i18n>Position</h2>
            <div class="grid grid-cols-2 gap-3">
              <div class="flex flex-col gap-1.5">
                <label hlmLabel for="p-lat" i18n>Latitude</label>
                <input hlmInput id="p-lat" type="number" step="0.00001" formControlName="lat" class="num h-11" />
                @if (e('lat', 'Latitude'); as m) {
                  <p class="field-error">{{ m }}</p>
                }
              </div>
              <div class="flex flex-col gap-1.5">
                <label hlmLabel for="p-lng" i18n>Longitude</label>
                <input hlmInput id="p-lng" type="number" step="0.00001" formControlName="lng" class="num h-11" />
                @if (e('lng', 'Longitude'); as m) {
                  <p class="field-error">{{ m }}</p>
                }
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span i18n>Tap the map to place it.</span>
              <button hlmBtn type="button" variant="outline" class="h-10" (click)="useMyPosition()">
                <ng-icon name="lucideLocateFixed" size="16" aria-hidden="true" /> <ng-container i18n>Use my position</ng-container>
              </button>
            </div>
            <zeus-tactical-map
              class="h-64 rounded-md border border-border"
              [objectives]="objectives()"
              [pois]="mapPois()"
              [zones]="zones()"
              [teams]="event()?.teams ?? []"
              [selectedId]="poi()?.id ?? 'draft'"
              [center]="mapCenter()"
              [zoom]="17"
              [showGeofences]="false"
              [shapesClickable]="false"
              (mapClick)="setPosition($event)"
            />
          </section>

          <section class="panel flex flex-col gap-4 p-4" aria-labelledby="h-poi-vis">
            <h2 id="h-poi-vis" class="label-caps" i18n>Visibility</h2>
            <fieldset class="flex flex-col">
              <legend class="mb-1.5 text-sm font-medium" i18n>Who sees it</legend>
              @for (m of modes; track m.value) {
                <label class="flex min-h-11 cursor-pointer items-center gap-3">
                  <input type="radio" formControlName="visMode" [value]="m.value" class="size-4 accent-primary" /> {{ m.label }}
                </label>
              }
            </fieldset>
            @if (value().visMode === 'teams') {
              <fieldset>
                <legend class="mb-1 text-sm font-medium" i18n>Teams</legend>
                <div class="flex flex-wrap gap-x-4">
                  @for (t of event()?.teams ?? []; track t.id) {
                    <label class="flex min-h-11 cursor-pointer items-center gap-2">
                      <input type="checkbox" class="size-5 accent-primary" [checked]="value().teamIds?.includes(t.id)" (change)="toggle(form.controls.teamIds, t.id, $event)" />
                      <zeus-team-swatch [color]="t.color" [pattern]="t.pattern" />{{ t.name }}
                    </label>
                  }
                </div>
              </fieldset>
              @if (event()?.squads?.length) {
                <fieldset>
                  <legend class="mb-1 text-sm font-medium" i18n>Squads <span class="font-normal text-muted-foreground">(optional, narrows it further)</span></legend>
                  <div class="flex flex-wrap gap-x-4">
                    @for (s of event()!.squads; track s.id) {
                      <label class="flex min-h-11 cursor-pointer items-center gap-2">
                        <input type="checkbox" class="size-5 accent-primary" [checked]="value().squadIds?.includes(s.id)" (change)="toggle(form.controls.squadIds, s.id, $event)" />
                        {{ s.callsign || s.name }} <span class="text-xs text-muted-foreground">{{ teamName(s.teamId) }}</span>
                      </label>
                    }
                  </div>
                </fieldset>
              }
            }
            @if (value().visMode !== 'gm_only') {
              <fieldset>
                <legend class="mb-1 text-sm font-medium" i18n>Roles <span class="font-normal text-muted-foreground">(none = every role)</span></legend>
                <div class="flex flex-wrap gap-x-4">
                  @for (r of roles; track r) {
                    <label class="flex min-h-11 cursor-pointer items-center gap-2">
                      <input type="checkbox" class="size-5 accent-primary" [checked]="value().roles?.includes(r)" (change)="toggle(form.controls.roles, r, $event)" />
                      {{ roleLabels[r] }}
                    </label>
                  }
                </div>
              </fieldset>
              <fieldset>
                <legend class="mb-1 text-sm font-medium" i18n>Phases <span class="font-normal text-muted-foreground">(none = always)</span></legend>
                <div class="flex flex-wrap gap-x-4">
                  @for (p of statusPhases; track p) {
                    <label class="flex min-h-11 cursor-pointer items-center gap-2">
                      <input type="checkbox" class="size-5 accent-primary" [checked]="value().phases?.includes(p)" (change)="toggle(form.controls.phases, p, $event)" />
                      {{ statusLabels[p] }}
                    </label>
                  }
                </div>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  @for (p of customPhases(); track p) {
                    <span class="inline-flex h-9 items-center gap-1 rounded-sm border border-border bg-muted pl-2 text-sm">
                      {{ p }}
                      <button type="button" class="grid size-9 place-items-center rounded-sm hover:bg-background" (click)="removePhase(p)" ariaLabel="Remove phase {{ p }}" i18n-ariaLabel>
                        <ng-icon name="lucideX" size="14" aria-hidden="true" />
                      </button>
                    </span>
                  }
                </div>
                <div class="mt-2 flex gap-2">
                  <label for="p-phase" class="sr-only" i18n>Custom phase label</label>
                  <input hlmInput id="p-phase" class="h-11" placeholder="Custom phase, e.g. Night ops" maxlength="40" [value]="phaseDraft()" (input)="phaseDraft.set($any($event.target).value)" (keydown.enter)="$event.preventDefault(); addPhase()" i18n-placeholder />
                  <button hlmBtn type="button" variant="outline" class="h-11" (click)="addPhase()" i18n>Add</button>
                </div>
                <p class="mt-1 text-sm text-muted-foreground" i18n>Custom phases match the phase label the GM sets on the event.</p>
              </fieldset>
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div class="flex flex-col gap-1.5">
                  <label hlmLabel for="p-from" i18n>Visible from</label>
                  <input hlmInput id="p-from" type="datetime-local" formControlName="activeFrom" class="h-11" />
                </div>
                <div class="flex flex-col gap-1.5">
                  <label hlmLabel for="p-until" i18n>Visible until</label>
                  <input hlmInput id="p-until" type="datetime-local" formControlName="activeUntil" class="h-11" />
                  @if (e('activeUntil', 'End'); as m) {
                    <p class="field-error">{{ m }}</p>
                  }
                </div>
              </div>
            }
          </section>

          <div class="hud sticky bottom-[calc(4.5rem+var(--safe-bottom))] z-10 flex flex-wrap items-center gap-2 p-2 lg:bottom-3">
            <p class="min-w-0 flex-1 px-1 text-sm" role="status" aria-live="polite">{{ statusText() }}</p>
            @if (!isNew()) {
              <button hlmBtn type="button" variant="destructive" class="h-11" (click)="remove()" [disabled]="saving()">
                <ng-icon name="lucideTrash2" size="16" aria-hidden="true" /> <ng-container i18n>Delete</ng-container>
              </button>
            }
            <button hlmBtn type="submit" class="h-11" [disabled]="saving()">{{ saving() ? txt.saving : isNew() ? txt.create : txt.save }}</button>
          </div>
        </form>
      }
    </div>
  `,
})
export class PoiEditorScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    uploading: $localize`Uploading…`,
    uploadImage: $localize`Upload image`,
    saving: $localize`Saving…`,
    create: $localize`Create`,
    save: $localize`Save`,
    newPointOfInterest: $localize`New point of interest`,
    pointOfInterest: $localize`Point of interest`,
    poiEditor: $localize`POI editor`,
  };

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly eventId = input.required<string>();
  readonly poiId = input.required<string>();
  readonly lat = input<string>();
  readonly lng = input<string>();
  readonly returnTo = input<string>();

  protected readonly selectClass = SELECT_CLASS;
  protected readonly types = Object.keys(POI_TYPE_LABELS) as PoiType[];
  protected readonly typeLabels = POI_TYPE_LABELS;
  protected readonly icons = MAP_ICONS;
  protected readonly roles = Object.keys(PLAYER_ROLE_LABELS) as PlayerRole[];
  protected readonly roleLabels = PLAYER_ROLE_LABELS;
  protected readonly statusPhases = STATUS_PHASES;
  protected readonly statusLabels = EVENT_STATUS_LABELS;
  protected readonly modes: { value: ContentVisibility['mode']; label: string }[] = [
    { value: 'all', label: $localize`Everyone` },
    { value: 'teams', label: $localize`Selected teams (and squads)` },
    { value: 'gm_only', label: $localize`Game Masters only` },
  ];

  protected readonly loading = signal(true);
  protected readonly loadError = signal<unknown>(null);
  protected readonly saving = signal(false);
  protected readonly uploading = signal(false);
  protected readonly dirty = signal(false);
  protected readonly event = signal<EventDetail | null>(null);
  protected readonly poi = signal<Poi | null>(null);
  protected readonly allPois = signal<Poi[]>([]);
  protected readonly objectives = signal<Objective[]>([]);
  protected readonly zones = signal<Zone[]>([]);
  protected readonly mapCenter = signal<LatLng | null>(null);
  protected readonly phaseDraft = signal('');
  private patching = false;

  protected readonly isNew = computed(() => this.poiId() === 'new');
  protected readonly backUrl = computed(() => safeReturn(this.returnTo()) ?? `/gm/events/${this.eventId()}/map`);

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    type: new FormControl<PoiType>('custom', { nonNullable: true }),
    description: new FormControl('', { nonNullable: true }),
    lat: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(-90), Validators.max(90)] }),
    lng: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(-180), Validators.max(180)] }),
    icon: new FormControl('flag', { nonNullable: true }),
    color: new FormControl(POI_TYPE_COLORS.custom, { nonNullable: true }),
    imageUrl: new FormControl<string | null>(null),
    teamId: new FormControl('', { nonNullable: true }),
    visMode: new FormControl<ContentVisibility['mode']>('all', { nonNullable: true }),
    teamIds: new FormControl<string[]>([], { nonNullable: true }),
    squadIds: new FormControl<string[]>([], { nonNullable: true }),
    roles: new FormControl<string[]>([], { nonNullable: true }),
    phases: new FormControl<string[]>([], { nonNullable: true }),
    activeFrom: new FormControl('', { nonNullable: true }),
    activeUntil: new FormControl('', { nonNullable: true }),
  });
  protected readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly customPhases = computed(() => (this.value().phases ?? []).filter((p) => !(STATUS_PHASES as readonly string[]).includes(p)));

  protected readonly mapPois = computed<Poi[]>(() => {
    const v = this.value();
    const me = this.poi();
    const others = this.allPois().filter((p) => p.id !== me?.id);
    if (typeof v.lat !== 'number' || typeof v.lng !== 'number') return others;
    const current: Poi = {
      id: me?.id ?? 'draft',
      name: v.name || $localize`New point`,
      type: v.type ?? 'custom',
      description: '',
      lat: v.lat,
      lng: v.lng,
      icon: v.icon ?? '',
      color: v.color ?? POI_TYPE_COLORS.custom,
      imageUrl: null,
      teamId: null,
      visibility: { mode: 'all' },
    };
    return [...others, current];
  });

  protected readonly statusText = computed(() =>
    this.saving() ? $localize`Saving…` : this.dirty() ? $localize`Unsaved changes` : this.isNew() ? $localize`New point, not saved yet` : $localize`No changes`,
  );

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (!this.patching) this.dirty.set(true);
    });
    this.form.controls.type.valueChanges.pipe(takeUntilDestroyed()).subscribe((t) => {
      if (!this.patching && !this.form.controls.color.dirty) this.form.controls.color.setValue(POI_TYPE_COLORS[t]);
    });
    effect(() => {
      this.eventId();
      this.poiId();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    const id = this.eventId();
    try {
      const [event, pois, objectives, zones] = await Promise.all([
        this.api.event(id),
        this.api.pois(id),
        this.api.objectives(id).catch(() => []),
        this.api.zones(id).catch(() => []),
      ]);
      this.event.set(event);
      this.allPois.set(pois);
      this.objectives.set(objectives);
      this.zones.set(zones);
      let p: Poi | null = null;
      if (!this.isNew()) {
        p = pois.find((x) => x.id === this.poiId()) ?? null;
        if (!p) throw new ApiError(404, 'not_found', $localize`Point of interest not found. It may have been deleted.`);
      }
      this.poi.set(p);
      this.fill(p, event);
    } catch (e) {
      this.loadError.set(e);
    } finally {
      this.loading.set(false);
    }
  }

  private fill(p: Poi | null, event: EventDetail): void {
    this.patching = true;
    const qLat = Number(this.lat());
    const qLng = Number(this.lng());
    const prefill = this.lat() !== undefined && isFinite(qLat) && isFinite(qLng) ? { lat: qLat, lng: qLng } : null;
    const pos = p ? { lat: p.lat, lng: p.lng } : (prefill ?? (event.area ? { lat: event.area.lat, lng: event.area.lng } : null));
    const vis = p?.visibility ?? { mode: 'all' as const };
    this.form.reset({
      name: p?.name ?? '',
      type: p?.type ?? 'custom',
      description: p?.description ?? '',
      lat: pos ? Math.round(pos.lat * 1e6) / 1e6 : null,
      lng: pos ? Math.round(pos.lng * 1e6) / 1e6 : null,
      icon: p?.icon && MAP_ICONS.some((i) => i.value === p.icon) ? p.icon : 'flag',
      color: p?.color ?? POI_TYPE_COLORS.custom,
      imageUrl: p?.imageUrl ?? null,
      teamId: p?.teamId ?? '',
      visMode: vis.mode,
      teamIds: vis.teamIds ?? [],
      squadIds: vis.squadIds ?? [],
      roles: vis.roles ?? [],
      phases: vis.phases ?? [],
      activeFrom: toLocalInput(vis.activeFrom),
      activeUntil: toLocalInput(vis.activeUntil),
    });
    this.mapCenter.set(pos);
    this.patching = false;
    this.dirty.set(false);
  }

  protected e(path: string, label: string): string | null {
    return controlError(this.form.get(path), label);
  }

  protected teamName(teamId: string): string {
    return this.event()?.teams.find((t) => t.id === teamId)?.name ?? '';
  }

  protected toggle(ctrl: FormControl<string[]>, value: string, ev: Event): void {
    toggleIn(ctrl, value, targetChecked(ev));
  }

  protected addPhase(): void {
    const p = this.phaseDraft().trim();
    if (!p) return;
    toggleIn(this.form.controls.phases, p, true);
    this.phaseDraft.set('');
  }

  protected removePhase(p: string): void {
    toggleIn(this.form.controls.phases, p, false);
  }

  protected setPosition(p: LatLng): void {
    this.form.patchValue({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });
  }

  protected useMyPosition(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.toast.warning($localize`Location is not available on this device`);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        this.setPosition(p);
        this.mapCenter.set(p);
        this.toast.info($localize`Position set from your GPS`, `${formatLatLng(p)} · ±${Math.round(pos.coords.accuracy)} m`);
      },
      (err) => this.toast.warning($localize`Could not get your location`, err.message),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  protected async upload(ev: Event): Promise<void> {
    const el = ev.target as HTMLInputElement;
    const file = el.files?.[0];
    if (!file) return;
    this.uploading.set(true);
    try {
      const res = await this.api.upload(file, 'poi_image');
      this.form.controls.imageUrl.setValue(res.url);
      this.toast.success($localize`Image uploaded`, $localize`Save to keep it.`);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.uploading.set(false);
      el.value = '';
    }
  }

  protected clearImage(): void {
    this.form.controls.imageUrl.setValue(null);
  }

  protected onBeforeUnload(ev: BeforeUnloadEvent): void {
    if (this.dirty()) ev.preventDefault();
  }

  async save(): Promise<void> {
    this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    const from = fromLocalInput(v.activeFrom);
    const until = fromLocalInput(v.activeUntil);
    if (from && until && new Date(until) <= new Date(from)) this.form.controls.activeUntil.setErrors({ message: $localize`The end must be after the start.` });
    if (this.form.invalid) return;
    const visibility: ContentVisibility = {
      mode: v.visMode,
      teamIds: v.visMode === 'teams' ? v.teamIds : [],
      squadIds: v.visMode === 'teams' ? v.squadIds : [],
      roles: v.visMode === 'gm_only' ? [] : (v.roles as PlayerRole[]),
      phases: v.visMode === 'gm_only' ? [] : v.phases,
      activeFrom: v.visMode === 'gm_only' ? null : from,
      activeUntil: v.visMode === 'gm_only' ? null : until,
    };
    const body: PoiInput = {
      name: v.name.trim(),
      type: v.type,
      description: v.description,
      lat: num(v.lat),
      lng: num(v.lng),
      icon: v.icon,
      color: v.color,
      imageUrl: v.imageUrl,
      teamId: v.type === 'team_base' && v.teamId ? v.teamId : null,
      visibility,
    };
    this.saving.set(true);
    try {
      const saved = this.isNew() ? await this.api.createPoi(this.eventId(), body) : await this.api.updatePoi(this.eventId(), this.poiId(), body);
      this.poi.set(saved);
      this.dirty.set(false);
      this.toast.success(this.isNew() ? $localize`${saved.name}:name: created` : $localize`${saved.name}:name: saved`);
      await this.router.navigateByUrl(this.backUrl());
    } catch (e) {
      const err = ApiError.from(e);
      const rest = applyServerErrors(this.form, err, { 'visibility.activeUntil': 'activeUntil', 'visibility.activeFrom': 'activeFrom' });
      this.toast.error(err, rest.join(' ') || undefined);
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const p = this.poi();
    if (!p) return;
    const ok = await this.confirm.ask({
      title: $localize`Delete ${p.name}:name:?`,
      consequences: [$localize`Players no longer see it on their map.`, $localize`This cannot be undone.`],
      confirmLabel: $localize`Delete`,
      destructive: true,
    });
    if (!ok) return;
    try {
      await this.api.deletePoi(this.eventId(), p.id);
      this.dirty.set(false);
      this.toast.success($localize`${p.name}:name: deleted`);
      await this.router.navigateByUrl(this.backUrl());
    } catch (e) {
      this.toast.error(e);
    }
  }
}
