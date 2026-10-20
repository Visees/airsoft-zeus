import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';

export type LinkState = 'online' | 'degraded' | 'offline';

/**
 * Network state shown in the UI. Combines the browser's online flag with the realtime
 * socket state and the time of the last successful server sync.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly browserOnline = signal(true);
  readonly socketConnected = signal(false);
  /** epoch ms of the last successful API/socket sync */
  readonly lastSyncAt = signal<number | null>(null);

  readonly state = computed<LinkState>(() => {
    if (!this.browserOnline()) return 'offline';
    return this.socketConnected() ? 'online' : 'degraded';
  });

  constructor() {
    if (this.isBrowser) {
      this.browserOnline.set(navigator.onLine);
      window.addEventListener('online', () => this.browserOnline.set(true));
      window.addEventListener('offline', () => this.browserOnline.set(false));
    }
  }

  markSynced(): void {
    this.lastSyncAt.set(Date.now());
  }
}
