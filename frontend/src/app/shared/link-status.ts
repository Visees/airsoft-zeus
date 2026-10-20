import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { LocationTracker } from '../core/location/location-tracker.service';
import { ConnectivityService } from '../core/net/connectivity.service';
import { formatRelative } from '../core/util/format';
import { nowSignal } from './game-timer';

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
          <span>Online</span>
        }
      }
      @case ('degraded') {
        <ng-icon name="lucideRefreshCw" size="14" class="text-warning" aria-hidden="true" />
        @if (!compact()) {
          <span class="text-warning">Reconnecting</span>
        }
      }
      @case ('offline') {
        <ng-icon name="lucideWifiOff" size="14" class="text-destructive" aria-hidden="true" />
        @if (!compact()) {
          <span class="text-destructive">Offline</span>
        }
      }
    }
    @if (showSync() && conn.state() !== 'online') {
      <span class="font-normal text-muted-foreground">· synced {{ synced() }}</span>
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
    return at ? formatRelative(new Date(at).toISOString()) : 'never';
  });
  protected readonly aria = computed(() => `Connection ${this.conn.state()}, last synced ${this.synced()}`);
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
        <span class="text-destructive">GPS blocked</span>
      }
      @case ('unavailable') {
        <span class="text-destructive">No GPS</span>
      }
      @default {
        @if (tracker.lastFix(); as fix) {
          <span class="num" [class]="tone()">±{{ fix.accuracy < 1000 ? fix.accuracy.toFixed(0) : '999+' }} m</span>
        } @else {
          <span class="text-muted-foreground">Waiting for GPS</span>
        }
      }
    }
    @if (showTracking() && tracker.isTracking()) {
      <span class="rounded-sm bg-nav/15 px-1 text-nav">Sharing</span>
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
    return fix ? `GPS ${this.quality()}, accuracy ${Math.round(fix.accuracy)} metres` : `GPS ${this.tracker.state()}`;
  });
}
