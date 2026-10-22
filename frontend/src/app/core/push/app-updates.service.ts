import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { toast } from '@spartan-ng/brain/sonner';
import { filter } from 'rxjs';

/**
 * Keeps the PWA on the deployed version. Outside a game a new version is applied at once;
 * during a live game or in the control center the user decides when to reload.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdates {
  private readonly sw = inject(SwUpdate);
  private readonly doc = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  start(): void {
    if (!this.isBrowser || !this.sw.isEnabled) return;
    this.sw.unrecoverable.subscribe(() => this.doc.location.reload());
    this.sw.versionUpdates.pipe(filter((e) => e.type === 'VERSION_READY')).subscribe(() => {
      const path = this.doc.location.pathname;
      const inGame = /\/live(\/|$)/.test(path) || /\/control$/.test(path) || /\/map$/.test(path);
      if (!inGame) {
        this.doc.location.reload();
        return;
      }
      toast.info($localize`A new version of AirsoftHub is ready`, {
        description: $localize`Reload when you have a moment; nothing is lost.`,
        duration: Infinity,
        action: { label: $localize`Reload`, onClick: () => this.doc.location.reload() },
      });
    });
    // Check for a new version every 10 minutes while the app is open, and when it comes back to the
    // foreground (phones keep the Android app and installed PWAs in the background for days).
    const check = () => void this.sw.checkForUpdate().catch(() => undefined);
    setInterval(check, 10 * 60_000);
    let lastCheck = 0;
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState !== 'visible' || Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      check();
    });
  }
}
