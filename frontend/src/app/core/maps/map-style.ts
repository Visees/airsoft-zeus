import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import liberty from './liberty.json';

/**
 * Map styles for the MapLibre renderer, all built on free data:
 * - the base map is OpenFreeMap's "Liberty" style (OpenStreetMap data, vendored in liberty.json so
 *   layer ids can't change under us), recoloured to look like a hiking map;
 * - relief shading and contour lines are computed in the browser from the AWS open elevation tiles
 *   (maplibre-contour);
 * - satellite imagery is Esri World Imagery and needs an ArcGIS Location Platform key.
 */

export type BaseLayer = 'topo' | 'satellite';

/** AWS Terrain Tiles (open data, terrarium encoding). */
export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const DEM_MAXZOOM = 13;
/** Contour interval [minor, major] in metres per zoom: 10 m lines from z13, like OpenTopoMap. */
export const CONTOUR_THRESHOLDS: Record<number, [number, number]> = { 10: [100, 500], 11: [50, 200], 12: [20, 100], 13: [10, 50] };

const ESRI_IMAGERY = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

interface Palette {
  paper: string;
  wood: string;
  grass: string;
  park: string;
  residential: string;
  water: string;
  river: string;
  hatchBg: string;
  hatchLine: string;
  buildingLine: string;
  casing: string;
  minor: string;
  secondary: string;
  primary: string;
  motorway: string;
  path: string;
  contour: string;
  contourLabel: string;
  tree: string;
  peak: string;
  shadow: string;
  highlight: string;
  /** null keeps Liberty's own label colours. */
  text: string | null;
}

const LIGHT: Palette = {
  paper: '#f3f0e8',
  wood: '#c9d9ad',
  grass: '#dde6c6',
  park: '#d3e1bb',
  residential: '#e8e2d8',
  water: '#a9c8de',
  river: '#7fa8c8',
  hatchBg: '#efece6',
  hatchLine: '#6f6862',
  buildingLine: '#5f5953',
  casing: '#9a8f82',
  minor: '#ffffff',
  secondary: '#f2deaa',
  primary: '#eec58c',
  motorway: '#e3a37a',
  path: '#6b4f36',
  contour: '#9a6f4c',
  contourLabel: '#74502f',
  tree: '#7f9d63',
  peak: '#4a3b2c',
  shadow: '#5c5446',
  highlight: '#ffffff',
  text: null,
};

/** Tactical night: dark ground, muted greens, warm contours; low glare at night. */
const DARK: Palette = {
  paper: '#151a17',
  wood: '#1f2b1f',
  grass: '#1b231a',
  park: '#1d281c',
  residential: '#1f2320',
  water: '#16293a',
  river: '#2c5574',
  hatchBg: '#2a2e2b',
  hatchLine: '#7b827a',
  buildingLine: '#8a9188',
  casing: '#0c0f0d',
  minor: '#3d443e',
  secondary: '#5b5434',
  primary: '#6a5531',
  motorway: '#77482d',
  path: '#b89d74',
  contour: '#8a6c4c',
  contourLabel: '#b49773',
  tree: '#3e5a38',
  peak: '#d8cbb4',
  shadow: '#000000',
  highlight: '#3b4438',
  text: '#cdd5cd',
};

export interface StyleOptions {
  base: BaseLayer;
  dark: boolean;
  /** maplibre-contour protocol URLs (DemSource.sharedDemProtocolUrl / contourProtocolUrl()). */
  demUrl: string;
  contourUrl: string;
  /** ArcGIS key for satellite imagery; '' when not configured. */
  satelliteKey: string;
}

const LABEL_FONT = ['Noto Sans Regular'];

export function mapStyle(o: StyleOptions): StyleSpecification {
  return o.base === 'satellite' && o.satelliteKey ? satelliteStyle(o) : topoStyle(o);
}

function base(): StyleSpecification {
  return structuredClone(liberty as unknown as StyleSpecification);
}

