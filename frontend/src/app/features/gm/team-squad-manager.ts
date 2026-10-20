import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { filter } from 'rxjs';
import { ApiService } from '../../core/api/api.service';
import { EventDetail, Member, Squad, Team } from '../../core/api/models';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { PlayerListItem } from '../../shared/cards';
import { ConnectionStatus } from '../../shared/link-status';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { MemberAssign, isRunning } from './common/member-assign';
import { TWO_TEAM_PRESET, nextTeamPreset } from './common/team-form';
import { TeamEditor } from './common/team-editor';
import { TeamSelectionSettings } from './common/team-selection';

interface RosterGroup {
  squad: Squad | null;
  members: Member[];
}

@Component({
  selector: 'zeus-team-squad-manager-screen',
  imports: [NgIcon, HlmButton, PageHeader, LoadingSkeleton, ErrorState, EmptyState, PlayerListItem, MemberAssign, TeamEditor, TeamSelectionSettings, ConnectionStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <zeus-page-header title="Teams and squads" [eyebrow]="event()?.name ?? null" [back]="'/gm/events/' + eventId()" backLabel="Event editor">
        <zeus-connection-status [compact]="true" />
        @if (event()) {
          <button hlmBtn variant="outline" class="h-11" type="button" (click)="addTeam()" [disabled]="busy() || event()!.teams.length >= 16">
            <ng-icon name="lucidePlus" size="16" aria-hidden="true" /> Add team
          </button>
        }
      </zeus-page-header>

      @if (loading() && !event()) {
        <zeus-loading-skeleton [rows]="6" [avatar]="true" />
      } @else if (loadError(); as err) {
        <zeus-error-state [error]="err" (retry)="load()" />
      } @else if (event(); as e) {
        @if (running()) {
          <div class="mb-4 flex gap-2 rounded-sm border border-warning/50 bg-warning-surface p-3 text-sm text-warning" role="status">
            <ng-icon name="lucideTriangleAlert" size="18" class="shrink-0" aria-hidden="true" />
            <p>The game is {{ e.status }}. Moving a player changes what they see on the map immediately. Teams cannot be deleted any more.</p>
          </div>
        }

        <div class="mb-6 grid gap-4 lg:grid-cols-2">
          <zeus-team-selection-settings [event]="e" (updated)="event.set($event)" />

          <section class="panel flex flex-col gap-3 p-4" aria-labelledby="unassigned-h">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 id="unassigned-h" class="label-caps">Without a team · {{ unassigned().length }}</h2>
              <button hlmBtn variant="outline" class="h-11" type="button" (click)="autoBalance()" [disabled]="busy() || !unassigned().length || e.teams.length < 1">
                <ng-icon name="lucideUsers" size="16" aria-hidden="true" /> Auto-balance teams
              </button>
            </div>
            @if (unassigned().length) {
              <ul class="max-h-96 divide-y divide-border overflow-y-auto">
                @for (m of unassigned(); track m.userId) {
                  <li class="py-1">
                    <zeus-player-list-item [member]="m" [showPresence]="true" />
                    <zeus-member-assign class="pb-2 pl-13" [eventId]="e.id" [member]="m" [teams]="e.teams" [squads]="e.squads" [running]="running()" (assigned)="onAssigned($event)" />
                  </li>
                }
              </ul>
            } @else {
              <p class="text-sm text-muted-foreground">Every approved player has a team.</p>
            }
          </section>
        </div>

        @if (!sortedTeams().length) {
          <zeus-empty-state icon="lucideUsers" title="No teams yet" message="A game needs at least two teams. Each team gets a colour, a pattern and an icon.">
            <button hlmBtn class="h-11" type="button" (click)="addTwoTeams()" [disabled]="busy()">
              <ng-icon name="lucideSparkles" size="16" aria-hidden="true" /> Add two teams (Alpha and Bravo)
            </button>
          </zeus-empty-state>
        } @else {
          @if (sortedTeams().length < 2) {
            <p class="mb-3 text-sm text-warning" role="status">◐ Add a second team: the game cannot start with one.</p>
          }
          <div class="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
            @for (t of sortedTeams(); track t.id) {
              <zeus-team-editor
                [eventId]="e.id"
                [team]="t"
                [allTeams]="e.teams"
                [squads]="e.squads"
                [members]="players()"
                [running]="running()"
                advanced
                (changed)="load()"
              >
                <section class="border-t border-border p-3" [attr.aria-label]="'Roster of ' + t.name">
                  <h3 class="label-caps mb-1">Roster · {{ rosterCount(t) }}{{ t.capacity ? ' / ' + t.capacity : '' }}</h3>
                  @for (g of roster(t); track g.squad?.id ?? 'none') {
                    @if (g.squad || roster(t).length > 1) {
                      <p class="mt-2 text-xs font-semibold uppercase text-muted-foreground">{{ g.squad ? g.squad.callsign || g.squad.name : 'No squad' }}</p>
                    }
                    <ul class="divide-y divide-border">
                      @for (m of g.members; track m.userId) {
                        <li class="py-1">
                          <zeus-player-list-item [member]="m" [team]="t" [squad]="g.squad" [showPresence]="true" [showGps]="running()" />
                          <zeus-member-assign class="pb-2 pl-13" [eventId]="e.id" [member]="m" [teams]="e.teams" [squads]="e.squads" [running]="running()" (assigned)="onAssigned($event)" />
                        </li>
                      }
                    </ul>
                  } @empty {
                    <p class="text-sm text-muted-foreground">No players yet.</p>
                  }
                </section>
              </zeus-team-editor>
            }
          </div>
        }
      }
    </div>
  `,
})
export class TeamSquadManagerScreen {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly realtime = inject(RealtimeService);
  private readonly destroyRef = inject(DestroyRef);

  readonly eventId = input.required<string>();

  protected readonly event = signal<EventDetail | null>(null);
  protected readonly members = signal<Member[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<unknown>(null);
  protected readonly busy = signal(false);

  protected readonly running = computed(() => isRunning(this.event()?.status));
  protected readonly sortedTeams = computed(() => [...(this.event()?.teams ?? [])].sort((a, b) => a.sortOrder - b.sortOrder));
  protected readonly players = computed(() => this.members().filter((m) => m.role === 'player' && m.status === 'approved'));
  protected readonly unassigned = computed(() => this.players().filter((m) => !m.teamId).sort((a, b) => a.nickname.localeCompare(b.nickname)));

  private loadSeq = 0;

  constructor() {
    effect(() => {
      const id = this.eventId();
      untracked(() => {
        this.event.set(null);
        void this.load();
        void this.realtime.subscribe(id, this.destroyRef);
      });
    });
    this.realtime
      .on('invalidate')
      .pipe(
        filter((p) => p.eventId === this.eventId() && p.scopes.some((s) => s === 'members' || s === 'event' || s === 'squads')),
        takeUntilDestroyed(),
      )
      .subscribe(() => void this.load());
  }

  async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [e, members] = await Promise.all([this.api.event(this.eventId()), this.api.members(this.eventId())]);
      if (seq !== this.loadSeq) return;
      this.event.set(e);
      this.members.set(members);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      if (this.event()) this.toast.error(err);
      else this.loadError.set(err);
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  protected roster(t: Team): RosterGroup[] {
    const e = this.event();
    const inTeam = this.players()
      .filter((m) => m.teamId === t.id)
      .sort((a, b) => Number(b.isSquadLeader) - Number(a.isSquadLeader) || a.nickname.localeCompare(b.nickname));
    const squads = (e?.squads ?? []).filter((s) => s.teamId === t.id);
    const groups: RosterGroup[] = squads.map((s) => ({ squad: s, members: inTeam.filter((m) => m.squadId === s.id) })).filter((g) => g.members.length);
    const loose = inTeam.filter((m) => !m.squadId || !squads.some((s) => s.id === m.squadId));
    if (loose.length) groups.push({ squad: null, members: loose });
    return groups;
  }

  protected rosterCount(t: Team): number {
    return this.players().filter((m) => m.teamId === t.id).length;
  }

  protected onAssigned(m: Member): void {
    this.members.update((list) => list.map((x) => (x.userId === m.userId ? m : x)));
    // Team counts and squad leaders change too.
    void this.load();
  }

  protected async autoBalance(): Promise<void> {
    const e = this.event();
    if (!e) return;
    const n = this.unassigned().length;
    const ok = await this.confirm.ask({
      title: 'Auto-balance teams?',
      consequences: [
        `Reassigns ${n} unassigned ${n === 1 ? 'player' : 'players'} evenly across the teams that still have room.`,
        'Players who already have a team are not moved.',
        'Full teams (capacity reached) receive nobody.',
        ...(this.running() ? ['The game is running: their map visibility changes immediately.'] : []),
      ],
      confirmLabel: 'Auto-balance',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const { assigned } = await this.api.autoBalance(e.id);
      if (assigned < n) this.toast.warning(`${assigned} of ${n} players assigned`, 'The remaining teams are full. Raise a capacity or add a team.');
      else this.toast.success(`${assigned} players assigned`);
      await this.load();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async addTwoTeams(): Promise<void> {
    const e = this.event();
    if (!e) return;
    this.busy.set(true);
    try {
      for (const preset of TWO_TEAM_PRESET) {
        if (!e.teams.some((t) => t.name.toLowerCase() === preset.name!.toLowerCase())) await this.api.createTeam(e.id, preset);
      }
      this.toast.success('Teams Alpha and Bravo added');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
      await this.load();
    }
  }

  protected async addTeam(): Promise<void> {
    const e = this.event();
    if (!e) return;
    this.busy.set(true);
    try {
      const t = await this.api.createTeam(e.id, nextTeamPreset(e.teams));
      this.toast.success(`Team ${t.name} added`, 'Rename it and pick its colour below.');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
      await this.load();
    }
  }
}
