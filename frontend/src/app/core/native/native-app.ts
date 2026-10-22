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

let bgGeo: Promise<BackgroundGeolocationPlugin> | null = null;

/** GPS that keeps running with the screen off (Android shows a notification while it runs). */
export function backgroundGeolocation(): Promise<BackgroundGeolocationPlugin> {
  bgGeo ??= import('@capacitor/core').then(({ registerPlugin }) =>
    registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation'),
  );
  return bgGeo;
}

/** Location permission and one-off fixes from the OS (the WebView's own geolocation prompts per site). */
export function nativeGeolocation(): Promise<GeolocationPlugin> {
  return import('@capacitor/geolocation').then((m) => m.Geolocation);
}

/** The app's location plugins, injectable so tests can replace them. */
@Injectable({ providedIn: 'root' })
export class NativeLocation {
  readonly available = isNativeApp();
  background(): Promise<BackgroundGeolocationPlugin> {
    return backgroundGeolocation();
  }
  geolocation(): Promise<GeolocationPlugin> {
    return nativeGeolocation();
  }
}

export interface NativeResponse {
  status: number;
  data: unknown;
}

/**
 * POST through the OS network stack. Android throttles requests made by a WebView that has been in
 * the background for a few minutes; native requests are not throttled.
 */
export async function nativePost(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<NativeResponse> {
  const { CapacitorHttp } = await import('@capacitor/core');
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
