import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

let nextId = 0;

/**
 * Full-width toggle row: label + explanation + switch. Native checkbox with role="switch",
 * so it is keyboard and screen-reader friendly and works with formControlName.
 * The state is shown by knob position and an On/Off text, not by colour alone.
 */
@Component({
  selector: 'ah-switch-row',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SwitchRow), multi: true }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  styles: `
    .zs {
      appearance: none;
      position: relative;
      flex-shrink: 0;
      width: 2.75rem;
      height: 1.625rem;
      border-radius: 999px;
      background: var(--input);
      border: 1px solid var(--border);
      cursor: pointer;
      transition: background-color 150ms ease-out;
    }
    .zs::before {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 1.25rem;
      height: 1.25rem;
      border-radius: 999px;
      background: var(--card);
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
      transition: transform 150ms ease-out;
    }
    .zs:checked {
      background: var(--primary);
      border-color: var(--primary);
    }
    .zs:checked::before {
      transform: translateX(1.125rem);
      background: var(--primary-foreground);
    }
    .zs:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `,
  template: `
    <label [for]="id" class="flex min-h-14 cursor-pointer items-start gap-3 py-3" [class.cursor-not-allowed]="disabled()">
      <span class="min-w-0 flex-1">
        <span class="block font-semibold">{{ label() }}</span>
        @if (description()) {
          <span [id]="id + '-d'" class="mt-0.5 block text-sm text-muted-foreground">{{ description() }}</span>
        }
        <ng-content />
      </span>
      <span class="flex items-center gap-2 pt-0.5">
        <span class="label-caps whitespace-nowrap text-right" aria-hidden="true">{{ value() ? txt.on : txt.off }}</span>
        <input
          type="checkbox"
          role="switch"
          class="zs"
          [id]="id"
          [checked]="value()"
          [disabled]="disabled()"
          [attr.aria-checked]="value()"
          [attr.aria-describedby]="description() ? id + '-d' : null"
          (change)="toggle($event)"
          (blur)="onTouched()"
        />
      </span>
    </label>
  `,
})
export class SwitchRow implements ControlValueAccessor {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    on: $localize`On`,
    off: $localize`Off`,
  };

  readonly label = input.required<string>();
  readonly description = input<string | null>(null);
  protected readonly id = `zsw-${++nextId}`;
  protected readonly value = signal(false);
  protected readonly disabled = signal(false);
  private onChange: (v: boolean) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  protected toggle(ev: Event): void {
    const v = (ev.target as HTMLInputElement).checked;
    this.value.set(v);
    this.onChange(v);
  }

  writeValue(v: boolean | null): void {
    this.value.set(!!v);
  }
  registerOnChange(fn: (v: boolean) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.disabled.set(d);
  }
}
