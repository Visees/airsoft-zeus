import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { LocationTracker } from '../../core/location/location-tracker.service';
import { PushService } from '../../core/push/push.service';
import { ToastService } from '../../core/ui/toast.service';
import { AuthLayout } from '../auth/auth-layout';
import { PermState, PermissionChip, PermissionHelp } from './permission-help';

type Step = 'location' | 'notifications';

/** Onboarding step 2: location and notifications, each skippable. */
@Component({
  selector: 'ah-permissions-screen',
  imports: [AuthLayout, NgIcon, HlmButton, PermissionChip, PermissionHelp],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ah-auth-layout [center]="false">
      <div class="flex items-center justify-between gap-3">
        <p class="label-caps"><ng-container i18n>Set up · step <span class="num">{{ stepIndex() + 1 }}</span> of</ng-container>&ngsp;<span class="num">2</span></p>
        <div class="flex gap-1" aria-hidden="true">
          <span class="h-1.5 w-8 rounded-full bg-primary"></span>
          <span class="h-1.5 w-8 rounded-full" [class.bg-primary]="step() === 'notifications'" [class.bg-muted]="step() !== 'notifications'"></span>
        </div>
      </div>

      @if (step() === 'location') {
        <section class="mt-4 flex flex-col gap-4" aria-labelledby="perm-loc-title">
          <span class="grid size-12 place-items-center rounded-md bg-nav/15 text-nav" aria-hidden="true"><ng-icon name="lucideLocateFixed" size="24" /></span>
          <div>
            <h1 id="perm-loc-title" class="text-3xl uppercase" i18n>Location</h1>
            <p class="mt-1 text-muted-foreground" i18n>Shows you on the tactical map and lets you capture zones by holding them.</p>
          </div>
          <ul class="panel flex flex-col divide-y divide-border text-sm">
            <li class="flex gap-3 p-3"><ng-icon name="lucideRadio" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span i18n><strong>Only during live events.</strong> Your position is sent only while a game you joined is running and you have it open.</span></li>
            <li class="flex gap-3 p-3"><ng-icon name="lucideEye" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span i18n><strong>Shared by the event's rules.</strong> The Game Master decides who sees you — your squad, your team, or an approximate area. The lobby tells you before the game.</span></li>
            <li class="flex gap-3 p-3"><ng-icon name="lucideCircleStop" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span i18n><strong>Stop anytime.</strong> Turn sharing off from the live screen or your browser settings. Zone captures need it on.</span></li>
          </ul>
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm text-muted-foreground" i18n>Browser permission</span>
            <ah-permission-chip [state]="locationState()" />
          </div>
          @if (locationState() === 'denied') {
            <ah-permission-help kind="location" />
          }
          @if (locationState() === 'unsupported') {
            <p class="text-sm text-muted-foreground" i18n>This browser cannot share location. Use Chrome or Safari on your phone to play.</p>
          }
        </section>
      } @else {
        <section class="mt-4 flex flex-col gap-4" aria-labelledby="perm-notif-title">
          <span class="grid size-12 place-items-center rounded-md bg-primary/15 text-primary" aria-hidden="true"><ng-icon name="lucideBellRing" size="24" /></span>
          <div>
            <h1 id="perm-notif-title" class="text-3xl uppercase" i18n>Notifications</h1>
            <p class="mt-1 text-muted-foreground" i18n>Get told when it matters, even with the app closed.</p>
          </div>
          <ul class="panel flex flex-col divide-y divide-border text-sm">
            <li class="flex gap-3 p-3"><ng-icon name="lucideCalendar" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span i18n>Invitations, registration approvals and a reminder before your event starts.</span></li>
            <li class="flex gap-3 p-3"><ng-icon name="lucideFlag" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span i18n>During the game: start, pause, objectives under attack and messages from your Game Master.</span></li>
            <li class="flex gap-3 p-3"><ng-icon name="lucideSiren" size="18" class="mt-0.5 shrink-0 text-destructive" aria-hidden="true" /><span i18n><strong>Emergency alerts</strong> from the Game Master, such as a game stop for an injury. We recommend allowing notifications for these.</span></li>
          </ul>
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm text-muted-foreground" i18n>Browser permission</span>
            <ah-permission-chip [state]="notifState()" />
          </div>
          @if (notifState() === 'denied') {
            <ah-permission-help kind="notifications" />
          }
          @if (notifState() === 'unsupported') {
            <p class="text-sm text-muted-foreground" i18n>
              This browser does not support push notifications. On iPhone, add AirsoftHub to your Home Screen first (Share → Add to Home Screen). You will still see alerts inside the app.
            </p>
          }
        </section>
      }

      <div class="sticky bottom-0 -mx-4 mt-6 flex flex-col gap-2 border-t border-border bg-background/95 px-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0"
        style="padding-bottom: calc(0.75rem + var(--safe-bottom))">
        @if (step() === 'location') {
          @if (locationState() === 'granted' || locationState() === 'denied' || locationState() === 'unsupported') {
            <button hlmBtn type="button" class="h-12 text-base" (click)="step.set('notifications')" i18n>Next</button>
          } @else {
            <button hlmBtn type="button" class="h-12 text-base" [disabled]="busy()" (click)="allowLocation()">
              {{ busy() ? txt.waitingForYourAnswer : txt.allowLocation }}
            </button>
            <button hlmBtn type="button" variant="ghost" class="h-11" [disabled]="busy()" (click)="step.set('notifications')" i18n>Not now</button>
          }
        } @else {
          @if (notifState() === 'granted' || notifState() === 'denied' || notifState() === 'unsupported') {
            <button hlmBtn type="button" class="h-12 text-base" [disabled]="finishing()" (click)="finish()">{{ finishing() ? txt.saving : txt.finish }}</button>
          } @else {
            <button hlmBtn type="button" class="h-12 text-base" [disabled]="busy() || finishing()" (click)="allowNotifications()">
              {{ busy() ? txt.waitingForYourAnswer : txt.allowNotifications }}
            </button>
            <button hlmBtn type="button" variant="ghost" class="h-11" [disabled]="busy() || finishing()" (click)="finish()" i18n>Not now</button>
          }
          <button hlmBtn type="button" variant="link" class="h-11" (click)="step.set('location')" i18n>Back to location</button>
        }
      </div>
    </ah-auth-layout>
  `,
})
export class PermissionsScreen implements OnInit {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    waitingForYourAnswer: $localize`Waiting for your answer…`,
    allowLocation: $localize`Allow location`,
    saving: $localize`Saving…`,
    finish: $localize`Finish`,
    allowNotifications: $localize`Allow notifications`,
  };

  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly tracker = inject(LocationTracker);
  private readonly push = inject(PushService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly step = signal<Step>('location');
  protected readonly stepIndex = computed(() => (this.step() === 'location' ? 0 : 1));
  protected readonly locationState = signal<PermState>('checking');
  protected readonly notifState = computed<PermState>(() => {
    const p = this.push.permission();
    if (p === 'unsupported') return 'unsupported';
    return p === 'default' ? 'prompt' : p;
  });
  protected readonly busy = signal(false);
  protected readonly finishing = signal(false);

  async ngOnInit(): Promise<void> {
    const s = await this.tracker.permissionState();
    this.locationState.set(s);
  }

  protected async allowLocation(): Promise<void> {
    this.busy.set(true);
    try {
      const granted = await this.tracker.requestPermission();
      const state = await this.tracker.permissionState();
      // Some browsers (Safari) cannot query the permission: trust the request result.
      this.locationState.set(state === 'prompt' ? (granted ? 'granted' : 'denied') : state);
      void this.api.recordConsent('location', granted).catch(() => undefined);
      if (granted) {
        this.toast.success($localize`Location allowed`, $localize`It is used only during live events you join.`);
        this.step.set('notifications');
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async allowNotifications(): Promise<void> {
    this.busy.set(true);
    try {
      await this.push.enable();
      const granted = this.push.permission() === 'granted';
      void this.api.recordConsent('notifications', granted).catch(() => undefined);
      if (granted) this.toast.success($localize`Notifications allowed`);
    } finally {
      this.busy.set(false);
    }
  }

  protected async finish(): Promise<void> {
    this.finishing.set(true);
    try {
      const user = await this.api.updateMe({ onboardingDone: true });
      this.auth.setUser(user);
      await this.router.navigateByUrl('/home');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.finishing.set(false);
    }
  }
}
