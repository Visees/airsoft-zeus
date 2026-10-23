import { ChangeDetectionStrategy, Component, ElementRef, OnInit, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { SupportCategory, SupportContext } from '../../core/api/models';
import { ToastService } from '../../core/ui/toast.service';
import { PageHeader } from '../../shared/states';
import { applyServerErrors, fieldError, focusFirstInvalid } from '../auth/form-utils';
import { SUPPORT_CATEGORIES } from './support-ui';

const PLACEHOLDERS: Record<SupportCategory, { subject: string; body: string }> = {
  bug: { subject: $localize`e.g. The map does not load in the lobby`, body: $localize`What you did, what you expected and what happened instead. Steps to repeat it help a lot.` },
  report: { subject: $localize`e.g. Fake event in Discover`, body: $localize`What is wrong and where: event or club name, date, links.` },
  general: { subject: $localize`e.g. Idea for a new game mode`, body: $localize`Write anything you want to tell us.` },
};

/** Write to the AirsoftHub team. Route: /support/new (?category=bug|report|general) */
@Component({
  selector: 'ah-support-new-screen',
  imports: [ReactiveFormsModule, NgIcon, HlmButton, HlmInput, HlmLabel, HlmTextarea, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      <ah-page-header eyebrow="Help & feedback" title="New message" back="/support" backLabel="All messages" i18n-eyebrow i18n-title i18n-backLabel />

      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-5" novalidate>
        <fieldset class="flex flex-col gap-2">
          <legend class="label-caps mb-2" i18n>What is it about?</legend>
          @for (c of categories; track c.value) {
            <label class="flex min-h-14 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 has-focus-visible:ring-2 has-focus-visible:ring-ring"
              [class]="value().category === c.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/60'">
              <input type="radio" formControlName="category" [value]="c.value" class="sr-only" />
              <ng-icon [name]="c.icon" size="20" [class]="value().category === c.value ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="font-semibold">{{ c.label }}</span>
                <span class="text-sm text-muted-foreground">{{ c.hint }}</span>
              </span>
              @if (value().category === c.value) {
                <span class="font-bold text-primary" aria-hidden="true">✓</span>
              }
            </label>
          }
        </fieldset>

        @if (value().category === 'report') {
          <p class="flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <ng-icon name="lucideInfo" size="16" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span i18n>To report a player, open their profile and use <b>Report</b>. For danger on the field, tell the Game Master now.</span>
          </p>
        }

        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="sup-subject" i18n>Subject</label>
          <input hlmInput id="sup-subject" formControlName="subject" class="h-11" maxlength="140" autocomplete="off" [placeholder]="placeholder().subject"
            [attr.aria-invalid]="!!err('subject')" [attr.aria-describedby]="err('subject') ? 'sup-subject-err' : null" />
          @if (err('subject'); as e) {
            <p id="sup-subject-err" class="field-error">{{ e }}</p>
          }
        </div>

        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="sup-body" i18n>Message</label>
          <textarea hlmTextarea id="sup-body" formControlName="body" rows="7" maxlength="5000" [placeholder]="placeholder().body"
            [attr.aria-invalid]="!!err('body')" aria-describedby="sup-body-help"></textarea>
          <p id="sup-body-help" class="flex justify-between gap-2 text-xs text-muted-foreground">
            <span [class.field-error]="!!err('body')">{{ err('body') ?? txt.weAnswerHereYou }}</span>
            <span class="num">{{ value().body?.length ?? 0 }}/5000</span>
          </p>
        </div>

        @if (value().category === 'bug') {
          <label class="flex min-h-11 cursor-pointer items-start gap-3">
            <input type="checkbox" formControlName="attachDevice" class="mt-1 size-4 accent-primary" />
            <span class="flex flex-col">
              <span class="font-semibold" i18n>Attach device details</span>
              <span class="text-sm text-muted-foreground" i18n>Browser, screen size and the page you came from. Helps us repeat the bug; nothing else is sent.</span>
            </span>
          </label>
        }

        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button hlmBtn type="button" variant="outline" class="h-12 sm:h-10" (click)="cancel()" i18n>Cancel</button>
          <button hlmBtn type="submit" class="h-12 sm:h-10" [disabled]="saving()">
            <ng-icon name="lucideSend" size="16" aria-hidden="true" /> {{ saving() ? txt.sending : txt.send }}
          </button>
        </div>
      </form>
    </div>
  `,
})
export class SupportNewScreen implements OnInit {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    weAnswerHereYou: $localize`We answer here; you get a notification.`,
    sending: $localize`Sending…`,
    send: $localize`Send`,
  };

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** ?category= preselects the kind of message. */
  readonly category = input<string | undefined>();
  /** ?from= the app page the user came from, attached to bug reports. */
  readonly from = input<string | undefined>();

  protected readonly categories = SUPPORT_CATEGORIES;
  protected readonly saving = signal(false);
  protected readonly form = new FormGroup({
    category: new FormControl<SupportCategory>('bug', { nonNullable: true }),
    subject: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(3), Validators.maxLength(140)] }),
    body: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(5000)] }),
    attachDevice: new FormControl(true, { nonNullable: true }),
  });
  protected readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly placeholder = () => PLACEHOLDERS[this.value().category ?? 'bug'];

  ngOnInit(): void {
    const c = this.category();
    if (c && SUPPORT_CATEGORIES.some((x) => x.value === c)) this.form.controls.category.setValue(c as SupportCategory);
  }

  protected err(name: 'subject' | 'body'): string | null {
    return fieldError(this.form.controls[name], {
      required: name === 'subject' ? $localize`Write a short subject.` : $localize`Write a message.`,
      minlength: $localize`At least 3 characters.`,
    });
  }

  protected cancel(): void {
    void this.router.navigateByUrl('/support');
  }

  private deviceContext(): SupportContext {
    const from = this.from();
    return {
      page: from && from.startsWith('/') ? from.slice(0, 300) : undefined,
      userAgent: navigator.userAgent.slice(0, 400),
      screen: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    };
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    this.saving.set(true);
    try {
      const v = this.form.getRawValue();
      const ticket = await this.api.createSupportTicket({
        category: v.category,
        subject: v.subject.trim(),
        body: v.body.trim(),
        context: v.category === 'bug' && v.attachDevice ? this.deviceContext() : undefined,
      });
      this.form.markAsPristine();
      this.toast.success($localize`Message sent`, $localize`Thanks! We will answer here.`);
      await this.router.navigate(['/support', ticket.id], { replaceUrl: true });
    } catch (e) {
      const err = ApiError.from(e);
      const unmatched = applyServerErrors(this.form, err);
      if (!Object.keys(err.fields).length || unmatched.length) this.toast.error(unmatched[0] ?? err);
    } finally {
      this.saving.set(false);
    }
  }
}
