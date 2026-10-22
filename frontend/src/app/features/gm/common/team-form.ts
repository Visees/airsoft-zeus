import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { Team, TeamInput, TeamPattern } from '../../../core/api/models';
import { formatLatLng, parseLatLng } from '../../../core/util/geo';
import { TEAM_COLORS, TEAM_ICONS, TEAM_PATTERNS, TEAM_PATTERN_LABELS, TeamBadge } from '../../../shared/team-badge';
import { TeamSwatch } from '../../../shared/team-swatch';
import { nextId } from './controls';
import { controlError, formTick, integerValidator } from './form-utils';

export const TEAM_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];

/** Quick preset: two clearly different teams (colour + pattern + icon). */
export const TWO_TEAM_PRESET: TeamInput[] = [
  { name: 'Alpha', color: '#3B82C4', pattern: 'stripes', icon: 'shield', capacity: 0, sortOrder: 0 },
  { name: 'Bravo', color: '#D9822B', pattern: 'dots', icon: 'star', capacity: 0, sortOrder: 1 },
];

/** Next team with an unused name, colour, pattern and icon where possible. */
export function nextTeamPreset(existing: Pick<Team, 'name' | 'color' | 'pattern' | 'icon'>[]): TeamInput {
  const pick = <T>(list: T[], used: T[], fallbackIndex: number) => list.find((x) => !used.includes(x)) ?? list[fallbackIndex % list.length];
  const n = existing.length;
  const usedColors = existing.map((t) => t.color.toUpperCase());
  return {
    name: pick(TEAM_NAMES, existing.map((t) => t.name), n) ?? $localize`Team ${n + 1}:n:`,
    color: TEAM_COLORS.find((c) => !usedColors.includes(c.toUpperCase())) ?? TEAM_COLORS[n % TEAM_COLORS.length],
    pattern: pick<TeamPattern>(
      TEAM_PATTERNS.filter((p) => p !== 'solid'),
      existing.map((t) => t.pattern),
      n,
    ),
    icon: pick(
      TEAM_ICONS.map((i) => i.value),
      existing.map((t) => t.icon),
      n,
    ),
    capacity: 0,
    sortOrder: n,
  };
}

