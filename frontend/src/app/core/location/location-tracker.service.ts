import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { ApiService } from '../api/api.service';
import { ApiError } from '../api/api-error';
import { GeofenceStatus, LocationReportResponse, LocationSample, TrackingSettings, Uuid } from '../api/models';
import { ConnectivityService } from '../net/connectivity.service';
import { distanceM } from '../util/geo';
import { OutlierFilter, PositionSmoother } from './fix-filter';

export type TrackerState = 'idle' | 'requesting' | 'tracking' | 'paused' | 'denied' | 'unavailable' | 'error';

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

function iosWithoutWakeLock(): boolean {
  const m = /(?:iPhone|iPad|iPod).* OS (\d+)_(\d+)/.exec(navigator.userAgent);
  if (!m) return false;
  const version = Number(m[1]) + Number(m[2]) / 100;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  return version < 16.04 || (standalone && version < 18.04);
}

const MAX_QUEUE = 120;
const MAX_BATCH = 20;

/**
 * GPS tracking for the event the player is in.
 *
 * - Runs only after explicit consent and only while start() is active (the live screens
 *   start it when the event is live and stop it when the player leaves).
 * - Outlier fixes (coarse network fixes, impossible jumps) are dropped; the own marker shows a
 *   smoothed position. Samples are filtered by minimum distance and sent every `intervalSec` in batches.
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
  /** When `geofence` was last received (ms); capture bars extrapolate progress from it. */
  readonly geofenceAt = signal(0);
  readonly lastFlags = signal<LocationReportResponse['flags']>([]);
  readonly lastSentAt = signal<number | null>(null);
  readonly pendingCount = signal(0);
  readonly lastError = signal<string | null>(null);
  /** Objective whose detail screen is open; required by some geofence objectives. */
  readonly screenObjectiveId = signal<Uuid | null>(null);
  readonly wakeLockActive = signal(false);
  /**
   * iPhones where the app can't keep the screen on: no Screen Wake Lock before iOS 16.4, and in a
   * Home Screen app it silently fails until 18.4 (WebKit bug 254545). A locked screen stops GPS, so
   * these players must turn Auto-Lock off themselves.
   */
  readonly wakeLockUnreliable = this.isBrowser && iosWithoutWakeLock();

  readonly isTracking = computed(() => this.state() === 'tracking');
  /** Ticks every 5 s so time-based states (no recent fix) update without a new fix. */
  private readonly clock = signal(Date.now());
  /** good ≤ 15 m, fair ≤ max accuracy, poor above, none when no fix in 30 s */
  readonly gpsQuality = computed<'good' | 'fair' | 'poor' | 'none'>(() => {
    const fix = this.lastFix();
    if (!fix || this.clock() - fix.timestamp > 30_000) return 'none';
    if (fix.accuracy <= 15) return 'good';
    if (fix.accuracy <= (this.settings?.maxAccuracyM ?? 50)) return 'fair';
    return 'poor';
  });
  /**
   * The fix is kilometres wide: on Android this is almost always the "approximate location"
   * permission (the OS blurs it to ±2000 m) or Google Location Accuracy turned off, not bad signal.
   * Waiting in the open does not help; the player must change a phone setting.
   */
  readonly approximateOnly = computed(() => this.gpsQuality() === 'poor' && (this.lastFix()?.accuracy ?? 0) >= 1000);

  private settings: TrackingSettings | null = null;
  private watchId: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: LocationSample[] = [];
  private lastQueued: LocationSample | null = null;
  private backoffMs = 0;
  private sending = false;
  private wakeLock: WakeLockSentinel | null = null;
  private outliers = new OutlierFilter();
  private smoother = new PositionSmoother();

  constructor() {
    if (this.isBrowser) setInterval(() => this.clock.set(Date.now()), 5_000);
  }

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
        // Timeout / position unavailable: permission may still be granted; ask the Permissions API.
        (err) => (err.code === err.PERMISSION_DENIED ? resolve(false) : void this.permissionState().then((st) => resolve(st === 'granted'))),
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
    this.outliers = new OutlierFilter(settings.maxSpeedMps);
    this.smoother = new PositionSmoother();
    this.state.set('requesting');
    // Battery saver only stretches the interval: without high accuracy Android answers with Wi-Fi/cell
    // estimates, kilometres wide outdoors, and no zone can count the player.
    const highAccuracy = settings.highAccuracy;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        // 'error' too: a first fix slower than the timeout (cold start under trees) reports an error, then fixes arrive
        if (this.state() === 'requesting' || this.state() === 'error') this.state.set('tracking');
        this.onPosition(pos);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          this.state.set('denied');
          this.stop(false);
        } else {
          this.lastError.set(err.message || $localize`GPS unavailable`);
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

  private toSample(pos: GeolocationPosition): LocationSample {
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      altitude: pos.coords.altitude,
      // whole ms: the server only accepts integers (WebKit builds it from a seconds double)
      timestamp: Math.round(pos.timestamp || Date.now()),
    };
  }

  /** One fresh fix, or null on error/timeout. */
  private currentPosition(): Promise<GeolocationPosition | null> {
    const s = this.settings;
    return new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
        enableHighAccuracy: !!s?.highAccuracy,
        maximumAge: 1_000,
        timeout: Math.min(10_000, this.intervalMs()),
      }),
    );
  }

  /** Queue a fix from getCurrentPosition (no distance filter; only newer than the last queued one). */
  private queueSample(sample: LocationSample): void {
    if (!this.outliers.accept(sample)) return;
    this.showFix(sample);
    if (this.lastQueued && sample.timestamp <= this.lastQueued.timestamp) return;
    this.queue.push(sample);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    this.lastQueued = sample;
    this.pendingCount.set(this.queue.length);
  }

  /** The marker shows the smoothed position; accuracy stays the device's, since that is what the server judges. */
  private showFix(sample: LocationSample): void {
    const { lat, lng } = this.smoother.next(sample);
    this.lastFix.set({ lat, lng, accuracy: sample.accuracy, heading: sample.heading ?? null, speed: sample.speed ?? null, timestamp: sample.timestamp });
  }

  private onPosition(pos: GeolocationPosition): void {
    const sample = this.toSample(pos);
    if (!this.outliers.accept(sample)) return;
    this.showFix(sample);
    if (!this.settings || this.watchId === null) return;
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
    this.sending = true;
    // Reports go out on a fixed rhythm (start to start): a slow GPS fix or request must not push the
    // next report later, or the server stops counting a player who is standing in a zone.
    const startedAt = Date.now();
    if (!this.queue.length) {
      // A phone standing still often gets no watchPosition callbacks, and resending the last fix is
      // useless (the server drops samples whose timestamp is not newer). Ask for a fresh fix, so a
      // player holding a zone keeps reporting.
      const pos = await this.currentPosition();
      if (pos && this.eventId() === eventId) this.queueSample(this.toSample(pos));
      if (!this.queue.length) {
        this.sending = false;
        return this.scheduleFrom(startedAt, this.intervalMs());
      }
    }
    const batch = this.queue.slice(0, MAX_BATCH);
    try {
      const res = await this.api.reportLocation(eventId, { samples: batch, screenObjectiveId: this.screenObjectiveId(), sentAt: Date.now() });
      if (this.eventId() !== eventId) return; // stopped or switched event meanwhile: this answer is stale
      this.queue.splice(0, batch.length);
      this.pendingCount.set(this.queue.length);
      this.geofence.set(res.geofence);
      this.geofenceAt.set(Date.now());
      this.lastFlags.set(res.flags);
      this.lastSentAt.set(Date.now());
      this.lastError.set(null);
      this.backoffMs = 0;
      this.connectivity.markSynced();
      if (this.state() === 'paused') this.state.set('tracking');
    } catch (e) {
      if (this.eventId() !== eventId) return;
      const err = ApiError.from(e);
      this.lastError.set(err.message);
      if (err.code === 'tracking_paused' || err.code === 'not_live') {
        // Game paused or not running: drop queued samples, keep the GPS for the own marker, and keep
        // asking at the normal rhythm (no growing backoff) so reports resume as soon as the GM resumes.
        this.queue = [];
        this.pendingCount.set(0);
        this.state.set('paused');
        this.backoffMs = 0;
      } else {
        if (err.status === 400) {
          this.queue.splice(0, batch.length); // malformed batch, don't retry forever
        } else if (err.code === 'tracking_not_allowed' || err.status === 403 || err.status === 404) {
          this.stop(false);
          return;
        }
        this.backoffMs = Math.min(60_000, Math.max(2_000, this.backoffMs * 2 || 2_000));
      }
    } finally {
      this.sending = false;
    }
    this.scheduleFrom(startedAt, this.backoffMs || this.intervalMs());
  }

  private scheduleFrom(startedAt: number, ms: number): void {
    this.schedule(Math.max(0, startedAt + ms - Date.now()));
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.watchId === null) return;
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  /** Expected time between location reports. */
  intervalMs(): number {
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
