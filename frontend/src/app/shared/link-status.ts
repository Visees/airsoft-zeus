import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { LocationTracker, TrackerState } from '../core/location/location-tracker.service';
import { ConnectivityService, LinkState } from '../core/net/connectivity.service';
import { formatRelative } from '../core/util/format';
import { nowSignal } from './game-timer';

const LINK_STATE_LABELS: Record<LinkState, string> = {
  online: $localize`:connection|:online`,
  degraded: $localize`:connection|:reconnecting`,
  offline: $localize`:connection|:offline`,
};

const GPS_QUALITY_LABELS: Record<'good' | 'fair' | 'poor' | 'none', string> = {
  good: $localize`:GPS quality|:good`,
  fair: $localize`:GPS quality|:fair`,
  poor: $localize`:GPS quality|:poor`,
  none: $localize`:GPS quality|:no fix`,
};

const TRACKER_STATE_LABELS: Record<TrackerState, string> = {
  idle: $localize`:GPS state|:off`,
  requesting: $localize`:GPS state|:starting`,
  tracking: $localize`:GPS state|:tracking`,
  paused: $localize`:GPS state|:paused`,
  denied: $localize`:GPS state|:blocked`,
  unavailable: $localize`:GPS state|:not available`,
  error: $localize`:GPS state|:error`,
};

/** Connection indicator: online / reconnecting / offline + last sync time. */
@Component({
  selector: 'zeus-connection-status',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-1.5 text-xs font-semibold', role: 'status', '[attr.aria-label]': 'aria()' },
  template: `
    @switch (conn.state()) {
      @case ('online') {
        <ng-icon name="lucideWifi" size="14" class="text-primary" aria-hidden="true" />
        @if (!compact()) {
          <span i18n>Online</span>
        }
      }
      @case ('degraded') {
        <ng-icon name="lucideRefreshCw" size="14" class="text-warning" aria-hidden="true" />
        @if (!compact()) {
          <span class="text-warning" i18n>Reconnecting</span>
        }
      }
      @case ('offline') {
        <ng-icon name="lucideWifiOff" size="14" class="text-destructive" aria-hidden="true" />
        @if (!compact()) {
          <span class="text-destructive" i18n>Offline</span>
        }
      }
    }
    @if (showSync() && conn.state() !== 'online') {
      <span class="font-normal text-muted-foreground" i18n>· synced {{ synced() }}</span>
    }
  `,
})
export class ConnectionStatus {
  protected readonly conn = inject(ConnectivityService);
  readonly compact = input(false);
  readonly showSync = input(true);
  private readonly now = nowSignal(5000);
  protected readonly synced = computed(() => {
    this.now();
    const at = this.conn.lastSyncAt();
    return at ? formatRelative(new Date(at).toISOString()) : $localize`never`;
  });
  protected readonly aria = computed(() => $localize`Connection ${LINK_STATE_LABELS[this.conn.state()]}:state:, last synced ${this.synced()}:synced:`);
}

/** GPS indicator: accuracy in metres and quality glyph. */
@Component({
  selector: 'zeus-gps-status',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-1.5 text-xs font-semibold', role: 'status', '[attr.aria-label]': 'aria()' },
  template: `
    <ng-icon [name]="icon()" size="14" [class]="tone()" aria-hidden="true" />
    @switch (tracker.state()) {
      @case ('denied') {
        <span class="text-destructive" i18n>GPS blocked</span>
      }
      @case ('unavailable') {
        <span class="text-destructive" i18n>No GPS</span>
      }
      @default {
        @if (tracker.lastFix(); as fix) {
          <span class="num" [class]="tone()">±{{ fix.accuracy < 1000 ? fix.accuracy.toFixed(0) : '999+' }} m</span>
        } @else {
          <span class="text-muted-foreground" i18n>Waiting for GPS</span>
        }
      }
    }
    @if (showTracking() && tracker.isTracking()) {
      <span class="rounded-sm bg-nav/15 px-1 text-nav" i18n>Sharing</span>
    }
  `,
})
export class GpsStatus {
  protected readonly tracker = inject(LocationTracker);
  readonly showTracking = input(true);
  private readonly now = nowSignal(5000);

  protected readonly quality = computed(() => {
    this.now();
    return this.tracker.gpsQuality();
  });
  protected readonly icon = computed(() =>
    this.tracker.state() === 'denied' || this.quality() === 'none' ? 'lucideLocateOff' : 'lucideLocateFixed',
  );
  protected readonly tone = computed(() => {
    switch (this.quality()) {
      case 'good':
        return 'text-nav';
      case 'fair':
        return 'text-warning';
      case 'poor':
        return 'text-destructive';
      default:
        return 'text-muted-foreground';
    }
  });
  protected readonly aria = computed(() => {
    const fix = this.tracker.lastFix();
    return fix
      ? $localize`GPS ${GPS_QUALITY_LABELS[this.quality()]}:quality:, accuracy ${Math.round(fix.accuracy)}:accuracy: metres`
      : $localize`GPS ${TRACKER_STATE_LABELS[this.tracker.state()]}:state:`;
  });
}
