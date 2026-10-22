import { ChangeDetectionStrategy, Component, DestroyRef, WritableSignal, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { ApiService } from '../../core/api/api.service';

export const NICKNAME_PATTERN = /^[A-Za-z0-9_.-]{3,24}$/;
export const NICKNAME_FORMAT_HELP = $localize`3–24 characters: letters, numbers, dot, dash or underscore. No spaces.`;

export type NicknameStatus = 'empty' | 'invalid' | 'unchanged' | 'checking' | 'available' | 'taken' | 'error';

export interface NicknameCheck {
  status: WritableSignal<NicknameStatus>;
  reason: WritableSignal<string | null>;
}

/**
 * Live availability check for a nickname control (debounced). Call in an injection context.
 * `current` is the user's present nickname: typing it again reports 'unchanged' instead of 'taken'.
 */
export function createNicknameCheck(control: FormControl<string>, current: () => string | null = () => null, debounceMs = 450): NicknameCheck {
  const api = inject(ApiService);
  const destroyRef = inject(DestroyRef);
  const status = signal<NicknameStatus>('empty');
  const reason = signal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;

  const run = (raw: string) => {
    const value = raw.trim();
    if (timer) clearTimeout(timer);
    const mine = ++seq;
    reason.set(null);
    if (!value) return status.set('empty');
    if (!NICKNAME_PATTERN.test(value)) return status.set('invalid');
    if (current() && value.toLowerCase() === current()!.toLowerCase()) return status.set('unchanged');
    status.set('checking');
    timer = setTimeout(async () => {
      try {
        const res = await api.nicknameAvailable(value);
        if (mine !== seq) return;
        status.set(res.available ? 'available' : 'taken');
        reason.set(res.reason);
      } catch {
        if (mine !== seq) return;
        status.set('error');
      }
    }, debounceMs);
  };

  control.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe((v) => run(v ?? ''));
  destroyRef.onDestroy(() => timer && clearTimeout(timer));
  run(control.value ?? '');
  return { status, reason };
}

/** Status line under the nickname field (polite live region). */
@Component({
  selector: 'zeus-nickname-status',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-1.5 flex min-h-5 items-center gap-1.5 text-sm', 'aria-live': 'polite' },
  template: `
    @switch (status()) {
      @case ('checking') {
        <ng-icon name="lucideLoader2" size="14" class="animate-spin text-muted-foreground" aria-hidden="true" />
        <span class="text-muted-foreground" i18n>Checking availability…</span>
      }
      @case ('available') {
        <span aria-hidden="true" class="text-primary">✓</span>
        <span class="text-primary" i18n>Available</span>
      }
      @case ('taken') {
        <span aria-hidden="true" class="text-destructive">✕</span>
        <span class="text-destructive">{{ reason() || txt.alreadyTakenTryAnother }}</span>
      }
      @case ('invalid') {
        <span aria-hidden="true" class="text-warning">!</span>
        <span class="text-muted-foreground">{{ formatHelp }}</span>
      }
      @case ('unchanged') {
        <span class="text-muted-foreground" i18n>This is your current nickname.</span>
      }
      @case ('error') {
        <span class="text-muted-foreground" i18n>Could not check availability right now. It will be checked when you save.</span>
      }
    }
  `,
})
export class NicknameStatusLine {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    alreadyTakenTryAnother: $localize`Already taken. Try another one.`,
  };

  readonly status = input.required<NicknameStatus>();
  readonly reason = input<string | null>(null);
  protected readonly formatHelp = NICKNAME_FORMAT_HELP;
}
