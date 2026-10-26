import { z } from 'zod';
import { badRequest } from '../errors.js';
import { tr } from '../i18n/index.js';

/** Map import (GeoJSON or CSV) into objectives, POIs and zones. Pure: no database access. */

export const ZONE_KINDS = new Set(['playable', 'restricted', 'safe', 'spawn', 'respawn', 'base', 'extraction', 'route', 'line', 'sector', 'label']);
export const POI_TYPES = new Set(['ammo', 'medic', 'respawn', 'safe_zone', 'team_base', 'vehicle', 'supply', 'extraction', 'restricted', 'custom']);
const MAX_FEATURES = 1000;
const MAX_POINTS = 500;

export interface ParsedZone {
  kind: string;
  geometry: string;
  points: { lat: number; lng: number }[];
  label: string;
  description: string;
  radius_m: number | null;
  color?: string;
  fill_opacity?: number;
  stroke_width?: number;
}

export interface ParsedImport {
  objectives: { name: string; lat: number; lng: number; description: string }[];
  pois: { name: string; type: string; lat: number; lng: number; description: string; color?: string }[];
  zones: ParsedZone[];
}

function validLatLng(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * Style from the feature's properties: our own names (color, fillOpacity, strokeWidth), snake case,
 * or the simplestyle names other tools write (stroke, fill, fill-opacity, stroke-width).
 * Anything out of range is ignored, so the zone keeps the default style.
 */
export function styleOf(p: Record<string, unknown>): { color?: string; fill_opacity?: number; stroke_width?: number } {
  const first = (...keys: string[]) => keys.map((k) => p[k]).find((v) => v !== undefined && v !== null && v !== '');
  const out: { color?: string; fill_opacity?: number; stroke_width?: number } = {};
  const color = first('color', 'stroke', 'fill');
  if (typeof color === 'string') {
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
    const hex = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : color;
    if (/^#[0-9a-f]{6}$/i.test(hex)) out.color = hex.toUpperCase();
  }
  const fill = Number(first('fillOpacity', 'fill_opacity', 'fill-opacity'));
  if (first('fillOpacity', 'fill_opacity', 'fill-opacity') !== undefined && Number.isFinite(fill) && fill >= 0 && fill <= 1) out.fill_opacity = fill;
  const width = Number(first('strokeWidth', 'stroke_width', 'stroke-width'));
  if (first('strokeWidth', 'stroke_width', 'stroke-width') !== undefined && Number.isFinite(width) && width >= 0 && width <= 20) out.stroke_width = width;
  return out;
}

/**
 * A venue map package is a GeoJSON FeatureCollection with an `airsofthub` member that lists optional
 * layers (add-ons such as a grid); features tagged `properties.layer` with one of those ids are
 * imported only when that layer is chosen. Untagged features, and tags the package does not list,
 * are always imported, so a plain file with its own `layer` property loses nothing.
 */
export function packageLayers(gj: unknown): string[] {
  const layers = (gj as { airsofthub?: { layers?: { id?: unknown }[] } })?.airsofthub?.layers;
  return Array.isArray(layers) ? layers.map((l) => l?.id).filter((id): id is string => typeof id === 'string') : [];
}

export function parseImport(format: 'geojson' | 'csv', content: string, opts: { layers?: string[] } = {}): ParsedImport {
  const out: ParsedImport = { objectives: [], pois: [], zones: [] };
  let count = 0;
  const add = (
    type: string,
    name: string,
    desc: string,
    geom: string,
    coords: { lat: number; lng: number }[],
    radius: number | null,
    style: ReturnType<typeof styleOf> = {},
  ) => {
    if (count >= MAX_FEATURES || !coords.length || coords.length > MAX_POINTS || !coords.every((c) => validLatLng(c.lat, c.lng))) return;
    count++;
    const t = type.toLowerCase().trim();
    if (geom === 'point' && t === 'objective') out.objectives.push({ name, lat: coords[0].lat, lng: coords[0].lng, description: desc });
    else if (geom === 'point' && (POI_TYPES.has(t) || t === 'poi' || !ZONE_KINDS.has(t)))
      out.pois.push({ name, type: POI_TYPES.has(t) ? t : 'custom', lat: coords[0].lat, lng: coords[0].lng, description: desc, ...(style.color ? { color: style.color } : {}) });
    else
      out.zones.push({
        kind: ZONE_KINDS.has(t) ? t : geom === 'polyline' ? 'route' : geom === 'point' ? 'label' : 'playable',
        geometry: geom,
        points: coords,
        label: name,
        description: desc,
        radius_m: radius,
        ...style,
      });
  };

  if (format === 'geojson') {
    let gj: { type?: string; features?: { geometry?: { type: string; coordinates: unknown }; properties?: Record<string, unknown> }[] };
    try {
      gj = JSON.parse(content);
    } catch {
      throw badRequest(tr`This is not valid GeoJSON.`, 'invalid_import');
    }
    const features = gj.type === 'FeatureCollection' ? (gj.features ?? []) : gj.type === 'Feature' ? [gj as never] : [];
    const optional = new Set(packageLayers(gj));
    const chosen = new Set(opts.layers ?? []);
    for (const f of features) {
      const p = f.properties ?? {};
      if (typeof p.layer === 'string' && optional.has(p.layer) && !chosen.has(p.layer)) continue;
      const name = String(p.name ?? p.title ?? tr`Imported`).slice(0, 120);
      const desc = String(p.description ?? '').slice(0, 2000);
      const type = String(p.type ?? p.kind ?? '');
      const style = styleOf(p);
      const g = f.geometry;
      if (!g) continue;
      const pt = (c: unknown) => ({ lat: Number((c as number[])[1]), lng: Number((c as number[])[0]) });
      // A ring repeats its first point at the end; zones store it once. Holes are not supported: only the outer ring is kept.
      const ring = (r: unknown) => ((r as unknown[]) ?? []).slice(0, -1).map(pt);
      const radius = p.radius ? Number(p.radius) : null;
      const parts: { geom: string; coords: { lat: number; lng: number }[] }[] = [];
      if (g.type === 'Point') parts.push({ geom: radius ? 'circle' : 'point', coords: [pt(g.coordinates)] });
      else if (g.type === 'MultiPoint') for (const c of g.coordinates as unknown[]) parts.push({ geom: radius ? 'circle' : 'point', coords: [pt(c)] });
      else if (g.type === 'LineString') parts.push({ geom: 'polyline', coords: (g.coordinates as unknown[]).map(pt) });
      else if (g.type === 'MultiLineString') for (const l of g.coordinates as unknown[][]) parts.push({ geom: 'polyline', coords: l.map(pt) });
      else if (g.type === 'Polygon') parts.push({ geom: 'polygon', coords: ring((g.coordinates as unknown[])[0]) });
      else if (g.type === 'MultiPolygon') for (const poly of g.coordinates as unknown[][]) parts.push({ geom: 'polygon', coords: ring(poly[0]) });
      const fallback = (geom: string) => (geom === 'polyline' ? 'route' : geom === 'polygon' ? 'playable' : 'poi');
      for (const part of parts) add(type || fallback(part.geom), name, desc, part.geom, part.coords, part.geom === 'circle' ? radius : null, style);
    }
  } else {
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0]?.toLowerCase().split(/[;,]/).map((h) => h.trim()) ?? [];
    const idx = (n: string) => header.indexOf(n);
    if (idx('lat') < 0 || idx('lng') < 0) throw badRequest(tr`The CSV needs a header with type,name,lat,lng[,description].`, 'invalid_import');
    for (const line of lines.slice(1, MAX_FEATURES + 1)) {
      const cells = line.split(/[;,](?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, ''));
      add(cells[idx('type')] ?? 'poi', (cells[idx('name')] ?? tr`Imported`).slice(0, 120), (cells[idx('description')] ?? '').slice(0, 2000), 'point', [
        { lat: Number(cells[idx('lat')]), lng: Number(cells[idx('lng')]) },
      ], null);
    }
  }
  return out;
}

// ------------------------------------------------------------------ venue map image

/** Uploaded venue map images only: same origin, served with nosniff and a sandbox CSP. */
export const overlayUrl = z.string().max(200).regex(/^\/api\/files\/map_overlay-[A-Za-z0-9_-]{24}\.(jpg|png|webp)$/, 'Upload the image first');

const corner = z.object({ lat: z.number().min(-85).max(85), lng: z.number().min(-180).max(180) });

/** Corners in order top-left, top-right, bottom-right, bottom-left (as MapLibre's image source). */
export const mapOverlaySchema = z
  .object({
    url: overlayUrl,
    corners: z.array(corner).length(4),
    opacity: z.number().min(0.1).max(1),
  })
  .refine((o) => overlaySpanM(o.corners) <= 20_000, { message: 'The image is placed too large (over 20 km)', path: ['corners'] })
  .refine((o) => overlaySpanM(o.corners) >= 10, { message: 'The image is placed too small', path: ['corners'] });

export type MapOverlay = z.infer<typeof mapOverlaySchema>;

/** Longest corner-to-corner distance, in metres (equirectangular; fine at field scale). */
export function overlaySpanM(c: { lat: number; lng: number }[]): number {
  let max = 0;
  for (const a of c) {
    for (const b of c) {
      const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
      max = Math.max(max, Math.hypot((a.lat - b.lat) * 110_540, (a.lng - b.lng) * 111_320 * k));
    }
  }
  return max;
}
