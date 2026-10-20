export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function offset(from: LatLng, distance: number, bearingDeg: number): LatLng {
  const d = distance / EARTH_RADIUS_M;
  const br = toRad(bearingDeg);
  const lat1 = toRad(from.lat);
  const lng1 = toRad(from.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

/** Deterministic pseudo-random number in [0,1) from a string seed (FNV-1a + xorshift). */
export function seededRandom(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return (h >>> 0) / 4294967296;
}

/**
 * Approximate position: the true point is moved by a deterministic offset (same for a
 * player within a time window, so the marker doesn't jitter on every update) of up to
 * `radiusM`. The true point is always inside the returned circle of radius `radiusM`.
 */
export function approximate(p: LatLng, radiusM: number, seed: string): LatLng {
  const r = radiusM * Math.sqrt(seededRandom(seed + ':r')) * 0.9;
  const bearing = seededRandom(seed + ':b') * 360;
  return offset(p, r, bearing);
}

/** Area position: snap to the centre of a square grid cell of size 2·radiusM. */
export function snapToGrid(p: LatLng, radiusM: number): LatLng {
  const cell = Math.max(10, radiusM * 2);
  const dLat = cell / 110_540;
  const dLng = cell / (111_320 * Math.cos(toRad(p.lat)));
  return {
    lat: (Math.floor(p.lat / dLat) + 0.5) * dLat,
    lng: (Math.floor(p.lng / dLng) + 0.5) * dLng,
  };
}

export function pointInPolygon(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng,
      yi = poly[i].lat,
      xj = poly[j].lng,
      yj = poly[j].lat;
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