// --- colour checks -------------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #RRGGBB colour. */
export function relativeLuminance(hex: string): number {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => channel(parseInt(x, 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Map/panel surfaces in both themes (DESIGN.md card colours). */
const SURFACES = { light: '#FFFFFF', dark: '#161917' };
export const MIN_TEAM_CONTRAST = 1.7;

/** Team colours must stay visible as markers on light and dark surfaces. */
export function teamColorValidator(c: AbstractControl): ValidationErrors | null {
  const v = String(c.value ?? '');
  if (!HEX.test(v)) return { message: $localize`Use a hex colour like #3B82C4.` };
  const light = contrastRatio(v, SURFACES.light);
  const dark = contrastRatio(v, SURFACES.dark);
  if (light < MIN_TEAM_CONTRAST) return { message: $localize`Too light: it disappears on the light theme. Pick a darker colour.` };
  if (dark < MIN_TEAM_CONTRAST) return { message: $localize`Too dark: it disappears on the dark theme. Pick a lighter colour.` };
  return null;
}

function coordsValidator(c: AbstractControl): ValidationErrors | null {
  const v = String(c.value ?? '').trim();
  if (!v) return null;
  return parseLatLng(v) ? null : { message: $localize`Use "latitude, longitude".` };
}

// --- form ---------------------------------------------------------------------------

export type TeamForm = FormGroup<{
  name: FormControl<string>;
  color: FormControl<string>;
  pattern: FormControl<TeamPattern>;
  icon: FormControl<string>;
  capacity: FormControl<number>;
  allianceId: FormControl<string>;
  baseCoords: FormControl<string>;
}>;

export function createTeamForm(team: Partial<Team> = {}): TeamForm {
  const nn = <T>(v: T, validators: ((c: AbstractControl) => ValidationErrors | null)[] = []) => new FormControl<T>(v, { nonNullable: true, validators });
  const form: TeamForm = new FormGroup({
    name: nn('', [Validators.required, Validators.maxLength(40)]),
    color: nn(TEAM_COLORS[0], [Validators.required, teamColorValidator]),
    pattern: nn<TeamPattern>('solid'),
    icon: nn('shield'),
    capacity: nn(0, [Validators.required, Validators.min(0), Validators.max(1000), integerValidator]),
    allianceId: nn('', [Validators.maxLength(40)]),
    baseCoords: nn('', [coordsValidator]),
  });
  patchTeamForm(form, team);
  return form;
}

export function patchTeamForm(form: TeamForm, team: Partial<Team>): void {
  form.reset(
    {
      name: team.name ?? '',
      color: (team.color ?? TEAM_COLORS[0]).toUpperCase(),
      pattern: team.pattern ?? 'solid',
      icon: team.icon || 'shield',
      capacity: team.capacity ?? 0,
      allianceId: team.allianceId ?? '',
      baseCoords: team.baseLat != null && team.baseLng != null ? formatLatLng({ lat: team.baseLat, lng: team.baseLng }) : '',
    },
    { emitEvent: false },
  );
}

export function teamFormToInput(form: TeamForm, advanced: boolean): TeamInput {
  const v = form.getRawValue();
  const input: TeamInput = {
    name: v.name.trim(),
    color: v.color.toUpperCase(),
    pattern: v.pattern,
    icon: v.icon,
    capacity: Number(v.capacity),
  };
  if (advanced) {
    const base = parseLatLng(v.baseCoords);
    input.allianceId = v.allianceId.trim() || null;
    input.baseLat = base?.lat ?? null;
    input.baseLng = base?.lng ?? null;
  }
  return input;
}

/** Team identity fields with a live badge preview. */
@Component({
  selector: 'zeus-team-fields',
  imports: [ReactiveFormsModule, NgIcon, HlmInput, HlmLabel, TeamBadge, TeamSwatch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let f = form();
    <div [formGroup]="f" class="flex flex-col gap-4" [attr.data-rev]="tick()">
      <div class="flex items-center gap-2 rounded-sm border border-border bg-muted px-3 py-2" aria-live="polite">
        <span class="label-caps" i18n>Preview</span>
        <zeus-team-badge [team]="preview()" size="lg" />
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
        <div class="flex flex-col gap-1.5">
          <label hlmLabel [for]="id + '-name'" i18n>Team name</label>
          <input hlmInput [id]="id + '-name'" class="h-11" formControlName="name" autocomplete="off" [attr.aria-invalid]="!!err('name')" />
          @if (err('name'); as e) {
            <p class="field-error">{{ e }}</p>
          }
        </div>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel [for]="id + '-cap'" i18n>Capacity</label>
          <input hlmInput [id]="id + '-cap'" type="number" min="0" inputmode="numeric" class="num h-11" formControlName="capacity" [attr.aria-describedby]="id + '-cap-h'" [attr.aria-invalid]="!!err('capacity')" />
          @if (err('capacity'); as e) {
            <p class="field-error">{{ e }}</p>
          } @else {
            <p [id]="id + '-cap-h'" class="text-xs text-muted-foreground" i18n>0 = unlimited</p>
          }
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <span hlmLabel [id]="id + '-col-l'" i18n>Colour</span>
        <div role="radiogroup" [attr.aria-labelledby]="id + '-col-l'" class="flex flex-wrap gap-1.5">
          @for (c of colors; track c) {
            <label class="relative grid size-11 cursor-pointer place-items-center rounded-sm border-2 has-focus-visible:ring-2 has-focus-visible:ring-ring"
              [class]="isColor(c) ? 'border-foreground' : 'border-transparent'">
              <input type="radio" class="sr-only" [name]="id + '-color'" [checked]="isColor(c)" (change)="setColor(c)" ariaLabel="Colour {{ c }}" i18n-ariaLabel />
              <span class="size-8 rounded-sm" [style.background]="c" aria-hidden="true"></span>
              @if (isColor(c)) {
                <span class="absolute inset-0 grid place-items-center text-sm font-bold text-white [text-shadow:0_0_3px_#000]" aria-hidden="true">✓</span>
              }
            </label>
          }
        </div>
        <div class="flex items-center gap-2">
          <input type="color" class="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1" [value]="f.controls.color.value" (input)="setColor($any($event.target).value)" [attr.aria-label]="txt.pickACustomColour" />
          <label class="sr-only" [for]="id + '-hex'" i18n>Custom colour (hex)</label>
          <input hlmInput [id]="id + '-hex'" class="num h-11 max-w-36 uppercase" formControlName="color" maxlength="7" placeholder="#3B82C4" [attr.aria-invalid]="!!colorError()" [attr.aria-describedby]="id + '-hex-e'" />
        </div>
        @if (colorError(); as e) {
          <p [id]="id + '-hex-e'" class="field-error">{{ e }}</p>
        } @else if (clash()) {
          <p [id]="id + '-hex-e'" class="text-xs text-warning" i18n>◐ Same colour and pattern as {{ clash() }}. Change one so players can tell the teams apart.</p>
        }
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="flex flex-col gap-1.5">
          <span hlmLabel [id]="id + '-pat-l'" i18n>Pattern</span>
          <div role="radiogroup" [attr.aria-labelledby]="id + '-pat-l'" class="flex flex-wrap gap-1.5">
            @for (p of patterns; track p) {
              <label class="flex h-11 cursor-pointer items-center gap-1.5 rounded-sm border px-2 text-xs capitalize has-focus-visible:ring-2 has-focus-visible:ring-ring"
                [class]="f.controls.pattern.value === p ? 'border-primary bg-primary/10 font-semibold' : 'border-border'">
                <input type="radio" class="sr-only" [name]="id + '-pattern'" [checked]="f.controls.pattern.value === p" (change)="setPattern(p)" />
                <zeus-team-swatch [color]="f.controls.color.value" [pattern]="p" [size]="18" />
                {{ patternLabels[p] }}
              </label>
            }
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <span hlmLabel [id]="id + '-icon-l'" i18n>Icon</span>
          <div role="radiogroup" [attr.aria-labelledby]="id + '-icon-l'" class="flex flex-wrap gap-1.5">
            @for (i of icons; track i.value) {
              <label class="grid size-11 cursor-pointer place-items-center rounded-sm border has-focus-visible:ring-2 has-focus-visible:ring-ring"
                [class]="f.controls.icon.value === i.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'">
                <input type="radio" class="sr-only" [name]="id + '-icon'" [checked]="f.controls.icon.value === i.value" (change)="setIcon(i.value)" [attr.aria-label]="i.label" />
                <ng-icon [name]="i.icon" size="18" aria-hidden="true" />
              </label>
            }
          </div>
        </div>
      </div>

      @if (advanced()) {
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <label hlmLabel [for]="id + '-ally'" i18n>Alliance (optional)</label>
            <input hlmInput [id]="id + '-ally'" class="h-11" formControlName="allianceId" placeholder="north" autocomplete="off" [attr.aria-describedby]="id + '-ally-h'" i18n-placeholder />
            <p [id]="id + '-ally-h'" class="text-xs text-muted-foreground" i18n>Teams with the same alliance name are allies (see "Team + allies" in map visibility).</p>
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel [for]="id + '-base'" i18n>Base location (optional)</label>
            <input hlmInput [id]="id + '-base'" class="num h-11" formControlName="baseCoords" inputmode="decimal" placeholder="45.4642, 9.1900" [attr.aria-invalid]="!!err('baseCoords')" />
            @if (err('baseCoords'); as e) {
              <p class="field-error">{{ e }}</p>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class TeamFieldsComponent {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    pickACustomColour: $localize`Pick a custom colour`,
  };

  readonly form = input.required<TeamForm>();
  readonly advanced = input(false, { transform: booleanAttribute });
  /** Other teams, to warn about identical colour + pattern. */
  readonly others = input<Pick<Team, 'name' | 'color' | 'pattern'>[]>([]);

  protected readonly tick = formTick(() => this.form());
  protected readonly id = nextId('team');
  protected readonly colors = TEAM_COLORS;
  protected readonly patterns = TEAM_PATTERNS;
  protected readonly patternLabels = TEAM_PATTERN_LABELS;
  protected readonly icons = TEAM_ICONS;

  private readonly value = computed(() => {
    this.tick();
    return this.form().getRawValue();
  });
  protected readonly preview = computed(() => {
    const v = this.value();
    return { name: v.name || $localize`Team name`, color: HEX.test(v.color) ? v.color : '#888888', pattern: v.pattern, icon: v.icon };
  });
  protected readonly colorError = computed(() => {
    this.tick();
    return controlError(this.form().controls.color, { always: true });
  });
  protected readonly clash = computed(() => {
    const v = this.value();
    const t = this.others().find((o) => o.color.toUpperCase() === v.color.toUpperCase() && o.pattern === v.pattern);
    return t?.name ?? null;
  });

  protected err(name: keyof TeamForm['controls']): string | null {
    return controlError(this.form().controls[name]);
  }
  protected isColor(c: string): boolean {
    return this.value().color.toUpperCase() === c.toUpperCase();
  }
  protected setColor(c: string): void {
    const ctrl = this.form().controls.color;
    ctrl.setValue(c.toUpperCase());
    ctrl.markAsDirty();
  }
  protected setPattern(p: TeamPattern): void {
    this.form().controls.pattern.setValue(p);
    this.form().controls.pattern.markAsDirty();
  }
  protected setIcon(i: string): void {
    this.form().controls.icon.setValue(i);
    this.form().controls.icon.markAsDirty();
  }
}
