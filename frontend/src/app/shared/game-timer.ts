import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, PLATFORM_ID, computed, inject, input, signal } from '@angular/core';
import { GameClock } from '../core/api/models';
import { formatClock } from '../core/util/format';

/** A signal that ticks every second (browser only). */
export function nowSignal(intervalMs = 1000) {
  const now = signal(Date.now());
  if (isPlatformBrowser(inject(PLATFORM_ID))) {
    const id = setInterval(() => now.set(Date.now()), intervalMs);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }
  return now;
}

/**
 * Game clock. Live: time remaining until endsAt (or elapsed when there is no end).
 * Paused: frozen remaining time with a PAUSED tag. Before start: countdown to `startAt`.
 */
@Component({
  selector: 'ah-game-timer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClass()', role: 'timer', '[attr.aria-label]': 'ariaLabel()' },
  template: `
    @if (caption()) {
      <span class="label-caps" [class.!text-warning]="mode() === 'paused'">{{ caption() }}</span>
    }
    <span
      class="num font-bold tabular-nums"
      [class.text-3xl]="size() === 'lg'"
      [class.text-xl]="size() === 'md'"
      [class.text-base]="size() === 'sm'"
      [class.leading-none]="stacked()"
      [class.text-warning]="warn()"
      [class.text-destructive]="critical()"
      aria-hidden="true"
      >{{ display() }}</span
    >
  `,
})
export class GameTimer {
  readonly clock = input<GameClock | null>(null);
  /** Planned start, used for the pre-game countdown. */
  readonly startAt = input<string | null>(null);
  readonly serverOffsetMs = input(0);
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly showCaption = input(true);
  /** Caption above the digits, to leave room beside a 1:00:00+ clock on a narrow bar; one line in compact (phone sideways). */
  readonly stacked = input(false);

  protected readonly hostClass = computed(() =>
    this.stacked() ? 'inline-flex flex-col items-start gap-0.5 leading-none compact:flex-row compact:items-center compact:gap-2' : 'inline-flex items-center gap-2',
  );

  private readonly now = nowSignal();
  private readonly serverNow = computed(() => this.now() + this.serverOffsetMs());

  protected readonly mode = computed<'countdown' | 'live' | 'paused' | 'ended' | 'idle'>(() => {
    const c = this.clock();
    if (!c) return this.startAt() ? 'countdown' : 'idle';
    if (c.status === 'live') return 'live';
    if (c.status === 'paused') return 'paused';
    if (c.status === 'completed' || c.status === 'cancelled') return 'ended';
    return this.startAt() ? 'countdown' : 'idle';
  });

  private readonly remainingMs = computed<number | null>(() => {
    const c = this.clock();
    const mode = this.mode();
    if (mode === 'countdown') return new Date(this.startAt()!).getTime() - this.serverNow();
    if (!c?.endsAt) return null;
    const end = new Date(c.endsAt).getTime();
    if (mode === 'paused' && c.pausedAt) return end - new Date(c.pausedAt).getTime();
    if (mode === 'live') return end - this.serverNow();
    return 0;
  });

  private readonly elapsedMs = computed(() => {
    const c = this.clock();
    if (!c?.startedAt) return 0;
    const ref = c.pausedAt ? new Date(c.pausedAt).getTime() : c.endedAt ? new Date(c.endedAt).getTime() : this.serverNow();
    return ref - new Date(c.startedAt).getTime() - c.pausedTotalMs;
  });

  protected readonly display = computed(() => {
    const mode = this.mode();
    if (mode === 'idle') return '--:--';
    if (mode === 'ended') return formatClock(this.elapsedMs());
    const rem = this.remainingMs();
    return rem === null ? formatClock(this.elapsedMs()) : formatClock(Math.max(0, rem));
  });

  protected readonly caption = computed(() => {
    if (!this.showCaption()) return '';
    switch (this.mode()) {
      case 'countdown':
        return $localize`Starts in`;
      case 'paused':
        return $localize`Paused`;
      case 'ended':
        return $localize`Played`;
      case 'live':
        return this.remainingMs() === null ? $localize`Elapsed` : $localize`Remaining`;
      default:
        return '';
    }
  });

  protected readonly warn = computed(() => {
    const rem = this.remainingMs();
    return this.mode() === 'live' && rem !== null && rem < 10 * 60_000 && rem >= 2 * 60_000;
  });
  protected readonly critical = computed(() => {
    const rem = this.remainingMs();
    return this.mode() === 'live' && rem !== null && rem < 2 * 60_000;
  });

  protected readonly ariaLabel = computed(() => `${this.caption() || 'Game time'} ${this.display()}`);
}
