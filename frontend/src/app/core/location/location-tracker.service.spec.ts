import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiService } from '../api/api.service';
import { LocationReportRequest, TrackingSettings } from '../api/models';
import { ConnectivityService } from '../net/connectivity.service';
import { LocationTracker } from './location-tracker.service';

const settings = { intervalSec: 10, minDistanceM: 5, maxAccuracyM: 50, batterySaver: false, highAccuracy: true, maxSpeedMps: 12 } as TrackingSettings;

/** Fake browser GPS: the test pushes watch fixes; getCurrentPosition answers after `fixDelayMs`. */
function fakeGeolocation() {
  let watch: ((p: GeolocationPosition) => void) | null = null;
  const geo = {
    current: 0,
    fixDelayMs: 1000,
    push(t: number, lat = 45.5) {
      watch?.({ coords: { latitude: lat, longitude: 9.2, accuracy: 6, heading: null, speed: null, altitude: null }, timestamp: t } as unknown as GeolocationPosition);
    },
    api: {
      watchPosition: (ok: (p: GeolocationPosition) => void) => ((watch = ok), 1),
      clearWatch: () => (watch = null),
      getCurrentPosition: (ok: (p: GeolocationPosition) => void) => {
        geo.current++;
        setTimeout(() => ok({ coords: { latitude: 45.5, longitude: 9.2, accuracy: 6, heading: null, speed: null, altitude: null }, timestamp: Date.now() } as unknown as GeolocationPosition), geo.fixDelayMs);
      },
    },
  };
  return geo;
}

describe('LocationTracker', () => {
  let geo: ReturnType<typeof fakeGeolocation>;
  let sent: { at: number; body: LocationReportRequest }[];
  let reply: (body: LocationReportRequest) => Promise<unknown>;

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    geo = fakeGeolocation();
    Object.defineProperty(navigator, 'geolocation', { value: geo.api, configurable: true });
    sent = [];
    reply = async () => ({ accepted: 1, rejected: 0, flags: [], geofence: [], serverNow: '' });
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ConnectivityService, useValue: { markSynced: () => undefined } },
        {
          provide: ApiService,
          useValue: {
            reportLocation: (_id: string, body: LocationReportRequest) => {
              sent.push({ at: Date.now(), body });
              return reply(body);
            },
            stopTracking: async () => ({ ok: true }),
          },
        },
      ],
    });
  });
  afterEach(() => {
    TestBed.inject(LocationTracker).stop(false);
    vi.useRealTimers();
  });

  it('a standing phone with a live watch sends a watch fix each report, without asking for a fresh one', async () => {
    const tracker = TestBed.inject(LocationTracker);
    tracker.start('ev', settings);
    for (let i = 0; i < 60; i++) {
      geo.push(Date.now()); // 2 Hz, same spot
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(sent.length).toBe(3);
    expect(geo.current).toBe(0);
    for (const s of sent) expect(s.body.samples).toHaveLength(1);
  });

  it('keeps a 10 s rhythm even when the GPS and the network are slow', async () => {
    geo.fixDelayMs = 6000; // watch silent (iOS standing still): each report waits for a fresh fix
    reply = (b) => new Promise((r) => setTimeout(() => r({ accepted: b.samples.length, rejected: 0, flags: [], geofence: [], serverNow: '' }), 3000));
    const tracker = TestBed.inject(LocationTracker);
    tracker.start('ev', settings);
    await vi.advanceTimersByTimeAsync(65_000);
    const gaps = sent.slice(1).map((s, i) => s.at - sent[i].at);
    expect(gaps.length).toBeGreaterThanOrEqual(4);
    for (const g of gaps) expect(g).toBe(10_000);
  });

  it('retries at the normal rhythm while the game is paused, and resumes right away', async () => {
    let paused = true;
    reply = async () => {
      if (paused) throw new HttpErrorResponse({ status: 412, error: { error: { code: 'tracking_paused', message: 'paused' } } });
      return { accepted: 1, rejected: 0, flags: [], geofence: [], serverNow: '' };
    };
    const tracker = TestBed.inject(LocationTracker);
    tracker.start('ev', settings);
    geo.push(Date.now());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(tracker.state()).toBe('paused');
    const attempts = sent.length;
    expect(attempts).toBeGreaterThanOrEqual(11); // every 10 s, no growing backoff
    paused = false;
    await vi.advanceTimersByTimeAsync(11_000);
    expect(tracker.state()).toBe('tracking');
  });

  it('a hung request times out in the API layer and the next report still goes out', async () => {
    let first = true;
    reply = (b) => {
      if (first) {
        first = false;
        return Promise.reject(new HttpErrorResponse({ status: 0 })); // what the 8 s timeout turns into
      }
      return Promise.resolve({ accepted: b.samples.length, rejected: 0, flags: [], geofence: [], serverNow: '' });
    };
    const tracker = TestBed.inject(LocationTracker);
    tracker.start('ev', settings);
    geo.push(Date.now());
    await vi.advanceTimersByTimeAsync(10_000 + 2_500);
    expect(sent.length).toBe(2); // failed at 10 s, retried 2 s later
    expect(tracker.pendingCount()).toBe(0);
  });

  it('recovers from a GPS error to "tracking" when fixes start arriving', async () => {
    let fail: ((e: GeolocationPositionError) => void) | null = null;
    const watch = geo.api.watchPosition;
    geo.api.watchPosition = (ok: (p: GeolocationPosition) => void, err?: (e: GeolocationPositionError) => void) => ((fail = err ?? null), watch(ok));
    const tracker = TestBed.inject(LocationTracker);
    tracker.start('ev', settings);
    fail!({ code: 3, message: 'Timeout expired', PERMISSION_DENIED: 1 } as GeolocationPositionError);
    expect(tracker.state()).toBe('error');
    geo.push(Date.now());
    expect(tracker.state()).toBe('tracking');
  });

  it('ignores a late answer for an event it no longer tracks', async () => {
    reply = (b) => new Promise((r) => setTimeout(() => r({ accepted: b.samples.length, rejected: 0, flags: [], geofence: [{ objectiveId: 'old' }], serverNow: '' }), 5000));
    const tracker = TestBed.inject(LocationTracker);
    tracker.start('ev', settings);
    geo.push(Date.now());
    await vi.advanceTimersByTimeAsync(10_500); // report for 'ev' in flight
    tracker.start('ev2', settings);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tracker.eventId()).toBe('ev2');
    expect(tracker.geofence()).toEqual([]);
  });
});
