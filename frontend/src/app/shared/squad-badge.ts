import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Squad } from '../core/api/models';

@Component({
  selector: 'ah-squad-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-xs font-semibold' },
  template: `
    <span class="num text-muted-foreground" aria-hidden="true">#</span>
    <span>{{ squad()?.callsign || squad()?.name || txt.noSquad }}</span>
    @if (leader()) {
      <span class="label-caps !text-[0.65rem] !text-primary" i18n>Lead</span>
    }
  `,
})
export class SquadBadge {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    noSquad: $localize`No squad`,
  };

  readonly squad = input<Pick<Squad, 'name' | 'callsign'> | null | undefined>(null);
  readonly leader = input(false);
}
