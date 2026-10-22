import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { LocationTracker } from '../../core/location/location-tracker.service';
import { PushService } from '../../core/push/push.service';
import { ThemePreference, ThemeService } from '../../core/theme/theme.service';
import { UI_LANGUAGES, UiLanguage, activeLanguage, switchLanguage } from '../../core/i18n/language';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { downloadBlob } from '../../core/util/format';
import { PageHeader } from '../../shared/states';
import { applyServerErrors, fieldError, focusFirstInvalid, matchValidator } from '../auth/form-utils';
import { PASSWORD_MIN, PasswordInput, PasswordStrength } from '../auth/password';
import { LegalDialog } from '../onboarding/legal-dialog';
import { PRIVACY, TERMS } from '../onboarding/legal-text';
import { PermState, PermissionChip, PermissionHelp } from '../onboarding/permission-help';

@Component({
  selector: 'zeus-settings-screen',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    NgIcon,
    HlmButton,
    HlmLabel,
    PageHeader,
    PasswordInput,
    PasswordStrength,
    PermissionChip,
    PermissionHelp,
    LegalDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      <zeus-page-header title="Settings" i18n-title />

      <nav class="relative mb-4 flex gap-2 overflow-x-auto pb-1 text-sm" aria-label="Settings sections" i18n-aria-label>
        @for (s of sections; track s.id) {
          <a [href]="'#' + s.id" (click)="jump($event, s.id)" class="flex min-h-11 shrink-0 items-center rounded-sm border border-border px-3 text-muted-foreground hover:bg-muted hover:text-foreground">{{ s.label }}</a>
        }
      </nav>

      <div class="flex flex-col gap-4">
        <!-- Appearance -->
        <section id="set-appearance" class="panel scroll-mt-20 p-4" aria-labelledby="set-appearance-h">
          <h2 id="set-appearance-h" class="label-caps" i18n>Appearance</h2>
          <fieldset class="mt-3">
            <legend class="sr-only" i18n>Theme</legend>
            <div class="grid grid-cols-3 gap-2">
              @for (t of themes; track t.value) {
                <label class="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border px-2 py-2 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring"
                  [class]="theme.preference() === t.value ? 'border-primary bg-primary/10 font-semibold text-foreground' : 'border-border text-muted-foreground hover:bg-muted'">
                  <input type="radio" name="theme" class="sr-only" [value]="t.value" [checked]="theme.preference() === t.value" (change)="theme.setPreference(t.value)" />
                  <ng-icon [name]="t.icon" size="18" aria-hidden="true" />
                  <span>{{ t.label }}@if (theme.preference() === t.value) { <span aria-hidden="true"> ✓</span> }</span>
                </label>
              }
            </div>
          </fieldset>
          <p class="mt-3 text-sm text-muted-foreground" i18n>
            Live game screens switch to dark — easier on your eyes in the woods and on the battery — unless you pick Light here.
          </p>
          <fieldset class="mt-5">
            <legend class="text-sm font-semibold" i18n>Language</legend>
            <p class="mt-0.5 text-sm text-muted-foreground" i18n>For the app, emails and notifications. Changing it reloads the app.</p>
            <div class="mt-2 grid grid-cols-2 gap-2">
              @for (l of languages; track l.code) {
                <label class="flex h-12 cursor-pointer items-center justify-center rounded-md border px-2 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring" [attr.lang]="l.code"
                  [class]="language === l.code ? 'border-primary bg-primary/10 font-semibold text-foreground' : 'border-border text-muted-foreground hover:bg-muted'">
                  <input type="radio" name="language" class="sr-only" [value]="l.code" [checked]="language === l.code" [disabled]="savingLanguage()" (change)="setLanguage(l.code)" />
                  <span>{{ l.name }}@if (language === l.code) { <span aria-hidden="true"> ✓</span> }</span>
                </label>
              }
            </div>
          </fieldset>
        </section>

        <!-- Notifications -->
        <section id="set-notifications" class="panel scroll-mt-20 p-4" aria-labelledby="set-notif-h">
          <div class="flex items-center justify-between gap-3">
            <h2 id="set-notif-h" class="label-caps" i18n>Notifications</h2>
            <zeus-permission-chip [state]="notifState()" />
          </div>
          <p class="mt-2 text-sm text-muted-foreground" i18n>
            Push notifications reach you with the app closed: invitations, approvals, game start and pause, objectives under attack and Game Master messages.
          </p>
          <p class="mt-2 flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <ng-icon name="lucideSiren" size="16" class="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
            <span i18n>Emergency messages from a Game Master (for example a stop for an injury) are always shown inside the app with sound and vibration. Keep push on to get them when your screen is off.</span>
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            @switch (notifState()) {
              @case ('granted') {
                @if (push.subscribed()) {
                  <span class="text-sm" i18n>On for this device.</span>
                  <button hlmBtn variant="outline" type="button" class="h-11" [disabled]="pushBusy()" (click)="disablePush()" i18n>Turn off on this device</button>
                } @else {
                  <span class="text-sm text-muted-foreground" i18n>Allowed, but this device is not registered.</span>
                  <button hlmBtn type="button" class="h-11" [disabled]="pushBusy()" (click)="enablePush()" i18n>Turn on</button>
                }
              }
              @case ('prompt') {
                <button hlmBtn type="button" class="h-11" [disabled]="pushBusy()" (click)="enablePush()">
                  <ng-icon name="lucideBellRing" size="16" aria-hidden="true" /> <ng-container i18n>Allow notifications</ng-container>
                </button>
              }
              @case ('unsupported') {
                <p class="text-sm text-muted-foreground" i18n>This browser does not support push. On iPhone, add the app to the Home Screen first (Share → Add to Home Screen).</p>
              }
            }
          </div>
          @if (notifState() === 'denied') {
            <zeus-permission-help class="mt-3" kind="notifications" />
          }
        </section>

        <!-- Location -->
        <section id="set-location" class="panel scroll-mt-20 p-4" aria-labelledby="set-loc-h">
          <div class="flex items-center justify-between gap-3">
            <h2 id="set-loc-h" class="label-caps" i18n>Location</h2>
            <zeus-permission-chip [state]="locationState()" />
          </div>
          <p class="mt-2 text-sm text-muted-foreground" i18n>
            Used only while you are in a live event, as the event rules allow. You can stop sharing from the live screen at any time.
            How long your location history is kept is set in <a routerLink="/settings/privacy" class="font-semibold text-primary underline-offset-2 hover:underline">Privacy</a>.
          </p>
          @if (locationState() === 'prompt') {
            <button hlmBtn variant="outline" type="button" class="mt-3 h-11" [disabled]="locBusy()" (click)="allowLocation()">
              {{ locBusy() ? txt.waitingForYourAnswer : txt.allowLocation }}
            </button>
          } @else if (locationState() === 'granted') {
            <p class="mt-2 text-sm text-muted-foreground" i18n>To revoke it, change the site permission in your browser or phone settings.</p>
          }
          @if (locationState() === 'denied') {
            <zeus-permission-help class="mt-3" kind="location" />
          }
        </section>

        <!-- Account -->
        <section id="set-account" class="panel scroll-mt-20 p-4" aria-labelledby="set-account-h">
          <h2 id="set-account-h" class="label-caps" i18n>Account</h2>
          <dl class="mt-2 text-sm">
            <dt class="text-muted-foreground" i18n>Email</dt>
            <dd class="font-semibold break-all">{{ auth.user()?.email }}
              @if (auth.user()?.emailVerified) {
                <span class="ml-1 text-xs font-normal text-primary" i18n>✓ verified</span>
              }
            </dd>
          </dl>

          <form [formGroup]="pwForm" (ngSubmit)="changePassword()" novalidate class="mt-4 flex flex-col gap-4 border-t border-border pt-4">
            <h3 class="font-semibold" i18n>Change password</h3>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="set-pw-current" i18n>Current password</label>
              <zeus-password-input [control]="pwForm.controls.current" inputId="set-pw-current" autocomplete="current-password"
                [invalid]="!!pwErr('current')" [describedBy]="pwErr('current') ? 'set-pw-current-err' : null" />
              @if (pwErr('current'); as e) { <p id="set-pw-current-err" class="field-error">{{ e }}</p> }
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="set-pw-new" i18n>New password</label>
              <zeus-password-input [control]="pwForm.controls.next" inputId="set-pw-new" autocomplete="new-password"
                [invalid]="!!pwErr('next')" [describedBy]="pwErr('next') ? 'set-pw-new-err set-pw-hints' : 'set-pw-hints'" />
              @if (pwErr('next'); as e) { <p id="set-pw-new-err" class="field-error">{{ e }}</p> }
              @if (newPw()) {
                <zeus-password-strength [password]="newPw()" [avoid]="avoid()" listId="set-pw-hints" />
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="set-pw-confirm" i18n>Repeat new password</label>
              <zeus-password-input [control]="pwForm.controls.confirm" inputId="set-pw-confirm" autocomplete="new-password"
                [invalid]="!!confirmErr()" [describedBy]="confirmErr() ? 'set-pw-confirm-err' : null" />
              @if (confirmErr(); as e) { <p id="set-pw-confirm-err" class="field-error">{{ e }}</p> }
            </div>
            <p class="text-xs text-muted-foreground" i18n>Other devices are signed out when you change it.</p>
            <button hlmBtn type="submit" class="h-11 self-start" [disabled]="pwSaving()">{{ pwSaving() ? txt.saving : txt.changePassword }}</button>
          </form>
        </section>

        <!-- Data & privacy -->
        <section id="set-data" class="panel scroll-mt-20 p-4" aria-labelledby="set-data-h">
          <h2 id="set-data-h" class="label-caps" i18n>Data and privacy</h2>
          <ul class="mt-2 flex flex-col divide-y divide-border">
            <li>
              <a routerLink="/settings/privacy" class="flex min-h-14 items-center gap-3 py-2 hover:text-primary">
                <ng-icon name="lucideShieldCheck" size="18" class="text-muted-foreground" aria-hidden="true" />
                <span class="flex-1"><span class="block font-semibold" i18n>Privacy settings</span><span class="block text-xs text-muted-foreground" i18n>What other players and Game Masters see; location retention</span></span>
                <ng-icon name="lucideChevronRight" size="16" class="text-muted-foreground" aria-hidden="true" />
              </a>
            </li>
            <li>
              <button type="button" class="flex min-h-14 w-full items-center gap-3 py-2 text-left hover:text-primary" [disabled]="exporting()" (click)="exportData()">
                <ng-icon [name]="exporting() ? 'lucideLoader2' : 'lucideDownload'" size="18" class="text-muted-foreground" [class.animate-spin]="exporting()" aria-hidden="true" />
                <span class="flex-1"><span class="block font-semibold">{{ exporting() ? txt.preparingYourData : txt.exportMyData }}</span><span class="block text-xs text-muted-foreground" i18n>Profile, consents, games, captures and location history as a JSON file</span></span>
              </button>
            </li>
            <li>
              <button type="button" class="flex min-h-14 w-full items-center gap-3 py-2 text-left hover:text-primary" (click)="legal().open(terms)">
                <ng-icon name="lucideFileText" size="18" class="text-muted-foreground" aria-hidden="true" />
                <span class="flex-1 font-semibold" i18n>Terms of Service</span>
              </button>
            </li>
            <li>
              <button type="button" class="flex min-h-14 w-full items-center gap-3 py-2 text-left hover:text-primary" (click)="legal().open(privacy)">
                <ng-icon name="lucideFileText" size="18" class="text-muted-foreground" aria-hidden="true" />
                <span class="flex-1 font-semibold" i18n>Privacy Policy</span>
              </button>
            </li>
          </ul>
        </section>

        <button hlmBtn variant="outline" type="button" class="h-12 w-full" [disabled]="loggingOut()" (click)="logout()">
          <ng-icon name="lucideLogOut" size="18" aria-hidden="true" /> {{ loggingOut() ? txt.loggingOut : txt.logOut }}
        </button>

        <!-- Danger zone -->
        <section id="set-danger" class="scroll-mt-20 rounded-md border border-destructive/50 p-4" aria-labelledby="set-danger-h">
          <h2 id="set-danger-h" class="label-caps text-destructive!" i18n>Danger zone</h2>
          <h3 class="mt-2 font-semibold" i18n>Delete account</h3>
          <ul class="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
            <li class="flex gap-2"><span aria-hidden="true" class="text-destructive">▸</span><ng-container i18n>Your profile, email, emergency contact, location history and notifications are deleted.</ng-container></li>
            <li class="flex gap-2"><span aria-hidden="true" class="text-destructive">▸</span><ng-container i18n>You leave every event you joined. Past results keep your points as “Deleted player”.</ng-container></li>
            <li class="flex gap-2"><span aria-hidden="true" class="text-destructive">▸</span><ng-container i18n>This cannot be undone. Export your data first if you want a copy.</ng-container></li>
          </ul>
          <!-- Plain (submit), not (ngSubmit): there is no [formGroup]/NgForm on this form to emit it. -->
          <form class="mt-4 flex flex-col gap-3" (submit)="$event.preventDefault(); deleteAccount()" novalidate>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="set-del-pw" i18n>Your password</label>
              <zeus-password-input [control]="deletePw" inputId="set-del-pw" autocomplete="current-password"
                [invalid]="!!deleteErr()" [describedBy]="deleteErr() ? 'set-del-err' : null" />
              @if (deleteErr(); as e) { <p id="set-del-err" class="field-error" role="alert">{{ e }}</p> }
            </div>
            <button hlmBtn type="submit" variant="destructive" class="h-11 self-start" [disabled]="deleting()">
              <ng-icon name="lucideTrash2" size="16" aria-hidden="true" /> {{ deleting() ? txt.deleting : txt.deleteMyAccount }}
            </button>
          </form>
        </section>
      </div>
    </div>
    <zeus-legal-dialog />
  `,
})
export class SettingsScreen implements OnInit {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    waitingForYourAnswer: $localize`Waiting for your answer…`,
    allowLocation: $localize`Allow location`,
    saving: $localize`Saving…`,
    changePassword: $localize`Change password`,
    preparingYourData: $localize`Preparing your data…`,
    exportMyData: $localize`Export my data`,
    loggingOut: $localize`Logging out…`,
    logOut: $localize`Log out`,
    deleting: $localize`Deleting…`,
    deleteMyAccount: $localize`Delete my account`,
  };

  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly languages = UI_LANGUAGES;
  protected readonly language = activeLanguage();
  protected readonly savingLanguage = signal(false);
  protected readonly push = inject(PushService);
  private readonly api = inject(ApiService);
  private readonly tracker = inject(LocationTracker);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly legal = viewChild.required(LegalDialog);

  protected readonly terms = TERMS;
  protected readonly privacy = PRIVACY;
  protected readonly sections = [
    { id: 'set-appearance', label: $localize`Appearance` },
    { id: 'set-notifications', label: $localize`Notifications` },
    { id: 'set-location', label: $localize`Location` },
    { id: 'set-account', label: $localize`Account` },
    { id: 'set-data', label: $localize`Data` },
    { id: 'set-danger', label: $localize`Delete account` },
  ];
  protected readonly themes: { value: ThemePreference; label: string; icon: string }[] = [
    { value: 'system', label: $localize`System`, icon: 'lucideMonitor' },
    { value: 'light', label: $localize`Light`, icon: 'lucideSun' },
    { value: 'dark', label: $localize`Dark`, icon: 'lucideMoon' },
  ];

  // --- permissions ---
  protected readonly locationState = signal<PermState>('checking');
  protected readonly locBusy = signal(false);
  protected readonly pushBusy = signal(false);
  protected readonly notifState = computed<PermState>(() => {
    const p = this.push.permission();
    if (p === 'unsupported') return 'unsupported';
    return p === 'default' ? 'prompt' : p;
  });

  // --- password ---
  protected readonly pwForm = new FormGroup(
    {
      current: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      next: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(PASSWORD_MIN), Validators.maxLength(200)] }),
      confirm: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: matchValidator('next', 'confirm') },
  );
  protected readonly newPw = toSignal(this.pwForm.controls.next.valueChanges, { initialValue: '' });
  protected readonly avoid = computed(() => [this.auth.user()?.email.split('@')[0] ?? '', this.auth.user()?.nickname ?? '']);
  protected readonly pwSaving = signal(false);

  // --- misc ---
  protected readonly exporting = signal(false);
  protected readonly loggingOut = signal(false);
  protected readonly deletePw = new FormControl('', { nonNullable: true });
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    this.locationState.set(await this.tracker.permissionState());
  }

  protected jump(ev: Event, id: string): void {
    ev.preventDefault();
    const el = this.host.nativeElement.querySelector<HTMLElement>('#' + id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.querySelector<HTMLElement>('h2')?.setAttribute('tabindex', '-1');
    el?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }

  // --- language ---
  /** Saved on the profile (emails, notifications, other devices), then the app reloads in it. */
  protected async setLanguage(lang: UiLanguage): Promise<void> {
    if (lang === this.language) return;
    this.savingLanguage.set(true);
    try {
      this.auth.setUser(await this.api.updateMe({ language: lang }));
      switchLanguage(lang);
    } catch (e) {
      this.toast.error(e);
      this.savingLanguage.set(false);
    }
  }

  // --- notifications ---
  protected async enablePush(): Promise<void> {
    this.pushBusy.set(true);
    try {
      const ok = await this.push.enable();
      const granted = this.push.permission() === 'granted';
      void this.api.recordConsent('notifications', granted).catch(() => undefined);
      if (ok) this.toast.success($localize`Notifications on for this device`);
      else if (granted) this.toast.warning($localize`Allowed, but this device could not be registered`, $localize`Push may not be configured on the server, or the app is not installed. Alerts still show inside the app.`);
    } finally {
      this.pushBusy.set(false);
    }
  }

  protected async disablePush(): Promise<void> {
    const ok = await this.confirm.ask({
      title: $localize`Turn off push notifications?`,
      consequences: [$localize`You will not get alerts with the app closed on this device — including emergency messages from Game Masters.`],
      confirmLabel: $localize`Turn off`,
    });
    if (!ok) return;
    this.pushBusy.set(true);
    try {
      await this.push.disable();
      void this.api.recordConsent('notifications', false).catch(() => undefined);
      this.toast.info($localize`Push notifications off for this device`);
    } finally {
      this.pushBusy.set(false);
    }
  }

  // --- location ---
  protected async allowLocation(): Promise<void> {
    this.locBusy.set(true);
    try {
      const granted = await this.tracker.requestPermission();
      const state = await this.tracker.permissionState();
      this.locationState.set(state === 'prompt' ? (granted ? 'granted' : 'denied') : state);
      void this.api.recordConsent('location', granted).catch(() => undefined);
    } finally {
      this.locBusy.set(false);
    }
  }

  // --- password ---
  protected pwErr(name: 'current' | 'next'): string | null {
    return fieldError(this.pwForm.controls[name], { minlength: $localize`Use at least ${PASSWORD_MIN}:PASSWORD_MIN: characters.` });
  }

  protected confirmErr(): string | null {
    const c = this.pwForm.controls.confirm;
    if (!c.touched) return null;
    if (c.hasError('required')) return $localize`Repeat the new password.`;
    if (this.pwForm.hasError('mismatch')) return $localize`The two passwords do not match.`;
    return null;
  }

  protected async changePassword(): Promise<void> {
    if (this.pwForm.invalid) {
      this.pwForm.markAllAsTouched();
      queueMicrotask(() => focusFirstInvalid(this.host.nativeElement.querySelector<HTMLElement>('#set-account') ?? this.host.nativeElement));
      return;
    }
    this.pwSaving.set(true);
    try {
      const v = this.pwForm.getRawValue();
      await this.auth.changePassword(v.current, v.next);
      // The server rotates the session; the interceptor picks up the new token on the next call.
      this.pwForm.reset();
      this.toast.success($localize`Password changed`, $localize`Other devices were signed out.`);
    } catch (e) {
      const err = ApiError.from(e);
      const unmatched = applyServerErrors(this.pwForm, err, { currentPassword: 'current', newPassword: 'next' });
      if (!Object.keys(err.fields).length || unmatched.length) this.toast.error(unmatched[0] ?? err);
    } finally {
      this.pwSaving.set(false);
    }
  }

  // --- data ---
  protected async exportData(): Promise<void> {
    this.exporting.set(true);
    try {
      const blob = await this.api.exportMyData();
      downloadBlob(blob, 'airsofthub-data.json');
      this.toast.success($localize`Download started`, 'airsofthub-data.json');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.exporting.set(false);
    }
  }

  protected async logout(): Promise<void> {
    this.loggingOut.set(true);
    await this.auth.logout();
    this.loggingOut.set(false);
  }

  // --- delete ---
  protected deleteErr(): string | null {
    return this.deleteError();
  }

  protected async deleteAccount(): Promise<void> {
    this.deleteError.set(null);
    const password = this.deletePw.value;
    if (!password) {
      this.deleteError.set($localize`Enter your password to confirm it is you.`);
      queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>('#set-del-pw')?.focus());
      return;
    }
    const ok = await this.confirm.ask({
      title: $localize`Delete your account?`,
      message: $localize`This is permanent.`,
      consequences: [
        $localize`Your profile, email, emergency contact, location history and notifications are deleted.`,
        $localize`You leave all events you joined; past results show “Deleted player”.`,
        $localize`You will be signed out on every device.`,
      ],
      confirmLabel: $localize`Delete account`,
      destructive: true,
      requireText: $localize`:typed confirmation word|:DELETE`,
    });
    if (!ok) return;
    this.deleting.set(true);
    try {
      await this.api.deleteAccount(password);
      this.auth.clear();
      this.toast.info($localize`Your account was deleted`);
      await this.router.navigateByUrl('/welcome');
    } catch (e) {
      const err = ApiError.from(e);
      this.deleteError.set(err.fields['password'] ? $localize`The password is wrong.` : err.message);
    } finally {
      this.deleting.set(false);
    }
  }
}
