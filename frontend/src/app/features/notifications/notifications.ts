import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { AppNotification } from '../../core/api/models';
import { NotificationCenter } from '../../core/notifications/notification-center.service';
import { ToastService } from '../../core/ui/toast.service';
import { nowSignal } from '../../shared/game-timer';
import { ConnectionStatus } from '../../shared/link-status';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { NotificationRow, notificationLink } from './notification-ui';

@Component({
  selector: 'zeus-notifications-screen',
  imports: [NgIcon, HlmButton, PageHeader, LoadingSkeleton, EmptyState, ErrorState, ConnectionStatus, NotificationRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      <zeus-page-header title="Notifications" [subtitle]="subtitle()" i18n-title>
        @if (unreadCount() > 0) {
          <button hlmBtn variant="outline" type="button" class="h-11" [disabled]="markingAll()" (click)="markAllRead()">
            <ng-icon name="lucideCheck" size="16" aria-hidden="true" /> {{ markingAll() ? txt.marking : txt.markAllRead }}
          </button>
        }
      </zeus-page-header>

      @if (loading()) {
        <zeus-loading-skeleton [rows]="6" [avatar]="true" />
      } @else if (error() && !items().length) {
        <zeus-error-state [error]="error()" (retry)="load()" />
      } @else if (!items().length) {
        <zeus-empty-state icon="lucideBell" title="No notifications yet"
          message="Invitations, registration updates and messages from Game Masters will appear here." i18n-title i18n-message />
      } @else {
        @if (error()) {
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted p-3 text-sm" role="status">
            <zeus-connection-status />
            <span class="text-muted-foreground" i18n>Showing the last loaded notifications.</span>
          </div>
        }
        <ul class="panel divide-y divide-border overflow-hidden" aria-label="Notifications" i18n-aria-label>
          @for (n of items(); track n.id) {
            <li>
              <zeus-notification-row [notification]="n" [now]="now()" [clamp]="expandedId() !== n.id" (open)="open($event)" />
            </li>
          }
        </ul>
        @if (nextCursor()) {
          <div class="mt-4 flex justify-center">
            <button hlmBtn variant="outline" type="button" class="h-11 min-w-40" [disabled]="loadingMore()" (click)="loadMore()">
              @if (loadingMore()) {
                <ng-icon name="lucideLoader2" size="16" class="animate-spin" aria-hidden="true" /> <ng-container i18n>Loading…</ng-container>
              } @else {
                <ng-container i18n>Load more</ng-container>
              }
            </button>
          </div>
        } @else {
          <p class="mt-4 text-center text-xs text-muted-foreground" i18n>That's everything.</p>
        }
      }
    </div>
  `,
})
export class NotificationsScreen implements OnInit {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    marking: $localize`Marking…`,
    markAllRead: $localize`Mark all read`,
  };

  private readonly api = inject(ApiService);
  private readonly center = inject(NotificationCenter);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly items = signal<AppNotification[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly markingAll = signal(false);
  protected readonly error = signal<unknown>(null);
  protected readonly expandedId = signal<string | null>(null);
  protected readonly now = nowSignal(30_000);

  protected readonly unreadCount = computed(() => this.items().filter((n) => !n.read).length);
  protected readonly subtitle = computed(() => {
    const c = this.unreadCount();
    if (c) return this.nextCursor() ? $localize`${c}:count: unread on this page` : $localize`${c}:count: unread`;
    return this.items().length ? $localize`All caught up` : null;
  });

  constructor() {
    // Live notifications arriving over the socket are prepended.
    effect(() => {
      const n = this.center.latest();
      if (!n) return;
      untracked(() => {
        if (!this.loading() && !this.items().some((x) => x.id === n.id)) this.items.update((list) => [n, ...list]);
      });
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(!this.items().length);
    this.error.set(null);
    try {
      const page = await this.api.notifications();
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
    } catch (e) {
      this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }

  protected async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor) return;
    this.loadingMore.set(true);
    try {
      const page = await this.api.notifications(cursor);
      const seen = new Set(this.items().map((n) => n.id));
      this.items.update((list) => [...list, ...page.items.filter((n) => !seen.has(n.id))]);
      this.nextCursor.set(page.nextCursor);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loadingMore.set(false);
    }
  }

  protected async open(n: AppNotification): Promise<void> {
    if (!n.read) {
      this.items.update((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      this.center.unread.update((c) => Math.max(0, c - 1));
      void this.api.markNotificationsRead([n.id]).catch(() => undefined);
    }
    const link = notificationLink(n);
    if (link) await this.router.navigateByUrl(link);
    else this.expandedId.set(this.expandedId() === n.id ? null : n.id);
  }

  protected async markAllRead(): Promise<void> {
    this.markingAll.set(true);
    try {
      await this.api.markNotificationsRead('all');
      this.items.update((list) => list.map((n) => (n.read ? n : { ...n, read: true })));
      this.center.markAllRead();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.markingAll.set(false);
    }
  }
}
