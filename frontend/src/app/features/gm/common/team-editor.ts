import { ChangeDetectionStrategy, Component, DestroyRef, booleanAttribute, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { Subscription, debounceTime } from 'rxjs';
import { ApiError } from '../../../core/api/api-error';
import { ApiService } from '../../../core/api/api.service';
import { Member, Squad, Team } from '../../../core/api/models';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { ToastService } from '../../../core/ui/toast.service';
import { formatPlayerCount } from '../../../core/util/format';
import { TeamBadge } from '../../../shared/team-badge';
import { TeamIconPicker } from '../../../shared/team-icon-picker';
import { SaveState, SaveStateIndicator, nextId } from './controls';
import { applyServerErrors, controlError, formTick } from './form-utils';
import { injectAssign } from './member-assign';
import { TeamFieldsComponent, TeamForm, createTeamForm, patchTeamForm, teamFormToInput } from './team-form';

/** One squad: name, callsign, (icon, leader). Saves each field when it is committed. */
@Component({
  selector: 'ah-squad-row',
  imports: [ReactiveFormsModule, NgIcon, HlmButton, HlmInput, HlmLabel, SaveStateIndicator, TeamIconPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let s = squad();
    <div [formGroup]="form" [class]="advanced() ? 'grid grid-cols-2 gap-2 rounded-sm border border-border p-2' : 'grid grid-cols-2 gap-2 rounded-sm border border-border p-2 sm:grid-cols-[1fr_1fr_auto]'" [attr.data-rev]="tick()">
      <div class="flex flex-col gap-1">
        <label hlmLabel class="text-xs" [for]="id + '-n'" i18n>Squad name</label>
        <input hlmInput [id]="id + '-n'" class="h-11" formControlName="name" (change)="save('name')" [attr.aria-invalid]="!!err('name')" />
        @if (err('name'); as e) {
          <p class="field-error">{{ e }}</p>
        }
      </div>
      <div class="flex flex-col gap-1">
        <label hlmLabel class="text-xs" [for]="id + '-c'" i18n>Callsign</label>
        <input hlmInput [id]="id + '-c'" class="h-11 uppercase" formControlName="callsign" placeholder="VIPER" (change)="save('callsign')" />
      </div>
      @if (advanced()) {
        <div class="col-span-2 flex flex-col gap-1">
          <span hlmLabel class="text-xs" [id]="id + '-i'" i18n>Icon</span>
          <ah-team-icon-picker [value]="form.controls.icon.value" [name]="id + '-icon'" [labelledBy]="id + '-i'" allowNone (picked)="setIcon($event)" />
        </div>
        <div class="flex flex-col gap-1">
          <label hlmLabel class="text-xs" [for]="id + '-l'" i18n>Squad leader</label>
          <select #leaderSel [id]="id + '-l'" class="h-11 rounded-md border border-input bg-background px-2 text-sm dark:bg-input/30" [disabled]="busy()" (change)="setLeader(leaderSel)">
            <option value="" [selected]="!s.leaderId" i18n>No leader</option>
            @for (m of teamMembers(); track m.userId) {
              <option [value]="m.userId" [selected]="m.userId === s.leaderId">{{ m.nickname }}{{ m.squadId && m.squadId !== s.id ? txt.otherSquad : '' }}</option>
            }
          </select>
        </div>
      }
      <div [class]="advanced() ? 'col-span-2 flex items-center justify-between gap-2' : 'col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end sm:justify-end'">
        <ah-save-state [state]="state()" />
        <button hlmBtn variant="ghost" size="icon" class="tap text-destructive" type="button" (click)="remove()" ariaLabel="Delete squad {{ s.callsign || s.name }}" i18n-ariaLabel>
          <ng-icon name="lucideTrash2" size="16" aria-hidden="true" />
        </button>
      </div>
    </div>
  `,
})
export class SquadRow {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    otherSquad: $localize` (other squad)`,
  };

  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly assign = injectAssign();

  readonly eventId = input.required<string>();
  readonly squad = input.required<Squad>();
  readonly teams = input.required<Team[]>();
  readonly squads = input.required<Squad[]>();
  readonly members = input<Member[]>([]);
  readonly advanced = input(false, { transform: booleanAttribute });
  readonly running = input(false, { transform: booleanAttribute });
  readonly changed = output<void>();

  protected readonly id = nextId('squad');
  protected readonly state = signal<SaveState>('idle');
  protected readonly busy = signal(false);
  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(40)] }),
    callsign: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(20)] }),
    icon: new FormControl('', { nonNullable: true }),
  });
  protected readonly tick = formTick(() => this.form);
  protected readonly teamMembers = computed(() => this.members().filter((m) => m.teamId === this.squad().teamId && m.status === 'approved'));

  constructor() {
    effect(() => {
      const s = this.squad();
      untracked(() => {
        if (this.form.dirty) return;
        this.form.reset({ name: s.name, callsign: s.callsign ?? '', icon: s.icon ?? '' }, { emitEvent: false });
      });
    });
  }

  protected err(name: 'name'): string | null {
    return controlError(this.form.controls[name]);
  }

  protected async save(field: 'name' | 'callsign' | 'icon'): Promise<void> {
    const c = this.form.controls[field];
    if (c.invalid) {
      c.markAsTouched();
      return;
    }
    const raw = c.value.trim();
    // The server keeps the old value for null, so an empty string clears a field.
    const body: Partial<Squad> = field === 'name' ? { name: raw } : field === 'callsign' ? { callsign: raw.toUpperCase() } : { icon: raw };
    this.state.set('saving');
    try {
      await this.api.updateSquad(this.eventId(), this.squad().id, body);
      this.form.markAsPristine();
      this.state.set('saved');
      this.changed.emit();
    } catch (err) {
      this.state.set('failed');
      applyServerErrors(this.form, err);
      this.toast.error(err);
    }
  }

  protected setIcon(icon: string): void {
    this.form.controls.icon.setValue(icon);
    this.form.controls.icon.markAsDirty();
    void this.save('icon');
  }

  protected async setLeader(sel: HTMLSelectElement): Promise<void> {
    const s = this.squad();
    const userId = sel.value || null;
    this.busy.set(true);
    try {
      if (!userId) {
        await this.api.updateSquad(this.eventId(), s.id, { leaderId: null });
        this.toast.success($localize`${s.callsign || s.name}:value: has no leader`);
        this.changed.emit();
        return;
      }
      const member = this.members().find((m) => m.userId === userId);
      if (!member) return;
      const updated = await this.assign(this.eventId(), member, { teamId: s.teamId, squadId: s.id, isSquadLeader: true }, { teams: this.teams(), squads: this.squads(), running: this.running() });
      if (updated) this.changed.emit();
      else sel.value = s.leaderId ?? '';
    } catch (err) {
      sel.value = s.leaderId ?? '';
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const s = this.squad();
    const count = this.members().filter((m) => m.squadId === s.id).length;
    const ok = await this.confirm.ask({
      title: $localize`Delete squad ${s.callsign || s.name}:value:?`,
      consequences: [count ? $localize`${count}:count: players stay in the team without a squad.` : $localize`No players are in this squad.`, $localize`This cannot be undone.`],
      destructive: true,
      confirmLabel: $localize`Delete squad`,
    });
    if (!ok) return;
    try {
      await this.api.deleteSquad(this.eventId(), s.id);
      this.toast.success($localize`Squad deleted`);
      this.changed.emit();
    } catch (err) {
      this.toast.error(err);
    }
  }
}

/**
 * A team card: identity fields (autosaved), delete, and its squads.
 * Used by the wizard (simple) and the team manager (advanced: alliance, base, leaders).
 */
@Component({
  selector: 'ah-team-editor',
  imports: [NgIcon, HlmButton, TeamBadge, TeamFieldsComponent, SaveStateIndicator, SquadRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let t = team();
    <article class="panel flex flex-col" ariaLabel="Team {{ t.name }}" i18n-ariaLabel>
      <header class="flex flex-wrap items-center gap-2 p-3" [class.border-b]="expanded()" [class.border-border]="expanded()">
        <ah-team-badge [team]="t" size="lg" class="min-w-0 flex-1 basis-40" />
        <span class="num text-sm text-muted-foreground" [attr.aria-label]="playerCount(t.memberCount, t.capacity)">
          {{ t.memberCount }}{{ t.capacity ? '/' + t.capacity : '' }}
          <ng-icon name="lucideUsers" size="14" aria-hidden="true" />
        </span>
        <ah-save-state [state]="state()" [error]="saveError()" />
        <button
          hlmBtn
          variant="outline"
          size="sm"
          class="ml-auto h-11"
          type="button"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="id + '-body'"
          (click)="expanded.set(!expanded())"
        >
          <ng-icon [name]="expanded() ? 'lucideChevronUp' : 'lucidePencil'" size="14" aria-hidden="true" /> {{ expanded() ? txt.close : txt.edit }}
        </button>
        <button
          hlmBtn
          variant="ghost"
          size="icon"
          class="tap text-destructive"
          type="button"
          [disabled]="running()"
          [attr.title]="running() ? txt.teamsCannotBeDeleted : null"
          (click)="remove()"
          ariaLabel="Delete team {{ t.name }}" i18n-ariaLabel
        >
          <ng-icon name="lucideTrash2" size="16" aria-hidden="true" />
        </button>
      </header>

      <div [id]="id + '-body'" [hidden]="!expanded()" class="flex flex-col gap-4 p-3">
        <ah-team-fields [form]="form()" [advanced]="advanced()" [others]="others()" />
      </div>

      @if (showSquads()) {
        <section class="flex flex-col gap-2 border-t border-border p-3" [attr.aria-labelledby]="id + '-sq'">
          <div class="flex items-center justify-between gap-2">
            <h3 [id]="id + '-sq'" class="label-caps" i18n>Squads · {{ teamSquads().length }}</h3>
            <button hlmBtn variant="ghost" size="sm" class="h-11" type="button" (click)="addSquad()" [disabled]="addingSquad()">
              <ng-icon name="lucidePlus" size="14" aria-hidden="true" /> {{ addingSquad() ? txt.adding : txt.addSquad }}
            </button>
          </div>
          @for (s of teamSquads(); track s.id) {
            <ah-squad-row
              [eventId]="eventId()"
              [squad]="s"
              [teams]="allTeams()"
              [squads]="squads()"
              [members]="members()"
              [advanced]="advanced()"
              [running]="running()"
              (changed)="changed.emit()"
            />
          } @empty {
            <p class="text-xs text-muted-foreground" i18n>No squads. Optional: split the team into squads with their own callsign and leader.</p>
          }
        </section>
      }
      <ng-content />
    </article>
  `,
})
export class TeamEditor {
  protected readonly playerCount = formatPlayerCount;
  /** UI text used inside template expressions. */
  protected readonly txt = {
    close: $localize`Close`,
    edit: $localize`Edit`,
    adding: $localize`Adding…`,
    addSquad: $localize`Add squad`,
    teamsCannotBeDeleted: $localize`Teams cannot be deleted once the game has started`,
  };

  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly eventId = input.required<string>();
  readonly team = input.required<Team>();
  readonly allTeams = input.required<Team[]>();
  readonly squads = input<Squad[]>([]);
  readonly members = input<Member[]>([]);
  readonly advanced = input(false, { transform: booleanAttribute });
  readonly running = input(false, { transform: booleanAttribute });
  readonly showSquads = input(true, { transform: booleanAttribute });
  readonly startExpanded = input(false, { transform: booleanAttribute });
  readonly changed = output<void>();

  protected readonly id = nextId('teamed');
  protected readonly expanded = signal(false);
  protected readonly state = signal<SaveState>('idle');
  protected readonly saveError = signal<string | null>(null);
  protected readonly addingSquad = signal(false);
  protected readonly form = signal<TeamForm>(createTeamForm());
  private readonly tick = formTick(() => this.form());
  private currentId: string | null = null;
  private autosave: Subscription | null = null;

  protected readonly others = computed(() => this.allTeams().filter((t) => t.id !== this.team().id));
  protected readonly teamSquads = computed(() => this.squads().filter((s) => s.teamId === this.team().id));

  constructor() {
    effect(() => {
      const t = this.team();
      untracked(() => {
        if (t.id !== this.currentId) {
          this.currentId = t.id;
          this.form.set(createTeamForm(t));
          this.watch();
        } else if (!this.form().dirty && this.state() !== 'saving') {
          patchTeamForm(this.form(), t);
        }
      });
    });
    effect(() => {
      if (this.startExpanded()) untracked(() => this.expanded.set(true));
    });
    effect(() => {
      this.tick();
      const f = this.form();
      untracked(() => {
        if (f.dirty && this.state() !== 'saving') this.state.set(f.valid ? 'unsaved' : 'failed');
      });
    });
    inject(DestroyRef).onDestroy(() => this.autosave?.unsubscribe());
  }

  private watch(): void {
    this.autosave?.unsubscribe();
    this.autosave = this.form()
      .valueChanges.pipe(debounceTime(700))
      .subscribe(() => void this.save());
  }

  async save(): Promise<void> {
    const f = this.form();
    if (!f.dirty) return;
    if (f.invalid) {
      f.markAllAsTouched();
      this.state.set('failed');
      this.saveError.set($localize`Fix the highlighted fields.`);
      return;
    }
    this.state.set('saving');
    this.saveError.set(null);
    try {
      await this.api.updateTeam(this.eventId(), this.team().id, teamFormToInput(f, this.advanced()));
      f.markAsPristine();
      this.state.set('saved');
      this.changed.emit();
    } catch (err) {
      this.state.set('failed');
      this.saveError.set(ApiError.from(err).message);
      const unplaced = applyServerErrors(f, err, { baseLat: 'baseCoords', baseLng: 'baseCoords' });
      if (unplaced.length || !Object.keys(ApiError.from(err).fields).length) this.toast.error(err);
      this.expanded.set(true);
    }
  }

  protected async addSquad(): Promise<void> {
    this.addingSquad.set(true);
    try {
      const n = this.teamSquads().length + 1;
      await this.api.createSquad(this.eventId(), { teamId: this.team().id, name: `Squad ${n}`, callsign: null });
      this.changed.emit();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.addingSquad.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const t = this.team();
    const consequences = [
      t.memberCount ? $localize`${t.memberCount}:memberCount: players become unassigned.` : $localize`No players are in this team.`,
      this.teamSquads().length ? $localize`${this.teamSquads().length}:length: squads are deleted.` : null,
      $localize`This cannot be undone.`,
    ].filter((x): x is string => !!x);
    const ok = await this.confirm.ask({ title: $localize`Delete team ${t.name}:name:?`, consequences, destructive: true, confirmLabel: $localize`Delete team` });
    if (!ok) return;
    try {
      await this.api.deleteTeam(this.eventId(), t.id);
      this.toast.success($localize`Team ${t.name}:name: deleted`);
      this.changed.emit();
    } catch (err) {
      this.toast.error(err);
    }
  }
}
