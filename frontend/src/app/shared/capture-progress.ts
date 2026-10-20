import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { GeofenceStatus } from '../core/api/models';
import { formatClock, formatDistance } from '../core/util/format';
import { useHoldEstimate } from './capture-bar';

/**
 * Geofence capture progress ring: distance, inside/outside, progress, time left, contested.
 * Values come from the server's response to the last location report.
 */
@Component({
  selector: 'zeus-capture-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-center gap-4' },
  template: `
    <div class="relative size-28 shrink-0" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="pct()" [attr.aria-label]="'Capture progress ' + pct() + '%'">
      <svg viewBox="0 0 100 100" class="size-full -rotate-90">
        <circle cx="50" cy="50" r="44" fill="none" stroke="var(--muted)" stroke-width="9" />
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          [attr.stroke]="ringColor()"
          stroke-width="9"
          stroke-linecap="butt"
          [attr.stroke-dasharray]="circumference"
          [attr.stroke-dashoffset]="dashOffset()"
          class="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <div class="absolute inset-0 grid place-items-center text-center">
        <div>
          <div class="num text-2xl font-bold">{{ pct() }}%</div>
          @if (status()?.multiplier && status()!.multiplier > 1) {
            <div class="num text-xs text-primary">×{{ status()!.multiplier.toFixed(1) }}</div>
          }
        </div>
      </div>
    </div>
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt class="label-caps self-center">Zone</dt>
      <dd class="font-semibold" [class.text-primary]="status()?.inside" [class.text-muted-foreground]="!status()?.inside">
        @if (status()?.inside) {
          ● Inside
        } @else {
          ○ Outside
        }
      </dd>
      <dt class="label-caps self-center">Distance</dt>
      <dd class="num text-nav">{{ distance() }}</dd>
      <dt class="label-caps self-center">Time left</dt>
      <dd class="num">{{ timeLeft() }}</dd>
      @if (status()?.contested) {
        <dt class="label-caps self-center">State</dt>
        <dd class="font-semibold text-destructive">▲ Contested — enemies in zone</dd>
      } @else if (status()?.outnumbered) {
        <dt class="label-caps self-center">State</dt>
        <dd class="font-semibold text-destructive">▲ Outnumbered — your team needs more players inside</dd>
      }
      @if (status()?.armed) {
        <dt class="label-caps self-center">State</dt>
        <dd class="font-semibold text-primary">✓ Zone held — enter the code</dd>
      }
      @if (status()?.blocked === 'low_accuracy') {
        <dt class="label-caps self-center">GPS</dt>
        <dd class="font-semibold text-warning">
          ▲ Too imprecise — needs ±<span class="num">{{ status()!.maxAccuracyM }}</span> m or better. Move into the open and wait for a GPS fix.
        </dd>
      } @else if (status()?.blocked === 'screen_closed') {
        <dt class="label-caps self-center">State</dt>
        <dd class="font-semibold text-warning">▲ Keep this screen open to hold the zone</dd>
      }
    </dl>
  `,
})
export class CaptureProgress {
  readonly status = input<GeofenceStatus | null>(null);
  /** Can the viewer's team build hold time here (see zoneCanAccrue)? */
  readonly canAccrue = input(true);
  protected readonly circumference = 2 * Math.PI * 44;
  /** Hold seconds, extrapolated between location reports. */
  private readonly held = useHoldEstimate(this.status, this.canAccrue);

  protected readonly pct = computed(() => {
    const s = this.status();
    if (!s || s.requiredSec <= 0) return 0;
    if (s.armed) return 100;
    return Math.min(100, Math.floor((this.held() / s.requiredSec) * 100));
  });
  protected readonly dashOffset = computed(() => this.circumference * (1 - this.pct() / 100));
  protected readonly ringColor = computed(() => {
    const s = this.status();
    if (s?.contested || s?.outnumbered) return 'var(--destructive)';
    if (s?.inside) return 'var(--primary)';
    return 'var(--warning)';
  });
  protected readonly distance = computed(() => formatDistance(this.status()?.distanceM));
  protected readonly timeLeft = computed(() => {
    const s = this.status();
    if (!s) return '—';
    const mult = s.multiplier > 0 ? s.multiplier : 1;
    return formatClock(((s.requiredSec - this.held()) / mult) * 1000);
  });
}
