import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input, signal } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { ApiService } from '../../../core/api/api.service';
import { EventDetail, EventInput, GameMode } from '../../../core/api/models';
import { ToastService } from '../../../core/ui/toast.service';
import { GAME_MODE_LABELS, toLocalInput } from '../../../core/util/format';
import { formatLatLng, parseLatLng } from '../../../core/util/geo';
import { SegmentOption, SegmentedControl, SwitchRow } from './controls';
import { controlError, copyText, formTick, integerValidator } from './form-utils';

export type BasicsForm = FormGroup<{
  name: FormControl<string>;
  coverUrl: FormControl<string | null>;
  description: FormControl<string>;
  gameMode: FormControl<GameMode>;
  customModeName: FormControl<string>;
  customModeRules: FormControl<string>;
  date: FormControl<string>;
  startTime: FormControl<string>;
  endTime: FormControl<string>;
  meetingAddress: FormControl<string>;
  meetingCoords: FormControl<string>;
  minPlayers: FormControl<number>;
  maxPlayers: FormControl<number>;
  visibility: FormControl<'public' | 'private'>;
  requiresApproval: FormControl<boolean>;
  rules: FormControl<string>;
  safetyRules: FormControl<string>;
  requiredEquipment: FormControl<string>;
  chronoInfo: FormControl<string>;
}>;

/** API field → control path, for applyServerErrors. */
export const BASICS_FIELD_MAP: Record<string, string> = {
  startAt: 'startTime',
  endAt: 'endTime',
  meetingLat: 'meetingCoords',
  meetingLng: 'meetingCoords',
};

function coordsValidator(c: AbstractControl): ValidationErrors | null {
  const v = String(c.value ?? '').trim();
  if (!v) return null;
  return parseLatLng(v) ? null : { message: 'Use "latitude, longitude", e.g. 45.4642, 9.1900.' };
}

function basicsGroupValidator(g: AbstractControl): ValidationErrors | null {
  const v = (g as BasicsForm).getRawValue();
  const errors: ValidationErrors = {};
  if (v.date && v.startTime && v.endTime && v.endTime <= v.startTime) errors['endBeforeStart'] = true;
  if (Number(v.minPlayers) > Number(v.maxPlayers)) errors['minAboveMax'] = true;
  if (v.gameMode === 'custom' && !v.customModeName.trim()) errors['customNameRequired'] = true;
  return Object.keys(errors).length ? errors : null;
}

function defaultDate(): string {
  const d = new Date();
  // Next Sunday at least five days away: a realistic first draft.
  d.setDate(d.getDate() + 5 + ((7 - ((d.getDay() + 5) % 7)) % 7));
  return toLocalInput(d.toISOString()).slice(0, 10);
}

export function createBasicsForm(): BasicsForm {
  const nn = <T>(v: T, validators: ((c: AbstractControl) => ValidationErrors | null)[] = []) =>
    new FormControl<T>(v, { nonNullable: true, validators });
  return new FormGroup(
    {
      name: nn('', [Validators.required, Validators.maxLength(120)]),
      coverUrl: new FormControl<string | null>(null),
      description: nn('', [Validators.maxLength(5000)]),
      gameMode: nn<GameMode>('domination'),
      customModeName: nn('', [Validators.maxLength(80)]),
      customModeRules: nn('', [Validators.maxLength(5000)]),
      date: nn(defaultDate(), [Validators.required]),
      startTime: nn('09:00', [Validators.required]),
      endTime: nn('15:00', [Validators.required]),
      meetingAddress: nn('', [Validators.maxLength(300)]),
      meetingCoords: nn('', [coordsValidator]),
      minPlayers: nn(10, [Validators.required, Validators.min(0), Validators.max(2000), integerValidator]),
      maxPlayers: nn(60, [Validators.required, Validators.min(1), Validators.max(2000), integerValidator]),
      visibility: nn<'public' | 'private'>('public'),
      requiresApproval: nn(false),
      rules: nn('', [Validators.maxLength(10000)]),
      safetyRules: nn('', [Validators.maxLength(10000)]),
      requiredEquipment: nn('', [Validators.maxLength(5000)]),
      chronoInfo: nn('', [Validators.maxLength(2000)]),
    },
    { validators: [basicsGroupValidator] },
  );
}

