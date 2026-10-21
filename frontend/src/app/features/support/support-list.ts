import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { SupportStatus, SupportTicket } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { SupportTicketCard } from './support-ui';

type View = 'mine' | 'inbox';
type StatusFilter = SupportStatus | 'all';

/**
 * Help & feedback: the player's conversations with the Airsoft Zeus team. Admins also get the
 * inbox with every conversation, filtered by status. Route: /support
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
        <div class="mb-4 flex flex-col gap-2">
          <div class="flex gap-2" role="group" aria-label="Conversations">
            @for (v of views; track v.value) {
              <button type="button" class="tap rounded-sm border px-3 text-sm" [attr.aria-pressed]="view() === v.value"
                [class]="view() === v.value ? 'border-primary bg-primary/10 font-semibold' : 'border-border text-muted-foreground hover:bg-muted'"
                (click)="view.set(v.value)">{{ v.label }}</button>
            }
          </div>
          @if (view() === 'inbox') {
            <div class="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by status">
              @for (f of filters; track f.value) {
                <button type="button" class="tap shrink-0 rounded-sm border px-3 text-sm" [attr.aria-pressed]="status() === f.value"
                  [class]="status() === f.value ? 'border-primary bg-primary/10 font-semibold' : 'border-border text-muted-foreground hover:bg-muted'"
                  (click)="status.set(f.value)">{{ f.label }}</button>
              }
            </div>
          }
        </div>
      }

      @if (loading()) {
        <zeus-loading-skeleton [rows]="4" />
      } @else if (error() && !items().length) {
        <zeus-error-state [error]="error()" (retry)="load()" />
      } @else if (!items().length) {
        @if (inbox()) {
          <zeus-empty-state icon="lucideLifeBuoy" title="Nothing here" message="No conversations with this status." />
        } @else {
          <zeus-empty-state icon="lucideLifeBuoy" title="No messages yet"
            message="Found a bug, something wrong in an event, or have an idea? Write to us: we answer here and you get a notification." />
        }
      } @else {
        <ul class="flex flex-col gap-2" aria-label="Conversations">
          @for (t of items(); track t.id) {
            <li><zeus-support-ticket-card [ticket]="t" [admin]="inbox()" /></li>
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
export class SupportListScreen {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly views: { value: View; label: string }[] = [
    { value: 'inbox', label: 'Inbox' },
    { value: 'mine', label: 'My messages' },
  ];
  protected readonly filters: { value: StatusFilter; label: string }[] = [
    { value: 'open', label: 'To answer' },
    { value: 'answered', label: 'Answered' },
    { value: 'closed', label: 'Closed' },
    { value: 'all', label: 'All' },
  ];

  protected readonly isAdmin = computed(() => !!this.auth.user()?.isAdmin);
  protected readonly view = signal<View>('inbox');
  protected readonly status = signal<StatusFilter>('open');
  protected readonly inbox = computed(() => this.isAdmin() && this.view() === 'inbox');

  protected readonly items = signal<SupportTicket[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<unknown>(null);

  constructor() {
    effect(() => {
      this.inbox();
      this.status();
      untracked(() => void this.load());
    });
  }

  private query(cursor: string | null) {
    const inbox = this.inbox();
    const status = this.status();
    return this.api.supportTickets({ cursor, all: inbox, status: inbox && status !== 'all' ? status : null });
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
