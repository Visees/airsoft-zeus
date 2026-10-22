import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';
import { nowSignal } from '../../shared/game-timer';
import { AuthLayout } from './auth-layout';
import { postAuthUrl } from './post-auth';

const RESEND_COOLDOWN_MS = 60_000;

type State = 'starting' | 'verifying' | 'verified' | 'failed' | 'inbox' | 'already' | 'signed-out';

/**
 * With ?token=… verifies the address. Without it shows "check your inbox" with resend.
 * Works signed in or signed out.
 */
@Component({
  selector: 'zeus-verify-email-screen',
  imports: [AuthLayout, RouterLink, NgIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <zeus-auth-layout>
      @switch (state()) {
        @case ('starting') {
          <div class="flex flex-col items-center gap-3 py-10" role="status">
            <ng-icon name="lucideLoader2" size="28" class="animate-spin text-muted-foreground" aria-hidden="true" />
            <span class="text-sm text-muted-foreground" i18n>Loading…</span>
          </div>
        }
        @case ('verifying') {
          <div class="flex flex-col items-center gap-3 py-10" role="status">
            <ng-icon name="lucideLoader2" size="28" class="animate-spin text-muted-foreground" aria-hidden="true" />
            <span class="text-sm text-muted-foreground" i18n>Verifying your email…</span>
          </div>
        }
        @case ('verified') {
          <div class="flex flex-col items-start gap-3" role="status">
            <span class="grid size-12 place-items-center rounded-md bg-primary/15 text-primary" aria-hidden="true"><ng-icon name="lucideCircleCheck" size="24" /></span>
            <h1 class="text-3xl uppercase" i18n>Email verified</h1>
            <p class="text-muted-foreground">
              @if (auth.isLoggedIn()) {
                <ng-container i18n>Your account is ready. Next, choose which permissions to give the app for live games.</ng-container>
              } @else {
                <ng-container i18n>Your account is ready. Log in to continue.</ng-container>
              }
            </p>
            <button hlmBtn type="button" class="mt-2 h-12 w-full text-base" (click)="continue()">
              {{ auth.isLoggedIn() ? txt.continue : txt.logIn }}
            </button>
          </div>
        }
        @case ('already') {
          <div class="flex flex-col items-start gap-3" role="status">
            <span class="grid size-12 place-items-center rounded-md bg-primary/15 text-primary" aria-hidden="true"><ng-icon name="lucideCircleCheck" size="24" /></span>
            <h1 class="text-3xl uppercase" i18n>Already verified</h1>
            <p class="text-muted-foreground" i18n>Your email address <span class="font-semibold text-foreground">{{ email() }}</span> is verified.</p>
            <button hlmBtn type="button" class="mt-2 h-12 w-full text-base" (click)="continue()" i18n>Continue</button>
          </div>
        }
        @case ('failed') {
          <div class="flex flex-col items-start gap-3" role="alert">
            <span class="grid size-12 place-items-center rounded-md bg-warning-surface text-warning" aria-hidden="true"><ng-icon name="lucideHourglass" size="24" /></span>
            <h1 class="text-3xl uppercase" i18n>Link not valid</h1>
            <p class="text-muted-foreground">{{ failMessage() }}</p>
            @if (auth.isLoggedIn()) {
              <button hlmBtn type="button" class="mt-2 h-12 w-full text-base" [disabled]="resending() || cooldownLeft() > 0" (click)="resend()">
                {{ resendLabel() }}
              </button>
              <button hlmBtn type="button" variant="ghost" class="h-11 w-full" (click)="state.set('inbox')" i18n>Back</button>
            } @else {
              <a hlmBtn routerLink="/auth/login" [queryParams]="{ next: '/auth/verify-email' }" class="mt-2 h-12 w-full text-base" i18n>Log in to get a new link</a>
            }
          </div>
        }
        @case ('signed-out') {
          <div class="flex flex-col items-start gap-3">
            <span class="grid size-12 place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden="true"><ng-icon name="lucideMail" size="24" /></span>
            <h1 class="text-3xl uppercase" i18n>Verify your email</h1>
            <p class="text-muted-foreground" i18n>Open the link in the email we sent when you signed up. To get a new link, log in first.</p>
            <a hlmBtn routerLink="/auth/login" class="mt-2 h-12 w-full text-base" i18n>Log in</a>
          </div>
        }
        @default {
          <!-- inbox -->
          <div class="flex flex-col items-start gap-3">
            <span class="grid size-12 place-items-center rounded-md bg-primary/15 text-primary" aria-hidden="true"><ng-icon name="lucideMail" size="24" /></span>
            <h1 class="text-3xl uppercase" i18n>Check your inbox</h1>
            <p class="text-muted-foreground" i18n>
              We sent a verification link to <span class="font-semibold break-all text-foreground">{{ email() }}</span>.
              Open it on this device to activate your account.
            </p>
            <ul class="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              <li i18n>Look in spam or promotions if it has not arrived within a few minutes.</li>
              <li i18n>Only the newest link works if you ask for another one.</li>
            </ul>
            @if (notice()) {
              <p class="w-full rounded-md border border-border bg-muted p-3 text-sm" role="status">{{ notice() }}</p>
            }
            <div class="mt-2 flex w-full flex-col gap-2">
              <button hlmBtn type="button" class="h-12 text-base" [disabled]="checking()" (click)="checkVerified()">
                {{ checking() ? txt.checking : txt.iVeVerifiedIt }}
              </button>
              <button hlmBtn type="button" variant="outline" class="h-11" [disabled]="resending() || cooldownLeft() > 0" (click)="resend()">
                <ng-icon name="lucideRefreshCw" size="16" aria-hidden="true" /> {{ resendLabel() }}
              </button>
              <button hlmBtn type="button" variant="ghost" class="h-11" (click)="auth.logout()" i18n>Use another account</button>
            </div>
          </div>
        }
      }
    </zeus-auth-layout>
  `,
})
export class VerifyEmailScreen implements OnInit {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    continue: $localize`Continue`,
    logIn: $localize`Log in`,
    checking: $localize`Checking…`,
    iVeVerifiedIt: $localize`I've verified it`,
  };

  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly token = input<string | undefined>();

  protected readonly state = signal<State>('starting');
  protected readonly failMessage = signal($localize`This verification link has expired or was already used.`);
  protected readonly notice = signal<string | null>(null);
  protected readonly checking = signal(false);
  protected readonly resending = signal(false);
  private readonly lastSentAt = signal<number | null>(null);
  private readonly now = nowSignal();

  protected readonly email = computed(() => this.auth.user()?.email ?? '');
  protected readonly cooldownLeft = computed(() => {
    const at = this.lastSentAt();
    return at ? Math.max(0, Math.ceil((at + RESEND_COOLDOWN_MS - this.now()) / 1000)) : 0;
  });
  protected readonly resendLabel = computed(() => {
    if (this.resending()) return $localize`Sending…`;
    const left = this.cooldownLeft();
    return left > 0 ? $localize`Resend email in ${left}:left:s` : $localize`Resend email`;
  });

  async ngOnInit(): Promise<void> {
    await this.auth.init();
    const token = this.token();
    if (token) {
      await this.verify(token);
      return;
    }
    const user = this.auth.user();
    if (!user) this.state.set('signed-out');
    else if (user.emailVerified) this.state.set('already');
    else {
      // The sign-up email was just sent: start with the cooldown running.
      if (Date.now() - new Date(user.createdAt).getTime() < RESEND_COOLDOWN_MS) this.lastSentAt.set(new Date(user.createdAt).getTime());
      this.state.set('inbox');
    }
  }

  private async verify(token: string): Promise<void> {
    this.state.set('verifying');
    try {
      await this.api.verifyEmail(token);
      if (this.auth.isLoggedIn()) await this.auth.reloadUser();
      this.state.set('verified');
    } catch (e) {
      const err = ApiError.from(e);
      if (err.isNetwork || err.status >= 500) {
        this.failMessage.set($localize`${err.message}:message: Open the link again when you have signal.`);
      } else {
        // Already verified (e.g. the link was opened twice) is a success for the user.
        if (this.auth.isLoggedIn()) {
          const user = await this.auth.reloadUser();
          if (user?.emailVerified) {
            this.state.set('verified');
            return;
          }
        }
        this.failMessage.set(err.fields['token'] ?? $localize`This verification link has expired or was already used.`);
      }
      this.state.set('failed');
    }
  }

  protected async continue(): Promise<void> {
    const user = this.auth.user();
    await this.router.navigateByUrl(user ? postAuthUrl(user) : '/auth/login');
  }

  protected async checkVerified(): Promise<void> {
    this.checking.set(true);
    this.notice.set(null);
    try {
      const user = await this.auth.reloadUser();
      if (user?.emailVerified) {
        this.toast.success($localize`Email verified`);
        await this.router.navigateByUrl(postAuthUrl(user));
      } else {
        this.notice.set($localize`Not verified yet. Open the link in the email, then tap this button again.`);
      }
    } finally {
      this.checking.set(false);
    }
  }

  protected async resend(): Promise<void> {
    if (this.cooldownLeft() > 0) return;
    this.resending.set(true);
    this.notice.set(null);
    try {
      await this.api.resendVerification();
      this.lastSentAt.set(Date.now());
      this.state.set('inbox');
      this.notice.set($localize`New link sent to ${this.email()}:email:.`);
    } catch (e) {
      const err = ApiError.from(e);
      if (err.status === 429) this.lastSentAt.set(Date.now());
      this.toast.error(err);
    } finally {
      this.resending.set(false);
    }
  }
}
