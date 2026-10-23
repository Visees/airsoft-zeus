import { ChangeDetectionStrategy, Component, PendingTasks, RESPONSE_INIT, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { EventResults } from '../../core/api/models';
import { GAME_MODE_LABELS, formatDate, formatDuration, formatList } from '../../core/util/format';
import { Logo } from '../../shared/logo';
import { ErrorState } from '../../shared/states';
import { ResultsLeaderboard, ResultsTimeline, ResultsTopPlayers, ResultsWinner } from './results-parts';
import { leaders } from './results-utils';

type State = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Public results page (/r/:token). Rendered on the server for link previews and crawlers:
 * no window/document/localStorage, the fetch is tracked with PendingTasks so SSR waits for it,
 * and the HTTP transfer cache hands the response to the browser during hydration.
 */
@Component({
  selector: 'zeus-public-results-screen',
  imports: [RouterLink, NgIcon, HlmButton, ErrorState, Logo, ResultsLeaderboard, ResultsTimeline, ResultsTopPlayers, ResultsWinner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-dvh flex-col bg-background' },
  template: `
    <header class="border-b border-border bg-card">
      <div class="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <a routerLink="/welcome" class="hit flex items-center gap-2" aria-label="AirsoftHub home" i18n-aria-label>
          <zeus-logo class="h-6" />
        </a>
        <a hlmBtn variant="outline" class="tap" routerLink="/welcome" i18n>Create your own event</a>
      </div>
    </header>

    <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
      @switch (state()) {
        @case ('loading') {
          <div class="flex flex-col gap-4" role="status" aria-label="Loading results" i18n-aria-label>
            <div class="h-10 w-2/3 animate-pulse rounded-sm bg-muted"></div>
            <div class="h-28 animate-pulse rounded-md bg-muted"></div>
            <div class="h-48 animate-pulse rounded-md bg-muted"></div>
          </div>
        }
        @case ('not-found') {
          <div class="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
            <ng-icon name="lucideEyeOff" size="32" class="text-muted-foreground" aria-hidden="true" />
            <h1 class="text-2xl uppercase" i18n>Results not available</h1>
            <p class="text-muted-foreground" i18n>The link may be mistyped, or the organiser has not published (or has unpublished) these results.</p>
            <a hlmBtn class="tap mt-2" routerLink="/welcome" i18n>Create your own event</a>
          </div>
        }
        @case ('error') {
          <zeus-error-state [error]="error()" title="Could not load these results" (retry)="retry()" i18n-title />
        }
        @case ('ready') {
          @if (results(); as r) {
            <div class="mb-6">
              <p class="label-caps" i18n>After-action report</p>
              <h1 class="text-3xl uppercase md:text-4xl">{{ r.eventName }}</h1>
              <p class="mt-1 text-sm text-muted-foreground" i18n>
                {{ modeLabel() }} · {{ dateLabel() }} · <span class="num">{{ duration() }}</span> played · <span class="num">{{ r.players.length }}</span> players
              </p>
            </div>

            <div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
              <div class="flex min-w-0 flex-col gap-6">
                <zeus-results-winner [results]="r" />
                <zeus-results-leaderboard [results]="r" />
                <zeus-results-timeline [results]="r" [limit]="20" />
              </div>
              <aside class="flex flex-col gap-6">
                <zeus-results-top-players [results]="r" [limit]="10" />
                <section class="panel p-4" aria-labelledby="cta-title">
                  <h2 id="cta-title" class="font-bold uppercase" i18n>Run your own game</h2>
                  <p class="mt-1 text-sm text-muted-foreground" i18n>Objectives, live map, team scores and a results page like this one for your next airsoft event.</p>
                  <a hlmBtn class="mt-3 h-11 w-full" routerLink="/welcome" i18n>Create your own event</a>
                </section>
              </aside>
            </div>
          }
        }
      }
    </main>

    <footer class="border-t border-border py-4 text-center text-xs text-muted-foreground" i18n>
      Published with AirsoftHub. Player positions are never shown on public pages.
    </footer>
  `,
})
export class PublicResultsScreen {
  private readonly api = inject(ApiService);
  private readonly titleService = inject(Title);
  private readonly meta = inject(Meta);
  private readonly pendingTasks = inject(PendingTasks);
  /** Only present during server rendering: lets us answer 404 for unpublished results. */
  private readonly responseInit = inject(RESPONSE_INIT, { optional: true });

  readonly token = input.required<string>();

  protected readonly state = signal<State>('loading');
  protected readonly results = signal<EventResults | null>(null);
  protected readonly error = signal<unknown>(null);

  protected readonly modeLabel = computed(() => GAME_MODE_LABELS[this.results()?.gameMode ?? 'custom']);
  protected readonly dateLabel = computed(() => formatDate(this.results()?.startedAt ?? this.results()?.endedAt));
  protected readonly duration = computed(() => formatDuration(this.results()?.durationMs ?? 0));

  constructor() {
    effect(() => {
      const token = this.token();
      untracked(() => this.pendingTasks.run(() => this.load(token)));
    });
  }

  protected retry(): void {
    this.pendingTasks.run(() => this.load(this.token()));
  }

  private async load(token: string): Promise<void> {
    this.state.set('loading');
    try {
      const r = await this.api.publicResults(token);
      if (token !== this.token()) return;
      this.results.set(r);
      this.state.set('ready');
      this.setMeta(r);
    } catch (err) {
      if (token !== this.token()) return;
      const e = ApiError.from(err);
      if (e.status === 404) {
        this.state.set('not-found');
        if (this.responseInit) this.responseInit.status = 404;
        this.titleService.setTitle($localize`Results not available — AirsoftHub`);
        this.meta.updateTag({ name: 'robots', content: 'noindex' });
      } else {
        this.error.set(err);
        this.state.set('error');
        this.titleService.setTitle($localize`Event results — AirsoftHub`);
      }
    }
  }

  private setMeta(r: EventResults): void {
    const mode = GAME_MODE_LABELS[r.gameMode];
    const title = $localize`${r.eventName}:eventName: — results`;
    const winner = r.teams.find((t) => t.teamId === r.winnerTeamId);
    const outcome = r.isDraw
      ? $localize`Draw between ${formatList(leaders(r).map((t) => t.name))}:teams:`
      : winner
        ? $localize`${winner.name}:name: won with ${winner.points}:points: points`
        : $localize`Final results`;
    const description = $localize`${outcome}:outcome:. ${mode}:mode: · ${r.teams.length}:length: teams · ${r.players.length}:length2: players · ${formatDuration(r.durationMs)}:durationMs: played.`;
    this.titleService.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:site_name', content: 'AirsoftHub' });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary' });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    this.meta.removeTag("name='robots'");
  }
}
