import { Injectable } from '@angular/core';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import type { GeolocationPlugin } from '@capacitor/geolocation';

/**
 * The Android and iOS apps are a Capacitor shell that loads this site (see capacitor.config.ts).
 * The shell's bridge defines window.Capacitor before the app starts. Plugins are imported only
 * inside the app, so the web bundle never loads them.
 */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    (
      window as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor?.isNativePlatform?.() === true
  );
}

/*
 * A plugin is a proxy that sends every property to the native side, `then` included, so it must
 * never be what a promise resolves to: the promise would call `plugin.then()`, which fails with
 * "then() is not implemented". The loaders resolve to `{ plugin }` instead.
 */
let bgGeo: Promise<{ plugin: BackgroundGeolocationPlugin }> | null = null;
let geo: Promise<{ plugin: GeolocationPlugin }> | null = null;
let core: Promise<typeof import('@capacitor/core')> | null = null;

/*
 * Each module is imported once and the promise kept. About a minute after the screen turns off the
 * WebView stops running its own tasks: an import(), a timer or a fetch never completes, and only
 * callbacks from native code still run. A report sent from a GPS fix callback must therefore not
 * start an import (it would wait forever and no report would go out until the screen is back on).
 */
function capacitorCore(): Promise<typeof import('@capacitor/core')> {
  core ??= import('@capacitor/core');
  return core;
}

/** GPS that keeps running with the screen off (Android shows a notification while it runs). */
function backgroundGeolocation(): Promise<{ plugin: BackgroundGeolocationPlugin }> {
  bgGeo ??= capacitorCore().then(({ registerPlugin }) => ({ plugin: registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation') }));
  return bgGeo;
}

/** Location permission and one-off fixes from the OS (the WebView's own geolocation prompts per site). */
function nativeGeolocation(): Promise<{ plugin: GeolocationPlugin }> {
  geo ??= import('@capacitor/geolocation').then((m) => ({ plugin: m.Geolocation }));
  return geo;
}

/** The app's location plugins, injectable so tests can replace them. */
@Injectable({ providedIn: 'root' })
export class NativeLocation {
  readonly available = isNativeApp();

  async addWatcher(...args: Parameters<BackgroundGeolocationPlugin['addWatcher']>): Promise<string> {
    return (await backgroundGeolocation()).plugin.addWatcher(...args);
  }
  async removeWatcher(id: string): Promise<void> {
    return (await backgroundGeolocation()).plugin.removeWatcher({ id });
  }
  async checkPermissions(): ReturnType<GeolocationPlugin['checkPermissions']> {
    return (await nativeGeolocation()).plugin.checkPermissions();
  }
  async requestPermissions(): ReturnType<GeolocationPlugin['requestPermissions']> {
    return (await nativeGeolocation()).plugin.requestPermissions({ permissions: ['location'] });
  }
  async getCurrentPosition(options: Parameters<GeolocationPlugin['getCurrentPosition']>[0]): ReturnType<GeolocationPlugin['getCurrentPosition']> {
    return (await nativeGeolocation()).plugin.getCurrentPosition(options);
  }
}

export interface NativeResponse {
  status: number;
  data: unknown;
}

/**
 * POST through the OS network stack: with the screen off the WebView's own requests never complete,
 * native ones do. Cookies are shared with the WebView. @capacitor/core is already loaded by then
 * (the location watcher imports it when tracking starts).
 */
export async function nativePost(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<NativeResponse> {
  const { CapacitorHttp } = await capacitorCore();
  const res = await CapacitorHttp.post({
    url: new URL(url, location.origin).href,
    headers: { 'Content-Type': 'application/json', ...headers },
    data: body,
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
  });
  return { status: res.status, data: res.data };
}

/** Save a file and open the share sheet (a WebView ignores `<a download>`). */
export async function shareFile(blob: Blob, filename: string): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const data = await blobToBase64(blob);
  const path = filename.replace(/[\\/:*?"<>|]/g, '_') || 'file';
  const { uri } = await Filesystem.writeFile({ path, data, directory: Directory.Cache });
  await Share.share({ title: filename, files: [uri] });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Hide or show the phone's status and navigation bars (the live map's map-only view). In the app:
 * Capacitor's SystemBars; in a browser: the Fullscreen API (Android Chrome; not on iPhones). Call
 * it from the tap itself: browsers allow fullscreen only during a user gesture.
 */
export function setImmersive(on: boolean): void {
  if (isNativeApp()) {
    void import('@capacitor/core').then(({ SystemBars }) => (on ? SystemBars.hide() : SystemBars.show())).catch(() => undefined);
    return;
  }
  if (typeof document === 'undefined') return;
  if (on && document.fullscreenEnabled && !document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => undefined);
  else if (!on && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}
