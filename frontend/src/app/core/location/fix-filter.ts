import { distanceM } from '../util/geo';

export interface RawFix {
  lat: number;
  lng: number;
  accuracy: number;
  speed?: number | null;
  timestamp: number;
}

/** After this long without an accepted fix, take whatever comes: the signal may really have got worse, or the player moved. */
const GIVE_UP_MS = 15_000;

/**
 * Drops fixes that are clearly worse than the one we just had: a coarse Wi-Fi or cell fix slipping
 * in between GPS fixes, or a jump faster than a player can move (allowing for both accuracies).
 */
export class OutlierFilter {
  private last: RawFix | null = null;

  constructor(private readonly maxSpeedMps = 12) {}

  accept(f: RawFix): boolean {
    const last = this.last;
    if (last && f.timestamp - last.timestamp < GIVE_UP_MS) {
      if (f.accuracy > Math.max(last.accuracy * 2, last.accuracy + 15)) return false;
      const moved = Math.max(0, distanceM(last, f) - last.accuracy - f.accuracy);
      if (moved / Math.max((f.timestamp - last.timestamp) / 1000, 1) > this.maxSpeedMps) return false;
    }
    this.last = f;
    return true;
  }
}

/**
 * Kalman smoothing of the displayed position, weighted by each fix's accuracy: the dot stops
 * dancing while the player stands still and still follows them when they run (the expected
 * movement grows with the speed the device reports).
 */
export class PositionSmoother {
  private lat = 0;
  private lng = 0;
  /** m², negative = no fix yet */
  private variance = -1;
  private t = 0;

  constructor(private readonly noiseMps = 3) {}

  next(f: RawFix): { lat: number; lng: number } {
    const acc2 = Math.max(f.accuracy, 1) ** 2;
    if (this.variance < 0) {
      [this.lat, this.lng, this.variance, this.t] = [f.lat, f.lng, acc2, f.timestamp];
      return { lat: f.lat, lng: f.lng };
    }
    const dt = Math.max(0, f.timestamp - this.t) / 1000;
    const q = Math.max(this.noiseMps, (f.speed ?? 0) * 1.5);
    this.variance += dt * q * q;
    this.t = Math.max(this.t, f.timestamp);
    const k = this.variance / (this.variance + acc2);
    this.lat += k * (f.lat - this.lat);
    this.lng += k * (f.lng - this.lng);
    this.variance *= 1 - k;
    return { lat: this.lat, lng: this.lng };
  }
}
