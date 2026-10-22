import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { TrackingSettings } from '../../../core/api/models';
import { SwitchRow } from './controls';
import { controlError, formTick, integerValidator } from './form-utils';

type NumKeys = 'intervalSec' | 'minDistanceM' | 'maxAccuracyM' | 'staleAfterSec' | 'hideAfterSec' | 'maxSpeedMps' | 'retentionDays';
type BoolKeys = 'background' | 'stopWhenPaused' | 'showLastKnown' | 'batterySaver' | 'highAccuracy' | 'keepHistory';

export type TrackingForm = FormGroup<{ [K in NumKeys]: FormControl<number> } & { [K in BoolKeys]: FormControl<boolean> }>;

const LIMITS: Record<NumKeys, [number, number]> = {
  intervalSec: [5, 120],
  minDistanceM: [0, 200],
  maxAccuracyM: [5, 500],
  staleAfterSec: [10, 1800],
  hideAfterSec: [10, 7200],
  maxSpeedMps: [2, 60],
  retentionDays: [0, 365],
};

function hideAfterStale(g: AbstractControl): ValidationErrors | null {
  const v = (g as TrackingForm).getRawValue();
  return Number(v.hideAfterSec) < Number(v.staleAfterSec) ? { hideBeforeStale: true } : null;
}

export function createTrackingForm(): TrackingForm {
  const num = (k: NumKeys, v: number, int = true) =>
    new FormControl(v, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(LIMITS[k][0]), Validators.max(LIMITS[k][1]), ...(int ? [integerValidator] : [])],
    });
  const bool = (v: boolean) => new FormControl(v, { nonNullable: true });
  return new FormGroup(
    {
      intervalSec: num('intervalSec', 10),
      minDistanceM: num('minDistanceM', 5),
      maxAccuracyM: num('maxAccuracyM', 50),
      staleAfterSec: num('staleAfterSec', 60),
      hideAfterSec: num('hideAfterSec', 300),
      maxSpeedMps: num('maxSpeedMps', 12, false),
      retentionDays: num('retentionDays', 30),
      background: bool(false),
      stopWhenPaused: bool(true),
      showLastKnown: bool(true),
      batterySaver: bool(false),
      highAccuracy: bool(true),
      keepHistory: bool(true),
    },
    { validators: [hideAfterStale] },
  );
}

export function trackingValue(form: TrackingForm): TrackingSettings {
  const v = form.getRawValue();
  return {
    intervalSec: Number(v.intervalSec),
    minDistanceM: Number(v.minDistanceM),
    maxAccuracyM: Number(v.maxAccuracyM),
    background: v.background,
    stopWhenPaused: v.stopWhenPaused,
    staleAfterSec: Number(v.staleAfterSec),
    hideAfterSec: Number(v.hideAfterSec),
    showLastKnown: v.showLastKnown,
    batterySaver: v.batterySaver,
    highAccuracy: v.highAccuracy,
    maxSpeedMps: Number(v.maxSpeedMps),
    retentionDays: Number(v.retentionDays),
    keepHistory: v.keepHistory,
  };
}

