import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MARKER_COLORS } from './map-defaults';

/** Swatch picker + free colour input for map element colours (form control, value "#RRGGBB"). */
@Component({
  selector: 'zeus-color-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => ColorField), multi: true }],
  host: { class: 'flex flex-wrap items-center gap-1.5', role: 'group', '[attr.aria-label]': 'label()' },
  template: `
    @for (c of swatches(); track c) {
      <button
        type="button"
        class="size-10 rounded-sm border-2 transition-shadow"
        [style.background]="c"
        [class.border-foreground]="same(c)"
        [class.border-transparent]="!same(c)"
        [class.ring-2]="same(c)"
        [class.ring-ring]="same(c)"
        aria-label="Colour {{ c }}" i18n-aria-label
        [attr.aria-pressed]="same(c)"
        [disabled]="disabled()"
        (click)="pick(c)"
      ></button>
    }
    <label class="relative flex h-10 items-center gap-2 rounded-sm border border-input px-2 text-sm">
      <input
        type="color"
        class="size-7 cursor-pointer border-0 bg-transparent p-0"
        [value]="value()"
        [disabled]="disabled()"
        (input)="pick($any($event.target).value)"
        aria-label="{{ label() }}: custom colour" i18n-aria-label
      />
      <span class="num text-xs uppercase text-muted-foreground">{{ value() }}</span>
    </label>
  `,
})
export class ColorField implements ControlValueAccessor {
  readonly swatches = input<string[]>(MARKER_COLORS);
  readonly label = input($localize`Colour`);

  protected readonly value = signal('#E6B04F');
  protected readonly disabled = signal(false);
  private onChange: (v: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  protected same(c: string): boolean {
    return c.toLowerCase() === (this.value() ?? '').toLowerCase();
  }

  protected pick(c: string): void {
    this.value.set(c);
    this.onChange(c);
    this.onTouched();
  }

  writeValue(v: string | null): void {
    this.value.set(v || '#E6B04F');
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.disabled.set(d);
  }
}
