import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { EventDetail, Member, Squad, Team } from '../../core/api/models';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { playsIn } from '../../core/util/members';
import { PlayerListItem } from '../../shared/cards';
import { SquadBadge } from '../../shared/squad-badge';
import { TeamBadge } from '../../shared/team-badge';

interface SquadGroup {
  squad: Squad | null;
  members: Member[];
}
interface TeamGroup {
  team: Team | null;
  count: number;
  ready: number;
  squads: SquadGroup[];
}

/** Registered players grouped by team, then squad. GMs get assign/remove actions. */
@Component({
  selector: 'zeus-lobby-roster',
  imports: [NgIcon, HlmButton, PlayerListItem, TeamBadge, SquadBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let e = event();
    <section aria-labelledby="roster-title">
      <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="roster-title" class="label-caps">
          Players · <span class="num">{{ players().length }}/{{ e.maxPlayers }}</span> · <span class="num">{{ readyCount() }}</span> ready
        </h2>
        <p class="text-xs" [class]="players().length >= e.minPlayers ? 'text-primary' : 'text-warning'">
          @if (players().length >= e.minPlayers) {
            ✓ Minimum of <span class="num">{{ e.minPlayers }}</span> reached
          } @else {
            ▲ <span class="num">{{ e.minPlayers - players().length }}</span> more needed (min <span class="num">{{ e.minPlayers }}</span>)
          }
        </p>
      </div>

      @if (unavailable()) {
        <p class="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          The player list is not available right now. <span class="num">{{ e.approvedCount }}</span> players are registered.
        </p>
      } @else if (!players().length) {
        <p class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No players registered yet.</p>
      } @else {
        <div class="flex flex-col gap-3">
          @for (g of groups(); track g.team?.id ?? 'none') {
            <div class="panel">
              <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                @if (g.team) {
                  <zeus-team-badge [team]="g.team" />
                } @else {
                  <span class="font-semibold text-muted-foreground">No team yet</span>
                }
                <span class="num text-xs text-muted-foreground">
                  {{ g.count }}{{ g.team?.capacity ? '/' + g.team!.capacity : '' }} · {{ g.ready }} ready
                </span>
              </div>
              @for (s of g.squads; track s.squad?.id ?? 'none') {
                @if (s.squad) {
                  <div class="px-3 pt-2"><zeus-squad-badge [squad]="s.squad" /></div>
                } @else if (g.squads.length > 1) {
                  <p class="label-caps px-3 pt-2">No squad</p>
                }
                <ul class="divide-y divide-border px-3">
                  @for (m of s.members; track m.userId) {
                    <li>
                      <zeus-player-list-item [member]="m" [team]="g.team" [squad]="s.squad" [isSelf]="m.userId === selfId()" [showPresence]="true">
                        @if (m.role === 'gm') {
                          <!-- A Game Master playing on this team: no checklist. -->
                        } @else if (m.ready) {
                          <span class="inline-flex items-center gap-1 rounded-sm bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary">✓ <span class="hidden sm:inline">Ready</span><span class="sr-only sm:hidden">Ready</span></span>
                        } @else {
                          <span class="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted-foreground">○ <span class="hidden sm:inline">Not ready</span><span class="sr-only sm:hidden">Not ready</span></span>
                        }
                        @if (isGm() && m.role === 'player') {
                          @if (!m.rulesAccepted) {
                            <span class="hidden text-xs text-warning md:inline" title="Rules not accepted">▲ Rules</span>
                          }
                          @if (!m.trackingConsented) {
                            <span class="hidden text-xs text-muted-foreground md:inline" title="No location consent">◌ GPS</span>
                          }
                        }
                      </zeus-player-list-item>
                      @if (isGm()) {
                        <div class="flex items-center gap-2 pb-2 pl-13">
                          <label class="sr-only" [for]="'assign-' + m.userId">Team for {{ m.nickname }}</label>
                          <select
                            [id]="'assign-' + m.userId"
                            class="h-11 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30"
                            [disabled]="busy() === m.userId"
                            (change)="assign(m, $any($event.target).value, $event)"
                          >
                            <option value="" [selected]="!m.teamId">No team</option>
                            @for (t of sortedTeams(); track t.id) {
                              <option [value]="t.id" [selected]="t.id === m.teamId">{{ t.name }} ({{ t.memberCount }}{{ t.capacity ? '/' + t.capacity : '' }})</option>
                            }
                          </select>
                          @if (m.role === 'player') {
                            <button hlmBtn variant="ghost" type="button" class="tap text-destructive" [disabled]="busy() === m.userId" (click)="remove(m)" [attr.aria-label]="'Remove ' + m.nickname">
                              <ng-icon name="lucideUserMinus" size="18" aria-hidden="true" />
                            </button>
                          }
                        </div>
                      }
                    </li>
                  }
                </ul>
              }
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class LobbyRoster {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly event = input.required<EventDetail>();
  readonly members = input.required<Member[]>();
  readonly isGm = input(false);
  readonly selfId = input<string | null>(null);
  /** The member list could not be loaded (e.g. not allowed for this viewer). */
  readonly unavailable = input(false);
  /** Membership changed on the server: parent refetches. */
  readonly changed = output<void>();

  protected readonly busy = signal<string | null>(null);

  protected readonly sortedTeams = computed(() => [...this.event().teams].sort((a, b) => a.sortOrder - b.sortOrder));
  protected readonly players = computed(() => this.members().filter((m) => m.status === 'approved' && m.role === 'player'));
  protected readonly readyCount = computed(() => this.players().filter((m) => m.ready).length);
  /** Players plus Game Masters who play on a team (they don't take a player place). */
  private readonly lineUp = computed(() => this.members().filter(playsIn));

  protected readonly groups = computed<TeamGroup[]>(() => {
    const players = [...this.lineUp()].sort((a, b) => a.nickname.localeCompare(b.nickname));
    const squads = this.event().squads;
    const build = (team: Team | null): TeamGroup => {
      const inTeam = players.filter((m) => (team ? m.teamId === team.id : !m.teamId || !this.event().teams.some((t) => t.id === m.teamId)));
      const teamSquads = team ? squads.filter((s) => s.teamId === team.id).sort((a, b) => a.name.localeCompare(b.name)) : [];
      const groups: SquadGroup[] = teamSquads
        .map((s) => ({
          squad: s,
          members: inTeam.filter((m) => m.squadId === s.id).sort((a, b) => Number(b.isSquadLeader) - Number(a.isSquadLeader)),
        }))
        .filter((g) => g.members.length);
      const loose = inTeam.filter((m) => !m.squadId || !teamSquads.some((s) => s.id === m.squadId));
      if (loose.length) groups.push({ squad: null, members: loose });
      return { team, count: inTeam.length, ready: inTeam.filter((m) => m.ready).length, squads: groups };
    };
    const result = this.sortedTeams().map(build);
    const none = build(null);
    // Empty teams stay visible so everyone sees the line-up; the "No team" group only when used.
    return none.count ? [...result, none] : result;
  });

  protected async assign(m: Member, teamId: string, ev: Event): Promise<void> {
    const target = teamId || null;
    if (target === m.teamId) return;
    const select = ev.target as HTMLSelectElement;
    this.busy.set(m.userId);
    try {
      await this.api.assignMember(this.event().id, m.userId, { teamId: target });
      const name = this.event().teams.find((t) => t.id === target)?.name;
      this.toast.success(name ? `${m.nickname} moved to ${name}` : `${m.nickname} has no team now`);
      this.changed.emit();
    } catch (err) {
      select.value = m.teamId ?? '';
      this.toast.error(err);
    } finally {
      this.busy.set(null);
    }
  }

  protected async remove(m: Member): Promise<void> {
    const reason = await this.confirm.askReason({
      title: `Remove ${m.nickname}?`,
      consequences: [
        `${m.nickname} is removed from the event and notified with your reason.`,
        'Their team place is released.',
        'They cannot rejoin unless you invite or approve them again.',
      ],
      reason: { label: 'Reason', required: true, placeholder: 'e.g. No-show, safety violation' },
      confirmLabel: 'Remove player',
      destructive: true,
    });
    if (reason === null) return;
    this.busy.set(m.userId);
    try {
      await this.api.removeMember(this.event().id, m.userId, reason);
      this.toast.info(`${m.nickname} removed`);
      this.changed.emit();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(null);
    }
  }
}
