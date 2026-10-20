import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { ApiService } from '../api/api.service';
import { ConfigService } from '../api/config.service';

/** Web Push (VAPID) via the Angular service worker. In-app notifications arrive over the socket. */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly swPush = inject(SwPush);
  private readonly api = inject(ApiService);
  private readonly config = inject(ConfigService);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly permission = signal<NotificationPermission | 'unsupported'>('default');
  readonly subscribed = signal(false);

  constructor() {
    if (!this.isBrowser) return;
    this.permission.set('Notification' in window ? Notification.permission : 'unsupported');
    if (this.swPush.isEnabled) {
      this.swPush.subscription.subscribe((s) => this.subscribed.set(!!s));
      this.swPush.notificationClicks.subscribe(({ notification }) => {
        const url = (notification.data as { url?: string } | undefined)?.url;
        if (url) void this.router.navigateByUrl(url);
      });
    }
  }

  get supported(): boolean {
    return this.isBrowser && 'Notification' in window && this.swPush.isEnabled;
  }

  /** Ask permission (must be called from a user gesture) and register the subscription. */
  async enable(): Promise<boolean> {
    if (!this.isBrowser || !('Notification' in window)) return false;
    const perm = await Notification.requestPermission();
    this.permission.set(perm);
    if (perm !== 'granted') return false;
    return this.ensureSubscribed();
  }

  /** Re-register silently when permission was already granted (after login). */
  async ensureSubscribed(): Promise<boolean> {
    if (!this.supported || Notification.permission !== 'granted') return false;
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
    if (!this.swPush.isEnabled) return;
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
}
