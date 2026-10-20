import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Squad } from '../core/api/models';

@Component({
  selector: 'zeus-squad-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-xs font-semibold' },
  template: `
    <span class="num text-muted-foreground" aria-hidden="true">#</span>
    <span>{{ squad()?.callsign || squad()?.name || 'No squad' }}</span>
    @if (leader()) {
      <span class="label-caps !text-[0.65rem] !text-primary">Lead</span>
    }
  `,
})
export class SquadBadge {
  readonly squad = input<Pick<Squad, 'name' | 'callsign'> | null | undefined>(null);
  readonly leader = input(false);
}
