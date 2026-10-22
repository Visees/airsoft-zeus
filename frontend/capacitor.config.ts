import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android and iOS apps load the live site (APP_URL) instead of a bundled copy: same origin as
 * the API, so the session cookie, Socket.IO and the service worker work as in the browser, and a
 * web deploy updates the apps too. The native part is only what a browser can't do: GPS with the
 * screen off (see LocationTracker), native HTTP for location reports, and sharing files.
 *
 * APP_URL is read when the native projects are synced (`npx cap sync`), so set it then:
 *   APP_URL=https://staging.example npx cap sync
 * For a phone on the same Wi-Fi as a dev machine: APP_URL=http://192.168.1.20:4200 (cleartext is
 * allowed only for http URLs).
 */
const appUrl = process.env['APP_URL'] ?? 'https://airsoftzeus.visedev.it';

const config: CapacitorConfig = {
  // Permanent once published in the stores.
  appId: 'app.airsofthub',
  appName: 'AirsoftHub',
  // Shown only when the site can't be reached (errorPath); the app itself comes from appUrl.
  webDir: 'native/www',
  server: {
    url: appUrl,
    cleartext: appUrl.startsWith('http://'),
    errorPath: 'index.html',
  },
  android: {
    // The background location plugin stops delivering after ~5 minutes in the background with the
    // newer bridge (capacitor-community/background-geolocation#89).
    useLegacyBridge: true,
  },
};

export default config;
