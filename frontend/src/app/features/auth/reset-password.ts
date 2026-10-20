import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { AuthLayout } from './auth-layout';
import { applyServerErrors, fieldError, focusFirstInvalid, matchValidator } from './form-utils';
import { PASSWORD_MIN, PasswordInput, PasswordStrength } from './password';

@Component({
  selector: 'zeus-reset-password-screen',
  imports: [AuthLayout, ReactiveFormsModule, RouterLink, NgIcon, HlmButton, HlmLabel, PasswordInput, PasswordStrength],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <zeus-auth-layout>
      @switch (state()) {
        @case ('missing') {
          <div class="flex flex-col items-start gap-3" role="alert">
            <span class="grid size-12 place-items-center rounded-md bg-destructive/10 text-destructive" aria-hidden="true"><ng-icon name="lucideLink" size="24" /></span>
            <h1 class="text-3xl uppercase">Link not valid</h1>
            <p class="text-muted-foreground">This reset link is incomplete. Open the link from the email again, or ask for a new one.</p>
            <a hlmBtn routerLink="/auth/forgot-password" class="mt-2 h-12 w-full text-base">Get a new reset link</a>
          </div>
        }
        @case ('expired') {
          <div class="flex flex-col items-start gap-3" role="alert">
            <span class="grid size-12 place-items-center rounded-md bg-warning-surface text-warning" aria-hidden="true"><ng-icon name="lucideHourglass" size="24" /></span>
            <h1 class="text-3xl uppercase">Link expired</h1>
            <p class="text-muted-foreground">{{ expiredMessage() }} Reset links work once and expire after one hour.</p>
            <a hlmBtn routerLink="/auth/forgot-password" class="mt-2 h-12 w-full text-base">Get a new reset link</a>
            <a hlmBtn variant="ghost" routerLink="/auth/login" class="h-11 w-full">Back to log in</a>
          </div>
        }
        @case ('done') {
          <div class="flex flex-col items-start gap-3" role="status">
            <span class="grid size-12 place-items-center rounded-md bg-primary/15 text-primary" aria-hidden="true"><ng-icon name="lucideCircleCheck" size="24" /></span>
            <h1 class="text-3xl uppercase">Password changed</h1>
            <p class="text-muted-foreground">You can now log in with your new password. For your security, all devices were signed out.</p>
            <a hlmBtn routerLink="/auth/login" class="mt-2 h-12 w-full text-base">Log in</a>
          </div>
        }
        @default {
          <h1 class="text-3xl uppercase">Choose a new password</h1>
          <p class="mt-1 text-sm text-muted-foreground">Use at least {{ min }} characters. A short sentence is easy to remember and hard to guess.</p>
          <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 flex flex-col gap-5" novalidate>
            @if (error()) {
              <p class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">{{ error() }}</p>
            }
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="rp-password">New password</label>
              <zeus-password-input [control]="form.controls.password" inputId="rp-password" autocomplete="new-password"
                [invalid]="!!err('password')" [describedBy]="err('password') ? 'rp-password-err rp-hints' : 'rp-hints'" />
              @if (err('password'); as e) {
                <p id="rp-password-err" class="field-error">{{ e }}</p>
              }
              <zeus-password-strength [password]="passwordValue()" listId="rp-hints" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="rp-confirm">Repeat new password</label>
              <zeus-password-input [control]="form.controls.confirm" inputId="rp-confirm" autocomplete="new-password"
                [invalid]="!!confirmError()" [describedBy]="confirmError() ? 'rp-confirm-err' : null" />
              @if (confirmError(); as e) {
                <p id="rp-confirm-err" class="field-error">{{ e }}</p>
              }
            </div>
            <button hlmBtn type="submit" class="h-12 text-base" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save new password' }}</button>
          </form>
        }
      }
    </zeus-auth-layout>
  `,
})
export class ResetPasswordScreen {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly token = input<string | undefined>();

  protected readonly min = PASSWORD_MIN;
  protected readonly form = new FormGroup(
    {
      password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(PASSWORD_MIN), Validators.maxLength(200)] }),
      confirm: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: matchValidator('password', 'confirm') },
  );
  protected readonly passwordValue = toSignal(this.form.controls.password.valueChanges, { initialValue: '' });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly result = signal<'done' | 'expired' | null>(null);
  protected readonly expiredMessage = signal('This reset link has expired or was already used.');

  protected state(): 'missing' | 'expired' | 'done' | 'form' {
    if (this.result()) return this.result()!;
    return this.token() ? 'form' : 'missing';
  }

  protected err(name: 'password'): string | null {
    return fieldError(this.form.controls[name], { minlength: `Use at least ${PASSWORD_MIN} characters.` });
  }

  protected confirmError(): string | null {
    const c = this.form.controls.confirm;
    if (!c.touched) return null;
    if (c.hasError('required')) return 'Repeat the password.';
    if (this.form.hasError('mismatch')) return 'The two passwords do not match.';
    return null;
  }

  protected async submit(): Promise<void> {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      queueMicrotask(() => focusFirstInvalid(this.host.nativeElement));
      return;
    }
    this.saving.set(true);
    try {
      await this.api.resetPassword(this.token()!, this.form.controls.password.value);
      // The server revokes every session, including this device's.
      this.auth.clear();
      this.result.set('done');
    } catch (e) {
      const err = ApiError.from(e);
      if (err.status === 400 && Object.keys(err.fields).some((f) => f !== 'token')) {
        const unmatched = applyServerErrors(this.form, err);
        if (unmatched.length) this.error.set(unmatched[0]);
      } else if (err.code === 'invalid_token' || err.status === 400 || err.status === 404 || err.status === 410) {
        if (err.code === 'invalid_token') this.expiredMessage.set(err.message);
        this.result.set('expired');
      } else {
        this.error.set(err.message);
      }
    } finally {
      this.saving.set(false);
    }
  }
}
