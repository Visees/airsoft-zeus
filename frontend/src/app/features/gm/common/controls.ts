import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  forwardRef,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { DESKTOP_QUERY, mediaQuery } from './media';

let uid = 0;
export function nextId(prefix: string): string {
  return `${prefix}-${++uid}`;
}

// ---------------------------------------------------------------------------
// Save state
// ---------------------------------------------------------------------------

export type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'failed';

/** Per-section save status. Glyph + text, never colour alone. */
@Component({
  selector: 'zeus-save-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex', role: 'status', 'aria-live': 'polite' },
  template: `
    @switch (state()) {
      @case ('unsaved') {
        <span class="inline-flex items-center gap-1 text-xs font-semibold text-warning"><span aria-hidden="true">◐</span> Unsaved changes</span>
      }
      @case ('saving') {
        <span class="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"><span aria-hidden="true">…</span> Saving…</span>
      }
      @case ('saved') {
        <span class="inline-flex items-center gap-1 text-xs font-semibold text-primary"><span aria-hidden="true">✓</span> Saved</span>
      }
      @case ('failed') {
        <span class="inline-flex items-center gap-1 text-xs font-semibold text-destructive" [attr.title]="error()"><span aria-hidden="true">✕</span> Not saved</span>
      }
    }
  `,
})
export class SaveStateIndicator {
  readonly state = input<SaveState>('idle');
  readonly error = input<string | null>(null);
}

// ---------------------------------------------------------------------------
// Segmented control (radio group)
// ---------------------------------------------------------------------------

export interface SegmentOption<T = string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * Radio group rendered as segments (or a stacked list with hints). Native radios inside
 * labels, so arrow keys, Tab and screen readers behave as expected. Works with formControl.
 */
@Component({
  selector: 'zeus-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SegmentedControl), multi: true }],
  host: { class: 'block' },
  template: `
    <div
      role="radiogroup"
      [attr.aria-labelledby]="labelledby()"
      [attr.aria-describedby]="describedby()"
      [class]="stacked() ? 'flex flex-col gap-1.5' : 'flex flex-wrap gap-1.5'"
    >
      @for (o of options(); track $index) {
        @let selected = isSelected(o.value);
        <label
          class="relative flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border px-3 py-2 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring"
          [class.flex-1]="!stacked()"
          [class]="
            selected
              ? 'border-primary bg-primary/10 font-semibold text-foreground'
              : 'border-border bg-background text-muted-foreground hover:border-input hover:text-foreground'
          "
          [class.opacity-50]="disabled()"
          [class.cursor-not-allowed]="disabled()"
        >
          <input
            type="radio"
            class="sr-only"
            [name]="name"
            [checked]="selected"
            [disabled]="disabled()"
            (change)="select(o.value)"
            (blur)="onTouched()"
          />
          <span aria-hidden="true" class="num w-3 shrink-0 text-xs" [class.text-primary]="selected">{{ selected ? '●' : '○' }}</span>
          <span class="min-w-0">
            <span class="block leading-tight">{{ o.label }}</span>
            @if (o.hint && stacked()) {
              <span class="mt-0.5 block text-xs font-normal leading-snug text-muted-foreground">{{ o.hint }}</span>
            }
          </span>
        </label>
      }
    </div>
  `,
})
export class SegmentedControl<T = unknown> implements ControlValueAccessor {
  readonly options = input.required<SegmentOption<T>[]>();
  readonly labelledby = input<string | null>(null);
  readonly describedby = input<string | null>(null);
  readonly stacked = input(false, { transform: booleanAttribute });
  /** Standalone use without forms. */
  readonly value = input<T | undefined>(undefined);
  readonly valueChange = output<T>();

  protected readonly name = nextId('seg');
  protected readonly current = signal<T | undefined>(undefined);
  protected readonly disabled = signal(false);
  private onChange: (v: T) => void = () => {};
  protected onTouched: () => void = () => {};

  constructor() {
    effect(() => {
      const v = this.value();
      if (v !== undefined) untracked(() => this.current.set(v));
    });
  }

  protected isSelected(v: T): boolean {
    return this.current() === v;
  }

  protected select(v: T): void {
    if (this.disabled()) return;
    this.current.set(v);
    this.onChange(v);
    this.valueChange.emit(v);
  }

  writeValue(v: T): void {
    this.current.set(v);
  }
  registerOnChange(fn: (v: T) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.disabled.set(d);
  }
}

// ---------------------------------------------------------------------------
// Switch row
// ---------------------------------------------------------------------------

