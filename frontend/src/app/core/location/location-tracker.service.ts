import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { ApiService } from '../api/api.service';
import { ApiError } from '../api/api-error';
import { GeofenceStatus, LocationReportResponse, LocationSample, TrackingSettings, Uuid } from '../api/models';
import { ConnectivityService } from '../net/connectivity.service';
import { distanceM } from '../util/geo';

export type TrackerState = 'idle' | 'requesting' | 'tracking' | 'paused' | 'denied' | 'unavailable' | 'error';

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

const MAX_QUEUE = 120;
const MAX_BATCH = 20;

/**
 * GPS tracking for the event the player is in.
 *
 * - Runs only after explicit consent and only while start() is active (the live screens
 *   start it when the event is live and stop it when the player leaves).
 * - Samples are filtered by minimum distance and sent every `intervalSec` in batches.
 * - When a send fails the samples stay queued and are retried with backoff; the server
 *   uses late samples for history only, never for geofence captures.
 * - Browsers stop GPS when the screen locks, so a Screen Wake Lock keeps it on while
 *   tracking. Background tracking needs the native wrapper (see README).
 */
@Injectable({ providedIn: 'root' })
export class LocationTracker {
  private readonly api = inject(ApiService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly state = signal<TrackerState>('idle');
  readonly eventId = signal<Uuid | null>(null);
  readonly lastFix = signal<Fix | null>(null);
  readonly geofence = signal<GeofenceStatus[]>([]);
  readonly lastFlags = signal<LocationReportResponse['flags']>([]);
  readonly lastSentAt = signal<number | null>(null);
  readonly pendingCount = signal(0);
  readonly lastError = signal<string | null>(null);
  /** Objective whose detail screen is open; required by some geofence objectives. */
  readonly screenObjectiveId = signal<Uuid | null>(null);
  readonly wakeLockActive = signal(false);

  readonly isTracking = computed(() => this.state() === 'tracking');
  /** good ≤ 15 m, fair ≤ max accuracy, poor above, none when no fix in 30 s */
  readonly gpsQuality = computed<'good' | 'fair' | 'poor' | 'none'>(() => {
    const fix = this.lastFix();
    if (!fix || Date.now() - fix.timestamp > 30_000) return 'none';
    if (fix.accuracy <= 15) return 'good';
    if (fix.accuracy <= (this.settings?.maxAccuracyM ?? 50)) return 'fair';
    return 'poor';
  });

  private settings: TrackingSettings | null = null;
  private watchId: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: LocationSample[] = [];
  private lastQueued: LocationSample | null = null;
  private backoffMs = 0;
  private sending = false;
  private wakeLock: WakeLockSentinel | null = null;

  /** Check the browser permission without prompting. */
  async permissionState(): Promise<PermissionState | 'unsupported'> {
    if (!this.isBrowser || !('geolocation' in navigator)) return 'unsupported';
    try {
      const res = await navigator.permissions.query({ name: 'geolocation' });
      return res.state;
    } catch {
      return 'prompt';
    }
  }

  /** Ask for permission by requesting one position. Resolves true when granted. */
  requestPermission(): Promise<boolean> {
    if (!this.isBrowser || !('geolocation' in navigator)) return Promise.resolve(false);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.onPosition(pos);
          resolve(true);
        },
        (err) => resolve(err.code !== err.PERMISSION_DENIED),
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 10_000 },
      );
    });
  }

  start(eventId: Uuid, settings: TrackingSettings): void {
    if (!this.isBrowser) return;
    if (!('geolocation' in navigator)) {
      this.state.set('unavailable');
      return;
    }
    if (this.eventId() === eventId && this.watchId !== null) {
      this.settings = settings;
      return;
    }
    this.stop(false);
    this.eventId.set(eventId);
    this.settings = settings;
    this.state.set('requesting');
    const highAccuracy = settings.highAccuracy && !settings.batterySaver;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (this.state() === 'requesting') this.state.set('tracking');
        this.onPosition(pos);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          this.state.set('denied');
          this.stop(false);
        } else {
          this.lastError.set(err.message || 'GPS unavailable');
          if (this.state() !== 'tracking') this.state.set('error');
        }
      },
      { enableHighAccuracy: highAccuracy, maximumAge: 2_000, timeout: 30_000 },
    );
    this.schedule(this.intervalMs());
    void this.acquireWakeLock();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Stop tracking. With notifyServer the server marks tracking inactive and hides the marker. */
  stop(notifyServer = true): void {
    const eventId = this.eventId();
    if (this.watchId !== null && this.isBrowser) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.isBrowser) document.removeEventListener('visibilitychange', this.onVisibility);
    void this.releaseWakeLock();
    if (notifyServer && eventId) void this.api.stopTracking(eventId).catch(() => undefined);
    this.queue = [];
    this.pendingCount.set(0);
    this.lastQueued = null;
    this.geofence.set([]);
    if (this.state() !== 'denied' && this.state() !== 'unavailable') this.state.set('idle');
    this.eventId.set(null);
  }

  /** Send immediately (e.g. when the objective screen opens). */
  flushNow(): void {
    if (this.timer) clearTimeout(this.timer);
    void this.flush();
  }

  private onPosition(pos: GeolocationPosition): void {
    const fix: Fix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      timestamp: pos.timestamp || Date.now(),
    };
    this.lastFix.set(fix);
    if (!this.settings || this.watchId === null) return;
    const sample: LocationSample = {
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      heading: fix.heading,
      speed: fix.speed,
      altitude: pos.coords.altitude,
      timestamp: fix.timestamp,
    };
    const last = this.lastQueued;
    const moved = last ? distanceM(last, sample) : Infinity;
    const elapsed = last ? sample.timestamp - last.timestamp : Infinity;
    // Always keep at least one sample per interval so the server knows we are alive.
    if (moved < (this.settings.minDistanceM ?? 0) && elapsed < this.intervalMs()) {
      // replace the newest queued sample with this fresher one
      if (this.queue.length) this.queue[this.queue.length - 1] = sample;
      return;
    }
    this.queue.push(sample);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    this.lastQueued = sample;
    this.pendingCount.set(this.queue.length);
  }

  private async flush(): Promise<void> {
    const eventId = this.eventId();
    if (!eventId || this.sending) return this.schedule(this.intervalMs());
    if (!this.queue.length) {
      // keep-alive: resend the last fix if it is recent
      const fix = this.lastFix();
      if (fix && Date.now() - fix.timestamp < this.intervalMs() * 2) {
        this.queue.push({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, heading: fix.heading, speed: fix.speed, timestamp: fix.timestamp });
      } else {
        return this.schedule(this.intervalMs());
      }
    }
    const batch = this.queue.slice(0, MAX_BATCH);
    this.sending = true;
    try {
      const res = await this.api.reportLocation(eventId, { samples: batch, screenObjectiveId: this.screenObjectiveId() });
      this.queue.splice(0, batch.length);
      this.pendingCount.set(this.queue.length);
      this.geofence.set(res.geofence);
      this.lastFlags.set(res.flags);
      this.lastSentAt.set(Date.now());
      this.lastError.set(null);
      this.backoffMs = 0;
      this.connectivity.markSynced();
      if (this.state() === 'paused') this.state.set('tracking');
    } catch (e) {
      const err = ApiError.from(e);
      this.lastError.set(err.message);
      if (err.code === 'tracking_paused' || err.code === 'not_live') {
        // Game paused or not running: drop queued samples, keep the GPS for the own marker.
        this.queue = [];
        this.pendingCount.set(0);
        this.state.set('paused');
      } else if (err.status === 400) {
        this.queue.splice(0, batch.length); // malformed batch, don't retry forever
      } else if (err.code === 'tracking_not_allowed' || err.status === 403 || err.status === 404) {
        this.stop(false);
        return;
      }
      this.backoffMs = Math.min(60_000, Math.max(2_000, this.backoffMs * 2 || 2_000));
    } finally {
      this.sending = false;
    }
    this.schedule(this.backoffMs || this.intervalMs());
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.watchId === null) return;
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private intervalMs(): number {
    const base = Math.max(3, this.settings?.intervalSec ?? 10) * 1000;
    return this.settings?.batterySaver ? base * 2 : base;
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible') {
      void this.acquireWakeLock();
      this.flushNow();
    }
  };

  private async acquireWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLockActive.set(true);
        this.wakeLock.addEventListener('release', () => this.wakeLockActive.set(false));
      }
    } catch {
      this.wakeLockActive.set(false);
    }
  }

  private async releaseWakeLock(): Promise<void> {
    try {
      await this.wakeLock?.release();
    } catch {
      /* ignore */
    }
    this.wakeLock = null;
    this.wakeLockActive.set(false);
  }
}