function topoStyle(o: StyleOptions): StyleSpecification {
  const c = o.dark ? DARK : LIGHT;
  const s = base();
  s.sources['dem'] = { type: 'raster-dem', encoding: 'terrarium', tiles: [o.demUrl], maxzoom: DEM_MAXZOOM, tileSize: 256 };
  s.sources['contours'] = { type: 'vector', tiles: [o.contourUrl], maxzoom: 15 };

  const drop = new Set(['building-3d', 'poi_r20', 'poi_r7', 'natural_earth', 'park_outline']);
  s.layers = s.layers.filter((l) => !drop.has(l.id));
  const paint = (id: string, prop: string, v: unknown) => {
    const l = s.layers.find((x) => x.id === id) as { paint?: Record<string, unknown> } | undefined;
    if (l) (l.paint ??= {})[prop] = v;
  };

  paint('background', 'background-color', c.paper);
  paint('park', 'fill-color', c.park);
  paint('park', 'fill-opacity', 0.6);
  paint('park', 'fill-outline-color', c.park);
  paint('landuse_residential', 'fill-color', c.residential);
  paint('landcover_wood', 'fill-color', c.wood);
  paint('landcover_wood', 'fill-opacity', 0.95);
  paint('landcover_grass', 'fill-color', c.grass);
  paint('landcover_grass', 'fill-opacity', 0.8);
  paint('water', 'fill-color', c.water);
  for (const id of ['waterway_river', 'waterway_other', 'waterway_tunnel']) paint(id, 'line-color', c.river);

  for (const l of s.layers) {
    if (l.type !== 'line' || l['source-layer'] !== 'transportation' || /rail/.test(l.id)) continue;
    const p = (l.paint ??= {}) as Record<string, unknown>;
    if (l.id.endsWith('_casing')) p['line-color'] = c.casing;
    else if (/motorway/.test(l.id)) p['line-color'] = c.motorway;
    else if (/trunk_primary/.test(l.id)) p['line-color'] = c.primary;
    else if (/secondary_tertiary|_link$/.test(l.id)) p['line-color'] = c.secondary;
    else if (/minor|street|service_track/.test(l.id)) p['line-color'] = c.minor;
  }
  // Paths dashed dark brown, like on a hiking map (Liberty's white dashes vanish on green).
  for (const id of ['road_path_pedestrian', 'bridge_path_pedestrian', 'tunnel_path_pedestrian']) {
    paint(id, 'line-color', c.path);
    paint(id, 'line-dasharray', [2, 1.2]);
    paint(id, 'line-width', ['interpolate', ['linear'], ['zoom'], 12, 0.6, 15, 1.2, 18, 2]);
  }

  // Buildings hatched with a dark outline at every zoom (Liberty hands them to a 3D layer from z14).
  const bIdx = s.layers.findIndex((l) => l.id === 'building');
  const building = s.layers[bIdx] as LayerSpecification & { maxzoom?: number };
  delete building.maxzoom;
  building.paint = { 'fill-pattern': 'zeus-hatch' };
  s.layers.splice(bIdx + 1, 0, {
    id: 'building-outline',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'building',
    minzoom: 13,
    paint: { 'line-color': c.buildingLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.4, 16, 1, 18, 1.5] },
  });

  // Tree symbols over the wood fill, so cover reads at a glance even in sunlight.
  const woodIdx = s.layers.findIndex((l) => l.id === 'landcover_wood');
  const wood = s.layers[woodIdx] as LayerSpecification & { source: string; 'source-layer': string; filter?: ExpressionSpecification };
  s.layers.splice(woodIdx + 1, 0, {
    id: 'wood-trees',
    type: 'fill',
    source: wood.source,
    'source-layer': wood['source-layer'],
    ...(wood.filter ? { filter: wood.filter } : {}),
    minzoom: 13,
    paint: { 'fill-pattern': 'zeus-trees', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 15, 1] },
  });

  // Relief and contours above land cover, below roads. Contours are light at field zoom so the
  // game layer stays readable, and strong when zoomed in close.
  const firstRoad = s.layers.findIndex((l) => 'source-layer' in l && l['source-layer'] === 'transportation');
  s.layers.splice(
    firstRoad,
    0,
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'dem',
      paint: { 'hillshade-exaggeration': 0.5, 'hillshade-shadow-color': c.shadow, 'hillshade-highlight-color': c.highlight, 'hillshade-accent-color': c.shadow },
    },
    {
      id: 'contour-lines',
      type: 'line',
      source: 'contours',
      'source-layer': 'contours',
      paint: {
        'line-color': c.contour,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 16, 0.9],
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, ['match', ['get', 'level'], 1, 0.9, 0.4], 16, ['match', ['get', 'level'], 1, 1.4, 0.75]],
      },
    },
  );

  if (c.text) {
    for (const l of s.layers) {
      if (l.type !== 'symbol') continue;
      l.paint = { ...l.paint, 'text-color': c.text, 'text-halo-color': c.paper, 'text-halo-width': 1.2 };
    }
  }

  const firstLabel = s.layers.findIndex((l) => l.type === 'symbol');
  s.layers.splice(
    firstLabel,
    0,
    {
      id: 'contour-labels',
      type: 'symbol',
      source: 'contours',
      'source-layer': 'contours',
      filter: ['>', ['get', 'level'], 0],
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 180, 'text-size': 10.5, 'text-field': ['to-string', ['get', 'ele']], 'text-font': LABEL_FONT },
      paint: { 'text-color': c.contourLabel, 'text-halo-color': c.paper, 'text-halo-width': 1.2 },
    },
    peaksLayer(c.peak, c.paper),
  );
  return s;
}

