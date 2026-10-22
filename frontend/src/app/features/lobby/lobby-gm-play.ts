import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { EventDetail, Member, Team } from '../../core/api/models';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { TeamBadge } from '../../shared/team-badge';

/** A Game Master joins (or leaves) a team to play the game too. */
@Component({
  selector: 'zeus-lobby-gm-play',
  imports: [RouterLink, NgIcon, HlmButton, TeamBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let e = event();
    <section class="panel flex flex-col gap-3 p-4" aria-labelledby="gm-play-title">
      <div>
        <h2 id="gm-play-title" class="label-caps">Play in a team</h2>
        @if (myTeam(); as t) {
          <p class="mt-2 flex flex-wrap items-center gap-2 text-sm">You play with <zeus-team-badge [team]="t" size="sm" /></p>
          <p class="mt-1 text-xs text-muted-foreground">
            The live map shows you only what your team sees. The control center still shows everything.
          </p>
        } @else {
          <p class="mt-1 text-sm text-muted-foreground">
            Join a team to take part: capture objectives, buy perks and share your position with your team.
          </p>
        }
      </div>

      <ul class="grid gap-2">
        @for (t of teams(); track t.id) {
          @let full = t.capacity > 0 && t.memberCount >= t.capacity;
          @let mine = t.id === myTeam()?.id;
          <li>
            <button
              type="button"
              class="tap flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left disabled:opacity-60"
              [class]="mine ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/60'"
              [disabled]="mine || full || busy()"
              [attr.aria-pressed]="mine"
              [attr.aria-label]="(mine ? 'Your team: ' : 'Join ') + t.name + ', ' + t.memberCount + (t.capacity ? ' of ' + t.capacity : '') + ' players' + (full && !mine ? ', full' : '')"
              (click)="join(t)"
            >
              <zeus-team-badge [team]="t" size="sm" />
              <span class="num shrink-0 text-xs text-muted-foreground">
                {{ t.memberCount }}{{ t.capacity ? '/' + t.capacity : '' }}
                @if (mine) { <span class="text-primary">✓</span> } @else if (full) { ■ Full }
              </span>
            </button>
          </li>
        } @empty {
          <li class="rounded-md border border-dashed border-border p-3 text-center text-sm text-muted-foreground">Create teams first.</li>
        }
      </ul>

      @if (myTeam()) {
        <div class="flex flex-col gap-2 sm:flex-row">
          @if (running()) {
            <a hlmBtn class="h-11 flex-1" [routerLink]="['/events', e.id, 'live']"><ng-icon name="lucideMap" size="16" aria-hidden="true" /> Open live map</a>
          }
          <button hlmBtn variant="outline" type="button" class="h-11 flex-1" [disabled]="busy()" (click)="leaveTeam()">
            <ng-icon name="lucideLogOut" size="16" aria-hidden="true" /> {{ busy() ? 'Saving…' : 'Stop playing' }}
          </button>
        </div>
      }
    </section>
  `,
})
export class LobbyGmPlay {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly event = input.required<EventDetail>();
  readonly memberChange = output<Member>();

  protected readonly busy = signal(false);
  protected readonly teams = computed(() => [...this.event().teams].sort((a, b) => a.sortOrder - b.sortOrder));
  protected readonly myTeam = computed(() => this.event().teams.find((t) => t.id === this.event().me?.teamId) ?? null);
  protected readonly running = computed(() => this.event().status === 'live' || this.event().status === 'paused');

  protected async join(t: Team): Promise<void> {
    const current = this.myTeam();
    const ok = await this.confirm.ask({
      title: current ? `Switch to ${t.name}?` : `Play with ${t.name}?`,
      consequences: [
        ...(current ? [`You leave ${current.name}${this.event().me?.squadId ? ' and your squad' : ''}.`] : []),
        'Your captures and purchases count for this team, and your teammates see your position.',
        'On the live map you see only what this team sees. The control center still shows everything.',
      ],
      confirmLabel: `Join ${t.name}`,
    });
    if (!ok) return;
    await this.assign(t.id, `You play with ${t.name}`);
  }

  protected async leaveTeam(): Promise<void> {
    const current = this.myTeam();
    if (!current) return;
    const ok = await this.confirm.ask({
      title: `Stop playing with ${current.name}?`,
      consequences: ['You go back to running the game only.', 'Your position is no longer shared.', 'Points you already scored stay with the team.'],
      confirmLabel: 'Stop playing',
    });
    if (!ok) return;
    await this.assign(null, 'You no longer play in a team');
  }

  private async assign(teamId: string | null, done: string): Promise<void> {
    const me = this.event().me;
    if (!me) return;
    this.busy.set(true);
    try {
      this.memberChange.emit(await this.api.assignMember(this.event().id, me.userId, { teamId }));
      this.toast.success(done);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }
}
