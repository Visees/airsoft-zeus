import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiService } from '../api/api.service';
import { LocationReportRequest, TrackingSettings } from '../api/models';
import { NativeLocation } from '../native/native-app';
import { ConnectivityService } from '../net/connectivity.service';
import { LocationTracker } from './location-tracker.service';

/** Fake Capacitor plugins: the test pushes background watcher fixes. */
const native = {
  watchers: [] as {
    id: string;
    options: Record<string, unknown>;
    cb: (loc?: unknown, err?: unknown) => void;
  }[],
  removed: [] as string[],
};

const fakeNativeLocation = {
  available: true,
  addWatcher: async (options: Record<string, unknown>, cb: (loc?: unknown, err?: unknown) => void) => {
    const id = `w${native.watchers.length}`;
    native.watchers.push({ id, options, cb });
    return id;
  },
  removeWatcher: async (id: string) => void native.removed.push(id),
  getCurrentPosition: async () => ({
    timestamp: Date.now(),
    coords: { latitude: 45.5, longitude: 9.2, accuracy: 6, heading: null, speed: null, altitude: null },
  }),
};

const settings = {
  intervalSec: 10,
  minDistanceM: 5,
  maxAccuracyM: 50,
  batterySaver: false,
  highAccuracy: true,
  maxSpeedMps: 12,
  background: true,
} as TrackingSettings;

function push(t: number, simulated = false, watcher = native.watchers.at(-1)!) {
  watcher.cb({
    latitude: 45.5,
    longitude: 9.2,
    accuracy: 6,
    altitude: null,
    altitudeAccuracy: null,
    simulated,
    bearing: null,
    speed: null,
    time: t,
  });
}

describe('LocationTracker in the app', () => {
  let sent: { at: number; body: LocationReportRequest }[];
  let wakeLocks: number;

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    native.watchers = [];
    native.removed = [];
    sent = [];
    wakeLocks = 0;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(navigator, 'wakeLock', {
      value: {
        request: async () => (
          wakeLocks++,
          { release: async () => undefined, addEventListener: () => undefined }
        ),
      },
      configurable: true,
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: NativeLocation, useValue: fakeNativeLocation },
        { provide: ConnectivityService, useValue: { markSynced: () => undefined } },
        {
          provide: ApiService,
          useValue: {
            reportLocation: async (_id: string, body: LocationReportRequest) => {
              sent.push({ at: Date.now(), body });
              return {
                accepted: body.samples.length,
                rejected: 0,
                flags: [],
                geofence: [],
                serverNow: '',
              };
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

  it('tracks with the background watcher and its notification, without a wake lock', async () => {
    const tracker = TestBed.inject(LocationTracker);
    tracker.start('ev', settings);
    await vi.advanceTimersByTimeAsync(0);
    expect(native.watchers).toHaveLength(1);
    expect(native.watchers[0].options['backgroundMessage']).toBeTruthy();
    for (let i = 0; i < 60; i++) {
      push(Date.now());
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(sent.length).toBe(3);
    expect(tracker.state()).toBe('tracking');
    expect(tracker.backgroundTracking()).toBe(true);
    expect(wakeLocks).toBe(0);
  });

  it('sends a report the WebView held back with the next fix', async () => {
    TestBed.inject(LocationTracker).start('ev', settings);
    await vi.advanceTimersByTimeAsync(0);
    push(Date.now());
    vi.setSystemTime(Date.now() + 25_000); // screen off: time passes, the 10 s timer doesn't fire
    push(Date.now(), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.samples.at(-1)?.isMocked).toBe(true);
  });

  it('without the background setting tracks in the foreground and keeps the screen awake', async () => {
    const tracker = TestBed.inject(LocationTracker);
    tracker.start('ev', { ...settings, background: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.watchers[0].options['backgroundMessage']).toBeUndefined();
    expect(tracker.backgroundTracking()).toBe(false);
    expect(wakeLocks).toBe(1);
  });

  it('restarts the watcher when the GM turns background tracking on mid-game', async () => {
    const tracker = TestBed.inject(LocationTracker);
    tracker.start('ev', { ...settings, background: false });
    await vi.advanceTimersByTimeAsync(0);
    tracker.start('ev', settings);
    await vi.advanceTimersByTimeAsync(0);
    expect(native.removed).toEqual(['w0']);
    expect(native.watchers).toHaveLength(2);
    expect(native.watchers[1].options['backgroundMessage']).toBeTruthy();
    const old = native.watchers[0];
    push(Date.now() + 1, false, old); // a removed watcher can still deliver
    expect(tracker.lastFix()).toBeNull();
  });

  it('stops with "denied" when the OS refuses location', async () => {
    const tracker = TestBed.inject(LocationTracker);
    tracker.start('ev', settings);
    await vi.advanceTimersByTimeAsync(0);
    native.watchers[0].cb(undefined, { code: 'NOT_AUTHORIZED', message: 'Permission denied.' });
    await vi.advanceTimersByTimeAsync(0);
    expect(tracker.state()).toBe('denied');
    expect(native.removed).toEqual(['w0']);
  });
});
