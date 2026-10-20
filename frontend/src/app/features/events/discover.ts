import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { EventSummary, GameMode } from '../../core/api/models';
import { GAME_MODE_LABELS } from '../../core/util/format';
import { EventCard } from '../../shared/cards';
import { ConnectionStatus } from '../../shared/link-status';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';

const MODES = Object.entries(GAME_MODE_LABELS) as [GameMode, string][];

/** Public events: search, filters, cursor pagination. */
@Component({
  selector: 'zeus-discover-screen',
  imports: [RouterLink, NgIcon, HlmButton, HlmInput, HlmLabel, EventCard, EmptyState, ErrorState, LoadingSkeleton, PageHeader, ConnectionStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <zeus-page-header title="Discover events" subtitle="Public games you can request to join.">
        <a hlmBtn variant="outline" class="tap" routerLink="/events/join">
          <ng-icon name="lucideKeyRound" size="16" aria-hidden="true" /> Join with a code
        </a>
      </zeus-page-header>

      <form class="panel mb-4 grid gap-3 p-3 sm:grid-cols-[1fr_12rem_11rem]" role="search" (submit)="$event.preventDefault(); flushSearch()">
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="discover-q">Search</label>
          <div class="relative">
            <ng-icon name="lucideSearch" size="16" class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              hlmInput
              id="discover-q"
              type="search"
              class="h-11 pl-9"
              placeholder="Event name, field or town"
              autocomplete="off"
              enterkeyhint="search"
              [value]="searchText()"
              (input)="searchText.set($any($event.target).value)"
            />
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="discover-mode">Game mode</label>
          <select
            id="discover-mode"
            class="h-11 rounded-md border border-input bg-transparent px-2.5 dark:bg-input/30"
            [value]="mode()"
            (change)="mode.set($any($event.target).value)"
          >
            <option value="">All modes</option>
            @for (m of modes; track m[0]) {
              <option [value]="m[0]">{{ m[1] }}</option>
            }
          </select>
        </div>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="discover-from">From date</label>
          <input
            hlmInput
            id="discover-from"
            type="date"
            class="h-11"
            [value]="fromDate()"
            (change)="fromDate.set($any($event.target).value)"
          />
        </div>
      </form>

      <div class="mb-2 flex min-h-6 items-center justify-between gap-2">
        <h2 class="label-caps" aria-live="polite">
          @if (loading()) {
            Searching…
          } @else {
            Events · <span class="num">{{ items().length }}{{ nextCursor() ? '+' : '' }}</span>
          }
        </h2>
        @if (hasFilters()) {
          <button hlmBtn variant="ghost" size="sm" class="tap" type="button" (click)="clearFilters()">
            <ng-icon name="lucideX" size="14" aria-hidden="true" /> Clear filters
          </button>
        }
      </div>

      @if (offline() && items().length) {
        <div class="mb-3 flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning-surface px-3 py-2 text-sm" role="status">
          <span>Showing the last results loaded.</span>
          <zeus-connection-status />
        </div>
      }

      @if (loading() && !items().length) {
        <zeus-loading-skeleton [rows]="5" />
      } @else if (error() && !items().length) {
        <zeus-error-state [error]="error()" (retry)="reload()" />
      } @else if (!items().length) {
        <zeus-empty-state
          icon="lucideSearch"
          [title]="hasFilters() ? 'No events match these filters' : 'No public events scheduled'"
          [message]="hasFilters() ? 'Try another name, mode or date.' : 'Private games are joined with a code from the Game Master.'"
        >
          @if (hasFilters()) {
            <button hlmBtn variant="outline" class="tap" type="button" (click)="clearFilters()">Clear filters</button>
          }
          <a hlmBtn class="tap" routerLink="/events/join">Join with a code</a>
        </zeus-empty-state>
      } @else {
        <ul class="grid gap-3 md:grid-cols-2" [attr.aria-busy]="loading()">
          @for (e of items(); track e.id) {
            <li><zeus-event-card [event]="e" /></li>
          }
        </ul>
        @if (moreError()) {
          <p class="field-error mt-3 text-center" role="alert">{{ moreError() }}</p>
        }
        @if (nextCursor()) {
          <div class="mt-4 flex justify-center">
            <button hlmBtn variant="outline" class="h-11 min-w-40" type="button" [disabled]="loadingMore()" (click)="loadMore()">
              @if (loadingMore()) {
                <ng-icon name="lucideLoader2" size="16" class="animate-spin" aria-hidden="true" /> Loading…
              } @else {
                Load more
              }
            </button>
          </div>
        }
      }

      <a routerLink="/events/join" class="panel mt-6 flex items-center gap-3 p-4 hover:border-primary/60">
        <span class="grid size-11 shrink-0 place-items-center rounded-md bg-muted text-primary" aria-hidden="true">
          <ng-icon name="lucideQrCode" size="22" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block font-semibold">Have a code? Join a private event</span>
          <span class="block text-sm text-muted-foreground">Type the code or scan the invitation QR from your Game Master.</span>
        </span>
        <ng-icon name="lucideChevronRight" size="18" class="text-muted-foreground" aria-hidden="true" />
      </a>
    </div>
  `,
})
export class DiscoverScreen {
  private readonly api = inject(ApiService);

  protected readonly modes = MODES;

  protected readonly searchText = signal('');
  private readonly query = signal('');
  protected readonly mode = signal<GameMode | ''>('');
  protected readonly fromDate = signal('');

  protected readonly items = signal<EventSummary[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<unknown>(null);
  protected readonly moreError = signal<string | null>(null);

  protected readonly hasFilters = computed(() => !!(this.query() || this.mode() || this.fromDate()));
  protected readonly offline = computed(() => {
    const e = this.error();
    return !!e && ApiError.from(e).isNetwork;
  });

  /** Incremented per search so slow responses for old filters are dropped. */
  private requestId = 0;

  constructor() {
    // Debounce typing: 300 ms after the last keystroke.
    effect((onCleanup) => {
      const text = this.searchText().trim();
      const t = setTimeout(() => this.query.set(text), 300);
      onCleanup(() => clearTimeout(t));
    });
    // New first page whenever the filters change.
    effect(() => {
      const params = { q: this.query(), mode: this.mode(), from: this.fromIso() };
      untracked(() => void this.loadFirst(params));
    });
  }

  protected flushSearch(): void {
    this.query.set(this.searchText().trim());
  }

  protected clearFilters(): void {
    this.searchText.set('');
    this.query.set('');
    this.mode.set('');
    this.fromDate.set('');
  }

  protected reload(): void {
    void this.loadFirst({ q: this.query(), mode: this.mode(), from: this.fromIso() });
  }

  protected async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    const id = this.requestId;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const page = await this.api.discover({ q: this.query(), mode: this.mode(), from: this.fromIso(), cursor });
      if (id !== this.requestId) return;
      const seen = new Set(this.items().map((e) => e.id));
      this.items.update((list) => [...list, ...page.items.filter((e) => !seen.has(e.id))]);
      this.nextCursor.set(page.nextCursor);
    } catch (err) {
      if (id === this.requestId) this.moreError.set(ApiError.from(err).message);
    } finally {
      if (id === this.requestId) this.loadingMore.set(false);
    }
  }

  private fromIso(): string {
    const d = this.fromDate();
    if (!d) return '';
    const date = new Date(`${d}T00:00:00`);
    return isNaN(date.getTime()) ? '' : date.toISOString();
  }

  private async loadFirst(params: { q: string; mode: string; from: string }): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    this.loadingMore.set(false);
    this.moreError.set(null);
    try {
      const page = await this.api.discover(params);
      if (id !== this.requestId) return;
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
      this.error.set(null);
    } catch (err) {
      if (id !== this.requestId) return;
      this.error.set(err);
      // Keep the previous list when offline; otherwise the list no longer matches the filters.
      if (!ApiError.from(err).isNetwork) {
        this.items.set([]);
        this.nextCursor.set(null);
      }
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }
}
