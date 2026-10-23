import { ChangeDetectionStrategy, Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { errorMessage } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { ConfigService } from '../../core/api/config.service';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';
import { AuthLayout } from '../auth/auth-layout';
import { safeNext } from '../auth/form-utils';
import { LegalDialog } from './legal-dialog';
import { LegalDoc, PRIVACY, TERMS } from './legal-text';

/** Accept the current Terms and Privacy versions (new users or after an update). */
@Component({
  selector: 'ah-consent-screen',
  imports: [AuthLayout, FormsModule, NgIcon, HlmButton, LegalDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ah-auth-layout [center]="false" width="wide">
      <button layoutAction type="button" class="tap inline-flex items-center px-2 text-sm font-semibold text-muted-foreground hover:text-foreground" (click)="auth.logout()" i18n>
        Log out
      </button>

      <p class="label-caps" i18n>Before you continue</p>
      <h1 class="mt-1 text-3xl uppercase" i18n>Terms and privacy</h1>
      <p class="mt-1 text-sm text-muted-foreground">
        @if (isUpdate()) {
          <ng-container i18n>We updated our terms. Here is what matters, in short. Read the full texts if you want the details.</ng-container>
        } @else {
          <ng-container i18n>Here is what matters, in short. Read the full texts if you want the details.</ng-container>
        }
      </p>

      <div class="mt-6 flex flex-col gap-4">
        @for (d of docs; track d.id) {
          <section class="panel p-4" [attr.aria-labelledby]="'c-' + d.id">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h2 [id]="'c-' + d.id" class="text-lg uppercase">{{ d.title }}</h2>
              <span class="label-caps" i18n>Version <span class="num">{{ versionOf(d) }}</span></span>
            </div>
            <ul class="mt-3 flex flex-col gap-2 text-sm">
              @for (s of d.summary; track $index) {
                <li class="flex gap-2"><span aria-hidden="true" class="text-primary">▸</span><span>{{ s }}</span></li>
              }
            </ul>
            <button hlmBtn type="button" variant="outline" class="mt-4 h-auto min-h-11 py-2 text-left whitespace-normal" (click)="legal().open(d)">
              <ng-icon name="lucideFileText" size="16" aria-hidden="true" /> <ng-container i18n>Read the full {{ d.title }}</ng-container>
            </button>
          </section>
        }
      </div>

      <form class="mt-6 flex flex-col gap-4" (ngSubmit)="accept()">
        <label class="panel flex min-h-14 cursor-pointer items-start gap-3 p-4" for="c-terms">
          <input id="c-terms" type="checkbox" class="mt-0.5 size-6 shrink-0 accent-primary" name="terms" [(ngModel)]="termsChecked" />
          <span class="text-sm leading-6" i18n>I have read and accept the <strong>Terms of Service</strong>.</span>
        </label>
        <label class="panel flex min-h-14 cursor-pointer items-start gap-3 p-4" for="c-privacy">
          <input id="c-privacy" type="checkbox" class="mt-0.5 size-6 shrink-0 accent-primary" name="privacy" [(ngModel)]="privacyChecked" />
          <span class="text-sm leading-6" i18n>I have read the <strong>Privacy Policy</strong> and understand how my location and data are used.</span>
        </label>
        @if (error()) {
          <p class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">{{ error() }}</p>
        }
        <div class="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0"
          style="padding-bottom: calc(0.75rem + var(--safe-bottom))">
          <button hlmBtn type="submit" class="h-12 w-full text-base sm:w-auto sm:px-8" [disabled]="!canSubmit() || saving()">
            {{ saving() ? txt.saving : txt.acceptAndContinue }}
          </button>
          @if (!canSubmit()) {
            <p class="mt-2 text-xs text-muted-foreground" i18n>Tick both boxes to continue.</p>
          }
        </div>
      </form>
    </ah-auth-layout>
    <ah-legal-dialog />
  `,
})
export class ConsentScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    saving: $localize`Saving…`,
    acceptAndContinue: $localize`Accept and continue`,
  };

  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly config = inject(ConfigService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly legal = viewChild.required(LegalDialog);

  readonly next = input<string | undefined>();

  protected readonly docs: LegalDoc[] = [TERMS, PRIVACY];
  protected readonly termsChecked = signal(false);
  protected readonly privacyChecked = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly canSubmit = computed(() => this.termsChecked() && this.privacyChecked());
  /** Existing users (onboarding done) are here because the texts changed. */
  protected readonly isUpdate = computed(() => this.auth.user()?.onboardingDone === true);

  protected versionOf(d: LegalDoc): string {
    return d.id === 'terms' ? this.config.config().termsVersion : this.config.config().privacyVersion;
  }

  protected async accept(): Promise<void> {
    if (!this.canSubmit() || this.saving()) return;
    this.error.set(null);
    this.saving.set(true);
    try {
      const cfg = await this.config.load();
      await this.api.recordConsent('terms', true, cfg.termsVersion);
      await this.api.recordConsent('privacy', true, cfg.privacyVersion);
      const user = await this.auth.reloadUser();
      if (user && !user.termsAccepted) {
        this.error.set($localize`Your acceptance was saved but the server still asks for it. Reload the app and try again.`);
        return;
      }
      this.toast.success($localize`Thanks — you are all set`);
      await this.router.navigateByUrl(safeNext(this.next()) ?? '/');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
