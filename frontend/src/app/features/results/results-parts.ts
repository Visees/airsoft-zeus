import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { EventResults } from '../../core/api/models';
import { formatNumber, formatTime } from '../../core/util/format';
import { TeamBadge } from '../../shared/team-badge';
import { CAPTURE_METHOD_LABELS, badgeOf, elapsedLabel, leaders, ordinal, teamsById } from './results-utils';

// Building blocks shared by the in-app results screen and the public (SSR) results page.
// They must not touch window/document so they render on the server.

/** Winner (or draw) banner. */
@Component({
  selector: 'zeus-results-winner',
  imports: [NgIcon, TeamBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let r = results();
    <section class="panel relative overflow-hidden p-5" [class.border-primary]="!!winner()" aria-labelledby="winner-title">
      @if (winner(); as w) {
        <div class="absolute inset-y-0 left-0 w-1.5" [style.background]="w.color" aria-hidden="true"></div>
        <p class="label-caps flex items-center gap-1.5"><ng-icon name="lucideTrophy" size="14" class="text-primary" aria-hidden="true" /> <ng-container i18n>Winner</ng-container></p>
        <h2 id="winner-title" class="sr-only" i18n>Winner: {{ w.name }}</h2>
        <div class="mt-2 flex flex-wrap items-end justify-between gap-3">
          <zeus-team-badge [team]="badge(w)" size="lg" />
          <p class="num text-3xl font-bold">{{ fmt(w.points) }} <span class="text-sm font-normal text-muted-foreground" i18n>pts</span></p>
        </div>
        @if (runnerUp(); as ru) {
          <p class="mt-2 text-sm text-muted-foreground" i18n>
            Ahead of {{ ru.name }} by <span class="num font-semibold text-foreground">{{ fmt(w.points - ru.points) }}</span> points
          </p>
        }
      } @else if (r.isDraw) {
        <p class="label-caps" i18n>Result</p>
        <h2 id="winner-title" class="mt-1 text-2xl uppercase" i18n>= Draw</h2>
        <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          @for (t of tied(); track t.teamId) {
            <li class="flex items-center gap-2"><zeus-team-badge [team]="badge(t)" /> <span class="num font-bold">{{ fmt(t.points) }}</span></li>
          }
        </ul>
      } @else {
        <p class="label-caps" i18n>Result</p>
        <h2 id="winner-title" class="mt-1 text-xl uppercase" i18n>No winner recorded</h2>
        <p class="mt-1 text-sm text-muted-foreground" i18n>The Game Master did not declare a winning team.</p>
      }
    </section>
  `,
})
export class ResultsWinner {
  readonly results = input.required<EventResults>();
  protected readonly fmt = formatNumber;
  protected readonly badge = badgeOf;
  protected readonly winner = computed(() => {
    const r = this.results();
    return r.isDraw ? null : (r.teams.find((t) => t.teamId === r.winnerTeamId) ?? null);
  });
  protected readonly runnerUp = computed(() => {
    const w = this.winner();
    if (!w) return null;
    return [...this.results().teams].filter((t) => t.teamId !== w.teamId).sort((a, b) => a.rank - b.rank)[0] ?? null;
  });
  protected readonly tied = computed(() => leaders(this.results()));
}

/** Final team leaderboard: stacked rows on phones, table from sm. */
@Component({
  selector: 'zeus-results-leaderboard',
  imports: [TeamBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section aria-labelledby="lb-title">
      <h2 id="lb-title" class="label-caps mb-2" i18n>Final leaderboard · <span class="num">{{ teams().length }}</span> teams</h2>
      @if (!teams().length) {
        <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground" i18n>No teams took part.</p>
      } @else {
        <!-- Phones -->
        <ol class="flex flex-col gap-2 sm:hidden">
          @for (t of teams(); track t.teamId) {
            <li class="panel p-3" [class.border-primary]="t.teamId === results().winnerTeamId">
              <div class="flex items-center gap-3">
                <span class="num w-9 shrink-0 text-lg font-bold" aria-label="Rank {{ t.rank }}" i18n-aria-label>{{ ordinal(t.rank) }}</span>
                <zeus-team-badge class="min-w-0 flex-1" [team]="badge(t)" />
                <span class="num shrink-0 text-lg font-bold">{{ fmt(t.points) }}<span class="text-xs font-normal text-muted-foreground" i18n> pts</span></span>
              </div>
              <dl class="mt-2 grid grid-cols-4 gap-2 text-xs">
                <div><dt class="label-caps" i18n>Credits</dt><dd class="num">{{ fmt(t.currency) }}</dd></div>
                <div><dt class="label-caps" i18n>Captured</dt><dd class="num">{{ t.objectivesCaptured }}</dd></div>
                <div><dt class="label-caps" i18n>Held</dt><dd class="num">{{ t.objectivesHeld }}</dd></div>
                <div><dt class="label-caps" i18n>Perks</dt><dd class="num">{{ t.perksPurchased }}</dd></div>
              </dl>
            </li>
          }
        </ol>
        <!-- Wider screens -->
        <div class="panel hidden overflow-x-auto sm:block">
          <table class="w-full text-sm">
            <caption class="sr-only" i18n>Final leaderboard</caption>
            <thead>
              <tr class="border-b border-border text-left">
                <th scope="col" class="label-caps p-3" i18n>Rank</th>
                <th scope="col" class="label-caps p-3" i18n>Team</th>
                <th scope="col" class="label-caps p-3 text-right" i18n>Points</th>
                <th scope="col" class="label-caps p-3 text-right" i18n>Credits left</th>
                <th scope="col" class="label-caps p-3 text-right" i18n>Captured</th>
                <th scope="col" class="label-caps p-3 text-right" i18n>Held at end</th>
                <th scope="col" class="label-caps p-3 text-right" i18n>Perks bought</th>
              </tr>
            </thead>
            <tbody>
              @for (t of teams(); track t.teamId) {
                <tr class="border-b border-border last:border-0" [class]="t.teamId === results().winnerTeamId ? 'bg-primary/5' : ''">
                  <td class="num p-3 font-bold">{{ ordinal(t.rank) }}</td>
                  <th scope="row" class="p-3 text-left font-normal"><zeus-team-badge [team]="badge(t)" /></th>
                  <td class="num p-3 text-right font-bold">{{ fmt(t.points) }}</td>
                  <td class="num p-3 text-right">{{ fmt(t.currency) }}</td>
                  <td class="num p-3 text-right">{{ t.objectivesCaptured }}</td>
                  <td class="num p-3 text-right">{{ t.objectivesHeld }}</td>
                  <td class="num p-3 text-right">{{ t.perksPurchased }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class ResultsLeaderboard {
  readonly results = input.required<EventResults>();
  protected readonly fmt = formatNumber;
  protected readonly badge = badgeOf;
  protected readonly ordinal = ordinal;
  protected readonly teams = computed(() => [...this.results().teams].sort((a, b) => a.rank - b.rank || b.points - a.points));
}

/** Objective captures in game order. */
@Component({
  selector: 'zeus-results-timeline',
  imports: [TeamBadge, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section aria-labelledby="tl-title">
      <h2 id="tl-title" class="label-caps mb-2" i18n>Objectives timeline · <span class="num">{{ captures().length }}</span> captures</h2>
      @if (!captures().length) {
        <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground" i18n>No objective was captured in this game.</p>
      } @else {
        <ol class="panel divide-y divide-border">
          @for (c of visible(); track c.id) {
            <li class="flex gap-3 p-3" [class.opacity-60]="c.revoked">
              <div class="w-16 shrink-0 text-right">
                <p class="num text-sm font-semibold">{{ elapsed(c.createdAt) }}</p>
                <p class="num text-xs text-muted-foreground">{{ time(c.createdAt) }}</p>
              </div>
              <div class="min-w-0 flex-1">
                <p class="font-semibold" [class.line-through]="c.revoked">◆ {{ c.objectiveName }}</p>
                <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                  <zeus-team-badge [team]="team(c.teamId)" size="sm" [showIcon]="false" />
                  <span>{{ c.nickname || (c.method === 'gm' ? txt.gameMaster : txt.unknownPlayer) }}</span>
                  <span>· {{ methodLabel(c.method) }}</span>
                  @if (c.revoked) {
                    <span class="rounded-sm border border-destructive/45 px-1 text-xs font-semibold text-destructive" i18n>✕ Revoked</span>
                  }
                </p>
              </div>
              <p class="num shrink-0 text-sm font-semibold" [class.text-primary]="!c.revoked">+{{ fmt(c.points) }}</p>
            </li>
          }
        </ol>
        @if (captures().length > limit() && !expanded()) {
          <button hlmBtn variant="ghost" type="button" class="tap mt-2 w-full" (click)="expanded.set(true)" i18n>Show all {{ captures().length }} captures</button>
        }
      }
    </section>
  `,
})
export class ResultsTimeline {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    gameMaster: $localize`Game Master`,
    unknownPlayer: $localize`Unknown player`,
  };

  readonly results = input.required<EventResults>();
  readonly limit = input(15);
  protected readonly expanded = signal(false);
  protected readonly fmt = formatNumber;
  protected readonly time = formatTime;
  private readonly teamMap = computed(() => teamsById(this.results()));
  protected readonly captures = computed(() => [...this.results().timeline].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  protected readonly visible = computed(() => (this.expanded() ? this.captures() : this.captures().slice(0, this.limit())));
  protected team(id: string) {
    return badgeOf(this.teamMap().get(id));
  }
  protected elapsed(iso: string): string {
    return elapsedLabel(iso, this.results().startedAt);
  }
  protected methodLabel(m: keyof typeof CAPTURE_METHOD_LABELS): string {
    return CAPTURE_METHOD_LABELS[m];
  }
}

/** Top individual contributions by points. */
@Component({
  selector: 'zeus-results-top-players',
  imports: [TeamBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section aria-labelledby="top-title">
      <h2 id="top-title" class="label-caps mb-2" i18n>Top players</h2>
      @if (!top().length) {
        <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground" i18n>No individual points were scored.</p>
      } @else {
        <ol class="panel divide-y divide-border">
          @for (p of top(); track p.userId ?? p.nickname; let i = $index) {
            <li class="flex items-center gap-3 p-3">
              <span class="num grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold" [class]="i < 3 ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'" aria-label="Rank {{ i + 1 }}" i18n-aria-label>{{ i + 1 }}</span>
              <div class="min-w-0 flex-1">
                <p class="truncate font-semibold">{{ p.nickname }}</p>
                <p class="flex items-center gap-2 text-xs text-muted-foreground">
                  <zeus-team-badge [team]="team(p.teamId)" size="sm" [showIcon]="false" />
                  <ng-container i18n><span class="num">{{ p.captures }}</span> captures</ng-container>
                </p>
              </div>
              <p class="num shrink-0 font-bold">{{ fmt(p.points) }}<span class="text-xs font-normal text-muted-foreground" i18n> pts</span></p>
            </li>
          }
        </ol>
      }
    </section>
  `,
})
export class ResultsTopPlayers {
  readonly results = input.required<EventResults>();
  readonly limit = input(5);
  protected readonly fmt = formatNumber;
  private readonly teamMap = computed(() => teamsById(this.results()));
  protected readonly top = computed(() =>
    [...this.results().players]
      .filter((p) => p.points > 0 || p.captures > 0)
      .sort((a, b) => b.points - a.points || b.captures - a.captures)
      .slice(0, this.limit()),
  );
  protected team(id: string | null) {
    return id ? badgeOf(this.teamMap().get(id)) : null;
  }
}
