import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { Uuid } from '../../core/api/models';
import { ToastService } from '../../core/ui/toast.service';
import { applyServerErrors, fieldError } from '../auth/form-utils';

export const REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'cheating', label: 'Cheating (fake GPS, shared codes, ignoring hits)' },
  { value: 'unsafe', label: 'Unsafe behaviour on the field' },
  { value: 'harassment', label: 'Harassment or threats' },
  { value: 'offensive_profile', label: 'Offensive nickname, photo or bio' },
  { value: 'impersonation', label: 'Pretending to be someone else' },
  { value: 'spam', label: 'Spam or fake account' },
  { value: 'other', label: 'Something else' },
];

/** Report a player: reason + details, in a native modal dialog. */
@Component({
  selector: 'zeus-report-dialog',
  imports: [ReactiveFormsModule, NgIcon, HlmButton, HlmLabel, HlmTextarea],
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
        max-width: 32rem;
        border-radius: var(--radius);
        padding-bottom: 1.25rem;
      }
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.6);
    }
  `,
  template: `
    <dialog #dlg class="border border-border bg-popover p-5 text-popover-foreground shadow-2xl" aria-labelledby="rep-title" (close)="onClosed()">
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="flex items-start justify-between gap-3">
          <h2 id="rep-title" class="text-lg uppercase">Report {{ nickname() }}</h2>
          <button type="button" class="tap -mr-2 -mt-2 grid place-items-center rounded-sm hover:bg-muted" aria-label="Close" (click)="close()">
            <ng-icon name="lucideX" size="20" aria-hidden="true" />
          </button>
        </div>
        <p class="mt-1 text-sm text-muted-foreground">Reports are private. Our team reviews them; the player is not told who reported them. For danger on the field, tell the Game Master now.</p>

        <div class="mt-4 flex flex-col gap-1.5">
          <label hlmLabel for="rep-reason">Reason</label>
          <select id="rep-reason" formControlName="reason" class="h-11 w-full rounded-md border border-input bg-transparent px-2.5 dark:bg-input/30"
            [attr.aria-invalid]="!!err('reason')" [attr.aria-describedby]="err('reason') ? 'rep-reason-err' : null">
            <option value="" disabled>Choose a reason</option>
            @for (r of reasons; track r.value) {
              <option [value]="r.value">{{ r.label }}</option>
            }
          </select>
          @if (err('reason'); as e) {
            <p id="rep-reason-err" class="field-error">{{ e }}</p>
          }
        </div>

        <div class="mt-4 flex flex-col gap-1.5">
          <label hlmLabel for="rep-details">What happened</label>
          <textarea hlmTextarea id="rep-details" formControlName="details" rows="4" maxlength="1000"
            placeholder="When and where it happened, and in which event"
            [attr.aria-invalid]="!!err('details')" aria-describedby="rep-details-help"></textarea>
          <p id="rep-details-help" class="flex justify-between text-xs text-muted-foreground">
            <span>{{ err('details') ?? 'Optional, but details help us act.' }}</span>
            <span class="num">{{ form.controls.details.value.length }}/1000</span>
          </p>
        </div>

        <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button hlmBtn type="button" variant="outline" class="h-12 sm:h-10" (click)="close()">Cancel</button>
          <button hlmBtn type="submit" class="h-12 sm:h-10" [disabled]="saving()">{{ saving() ? 'Sending…' : 'Send report' }}</button>
        </div>
      </form>
    </dialog>
  `,
})
export class ReportDialog {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly targetUserId = input.required<Uuid>();
  readonly nickname = input('this player');
  readonly eventId = input<Uuid | null>(null);

  protected readonly reasons = REPORT_REASONS;
  protected readonly saving = signal(false);
  protected readonly form = new FormGroup({
    reason: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    details: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] }),
  });

  protected err(name: 'reason' | 'details'): string | null {
    return fieldError(this.form.controls[name], { required: 'Choose a reason.' });
  }

  open(): void {
    this.form.reset();
    const el = this.dlg().nativeElement;
    if (!el.open) el.showModal();
  }

  close(): void {
    this.dlg().nativeElement.close();
  }

  protected onClosed(): void {
    this.saving.set(false);
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      await this.api.report({
        targetUserId: this.targetUserId(),
        eventId: this.eventId() ?? undefined,
        reason: v.reason,
        details: v.details.trim() || undefined,
      });
      this.toast.success('Report sent', 'Thanks. We review every report.');
      this.close();
    } catch (e) {
      const err = ApiError.from(e);
      const unmatched = applyServerErrors(this.form, err);
      if (!Object.keys(err.fields).length || unmatched.length) this.toast.error(unmatched[0] ?? err);
    } finally {
      this.saving.set(false);
    }
  }
}
