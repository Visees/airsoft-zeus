import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

let nextId = 0;

/**
 * Modal bottom sheet built on the native <dialog> (top layer, focus trap, Escape),
 * like the confirm dialog. Centred card on wider screens.
 */
@Component({
  selector: 'zeus-live-sheet',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    dialog {
      margin: auto auto 0;
      width: 100%;
      max-width: 100%;
      max-height: 88dvh;
      padding: 0;
      border-radius: var(--radius) var(--radius) 0 0;
    }
    @media (min-width: 640px) {
      dialog {
        margin: auto;
        max-width: 32rem;
        border-radius: var(--radius);
      }
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.6);
    }
  `,
  template: `
    <dialog
      #dlg
      class="border border-border bg-popover text-popover-foreground shadow-2xl"
      [attr.aria-labelledby]="titleId"
      (cancel)="onCancel($event)"
      (close)="onNativeClose()"
      (click)="onDialogClick($event)"
    >
      <div class="flex flex-col gap-4 p-5" [style.padding-bottom]="'calc(1.25rem + var(--safe-bottom))'">
        <div class="mx-auto -mt-2 h-1 w-10 rounded-full bg-border sm:hidden" aria-hidden="true"></div>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            @if (eyebrow()) {
              <p class="label-caps">{{ eyebrow() }}</p>
            }
            <h2 [id]="titleId" class="text-xl uppercase">{{ heading() }}</h2>
          </div>
          @if (dismissible()) {
            <button type="button" class="tap -m-2 grid shrink-0 place-items-center rounded-sm" (click)="requestClose()" aria-label="Close">
              <ng-icon name="lucideX" size="20" aria-hidden="true" />
            </button>
          }
        </div>
        <ng-content />
      </div>
    </dialog>
  `,
})
export class LiveSheet {
  readonly open = input(false);
  readonly heading = input.required<string>();
  readonly eyebrow = input<string | null>(null);
  /** Escape, backdrop and the X close it. */
  readonly dismissible = input(true);
  readonly closed = output<void>();

  protected readonly titleId = `live-sheet-${++nextId}`;
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const el = this.dlg().nativeElement;
      const open = this.open();
      if (open && !el.open) el.showModal();
      else if (!open && el.open) el.close();
    });
  }

  protected requestClose(): void {
    this.closed.emit();
  }

  protected onCancel(ev: Event): void {
    ev.preventDefault();
    if (this.dismissible()) this.closed.emit();
  }

  protected onNativeClose(): void {
    // closed by the browser (e.g. form method=dialog) while the parent still thinks it is open
    if (this.open()) this.closed.emit();
  }

  protected onDialogClick(ev: MouseEvent): void {
    // the content wrapper fills the dialog, so a click on the dialog element itself is the backdrop
    if (ev.target === this.dlg().nativeElement && this.dismissible()) this.closed.emit();
  }
}
