import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { merge } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { ConfigService } from '../../core/api/config.service';
import { Club, MeUser, PlayerRole, UpdateProfileRequest } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';
import { PLAYER_ROLE_LABELS } from '../../core/util/format';
import { PageHeader } from '../../shared/states';
import { applyServerErrors, fieldError, focusFirstInvalid } from '../auth/form-utils';
import { NICKNAME_FORMAT_HELP, NICKNAME_PATTERN, NicknameStatusLine, createNicknameCheck } from '../auth/nickname-check';
import { SwitchRow } from '../settings/switch-row';
import { COMMON_COUNTRIES, LANGUAGES, countryOptions } from './countries';
import { Avatar } from './profile-ui';

const OTHER = '__other';
const BIO_MAX = 280;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHONE_PATTERN = /^\+?[0-9 ()./-]{6,20}$/;

/** Server field name → control name. */
const FIELD_ALIASES: Record<string, string> = {
  'emergencyContact.name': 'ecName',
  'emergencyContact.phone': 'ecPhone',
  'emergencyContact.relation': 'ecRelation',
  'privacy.shareEmergencyWithGm': 'shareEmergencyWithGm',
};

function pastDateValidator(ctrl: FormControl<string>) {
  const v = ctrl.value;
  if (!v) return null;
  const d = new Date(v + 'T00:00:00');
  if (isNaN(d.getTime())) return { date: true };
  if (d.getTime() > Date.now()) return { future: true };
  if (d.getFullYear() < 1900) return { date: true };
  return null;
}