/** Label + one-line explanation + switch. Works with formControl or [checked]/(checkedChange). */
@Component({
  selector: 'zeus-switch-row',
  imports: [HlmSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SwitchRow), multi: true }],
  host: { class: 'flex items-start justify-between gap-4 py-2' },
  template: `
    <div class="min-w-0 cursor-pointer select-none" (click)="toggle()">
      <span [id]="id + '-l'" class="block text-sm font-medium">{{ label() }}</span>
      @if (description()) {
        <span [id]="id + '-d'" class="mt-0.5 block text-xs text-muted-foreground">{{ description() }}</span>
      }
      <ng-content />
    </div>
    <span class="flex min-h-11 shrink-0 items-center">
      <hlm-switch
        [checked]="checked()"
        [disabled]="disabled()"
        [aria-labelledby]="id + '-l'"
        [aria-describedby]="description() ? id + '-d' : null"
        (checkedChange)="set($event)"
      />
    </span>
  `,
})
export class SwitchRow implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly description = input<string | null>(null);
  readonly checkedInput = input<boolean | undefined>(undefined, { alias: 'checked' });
  readonly disabledInput = input(false, { alias: 'disabled', transform: booleanAttribute });
  readonly checkedChange = output<boolean>();

  protected readonly id = nextId('sw');
  protected readonly checked = signal(false);
  private readonly cvaDisabled = signal(false);
  protected readonly disabled = computed(() => this.cvaDisabled() || this.disabledInput());
  private onChange: (v: boolean) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    effect(() => {
      const v = this.checkedInput();
      if (v !== undefined) untracked(() => this.checked.set(v));
    });
  }

  protected toggle(): void {
    if (!this.disabled()) this.set(!this.checked());
  }

  protected set(v: boolean): void {
    this.checked.set(v);
    this.onChange(v);
    this.onTouched();
    this.checkedChange.emit(v);
  }

  writeValue(v: boolean): void {
    this.checked.set(!!v);
  }
  registerOnChange(fn: (v: boolean) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.cvaDisabled.set(d);
  }
}

// ---------------------------------------------------------------------------
// Side panel / bottom sheet
// ---------------------------------------------------------------------------

/**
 * Editor panel: a modal bottom sheet on phones/tablets, a non-modal side panel inside the
 * page layout on ≥1024px (place it in a grid column). Escape closes it in both modes.
 */
@Component({
  selector: 'zeus-gm-panel',
  imports: [NgIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  styles: `
    dialog {
      margin: auto auto 0;
      width: 100%;
      max-width: 100%;
      max-height: 92dvh;
      border-radius: var(--radius) var(--radius) 0 0;
      padding: 0;
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.6);
    }
    @media (min-width: 1024px) {
      dialog.inline-panel {
        position: sticky;
        inset: auto;
        top: 1rem;
        margin: 0;
        width: 100%;
        max-height: calc(100dvh - 2rem);
        border-radius: var(--radius);
        box-shadow: none;
      }
    }
  `,
  template: `
    <dialog
      #dlg
      class="flex-col border border-border bg-card text-card-foreground shadow-2xl open:flex"
      [class.inline-panel]="desktop()"
      [attr.aria-labelledby]="id + '-t'"
      (cancel)="onCancel($event)"
      (keydown.escape)="requestClose()"
    >
      <header class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div class="min-w-0">
          @if (eyebrow()) {
            <p class="label-caps">{{ eyebrow() }}</p>
          }
          <h2 [id]="id + '-t'" class="truncate text-lg uppercase">{{ title() }}</h2>
        </div>
        <button hlmBtn variant="ghost" size="icon" class="tap shrink-0" type="button" (click)="requestClose()" aria-label="Close panel">
          <ng-icon name="lucideX" size="18" aria-hidden="true" />
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4" style="padding-bottom: calc(1rem + var(--safe-bottom))">
        <ng-content />
      </div>
      <ng-content select="[panelFooter]" />
    </dialog>
  `,
})
export class GmPanel {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly eyebrow = input<string | null>(null);
  readonly closed = output<void>();

  protected readonly id = nextId('panel');
  protected readonly desktop = mediaQuery(DESKTOP_QUERY);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const open = this.open();
      const desktop = this.desktop();
      const el = this.dlg().nativeElement;
      untracked(() => {
        if (el.open) el.close();
        if (open) {
          if (desktop) el.show();
          else el.showModal();
        }
      });
    });
  }

  protected onCancel(ev: Event): void {
    ev.preventDefault();
    this.requestClose();
  }

  requestClose(): void {
    this.closed.emit();
  }
}
