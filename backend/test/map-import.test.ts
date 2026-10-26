import { describe, expect, it } from 'vitest';
import { mapOverlaySchema, parseImport, styleOf } from '../src/domain/map-import.js';

const fc = (features: unknown[]) => JSON.stringify({ type: 'FeatureCollection', features });
const square = [
  [9, 45],
  [9.001, 45],
  [9.001, 45.001],
  [9, 45.001],
  [9, 45],
];

describe('map import', () => {
  it('keeps the style written in the file, in our names or simplestyle names', () => {
    const out = parseImport(
      'geojson',
      fc([
        { type: 'Feature', properties: { type: 'restricted', name: 'A', color: '#f0595c', fillOpacity: 0.45, strokeWidth: 2 }, geometry: { type: 'Polygon', coordinates: [square] } },
        { type: 'Feature', properties: { type: 'sector', name: 'B', stroke: '#abc', 'fill-opacity': 0.3, 'stroke-width': 4 }, geometry: { type: 'Polygon', coordinates: [square] } },
        { type: 'Feature', properties: { type: 'sector', name: 'C' }, geometry: { type: 'Polygon', coordinates: [square] } },
      ]),
    );
    expect(out.zones.map((z) => [z.color, z.fill_opacity, z.stroke_width])).toEqual([
      ['#F0595C', 0.45, 2],
      ['#AABBCC', 0.3, 4],
      [undefined, undefined, undefined],
    ]);
    expect(out.zones[0].points).toHaveLength(4);
  });

  it('ignores styles out of range instead of failing the import', () => {
    expect(styleOf({ color: 'red', fillOpacity: 3, strokeWidth: -1 })).toEqual({});
    expect(styleOf({ fillOpacity: 0 })).toEqual({ fill_opacity: 0 });
  });

  it('splits multi-part geometries into one shape per part', () => {
    const out = parseImport(
      'geojson',
      fc([
        { type: 'Feature', properties: { type: 'restricted', name: 'M' }, geometry: { type: 'MultiPolygon', coordinates: [[square], [square]] } },
        { type: 'Feature', properties: { type: 'line', name: 'L' }, geometry: { type: 'MultiLineString', coordinates: [square.slice(0, 2), square.slice(2, 4)] } },
      ]),
    );
    expect(out.zones.map((z) => `${z.kind}:${z.geometry}`)).toEqual(['restricted:polygon', 'restricted:polygon', 'line:polyline', 'line:polyline']);
  });

  it('imports the optional layers of a venue map package only when chosen', () => {
    const tagged = (name: string, layer?: string) => ({ type: 'Feature', properties: { type: 'line', name, ...(layer ? { layer } : {}) }, geometry: { type: 'LineString', coordinates: square.slice(0, 2) } });
    const pkg = JSON.stringify({
      type: 'FeatureCollection',
      airsofthub: { version: 1, layers: [{ id: 'grid' }, { id: 'entrances' }] },
      features: [tagged('base'), tagged('grid line', 'grid'), tagged('entrance', 'entrances'), tagged('own layer', 'roads')],
    });
    const names = (layers?: string[]) => parseImport('geojson', pkg, { layers }).zones.map((z) => z.label);
    expect(names()).toEqual(['base', 'own layer']);
    expect(names(['grid'])).toEqual(['base', 'grid line', 'own layer']);
    // a plain file keeps every feature, whatever its layer property says
    expect(parseImport('geojson', fc([tagged('a', 'grid'), tagged('b')])).zones).toHaveLength(2);
  });

  it('accepts a venue map image only from our own uploads, placed at field scale', () => {
    const corners = [
      { lat: 45.76, lng: 8.6 },
      { lat: 45.76, lng: 8.61 },
      { lat: 45.75, lng: 8.61 },
      { lat: 45.75, lng: 8.6 },
    ];
    const url = '/api/files/map_overlay-abcdefghijklmnopqrstuvwx.webp';
    expect(mapOverlaySchema.safeParse({ url, corners, opacity: 0.8 }).success).toBe(true);
    expect(mapOverlaySchema.safeParse({ url: 'https://evil.example/x.webp', corners, opacity: 0.8 }).success).toBe(false);
    expect(mapOverlaySchema.safeParse({ url, corners: corners.slice(0, 3), opacity: 0.8 }).success).toBe(false);
    const huge = corners.map((c, i) => ({ lat: c.lat, lng: i % 3 ? 9.5 : 8.6 }));
    expect(mapOverlaySchema.safeParse({ url, corners: huge, opacity: 0.8 }).success).toBe(false);
  });
});
