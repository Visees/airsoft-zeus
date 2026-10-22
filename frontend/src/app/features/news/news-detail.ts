import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { News } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { formatDate } from '../../core/util/format';
import { ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { StatusChip } from '../../shared/status-chip';
import { isExternalLink, newsCategoryChip, newsState } from './news-ui';

/** One News article. Route: /news/:newsId */
@Component({
  selector: 'zeus-news-detail-screen',
  imports: [RouterLink, NgIcon, HlmButton, PageHeader, LoadingSkeleton, ErrorState, StatusChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      <zeus-page-header title="News" back="/news" backLabel="All news" i18n-title i18n-backLabel>
        @if (isAdmin() && news(); as n) {
          <a hlmBtn variant="outline" [routerLink]="['/news', n.id, 'edit']" class="h-11"><ng-icon name="lucidePencil" size="16" aria-hidden="true" /> <ng-container i18n>Edit</ng-container></a>
        }
      </zeus-page-header>

      @if (loading()) {
        <zeus-loading-skeleton [rows]="6" />
      } @else if (!news()) {
        <zeus-error-state [error]="error()" (retry)="load()" />
      } @else {
        @let n = news()!;
        <article class="flex flex-col gap-4" aria-labelledby="news-title">
          <h2 id="news-title" class="text-2xl uppercase sm:text-3xl">{{ n.title }}</h2>
          <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <zeus-status-chip [spec]="chip(n)" />
            @if (state(n) === 'draft') {
              <span class="rounded-sm border border-dashed border-border px-1.5 py-0.5 text-xs" i18n>Draft: only admins can see it</span>
            } @else if (state(n) === 'scheduled') {
              <span class="rounded-sm bg-warning-surface px-1.5 py-0.5 text-xs font-semibold text-warning" i18n>◷ Scheduled for {{ date(n.publishedAt) }}</span>
            } @else {
              <span class="num">{{ date(n.publishedAt) }}</span>
            }
            @if (n.authorNickname) {
              <span>· {{ n.authorNickname }}</span>
            }
          </div>
          @if (n.imageUrl) {
            <img [src]="n.imageUrl" alt="" class="aspect-video w-full rounded-md border border-border object-cover" />
          }
          @if (n.summary) {
            <p class="text-lg font-semibold">{{ n.summary }}</p>
          }
          @for (p of paragraphs(); track $index) {
            <p class="whitespace-pre-line leading-relaxed">{{ p }}</p>
          }
          @if (n.linkUrl) {
            @if (external(n.linkUrl)) {
              <a hlmBtn [href]="n.linkUrl" target="_blank" rel="noopener noreferrer" class="h-12 self-start">
                {{ n.linkLabel || txt.openLink }} <ng-icon name="lucideExternalLink" size="16" aria-hidden="true" />
              </a>
            } @else {
              <a hlmBtn [routerLink]="n.linkUrl" class="h-12 self-start">
                {{ n.linkLabel || txt.open }} <ng-icon name="lucideArrowRight" size="16" aria-hidden="true" />
              </a>
            }
          }
        </article>
      }
    </div>
  `,
})
export class NewsDetailScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    openLink: $localize`Open link`,
    open: $localize`Open`,
  };

  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  readonly newsId = input.required<string>();

  protected readonly news = signal<News | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<unknown>(null);
  protected readonly isAdmin = computed(() => !!this.auth.user()?.isAdmin);
  protected readonly paragraphs = computed(() =>
    (this.news()?.body ?? '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean),
  );

  protected readonly chip = (n: News) => newsCategoryChip(n.category);
  protected readonly state = (n: News) => newsState(n);
  protected readonly external = isExternalLink;
  protected readonly date = formatDate;

  constructor() {
    effect(() => {
      this.newsId();
      untracked(() => void this.load());
    });
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.news.set(await this.api.newsItem(this.newsId()));
    } catch (e) {
      this.news.set(null);
      this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }
}
