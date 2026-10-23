import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ConfirmService } from '../core/ui/confirm.service';

/**
 * Renders ConfirmService requests with a native <dialog> (focus trap, Escape, top layer).
 * Bottom sheet on phones, centred on wider screens. Mounted once in App.
 */
@Component({
  selector: 'ah-confirm-host',
  imports: [FormsModule, HlmButton, HlmInput, HlmLabel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    dialog {
      margin: auto auto 0;
      width: 100%;
      max-width: 100%;
      border-radius: var(--radius) var(--radius) 0 0;
      padding-bottom: calc(1.25rem + var(--safe-bottom));
    }
    @media (min-width: 640px) {
      dialog {
        margin: auto;
        max-width: 30rem;
        border-radius: var(--radius);
        padding-bottom: 1.25rem;
      }
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.6);
    }
  `,
  template: `
    <dialog
      #dlg
      class="border border-border bg-popover p-5 text-popover-foreground shadow-2xl"
      role="alertdialog"
      aria-labelledby="confirm-title"
      [attr.aria-describedby]="req()?.message ? 'confirm-message' : null"
      (cancel)="close(false, $event)"
    >
      @if (req(); as r) {
        <form method="dialog" (submit)="$event.preventDefault(); close(true)">
          <h2 id="confirm-title" class="text-lg uppercase">{{ r.title }}</h2>
          @if (r.message) {
            <p id="confirm-message" class="mt-2 text-sm text-muted-foreground">{{ r.message }}</p>
          }
          @if (r.consequences?.length) {
            <ul class="mt-3 flex flex-col gap-1 rounded-sm border border-border bg-muted p-3 text-sm">
              @for (c of r.consequences; track $index) {
                <li class="flex gap-2"><span aria-hidden="true" class="text-warning">▸</span>{{ c }}</li>
              }
            </ul>
          }
          @if (r.choices?.length) {
            <fieldset class="mt-4 flex flex-col gap-2">
              <legend class="sr-only" i18n>Choose an option</legend>
              @for (c of r.choices; track c.value) {
                <label
                  class="flex cursor-pointer items-start gap-3 rounded-sm border p-3 text-sm"
                  [class]="choice() === c.value ? 'border-primary bg-primary/10' : 'border-border'"
                >
                  <input type="radio" class="mt-0.5 size-5 shrink-0 accent-primary" name="choice" [value]="c.value" [checked]="choice() === c.value" (change)="choice.set(c.value)" />
                  <span class="flex flex-col gap-0.5">
                    <span class="font-semibold">{{ c.label }}</span>
                    @if (c.hint) {
                      <span class="text-muted-foreground">{{ c.hint }}</span>
                    }
                  </span>
                </label>
              }
            </fieldset>
          }
          @if (r.reason) {
            <div class="mt-4 flex flex-col gap-1.5">
              <label hlmLabel for="confirm-reason">{{ r.reason.label }}@if (r.reason.required) { <span aria-hidden="true">*</span> }</label>
              <input hlmInput id="confirm-reason" [(ngModel)]="reason" name="reason" [placeholder]="r.reason.placeholder ?? ''" autocomplete="off" />
            </div>
          }
          @if (r.requireText) {
            <div class="mt-4 flex flex-col gap-1.5">
              <label hlmLabel for="confirm-text" i18n>Type <span class="num font-bold">{{ r.requireText }}</span> to confirm</label>
              <input hlmInput id="confirm-text" [(ngModel)]="typed" name="typed" autocomplete="off" autocapitalize="characters" />
            </div>
          }
          <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button hlmBtn type="button" variant="outline" class="h-12 sm:h-10" (click)="close(false)">{{ r.cancelLabel ?? txt.cancel }}</button>
            <button
              hlmBtn
              type="submit"
              class="h-12 sm:h-10"
              [class]="r.destructive ? '!bg-destructive !text-destructive-foreground hover:!bg-destructive/85' : ''"
              [disabled]="!canConfirm()"
            >
              {{ confirmLabel() }}
            </button>
          </div>
        </form>
      }
    </dialog>
  `,
})
export class ConfirmHost {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    cancel: $localize`Cancel`,
    confirm: $localize`Confirm`,
  };

  private readonly confirm = inject(ConfirmService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly req = this.confirm.current;
  protected readonly reason = signal('');
  protected readonly typed = signal('');
  protected readonly choice = signal<string | null>(null);

  protected readonly confirmLabel = computed(() => {
    const r = this.req();
    const picked = r?.choices?.find((c) => c.value === this.choice());
    return picked?.confirmLabel ?? r?.confirmLabel ?? this.txt.confirm;
  });

  protected readonly canConfirm = computed(() => {
    const r = this.req();
    if (!r) return false;
    if (r.requireText && this.typed().trim() !== r.requireText) return false;
    if (r.reason?.required && this.reason().trim().length < 3) return false;
    return true;
  });

  constructor() {
    effect(() => {
      const r = this.req();
      const el = this.dlg().nativeElement;
      if (r && !el.open) {
        this.reason.set('');
        this.typed.set('');
        this.choice.set(r.choices?.[0]?.value ?? null);
        el.showModal();
      } else if (!r && el.open) {
        el.close();
      }
    });
  }

  protected close(confirmed: boolean, ev?: Event): void {
    ev?.preventDefault();
    const r = this.req();
    if (!r) return;
    if (confirmed && !this.canConfirm()) return;
    r.resolve({ confirmed, reason: this.reason().trim(), choice: this.choice() });
  }
}
