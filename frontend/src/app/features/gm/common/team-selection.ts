import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiService } from '../../../core/api/api.service';
import { EventDetail } from '../../../core/api/models';
import { ToastService } from '../../../core/ui/toast.service';
import { SaveState, SaveStateIndicator, SegmentOption, SegmentedControl, SwitchRow, nextId } from './controls';

export const TEAM_SELECTION_OPTIONS: SegmentOption<EventDetail['teamSelection']>[] = [
  { value: 'gm', label: 'Game Master assigns', hint: 'You place every player in a team.' },
  { value: 'auto', label: 'Auto-balance', hint: 'Players are spread evenly across teams when approved.' },
  { value: 'player', label: 'Players choose', hint: 'Players pick a team that still has room.' },
];

/** Team selection mode + lock switch, saved immediately. */
@Component({
  selector: 'zeus-team-selection-settings',
  imports: [HlmLabel, SegmentedControl, SwitchRow, SaveStateIndicator],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let e = event();
    <section class="panel flex flex-col gap-3 p-4" [attr.aria-labelledby]="id + '-h'">
      <div class="flex items-center justify-between gap-2">
        <h2 [id]="id + '-h'" class="label-caps">Team selection</h2>
        <zeus-save-state [state]="state()" />
      </div>
      <span hlmLabel [id]="id + '-l'" class="sr-only">How players get a team</span>
      @for (k of [rev()]; track k) {
      <zeus-segmented [options]="options" [value]="e.teamSelection" [labelledby]="id + '-l'" stacked (valueChange)="save({ teamSelection: $event })" />
      <zeus-switch-row
        label="Lock team assignments"
        description="Players can no longer choose or change their team. You can still move them."
        [checked]="e.teamsLocked"
        [disabled]="state() === 'saving'"
        (checkedChange)="save({ teamsLocked: $event })"
      />
      }
    </section>
  `,
})
export class TeamSelectionSettings {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly event = input.required<EventDetail>();
  readonly updated = output<EventDetail>();

  protected readonly id = nextId('tsel');
  protected readonly options = TEAM_SELECTION_OPTIONS;
  protected readonly state = signal<SaveState>('idle');
  /** Bumped after a failed save to rebuild the controls from the unchanged event. */
  protected readonly rev = signal(0);

  protected async save(body: Partial<Pick<EventDetail, 'teamSelection' | 'teamsLocked'>>): Promise<void> {
    this.state.set('saving');
    try {
      const e = await this.api.updateEvent(this.event().id, body);
      this.state.set('saved');
      this.updated.emit(e);
    } catch (err) {
      this.state.set('failed');
      this.toast.error(err);
      this.rev.update((n) => n + 1);
    }
  }
}
