import { GeofenceConfig, LatLng, PoiType, Rewards, Zone, ZoneKind } from '../../../core/api/models';
import { pathLengthM, polygonAreaM2 } from '../../../core/util/geo';
import { formatDecimal, formatDistance } from '../../../core/util/format';

/**
 * Defaults and option lists shared by the GM map tools (map editor, objective and POI editors).
 * Colours here are *data* (stored on the element and drawn on the map), not UI theme colours.
 */

export const ZONE_KIND_COLORS: Record<ZoneKind, string> = {
  playable: '#9DAE5C',
  restricted: '#F0595C',
  safe: '#4FC7DD',
  spawn: '#E6B04F',
  respawn: '#E0C341',
  base: '#3B82C4',
  extraction: '#C75B9B',
  route: '#D9822B',
  line: '#E6B04F',
  sector: '#B0B5A8',
  label: '#E9ECE6',
};

export const ZONE_KIND_FILL: Partial<Record<ZoneKind, number>> = {
  playable: 0.05,
  restricted: 0.25,
  safe: 0.2,
  sector: 0.08,
};

export const AREA_KINDS: ZoneKind[] = ['playable', 'restricted', 'safe', 'base', 'sector', 'spawn', 'respawn', 'extraction'];
export const LINE_KINDS: ZoneKind[] = ['route', 'line'];
export const CIRCLE_KINDS: ZoneKind[] = ['spawn', 'respawn', 'extraction', 'safe', 'restricted'];

export const POI_TYPE_COLORS: Record<PoiType, string> = {
  ammo: '#E0C341',
  medic: '#5BB8B0',
  respawn: '#E6B04F',
  safe_zone: '#4FC7DD',
  team_base: '#3B82C4',
  vehicle: '#B0B5A8',
  supply: '#D9822B',
  extraction: '#C75B9B',
  restricted: '#F0595C',
  custom: '#9DAE5C',
};

/** Swatches offered by the colour pickers (plus a free colour input). */
export const MARKER_COLORS = ['#E6B04F', '#9DAE5C', '#3B82C4', '#D9822B', '#C75B9B', '#5BB8B0', '#8E7CC3', '#F0595C', '#E9ECE6'];

export const MAP_ICONS: { value: string; label: string; icon: string }[] = [
  { value: 'flag', label: $localize`Flag`, icon: 'lucideFlag' },
  { value: 'target', label: $localize`Target`, icon: 'lucideTarget' },
  { value: 'crosshair', label: $localize`Crosshair`, icon: 'lucideCrosshair' },
  { value: 'radio', label: $localize`Radio`, icon: 'lucideRadio' },
  { value: 'antenna', label: $localize`Antenna`, icon: 'lucideAntenna' },
  { value: 'package', label: $localize`Crate`, icon: 'lucidePackage' },
  { value: 'file', label: $localize`Documents`, icon: 'lucideFileText' },
  { value: 'fuel', label: $localize`Fuel`, icon: 'lucideFuel' },
  { value: 'truck', label: $localize`Vehicle`, icon: 'lucideTruck' },
  { value: 'zap', label: $localize`Power`, icon: 'lucideZap' },
  { value: 'tent', label: $localize`Camp`, icon: 'lucideTent' },
  { value: 'hospital', label: $localize`Medical`, icon: 'lucideHospital' },
  { value: 'shield', label: $localize`Shield`, icon: 'lucideShield' },
  { value: 'star', label: $localize`Star`, icon: 'lucideStar' },
];

export function mapIconName(value: string | null | undefined): string {
  return MAP_ICONS.find((i) => i.value === value)?.icon ?? 'lucideMapPin';
}

export const DEFAULT_GEOFENCE: GeofenceConfig = {
  // 15 m and less is only reliable in open ground (see the objective editor's warnings)
  radiusM: 25,
  durationSec: 60,
  resetOnExit: true,
  multiPlayerBoost: false,
  boostPerExtraPlayer: 0.25,
  maxMultiplier: 2,
  contestable: true,
  contestRule: 'pause',
  requireScreenOpen: false,
  maxAccuracyM: 25,
};

export const DEFAULT_REWARDS: Rewards = {
  points: 100,
  currency: 50,
  perTeam: {},
  recurringPointsPerMinute: 0,
  recurringCurrencyPerMinute: 0,
  captureBonus: 0,
  defenseBonus: 0,
  completionBonus: 0,
};

/** Manual capture code: 6 chars, no ambiguous characters (0/O, 1/I/L). */
export function generateCaptureCode(length = 6): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** "1.25 ha", "350 m", "r 40 m · 0.50 ha" — size info for element lists. */
export function zoneSizeLabel(z: Pick<Zone, 'geometry' | 'points' | 'radiusM'>): string {
  if (z.geometry === 'polygon') return `${formatDecimal(polygonAreaM2(z.points) / 10_000, 2)} ha`;
  if (z.geometry === 'polyline') return formatDistance(pathLengthM(z.points));
  if (z.geometry === 'circle' && z.radiusM) return `r ${Math.round(z.radiusM)} m · ${formatDecimal((Math.PI * z.radiusM * z.radiusM) / 10_000, 2)} ha`;
  return '';
}

/** Approximate a circle as a closed path (used to draw zones as outlines while placing). */
export function circlePath(center: LatLng, radiusM: number, steps = 40): LatLng[] {
  const out: LatLng[] = [];
  const dLat = radiusM / 110_540;
  const dLng = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push({ lat: center.lat + dLat * Math.sin(a), lng: center.lng + dLng * Math.cos(a) });
  }
  return out;
}

/** Escape text for HTML written into a print window. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
