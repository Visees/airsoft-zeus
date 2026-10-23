import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

let uid = 0;

/**
 * Modal panel for GM tools (native <dialog>: focus trap, Escape, top layer).
 * Bottom sheet on phones, centred on wider screens. Wrap the projected content in
 * `@if (open)` in the parent so forms start fresh every time it opens.
 */
@Component({
  selector: 'ah-ops-dialog',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    dialog {
      margin: auto auto 0;
      width: 100%;
      max-width: 100%;
      max-height: 92dvh;
      border-radius: var(--radius) var(--radius) 0 0;
      padding-bottom: calc(1rem + var(--safe-bottom));
    }
    @media (min-width: 640px) {
      dialog {
        margin: auto;
        max-width: var(--dlg-width, 32rem);
        max-height: 88dvh;
        border-radius: var(--radius);
        padding-bottom: 1rem;
      }
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.6);
    }
  `,
  template: `
    <dialog
      #dlg
      class="overflow-y-auto border border-border bg-popover p-4 text-popover-foreground shadow-2xl sm:p-5"
      [style.--dlg-width]="wide() ? '44rem' : '32rem'"
      [attr.aria-labelledby]="titleId"
      (close)="closed.emit()"
    >
      <div class="mb-3 flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 [id]="titleId" class="text-lg uppercase">{{ title() }}</h2>
          @if (subtitle()) {
            <p class="mt-1 text-sm text-muted-foreground">{{ subtitle() }}</p>
          }
        </div>
        <button type="button" class="tap -mr-2 -mt-2 grid place-items-center rounded-md hover:bg-muted" (click)="close()" aria-label="Close" i18n-aria-label>
          <ng-icon name="lucideX" size="18" aria-hidden="true" />
        </button>
      </div>
      <ng-content />
    </dialog>
  `,
})
export class OpsDialog {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly wide = input(false);
  /** Emitted when the dialog closes (Escape, close button or parent). */
  readonly closed = output<void>();

  protected readonly titleId = `ops-dlg-${++uid}`;
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const d = this.dlg().nativeElement;
      if (this.open() && !d.open) d.showModal();
      else if (!this.open() && d.open) d.close();
    });
  }

  close(): void {
    const d = this.dlg().nativeElement;
    if (d.open) d.close();
  }
}
