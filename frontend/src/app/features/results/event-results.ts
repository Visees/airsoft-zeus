import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { EventDetail, EventResults } from '../../core/api/models';
import { ToastService } from '../../core/ui/toast.service';
import { GAME_MODE_LABELS, LEDGER_TYPE_LABELS, formatDateTime, formatDuration, formatNumber, formatSigned, formatTime } from '../../core/util/format';
import { ConnectionStatus } from '../../shared/link-status';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { StatusChip, purchaseStatusChip } from '../../shared/status-chip';
import { TeamBadge } from '../../shared/team-badge';
import { copyText, shareOrCopy } from '../events/share-utils';
import { ResultsLeaderboard, ResultsTimeline, ResultsTopPlayers, ResultsWinner } from './results-parts';
import { badgeOf, publicResultsUrl, teamsById } from './results-utils';

/** After-action report: winner, leaderboard, timeline, perks, GM adjustments, sharing. */
@Component({
  selector: 'zeus-event-results-screen',
  imports: [
    RouterLink,
    NgIcon,
    HlmButton,
    ConnectionStatus,
    EmptyState,
    ErrorState,
    LoadingSkeleton,
    PageHeader,
    StatusChip,
    TeamBadge,
    ResultsLeaderboard,
    ResultsTimeline,
    ResultsTopPlayers,
    ResultsWinner,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (loading() && !results()) {
        <div class="mb-4 h-10 w-2/3 animate-pulse rounded-sm bg-muted" aria-hidden="true"></div>
        <div class="mb-4 h-28 animate-pulse rounded-md bg-muted" aria-hidden="true"></div>
        <zeus-loading-skeleton [rows]="5" />
      } @else if (notFinished()) {
        <zeus-page-header [title]="event()?.name || 'Results'" eyebrow="Results" [back]="'/events/' + eventId()" backLabel="Event" />
        <zeus-empty-state icon="lucideHourglass" title="Results appear when the game ends" message="Scores, captures and the winner are published here as soon as the Game Master ends the game.">
          <a hlmBtn variant="outline" class="tap" [routerLink]="['/events', eventId()]">Back to the event</a>
          @if (event()?.status === 'live' || event()?.status === 'paused') {
            <a hlmBtn class="tap" [routerLink]="event()?.isGm ? ['/gm/events', eventId(), 'control'] : ['/events', eventId(), 'live']">
              {{ event()?.isGm ? 'Control center' : 'Open live map' }}
            </a>
          }
        </zeus-empty-state>
      } @else if (error() && !results()) {
        <zeus-page-header title="Results" [back]="'/events/' + eventId()" backLabel="Event" />
        <zeus-error-state [error]="error()" (retry)="load()" />
      } @else if (results(); as r) {
        <zeus-page-header [title]="r.eventName" eyebrow="Results" [subtitle]="subtitle()" [back]="'/events/' + r.eventId" backLabel="Event">
          <a hlmBtn variant="outline" class="tap" [routerLink]="['/events', r.eventId, 'results', 'stats']"><ng-icon name="lucideChartColumn" size="16" aria-hidden="true" /> Statistics</a>
          <a hlmBtn variant="outline" class="tap" [routerLink]="['/events', r.eventId, 'results', 'export']"><ng-icon name="lucideDownload" size="16" aria-hidden="true" /> Export</a>
        </zeus-page-header>

        @if (offline()) {
          <div class="mb-3 flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning-surface px-3 py-2 text-sm" role="status">
            <span>Showing the results loaded earlier.</span>
            <zeus-connection-status />
          </div>
        }

        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div class="flex min-w-0 flex-col gap-6">
            <zeus-results-winner [results]="r" />

            <dl class="grid grid-cols-3 gap-2">
              <div class="panel p-3">
                <dt class="label-caps">Duration</dt>
                <dd class="num text-lg font-bold">{{ duration() }}</dd>
              </div>
              <div class="panel p-3">
                <dt class="label-caps">Captures</dt>
                <dd class="num text-lg font-bold">{{ validCaptures() }}</dd>
              </div>
              <div class="panel p-3">
                <dt class="label-caps">Players</dt>
                <dd class="num text-lg font-bold">{{ r.players.length }}</dd>
              </div>
            </dl>

            <zeus-results-leaderboard [results]="r" />
            <zeus-results-timeline [results]="r" />

            <section aria-labelledby="perks-title">
              <h2 id="perks-title" class="label-caps mb-2">Perks purchased · <span class="num">{{ r.perks.length }}</span></h2>
              @if (!r.perks.length) {
                <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No perks were bought in this game.</p>
              } @else {
                <ul class="panel divide-y divide-border">
                  @for (p of r.perks; track p.id) {
                    <li class="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                      <div class="min-w-0 flex-1">
                        <p class="font-semibold">{{ p.perkName }}</p>
                        <p class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <zeus-team-badge [team]="team(p.teamId)" size="sm" [showIcon]="false" />
                          <span>{{ p.buyerNickname || 'Game Master' }}</span>
                          <span class="num">{{ time(p.createdAt) }}</span>
                          @if (p.targetTeamId && team(p.targetTeamId); as target) {
                            <span>→ {{ target.name }}</span>
                          }
                        </p>
                      </div>
                      <zeus-status-chip [spec]="purchaseChip(p.status)" />
                      <span class="num w-20 shrink-0 text-right text-sm font-semibold">{{ fmt(p.price) }} cr{{ p.refunded ? ' ↺' : '' }}</span>
                    </li>
                  }
                </ul>
              }
            </section>

            <section aria-labelledby="adj-title">
              <h2 id="adj-title" class="label-caps mb-2">Game Master adjustments · <span class="num">{{ r.adjustments.length }}</span></h2>
              @if (!r.adjustments.length) {
                <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No manual changes to scores or credits.</p>
              } @else {
                <ul class="panel divide-y divide-border">
                  @for (a of r.adjustments; track a.id) {
                    <li class="flex gap-3 p-3">
                      <div class="min-w-0 flex-1">
                        <p class="flex flex-wrap items-center gap-2">
                          <zeus-team-badge [team]="team(a.teamId)" size="sm" [showIcon]="false" />
                          <span class="text-xs font-semibold" [class.text-destructive]="a.type === 'penalty'">{{ a.type === 'penalty' ? '▲ ' : '' }}{{ ledgerLabel(a.type) }}</span>
                        </p>
                        <p class="mt-1 text-sm">{{ a.reason || 'No reason given' }}</p>
                        <p class="text-xs text-muted-foreground">
                          {{ a.actorNickname || 'Game Master' }} · <span class="num">{{ dateTime(a.createdAt) }}</span>
                          @if (a.nickname) {
                            · for {{ a.nickname }}
                          }
                        </p>
                      </div>
                      <p class="num shrink-0 text-right font-bold">
                        {{ signed(a.amount) }}
                        <span class="block text-xs font-normal text-muted-foreground">{{ a.kind === 'points' ? 'points' : 'credits' }}</span>
                      </p>
                    </li>
                  }
                </ul>
              }
            </section>
          </div>

          <aside class="flex flex-col gap-4 lg:sticky lg:top-4">
            <zeus-results-top-players [results]="r" />

            <section class="panel flex flex-col gap-3 p-4" aria-labelledby="share-title">
              <h2 id="share-title" class="label-caps">Share results</h2>
              @if (shareUrl()) {
                <p class="text-sm text-muted-foreground">Anyone with the link can see the results page. No account needed.</p>
                <p class="num truncate rounded-sm border border-dashed border-border bg-muted px-2 py-1.5 text-xs" [title]="shareUrl()">{{ shareUrl() }}</p>
                <div class="grid grid-cols-2 gap-2">
                  <button hlmBtn variant="outline" type="button" class="h-11" (click)="copyLink()">
                    <ng-icon [name]="copied() ? 'lucideCheck' : 'lucideCopy'" size="16" aria-hidden="true" /> {{ copied() ? 'Copied' : 'Copy link' }}
                  </button>
                  <button hlmBtn type="button" class="h-11" (click)="share()"><ng-icon name="lucideShare2" size="16" aria-hidden="true" /> Share</button>
                </div>
              } @else if (isGm()) {
                <p class="text-sm text-muted-foreground">Publish a public page with the winner, leaderboard and timeline. Player positions are never included.</p>
                <button hlmBtn type="button" class="h-11" [disabled]="publishing()" (click)="publish()">
                  <ng-icon name="lucideGlobe" size="16" aria-hidden="true" /> {{ publishing() ? 'Publishing…' : 'Publish results page' }}
                </button>
              } @else {
                <p class="text-sm text-muted-foreground">The Game Master has not published a public results page yet.</p>
              }
            </section>
          </aside>
        </div>
      }
    </div>
  `,
})
export class EventResultsScreen {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly doc = inject(DOCUMENT);

  readonly eventId = input.required<string>();

  protected readonly results = signal<EventResults | null>(null);
  protected readonly event = signal<EventDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<unknown>(null);
  protected readonly publishing = signal(false);
  protected readonly copied = signal(false);
  private readonly token = signal<string | null>(null);

  protected readonly fmt = formatNumber;
  protected readonly signed = formatSigned;
  protected readonly time = formatTime;
  protected readonly dateTime = formatDateTime;
  protected readonly purchaseChip = purchaseStatusChip;
  protected readonly ledgerLabel = (t: keyof typeof LEDGER_TYPE_LABELS) => LEDGER_TYPE_LABELS[t];

  protected readonly isGm = computed(() => this.event()?.isGm ?? false);
  protected readonly notFinished = computed(() => {
    const r = this.results();
    if (r) return r.status !== 'completed';
    const e = ApiError.from(this.error());
    // The API answers 409 (or a not-completed code) when the game has not ended yet.
    return !!this.error() && (e.status === 409 || e.code === 'not_completed' || e.code === 'game_not_completed');
  });
  protected readonly offline = computed(() => {
    const e = this.error();
    return !!e && !!this.results() && ApiError.from(e).isNetwork;
  });
  private readonly teamMap = computed(() => (this.results() ? teamsById(this.results()!) : new Map()));
  protected readonly duration = computed(() => formatDuration(this.results()?.durationMs ?? 0));
  protected readonly validCaptures = computed(() => this.results()?.timeline.filter((c) => !c.revoked).length ?? 0);
  protected readonly subtitle = computed(() => {
    const r = this.results();
    if (!r) return null;
    const mode = this.event()?.customModeName || GAME_MODE_LABELS[r.gameMode];
    return `${mode} · ${formatDateTime(r.startedAt ?? r.endedAt)}`;
  });
  protected readonly shareUrl = computed(() => {
    const t = this.token();
    return t ? publicResultsUrl(this.doc.location.origin, t) : null;
  });

  private requestId = 0;

  constructor() {
    effect(() => {
      this.eventId();
      untracked(() => {
        this.results.set(null);
        this.event.set(null);
        void this.load();
      });
    });
  }

  protected team(id: string) {
    return badgeOf(this.teamMap().get(id));
  }

  async load(): Promise<void> {
    const id = this.eventId();
    const req = ++this.requestId;
    this.loading.set(true);
    // Event details are only needed for the GM flag and labels; results load even if it fails.
    const eventP = this.api.event(id).catch(() => null);
    try {
      const r = await this.api.results(id);
      if (req !== this.requestId) return;
      this.results.set(r);
      this.token.set(r.resultsToken);
      this.error.set(null);
    } catch (err) {
      if (req === this.requestId) this.error.set(err);
    }
    const e = await eventP;
    if (req !== this.requestId) return;
    if (e) {
      this.event.set(e);
      if (!this.token() && e.resultsToken) this.token.set(e.resultsToken);
    }
    this.loading.set(false);
  }

  protected async publish(): Promise<void> {
    this.publishing.set(true);
    try {
      const res = await this.api.publishResults(this.eventId());
      this.token.set(res.token);
      this.toast.success('Results page published', 'Share the link with your players.');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.publishing.set(false);
    }
  }

  protected async copyLink(): Promise<void> {
    const url = this.shareUrl();
    if (!url) return;
    if (await copyText(url)) {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } else {
      this.toast.error('Could not copy the link.');
    }
  }

  protected async share(): Promise<void> {
    const url = this.shareUrl();
    const r = this.results();
    if (!url || !r) return;
    const res = await shareOrCopy({ title: `${r.eventName} — results`, text: `Results of ${r.eventName} on Airsoft Zeus`, url });
    if (res === 'copied') this.toast.success('Link copied');
    else if (res === 'failed') this.toast.error('Could not share the link.');
  }
}
