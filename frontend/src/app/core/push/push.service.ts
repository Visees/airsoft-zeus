import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import type { PermissionStatus } from '@capacitor/push-notifications';
import { ApiService } from '../api/api.service';
import { ConfigService } from '../api/config.service';
import { NativePush } from '../native/native-app';

/** Set when the user turns push off on this device, so a later start doesn't register it again. */
const OPT_OUT_KEY = 'push-off';

/**
 * Push with the app closed. Browsers: Web Push (VAPID) via the Angular service worker. Native apps:
 * the WebView has no Push API, so Firebase Cloud Messaging through @capacitor/push-notifications,
 * with the FCM token stored like a subscription. In-app notifications arrive over the socket.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly swPush = inject(SwPush);
  private readonly api = inject(ApiService);
  private readonly config = inject(ConfigService);
  private readonly router = inject(Router);
  private readonly nativePush = inject(NativePush);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly native = this.isBrowser && this.nativePush.available;
  /** The Android app's WebView runs the service worker but has no Push API. */
  private readonly swPushEnabled = this.isBrowser && !this.native && this.swPush.isEnabled && 'PushManager' in window;
  private nativeToken: string | null = null;

  readonly permission = signal<NotificationPermission | 'unsupported'>('default');
  readonly subscribed = signal(false);

  constructor() {
    if (!this.isBrowser) return;
    if (this.native) {
      void this.initNative();
      return;
    }
    this.permission.set('Notification' in window ? Notification.permission : 'unsupported');
    if (this.swPushEnabled) {
      this.swPush.subscription.subscribe((s) => this.subscribed.set(!!s));
      this.swPush.notificationClicks.subscribe(({ notification }) => {
        const url = (notification.data as { url?: string } | undefined)?.url;
        if (url) void this.router.navigateByUrl(url);
      });
    }
  }

  get supported(): boolean {
    return this.native || (this.swPushEnabled && 'Notification' in window);
  }

  /** Ask permission (must be called from a user gesture) and register the subscription. */
  async enable(): Promise<boolean> {
    if (!this.isBrowser) return false;
    setOptOut(false);
    if (this.native) {
      const { plugin } = await this.nativePush.plugin();
      this.permission.set(toPermission(await plugin.requestPermissions()));
      return this.permission() === 'granted' && this.ensureSubscribed();
    }
    if (!('Notification' in window)) return false;
    const perm = await Notification.requestPermission();
    this.permission.set(perm);
    if (perm !== 'granted') return false;
    return this.ensureSubscribed();
  }

  /** Re-register silently when permission was already granted (after login). */
  async ensureSubscribed(): Promise<boolean> {
    if (!this.supported || optedOut()) return false;
    if (this.native) return this.ensureNativeToken();
    if (Notification.permission !== 'granted') return false;
    const { vapidPublicKey } = await this.config.load();
    if (!vapidPublicKey) return false;
    try {
      const sub = await this.swPush.requestSubscription({ serverPublicKey: vapidPublicKey });
      await this.api.savePushSubscription(sub.toJSON());
      this.subscribed.set(true);
      return true;
    } catch {
      return false;
    }
  }

  async disable(): Promise<void> {
    setOptOut(true);
    if (this.native) {
      const token = this.nativeToken;
      this.nativeToken = null;
      if (token) await this.api.deletePushSubscription(token).catch(() => undefined);
      await (await this.nativePush.plugin()).plugin.unregister().catch(() => undefined);
      this.subscribed.set(false);
      return;
    }
    if (!this.swPushEnabled) return;
    const sub = await new Promise<PushSubscription | null>((resolve) => {
      const s = this.swPush.subscription.subscribe((v) => {
        resolve(v);
        queueMicrotask(() => s.unsubscribe());
      });
    });
    if (sub) {
      await this.api.deletePushSubscription(sub.endpoint).catch(() => undefined);
      await this.swPush.unsubscribe().catch(() => undefined);
    }
    this.subscribed.set(false);
  }

  /*
   * Native. The tap listener is added at start: a tap that launched the app is held by the plugin
   * until a listener exists, then delivered.
   */
  private async initNative(): Promise<void> {
    try {
      const { plugin } = await this.nativePush.plugin();
      await plugin.addListener('pushNotificationActionPerformed', ({ notification }) => {
        const url = (notification.data as { url?: string } | undefined)?.url;
        if (url?.startsWith('/')) void this.router.navigateByUrl(url);
      });
      if (this.nativePush.android) await this.createChannels();
      this.permission.set(toPermission(await plugin.checkPermissions()));
    } catch {
      this.permission.set('unsupported');
    }
  }

  /** Same ids as the server (backend/src/fcm.ts ANDROID_CHANNEL). Users can tune each one in the phone's settings. */
  private async createChannels(): Promise<void> {
    const { plugin } = await this.nativePush.plugin();
    await Promise.all([
      plugin.createChannel({
        id: 'emergency',
        name: $localize`Emergencies`,
        description: $localize`Emergency messages from a Game Master, for example a stop for an injury.`,
        importance: 5,
        visibility: 1,
        vibration: true,
      }),
      plugin.createChannel({
        id: 'alerts',
        name: $localize`Game alerts`,
        description: $localize`Game start and pause, objectives and perks during live events.`,
        importance: 4,
        visibility: 1,
        vibration: true,
      }),
      plugin.createChannel({
        id: 'general',
        name: $localize`General`,
        description: $localize`Invitations, registrations, event changes and support replies.`,
        importance: 3,
        visibility: 1,
      }),
    ]);
  }

  private async ensureNativeToken(): Promise<boolean> {
    try {
      const { plugin } = await this.nativePush.plugin();
      if (toPermission(await plugin.checkPermissions()) !== 'granted') return false;
      const { nativePush } = await this.config.load();
      if (!nativePush) return false;
      const token = await this.registerToken();
      await this.api.savePushSubscription({ fcmToken: token });
      this.nativeToken = token;
      this.subscribed.set(true);
      return true;
    } catch {
      return false;
    }
  }

  /** register() answers with an event, not a value. A new token each start is fine: it replaces the old one. */
  private async registerToken(): Promise<string> {
    const { plugin } = await this.nativePush.plugin();
    return new Promise<string>((resolve, reject) => {
      const handles = [
        plugin.addListener('registration', ({ value }) => finish(() => resolve(value))),
        plugin.addListener('registrationError', ({ error }) => finish(() => reject(new Error(error)))),
      ];
      const timer = setTimeout(() => finish(() => reject(new Error('push registration timed out'))), 15_000);
      function finish(settle: () => void): void {
        clearTimeout(timer);
        for (const h of handles) void h.then((l) => l.remove());
        settle();
      }
      plugin.register().catch((err: unknown) => finish(() => reject(err)));
    });
  }
}

function toPermission(s: PermissionStatus): NotificationPermission {
  return s.receive === 'granted' ? 'granted' : s.receive === 'denied' ? 'denied' : 'default';
}

function optedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

function setOptOut(on: boolean): void {
  try {
    if (on) localStorage.setItem(OPT_OUT_KEY, '1');
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* private mode: the choice lasts until the page reloads */
  }
}
