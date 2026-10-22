import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { Precision, VisibilityRules } from '../../../core/api/models';
import { SegmentOption, SegmentedControl, nextId } from './controls';
import { controlError, formTick, integerValidator } from './form-utils';

export type VisibilityForm = FormGroup<{ [K in keyof VisibilityRules]: FormControl<VisibilityRules[K]> }>;

export const DEFAULT_VISIBILITY: VisibilityRules = {
  allies: 'team',
  squadLeadersSeeSquad: true,
  enemies: 'perk_only',
  allyPrecision: 'exact',
  enemyPrecision: 'approximate',
  approxRadiusM: 50,
  delaySec: 30,
  showNicknames: true,
  showRoles: true,
  showEnemyBases: false,
  capturedObjectives: 'visible',
  revealObjectivesBeforeStart: false,
  showEnemyCurrency: false,
};

export function createVisibilityForm(): VisibilityForm {
  const c = <K extends keyof VisibilityRules>(k: K) => new FormControl<VisibilityRules[K]>(DEFAULT_VISIBILITY[k], { nonNullable: true });
  return new FormGroup({
    allies: c('allies'),
    squadLeadersSeeSquad: c('squadLeadersSeeSquad'),
    enemies: c('enemies'),
    allyPrecision: c('allyPrecision'),
    enemyPrecision: c('enemyPrecision'),
    approxRadiusM: new FormControl(50, { nonNullable: true, validators: [Validators.required, Validators.min(5), Validators.max(1000), integerValidator] }),
    delaySec: new FormControl(30, { nonNullable: true, validators: [Validators.required, Validators.min(5), Validators.max(3600), integerValidator] }),
    showNicknames: c('showNicknames'),
    showRoles: c('showRoles'),
    showEnemyBases: c('showEnemyBases'),
    capturedObjectives: c('capturedObjectives'),
    revealObjectivesBeforeStart: c('revealObjectivesBeforeStart'),
    showEnemyCurrency: c('showEnemyCurrency'),
  }) as VisibilityForm;
}

export function visibilityValue(form: VisibilityForm): VisibilityRules {
  const v = form.getRawValue();
  return { ...v, approxRadiusM: Number(v.approxRadiusM), delaySec: Number(v.delaySec) };
}

const SHOW_HIDE: SegmentOption<boolean>[] = [
  { value: true, label: $localize`Show` },
  { value: false, label: $localize`Hide` },
];
const YES_NO_LEADERS: SegmentOption<boolean>[] = [
  { value: true, label: $localize`Yes` },
  { value: false, label: $localize`No` },
];
const PRECISION_OPTIONS: SegmentOption<Precision>[] = [
  { value: 'exact', label: $localize`Exact`, hint: $localize`The real position.` },
  { value: 'approximate', label: $localize`Approximate`, hint: $localize`A circle around a shifted point.` },
  { value: 'delayed', label: $localize`Delayed`, hint: $localize`The exact position, but late.` },
  { value: 'area', label: $localize`Area only`, hint: $localize`Only the rough area, no marker.` },
];

interface MatrixRow {
  key: Exclude<keyof VisibilityRules, 'approxRadiusM' | 'delaySec'>;
  label: string;
  help: string;
  options: SegmentOption<unknown>[];
}

interface MatrixGroup {
  title: string;
  rows: MatrixRow[];
}

