import type { LatLng, MapOverlay } from '../../../core/api/models';
import { parseOverlayPosition } from './overlay-position';

/**
 * A venue map package: one GeoJSON file that carries a whole field. Besides its features it has an
 * `airsofthub` member (other GeoJSON tools ignore it):
 *
 *   "airsofthub": {
 *     "version": 1, "name": "Ex polveriera Montedison, Taino",
 *     "layers": [{ "id": "grid", "name": "…", "description": "…", "default": false }],
 *     "overlay": { "image": "data:image/webp;base64,…", "north": …, "south": …, "east": …, "west": …, "opacity": 0.85 },
 *     "area": { "lat": …, "lng": …, "zoom": 17 }
 *   }
 *
 * Features tagged `properties.layer` with a listed id are add-ons: all are imported as zones of that
 * layer, which every map can switch on and off (`default` = shown at first, the GM can change it in
 * the import dialog). The overlay also accepts `corners` (top-left, top-right, bottom-right,
 * bottom-left) like a position file.
 */
export interface MapPackageLayer {
  id: string;
  name: string;
  description: string;
  count: number;
  default: boolean;
}

export interface MapPackage {
  name: string;
  /** features imported whatever is chosen */
  baseCount: number;
  layers: MapPackageLayer[];
  overlay: { image: File; corners: MapOverlay['corners']; opacity: number } | null;
  area: (LatLng & { zoom: number }) | null;
  /** the package as sent to the server: everything but the embedded image */
  content: string;
}

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Reads a package; null when the text is not one (a plain GeoJSON or a CSV). */
export function readMapPackage(text: string): MapPackage | null {
  let gj: { type?: unknown; features?: { properties?: Record<string, unknown> }[]; airsofthub?: Record<string, unknown> };
  try {
    gj = JSON.parse(text);
  } catch {
    return null;
  }
  const meta = gj?.airsofthub;
  if (gj?.type !== 'FeatureCollection' || !meta || typeof meta !== 'object' || !Array.isArray(gj.features)) return null;

  const listed = (Array.isArray(meta['layers']) ? meta['layers'] : []) as Record<string, unknown>[];
  const layerOf = (f: { properties?: Record<string, unknown> }) => f?.properties?.['layer'];
  const layers: MapPackageLayer[] = listed
    .filter((l) => typeof l?.['id'] === 'string')
    .map((l) => ({
      id: l['id'] as string,
      name: String(l['name'] ?? l['id']).slice(0, 80),
      description: String(l['description'] ?? '').slice(0, 300),
      count: gj.features!.filter((f) => layerOf(f) === l['id']).length,
      default: l['default'] === true,
    }))
    .filter((l) => l.count > 0);
  const ids = new Set(layers.map((l) => l.id));
  const baseCount = gj.features.filter((f) => !ids.has(layerOf(f) as string)).length;

  const ov = meta['overlay'] as Record<string, unknown> | undefined;
  const image = typeof ov?.['image'] === 'string' ? dataUrlFile(ov['image'] as string) : null;
  const corners = ov ? parseOverlayPosition(JSON.stringify(ov)) : null;
  const opacity = Number(ov?.['opacity']);
  const overlay = image && corners ? { image, corners, opacity: Number.isFinite(opacity) && opacity >= 0.1 && opacity <= 1 ? opacity : 0.85 } : null;

  const a = meta['area'] as Record<string, unknown> | undefined;
  const area =
    a && [a['lat'], a['lng'], a['zoom']].every((v) => typeof v === 'number' && Number.isFinite(v)) && Math.abs(a['lat'] as number) <= 90 && Math.abs(a['lng'] as number) <= 180
      ? { lat: a['lat'] as number, lng: a['lng'] as number, zoom: Math.min(Math.max(a['zoom'] as number, 1), 22) }
      : null;

  const { overlay: _image, ...rest } = meta;
  return {
    name: String(meta['name'] ?? '').slice(0, 120),
    baseCount,
    layers,
    overlay,
    area,
    content: JSON.stringify({ ...gj, airsofthub: rest }),
  };
}

/** `data:image/webp;base64,…` → a File ready to upload; null for anything but a JPEG, PNG or WebP. */
function dataUrlFile(url: string): File | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  if (!m) return null;
  try {
    const bin = atob(m[2].replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], `venue-map.${IMAGE_TYPES[m[1]]}`, { type: m[1] });
  } catch {
    return null;
  }
}
