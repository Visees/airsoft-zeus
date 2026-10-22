import { Injectable } from '@angular/core';
import { LatLng } from '../api/models';
import { activeLanguage } from '../i18n/language';

export interface PlaceResult {
  name: string;
  /** Town, province, country: tells apart places with the same name. */
  detail: string;
  position: LatLng;
  /** Area to frame for streets, towns, regions; null for a point. */
  bounds: { north: number; south: number; east: number; west: number } | null;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | number[] | undefined> & { extent?: [number, number, number, number] };
}

const PHOTON = 'https://photon.komoot.io/api/';

/**
 * Place search on OpenStreetMap data through Photon's free public API (fair use: callers
 * debounce, and searches run only when someone types). No key; results in the UI language
 * when Photon has it (en), otherwise in the local language.
 */
@Injectable({ providedIn: 'root' })
export class PlaceSearchService {
  async search(query: string, near?: LatLng | null, limit = 5): Promise<PlaceResult[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    // extra results: a town also comes back as its boundary, centre, etc., dropped below
    const params = new URLSearchParams({ q, limit: String(limit * 2), lang: activeLanguage() === 'en' ? 'en' : 'default' });
    if (near) {
      params.set('lat', near.lat.toFixed(4));
      params.set('lon', near.lng.toFixed(4));
    }
    const res = await fetch(`${PHOTON}?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Place search failed (${res.status})`);
    const body = (await res.json()) as { features?: PhotonFeature[] };
    const seen = new Set<string>();
    return (body.features ?? [])
      .map(toResult)
      .filter((r) => {
        const key = `${r.name}|${r.detail}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }
}

function toResult(f: PhotonFeature): PlaceResult {
  const p = f.properties;
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  const name = str('name') || [str('street'), str('housenumber')].filter(Boolean).join(' ') || str('city');
  const detail = [str('city') !== name ? str('city') : '', str('county'), str('country')].filter(Boolean).join(', ');
  const [lng, lat] = f.geometry.coordinates;
  const e = p.extent;
  return {
    name,
    detail,
    position: { lat, lng },
    bounds: e ? { west: e[0], north: e[1], east: e[2], south: e[3] } : null,
  };
}
