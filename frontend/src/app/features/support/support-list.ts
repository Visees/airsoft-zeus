import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { SupportTicket } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { SupportTicketCard } from './support-ui';

/**
 * Help & feedback: the player's conversations with the Airsoft Zeus team. Admins answer
 * everyone's from the dashboard (/admin/tickets). Route: /support
 */
@Component({
  selector: 'zeus-support-list-screen',
  imports: [RouterLink, NgIcon, HlmButton, PageHeader, LoadingSkeleton, EmptyState, ErrorState, SupportTicketCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      <zeus-page-header title="Help & feedback" subtitle="Report a bug, flag a problem or write to the Airsoft Zeus team." back="/profile">
        <a hlmBtn routerLink="/support/new" class="h-11"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> New message</a>
      </zeus-page-header>

      @if (isAdmin()) {
        <a routerLink="/admin/tickets" class="panel mb-4 flex min-h-14 items-center gap-3 px-4 hover:bg-muted/60">
          <ng-icon name="lucideInbox" size="18" class="text-muted-foreground" aria-hidden="true" />
          <span class="flex-1">
            <span class="block font-semibold">Admin inbox</span>
            <span class="block text-xs text-muted-foreground">Answer the messages from every player</span>
          </span>
          <ng-icon name="lucideChevronRight" size="16" class="text-muted-foreground" aria-hidden="true" />
        </a>
      }

      @if (loading()) {
        <zeus-loading-skeleton [rows]="4" />
      } @else if (error() && !items().length) {
        <zeus-error-state [error]="error()" (retry)="load()" />
      } @else if (!items().length) {
        <zeus-empty-state icon="lucideLifeBuoy" title="No messages yet"
          message="Found a bug, something wrong in an event, or have an idea? Write to us: we answer here and you get a notification." />
      } @else {
        <ul class="flex flex-col gap-2" aria-label="Conversations">
          @for (t of items(); track t.id) {
            <li><zeus-support-ticket-card [ticket]="t" /></li>
          }
        </ul>
        @if (nextCursor()) {
          <div class="mt-4 flex justify-center">
            <button hlmBtn variant="outline" type="button" class="h-11 min-w-40" [disabled]="loadingMore()" (click)="loadMore()">
              {{ loadingMore() ? 'Loading…' : 'Load more' }}
            </button>
          </div>
        }
      }
    </div>
  `,
})
export class SupportListScreen implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly isAdmin = computed(() => !!this.auth.user()?.isAdmin);

  protected readonly items = signal<SupportTicket[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<unknown>(null);

  ngOnInit(): void {
    void this.load();
  }

  private query(cursor: string | null) {
    return this.api.supportTickets({ cursor });
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