const GROUPS: MatrixGroup[] = [
  {
    title: $localize`Your side`,
    rows: [
      {
        key: 'allies',
        label: $localize`Teammates on the map`,
        help: $localize`Which friendly players each player sees.`,
        options: [
          { value: 'none', label: $localize`None` },
          { value: 'squad', label: $localize`Own squad` },
          { value: 'team', label: $localize`Whole team` },
          { value: 'alliance', label: $localize`Team + allies` },
        ],
      },
      { key: 'squadLeadersSeeSquad', label: $localize`Squad leaders see their squad`, help: $localize`Even when teammates are hidden, leaders still see their own squad.`, options: YES_NO_LEADERS },
      { key: 'allyPrecision', label: $localize`Ally precision`, help: $localize`How exact friendly markers are.`, options: PRECISION_OPTIONS },
    ],
  },
  {
    title: $localize`Enemies`,
    rows: [
      {
        key: 'enemies',
        label: $localize`Enemy positions`,
        help: $localize`When players see enemies at all.`,
        options: [
          { value: 'never', label: $localize`Never` },
          { value: 'perk_only', label: $localize`Only during a perk`, hint: $localize`While a UAV or recon scan is active.` },
          { value: 'always', label: $localize`Always` },
        ],
      },
      { key: 'enemyPrecision', label: $localize`Enemy precision`, help: $localize`How exact enemy markers are when shown.`, options: PRECISION_OPTIONS },
    ],
  },
  {
    title: $localize`Details`,
    rows: [
      { key: 'showNicknames', label: $localize`Nicknames on markers`, help: $localize`Hide them for anonymous dots.`, options: SHOW_HIDE },
      { key: 'showRoles', label: $localize`Player roles`, help: $localize`Medic, sniper, squad leader… on markers and lists.`, options: SHOW_HIDE },
      { key: 'showEnemyBases', label: $localize`Enemy team bases`, help: $localize`Show the other teams’ base locations on the map.`, options: SHOW_HIDE },
    ],
  },
  {
    title: $localize`Objectives`,
    rows: [
      {
        key: 'capturedObjectives',
        label: $localize`Captured objectives`,
        help: $localize`Who sees which team holds an objective.`,
        options: [
          { value: 'visible', label: $localize`Everyone` },
          { value: 'owner_only', label: $localize`Owner only` },
          { value: 'hidden', label: $localize`Nobody` },
        ],
      },
      {
        key: 'revealObjectivesBeforeStart',
        label: $localize`Reveal objectives before start`,
        help: $localize`Show objectives in the lobby so teams can plan.`,
        options: [
          { value: true, label: $localize`Reveal in lobby` },
          { value: false, label: $localize`At start` },
        ],
      },
    ],
  },
  {
    title: $localize`Economy`,
    rows: [{ key: 'showEnemyCurrency', label: $localize`Enemy credits`, help: $localize`Whether teams can see how many credits the others have.`, options: SHOW_HIDE }],
  },
];