export function patchBasicsForm(form: BasicsForm, e: EventDetail): void {
  const start = toLocalInput(e.startAt);
  const end = toLocalInput(e.endAt);
  form.reset({
    name: e.name,
    coverUrl: e.coverUrl,
    description: e.description ?? '',
    gameMode: e.gameMode,
    customModeName: e.customModeName ?? '',
    customModeRules: e.customModeRules ?? '',
    date: start.slice(0, 10),
    startTime: start.slice(11, 16),
    endTime: end.slice(11, 16),
    meetingAddress: e.meetingAddress ?? '',
    meetingCoords: e.meetingLat !== null && e.meetingLng !== null ? formatLatLng({ lat: e.meetingLat, lng: e.meetingLng }) : '',
    minPlayers: e.minPlayers,
    maxPlayers: e.maxPlayers,
    visibility: e.visibility,
    requiresApproval: e.requiresApproval,
    rules: e.rules ?? '',
    safetyRules: e.safetyRules ?? '',
    requiredEquipment: e.requiredEquipment ?? '',
    chronoInfo: e.chronoInfo ?? '',
  });
}

function localIso(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

export function basicsToInput(form: BasicsForm, opts: { includeRegistration?: boolean } = {}): EventInput {
  const v = form.getRawValue();
  const coords = parseLatLng(v.meetingCoords);
  const custom = v.gameMode === 'custom';
  const input: EventInput = {
    name: v.name.trim(),
    coverUrl: v.coverUrl,
    description: v.description.trim(),
    gameMode: v.gameMode,
    customModeName: custom ? v.customModeName.trim() || null : null,
    customModeRules: custom ? v.customModeRules.trim() || null : null,
    startAt: localIso(v.date, v.startTime),
    endAt: localIso(v.date, v.endTime),
    meetingAddress: v.meetingAddress.trim() || null,
    meetingLat: coords?.lat ?? null,
    meetingLng: coords?.lng ?? null,
    minPlayers: Number(v.minPlayers),
    maxPlayers: Number(v.maxPlayers),
    rules: v.rules.trim(),
    safetyRules: v.safetyRules.trim(),
    requiredEquipment: v.requiredEquipment.trim(),
    chronoInfo: v.chronoInfo.trim(),
  };
  if (opts.includeRegistration !== false) {
    input.visibility = v.visibility;
    input.requiresApproval = v.requiresApproval;
  }
  return input;
}

const MODE_OPTIONS = (Object.keys(GAME_MODE_LABELS) as GameMode[]).map((m) => ({ value: m, label: GAME_MODE_LABELS[m] }));

/** Basic information form (wizard step 1 and the editor's Basics tab). */
@Component({
  selector: 'zeus-event-basics-form',
  imports: [ReactiveFormsModule, NgIcon, HlmButton, HlmInput, HlmLabel, HlmTextarea, SegmentedControl, SwitchRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-6' },
  template: `
    @let f = form();
    <div [formGroup]="f" class="contents" [attr.data-rev]="tick()">
      <fieldset class="panel flex flex-col gap-4 p-4">
        <legend class="label-caps float-left mb-1 w-full">Event</legend>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="bf-name">Event name <span aria-hidden="true">*</span></label>
          <input hlmInput id="bf-name" class="h-11" formControlName="name" autocomplete="off" placeholder="Operation Iron Valley" [attr.aria-invalid]="!!err('name')" aria-describedby="bf-name-e" />
          @if (err('name'); as e) {
            <p id="bf-name-e" class="field-error">{{ e }}</p>
          }
        </div>

        <div class="flex flex-col gap-1.5">
          <span hlmLabel id="bf-cover-l">Cover image</span>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div class="relative aspect-[16/9] w-full overflow-hidden rounded-sm border border-border bg-muted sm:w-56">
              @if (f.controls.coverUrl.value; as url) {
                <img [src]="url" alt="Cover preview" class="absolute inset-0 size-full object-cover" />
              } @else {
                <div class="absolute inset-0 grid place-items-center text-muted-foreground">
                  <ng-icon name="lucideImage" size="28" aria-hidden="true" />
                  <span class="sr-only">No cover image</span>
                </div>
              }
            </div>
            <div class="flex flex-wrap gap-2">
              <label class="tap inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-ring">
                <ng-icon name="lucideUpload" size="16" aria-hidden="true" />
                {{ uploading() ? 'Uploading…' : f.controls.coverUrl.value ? 'Replace image' : 'Upload image' }}
                <input type="file" accept="image/*" class="sr-only" aria-labelledby="bf-cover-l" [disabled]="uploading()" (change)="onCover($event)" />
              </label>
              @if (f.controls.coverUrl.value) {
                <button hlmBtn variant="ghost" class="h-11" type="button" (click)="removeCover()">
                  <ng-icon name="lucideTrash2" size="16" aria-hidden="true" /> Remove
                </button>
              }
              <p class="w-full text-xs text-muted-foreground">JPG or PNG, landscape works best. Shown on event cards and the event page.</p>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="bf-desc">Description</label>
          <textarea hlmTextarea id="bf-desc" rows="4" formControlName="description" placeholder="Scenario, schedule of the day, what makes this game different."></textarea>
          @if (err('description'); as e) {
            <p class="field-error">{{ e }}</p>
          }
        </div>

        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="bf-mode">Game mode</label>
          <select id="bf-mode" formControlName="gameMode" class="h-11 w-full rounded-md border border-input bg-background px-2.5 text-base dark:bg-input/30">
            @for (m of modes; track m.value) {
              <option [value]="m.value">{{ m.label }}</option>
            }
          </select>
        </div>

        @if (f.controls.gameMode.value === 'custom') {
          <div class="flex flex-col gap-4 border-l-2 border-primary/50 pl-3">
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="bf-cname">Custom mode name <span aria-hidden="true">*</span></label>
              <input hlmInput id="bf-cname" class="h-11" formControlName="customModeName" placeholder="Convoy ambush" [attr.aria-invalid]="customNameMissing()" />
              @if (customNameMissing()) {
                <p class="field-error">Give the custom mode a name.</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="bf-crules">Custom mode rules</label>
              <textarea hlmTextarea id="bf-crules" rows="4" formControlName="customModeRules" placeholder="How a team wins, how objectives work, respawn rules."></textarea>
            </div>
          </div>
        }
      </fieldset>

      <fieldset class="panel flex flex-col gap-4 p-4">
        <legend class="label-caps float-left mb-1 w-full">Schedule</legend>
        <div class="grid gap-4 sm:grid-cols-3">
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="bf-date">Date <span aria-hidden="true">*</span></label>
            <input hlmInput id="bf-date" type="date" class="h-11" formControlName="date" [attr.aria-invalid]="!!err('date')" />
            @if (err('date'); as e) {
              <p class="field-error">{{ e }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="bf-start">Start time <span aria-hidden="true">*</span></label>
            <input hlmInput id="bf-start" type="time" class="h-11" formControlName="startTime" [attr.aria-invalid]="!!err('startTime')" />
            @if (err('startTime'); as e) {
              <p class="field-error">{{ e }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="bf-end">Expected end time <span aria-hidden="true">*</span></label>
            <input hlmInput id="bf-end" type="time" class="h-11" formControlName="endTime" [attr.aria-invalid]="!!err('endTime') || endBeforeStart()" aria-describedby="bf-end-e" />
            @if (err('endTime'); as e) {
              <p id="bf-end-e" class="field-error">{{ e }}</p>
            } @else if (endBeforeStart()) {
              <p id="bf-end-e" class="field-error">The end time must be after the start time.</p>
            }
          </div>
        </div>
      </fieldset>

      <fieldset class="panel flex flex-col gap-4 p-4">
        <legend class="label-caps float-left mb-1 w-full">Meeting point</legend>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="bf-addr">Address</label>
          <input hlmInput id="bf-addr" class="h-11" formControlName="meetingAddress" autocomplete="street-address" placeholder="Car park, Via dei Boschi 12, Bergamo" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="bf-coords">Coordinates (optional)</label>
          <div class="flex flex-col gap-2 sm:flex-row">
            <input hlmInput id="bf-coords" class="num h-11 flex-1" formControlName="meetingCoords" inputmode="decimal" placeholder="45.4642, 9.1900" [attr.aria-invalid]="!!err('meetingCoords')" aria-describedby="bf-coords-h" />
            <button hlmBtn variant="outline" class="h-11" type="button" (click)="useMyLocation()" [disabled]="locating()">
              <ng-icon name="lucideLocateFixed" size="16" class="text-nav" aria-hidden="true" /> {{ locating() ? 'Locating…' : 'Use my location' }}
            </button>
          </div>
          @if (err('meetingCoords'); as e) {
            <p class="field-error">{{ e }}</p>
          } @else {
            <p id="bf-coords-h" class="text-xs text-muted-foreground">Paste from Google Maps ("45.46, 9.19") so players can navigate to the car park.</p>
          }
        </div>
      </fieldset>

      <fieldset class="panel flex flex-col gap-4 p-4">
        <legend class="label-caps float-left mb-1 w-full">Players</legend>
        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="bf-min">Minimum players</label>
            <input hlmInput id="bf-min" type="number" min="0" inputmode="numeric" class="num h-11" formControlName="minPlayers" [attr.aria-invalid]="!!err('minPlayers')" />
            @if (err('minPlayers'); as e) {
              <p class="field-error">{{ e }}</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="bf-max">Maximum players</label>
            <input hlmInput id="bf-max" type="number" min="1" inputmode="numeric" class="num h-11" formControlName="maxPlayers" [attr.aria-invalid]="!!err('maxPlayers') || minAboveMax()" />
            @if (err('maxPlayers'); as e) {
              <p class="field-error">{{ e }}</p>
            } @else if (minAboveMax()) {
              <p class="field-error">Must be at least the minimum.</p>
            }
          </div>
        </div>

        @if (showRegistration()) {
          <div class="flex flex-col gap-1.5">
            <span hlmLabel id="bf-vis-l">Who can find this event</span>
            <zeus-segmented formControlName="visibility" [options]="visibilityOptions" labelledby="bf-vis-l" stacked />
            @if (f.controls.visibility.value === 'private') {
              <div class="rounded-sm border border-border bg-muted p-3 text-sm">
                @if (joinCode(); as code) {
                  <p class="label-caps">Join code</p>
                  <div class="mt-1 flex items-center gap-2">
                    <span class="num text-2xl font-bold tracking-widest">{{ code }}</span>
                    <button hlmBtn variant="outline" size="sm" class="tap" type="button" (click)="copy(code)" aria-label="Copy join code">
                      <ng-icon name="lucideCopy" size="16" aria-hidden="true" /> Copy
                    </button>
                  </div>
                  <p class="mt-1 text-xs text-muted-foreground">Share it with your players. They enter it under Join event.</p>
                } @else {
                  <p><ng-icon name="lucideKeyRound" size="14" aria-hidden="true" /> A join code is generated when you save. It appears here, and you can share it with your players.</p>
                }
              </div>
            }
          </div>
          <zeus-switch-row formControlName="requiresApproval" label="Approve players manually" description="Each registration waits until you approve it. Off: players are approved immediately." />
        }
      </fieldset>

      <fieldset class="panel flex flex-col gap-4 p-4">
        <legend class="label-caps float-left mb-1 w-full">Rules and safety</legend>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="bf-rules">Event rules</label>
          <textarea hlmTextarea id="bf-rules" rows="5" formControlName="rules" placeholder="Hit calling, respawn procedure, bang rule distance, dead rag colour."></textarea>
        </div>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="bf-safety">Safety rules</label>
          <textarea hlmTextarea id="bf-safety" rows="4" formControlName="safetyRules" placeholder="Eye protection on at all times outside the safe zone; barrel covers in the safe zone; emergency word: BLIND MAN."></textarea>
          <p class="text-xs text-muted-foreground">Players accept these before the game starts.</p>
        </div>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="bf-equip">Required equipment</label>
          <textarea hlmTextarea id="bf-equip" rows="3" formControlName="requiredEquipment" placeholder="Full-seal eye protection, dead rag, radio on channel 4, red and blue armbands."></textarea>
        </div>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="bf-chrono">Chronograph and power limits</label>
          <textarea hlmTextarea id="bf-chrono" rows="3" formControlName="chronoInfo" placeholder="Rifles 1.2 J with 0.20 g BBs; DMR 1.88 J, 20 m MED; bolt-action 2.3 J, 30 m MED. Chrono from 08:00."></textarea>
        </div>
      </fieldset>
    </div>
  `,
})
export class EventBasicsFormComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly form = input.required<BasicsForm>();
  readonly joinCode = input<string | null>(null);
  /** Show visibility/approval (wizard). The editor has a separate Registration tab. */
  readonly showRegistration = input(true, { transform: booleanAttribute });

  protected readonly tick = formTick(() => this.form());
  protected readonly modes = MODE_OPTIONS;
  protected readonly uploading = signal(false);
  protected readonly locating = signal(false);
  protected readonly visibilityOptions: SegmentOption<'public' | 'private'>[] = [
    { value: 'public', label: 'Public', hint: 'Listed in Discover; anyone can register.' },
    { value: 'private', label: 'Private', hint: 'Hidden from Discover; players need the join code or an invitation.' },
  ];

  private readonly groupErrors = computed(() => {
    this.tick();
    return this.form().errors ?? {};
  });
  protected readonly endBeforeStart = computed(() => !!this.groupErrors()['endBeforeStart']);
  protected readonly minAboveMax = computed(() => !!this.groupErrors()['minAboveMax']);
  protected readonly customNameMissing = computed(() => {
    this.tick();
    const c = this.form().controls.customModeName;
    return !!this.groupErrors()['customNameRequired'] && (c.touched || c.dirty || this.form().touched);
  });

  protected err(name: keyof BasicsForm['controls']): string | null {
    return controlError(this.form().controls[name]);
  }

  protected async onCover(ev: Event): Promise<void> {
    const inputEl = ev.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.toast.error('Choose an image file (JPG, PNG or WebP).');
      return;
    }
    this.uploading.set(true);
    try {
      const { url } = await this.api.upload(file, 'cover');
      const c = this.form().controls.coverUrl;
      c.setValue(url);
      c.markAsDirty();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.uploading.set(false);
    }
  }

  protected removeCover(): void {
    const c = this.form().controls.coverUrl;
    c.setValue(null);
    c.markAsDirty();
  }

  protected useMyLocation(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.toast.error('This browser cannot share its location.');
      return;
    }
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.locating.set(false);
        const c = this.form().controls.meetingCoords;
        c.setValue(formatLatLng({ lat: pos.coords.latitude, lng: pos.coords.longitude }));
        c.markAsDirty();
        this.toast.success('Meeting point set to your location', `Accuracy ±${Math.round(pos.coords.accuracy)} m`);
      },
      (err) => {
        this.locating.set(false);
        this.toast.error(err.code === err.PERMISSION_DENIED ? 'Location permission denied. Allow it in the browser settings or paste coordinates.' : 'Could not get your location. Paste coordinates instead.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }

  protected async copy(code: string): Promise<void> {
    if (await copyText(code)) this.toast.success('Join code copied');
    else this.toast.error('Copy failed. Select the code and copy it manually.');
  }
}
