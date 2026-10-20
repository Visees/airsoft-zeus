import { distanceM } from '../lib/geo.js';
import type { Tracking } from './defaults.js';

export type SampleFlag = 'future_timestamp' | 'too_old' | 'low_accuracy' | 'speed' | 'mock' | 'stale';

export interface InSample {
  lat: number;
  lng: number;
  accuracy: number;
  speed?: number | null;
  heading?: number | null;
  altitude?: number | null;
  timestamp: number;
  isMocked?: boolean;
}

export interface Accepted {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  t: number;
  lowAccuracy: boolean;
}

export interface ValidationResult {
  accepted: Accepted[];
  rejected: number;
  flags: SampleFlag[];
  /** Flags that should raise a GM alert (possible spoofing). */
  suspicious: { flag: 'speed' | 'mock' | 'future_timestamp'; detail: string }[];
  /** The newest accepted sample is recent enough to count for geofence captures. */
  fresh: boolean;
}

const FUTURE_TOLERANCE_MS = 15_000;
const MAX_AGE_MS = 15 * 60_000;
export const FRESH_MS = 30_000;

/**
 * Validate a batch of device samples against the previous accepted position.
 * - timestamps must be plausible relative to server time
 * - impossible speeds (teleports) are rejected, allowing for GPS accuracy
 * - mock locations reported by the device are rejected
 */
export function validateSamples(prev: { lat: number; lng: number; accuracy: number; t: number } | null, samples: InSample[], now: number, tracking: Tracking): ValidationResult {
  const flags = new Set<SampleFlag>();
  const suspicious: ValidationResult['suspicious'] = [];
  const accepted: Accepted[] = [];
  let rejected = 0;
  let last = prev;

  const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  for (const s of sorted) {
    if (s.isMocked) {
      flags.add('mock');
      suspicious.push({ flag: 'mock', detail: 'Device reported a mock location' });
      rejected++;
      continue;
    }
    if (s.timestamp > now + FUTURE_TOLERANCE_MS) {
      flags.add('future_timestamp');
      suspicious.push({ flag: 'future_timestamp', detail: `Sample ${Math.round((s.timestamp - now) / 1000)} s in the future` });
      rejected++;
      continue;
    }
    if (s.timestamp < now - MAX_AGE_MS) {
      flags.add('too_old');
      rejected++;
      continue;
    }
    if (last && s.timestamp <= last.t) {
      rejected++; // duplicate or out of order
      continue;
    }
    if (last) {
      const dt = (s.timestamp - last.t) / 1000;
      const raw = distanceM(last, s);
      // allow for the uncertainty of both fixes (capped so huge accuracies can't hide a teleport)
      const slack = Math.min(last.accuracy + s.accuracy, 80);
      const speed = Math.max(0, raw - slack) / Math.max(dt, 1);
      if (speed > tracking.maxSpeedMps) {
        flags.add('speed');
        suspicious.push({ flag: 'speed', detail: `${Math.round(raw)} m in ${dt.toFixed(0)} s (${speed.toFixed(1)} m/s)` });
        rejected++;
        continue;
      }
    }
    const lowAccuracy = s.accuracy > tracking.maxAccuracyM;
    if (lowAccuracy) flags.add('low_accuracy');
    const a: Accepted = {
      lat: s.lat,
      lng: s.lng,
      accuracy: s.accuracy,
      speed: s.speed ?? null,
      heading: s.heading ?? null,
      altitude: s.altitude ?? null,
      t: s.timestamp,
      lowAccuracy,
    };
    accepted.push(a);
    // a low-accuracy fix is kept for the history but doesn't become the speed reference
    if (!lowAccuracy) last = { lat: a.lat, lng: a.lng, accuracy: a.accuracy, t: a.t };
  }
  const newest = accepted[accepted.length - 1];
  const fresh = !!newest && Math.abs(now - newest.t) <= FRESH_MS;
  if (accepted.length && !fresh) flags.add('stale');
  return { accepted, rejected, flags: [...flags], suspicious, fresh };
}
