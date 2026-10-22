import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { AdminOverview, News, SupportStatus, SupportTicket } from '../../core/api/models';
import { formatNumber } from '../../core/util/format';
import { ToastService } from '../../core/ui/toast.service';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { NewsCard } from '../news/news-ui';
import { SupportTicketCard } from '../support/support-ui';

type Tab = 'tickets' | 'news';
type StatusFilter = SupportStatus | 'all';

/** Every support conversation, filtered by status. */
@Component({
  selector: 'zeus-admin-tickets',
  imports: [HlmButton, LoadingSkeleton, EmptyState, ErrorState, SupportTicketCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mb-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by status" i18n-aria-label>
      @for (f of filters(); track f.value) {
        <button type="button" class="tap shrink-0 rounded-sm border px-3 text-sm" [attr.aria-pressed]="status() === f.value"
          [class]="status() === f.value ? 'border-primary bg-primary/10 font-semibold' : 'border-border text-muted-foreground hover:bg-muted'"
          (click)="status.set(f.value)">
          {{ f.label }}
          @if (f.count !== null) {
            <span class="num ml-1 text-xs">{{ f.count }}</span>
          }
        </button>
      }
    </div>

    @if (loading()) {
      <zeus-loading-skeleton [rows]="4" />
    } @else if (error() && !items().length) {
      <zeus-error-state [error]="error()" (retry)="load()" />
    } @else if (!items().length) {
      <zeus-empty-state icon="lucideLifeBuoy" title="Nothing here" [message]="status() === 'open' ? txt.noConversationIsWaiting : txt.noConversationsWithThis" i18n-title />
    } @else {
      <ul class="flex flex-col gap-2" aria-label="Conversations" i18n-aria-label>
        @for (t of items(); track t.id) {
          <li><zeus-support-ticket-card [ticket]="t" [admin]="true" /></li>
        }
      </ul>
      @if (nextCursor()) {
        <div class="mt-4 flex justify-center">
          <button hlmBtn variant="outline" type="button" class="h-11 min-w-40" [disabled]="loadingMore()" (click)="loadMore()">
            {{ loadingMore() ? txt.loading : txt.loadMore }}
          </button>
        </div>
      }
    }
  `,
})
export class AdminTickets {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    loading: $localize`Loading…`,
    loadMore: $localize`Load more`,
    noConversationIsWaiting: $localize`No conversation is waiting for an answer.`,
    noConversationsWithThis: $localize`No conversations with this status.`,
  };

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly overview = input<AdminOverview | null>(null);

  protected readonly status = signal<StatusFilter>('open');
  protected readonly filters = computed(() => {
    const c = this.overview()?.tickets;
    return [
      { value: 'open' as const, label: $localize`To answer`, count: c?.open ?? null },
      { value: 'answered' as const, label: $localize`Answered`, count: c?.answered ?? null },
      { value: 'closed' as const, label: $localize`Closed`, count: c?.closed ?? null },
      { value: 'all' as const, label: $localize`All`, count: null },
    ];
  });

  protected readonly items = signal<SupportTicket[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<unknown>(null);

  constructor() {
    effect(() => {
      this.status();
      untracked(() => void this.load());
    });
  }

  private query(cursor: string | null) {
    const status = this.status();
    return this.api.supportTickets({ cursor, all: true, status: status === 'all' ? null : status });
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.query(null);
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
    } catch (e) {
      this.items.set([]);
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
      const page = await this.query(cursor);
      const seen = new Set(this.items().map((t) => t.id));
      this.items.update((list) => [...list, ...page.items.filter((t) => !seen.has(t.id))]);
      this.nextCursor.set(page.nextCursor);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loadingMore.set(false);
    }
  }
}

/** All News, drafts and scheduled posts included. */
@Component({
  selector: 'zeus-admin-news',
  imports: [RouterLink, HlmButton, LoadingSkeleton, EmptyState, ErrorState, NewsCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (loading()) {
      <zeus-loading-skeleton [rows]="5" />
    } @else if (error() && !items().length) {
      <zeus-error-state [error]="error()" (retry)="load()" />
    } @else if (!items().length) {
      <zeus-empty-state icon="lucideNewspaper" title="No news yet" message="Published news shows up on everyone's home page." i18n-title i18n-message>
        <a hlmBtn routerLink="/news/new/edit" class="h-11" i18n>Write the first one</a>
      </zeus-empty-state>
    } @else {
      <ul class="flex flex-col gap-2" aria-label="News" i18n-aria-label>
        @for (n of items(); track n.id) {
          <li><zeus-news-card [news]="n" /></li>
        }
      </ul>
      @if (nextCursor()) {
        <div class="mt-4 flex justify-center">
          <button hlmBtn variant="outline" type="button" class="h-11 min-w-40" [disabled]="loadingMore()" (click)="loadMore()">
            {{ loadingMore() ? txt.loading : txt.loadMore }}
          </button>
        </div>
      }
    }
  `,
})
export class AdminNews {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    loading: $localize`Loading…`,
    loadMore: $localize`Load more`,
  };

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  protected readonly items = signal<News[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<unknown>(null);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.news(null, true);
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
      const page = await this.api.news(cursor, true);
      const seen = new Set(this.items().map((n) => n.id));
      this.items.update((list) => [...list, ...page.items.filter((n) => !seen.has(n.id))]);
      this.nextCursor.set(page.nextCursor);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loadingMore.set(false);
    }
  }
}

