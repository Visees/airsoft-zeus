import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import type { StyleSpecification } from 'maplibre-gl';
import { ConfigService } from '../api/config.service';
import type { BaseLayer } from './map-style';

export type MapsState = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface MapEngine {
  maplibregl: typeof import('maplibre-gl');
  style(base: BaseLayer, dark: boolean): StyleSpecification;
  patternImage(id: string, dark: boolean): { width: number; height: number; data: Uint8Array } | null;
}

/**
 * Loads the MapLibre renderer once, on demand (it is a large chunk, kept out of the main bundle),
 * and registers the elevation source that draws contour lines and relief.
 * Offline, or when the chunk can't load, the maps fall back to the schematic renderer.
 */
@Injectable({ providedIn: 'root' })
export class MapEngineService {
  private readonly config = inject(ConfigService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private loading: Promise<MapEngine | null> | null = null;

  readonly state = signal<MapsState>('idle');
  /** Satellite imagery needs an ArcGIS key in the server config; without it only the topo map shows. */
  readonly satelliteAvailable = computed(() => !!this.config.config().esriApiKey);

  load(): Promise<MapEngine | null> {
    if (!this.isBrowser) return Promise.resolve(null);
    this.loading ??= this.init();
    return this.loading;
  }

  private async init(): Promise<MapEngine | null> {
    this.state.set('loading');
    if (!navigator.onLine) return this.fail();
    try {
      const [ml, contour, styles, cfg] = await Promise.all([import('maplibre-gl'), import('maplibre-contour'), import('./map-style'), this.config.load()]);
      const maplibregl = ((ml as { default?: typeof import('maplibre-gl') }).default ?? ml) as typeof import('maplibre-gl');
      const dem = new contour.default.DemSource({ url: styles.DEM_TILES, encoding: 'terrarium', maxzoom: styles.DEM_MAXZOOM, worker: true });
      dem.setupMaplibre(maplibregl);
      const demUrl = dem.sharedDemProtocolUrl;
      const contourUrl = dem.contourProtocolUrl({ thresholds: styles.CONTOUR_THRESHOLDS, elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours' });
      this.state.set('ready');
      return {
        maplibregl,
        style: (base, dark) => styles.mapStyle({ base, dark, demUrl, contourUrl, satelliteKey: cfg.esriApiKey }),
        patternImage: styles.patternImage,
      };
    } catch {
      return this.fail();
    }
  }

  private fail(): null {
    this.state.set('unavailable');
    this.loading = null;
    return null;
  }
}
