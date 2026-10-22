import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmInput } from '@spartan-ng/helm/input';

export const PASSWORD_MIN = 10;

export interface PasswordHint {
  label: string;
  ok: boolean;
  required: boolean;
}

export function passwordHints(pw: string, avoid: string[] = []): PasswordHint[] {
  const lowered = pw.toLowerCase();
  const containsPersonal = avoid.some((a) => a && a.length >= 3 && lowered.includes(a.toLowerCase()));
  return [
    { label: $localize`At least ${PASSWORD_MIN}:PASSWORD_MIN: characters`, ok: pw.length >= PASSWORD_MIN, required: true },
    { label: $localize`Upper and lower case letters`, ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw), required: false },
    { label: $localize`A number`, ok: /\d/.test(pw), required: false },
    { label: $localize`A symbol, like ! ? # or a space`, ok: /[^A-Za-z0-9]/.test(pw), required: false },
    { label: $localize`Does not contain your email or nickname`, ok: pw.length > 0 && !containsPersonal, required: false },
  ];
}

/** 0 (empty) … 4 (strong) */
export function passwordScore(pw: string, avoid: string[] = []): number {
  if (!pw) return 0;
  const hints = passwordHints(pw, avoid);
  if (!hints[0].ok) return 1;
  const extras = hints.slice(1).filter((h) => h.ok).length + (pw.length >= 16 ? 1 : 0);
  return extras >= 4 ? 4 : extras >= 2 ? 3 : 2;
}

const SCORE_LABELS = ['', $localize`Too weak`, $localize`Fair`, $localize`Good`, $localize`Strong`];

/** Password input with a show/hide toggle. Bind a FormControl. */
@Component({
  selector: 'zeus-password-input',
  imports: [ReactiveFormsModule, HlmInput, NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative block' },
  template: `
    <input
      hlmInput
      class="h-11 pr-12"
      [type]="visible() ? 'text' : 'password'"
      [id]="inputId()"
      [formControl]="control()"
      [attr.autocomplete]="autocomplete()"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      [attr.aria-describedby]="describedBy()"
      autocapitalize="off"
      spellcheck="false"
    />
    <button
      type="button"
      class="tap absolute inset-y-0 right-0 grid place-items-center rounded-r-md text-muted-foreground hover:text-foreground"
      [attr.aria-label]="visible() ? txt.hidePassword : txt.showPassword"
      [attr.aria-pressed]="visible()"
      [attr.aria-controls]="inputId()"
      (click)="visible.set(!visible())"
    >
      <ng-icon [name]="visible() ? 'lucideEyeOff' : 'lucideEye'" size="18" aria-hidden="true" />
    </button>
  `,
})
export class PasswordInput {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    hidePassword: $localize`Hide password`,
    showPassword: $localize`Show password`,
  };

  readonly control = input.required<FormControl<string>>();
  readonly inputId = input.required<string>();
  readonly autocomplete = input<'current-password' | 'new-password'>('current-password');
  readonly invalid = input(false);
  readonly describedBy = input<string | null>(null);
  protected readonly visible = signal(false);
}

/** Strength meter + checklist under a new-password field. Not colour-only: label + ✓/○ glyphs. */
@Component({
  selector: 'zeus-password-strength',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mt-2 flex items-center gap-2" aria-hidden="true">
      <div class="grid flex-1 grid-cols-4 gap-1">
        @for (i of [1, 2, 3, 4]; track i) {
          <span
            class="h-1.5 rounded-full"
            [class.bg-muted]="score() < i"
            [class.bg-destructive]="score() >= i && score() === 1"
            [class.bg-warning]="score() >= i && score() === 2"
            [class.bg-primary]="score() >= i && score() >= 3"
          ></span>
        }
      </div>
      <span class="label-caps w-16 text-right">{{ scoreLabel() }}</span>
    </div>
    <ul class="mt-2 grid gap-1 text-sm sm:grid-cols-2" [attr.id]="listId()" aria-label="Password requirements" i18n-aria-label>
      @for (h of hints(); track h.label) {
        <li class="flex items-start gap-1.5" [class.text-muted-foreground]="!h.ok">
          <span aria-hidden="true" class="w-4 shrink-0 text-center" [class.text-primary]="h.ok">{{ h.ok ? '✓' : '○' }}</span>
          <span>{{ h.label }}@if (h.required) { <span class="text-xs" i18n> (required)</span> }</span>
          <span class="sr-only">{{ h.ok ? txt.done : txt.notYet }}</span>
        </li>
      }
    </ul>
    <p class="sr-only" aria-live="polite" i18n>Password strength: {{ scoreLabel() || txt.empty }}</p>
  `,
})
export class PasswordStrength {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    notYet: $localize`not yet`,
    done: $localize`done`,
    empty: $localize`:password strength|:empty`,
  };

  readonly password = input.required<string>();
  readonly avoid = input<string[]>([]);
  readonly listId = input<string | null>(null);

  protected readonly hints = computed(() => passwordHints(this.password(), this.avoid()));
  protected readonly score = computed(() => passwordScore(this.password(), this.avoid()));
  protected readonly scoreLabel = computed(() => SCORE_LABELS[this.score()]);
}