/** Map visibility permissions as a matrix: setting | options. Enforced by the server. */
@Component({
  selector: 'zeus-visibility-matrix',
  imports: [ReactiveFormsModule, NgIcon, HlmInput, HlmLabel, SegmentedControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <fieldset [formGroup]="form()" class="panel flex flex-col gap-4 p-4" [attr.data-rev]="tick()">
      <legend class="label-caps float-left mb-1 w-full" i18n>Map visibility</legend>
      <p class="flex gap-2 text-sm text-muted-foreground">
        <ng-icon name="lucideShieldCheck" size="16" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <span i18n>The server enforces these rules: positions a player may not see are never sent to their phone.</span>
      </p>

      <div class="rounded-sm border border-primary/40 bg-primary/5 p-3" aria-live="polite">
        <p class="label-caps" i18n>Player view preview</p>
        <p class="mt-1 text-sm font-medium">{{ preview() }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ detailsPreview() }}</p>
      </div>

      @for (g of groups; track g.title) {
        <section [attr.aria-labelledby]="id + '-' + $index">
          <h3 [id]="id + '-' + $index" class="mb-1 border-b border-border pb-1 text-sm font-bold uppercase">{{ g.title }}</h3>
          <div class="divide-y divide-border">
            @for (r of g.rows; track r.key) {
              <div class="grid gap-2 py-3 md:grid-cols-[minmax(12rem,2fr)_3fr] md:items-center md:gap-4">
                <div>
                  <p [id]="id + '-' + r.key" class="text-sm font-medium">{{ r.label }}</p>
                  <p [id]="id + '-' + r.key + '-h'" class="text-xs text-muted-foreground">{{ r.help }}</p>
                </div>
                <zeus-segmented [formControlName]="r.key" [options]="r.options" [labelledby]="id + '-' + r.key" [describedby]="id + '-' + r.key + '-h'" />
              </div>
            }
          </div>
        </section>
      }

      <section [attr.aria-labelledby]="id + '-p'">
        <h3 [id]="id + '-p'" class="mb-1 border-b border-border pb-1 text-sm font-bold uppercase" i18n>Precision parameters</h3>
        <div class="grid gap-4 py-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <label hlmLabel [for]="id + '-rad'" i18n>Approximate radius (m)</label>
            <input hlmInput [id]="id + '-rad'" type="number" min="5" inputmode="numeric" class="num h-11" formControlName="approxRadiusM" [attr.aria-invalid]="!!err('approxRadiusM')" [attr.aria-describedby]="id + '-rad-h'" />
            @if (err('approxRadiusM'); as e) {
              <p class="field-error">{{ e }}</p>
            } @else {
              <p [id]="id + '-rad-h'" class="text-xs text-muted-foreground" i18n>Size of the circle for "Approximate" and "Area only".</p>
            }
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel [for]="id + '-del'" i18n>Delay (s)</label>
            <input hlmInput [id]="id + '-del'" type="number" min="5" inputmode="numeric" class="num h-11" formControlName="delaySec" [attr.aria-invalid]="!!err('delaySec')" [attr.aria-describedby]="id + '-del-h'" />
            @if (err('delaySec'); as e) {
              <p class="field-error">{{ e }}</p>
            } @else {
              <p [id]="id + '-del-h'" class="text-xs text-muted-foreground" i18n>How late "Delayed" positions are shown.</p>
            }
          </div>
        </div>
      </section>
    </fieldset>
  `,
})
export class VisibilityMatrix {
  readonly form = input.required<VisibilityForm>();
  protected readonly tick = formTick(() => this.form());
  protected readonly groups = GROUPS;
  protected readonly id = nextId('vis');

  private readonly value = computed(() => {
    this.tick();
    return this.form().getRawValue();
  });

  protected readonly preview = computed(() => describeVisibility(this.value()));
  protected readonly detailsPreview = computed(() => {
    const v = this.value();
    const parts = [
      v.showNicknames ? $localize`nicknames shown` : $localize`nicknames hidden`,
      v.showRoles ? $localize`roles shown` : $localize`roles hidden`,
      v.showEnemyBases ? $localize`enemy bases shown` : $localize`enemy bases hidden`,
      v.capturedObjectives === 'visible'
        ? $localize`captured objectives visible to everyone`
        : v.capturedObjectives === 'owner_only'
          ? $localize`captured objectives visible to the owning team only`
          : $localize`captured objectives visible to nobody`,
      v.revealObjectivesBeforeStart ? $localize`objectives revealed in the lobby` : $localize`objectives revealed at start`,
      v.showEnemyCurrency ? $localize`enemy credits visible` : $localize`enemy credits hidden`,
    ];
    const s = parts.join(', ');
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  });

  protected err(name: 'approxRadiusM' | 'delaySec'): string | null {
    return controlError(this.form().controls[name]);
  }
}

function precisionPhrase(p: Precision, v: Pick<VisibilityRules, 'approxRadiusM' | 'delaySec'>): string {
  switch (p) {
    case 'exact':
      return $localize`exactly`;
    case 'approximate':
      return $localize`as approximate circles of ${v.approxRadiusM}:approxRadiusM: m`;
    case 'delayed':
      return $localize`${v.delaySec}:delaySec: s late`;
    case 'area':
      return $localize`only as areas of ${v.approxRadiusM}:approxRadiusM: m`;
  }
}

/** "Players see their squad exactly, enemies only during UAV, as approximate circles of 50 m." */
export function describeVisibility(v: VisibilityRules): string {
  let allies: string;
  switch (v.allies) {
    case 'none':
      allies = v.squadLeadersSeeSquad ? $localize`no teammates (squad leaders see their squad)` : $localize`no teammates`;
      break;
    case 'squad':
      allies = $localize`their squad`;
      break;
    case 'team':
      allies = $localize`their whole team`;
      break;
    case 'alliance':
      allies = $localize`their team and allied teams`;
      break;
  }
  if (v.allies !== 'none') allies += ` ${precisionPhrase(v.allyPrecision, v)}`;

  if (v.enemies === 'never') return $localize`Players see ${allies}:allies: and never see enemies.`;
  const when = v.enemies === 'perk_only' ? $localize`only during a UAV or recon perk` : $localize`at all times`;
  return $localize`Players see ${allies}:allies:; enemies ${when}:when:, ${precisionPhrase(v.enemyPrecision, v)}:precisionPhrase:.`;
}
