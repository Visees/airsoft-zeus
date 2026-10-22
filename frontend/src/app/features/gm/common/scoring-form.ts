import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ScoringSettings } from '../../../core/api/models';
import { SegmentOption, SegmentedControl, SwitchRow } from './controls';
import { controlError, formTick, integerValidator } from './form-utils';

export type ScoringForm = FormGroup<{
  startingPoints: FormControl<number>;
  startingCurrency: FormControl<number>;
  maxCurrency: FormControl<number>;
  allowNegativePoints: FormControl<boolean>;
  winCondition: FormControl<ScoringSettings['winCondition']>;
}>;

export function createScoringForm(): ScoringForm {
  const int = (v: number, min: number, max: number) =>
    new FormControl(v, { nonNullable: true, validators: [Validators.required, Validators.min(min), Validators.max(max), integerValidator] });
  return new FormGroup({
    startingPoints: int(0, -1_000_000, 1_000_000),
    startingCurrency: int(100, 0, 1_000_000),
    maxCurrency: int(0, 0, 10_000_000),
    allowNegativePoints: new FormControl(false, { nonNullable: true }),
    winCondition: new FormControl<ScoringSettings['winCondition']>('points', { nonNullable: true }),
  });
}

export function scoringValue(form: ScoringForm): ScoringSettings {
  const v = form.getRawValue();
  return {
    startingPoints: Number(v.startingPoints),
    startingCurrency: Number(v.startingCurrency),
    maxCurrency: Number(v.maxCurrency),
    allowNegativePoints: v.allowNegativePoints,
    winCondition: v.winCondition,
  };
}

/** Points and currency settings. */
@Component({
  selector: 'zeus-scoring-form',
  imports: [ReactiveFormsModule, HlmInput, HlmLabel, SegmentedControl, SwitchRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <fieldset [formGroup]="form()" class="panel flex flex-col gap-4 p-4" [attr.data-rev]="tick()">
      <legend class="label-caps float-left mb-1 w-full" i18n>Scoring and economy</legend>
      <p class="text-sm text-muted-foreground" i18n>
        Points decide the winner. Credits are a separate currency teams earn from objectives and spend in the perk store.
      </p>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="sc-pts" i18n>Starting points</label>
          <input hlmInput id="sc-pts" type="number" inputmode="numeric" class="num h-11" formControlName="startingPoints" [attr.aria-invalid]="!!err('startingPoints')" />
          @if (err('startingPoints'); as e) {
            <p class="field-error">{{ e }}</p>
          }
        </div>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="sc-cur" i18n>Starting credits</label>
          <input hlmInput id="sc-cur" type="number" min="0" inputmode="numeric" class="num h-11" formControlName="startingCurrency" [attr.aria-invalid]="!!err('startingCurrency')" />
          @if (err('startingCurrency'); as e) {
            <p class="field-error">{{ e }}</p>
          }
        </div>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="sc-max" i18n>Maximum credits</label>
          <input hlmInput id="sc-max" type="number" min="0" inputmode="numeric" class="num h-11" formControlName="maxCurrency" aria-describedby="sc-max-h" [attr.aria-invalid]="!!err('maxCurrency')" />
          @if (err('maxCurrency'); as e) {
            <p class="field-error">{{ e }}</p>
          } @else {
            <p id="sc-max-h" class="text-xs text-muted-foreground" i18n>0 = no cap.</p>
          }
        </div>
      </div>
      <zeus-switch-row
        formControlName="allowNegativePoints"
        label="Allow negative points"
        description="Penalties can take a team below zero. Off: points stop at 0. Credits never go below zero." i18n-label i18n-description
      />
      <div class="flex flex-col gap-1.5">
        <span hlmLabel id="sc-win-l" i18n>Winner</span>
        <zeus-segmented formControlName="winCondition" [options]="winOptions" labelledby="sc-win-l" stacked />
      </div>
    </fieldset>
  `,
})
export class ScoringFormComponent {
  readonly form = input.required<ScoringForm>();
  protected readonly tick = formTick(() => this.form());
  protected readonly winOptions: SegmentOption<ScoringSettings['winCondition']>[] = [
    { value: 'points', label: $localize`Most points`, hint: $localize`The team with the most points at the end wins.` },
    { value: 'objectives', label: $localize`Most objectives held`, hint: $localize`The team holding the most objectives when the game ends wins.` },
  ];
  protected err(name: keyof ScoringForm['controls']): string | null {
    return controlError(this.form().controls[name]);
  }
}
