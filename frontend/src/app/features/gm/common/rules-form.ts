import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../../core/api/api.service';
import { EventDetail, EventInput } from '../../../core/api/models';
import { ToastService } from '../../../core/ui/toast.service';
import { SwitchRow } from './controls';
import { ScoringForm, ScoringFormComponent, createScoringForm, scoringValue } from './scoring-form';
import { TrackingForm, TrackingFormComponent, createTrackingForm, trackingValue } from './tracking-form';
import { DEFAULT_VISIBILITY, VisibilityForm, VisibilityMatrix, createVisibilityForm, visibilityValue } from './visibility-matrix';

export type RulesForm = FormGroup<{
  scoring: ScoringForm;
  tracking: TrackingForm;
  visibilityRules: VisibilityForm;
  storeEnabled: FormControl<boolean>;
}>;

export function createRulesForm(): RulesForm {
  return new FormGroup({
    scoring: createScoringForm(),
    tracking: createTrackingForm(),
    visibilityRules: createVisibilityForm(),
    storeEnabled: new FormControl(true, { nonNullable: true }),
  });
}

export function patchRulesForm(form: RulesForm, e: EventDetail): void {
  form.reset({
    scoring: { ...form.controls.scoring.getRawValue(), ...e.scoring },
    tracking: { ...form.controls.tracking.getRawValue(), ...e.tracking },
    visibilityRules: { ...DEFAULT_VISIBILITY, ...e.visibilityRules },
    storeEnabled: e.storeEnabled,
  });
}

export function rulesToInput(form: RulesForm): Partial<EventInput> {
  return {
    scoring: scoringValue(form.controls.scoring),
    tracking: trackingValue(form.controls.tracking),
    visibilityRules: visibilityValue(form.controls.visibilityRules),
    storeEnabled: form.controls.storeEnabled.value,
  };
}

/** Rules of play: scoring, tracking, visibility and the perk store switch. */
@Component({
  selector: 'ah-rules-of-play',
  imports: [ReactiveFormsModule, RouterLink, NgIcon, HlmButton, SwitchRow, ScoringFormComponent, TrackingFormComponent, VisibilityMatrix],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-6' },
  template: `
    <ah-scoring-form [form]="form().controls.scoring" />

    <fieldset class="panel flex flex-col gap-3 p-4" [formGroup]="form()">
      <legend class="label-caps float-left mb-1 w-full" i18n>Perk store</legend>
      <ah-switch-row
        formControlName="storeEnabled"
        label="Perk store open during the game"
        description="Teams spend credits on perks such as UAV scans, objective jammers and double points." i18n-label i18n-description
      />
      <div class="flex flex-wrap items-center gap-2">
        <button hlmBtn variant="outline" class="h-11" type="button" (click)="addDefaults()" [disabled]="adding()">
          <ng-icon name="lucideSparkles" size="16" aria-hidden="true" /> {{ adding() ? txt.adding : txt.addDefaultPerks }}
        </button>
        <a hlmBtn variant="ghost" class="h-11" [routerLink]="['/gm/events', eventId(), 'perks']">
          <ng-icon name="lucideStore" size="16" aria-hidden="true" /> <ng-container i18n>Open perk editor</ng-container>
          @if (perkCount() !== null) {
            <span class="num text-muted-foreground">· {{ perkCount() }}</span>
          }
        </a>
      </div>
      <p class="text-xs text-muted-foreground" i18n>
        Defaults: UAV, objective jammer, currency theft, recon scan, instant respawn, objective shield, double points, supply drop, comms jammer. Edit prices afterwards.
      </p>
    </fieldset>

    <ah-visibility-matrix [form]="form().controls.visibilityRules" />
    <ah-tracking-form [form]="form().controls.tracking" />
  `,
})
export class RulesOfPlayComponent {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    adding: $localize`Adding…`,
    addDefaultPerks: $localize`Add default perks`,
  };

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly form = input.required<RulesForm>();
  readonly eventId = input.required<string>();
  readonly perkCount = input<number | null>(null);
  readonly perksAdded = output<number>();

  protected readonly adding = signal(false);

  protected async addDefaults(): Promise<void> {
    this.adding.set(true);
    try {
      const perks = await this.api.addDefaultPerks(this.eventId());
      this.toast.success($localize`Default perks added to the store`, $localize`Review prices and limits in the perk editor.`);
      this.perksAdded.emit(perks.length);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.adding.set(false);
    }
  }
}
