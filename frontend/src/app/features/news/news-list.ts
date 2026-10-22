import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { News } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { NewsCard } from './news-ui';

/** All News. Admins also see drafts and scheduled posts, and can write new ones. Route: /news */
@Component({
  selector: 'zeus-news-list-screen',
  imports: [RouterLink, NgIcon, HlmButton, PageHeader, LoadingSkeleton, EmptyState, ErrorState, NewsCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      <zeus-page-header title="News" subtitle="Updates, sponsors and announcements from the AirsoftHub team." back="/home">
        @if (isAdmin()) {
          <a hlmBtn routerLink="/news/new/edit" class="h-11"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> Write news</a>
        }
      </zeus-page-header>

      @if (loading()) {
        <zeus-loading-skeleton [rows]="5" />
      } @else if (error() && !items().length) {
        <zeus-error-state [error]="error()" (retry)="load()" />
      } @else if (!items().length) {
        <zeus-empty-state icon="lucideNewspaper" title="No news yet" message="Updates and announcements will show up here." />
      } @else {
        <ul class="flex flex-col gap-2" aria-label="News">
          @for (n of items(); track n.id) {
            <li><zeus-news-card [news]="n" /></li>
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
export class NewsListScreen {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly items = signal<News[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<unknown>(null);
  protected readonly isAdmin = computed(() => !!this.auth.user()?.isAdmin);

  constructor() {
    effect(() => {
      this.isAdmin();
      untracked(() => void this.load());
    });
  }

  protected async load(): Promise<void> {
    this.loading.set(!this.items().length);
    this.error.set(null);
    try {
      const page = await this.api.news(null, this.isAdmin());
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
      const page = await this.api.news(cursor, this.isAdmin());
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