/** Location tracking settings, grouped and explained. */
@Component({
  selector: 'zeus-tracking-form',
  imports: [ReactiveFormsModule, NgIcon, HlmInput, HlmLabel, SwitchRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <fieldset [formGroup]="form()" class="panel flex flex-col gap-5 p-4" [attr.data-rev]="tick()">
      <legend class="label-caps float-left mb-1 w-full" i18n>Location tracking</legend>
      <p class="text-sm text-muted-foreground" i18n>
        How often phones report their position and how the server treats old or doubtful fixes.
        Players consent to tracking per event and can stop it at any time.
      </p>

      <section class="flex flex-col gap-3" aria-labelledby="tr-g1">
        <h3 id="tr-g1" class="text-sm font-bold uppercase" i18n>Update frequency</h3>
        <div class="grid gap-4 sm:grid-cols-3">
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="tr-int" i18n>Report every (s)</label>
            <input hlmInput id="tr-int" type="number" min="5" max="120" inputmode="numeric" class="num h-11" formControlName="intervalSec" aria-describedby="tr-int-h" [attr.aria-invalid]="!!err('intervalSec')" />
            @if (err('intervalSec'); as e) {
              <p class="field-error">{{ e }}</p>
            } @else {
              <p id="tr-int-h" class="text-xs text-muted-foreground" i18n>5–120 s. Shorter is smoother but uses more battery.</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="tr-dist" i18n>Minimum movement (m)</label>
            <input hlmInput id="tr-dist" type="number" min="0" inputmode="numeric" class="num h-11" formControlName="minDistanceM" aria-describedby="tr-dist-h" [attr.aria-invalid]="!!err('minDistanceM')" />
            @if (err('minDistanceM'); as e) {
              <p class="field-error">{{ e }}</p>
            } @else {
              <p id="tr-dist-h" class="text-xs text-muted-foreground" i18n>Skip reports when a player moved less than this.</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="tr-acc" i18n>Maximum accuracy (m)</label>
            <input hlmInput id="tr-acc" type="number" min="5" inputmode="numeric" class="num h-11" formControlName="maxAccuracyM" aria-describedby="tr-acc-h" [attr.aria-invalid]="!!err('maxAccuracyM')" />
            @if (err('maxAccuracyM'); as e) {
              <p class="field-error">{{ e }}</p>
            } @else {
              <p id="tr-acc-h" class="text-xs text-muted-foreground" i18n>Fixes less precise than ±this are ignored.</p>
            }
          </div>
        </div>
        <div class="divide-y divide-border">
          <zeus-switch-row formControlName="highAccuracy" label="High accuracy GPS" description="Uses satellite GPS instead of Wi-Fi/cell estimates. Needed for capture zones; costs battery." i18n-label i18n-description />
          <zeus-switch-row formControlName="batterySaver" label="Battery saver" description="Phones report less often when standing still and when the battery is low." i18n-label i18n-description />
        </div>
      </section>

      <section class="flex flex-col gap-2" aria-labelledby="tr-g2">
        <h3 id="tr-g2" class="text-sm font-bold uppercase" i18n>Screen lock and pauses</h3>
        <div class="flex gap-2 rounded-sm border border-border bg-muted p-3 text-xs text-muted-foreground">
          <ng-icon name="lucideSmartphone" size="16" class="mt-0.5 shrink-0" aria-hidden="true" />
          <p i18n>
            Browsers pause GPS when the screen locks. During the game the app keeps the screen awake instead.
            True background tracking only works in the mobile app wrapper; this setting lets it run there.
          </p>
        </div>
        <div class="divide-y divide-border">
          <zeus-switch-row formControlName="background" label="Background tracking" description="Keep reporting with the screen locked (mobile app wrapper only)." i18n-label i18n-description />
          <zeus-switch-row formControlName="stopWhenPaused" label="Stop tracking while paused" description="No positions are collected while the game is paused." i18n-label i18n-description />
        </div>
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="tr-g3">
        <h3 id="tr-g3" class="text-sm font-bold uppercase" i18n>Old positions</h3>
        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="tr-stale" i18n>Stale after (s)</label>
            <input hlmInput id="tr-stale" type="number" min="10" inputmode="numeric" class="num h-11" formControlName="staleAfterSec" aria-describedby="tr-stale-h" [attr.aria-invalid]="!!err('staleAfterSec')" />
            @if (err('staleAfterSec'); as e) {
              <p class="field-error">{{ e }}</p>
            } @else {
              <p id="tr-stale-h" class="text-xs text-muted-foreground" i18n>Marker turns ◐ stale.</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="tr-hide" i18n>Hide after (s)</label>
            <input hlmInput id="tr-hide" type="number" min="10" inputmode="numeric" class="num h-11" formControlName="hideAfterSec" aria-describedby="tr-hide-h" [attr.aria-invalid]="!!err('hideAfterSec') || hideBeforeStale()" />
            @if (err('hideAfterSec'); as e) {
              <p class="field-error">{{ e }}</p>
            } @else if (hideBeforeStale()) {
              <p class="field-error" i18n>Must be at least the stale time.</p>
            } @else {
              <p id="tr-hide-h" class="text-xs text-muted-foreground" i18n>Marker disappears from teammates' maps.</p>
            }
          </div>
        </div>
        <zeus-switch-row formControlName="showLastKnown" label="Show last known position" description="Between stale and hidden, keep the last fix on the map, greyed out." i18n-label i18n-description />
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="tr-g4">
        <h3 id="tr-g4" class="text-sm font-bold uppercase" i18n>Anti-cheat</h3>
        <div class="flex flex-col gap-1.5 sm:max-w-xs">
          <label hlmLabel for="tr-speed" i18n>Maximum realistic speed (m/s)</label>
          <input hlmInput id="tr-speed" type="number" min="2" step="0.5" inputmode="decimal" class="num h-11" formControlName="maxSpeedMps" aria-describedby="tr-speed-h" [attr.aria-invalid]="!!err('maxSpeedMps')" />
          @if (err('maxSpeedMps'); as e) {
            <p class="field-error">{{ e }}</p>
          } @else {
            <p id="tr-speed-h" class="text-xs text-muted-foreground" i18n>Jumps faster than this are rejected and flagged to you. 12 m/s ≈ 43 km/h.</p>
          }
        </div>
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="tr-g5">
        <h3 id="tr-g5" class="text-sm font-bold uppercase" i18n>Data retention</h3>
        <div class="flex flex-col gap-1.5 sm:max-w-xs">
          <label hlmLabel for="tr-ret" i18n>Keep location data for (days)</label>
          <input hlmInput id="tr-ret" type="number" min="0" max="365" inputmode="numeric" class="num h-11" formControlName="retentionDays" aria-describedby="tr-ret-h" [attr.aria-invalid]="!!err('retentionDays')" />
          @if (err('retentionDays'); as e) {
            <p class="field-error">{{ e }}</p>
          } @else {
            <p id="tr-ret-h" class="text-xs text-muted-foreground" i18n>0 = delete positions when the event ends. A player's own shorter setting wins.</p>
          }
        </div>
        <zeus-switch-row formControlName="keepHistory" label="Keep movement history" description="Store every fix for post-game replays. Off: only the latest position is kept." i18n-label i18n-description />
      </section>
    </fieldset>
  `,
})
export class TrackingFormComponent {
  readonly form = input.required<TrackingForm>();
  protected readonly tick = formTick(() => this.form());
  protected readonly hideBeforeStale = computed(() => {
    this.tick();
    return !!this.form().errors?.['hideBeforeStale'];
  });
  protected err(name: NumKeys): string | null {
    return controlError(this.form().controls[name]);
  }
}
