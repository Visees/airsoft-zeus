import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiError } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { PushService } from '../../core/push/push.service';
import { AuthLayout } from './auth-layout';
import { applyServerErrors, fieldError, focusFirstInvalid } from './form-utils';
import { PasswordInput } from './password';
import { postAuthUrl } from './post-auth';

@Component({
  selector: 'zeus-login-screen',
  imports: [AuthLayout, ReactiveFormsModule, RouterLink, NgIcon, HlmButton, HlmInput, HlmLabel, PasswordInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <zeus-auth-layout>
      <h1 class="text-3xl uppercase">Log in</h1>
      <p class="mt-1 text-sm text-muted-foreground">
        @if (next()) {
          Log in to continue where you left off.
        } @else {
          Welcome back. Your events and teams are waiting.
        }
      </p>

      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 flex flex-col gap-5" novalidate>
        @if (formError(); as fe) {
          <div class="flex gap-2 rounded-md border p-3 text-sm" role="alert"
            [class]="fe.kind === 'rate' ? 'border-warning/50 bg-warning-surface' : 'border-destructive/40 bg-destructive/5'">
            <ng-icon [name]="fe.kind === 'rate' ? 'lucideHourglass' : fe.kind === 'network' ? 'lucideWifiOff' : 'lucideCircleAlert'" size="18"
              class="mt-0.5 shrink-0" [class.text-warning]="fe.kind === 'rate'" [class.text-destructive]="fe.kind !== 'rate'" aria-hidden="true" />
            <span>{{ fe.message }}</span>
          </div>
        }

        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="li-email">Email</label>
          <input hlmInput id="li-email" type="email" class="h-11" formControlName="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false"
            [attr.aria-invalid]="!!err('email')" [attr.aria-describedby]="err('email') ? 'li-email-err' : null" />
          @if (err('email'); as e) {
            <p id="li-email-err" class="field-error">{{ e }}</p>
          }
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-end justify-between gap-2">
            <label hlmLabel for="li-password">Password</label>
            <a routerLink="/auth/forgot-password" class="text-sm font-semibold text-primary underline-offset-2 hover:underline">Forgot password?</a>
          </div>
          <zeus-password-input [control]="form.controls.password" inputId="li-password" autocomplete="current-password"
            [invalid]="!!err('password')" [describedBy]="err('password') ? 'li-password-err' : null" />
          @if (err('password'); as e) {
            <p id="li-password-err" class="field-error">{{ e }}</p>
          }
        </div>

        <button hlmBtn type="submit" class="h-12 text-base" [disabled]="saving()">
          @if (saving()) {
            <ng-icon name="lucideLoader2" size="18" class="animate-spin" aria-hidden="true" /> Logging in…
          } @else {
            Log in
          }
        </button>
        <p class="text-center text-sm text-muted-foreground">
          New to Airsoft Zeus? <a routerLink="/auth/sign-up" class="font-semibold text-primary underline-offset-2 hover:underline">Create an account</a>
        </p>
      </form>
    </zeus-auth-layout>
  `,
})
export class LoginScreen {
  private readonly auth = inject(AuthService);
  private readonly push = inject(PushService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Where to go after login (set by the auth guard). */
  readonly next = input<string | undefined>();

  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  protected readonly saving = signal(false);
  protected readonly formError = signal<{ kind: 'rate' | 'network' | 'auth' | 'other'; message: string } | null>(null);

  protected err(name: 'email' | 'password'): string | null {
    return fieldError(this.form.controls[name]);
  }

  protected async submit(): Promise<void> {
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      queueMicrotask(() => focusFirstInvalid(this.host.nativeElement));
      return;
    }
    this.saving.set(true);
    try {
      const { email, password } = this.form.getRawValue();
      const user = await this.auth.login(email.trim(), password);
      void this.push.ensureSubscribed();
      await this.router.navigateByUrl(postAuthUrl(user, this.next()));
    } catch (e) {
      const err = ApiError.from(e);
      if (err.status === 429) {
        this.formError.set({ kind: 'rate', message: err.message || 'Too many login attempts. Wait a few minutes before trying again, or reset your password.' });
      } else if (err.isNetwork) {
        this.formError.set({ kind: 'network', message: err.message });
      } else if (err.status === 401 || err.status === 400) {
        const unmatched = applyServerErrors(this.form, err);
        this.formError.set({
          kind: 'auth',
          message: Object.keys(err.fields).length && !unmatched.length ? 'Check the highlighted fields.' : err.message || 'Wrong email or password.',
        });
        this.form.controls.password.reset('');
      } else {
        this.formError.set({ kind: 'other', message: err.message });
      }
    } finally {
      this.saving.set(false);
    }
  }
}
