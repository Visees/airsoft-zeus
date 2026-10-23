import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { AuthLayout } from './auth-layout';
import { fieldError, focusFirstInvalid } from './form-utils';

@Component({
  selector: 'ah-forgot-password-screen',
  imports: [AuthLayout, ReactiveFormsModule, RouterLink, NgIcon, HlmButton, HlmInput, HlmLabel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ah-auth-layout>
      @if (sentTo(); as email) {
        <div class="flex flex-col items-start gap-3" role="status">
          <span class="grid size-12 place-items-center rounded-md bg-primary/15 text-primary" aria-hidden="true">
            <ng-icon name="lucideMail" size="24" />
          </span>
          <h1 class="text-3xl uppercase" i18n>Check your email</h1>
          <p class="text-muted-foreground" i18n>
            If an account exists for <span class="font-semibold text-foreground">{{ email }}</span>, we sent a link to reset the password.
            The link expires in one hour.
          </p>
          <ul class="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
            <li i18n>Look in spam or promotions if it is not in your inbox within a few minutes.</li>
            <li i18n>Make sure you typed the address you signed up with.</li>
          </ul>
          <div class="mt-4 flex w-full flex-col gap-2">
            <a hlmBtn routerLink="/auth/login" class="h-12 text-base" i18n>Back to log in</a>
            <button hlmBtn type="button" variant="ghost" class="h-11" (click)="sentTo.set(null)" i18n>Use a different email</button>
          </div>
        </div>
      } @else {
        <a routerLink="/auth/login" class="tap -ml-2 inline-flex items-center gap-1 self-start px-2 text-sm text-muted-foreground hover:text-foreground">
          <ng-icon name="lucideArrowLeft" size="16" aria-hidden="true" /> <ng-container i18n>Log in</ng-container>
        </a>
        <h1 class="mt-2 text-3xl uppercase" i18n>Forgot password</h1>
        <p class="mt-1 text-sm text-muted-foreground" i18n>Enter the email you signed up with. We will send you a link to choose a new password.</p>
        <!-- Plain (submit), not (ngSubmit): there is no [formGroup]/NgForm on this form to emit it. -->
        <form (submit)="$event.preventDefault(); submit()" class="mt-6 flex flex-col gap-5" novalidate>
          @if (error()) {
            <p class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">{{ error() }}</p>
          }
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="fp-email" i18n>Email</label>
            <input hlmInput id="fp-email" type="email" class="h-11" [formControl]="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false"
              [attr.aria-invalid]="!!emailError()" [attr.aria-describedby]="emailError() ? 'fp-email-err' : null" />
            @if (emailError(); as e) {
              <p id="fp-email-err" class="field-error">{{ e }}</p>
            }
          </div>
          <button hlmBtn type="submit" class="h-12 text-base" [disabled]="saving()">
            {{ saving() ? txt.sending : txt.sendResetLink }}
          </button>
        </form>
      }
    </ah-auth-layout>
  `,
})
export class ForgotPasswordScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    sending: $localize`Sending…`,
    sendResetLink: $localize`Send reset link`,
  };

  private readonly auth = inject(AuthService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly api = inject(ApiService);

  protected readonly email = new FormControl(this.auth.user()?.email ?? '', { nonNullable: true, validators: [Validators.required, Validators.email] });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sentTo = signal<string | null>(null);

  protected emailError(): string | null {
    return fieldError(this.email);
  }

  protected async submit(): Promise<void> {
    this.error.set(null);
    if (this.email.invalid) {
      this.email.markAsTouched();
      queueMicrotask(() => focusFirstInvalid(this.host.nativeElement));
      return;
    }
    this.saving.set(true);
    const email = this.email.value.trim();
    try {
      await this.api.forgotPassword(email);
      this.sentTo.set(email);
    } catch (e) {
      const err = ApiError.from(e);
      // Never reveal whether the account exists: only network / rate-limit / server failures are shown.
      if (err.isNetwork || err.status === 429 || err.status >= 500) this.error.set(err.message);
      else this.sentTo.set(email);
    } finally {
      this.saving.set(false);
    }
  }
}