@Component({
  selector: 'zeus-edit-profile-screen',
  imports: [ReactiveFormsModule, RouterLink, NgIcon, HlmButton, HlmInput, HlmLabel, HlmTextarea, PageHeader, Avatar, NicknameStatusLine, SwitchRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      <zeus-page-header title="Edit profile" back="/profile" backLabel="Profile" />

      <!-- Photo -->
      <section class="panel flex flex-wrap items-center gap-4 p-4" aria-labelledby="ep-photo">
        <div class="relative">
          <zeus-avatar [url]="previewUrl() ?? user()?.avatarUrl" [nickname]="user()?.nickname" [size]="80" alt="Your profile photo" />
          @if (uploading()) {
            <span class="absolute inset-0 grid place-items-center rounded-full bg-background/70" role="status" aria-label="Uploading photo">
              <ng-icon name="lucideLoader2" size="22" class="animate-spin" aria-hidden="true" />
            </span>
          }
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <h2 id="ep-photo" class="label-caps">Profile photo</h2>
          <div class="flex flex-wrap gap-2">
            <button hlmBtn variant="outline" type="button" class="h-11" [disabled]="uploading()" (click)="fileInput.click()">
              <ng-icon name="lucideUpload" size="16" aria-hidden="true" /> {{ user()?.avatarUrl ? 'Change photo' : 'Upload photo' }}
            </button>
            @if (user()?.avatarUrl && !uploading()) {
              <button hlmBtn variant="ghost" type="button" class="h-11" (click)="removeAvatar()">Remove</button>
            }
          </div>
          <input #fileInput type="file" class="sr-only" accept="image/jpeg,image/png,image/webp" tabindex="-1" aria-hidden="true" (change)="onFile($event)" />
          <p class="text-xs" [class.text-destructive]="photoError()" [class.text-muted-foreground]="!photoError()" aria-live="polite">
            {{ photoError() ?? 'JPG, PNG or WebP, up to ' + maxUploadLabel() + '. Shown to other players.' }}
          </p>
        </div>
      </section>

      <!-- Nickname -->
      <section class="panel mt-4 p-4" aria-labelledby="ep-nick">
        <h2 id="ep-nick" class="label-caps">Nickname · public</h2>
        <div class="mt-3 flex flex-col gap-1.5">
          <label hlmLabel for="ep-nickname">Nickname</label>
          <div class="flex gap-2">
            <input hlmInput id="ep-nickname" class="h-11" [formControl]="nickname" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="24"
              [attr.aria-invalid]="!!nicknameError() || nick.status() === 'taken'" aria-describedby="ep-nickname-help ep-nickname-status" />
            <button hlmBtn type="button" class="h-11 shrink-0" [disabled]="!canSaveNickname() || savingNickname()" (click)="saveNickname()">
              {{ savingNickname() ? 'Saving…' : 'Save' }}
            </button>
          </div>
          <p id="ep-nickname-help" class="text-xs text-muted-foreground">Shown on the map, in teams and results. {{ formatHelp }}</p>
          @if (nicknameError(); as e) {
            <p id="ep-nickname-status" class="field-error">{{ e }}</p>
          } @else {
            <zeus-nickname-status id="ep-nickname-status" [status]="nick.status()" [reason]="nick.reason()" />
          }
        </div>
      </section>

      <form [formGroup]="form" (ngSubmit)="save()" novalidate class="mt-4 flex flex-col gap-4">
        @if (formError()) {
          <p class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">{{ formError() }}</p>
        }

        <!-- Personal -->
        <section class="panel flex flex-col gap-4 p-4" aria-labelledby="ep-personal">
          <div>
            <h2 id="ep-personal" class="label-caps flex items-center gap-1"><ng-icon name="lucideLock" size="12" aria-hidden="true" /> Personal details · private</h2>
            <p class="mt-1 text-xs text-muted-foreground">Never shown to other players or Game Masters.</p>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="ep-first">First name</label>
              <input hlmInput id="ep-first" class="h-11" formControlName="firstName" autocomplete="given-name" maxlength="60" [attr.aria-invalid]="!!err('firstName')" />
              @if (err('firstName'); as e) { <p class="field-error">{{ e }}</p> }
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="ep-last">Last name</label>
              <input hlmInput id="ep-last" class="h-11" formControlName="lastName" autocomplete="family-name" maxlength="60" [attr.aria-invalid]="!!err('lastName')" />
              @if (err('lastName'); as e) { <p class="field-error">{{ e }}</p> }
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="ep-dob">Date of birth <span class="font-normal text-muted-foreground">(optional)</span></label>
              <input hlmInput id="ep-dob" type="date" class="h-11" formControlName="dateOfBirth" autocomplete="bday" [max]="today"
                [attr.aria-invalid]="!!err('dateOfBirth')" [attr.aria-describedby]="err('dateOfBirth') ? 'ep-dob-err' : null" />
              @if (err('dateOfBirth'); as e) { <p id="ep-dob-err" class="field-error">{{ e }}</p> }
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="ep-lang">Language for emails and notifications</label>
              <select id="ep-lang" formControlName="language" class="h-11 w-full rounded-md border border-input bg-transparent px-2.5 dark:bg-input/30">
                @for (l of languages; track l.code) {
                  <option [value]="l.code">{{ l.name }}</option>
                }
              </select>
            </div>
          </div>
        </section>

        <!-- Player -->
        <section class="panel flex flex-col gap-4 p-4" aria-labelledby="ep-player">
          <div>
            <h2 id="ep-player" class="label-caps">Player details</h2>
            <p class="mt-1 text-xs text-muted-foreground">Visible to others if you allow it in <a routerLink="/settings/privacy" class="font-semibold text-primary underline-offset-2 hover:underline">Privacy settings</a>.</p>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="ep-country">Country</label>
              <select id="ep-country" formControlName="country" class="h-11 w-full rounded-md border border-input bg-transparent px-2.5 dark:bg-input/30">
                <option value="">Not set</option>
                @for (c of countries; track c.code) {
                  <option [value]="c.code">{{ c.name }}</option>
                }
                <option [value]="other">Other…</option>
              </select>
            </div>
            @if (form.controls.country.value === other) {
              <div class="flex flex-col gap-1.5">
                <label hlmLabel for="ep-country-other">Country name</label>
                <input hlmInput id="ep-country-other" class="h-11" formControlName="countryOther" autocomplete="country-name" maxlength="60" [attr.aria-invalid]="!!err('countryOther')" />
                @if (err('countryOther'); as e) { <p class="field-error">{{ e }}</p> }
              </div>
            }
          </div>

          <!-- Club -->
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="ep-club">Club or team</label>
            <div class="relative">
              <input hlmInput id="ep-club" class="h-11 pr-10" formControlName="clubName" autocomplete="off" maxlength="80" placeholder="Search clubs or type a name"
                role="combobox" [attr.aria-expanded]="clubResults().length > 0" aria-controls="ep-club-results" aria-autocomplete="list" aria-describedby="ep-club-help" />
              @if (searchingClubs()) {
                <ng-icon name="lucideLoader2" size="16" class="absolute top-3.5 right-3 animate-spin text-muted-foreground" aria-hidden="true" />
              } @else {
                <ng-icon name="lucideSearch" size="16" class="absolute top-3.5 right-3 text-muted-foreground" aria-hidden="true" />
              }
            </div>
            @if (clubResults().length) {
              <ul id="ep-club-results" class="panel max-h-60 divide-y divide-border overflow-y-auto" role="listbox" aria-label="Matching clubs">
                @for (c of clubResults(); track c.id) {
                  <li role="option" [attr.aria-selected]="form.controls.clubId.value === c.id">
                    <button type="button" class="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60" (click)="pickClub(c)">
                      @if (c.logoUrl) {
                        <img [src]="c.logoUrl" alt="" class="size-8 rounded-sm object-cover" />
                      } @else {
                        <span class="grid size-8 place-items-center rounded-sm bg-muted" aria-hidden="true"><ng-icon name="lucideShield" size="16" /></span>
                      }
                      <span class="min-w-0 flex-1">
                        <span class="block truncate font-semibold">{{ c.name }}</span>
                        <span class="block truncate text-xs text-muted-foreground">{{ clubPlace(c) }} · <span class="num">{{ c.memberCount }}</span> members</span>
                      </span>
                    </button>
                  </li>
                }
              </ul>
            }
            <p id="ep-club-help" class="text-xs text-muted-foreground" aria-live="polite">
              @if (form.controls.clubId.value) {
                <span class="text-primary">✓ Linked to a club page.</span>
                <a [routerLink]="['/clubs', form.controls.clubId.value]" class="font-semibold text-primary underline-offset-2 hover:underline">View</a> ·
                <button type="button" class="font-semibold underline-offset-2 hover:underline" (click)="unlinkClub()">Unlink</button>
              } @else if (form.controls.clubName.value.trim()) {
                Not linked: saved as plain text. Pick a club from the list to link it, or
                <a routerLink="/clubs/new" class="font-semibold text-primary underline-offset-2 hover:underline">create a club</a>.
              } @else {
                Search existing clubs, type a name, or <a routerLink="/clubs/new" class="font-semibold text-primary underline-offset-2 hover:underline">create a club</a>.
              }
            </p>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="ep-role">Usual role</label>
              <select id="ep-role" formControlName="playerRole" class="h-11 w-full rounded-md border border-input bg-transparent px-2.5 dark:bg-input/30">
                @for (r of roles; track r.value) {
                  <option [value]="r.value">{{ r.label }}</option>
                }
              </select>
            </div>
            @if (form.controls.playerRole.value === 'custom') {
              <div class="flex flex-col gap-1.5">
                <label hlmLabel for="ep-custom-role">Role name</label>
                <input hlmInput id="ep-custom-role" class="h-11" formControlName="customRole" maxlength="40" placeholder="e.g. Designated marksman"
                  [attr.aria-invalid]="!!err('customRole')" />
                @if (err('customRole'); as e) { <p class="field-error">{{ e }}</p> }
              </div>
            }
          </div>

          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="ep-bio">Bio</label>
            <textarea hlmTextarea id="ep-bio" formControlName="bio" rows="3" [attr.maxlength]="bioMax" placeholder="Loadout, play style, how long you have been playing"
              [attr.aria-invalid]="!!err('bio')" aria-describedby="ep-bio-count"></textarea>
            <p id="ep-bio-count" class="flex justify-between text-xs" [class.text-destructive]="bioLength() > bioMax" [class.text-muted-foreground]="bioLength() <= bioMax">
              <span>{{ err('bio') ?? '' }}</span>
              <span class="num">{{ bioLength() }}/{{ bioMax }}</span>
            </p>
          </div>
        </section>

        <!-- Emergency contact -->
        <section class="panel flex flex-col gap-4 p-4" aria-labelledby="ep-ec">
          <div>
            <h2 id="ep-ec" class="label-caps flex items-center gap-1"><ng-icon name="lucideHeartPulse" size="12" aria-hidden="true" /> Emergency contact · optional</h2>
            <p class="mt-1 text-xs text-muted-foreground">Someone to call if you get hurt during a game. Never shown to other players.</p>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="ep-ec-name">Name</label>
              <input hlmInput id="ep-ec-name" class="h-11" formControlName="ecName" autocomplete="off" maxlength="80" [attr.aria-invalid]="!!err('ecName')" />
              @if (err('ecName'); as e) { <p class="field-error">{{ e }}</p> }
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="ep-ec-phone">Phone</label>
              <input hlmInput id="ep-ec-phone" type="tel" class="h-11" formControlName="ecPhone" autocomplete="off" inputmode="tel" maxlength="20" placeholder="+39 333 123 4567"
                [attr.aria-invalid]="!!err('ecPhone')" />
              @if (err('ecPhone'); as e) { <p class="field-error">{{ e }}</p> }
            </div>
            <div class="flex flex-col gap-1.5 sm:col-span-2">
              <label hlmLabel for="ep-ec-rel">Relation</label>
              <input hlmInput id="ep-ec-rel" class="h-11" formControlName="ecRelation" autocomplete="off" maxlength="40" placeholder="e.g. Partner, parent, friend" />
            </div>
          </div>
          <div class="border-t border-border">
            <zeus-switch-row formControlName="shareEmergencyWithGm" label="Share with Game Masters of events I join"
              description="Only the Game Masters of events you are registered for can see it, so they can call this person if you are injured. Turn it off at any time." />
            @if (form.controls.shareEmergencyWithGm.value && !hasEmergencyContact()) {
              <p class="text-xs text-warning">Add a name and phone above — there is nothing to share yet.</p>
            }
          </div>
        </section>

        <div class="sticky bottom-[calc(4rem+var(--safe-bottom))] z-10 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:bottom-0 sm:mx-0 sm:rounded-md sm:border">
          <span class="text-sm text-muted-foreground" aria-live="polite">{{ dirty() ? 'Unsaved changes' : 'All changes saved' }}</span>
          <div class="flex gap-2">
            <a hlmBtn variant="ghost" routerLink="/profile" class="h-11">Cancel</a>
            <button hlmBtn type="submit" class="h-11 min-w-28" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save changes' }}</button>
          </div>
        </div>
      </form>
    </div>
  `,
})
export class EditProfileScreen {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly config = inject(ConfigService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly user = this.auth.user;
  protected readonly other = OTHER;
  protected readonly bioMax = BIO_MAX;
  protected readonly formatHelp = NICKNAME_FORMAT_HELP;
  protected readonly today = new Date().toISOString().slice(0, 10);
  protected readonly languages = LANGUAGES;
  protected readonly countries = countryOptions();
  protected readonly roles = (Object.keys(PLAYER_ROLE_LABELS) as PlayerRole[]).map((value) => ({ value, label: PLAYER_ROLE_LABELS[value] }));

  // --- nickname (separate save) ---
  protected readonly nickname = new FormControl(this.user()?.nickname ?? '', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(NICKNAME_PATTERN)],
  });
  protected readonly nick = createNicknameCheck(this.nickname, () => this.user()?.nickname ?? null);
  protected readonly savingNickname = signal(false);

  // --- profile form ---
  protected readonly form = new FormGroup({
    firstName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
    lastName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
    dateOfBirth: new FormControl('', { nonNullable: true, validators: [pastDateValidator] }),
    language: new FormControl('en', { nonNullable: true }),
    country: new FormControl('', { nonNullable: true }),
    countryOther: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
    clubName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
    clubId: new FormControl<string | null>(null),
    playerRole: new FormControl<PlayerRole>('rifleman', { nonNullable: true }),
    customRole: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    bio: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(BIO_MAX)] }),
    ecName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
    ecPhone: new FormControl('', { nonNullable: true, validators: [Validators.pattern(PHONE_PATTERN)] }),
    ecRelation: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    shareEmergencyWithGm: new FormControl(false, { nonNullable: true }),
  });

  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  protected readonly bioLength = computed(() => (this.formValue().bio ?? '').length);
  protected readonly hasEmergencyContact = computed(() => !!(this.formValue().ecName?.trim() && this.formValue().ecPhone?.trim()));
  private readonly pristineTick = signal(0);
  protected readonly dirty = computed(() => {
    this.formValue();
    this.pristineTick();
    return this.form.dirty;
  });

  // --- avatar ---
  protected readonly uploading = signal(false);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly photoError = signal<string | null>(null);
  protected readonly maxUploadLabel = computed(() => `${Math.round(this.config.config().maxUploadBytes / (1024 * 1024))} MB`);

  // --- club search ---
  protected readonly clubResults = signal<Club[]>([]);
  protected readonly searchingClubs = signal(false);
  private clubTimer: ReturnType<typeof setTimeout> | null = null;
  private clubSeq = 0;

  constructor() {
    const u = this.user();
    if (u) this.fill(u);

    // Emergency contact: name and phone become required once any field is filled.
    const ec = [this.form.controls.ecName, this.form.controls.ecPhone, this.form.controls.ecRelation];
    merge(...ec.map((c) => c.valueChanges))
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.syncEmergencyValidators());
    this.syncEmergencyValidators();

    // Custom role name is required for the 'custom' role.
    this.form.controls.playerRole.valueChanges.pipe(takeUntilDestroyed()).subscribe((r) => {
      const c = this.form.controls.customRole;
      if (r === 'custom') c.addValidators(Validators.required);
      else c.removeValidators(Validators.required);
      c.updateValueAndValidity();
    });

    this.form.controls.country.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      const c = this.form.controls.countryOther;
      if (v === OTHER) c.addValidators(Validators.required);
      else c.removeValidators(Validators.required);
      c.updateValueAndValidity();
    });

    // Typing in the club field unlinks the club and searches.
    this.form.controls.clubName.valueChanges.pipe(takeUntilDestroyed()).subscribe((q) => {
      if (this.form.controls.clubId.value) this.form.controls.clubId.setValue(null);
      this.searchClubs(q);
    });

    this.destroyRef.onDestroy(() => {
      if (this.clubTimer) clearTimeout(this.clubTimer);
      const p = this.previewUrl();
      if (p) URL.revokeObjectURL(p);
    });
  }

  private fill(u: MeUser): void {
    const known = u.country && (COMMON_COUNTRIES as readonly string[]).includes(u.country.toUpperCase());
    this.form.reset(
      {
        firstName: u.firstName ?? '',
        lastName: u.lastName ?? '',
        dateOfBirth: u.dateOfBirth ?? '',
        language: LANGUAGES.some((l) => l.code === u.language) ? u.language : 'en',
        country: !u.country ? '' : known ? u.country.toUpperCase() : OTHER,
        countryOther: u.country && !known ? u.country : '',
        clubName: u.clubName ?? '',
        clubId: u.clubId,
        playerRole: u.playerRole,
        customRole: u.customRole ?? '',
        bio: u.bio ?? '',
        ecName: u.emergencyContact?.name ?? '',
        ecPhone: u.emergencyContact?.phone ?? '',
        ecRelation: u.emergencyContact?.relation ?? '',
        shareEmergencyWithGm: u.privacy.shareEmergencyWithGm,
      },
      { emitEvent: false },
    );
    if (u.playerRole === 'custom') this.form.controls.customRole.addValidators(Validators.required);
    if (this.form.controls.country.value === OTHER) this.form.controls.countryOther.addValidators(Validators.required);
    this.form.updateValueAndValidity();
    this.pristineTick.update((n) => n + 1);
  }

  private syncEmergencyValidators(): void {
    const { ecName, ecPhone, ecRelation } = this.form.controls;
    const any = [ecName, ecPhone, ecRelation].some((c) => c.value.trim());
    for (const c of [ecName, ecPhone]) {
      if (any) c.addValidators(Validators.required);
      else c.removeValidators(Validators.required);
      c.updateValueAndValidity({ emitEvent: false });
    }
  }

  protected err(name: keyof EditProfileScreen['form']['controls']): string | null {
    return fieldError(this.form.controls[name], {
      future: 'The date cannot be in the future.',
      date: 'Enter a valid date.',
      pattern: name === 'ecPhone' ? 'Enter a phone number with digits, spaces and an optional + prefix.' : 'The format is not valid.',
      required:
        name === 'ecName' || name === 'ecPhone'
          ? 'Needed for an emergency contact. Clear all three fields to remove it.'
          : name === 'customRole'
            ? 'Name your role.'
            : 'Required.',
    });
  }

  protected nicknameError(): string | null {
    return fieldError(this.nickname, { pattern: NICKNAME_FORMAT_HELP });
  }

  protected canSaveNickname(): boolean {
    return this.nickname.valid && (this.nick.status() === 'available' || this.nick.status() === 'error');
  }

  protected async saveNickname(): Promise<void> {
    if (!this.canSaveNickname()) return;
    this.savingNickname.set(true);
    try {
      const user = await this.api.changeNickname(this.nickname.value.trim());
      this.auth.setUser(user);
      this.nick.status.set('unchanged');
      this.toast.success('Nickname changed', `Other players now see you as ${user.nickname}.`);
    } catch (e) {
      const err = ApiError.from(e);
      this.nickname.setErrors({ server: err.fields['nickname'] ?? err.message });
      this.nickname.markAsTouched();
      this.nick.status.set('empty');
    } finally {
      this.savingNickname.set(false);
    }
  }

  // --- avatar ---
  protected async onFile(ev: Event): Promise<void> {
    const inputEl = ev.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;
    this.photoError.set(null);
    if (!IMAGE_TYPES.includes(file.type)) {
      this.photoError.set('Use a JPG, PNG or WebP image.');
      return;
    }
    const max = this.config.config().maxUploadBytes;
    if (file.size > max) {
      this.photoError.set(`This image is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${this.maxUploadLabel()}.`);
      return;
    }
    const old = this.previewUrl();
    if (old) URL.revokeObjectURL(old);
    this.previewUrl.set(URL.createObjectURL(file));
    this.uploading.set(true);
    try {
      const { url } = await this.api.upload(file, 'avatar');
      const user = await this.api.updateMe({ avatarUrl: url });
      this.auth.setUser(user);
      this.toast.success('Photo updated');
    } catch (e) {
      this.photoError.set(ApiError.from(e).message);
    } finally {
      this.uploading.set(false);
      const p = this.previewUrl();
      if (p) URL.revokeObjectURL(p);
      this.previewUrl.set(null);
    }
  }

  protected async removeAvatar(): Promise<void> {
    this.uploading.set(true);
    try {
      this.auth.setUser(await this.api.updateMe({ avatarUrl: null }));
      this.toast.info('Photo removed');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.uploading.set(false);
    }
  }

  // --- club ---
  private searchClubs(raw: string): void {
    if (this.clubTimer) clearTimeout(this.clubTimer);
    const q = raw.trim();
    const mine = ++this.clubSeq;
    if (q.length < 2) {
      this.clubResults.set([]);
      this.searchingClubs.set(false);
      return;
    }
    this.searchingClubs.set(true);
    this.clubTimer = setTimeout(async () => {
      try {
        const res = await this.api.clubs(q);
        if (mine === this.clubSeq) this.clubResults.set(res.slice(0, 8));
      } catch {
        if (mine === this.clubSeq) this.clubResults.set([]);
      } finally {
        if (mine === this.clubSeq) this.searchingClubs.set(false);
      }
    }, 300);
  }

  protected pickClub(c: Club): void {
    this.form.controls.clubName.setValue(c.name, { emitEvent: false });
    this.form.controls.clubId.setValue(c.id);
    this.form.markAsDirty();
    this.clubSeq++;
    this.clubResults.set([]);
  }

  protected unlinkClub(): void {
    this.form.controls.clubId.setValue(null);
    this.form.markAsDirty();
  }

  protected clubPlace(c: Club): string {
    return [c.city, c.country].filter(Boolean).join(', ') || 'Club';
  }

  // --- save ---
  protected async save(): Promise<void> {
    this.formError.set(null);
    this.syncEmergencyValidators();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set('Check the highlighted fields.');
      queueMicrotask(() => focusFirstInvalid(this.host.nativeElement));
      return;
    }
    const v = this.form.getRawValue();
    const hasContact = !!(v.ecName.trim() && v.ecPhone.trim());
    const body: UpdateProfileRequest = {
      firstName: v.firstName.trim() || null,
      lastName: v.lastName.trim() || null,
      dateOfBirth: v.dateOfBirth || null,
      language: v.language,
      country: v.country === OTHER ? v.countryOther.trim() || null : v.country || null,
      clubId: v.clubId,
      clubName: v.clubName.trim() || null,
      playerRole: v.playerRole,
      customRole: v.playerRole === 'custom' ? v.customRole.trim() : null,
      bio: v.bio.trim() || null,
      emergencyContact: hasContact ? { name: v.ecName.trim(), phone: v.ecPhone.trim(), relation: v.ecRelation.trim() } : null,
      privacy: { shareEmergencyWithGm: v.shareEmergencyWithGm },
    };
    // Adding a contact turns the feature on; removing it turns it off.
    const current = this.user();
    if (hasContact && !current?.emergencyContactEnabled) body.emergencyContactEnabled = true;
    if (!hasContact && current?.emergencyContactEnabled) body.emergencyContactEnabled = false;

    this.saving.set(true);
    try {
      const user = await this.api.updateMe(body);
      this.auth.setUser(user);
      this.fill(user);
      this.toast.success('Profile saved');
      await this.router.navigateByUrl('/profile');
    } catch (e) {
      const err = ApiError.from(e);
      const unmatched = applyServerErrors(this.form, err, FIELD_ALIASES);
      this.formError.set(Object.keys(err.fields).length ? (unmatched[0] ?? 'Check the highlighted fields.') : err.message);
      queueMicrotask(() => focusFirstInvalid(this.host.nativeElement));
    } finally {
      this.saving.set(false);
    }
  }
}
