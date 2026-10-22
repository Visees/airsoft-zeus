import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { GameHistoryItem, MyStats } from '../../core/api/models';
import { formatDate, formatNumber } from '../../core/util/format';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { TeamSwatch } from '../../shared/team-swatch';
import { BadgeGrid, StatTiles } from './profile-ui';

const RESULT: Record<'win' | 'loss' | 'draw', { label: string; glyph: string; cls: string }> = {
  win: { label: $localize`Win`, glyph: '▲', cls: 'border-primary/40 bg-primary/10 text-primary' },
  loss: { label: $localize`Loss`, glyph: '▼', cls: 'border-destructive/40 bg-destructive/10 text-destructive' },
  draw: { label: $localize`Draw`, glyph: '=', cls: 'border-border bg-muted text-foreground' },
};

@Component({
  selector: 'zeus-statistics-screen',
  imports: [RouterLink, NgIcon, HlmButton, PageHeader, LoadingSkeleton, EmptyState, ErrorState, StatTiles, BadgeGrid, TeamSwatch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <zeus-page-header title="Statistics" back="/profile" backLabel="Profile" i18n-title i18n-backLabel />

      @if (loading()) {
        <zeus-loading-skeleton [rows]="5" />
      } @else if (error() && !data()) {
        <zeus-error-state [error]="error()" (retry)="load()" />
      } @else if (data(); as d) {
        <section aria-labelledby="st-overview">
          <h2 id="st-overview" class="sr-only" i18n>Overview</h2>
          <zeus-stat-tiles [stats]="d.stats" [wide]="true" />
        </section>

        <!-- Win / loss / draw -->
        <section class="panel mt-4 p-4" aria-labelledby="st-results">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="st-results" class="label-caps" i18n>Results · <span class="num">{{ decided() }}</span> decided games</h2>
          </div>
          @if (decided()) {
            <div class="mt-3 flex h-4 w-full overflow-hidden rounded-sm bg-muted" role="img" [attr.aria-label]="barLabel()">
              @for (seg of segments(); track seg.key) {
                @if (seg.value) {
                  <div class="h-full" [style.width.%]="seg.pct" [class]="seg.bar"
                    [style.background-image]="seg.key === 'draw' ? 'repeating-linear-gradient(45deg, transparent 0 3px, rgb(127 127 127 / .35) 3px 5px)' : seg.key === 'loss' ? 'repeating-linear-gradient(90deg, transparent 0 4px, rgb(0 0 0 / .18) 4px 6px)' : null"></div>
                }
              }
            </div>
            <ul class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-hidden="true">
              @for (seg of segments(); track seg.key) {
                <li class="flex items-center gap-1.5">
                  <span class="font-bold" [class]="seg.text">{{ seg.glyph }}</span>
                  <span>{{ seg.label }}</span>
                  <span class="num font-semibold">{{ seg.value }}</span>
                  <span class="num text-muted-foreground">({{ seg.pct }}%)</span>
                </li>
              }
            </ul>
          } @else {
            <p class="mt-2 text-sm text-muted-foreground" i18n>No finished games with a result yet.</p>
          }
        </section>

        <div class="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <!-- History -->
          <section class="lg:col-span-3" aria-labelledby="st-history">
            <h2 id="st-history" class="label-caps mb-2" i18n>Game history · <span class="num">{{ d.history.length }}</span></h2>
            @if (d.history.length) {
              <ul class="panel divide-y divide-border overflow-hidden">
                @for (g of d.history; track g.eventId) {
                  <li>
                    <a [routerLink]="['/events', g.eventId, 'results']" class="flex min-h-16 items-center gap-3 px-3 py-2.5 hover:bg-muted/60">
                      @if (g.result) {
                        <span class="inline-flex w-16 shrink-0 items-center justify-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-semibold" [class]="resultOf(g).cls">
                          <span aria-hidden="true">{{ resultOf(g).glyph }}</span>{{ resultOf(g).label }}
                        </span>
                      } @else {
                        <span class="inline-flex w-16 shrink-0 items-center justify-center rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted-foreground" i18n>No result</span>
                      }
                      <span class="min-w-0 flex-1">
                        <span class="block truncate font-semibold">{{ g.eventName }}</span>
                        <span class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          @if (g.teamName) {
                            <span class="inline-flex items-center gap-1">
                              @if (g.teamColor) {
                                <zeus-team-swatch [color]="g.teamColor" [size]="12" />
                              }
                              {{ g.teamName }}
                            </span>
                            <span aria-hidden="true">·</span>
                          }
                          <span>{{ date(g.endedAt) }}</span>
                        </span>
                      </span>
                      <span class="flex shrink-0 flex-col items-end text-xs">
                        <span class="num font-semibold" i18n><span class="sr-only">Points: </span>{{ num(g.points) }} pts</span>
                        <span class="num text-muted-foreground" i18n><span class="sr-only">Captures: </span>{{ g.captures }} cap.</span>
                      </span>
                      <ng-icon name="lucideChevronRight" size="16" class="shrink-0 text-muted-foreground" aria-hidden="true" />
                    </a>
                  </li>
                }
              </ul>
            } @else {
              <zeus-empty-state icon="lucideHistory" title="No games played yet" message="Finished games appear here with your team, result, points and captures." i18n-title i18n-message>
                @if (auth.can('discover_events')) {
                  <a hlmBtn routerLink="/events/discover" class="h-11" i18n>Discover events</a>
                }
              </zeus-empty-state>
            }
          </section>

          <!-- Badges -->
          <section class="lg:col-span-2" aria-labelledby="st-badges">
            <h2 id="st-badges" class="label-caps mb-2" i18n>Badges · <span class="num">{{ d.badges.length }}</span></h2>
            <div class="[&_ul]:lg:grid-cols-1">
              <zeus-badge-grid [badges]="d.badges" [compact]="true" />
            </div>
          </section>
        </div>
      }
    </div>
  `,
})
export class StatisticsScreen implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);

  protected readonly data = signal<MyStats | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<unknown>(null);
  protected readonly date = formatDate;
  protected readonly num = formatNumber;

  protected readonly decided = computed(() => {
    const s = this.data()?.stats;
    return s ? s.wins + s.losses + s.draws : 0;
  });
  protected readonly segments = computed(() => {
    const s = this.data()?.stats;
    const total = this.decided() || 1;
    const pct = (v: number) => Math.round((v / total) * 100);
    return [
      { key: 'win', label: $localize`Wins`, glyph: '▲', value: s?.wins ?? 0, pct: pct(s?.wins ?? 0), bar: 'bg-primary', text: 'text-primary' },
      { key: 'draw', label: $localize`Draws`, glyph: '=', value: s?.draws ?? 0, pct: pct(s?.draws ?? 0), bar: 'bg-muted-foreground/50', text: 'text-muted-foreground' },
      { key: 'loss', label: $localize`Losses`, glyph: '▼', value: s?.losses ?? 0, pct: pct(s?.losses ?? 0), bar: 'bg-destructive', text: 'text-destructive' },
    ];
  });
  protected readonly barLabel = computed(() =>
    this.segments()
      .map((s) => `${s.value} ${s.label.toLowerCase()} (${s.pct}%)`)
      .join(', '),
  );

  protected resultOf(g: GameHistoryItem) {
    return RESULT[g.result ?? 'draw'];
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(!this.data());
    this.error.set(null);
    try {
      this.data.set(await this.api.myStats());
    } catch (e) {
      this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }
}
