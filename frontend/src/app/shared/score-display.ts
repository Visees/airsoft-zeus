import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { formatNumber } from '../core/util/format';

/** Victory points. Always shown with the trophy glyph so it is never confused with currency. */
@Component({
  selector: 'zeus-score-display',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-1.5' },
  template: `
    @if (label()) {
      <span class="label-caps">{{ label() }}</span>
    }
    <ng-icon name="lucideTrophy" [size]="size() === 'lg' ? '20' : '14'" class="text-primary" aria-hidden="true" />
    <span
      class="num font-bold"
      [class.text-3xl]="size() === 'lg'"
      [class.text-lg]="size() === 'md'"
      [class.text-sm]="size() === 'sm'"
      aria-label="{{ fmt(points()) }} points" i18n-aria-label
      >{{ fmt(points()) }}</span
    >
    @if (showUnit()) {
      <span class="text-xs text-muted-foreground" aria-hidden="true" i18n>pts</span>
    }
  `,
})
export class ScoreDisplay {
  readonly points = input.required<number>();
  readonly label = input<string | null>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly showUnit = input(true);
  protected readonly fmt = formatNumber;
}
