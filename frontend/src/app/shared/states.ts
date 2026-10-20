import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiError } from '../core/api/api-error';

/** Skeleton rows for list-shaped content. */
@Component({
  selector: 'zeus-loading-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', role: 'status', 'aria-label': 'Loading' },
  template: `
    <div class="flex flex-col gap-2" aria-hidden="true">
      @for (r of rowsArray(); track $index) {
        <div class="panel flex items-center gap-3 p-3">
          @if (avatar()) {
            <div class="size-10 shrink-0 animate-pulse rounded-full bg-muted"></div>
          }
          <div class="flex flex-1 flex-col gap-2">
            <div class="h-3.5 w-2/5 animate-pulse rounded-sm bg-muted"></div>
            <div class="h-3 w-4/5 animate-pulse rounded-sm bg-muted"></div>
          </div>
        </div>
      }
    </div>
    <span class="sr-only">Loading…</span>
  `,
})
export class LoadingSkeleton {
  readonly rows = input(4);
  readonly avatar = input(false);
  protected readonly rowsArray = computed(() => Array.from({ length: this.rows() }));
}

/** Empty state: what will appear here and the action that fills it (project actions into it). */
@Component({
  selector: 'zeus-empty-state',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-6 py-10 text-center">
      <ng-icon [name]="icon()" size="28" class="text-muted-foreground" aria-hidden="true" />
      <div>
        <p class="font-semibold">{{ title() }}</p>
        @if (message()) {
          <p class="mt-1 max-w-prose text-sm text-muted-foreground">{{ message() }}</p>
        }
      </div>
      <div class="flex flex-wrap justify-center gap-2"><ng-content /></div>
    </div>
  `,
})
export class EmptyState {
  readonly icon = input('lucideInfo');
  readonly title = input.required<string>();
  readonly message = input<string | null>(null);
}

/** Error state: what failed, and a retry action. */
@Component({
  selector: 'zeus-error-state',
  imports: [NgIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', role: 'alert' },
  template: `
    <div class="flex flex-col items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-6 py-8 text-center">
      <ng-icon [name]="isNetwork() ? 'lucideWifiOff' : 'lucideTriangleAlert'" size="28" class="text-destructive" aria-hidden="true" />
      <div>
        <p class="font-semibold">{{ title() || (isNetwork() ? 'You are offline' : 'Could not load this') }}</p>
        <p class="mt-1 max-w-prose text-sm text-muted-foreground">{{ message() }}</p>
      </div>
      <div class="flex flex-wrap justify-center gap-2">
        @if (showRetry()) {
          <button hlmBtn variant="outline" class="tap" type="button" (click)="retry.emit()">
            <ng-icon name="lucideRefreshCw" size="16" aria-hidden="true" /> Try again
          </button>
        }
        <ng-content />
      </div>
    </div>
  `,
})
export class ErrorState {
  readonly error = input<unknown>(null);
  readonly title = input<string | null>(null);
  readonly showRetry = input(true);
  readonly retry = output<void>();
  protected readonly isNetwork = computed(() => ApiError.from(this.error()).isNetwork);
  protected readonly message = computed(() => ApiError.from(this.error()).message);
}

/** Page title row with optional back link and actions slot. */
@Component({
  selector: 'zeus-page-header',
  imports: [NgIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mb-4 flex flex-wrap items-end justify-between gap-3' },
  template: `
    <div class="min-w-0">
      @if (back()) {
        <a [routerLink]="back()" class="tap -ml-2 mb-1 inline-flex items-center gap-1 px-2 text-sm text-muted-foreground hover:text-foreground">
          <ng-icon name="lucideArrowLeft" size="16" aria-hidden="true" /> {{ backLabel() }}
        </a>
      }
      @if (eyebrow()) {
        <p class="label-caps">{{ eyebrow() }}</p>
      }
      <h1 class="truncate text-2xl uppercase md:text-3xl">{{ title() }}</h1>
      @if (subtitle()) {
        <p class="mt-1 text-sm text-muted-foreground">{{ subtitle() }}</p>
      }
    </div>
    <div class="flex flex-wrap items-center gap-2"><ng-content /></div>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly eyebrow = input<string | null>(null);
  /** Router URL for the back link. */
  readonly back = input<string | null>(null);
  readonly backLabel = input('Back');
}
