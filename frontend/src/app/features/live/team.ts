import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from '../../core/api/api.service';
import { ApiError } from '../../core/api/api-error';
import { LedgerEntry, Member, Squad } from '../../core/api/models';
import { LiveStore } from '../../core/live/live-store';
import { LEDGER_TYPE_LABELS, formatRelative, formatSigned, formatTime } from '../../core/util/format';
import { PlayerListItem } from '../../shared/cards';
import { CurrencyDisplay } from '../../shared/currency-display';
import { nowSignal } from '../../shared/game-timer';
import { ScoreDisplay } from '../../shared/score-display';
import { SquadBadge } from '../../shared/squad-badge';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../shared/states';
import { TeamBadge } from '../../shared/team-badge';
import { remaining } from './live-util';

interface SquadGroup {
  key: string;
  squad: Squad | null;
  mine: boolean;
  members: Member[];
}

/** My team: score, members by squad, perks, messages, recent ledger and the scoreboard. */
@Component({
  selector: 'zeus-team-screen',
  imports: [PlayerListItem, TeamBadge, SquadBadge, ScoreDisplay, CurrencyDisplay, EmptyState, ErrorState, LoadingSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-4 pb-8">
      @if (store.myTeam(); as team) {
        <!-- Header -->
        <header class="panel flex flex-col gap-3 p-4">
          <p class="label-caps">Your team</p>
          <h2 class="sr-only">{{ team.name }}</h2>
          <zeus-team-badge [team]="team" size="lg" />
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
            <zeus-score-display [points]="team.points" size="lg" />
            @if (team.currency !== null) {
              <zeus-currency-display [amount]="team.currency" size="lg" />
            }
          </div>
          <p class="text-sm text-muted-foreground">
            <span class="num">{{ team.memberCount }}</span> players · holding <span class="num">{{ team.objectivesHeld }}</span> objectives
          </p>
        </header>

        <!-- Active perks -->
        @if (effects().length) {
          <section class="flex flex-col gap-2" aria-labelledby="perks-title">
            <h3 id="perks-title" class="label-caps">Active perks · <span class="num">{{ effects().length }}</span></h3>
            <ul class="panel flex flex-col divide-y divide-border">
              @for (e of effects(); track e.id) {
                <li class="flex items-center gap-2 p-3 text-sm">
                  <span aria-hidden="true" [class]="e.hostile ? 'text-destructive' : 'text-primary'">{{ e.hostile ? '▲' : '●' }}</span>
                  <span class="min-w-0 flex-1 font-semibold">
                    {{ e.label }}
                    @if (e.hostile) {
                      <span class="font-normal text-destructive">— used against your team</span>
                    }
                  </span>
                  @if (e.left) {
                    <span class="num font-bold text-warning">{{ e.left }}</span>
                  }
                </li>
              }
            </ul>
          </section>
        }

        <!-- Members -->
        <section class="flex flex-col gap-3" aria-labelledby="members-title">
          <h3 id="members-title" class="label-caps">Members · <span class="num">{{ memberCount() }}</span></h3>
          @if (!memberCount()) {
            <zeus-empty-state icon="lucideUsers" title="No teammates yet" message="Players assigned to your team appear here." />
          }
          @for (g of squads(); track g.key) {
            <div class="panel px-3 py-2" [class.border-primary]="g.mine" [class.border-2]="g.mine">
              <div class="flex items-center gap-2 py-1">
                @if (g.squad) {
                  <zeus-squad-badge [squad]="g.squad" />
                } @else {
                  <span class="label-caps">No squad</span>
                }
                @if (g.mine) {
                  <span class="text-xs font-bold text-primary">YOUR SQUAD</span>
                }
                <span class="num ml-auto text-xs text-muted-foreground">{{ g.members.length }}</span>
              </div>
              <ul class="divide-y divide-border">
                @for (m of g.members; track m.userId) {
                  <li>
                    <zeus-player-list-item [member]="m" [squad]="g.squad" [isSelf]="m.userId === myUserId()" [showPresence]="true" />
                  </li>
                }
              </ul>
            </div>
          }
        </section>

        <!-- Messages -->
        <section class="flex flex-col gap-2" aria-labelledby="msg-title">
          <h3 id="msg-title" class="label-caps">Messages · <span class="num">{{ announcements().length }}</span></h3>
          @if (!announcements().length) {
            <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No messages from the Game Master yet.</p>
          } @else {
            <ul class="flex flex-col gap-2">
              @for (a of announcements(); track a.id) {
                <li
                  class="panel p-3"
                  [class.border-destructive]="a.priority === 'emergency'"
                  [class.border-warning]="a.priority === 'high'"
                >
                  <p class="label-caps">
                    @if (a.priority === 'emergency') {
                      <span class="text-destructive">Emergency</span> ·
                    } @else if (a.priority === 'high') {
                      <span class="text-warning">Important</span> ·
                    }
                    {{ a.scope === 'team' ? 'Team' : a.scope === 'player' ? 'To you' : 'Everyone' }} ·
                    <span class="num">{{ time(a.createdAt) }}</span>
                  </p>
                  <p class="font-bold">{{ a.title }}</p>
                  @if (a.body) {
                    <p class="text-sm whitespace-pre-line">{{ a.body }}</p>
                  }
                  @if (a.authorNickname) {
                    <p class="mt-1 text-xs text-muted-foreground">— {{ a.authorNickname }}</p>
                  }
                </li>
              }
            </ul>
          }
        </section>

        <!-- Ledger -->
        <section class="flex flex-col gap-2" aria-labelledby="ledger-title">
          <h3 id="ledger-title" class="label-caps">Recent points and credits</h3>
          @if (ledgerLoading() && !ledger().length) {
            <zeus-loading-skeleton [rows]="3" />
          } @else if (ledgerError() && !ledger().length) {
            <zeus-error-state [error]="ledgerError()" title="Could not load the history" (retry)="loadLedger()" />
          } @else if (!ledger().length) {
            <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No points or credits recorded yet.</p>
          } @else {
            <ol class="panel flex flex-col divide-y divide-border">
              @for (l of ledger(); track l.id) {
                <li class="flex items-center gap-3 p-3 text-sm">
                  <span class="min-w-0 flex-1">
                    <span class="block font-semibold">{{ ledgerLabel(l) }}</span>
                    <span class="block truncate text-xs text-muted-foreground">
                      {{ l.reason || l.objectiveName || '' }}
                      @if (l.nickname) {
                        · {{ l.nickname }}
                      }
                      · <span class="num">{{ rel(l.createdAt) }}</span>
                    </span>
                  </span>
                  <span
                    class="num shrink-0 text-base font-bold"
                    [class.text-primary]="l.amount > 0"
                    [class.text-destructive]="l.amount < 0"
                  >
                    {{ signed(l.amount) }} <span class="text-xs font-semibold">{{ l.kind === 'points' ? 'pts' : 'cr' }}</span>
                  </span>
                </li>
              }
            </ol>
          }
        </section>
      } @else {
        <zeus-empty-state
          icon="lucideUsers"
          title="You are not on a team"
          message="The Game Master assigns teams. Until then you can follow the game on the map and the scoreboard below."
        />
      }

      <!-- Scoreboard -->
      <section class="flex flex-col gap-2" aria-labelledby="board-title">
        <h3 id="board-title" class="label-caps">Scoreboard · <span class="num">{{ board().length }}</span> teams</h3>
        <ol class="panel flex flex-col divide-y divide-border">
          @for (t of board(); track t.id; let i = $index) {
            <li class="flex items-center gap-3 p-3" [style.background]="t.id === myTeamId() ? 'color-mix(in oklch, var(--primary) 12%, transparent)' : null">
              <span class="num w-6 shrink-0 text-lg font-bold">{{ i + 1 }}</span>
              <span class="min-w-0 flex-1">
                <zeus-team-badge [team]="t" />
                @if (t.id === myTeamId()) {
                  <span class="sr-only">(your team)</span>
                }
                <span class="block text-xs text-muted-foreground"><span class="num">{{ t.objectivesHeld }}</span> held</span>
              </span>
              <span class="flex shrink-0 flex-col items-end gap-0.5">
                <zeus-score-display [points]="t.points" size="md" />
                @if (t.currency !== null) {
                  <zeus-currency-display [amount]="t.currency" size="sm" />
                }
              </span>
            </li>
          }
        </ol>
      </section>
    </div>
  `,
})
export class TeamScreen {
  protected readonly store = inject(LiveStore);
  private readonly api = inject(ApiService);

  private readonly tick = nowSignal();
  private readonly serverNow = computed(() => this.tick() + this.store.serverOffsetMs());

  protected readonly ledger = signal<LedgerEntry[]>([]);
  protected readonly ledgerLoading = signal(false);
  protected readonly ledgerError = signal<ApiError | null>(null);

  protected readonly myTeamId = computed(() => this.store.myTeam()?.id ?? null);
  protected readonly myUserId = computed(() => this.store.me()?.userId ?? null);

  private readonly teamMembers = computed(() => {
    const teamId = this.myTeamId();
    return teamId ? this.store.members().filter((m) => m.teamId === teamId && m.status === 'approved') : [];
  });
  protected readonly memberCount = computed(() => this.teamMembers().length);

  protected readonly squads = computed<SquadGroup[]>(() => {
    const teamId = this.myTeamId();
    const mySquadId = this.store.me()?.squadId ?? null;
    const squads = (this.store.event()?.squads ?? []).filter((s) => s.teamId === teamId);
    const bySquad = new Map<string, Member[]>();
    for (const m of this.teamMembers()) {
      const key = m.squadId && squads.some((s) => s.id === m.squadId) ? m.squadId : '';
      bySquad.set(key, [...(bySquad.get(key) ?? []), m]);
    }
    const sortMembers = (list: Member[], squad: Squad | null) =>
      [...list].sort((a, b) => {
        const la = a.isSquadLeader || squad?.leaderId === a.userId ? 0 : 1;
        const lb = b.isSquadLeader || squad?.leaderId === b.userId ? 0 : 1;
        if (la !== lb) return la - lb;
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.nickname.localeCompare(b.nickname);
      });
    const groups: SquadGroup[] = squads
      .filter((s) => bySquad.has(s.id))
      .map((s) => ({ key: s.id, squad: s, mine: s.id === mySquadId, members: sortMembers(bySquad.get(s.id)!, s) }));
    groups.sort((a, b) => (a.mine === b.mine ? 0 : a.mine ? -1 : 1));
    const loose = bySquad.get('');
    if (loose?.length) groups.push({ key: 'none', squad: null, mine: false, members: sortMembers(loose, null) });
    return groups;
  });

  protected readonly effects = computed(() => {
    const teamId = this.myTeamId();
    if (!teamId) return [];
    const now = this.serverNow();
    return this.store
      .activeEffects()
      .filter((e) => (e.teamId === teamId || e.targetTeamId === teamId) && new Date(e.expiresAt).getTime() > now)
      .map((e) => ({ id: e.id, label: e.label, hostile: e.teamId !== teamId, left: remaining(e.expiresAt, now) }));
  });

  protected readonly announcements = computed(() => {
    const teamId = this.myTeamId();
    const me = this.myUserId();
    return this.store
      .announcements()
      .filter((a) => a.scope === 'all' || (a.scope === 'team' && a.teamId === teamId) || (a.scope === 'player' && a.targetUserId === me))
      .slice(0, 20);
  });

  protected readonly board = computed(() => [...this.store.teams()].sort((a, b) => b.points - a.points || a.sortOrder - b.sortOrder));

  constructor() {
    // Load the ledger for my team, and again when the team's balances move.
    effect(() => {
      const teamId = this.myTeamId();
      const team = this.store.myTeam();
      void team?.points;
      void team?.currency;
      if (teamId) untracked(() => void this.loadLedger());
    });
  }

  async loadLedger(): Promise<void> {
    const eventId = this.store.eventId();
    const teamId = this.myTeamId();
    if (!eventId || !teamId || this.ledgerLoading()) return;
    this.ledgerLoading.set(true);
    this.ledgerError.set(null);
    try {
      const page = await this.api.ledger(eventId, { teamId });
      this.ledger.set(page.items.slice(0, 25));
    } catch (e) {
      this.ledgerError.set(ApiError.from(e));
    } finally {
      this.ledgerLoading.set(false);
    }
  }

  protected ledgerLabel(l: LedgerEntry): string {
    return LEDGER_TYPE_LABELS[l.type] ?? l.type;
  }
  protected signed(n: number): string {
    return formatSigned(n);
  }
  protected rel(iso: string): string {
    return formatRelative(iso, this.serverNow());
  }
  protected time(iso: string): string {
    return formatTime(iso);
  }
}
