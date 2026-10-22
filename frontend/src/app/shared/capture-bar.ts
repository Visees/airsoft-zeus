import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { GeofenceStatus, Objective } from '../core/api/models';
import { LocationTracker } from '../core/location/location-tracker.service';
import { formatClock } from '../core/util/format';
import { nowSignal } from './game-timer';

/** Can the viewer's team build up zone hold time on this objective (code/QR ones that need the zone count too)? */
export function zoneCanAccrue(o: Pick<Objective, 'canCapture' | 'blockedReason'> | null | undefined): boolean {
  return !!o && (o.canCapture || o.blockedReason === 'geofence_required');
}

/** Is the zone hold timer running right now, as far as the last server answer says? */
export function holdRunning(s: GeofenceStatus, canAccrue: boolean): boolean {
  return canAccrue && s.inside && !s.contested && !s.outnumbered && !s.blocked && !s.captured && !s.armed;
}

/**
 * Hold seconds now. The server only reports progress with each location report (every few
 * seconds), so while the hold is running we extrapolate from the last answer, up to one report
 * interval (`maxAheadMs`) ahead. If the next answer is late the bar waits there instead of
 * running on; it only goes back if the server really lost progress (player went silent).
 */
export function estimateHoldSec(s: GeofenceStatus, canAccrue: boolean, receivedAt: number, now: number, maxAheadMs: number): number {
  if (!holdRunning(s, canAccrue)) return s.progressSec;
  const ahead = Math.min(Math.max(0, now - receivedAt), maxAheadMs);
  return Math.min(s.requiredSec, s.progressSec + (ahead / 1000) * (s.multiplier > 0 ? s.multiplier : 1));
}

/** Live hold estimate for one objective, from the tracker's last answer. */
export function useHoldEstimate(status: () => GeofenceStatus | null, canAccrue: () => boolean) {
  const tracker = inject(LocationTracker);
  const now = nowSignal(500);
  return computed(() => {
    const s = status();
    if (!s) return 0;
    return estimateHoldSec(s, canAccrue(), tracker.geofenceAt(), now(), tracker.intervalMs());
  });
}

/** Is there a capture worth showing a bar for (in the zone, holding, or contested)? */
export function showCaptureBar(s: GeofenceStatus | null | undefined): s is GeofenceStatus {
  return !!s && !s.captured && (s.inside || s.progressSec > 0 || s.contested || s.armed);
}

/** Thin capture progress bar with a one-line state, for lists and map previews. */
@Component({
  selector: 'zeus-capture-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-1' },
  template: `
    <div class="flex items-center gap-2">
      <div
        class="h-2 flex-1 overflow-hidden rounded-sm bg-muted"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-valuenow]="pct()"
        [attr.aria-label]="'Zone capture ' + pct() + '%'"
      >
        <div class="h-full transition-[width] duration-500 ease-linear" [style.width.%]="pct()" [style.background]="color()"></div>
      </div>
      <span class="num w-10 text-right text-xs font-bold">{{ pct() }}%</span>
    </div>
    <p class="text-xs font-semibold" [class]="captionClass()">{{ caption() }}</p>
  `,
})
export class CaptureBar {
  readonly status = input.required<GeofenceStatus>();
  readonly canAccrue = input(true);

  private readonly held = useHoldEstimate(this.status, this.canAccrue);

  protected readonly pct = computed(() => {
    const s = this.status();
    if (s.armed) return 100;
    return s.requiredSec > 0 ? Math.min(100, Math.floor((this.held() / s.requiredSec) * 100)) : 0;
  });

  private readonly running = computed(() => holdRunning(this.status(), this.canAccrue()));

  protected readonly color = computed(() => {
    const s = this.status();
    if (s.contested || s.outnumbered) return 'var(--destructive)';
    return this.running() || s.armed ? 'var(--primary)' : 'var(--warning)';
  });

  protected readonly caption = computed(() => {
    const s = this.status();
    if (s.armed) return '✓ Zone held — enter the code';
    if (s.contested) return '▲ Contested — enemies in the zone';
    if (s.outnumbered) return '▲ Outnumbered — your team needs more players inside';
    if (s.blocked === 'low_accuracy') return '▲ GPS too imprecise to count';
    if (s.blocked === 'screen_closed') return '▲ Open the objective to hold the zone';
    if (s.blocked === 'confirming') return '◌ Confirming your position…';
    if (!s.inside) return '○ Outside the zone — paused';
    if (!this.canAccrue()) return 'Your team cannot capture this now';
    const mult = s.multiplier > 1 ? ` · ×${s.multiplier.toFixed(1)}` : '';
    return `● Holding · ${formatClock(((s.requiredSec - this.held()) / (s.multiplier > 0 ? s.multiplier : 1)) * 1000)} left${mult}`;
  });

  protected readonly captionClass = computed(() => {
    const s = this.status();
    if (s.contested || s.outnumbered) return 'text-destructive';
    return this.running() || s.armed ? 'text-primary' : 'text-warning';
  });
}
