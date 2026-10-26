import type { LatLng, MapOverlay } from '../../../core/api/models';

type Corners = MapOverlay['corners'];

const valid = (p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 85 && Math.abs(p.lng) <= 180;

/**
 * Where a venue map image goes, read from a small position file. Accepted:
 * - GeoJSON (Feature, FeatureCollection or bare Polygon) whose first polygon has the four corners
 *   in order top-left, top-right, bottom-right, bottom-left (a closing point is allowed);
 * - `{ "corners": [{ "lat", "lng" } x4] }` in the same order;
 * - `{ "north", "south", "east", "west" }` for an image placed north-up.
 * Returns null when the file is none of these.
 */
export function parseOverlayPosition(text: string): Corners | null {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  const o = j as Record<string, unknown>;
  if (!o || typeof o !== 'object') return null;

  if (['north', 'south', 'east', 'west'].every((k) => typeof o[k] === 'number')) {
    const { north, south, east, west } = o as Record<'north' | 'south' | 'east' | 'west', number>;
    return check([
      { lat: north, lng: west },
      { lat: north, lng: east },
      { lat: south, lng: east },
      { lat: south, lng: west },
    ]);
  }
  if (Array.isArray(o['corners'])) {
    return check((o['corners'] as { lat: unknown; lng: unknown }[]).map((c) => ({ lat: Number(c?.lat), lng: Number(c?.lng) })));
  }
  const geometry = (g: unknown): { type?: string; coordinates?: unknown } | undefined => g as never;
  let g = geometry(o['type'] === 'Feature' ? o['geometry'] : o);
  if (o['type'] === 'FeatureCollection') {
    const f = ((o['features'] as { geometry?: unknown }[]) ?? []).find((x) => geometry(x?.geometry)?.type === 'Polygon');
    g = geometry(f?.geometry);
  }
  if (g?.type !== 'Polygon') return null;
  const ring = ((g.coordinates as number[][][]) ?? [])[0] ?? [];
  const pts = ring.map((c) => ({ lat: Number(c[1]), lng: Number(c[0]) }));
  if (pts.length === 5 && pts[0].lat === pts[4].lat && pts[0].lng === pts[4].lng) pts.pop();
  return check(pts);
}

function check(pts: LatLng[]): Corners | null {
  return pts.length === 4 && pts.every(valid) ? (pts as Corners) : null;
}

/** The image centred in the given view, north-up, keeping its proportions, at 80% of the view. */
export function fitToView(view: { north: number; south: number; east: number; west: number }, aspect: number): Corners {
  const lat = (view.north + view.south) / 2;
  const lng = (view.east + view.west) / 2;
  const k = Math.cos((lat * Math.PI) / 180);
  const viewW = (view.east - view.west) * k;
  const viewH = view.north - view.south;
  let h = viewH * 0.8;
  let w = h * aspect;
  if (w > viewW * 0.8) {
    w = viewW * 0.8;
    h = w / aspect;
  }
  const dLng = w / k / 2;
  const dLat = h / 2;
  return [
    { lat: lat + dLat, lng: lng - dLng },
    { lat: lat + dLat, lng: lng + dLng },
    { lat: lat - dLat, lng: lng + dLng },
    { lat: lat - dLat, lng: lng - dLng },
  ];
}
