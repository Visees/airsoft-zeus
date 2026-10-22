import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input, output, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../../core/api/api.service';
import { Member, Squad, Team } from '../../../core/api/models';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { ToastService } from '../../../core/ui/toast.service';
import { nextId } from './controls';

export interface AssignChange {
  teamId: string | null;
  squadId: string | null;
  isSquadLeader: boolean;
}

/** Live/paused: assignment changes what the player sees on the map right away. */
export function isRunning(status: string | null | undefined): boolean {
  return status === 'live' || status === 'paused';
}

/**
 * Shared assign flow: confirms when the game is running, calls api.assignMember, toasts.
 * Returns the updated member or null.
 */
export function injectAssign() {
  const api = inject(ApiService);
  const confirm = inject(ConfirmService);
  const toast = inject(ToastService);
  return async function assign(eventId: string, member: Member, change: AssignChange, ctx: { teams: Team[]; squads: Squad[]; running: boolean }): Promise<Member | null> {
    const team = ctx.teams.find((t) => t.id === change.teamId) ?? null;
    const squad = ctx.squads.find((s) => s.id === change.squadId) ?? null;
    const teamChanged = change.teamId !== member.teamId;
    if (ctx.running && (teamChanged || change.squadId !== member.squadId)) {
      const oldTeam = ctx.teams.find((t) => t.id === member.teamId)?.name;
      const consequences = teamChanged
        ? [
            team ? $localize`${member.nickname}:nickname: joins ${team.name}:name: immediately.` : (oldTeam ? $localize`${member.nickname}:nickname: is removed from ${oldTeam}:team: and sees no team positions.` : $localize`${member.nickname}:nickname: is removed from their team and sees no team positions.`),
            oldTeam && team
              ? $localize`Their map visibility changes immediately: they stop seeing ${oldTeam}:oldTeam: and see ${team.name}:name: instead.`
              : $localize`Their map visibility changes immediately.`,
          ]
        : [squad ? $localize`${member.nickname}:nickname: moves to ${squad.callsign || squad.name}:squad:.` : $localize`${member.nickname}:nickname: leaves their squad.`, $localize`Their map visibility changes immediately.`];
      const ok = await confirm.ask({
        title: $localize`Move ${member.nickname}:nickname: during the game?`,
        consequences,
        confirmLabel: $localize`Move player`,
      });
      if (!ok) return null;
    }
    try {
      const updated = await api.assignMember(eventId, member.userId, change);
      if (teamChanged) toast.success(team ? `${member.nickname} → ${team.name}` : $localize`${member.nickname}:nickname: is unassigned`);
      else if (change.isSquadLeader && !member.isSquadLeader) toast.success(squad ? $localize`${member.nickname}:nickname: leads ${squad.callsign || squad.name}:squad:` : $localize`${member.nickname}:nickname: leads the squad`);
      else toast.success($localize`${member.nickname}:nickname: updated`);
      return updated;
    } catch (err) {
      toast.error(err);
      return null;
    }
  };
}

/** Compact team / squad / squad-leader control for one player. */
@Component({
  selector: 'zeus-member-assign',
  imports: [NgIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-wrap items-center gap-1.5' },
  template: `
    @let m = member();
    <label class="sr-only" [for]="id + '-t'" i18n>Team for {{ m.nickname }}</label>
    <select
      #teamSel
      [id]="id + '-t'"
      class="h-11 min-w-0 max-w-40 rounded-md border border-input bg-background px-2 text-sm dark:bg-input/30"
      [disabled]="busy() || disabled()"
      (change)="onTeam(teamSel)"
    >
      <option value="" [selected]="!m.teamId" i18n>No team</option>
      @for (t of teams(); track t.id) {
        <option [value]="t.id" [selected]="t.id === m.teamId" [disabled]="isFull(t) && t.id !== m.teamId">
          {{ t.name }}{{ t.capacity ? ' (' + t.memberCount + '/' + t.capacity + ')' : '' }}{{ isFull(t) && t.id !== m.teamId ? txt.full : '' }}
        </option>
      }
    </select>
    @if (m.teamId && teamSquads().length) {
      <label class="sr-only" [for]="id + '-s'" i18n>Squad for {{ m.nickname }}</label>
      <select
        #squadSel
        [id]="id + '-s'"
        class="h-11 min-w-0 max-w-36 rounded-md border border-input bg-background px-2 text-sm dark:bg-input/30"
        [disabled]="busy() || disabled()"
        (change)="onSquad(squadSel)"
      >
        <option value="" [selected]="!m.squadId" i18n>No squad</option>
        @for (s of teamSquads(); track s.id) {
          <option [value]="s.id" [selected]="s.id === m.squadId">{{ s.callsign || s.name }}</option>
        }
      </select>
    }
    @if (m.squadId) {
      <button
        hlmBtn
        type="button"
        size="sm"
        class="h-11"
        [variant]="m.isSquadLeader ? 'secondary' : 'ghost'"
        [attr.aria-pressed]="m.isSquadLeader"
        [disabled]="busy() || disabled()"
        (click)="toggleLeader()"
        [attr.aria-label]="(m.isSquadLeader ? txt.removeSquadLeaderRole : txt.makeSquadLeader) + m.nickname"
      >
        <ng-icon name="lucideStar" size="14" [class.text-primary]="m.isSquadLeader" aria-hidden="true" />
        {{ m.isSquadLeader ? txt.leader : txt.makeLeader }}
      </button>
    }
  `,
})
export class MemberAssign {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    full: $localize` · full`,
    leader: $localize`Leader`,
    makeLeader: $localize`Make leader`,
    removeSquadLeaderRole: $localize`Remove squad leader role from `,
    makeSquadLeader: $localize`Make squad leader: `,
  };

  readonly eventId = input.required<string>();
  readonly member = input.required<Member>();
  readonly teams = input.required<Team[]>();
  readonly squads = input.required<Squad[]>();
  readonly running = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly assigned = output<Member>();

  private readonly assign = injectAssign();
  protected readonly id = nextId('assign');
  protected readonly busy = signal(false);
  protected readonly teamSquads = computed(() => this.squads().filter((s) => s.teamId === this.member().teamId));

  protected isFull(t: Team): boolean {
    return t.capacity > 0 && t.memberCount >= t.capacity;
  }

  protected async onTeam(sel: HTMLSelectElement): Promise<void> {
    const teamId = sel.value || null;
    const ok = await this.run({ teamId, squadId: null, isSquadLeader: false });
    if (!ok) sel.value = this.member().teamId ?? '';
  }

  protected async onSquad(sel: HTMLSelectElement): Promise<void> {
    const m = this.member();
    const ok = await this.run({ teamId: m.teamId, squadId: sel.value || null, isSquadLeader: false });
    if (!ok) sel.value = m.squadId ?? '';
  }

  protected async toggleLeader(): Promise<void> {
    const m = this.member();
    await this.run({ teamId: m.teamId, squadId: m.squadId, isSquadLeader: !m.isSquadLeader });
  }

  private async run(change: AssignChange): Promise<boolean> {
    this.busy.set(true);
    try {
      const updated = await this.assign(this.eventId(), this.member(), change, { teams: this.teams(), squads: this.squads(), running: this.running() });
      if (updated) this.assigned.emit(updated);
      return !!updated;
    } finally {
      this.busy.set(false);
    }
  }
}