/**
 * Platform admin dashboard (ADMIN_EMAILS): support conversations from every player and the News
 * on the home page. Route: /admin/:tab (tickets | news), behind adminGuard.
 */
@Component({
  selector: 'zeus-admin-dashboard-screen',
  imports: [RouterLink, NgIcon, HlmButton, PageHeader, AdminTickets, AdminNews],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      <zeus-page-header title="Admin" subtitle="Support conversations from every player and the News on the home page." back="/profile" i18n-title i18n-subtitle>
        <a hlmBtn routerLink="/news/new/edit" class="h-11"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> <ng-container i18n>Write news</ng-container></a>
      </zeus-page-header>

      <dl class="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Summary" i18n-aria-label>
        @for (t of tiles(); track t.label) {
          <div class="panel relative flex flex-col gap-1 p-3 transition-colors hover:border-primary/60" [class.border-warning!]="t.alert">
            <dt class="label-caps flex items-center gap-1.5"><ng-icon [name]="t.icon" size="13" aria-hidden="true" />{{ t.label }}</dt>
            <dd class="num text-2xl font-bold">
              <a [routerLink]="['/admin', t.tab]" class="after:absolute after:inset-0">{{ t.value }}</a>
            </dd>
          </div>
        }
      </dl>

      <nav class="mb-4 flex gap-2 border-b border-border" aria-label="Admin sections" i18n-aria-label>
        @for (t of tabs; track t.value) {
          <a [routerLink]="['/admin', t.value]" [attr.aria-current]="current() === t.value ? 'page' : null"
            class="tap -mb-px inline-flex items-center gap-2 border-b-2 px-3 text-sm"
            [class]="current() === t.value ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'">
            <ng-icon [name]="t.icon" size="16" aria-hidden="true" /> {{ t.label }}
          </a>
        }
      </nav>

      @if (current() === 'news') {
        <zeus-admin-news />
      } @else {
        <zeus-admin-tickets [overview]="overview()" />
      }
    </div>
  `,
})
export class AdminDashboardScreen {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly tab = input<string>('tickets');
  protected readonly current = computed<Tab>(() => (this.tab() === 'news' ? 'news' : 'tickets'));

  protected readonly tabs: { value: Tab; label: string; icon: string }[] = [
    { value: 'tickets', label: $localize`Tickets`, icon: 'lucideLifeBuoy' },
    { value: 'news', label: $localize`News`, icon: 'lucideNewspaper' },
  ];

  protected readonly overview = signal<AdminOverview | null>(null);
  protected readonly tiles = computed(() => {
    const o = this.overview();
    const n = (v: number | undefined) => (v === undefined ? '—' : formatNumber(v));
    return [
      { label: $localize`To answer`, value: n(o?.tickets.open), icon: 'lucideInbox', tab: 'tickets', alert: !!o?.tickets.open },
      { label: $localize`Open bugs`, value: n(o?.tickets.openBugs), icon: 'lucideBug', tab: 'tickets', alert: false },
      { label: $localize`Scheduled`, value: n(o?.news.scheduled), icon: 'lucideClock', tab: 'news', alert: false },
      { label: $localize`Drafts`, value: n(o?.news.drafts), icon: 'lucidePencil', tab: 'news', alert: false },
    ];
  });

  constructor() {
    void this.loadOverview();
  }

  private async loadOverview(): Promise<void> {
    try {
      this.overview.set(await this.api.adminOverview());
    } catch (e) {
      this.toast.error(e);
    }
  }
}