function satelliteStyle(o: StyleOptions): StyleSpecification {
  const lib = base();
  const labels = lib.layers
    .filter((l) => l.type === 'symbol' && 'source-layer' in l && (l['source-layer'] === 'place' || l['source-layer'] === 'water_name'))
    .map((l) => ({ ...l, paint: { ...(l.type === 'symbol' ? l.paint : {}), 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.4 } }) as LayerSpecification);
  return {
    version: 8,
    glyphs: lib.glyphs,
    sprite: lib.sprite,
    sources: {
      openmaptiles: lib.sources['openmaptiles'],
      imagery: {
        type: 'raster',
        tiles: [`${ESRI_IMAGERY}?token=${encodeURIComponent(o.satelliteKey)}`],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Powered by Esri | Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#1b1f1c' } },
      { id: 'imagery', type: 'raster', source: 'imagery' },
      peaksLayer('#ffffff', 'rgba(0,0,0,0.75)'),
      ...labels,
    ],
  };
}

function peaksLayer(color: string, halo: string): LayerSpecification {
  return {
    id: 'peaks',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'mountain_peak',
    minzoom: 11,
    layout: {
      'text-field': [
        'case',
        ['has', 'ele'],
        ['concat', '▲ ', ['coalesce', ['get', 'name'], ''], '\n', ['to-string', ['get', 'ele']], ' m'],
        ['concat', '▲ ', ['coalesce', ['get', 'name'], '']],
      ],
      'text-font': LABEL_FONT,
      'text-size': 10.5,
      'text-anchor': 'top',
      'text-offset': [0, -0.4],
    },
    paint: { 'text-color': color, 'text-halo-color': halo, 'text-halo-width': 1.3 },
  };
}

/** Pattern images the styles reference; added on the map's styleimagemissing event. */
export function patternImage(id: string, dark: boolean): { width: number; height: number; data: Uint8Array } | null {
  const c = dark ? DARK : LIGHT;
  if (id === 'zeus-hatch') {
    // 8 px diagonal hatch (drawn at 2x), tiled seamlessly.
    return draw(16, (g, n) => {
      g.fillStyle = c.hatchBg;
      g.fillRect(0, 0, n, n);
      g.strokeStyle = c.hatchLine;
      g.lineWidth = 2.4;
      for (const off of [-n, 0, n]) {
        g.beginPath();
        g.moveTo(off, n);
        g.lineTo(off + n, 0);
        g.stroke();
      }
    });
  }
  if (id === 'zeus-trees') {
    // Two small trees per 22 px tile, staggered, on a transparent background.
    return draw(44, (g) => {
      g.strokeStyle = c.tree;
      g.lineWidth = 2;
      for (const [x, y] of [
        [11, 11],
        [33, 33],
      ]) {
        g.beginPath();
        g.arc(x, y, 4.5, 0, 2 * Math.PI);
        g.stroke();
        g.beginPath();
        g.moveTo(x, y + 4.5);
        g.lineTo(x, y + 8.5);
        g.stroke();
      }
    });
  }
  return null;
}

function draw(n: number, paint: (g: CanvasRenderingContext2D, n: number) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const g = canvas.getContext('2d')!;
  paint(g, n);
  return { width: n, height: n, data: new Uint8Array(g.getImageData(0, 0, n, n).data.buffer) };
}
