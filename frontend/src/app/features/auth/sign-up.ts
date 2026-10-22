import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiError } from '../../core/api/api-error';
import { ConfigService } from '../../core/api/config.service';
import { activeLanguage } from '../../core/i18n/language';
import { AuthService } from '../../core/auth/auth.service';
import { LegalDialog } from '../onboarding/legal-dialog';
import { PRIVACY, TERMS } from '../onboarding/legal-text';
import { AuthLayout } from './auth-layout';
import { applyServerErrors, fieldError, focusFirstInvalid } from './form-utils';
import { NICKNAME_FORMAT_HELP, NICKNAME_PATTERN, NicknameStatusLine, createNicknameCheck } from './nickname-check';
import { PASSWORD_MIN, PasswordInput, PasswordStrength } from './password';

@Component({
  selector: 'zeus-sign-up-screen',
  imports: [AuthLayout, ReactiveFormsModule, RouterLink, NgIcon, HlmButton, HlmInput, HlmLabel, PasswordInput, PasswordStrength, NicknameStatusLine, LegalDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <zeus-auth-layout [center]="false">
      <a layoutAction routerLink="/auth/login" class="tap inline-flex items-center px-2 text-sm font-semibold text-muted-foreground hover:text-foreground" i18n>Log in</a>

      <a routerLink="/welcome" class="tap -ml-2 inline-flex items-center gap-1 self-start px-2 text-sm text-muted-foreground hover:text-foreground">
        <ng-icon name="lucideArrowLeft" size="16" aria-hidden="true" /> <ng-container i18n>Back</ng-container>
      </a>
      <h1 class="mt-2 text-3xl uppercase" i18n>Create account</h1>
      <p class="mt-1 text-sm text-muted-foreground" i18n>One account to join events as a player and to run your own as a Game Master.</p>

      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 flex flex-col gap-5" novalidate>
        @if (formError()) {
          <div class="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
            <ng-icon name="lucideCircleAlert" size="18" class="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
            <span>{{ formError() }}</span>
          </div>
        }

        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="su-email" i18n>Email</label>
          <input hlmInput id="su-email" type="email" class="h-11" formControlName="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false"
            [attr.aria-invalid]="!!err('email')" [attr.aria-describedby]="err('email') ? 'su-email-err' : 'su-email-help'" />
          @if (err('email'); as e) {
            <p id="su-email-err" class="field-error">{{ e }}</p>
          } @else {
            <p id="su-email-help" class="text-xs text-muted-foreground" i18n>We send a link to verify it. Never shown to other players.</p>
          }
        </div>

        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="su-nickname" i18n>Nickname</label>
          <input hlmInput id="su-nickname" class="h-11" formControlName="nickname" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="24"
            [attr.aria-invalid]="!!err('nickname') || nick.status() === 'taken'" aria-describedby="su-nickname-help su-nickname-status" />
          <p id="su-nickname-help" class="text-xs text-muted-foreground" i18n>
            Your public name: it is shown on the map, in teams and in results. {{ formatHelp }}
          </p>
          @if (err('nickname'); as e) {
            <p class="field-error" id="su-nickname-status">{{ e }}</p>
          } @else {
            <zeus-nickname-status id="su-nickname-status" [status]="nick.status()" [reason]="nick.reason()" />
          }
        </div>

        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="su-password" i18n>Password</label>
          <zeus-password-input [control]="form.controls.password" inputId="su-password" autocomplete="new-password"
            [invalid]="!!err('password')" [describedBy]="err('password') ? 'su-password-err su-password-hints' : 'su-password-hints'" />
          @if (err('password'); as e) {
            <p id="su-password-err" class="field-error">{{ e }}</p>
          }
          <zeus-password-strength [password]="passwordValue()" [avoid]="avoid()" listId="su-password-hints" />
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-start gap-3">
            <input id="su-terms" type="checkbox" formControlName="acceptTerms" class="mt-0.5 size-6 shrink-0 accent-primary"
              [attr.aria-invalid]="!!err('acceptTerms')" [attr.aria-describedby]="err('acceptTerms') ? 'su-terms-err' : null" />
            <!-- One message, links inside: the translation decides the spacing around them (Italian "e l'Informativa") -->
            <label for="su-terms" class="text-sm leading-6" i18n>I accept the <button type="button" class="font-semibold text-primary underline underline-offset-2" (click)="legal().open(terms)">Terms of Service</button> and the <button type="button" class="font-semibold text-primary underline underline-offset-2" (click)="legal().open(privacy)">Privacy Policy</button>, including location sharing during live events I join.</label>
          </div>
          @if (err('acceptTerms'); as e) {
            <p id="su-terms-err" class="field-error">{{ e }}</p>
          }
        </div>

        <button hlmBtn type="submit" class="h-12 text-base" [disabled]="saving()">
          @if (saving()) {
            <ng-icon name="lucideLoader2" size="18" class="animate-spin" aria-hidden="true" /> <ng-container i18n>Creating account…</ng-container>
          } @else {
            <ng-container i18n>Create account</ng-container>
          }
        </button>
        <p class="text-center text-sm text-muted-foreground" i18n>
          Already have an account? <a routerLink="/auth/login" class="font-semibold text-primary underline-offset-2 hover:underline">Log in</a>
        </p>
      </form>
    </zeus-auth-layout>
    <zeus-legal-dialog />
  `,
})
export class SignUpScreen {
  private readonly auth = inject(AuthService);
  private readonly config = inject(ConfigService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly legal = viewChild.required(LegalDialog);

  protected readonly terms = TERMS;
  protected readonly privacy = PRIVACY;
  protected readonly formatHelp = NICKNAME_FORMAT_HELP;

  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(254)] }),
    nickname: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(NICKNAME_PATTERN)] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(PASSWORD_MIN), Validators.maxLength(200)] }),
    acceptTerms: new FormControl(false, { nonNullable: true, validators: [Validators.requiredTrue] }),
  });

  protected readonly nick = createNicknameCheck(this.form.controls.nickname);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly passwordValue = toSignal(this.form.controls.password.valueChanges, { initialValue: '' });
  private readonly emailValue = toSignal(this.form.controls.email.valueChanges, { initialValue: '' });
  private readonly nicknameValue = toSignal(this.form.controls.nickname.valueChanges, { initialValue: '' });
  protected readonly avoid = computed(() => [this.emailValue().split('@')[0] ?? '', this.nicknameValue()]);

  protected err(name: 'email' | 'nickname' | 'password' | 'acceptTerms'): string | null {
    return fieldError(this.form.controls[name], {
      pattern: NICKNAME_FORMAT_HELP,
      required: name === 'acceptTerms' ? $localize`Accept the Terms of Service and Privacy Policy to create an account.` : $localize`Required.`,
      minlength: $localize`Use at least ${PASSWORD_MIN}:PASSWORD_MIN: characters.`,
    });
  }

  protected async submit(): Promise<void> {
    this.formError.set(null);
    if (this.nick.status() === 'taken') {
      this.form.controls.nickname.markAsTouched();
      this.form.controls.nickname.setErrors({ server: this.nick.reason() || $localize`This nickname is already taken.` });
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set($localize`Check the highlighted fields.`);
      queueMicrotask(() => focusFirstInvalid(this.host.nativeElement));
      return;
    }
    this.saving.set(true);
    try {
      const cfg = await this.config.load();
      const v = this.form.getRawValue();
      await this.auth.register({
        email: v.email.trim(),
        password: v.password,
        nickname: v.nickname.trim(),
        acceptTerms: true,
        termsVersion: cfg.termsVersion,
        privacyVersion: cfg.privacyVersion,
        language: activeLanguage(),
      });
      await this.router.navigateByUrl('/auth/verify-email');
    } catch (e) {
      const err = ApiError.from(e);
      const unmatched = applyServerErrors(this.form, err);
      const hasFieldErrors = Object.keys(err.fields).length > unmatched.length;
      this.formError.set(hasFieldErrors ? (unmatched[0] ?? $localize`Check the highlighted fields.`) : err.message);
      queueMicrotask(() => focusFirstInvalid(this.host.nativeElement));
    } finally {
      this.saving.set(false);
    }
  }
}
