import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { Capture, EventResults, PlayerResult, TeamResult } from '../../core/api/models';
import { formatClock, formatNumber, formatTime } from '../../core/util/format';
import { ConnectionStatus } from '../../shared/link-status';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { TeamBadge } from '../../shared/team-badge';
import { TeamSwatch, luminance } from '../../shared/team-swatch';
import { CAPTURE_METHOD_LABELS, badgeOf, elapsedLabel, ordinal, teamsById } from './results-utils';

type SortKey = 'points' | 'captures' | 'currencyEarned';

interface Segment {
  teamId: string;
  x: number; // %
  w: number; // %
  label: string;
}
interface ObjectiveRow {
  id: string;
  name: string;
  captures: Capture[];
  counts: Map<string, number>;
  total: number;
  revoked: number;
  holder: string | null;
  segments: Segment[];
  marks: number[];
  summary: string;
}

let uid = 0;

/** Deeper post-game view: team comparison, objective control over time, player ranking, perk usage. */
@Component({
  selector: 'zeus-post-game-stats-screen',
  imports: [RouterLink, NgIcon, HlmButton, ConnectionStatus, EmptyState, ErrorState, LoadingSkeleton, PageHeader, TeamBadge, TeamSwatch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (loading() && !results()) {
        <div class="mb-4 h-10 w-2/3 animate-pulse rounded-sm bg-muted" aria-hidden="true"></div>
        <zeus-loading-skeleton [rows]="6" />
      } @else if (notFinished()) {
        <zeus-page-header title="Post-game statistics" [back]="'/events/' + eventId()" backLabel="Event" i18n-title i18n-backLabel />
        <zeus-empty-state icon="lucideChartColumn" title="Statistics appear when the game ends" message="Come back after the Game Master ends the game." i18n-title i18n-message>
          <a hlmBtn variant="outline" class="tap" [routerLink]="['/events', eventId()]" i18n>Back to the event</a>
        </zeus-empty-state>
      } @else if (error() && !results()) {
        <zeus-page-header title="Post-game statistics" [back]="'/events/' + eventId() + '/results'" backLabel="Results" i18n-title i18n-backLabel />
        <zeus-error-state [error]="error()" (retry)="load()" />
      } @else if (results(); as r) {
        <zeus-page-header title="Statistics" [eyebrow]="r.eventName" [back]="'/events/' + r.eventId + '/results'" backLabel="Results" i18n-title i18n-backLabel />

        @if (offline()) {
          <div class="mb-3 flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning-surface px-3 py-2 text-sm" role="status">
            <span i18n>Showing the statistics loaded earlier.</span>
            <zeus-connection-status />
          </div>
        }

        <!-- Pattern definitions shared by the timeline strips (team colour + pattern) -->
        <svg width="0" height="0" class="absolute" aria-hidden="true" focusable="false">
          <defs>
            @for (t of teams(); track t.teamId; let i = $index) {
              <pattern [attr.id]="patternId(t.teamId)" width="6" height="6" patternUnits="userSpaceOnUse">
                @switch (t.pattern) {
                  @case ('stripes') { <path d="M-1,1 l2,-2 M0,6 l6,-6 M5,7 l2,-2" [attr.stroke]="ink(t.color)" stroke-width="1.4" /> }
                  @case ('dots') { <circle cx="3" cy="3" r="1.2" [attr.fill]="ink(t.color)" /> }
                  @case ('chevron') { <path d="M0,4.5 l3,-3 l3,3" fill="none" [attr.stroke]="ink(t.color)" stroke-width="1.2" /> }
                  @case ('cross') { <path d="M3,0.8 v4.4 M0.8,3 h4.4" [attr.stroke]="ink(t.color)" stroke-width="1.2" /> }
                  @case ('grid') { <path d="M0,0 h6 M0,0 v6" [attr.stroke]="ink(t.color)" stroke-width="1.2" /> }
                }
              </pattern>
            }
          </defs>
        </svg>

        <div class="flex flex-col gap-8">
          <!-- Team comparison -->
          <section aria-labelledby="cmp-title">
            <h2 id="cmp-title" class="label-caps mb-3" i18n>Team comparison</h2>
            <div class="grid gap-4 md:grid-cols-2">
              @for (metric of metrics; track metric.key) {
                <div class="panel p-4">
                  <h3 class="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase">
                    <ng-icon [name]="metric.icon" size="14" [class]="metric.key === 'points' ? 'text-primary' : 'text-warning'" aria-hidden="true" /> {{ metric.label }}
                  </h3>
                  <ul class="flex flex-col gap-3">
                    @for (t of teams(); track t.teamId) {
                      @let v = metric.key === 'points' ? t.points : t.currency;
                      <li>
                        <div class="mb-1 flex items-center justify-between gap-2 text-sm">
                          <zeus-team-badge [team]="badge(t)" size="sm" />
                          <span class="num font-bold">{{ fmt(v) }}<span class="font-normal text-muted-foreground"> {{ metric.unit }}</span></span>
                        </div>
                        <div class="h-3 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
                          <div class="h-full rounded-sm" [style.width.%]="barWidth(v, metric.key)" [style.background]="t.color"></div>
                        </div>
                      </li>
                    }
                  </ul>
                </div>
              }
            </div>
          </section>

          <!-- Captures per objective -->
          <section aria-labelledby="obj-title">
            <h2 id="obj-title" class="label-caps mb-3" i18n>Captures per objective · <span class="num">{{ objectiveRows().length }}</span></h2>
            @if (!objectiveRows().length) {
              <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground" i18n>No objective was captured in this game.</p>
            } @else {
              <div class="panel overflow-x-auto">
                <table class="w-full min-w-md text-sm">
                  <caption class="sr-only" i18n>Number of captures of each objective by team</caption>
                  <thead>
                    <tr class="border-b border-border text-left">
                      <th scope="col" class="label-caps p-3" i18n>Objective</th>
                      @for (t of teams(); track t.teamId) {
                        <th scope="col" class="p-3 text-right">
                          <span class="inline-flex items-center gap-1 text-xs font-semibold"><zeus-team-swatch [color]="t.color" [pattern]="t.pattern" [size]="12" />{{ t.name }}</span>
                        </th>
                      }
                      <th scope="col" class="label-caps p-3 text-right" i18n>Total</th>
                      <th scope="col" class="label-caps p-3" i18n>Held at end</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (o of objectiveRows(); track o.id) {
                      <tr class="border-b border-border last:border-0">
                        <th scope="row" class="p-3 text-left font-semibold">{{ o.name }}</th>
                        @for (t of teams(); track t.teamId) {
                          <td class="num p-3 text-right" [class.text-muted-foreground]="!o.counts.get(t.teamId)">{{ o.counts.get(t.teamId) ?? 0 }}</td>
                        }
                        <td class="num p-3 text-right font-bold">
                          {{ o.total }}
                          @if (o.revoked) {
                            <span class="block text-xs font-normal text-destructive" i18n>✕ {{ o.revoked }} revoked</span>
                          }
                        </td>
                        <td class="p-3"><zeus-team-badge [team]="teamBadge(o.holder)" size="sm" [showIcon]="false" emptyLabel="Nobody" i18n-emptyLabel /></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>

          <!-- Control over time -->
          @if (objectiveRows().length && span()) {
            <section aria-labelledby="ctl-title">
              <h2 id="ctl-title" class="label-caps mb-1" i18n>Objective control over time</h2>
              <p class="mb-3 text-sm text-muted-foreground" i18n>Each bar shows which team held the objective, from its capture until the next capture or the end. Ticks mark captures.</p>
              <ul class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend" i18n-aria-label>
                @for (t of teams(); track t.teamId) {
                  <li class="flex items-center gap-1.5">
                    <svg width="14" height="14" aria-hidden="true"><rect width="14" height="14" rx="2" [attr.fill]="t.color" /><rect width="14" height="14" rx="2" [attr.fill]="'url(#' + patternId(t.teamId) + ')'" /></svg>
                    {{ t.name }}
                  </li>
                }
                <li class="flex items-center gap-1.5"><span class="inline-block h-3.5 w-3.5 rounded-sm bg-muted" aria-hidden="true"></span> <ng-container i18n>Not held</ng-container></li>
              </ul>
              <div class="panel p-3">
                @for (o of objectiveRows(); track o.id) {
                  <div class="mb-3 last:mb-0">
                    <p class="mb-1 truncate text-sm font-semibold">{{ o.name }}</p>
                    <svg width="100%" height="22" role="img" [attr.aria-label]="o.summary" class="block overflow-visible">
                      <rect x="0" y="0" width="100%" height="22" rx="3" fill="var(--muted)" />
                      @for (s of o.segments; track $index) {
                        <rect [attr.x]="s.x + '%'" y="0" [attr.width]="s.w + '%'" height="22" [attr.fill]="teamColor(s.teamId)"><title>{{ s.label }}</title></rect>
                        <rect [attr.x]="s.x + '%'" y="0" [attr.width]="s.w + '%'" height="22" [attr.fill]="'url(#' + patternId(s.teamId) + ')'" pointer-events="none" />
                      }
                      @for (m of o.marks; track $index) {
                        <rect [attr.x]="m + '%'" y="-3" width="2" height="28" fill="var(--foreground)" />
                      }
                    </svg>
                  </div>
                }
                <div class="relative mt-2 h-4 text-[0.65rem] text-muted-foreground" aria-hidden="true">
                  @for (tick of ticks(); track tick.pct) {
                    <span class="num absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full" [style.left.%]="tick.pct">{{ tick.label }}</span>
                  }
                </div>
              </div>
              <details class="mt-2">
                <summary class="tap inline-flex cursor-pointer items-center text-sm font-semibold text-primary" i18n>Show captures as a table</summary>
                <div class="panel mt-2 overflow-x-auto">
                  <table class="w-full min-w-120 text-sm">
                    <caption class="sr-only" i18n>All captures by objective</caption>
                    <thead>
                      <tr class="border-b border-border text-left">
                        <th scope="col" class="label-caps p-2" i18n>Objective</th>
                        <th scope="col" class="label-caps p-2" i18n>Game time</th>
                        <th scope="col" class="label-caps p-2" i18n>Team</th>
                        <th scope="col" class="label-caps p-2" i18n>Player</th>
                        <th scope="col" class="label-caps p-2" i18n>Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (o of objectiveRows(); track o.id) {
                        @for (c of o.captures; track c.id) {
                          <tr class="border-b border-border last:border-0" [class.line-through]="c.revoked">
                            <th scope="row" class="p-2 text-left font-normal">{{ o.name }}</th>
                            <td class="num p-2">{{ elapsed(c.createdAt) }} <span class="text-muted-foreground">({{ time(c.createdAt) }})</span></td>
                            <td class="p-2">{{ teamName(c.teamId) }}</td>
                            <td class="p-2">{{ c.nickname || '—' }}</td>
                            <td class="p-2">{{ methodLabel(c.method) }}{{ c.revoked ? txt.revoked : '' }}</td>
                          </tr>
                        }
                      }
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          }

          <!-- Player leaderboard -->
          <section aria-labelledby="pl-title">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="pl-title" class="label-caps" i18n>Player leaderboard · <span class="num">{{ r.players.length }}</span></h2>
              <div class="flex rounded-md border border-border p-0.5" role="group" aria-label="Sort players by" i18n-aria-label>
                @for (s of sorts; track s.key) {
                  <button
                    type="button"
                    class="tap rounded-sm px-3 text-sm font-semibold"
                    [class]="sortKey() === s.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
                    [attr.aria-pressed]="sortKey() === s.key"
                    (click)="sortKey.set(s.key)"
                  >{{ s.label }}</button>
                }
              </div>
            </div>
            @if (!r.players.length) {
              <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground" i18n>No player data recorded.</p>
            } @else {
              <div class="panel overflow-x-auto">
                <table class="w-full text-sm">
                  <caption class="sr-only" i18n>Players sorted by {{ sortLabel() }}</caption>
                  <thead>
                    <tr class="border-b border-border text-left">
                      <th scope="col" class="label-caps w-12 p-2 pl-3">#</th>
                      <th scope="col" class="label-caps p-2" i18n>Player</th>
                      @for (s of sorts; track s.key) {
                        <th scope="col" class="p-2 text-right" [attr.aria-sort]="sortKey() === s.key ? 'descending' : 'none'">
                          <button type="button" class="label-caps tap inline-flex items-center justify-end gap-0.5" [class.!text-foreground]="sortKey() === s.key" (click)="sortKey.set(s.key)">
                            {{ s.short }}
                            @if (sortKey() === s.key) { <ng-icon name="lucideChevronDown" size="12" aria-hidden="true" /> }
                          </button>
                        </th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of sortedPlayers(); track p.userId ?? p.nickname; let i = $index) {
                      <tr class="border-b border-border last:border-0" [class]="i < 3 ? 'bg-primary/5' : ''">
                        <td class="num p-2 pl-3 font-bold">
                          @if (i < 3) {
                            <span class="inline-flex items-center gap-0.5 text-primary" aria-label="{{ ordinal(i + 1) }} place" i18n-aria-label><ng-icon name="lucideMedal" size="14" aria-hidden="true" />{{ i + 1 }}</span>
                          } @else {
                            {{ i + 1 }}
                          }
                        </td>
                        <th scope="row" class="p-2 text-left font-normal">
                          <span class="block max-w-36 truncate font-semibold sm:max-w-none">{{ p.nickname }}</span>
                          <zeus-team-badge [team]="teamBadge(p.teamId)" size="sm" [showIcon]="false" />
                        </th>
                        <td class="num p-2 text-right" [class.font-bold]="sortKey() === 'points'">{{ fmt(p.points) }}</td>
                        <td class="num p-2 text-right" [class.font-bold]="sortKey() === 'captures'">{{ p.captures }}</td>
                        <td class="num p-2 text-right" [class.font-bold]="sortKey() === 'currencyEarned'">{{ fmt(p.currencyEarned) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>

          <!-- Perk usage -->
          <section aria-labelledby="perk-title">
            <h2 id="perk-title" class="label-caps mb-3" i18n>Perk usage · <span class="num">{{ r.perks.length }}</span> purchases</h2>
            @if (!perkSummary().length) {
              <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground" i18n>No perks were bought in this game.</p>
            } @else {
              <ul class="grid gap-2 sm:grid-cols-2">
                @for (p of perkSummary(); track p.name) {
                  <li class="panel p-3">
                    <div class="flex items-start justify-between gap-2">
                      <p class="font-semibold">{{ p.name }}</p>
                      <p class="num shrink-0 text-sm" i18n><span class="font-bold">{{ p.count }}</span>× · {{ fmt(p.spent) }} cr</p>
                    </div>
                    <ul class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      @for (b of p.byTeam; track b.teamId) {
                        <li class="flex items-center gap-1"><zeus-team-badge [team]="teamBadge(b.teamId)" size="sm" [showIcon]="false" /> <span class="num">×{{ b.count }}</span></li>
                      }
                    </ul>
                    @if (p.failed) {
                      <p class="mt-1 text-xs text-muted-foreground" i18n>✕ <span class="num">{{ p.failed }}</span> rejected or cancelled · ↺ <span class="num">{{ p.refunded }}</span> refunded</p>
                    }
                  </li>
                }
              </ul>
            }
          </section>
        </div>
      }
    </div>
  `,
})
export class PostGameStatsScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    revoked: $localize` · revoked`,
  };

  private readonly api = inject(ApiService);

  readonly eventId = input.required<string>();

  protected readonly results = signal<EventResults | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<unknown>(null);
  protected readonly sortKey = signal<SortKey>('points');

  protected readonly metrics = [
    { key: 'points' as const, label: $localize`Victory points`, unit: 'pts', icon: 'lucideTrophy' },
    { key: 'currency' as const, label: $localize`Credits left`, unit: 'cr', icon: 'lucideCoins' },
  ];
  protected readonly sorts: { key: SortKey; label: string; short: string }[] = [
    { key: 'points', label: $localize`Points`, short: $localize`Pts` },
    { key: 'captures', label: $localize`Captures`, short: $localize`Caps` },
    { key: 'currencyEarned', label: $localize`Credits`, short: $localize`Cr` },
  ];

  protected readonly fmt = formatNumber;
  protected readonly time = formatTime;
  protected readonly ordinal = ordinal;
  protected readonly badge = badgeOf;
  private readonly pid = `pgs${++uid}`;

  protected readonly notFinished = computed(() => {
    const r = this.results();
    if (r) return r.status !== 'completed';
    const e = ApiError.from(this.error());
    return !!this.error() && (e.status === 409 || e.code === 'not_completed' || e.code === 'game_not_completed');
  });
  protected readonly offline = computed(() => !!this.error() && !!this.results() && ApiError.from(this.error()).isNetwork);

  protected readonly teams = computed(() => [...(this.results()?.teams ?? [])].sort((a, b) => a.rank - b.rank));
  private readonly teamMap = computed(() => (this.results() ? teamsById(this.results()!) : new Map<string, TeamResult>()));
  private readonly maxByMetric = computed(() => ({
    points: Math.max(1, ...this.teams().map((t) => t.points)),
    currency: Math.max(1, ...this.teams().map((t) => t.currency)),
  }));

  /** Wall-clock window of the game used for the strips. */
  private readonly window = computed(() => {
    const r = this.results();
    if (!r) return null;
    const times = r.timeline.map((c) => new Date(c.createdAt).getTime());
    const start = r.startedAt ? new Date(r.startedAt).getTime() : Math.min(...times);
    const end = r.endedAt ? new Date(r.endedAt).getTime() : r.startedAt ? start + r.durationMs : Math.max(...times);
    return isFinite(start) && isFinite(end) && end > start ? { start, end } : null;
  });
  protected readonly span = computed(() => {
    const w = this.window();
    return w ? w.end - w.start : 0;
  });
  protected readonly ticks = computed(() => {
    const span = this.span();
    return [0, 25, 50, 75, 100].map((pct) => ({ pct, label: formatClock((span * pct) / 100) }));
  });

  protected readonly objectiveRows = computed<ObjectiveRow[]>(() => {
    const r = this.results();
    if (!r) return [];
    const w = this.window();
    const byObj = new Map<string, Capture[]>();
    for (const c of [...r.timeline].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const list = byObj.get(c.objectiveId) ?? [];
      list.push(c);
      byObj.set(c.objectiveId, list);
    }
    const pct = (t: number) => (w ? Math.min(100, Math.max(0, ((t - w.start) / (w.end - w.start)) * 100)) : 0);
    return [...byObj.entries()]
      .map(([id, captures]) => {
        const valid = captures.filter((c) => !c.revoked);
        const counts = new Map<string, number>();
        for (const c of valid) counts.set(c.teamId, (counts.get(c.teamId) ?? 0) + 1);
        const segments: Segment[] = valid.map((c, i) => {
          const from = new Date(c.createdAt).getTime();
          const to = i + 1 < valid.length ? new Date(valid[i + 1].createdAt).getTime() : (w?.end ?? from);
          const x = pct(from);
          return {
            teamId: c.teamId,
            x,
            w: Math.max(0.4, pct(to) - x),
            label:
              i + 1 < valid.length
                ? $localize`${this.teamName(c.teamId)}:team: from ${formatTime(c.createdAt)}:from: to ${formatTime(valid[i + 1].createdAt)}:to:`
                : $localize`${this.teamName(c.teamId)}:team: from ${formatTime(c.createdAt)}:from: to the end`,
          };
        });
        const holder = valid.length ? valid[valid.length - 1].teamId : null;
        const summary =
          $localize`${captures[0].objectiveName}:objectiveName:: ${valid.length}:length: captures. ` +
          (segments.length ? segments.map((s) => s.label).join('; ') + '.' : $localize`Never held.`);
        return {
          id,
          name: captures[0].objectiveName,
          captures,
          counts,
          total: valid.length,
          revoked: captures.length - valid.length,
          holder,
          segments,
          marks: valid.map((c) => Math.min(99.5, pct(new Date(c.createdAt).getTime()))),
          summary,
        };
      })
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  });

  protected readonly sortLabel = computed(() => this.sorts.find((s) => s.key === this.sortKey())!.label.toLowerCase());
  protected readonly sortedPlayers = computed<PlayerResult[]>(() => {
    const key = this.sortKey();
    return [...(this.results()?.players ?? [])].sort((a, b) => b[key] - a[key] || b.points - a.points || a.nickname.localeCompare(b.nickname));
  });

  protected readonly perkSummary = computed(() => {
    const r = this.results();
    if (!r) return [];
    const map = new Map<string, { name: string; count: number; spent: number; failed: number; refunded: number; teams: Map<string, number> }>();
    for (const p of r.perks) {
      const s = map.get(p.perkName) ?? { name: p.perkName, count: 0, spent: 0, failed: 0, refunded: 0, teams: new Map() };
      const failed = p.status === 'rejected' || p.status === 'cancelled';
      if (failed) s.failed++;
      else {
        s.count++;
        s.teams.set(p.teamId, (s.teams.get(p.teamId) ?? 0) + 1);
      }
      if (p.refunded) s.refunded++;
      else if (!failed) s.spent += p.price;
      map.set(p.perkName, s);
    }
    return [...map.values()]
      .map((s) => ({ ...s, byTeam: [...s.teams.entries()].map(([teamId, count]) => ({ teamId, count })).sort((a, b) => b.count - a.count) }))
      .sort((a, b) => b.count - a.count);
  });

  private requestId = 0;

  constructor() {
    effect(() => {
      this.eventId();
      untracked(() => {
        this.results.set(null);
        void this.load();
      });
    });
  }

  async load(): Promise<void> {
    const req = ++this.requestId;
    this.loading.set(true);
    try {
      const r = await this.api.results(this.eventId());
      if (req !== this.requestId) return;
      this.results.set(r);
      this.error.set(null);
    } catch (err) {
      if (req === this.requestId) this.error.set(err);
    } finally {
      if (req === this.requestId) this.loading.set(false);
    }
  }

  protected barWidth(value: number, key: 'points' | 'currency'): number {
    return Math.max(0, (value / this.maxByMetric()[key]) * 100);
  }
  protected patternId(teamId: string): string {
    return `${this.pid}-${teamId}`;
  }
  protected ink(color: string): string {
    return luminance(color) > 0.45 ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.55)';
  }
  protected teamColor(teamId: string): string {
    return this.teamMap().get(teamId)?.color ?? 'var(--muted-foreground)';
  }
  protected teamName(teamId: string): string {
    return this.teamMap().get(teamId)?.name ?? $localize`Unknown team`;
  }
  protected teamBadge(teamId: string | null) {
    return teamId ? badgeOf(this.teamMap().get(teamId)) : null;
  }
  protected elapsed(iso: string): string {
    return elapsedLabel(iso, this.results()?.startedAt ?? null);
  }
  protected methodLabel(m: Capture['method']): string {
    return CAPTURE_METHOD_LABELS[m];
  }
}
