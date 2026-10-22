import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { formatNumber } from '../core/util/format';

/** Spendable team currency ("credits"), always distinct from victory points. null = hidden. */
@Component({
  selector: 'zeus-currency-display',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-1.5' },
  template: `
    @if (label()) {
      <span class="label-caps">{{ label() }}</span>
    }
    <ng-icon name="lucideCoins" [size]="size() === 'lg' ? '20' : '14'" class="text-warning" aria-hidden="true" />
    @if (amount() === null) {
      <span class="num text-muted-foreground" aria-label="Hidden" i18n-aria-label>—</span>
    } @else {
      <span
        class="num font-bold"
        [class.text-3xl]="size() === 'lg'"
        [class.text-lg]="size() === 'md'"
        [class.text-sm]="size() === 'sm'"
        aria-label="{{ fmt(amount()) }} credits" i18n-aria-label
        >{{ fmt(amount()) }}</span
      >
    }
    @if (showUnit()) {
      <span class="text-xs text-muted-foreground" aria-hidden="true" i18n>cr</span>
    }
  `,
})
export class CurrencyDisplay {
  readonly amount = input.required<number | null>();
  readonly label = input<string | null>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly showUnit = input(true);
  protected readonly fmt = formatNumber;
}
