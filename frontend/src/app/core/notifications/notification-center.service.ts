import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, effect, inject, signal } from '@angular/core';
import { ApiService } from '../api/api.service';
import { AppNotification } from '../api/models';
import { AuthService } from '../auth/auth.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ToastService } from '../ui/toast.service';

/** Unread count + live in-app notifications (toasts; vibration for emergencies). */
@Injectable({ providedIn: 'root' })
export class NotificationCenter {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly realtime = inject(RealtimeService);
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly unread = signal(0);
  readonly latest = signal<AppNotification | null>(null);

  constructor() {
    if (!this.isBrowser) return;
    effect(() => {
      if (this.auth.isLoggedIn() && this.auth.isVerified()) void this.refresh();
      else this.unread.set(0);
    });
    this.realtime.on('notification').subscribe((n) => this.receive(n));
  }

  async refresh(): Promise<void> {
    try {
      const page = await this.api.notifications();
      this.unread.set(page.items.filter((n) => !n.read).length);
    } catch {
      /* keep the last count */
    }
  }

  markAllRead(): void {
    this.unread.set(0);
  }

  private receive(n: AppNotification): void {
    this.latest.set(n);
    this.unread.update((c) => c + 1);
    if (n.priority === 'emergency') {
      this.toast.error(n.title, n.body);
      if ('vibrate' in navigator) navigator.vibrate?.([300, 120, 300, 120, 300]);
    } else if (n.priority === 'high') {
      this.toast.warning(n.title, n.body);
      if ('vibrate' in navigator) navigator.vibrate?.(150);
    } else {
      this.toast.info(n.title, n.body);
    }
  }
}
