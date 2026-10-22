import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { News, NewsCategory } from '../../core/api/models';
import { formatDate } from '../../core/util/format';
import { ChipSpec, StatusChip } from '../../shared/status-chip';

export const NEWS_CATEGORY_LABELS: Record<NewsCategory, string> = {
  update: $localize`Update`,
  sponsor: $localize`Sponsor`,
  announcement: $localize`Announcement`,
  event: $localize`Event`,
};

const CATEGORY_CHIPS: Record<NewsCategory, ChipSpec> = {
  update: { label: $localize`Update`, glyph: '↻', tone: 'nav' },
  sponsor: { label: $localize`Sponsor`, glyph: '★', tone: 'warning' },
  announcement: { label: $localize`Announcement`, glyph: '!', tone: 'primary' },
  event: { label: $localize`Event`, glyph: '◆', tone: 'neutral' },
};

export const newsCategoryChip = (c: NewsCategory): ChipSpec => CATEGORY_CHIPS[c] ?? CATEGORY_CHIPS.update;

export type NewsState = 'draft' | 'scheduled' | 'published';

export function newsState(n: News, now = Date.now()): NewsState {
  if (!n.publishedAt) return 'draft';
  return Date.parse(n.publishedAt) > now ? 'scheduled' : 'published';
}

/** External links open in a new tab; app paths stay in the app. */
export function isExternalLink(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** News in lists (home, /news). Whole card is a link to the article. */
@Component({
  selector: 'zeus-news-card',
  imports: [RouterLink, NgIcon, StatusChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block [contain:inline-size]' },
  template: `
    @let n = news();
    <a
      [routerLink]="['/news', n.id]"
      class="panel group flex overflow-hidden transition-colors hover:border-primary/60 focus-visible:border-primary"
      [class.border-primary/40!]="n.pinned"
    >
      <div class="relative w-24 shrink-0 bg-muted sm:w-32">
        @if (n.imageUrl) {
          <img [src]="n.imageUrl" alt="" class="absolute inset-0 size-full object-cover" loading="lazy" />
        } @else {
          <div class="absolute inset-0 grid place-items-center text-muted-foreground">
            <ng-icon name="lucideNewspaper" size="28" aria-hidden="true" />
          </div>
        }
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <div class="flex flex-wrap items-center gap-1.5">
          <zeus-status-chip [spec]="chip()" />
          @if (n.pinned) {
            <span class="inline-flex items-center gap-1 text-xs font-semibold text-primary"><ng-icon name="lucidePin" size="12" aria-hidden="true" /> <ng-container i18n>Pinned</ng-container></span>
          }
          @if (state() === 'draft') {
            <span class="rounded-sm border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground" i18n>Draft</span>
          } @else if (state() === 'scheduled') {
            <span class="rounded-sm bg-warning-surface px-1.5 py-0.5 text-xs font-semibold text-warning" i18n>◷ Scheduled</span>
          }
        </div>
        <h3 class="line-clamp-2 text-base font-bold uppercase group-hover:text-primary">{{ n.title }}</h3>
        @if (n.summary) {
          <p class="line-clamp-2 text-sm text-muted-foreground">{{ n.summary }}</p>
        }
        <p class="num mt-auto text-xs text-muted-foreground">{{ date() }}</p>
      </div>
    </a>
  `,
})
export class NewsCard {
  readonly news = input.required<News>();
  protected readonly chip = computed(() => newsCategoryChip(this.news().category));
  protected readonly state = computed(() => newsState(this.news()));
  protected readonly date = computed(() => {
    const n = this.news();
    return n.publishedAt ? formatDate(n.publishedAt) : $localize`Created ${formatDate(n.createdAt)}:createdAt:`;
  });
}
