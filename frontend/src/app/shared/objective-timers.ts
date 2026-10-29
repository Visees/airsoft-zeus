import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../core/api/api.service';
import { Objective, ObjectiveTimer, ObjectiveTimerAction, Team } from '../core/api/models';
import { LiveStore } from '../core/live/live-store';
import { ConfirmService } from '../core/ui/confirm.service';
import { ToastService } from '../core/ui/toast.service';
import { formatClock } from '../core/util/format';
import { nowSignal } from './game-timer';
import { TeamBadge } from './team-badge';

interface TimerRow {
  team: Team;
  timer: ObjectiveTimer | null;
  over: boolean;
  clock: string;
  caption: string;
  state: string;
  tone: string;
  pct: number;
}

/** Remaining time shown as a countdown: 9:59.2 left reads 10:00 → round up to whole seconds. */
const countdown = (ms: number) => formatClock(Math.ceil(ms / 1000) * 1000);

/**
 * Team timers of an objective with a time limit. `control` (GMs and the objective's referees):
 * every team that can play it, with start / pause / resume / stop / reset. Otherwise the
 * viewer's own team, read-only. Needs the LiveStore of the live shell or the control center.
 */
@Component({
  selector: 'ah-objective-timers',
  imports: [NgIcon, HlmButton, TeamBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (rows().length) {
      <section class="panel flex flex-col gap-3 p-3" [attr.aria-labelledby]="'timer-h-' + objective().id">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 [id]="'timer-h-' + objective().id" class="label-caps">
            <ng-container i18n>Time limit</ng-container> · <span class="num">{{ limit() }}</span>
          </h3>
          @if (objective().isReferee) {
            <span class="rounded-sm border border-nav/60 px-1.5 py-0.5 text-xs font-semibold text-nav" i18n>You referee this objective</span>
          }
        </div>
        @if (control()) {
          <p class="-mt-1 text-xs text-muted-foreground" i18n>Start a team's timer when they begin the objective, stop it when they finish. It stands still while the game is paused.</p>
        }
        <ul class="flex flex-col gap-2">
          @for (r of rows(); track r.team.id) {
            <li class="rounded-md border p-3" [class.border-border]="!r.over" [class.border-destructive]="r.over" [class.bg-destructive/5]="r.over">
              <div class="flex items-center justify-between gap-2">
                <ah-team-badge [team]="r.team" size="sm" />
                <span class="text-xs font-semibold" [class]="r.tone">{{ r.state }}</span>
              </div>
              <p class="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span class="num text-4xl leading-tight font-bold" [class.text-destructive]="r.over" role="timer">{{ r.clock }}</span>
                <span class="text-sm text-muted-foreground">{{ r.caption }}</span>
              </p>
              <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div class="h-full transition-[width] duration-500" [class]="r.over ? 'bg-destructive' : r.pct > 80 ? 'bg-warning' : 'bg-primary'" [style.width.%]="r.pct"></div>
              </div>
              @if (control()) {
                <div class="mt-3 grid gap-1.5" [class.grid-cols-3]="r.timer && r.timer.state !== 'stopped'" [class.grid-cols-1]="!r.timer || r.timer.state === 'stopped'">
                  @if (!r.timer) {
                    <button hlmBtn type="button" class="h-12 font-bold" [disabled]="busy() === r.team.id" (click)="act(r.team, 'start')">
                      <ng-icon name="lucidePlay" size="18" aria-hidden="true" /> <ng-container i18n>Start timer</ng-container>
                    </button>
                  } @else if (r.timer.state === 'stopped') {
                    <button hlmBtn type="button" variant="outline" class="h-12" [disabled]="busy() === r.team.id" (click)="act(r.team, 'reset')">
                      <ng-icon name="lucideRotateCcw" size="18" aria-hidden="true" /> <ng-container i18n>Reset</ng-container>
                    </button>
                  } @else {
                    @if (r.timer.state === 'running') {
                      <button hlmBtn type="button" variant="outline" class="h-12" [disabled]="busy() === r.team.id" (click)="act(r.team, 'pause')">
                        <ng-icon name="lucidePause" size="18" aria-hidden="true" /> <ng-container i18n>Pause</ng-container>
                      </button>
                    } @else {
                      <button hlmBtn type="button" variant="outline" class="h-12" [disabled]="busy() === r.team.id" (click)="act(r.team, 'resume')">
                        <ng-icon name="lucidePlay" size="18" aria-hidden="true" /> <ng-container i18n>Resume</ng-container>
                      </button>
                    }
                    <button hlmBtn type="button" class="h-12 font-bold" [disabled]="busy() === r.team.id" (click)="act(r.team, 'stop')">
                      <ng-icon name="lucideSquare" size="16" aria-hidden="true" /> <ng-container i18n>Stop</ng-container>
                    </button>
                    <button hlmBtn type="button" variant="ghost" class="h-12" [disabled]="busy() === r.team.id" (click)="act(r.team, 'reset')">
                      <ng-icon name="lucideRotateCcw" size="16" aria-hidden="true" /> <ng-container i18n>Reset</ng-container>
                    </button>
                  }
                </div>
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class ObjectiveTimers {
  readonly objective = input.required<Objective>();
  /** GM or referee: every team, with controls. */
  readonly control = input(false);

  private readonly store = inject(LiveStore);
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  private readonly tick = nowSignal();
  protected readonly busy = signal<string | null>(null);

  protected readonly limit = computed(() => formatClock(this.objective().timerSec * 1000));

  private readonly teams = computed<Team[]>(() => {
    const o = this.objective();
    if (this.control()) return o.allowedTeamIds.length ? this.store.teams().filter((t) => o.allowedTeamIds.includes(t.id)) : this.store.teams();
    const mine = this.store.me()?.teamId;
    const team = mine ? this.store.teamById().get(mine) : null;
    return team ? [team] : [];
  });

  protected readonly rows = computed<TimerRow[]>(() => {
    const o = this.objective();
    const limitMs = o.timerSec * 1000;
    const now = this.tick() + this.store.serverOffsetMs();
    const byTeam = new Map(o.timers.map((t) => [t.teamId, t]));
    return this.teams().map((team) => {
      const timer = byTeam.get(team.id) ?? null;
      const elapsed = timer ? timer.elapsedMs + (timer.ticking ? Math.max(0, now - Date.parse(timer.at)) : 0) : 0;
      const over = elapsed > limitMs;
      const pct = limitMs ? Math.min(100, (elapsed / limitMs) * 100) : 0;
      if (!timer) {
        return { team, timer, over: false, clock: this.limit(), caption: $localize`to complete it`, state: $localize`Not started`, tone: 'text-muted-foreground', pct: 0 };
      }
      if (timer.state === 'stopped') {
        return {
          team,
          timer,
          over,
          clock: formatClock(elapsed),
          caption: over ? $localize`used, ${formatClock(elapsed - limitMs)}:overrun: over the limit` : $localize`used, ${formatClock(limitMs - elapsed)}:spare: to spare`,
          state: over ? $localize`Stopped · objective failed` : $localize`Stopped`,
          tone: over ? 'text-destructive' : 'text-primary',
          pct,
        };
      }
      const state = timer.state === 'paused' ? $localize`Paused` : timer.ticking ? $localize`Running` : $localize`Game paused`;
      return {
        team,
        timer,
        over,
        clock: over ? `-${formatClock(elapsed - limitMs)}` : countdown(limitMs - elapsed),
        caption: over ? $localize`over the limit` : $localize`left`,
        state: over ? $localize`Objective failed` : state,
        tone: over ? 'text-destructive' : timer.state === 'running' && timer.ticking ? 'text-primary' : 'text-warning',
        pct,
      };
    });
  });

  protected async act(team: Team, action: ObjectiveTimerAction): Promise<void> {
    const o = this.objective();
    const eventId = this.store.eventId();
    if (!eventId) return;
    if (action === 'reset') {
      const ok = await this.confirm.ask({
        title: $localize`Reset the timer of ${team.name}:team:?`,
        consequences: [$localize`The counted time is cleared. Start it again when the team begins the objective.`],
        confirmLabel: $localize`Reset timer`,
        destructive: true,
      });
      if (!ok) return;
    }
    this.busy.set(team.id);
    try {
      const updated = await this.api.objectiveTimer(eventId, o.id, team.id, action);
      if (updated) this.store.objectives.update((l) => l.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(null);
    }
  }
}
