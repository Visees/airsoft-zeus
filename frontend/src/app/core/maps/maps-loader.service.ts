import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { ConfigService } from '../api/config.service';

export type MapsState = 'idle' | 'loading' | 'ready' | 'unavailable';

/**
 * Loads the Google Maps JavaScript API once, with the key from /api/config.
 * When there is no key or no network the maps fall back to the offline schematic renderer.
 */
@Injectable({ providedIn: 'root' })
export class MapsLoaderService {
  private readonly doc = inject(DOCUMENT);
  private readonly config = inject(ConfigService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private loading: Promise<boolean> | null = null;

  readonly state = signal<MapsState>('idle');

  load(): Promise<boolean> {
    if (!this.isBrowser) return Promise.resolve(false);
    if (typeof google !== 'undefined' && google.maps?.Map) {
      this.state.set('ready');
      return Promise.resolve(true);
    }
    this.loading ??= this.inject();
    return this.loading;
  }

  get mapId(): string | null {
    return this.config.config().googleMapsMapId;
  }

  private async inject(): Promise<boolean> {
    this.state.set('loading');
    const { googleMapsApiKey } = await this.config.load();
    if (!googleMapsApiKey || !navigator.onLine) {
      this.state.set('unavailable');
      this.loading = null;
      return false;
    }
    const ok = await new Promise<boolean>((resolve) => {
      const cbName = `__zeusMapsReady${Date.now()}`;
      (window as unknown as Record<string, unknown>)[cbName] = () => resolve(true);
      const script = this.doc.createElement('script');
      const params = new URLSearchParams({
        key: googleMapsApiKey,
        v: 'weekly',
        libraries: 'marker,geometry,places',
        loading: 'async',
        callback: cbName,
      });
      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      script.async = true;
      script.onerror = () => resolve(false);
      this.doc.head.appendChild(script);
      setTimeout(() => resolve(typeof google !== 'undefined' && !!google.maps?.Map), 20_000);
    });
    this.state.set(ok ? 'ready' : 'unavailable');
    if (!ok) this.loading = null;
    return ok;
  }
}
