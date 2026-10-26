import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { nativePluginAvailable } from './native-app';

/**
 * In the app, a link to the site (Android App Links, iOS Universal Links) opens the app instead of
 * the browser: the OS hands the URL to the shell, and this routes to it, both when the link starts
 * the app and when the app is already open. An app installed before the App plugin was added does
 * nothing here (links keep opening in the browser there anyway: it has no link filter either).
 */
@Injectable({ providedIn: 'root' })
export class DeepLinks {
  private readonly router = inject(Router);

  start(): void {
    if (!nativePluginAvailable('App')) return;
    void import('@capacitor/app').then(async ({ App }) => {
      await App.addListener('appUrlOpen', (e) => this.open(e.url));
      const launch = await App.getLaunchUrl();
      if (launch?.url) this.open(launch.url);
    });
  }

  private open(raw: string): void {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return;
    }
    // only our own site: the app loads it, so its origin is the WebView's
    if (url.origin !== location.origin) return;
    const target = url.pathname + url.search + url.hash;
    if (target !== this.router.url) void this.router.navigateByUrl(target);
  }
}
