import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { AdminUserDetail, AdminUserFeature, Feature, MemberStatus } from '../../core/api/models';
import { UI_LANGUAGES } from '../../core/i18n/language';
import { FEATURE_HINTS, FEATURE_LABELS, PLAYER_ROLE_LABELS, formatDate, formatNumber, formatRelative } from '../../core/util/format';
import { ToastService } from '../../core/ui/toast.service';
import { StatusChip, eventStatusChip } from '../../shared/status-chip';
import { ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { countryName } from '../profile/countries';
import { Avatar, StatTiles } from '../profile/profile-ui';
import { SwitchRow } from '../settings/switch-row';

const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  invited: $localize`:member status|:Invited`,
  pending: $localize`:member status|:Waiting for approval`,
  approved: $localize`:member status|:Approved`,
  rejected: $localize`:member status|:Rejected`,
  removed: $localize`:member status|:Removed`,
  banned: $localize`:member status|:Banned`,
  left: $localize`:member status|:Left`,
};

const FEATURES = Object.keys(FEATURE_LABELS) as Feature[];

/**
 * One account for the platform admins: profile, activity and the features this user can use
 * (switched on or off here, saved at once). Route: /admin/users/:userId, behind adminGuard.
 */
@Component({
  selector: 'zeus-admin-user-screen',
  imports: [ReactiveFormsModule, RouterLink, NgIcon, HlmButton, PageHeader, LoadingSkeleton, ErrorState, StatusChip, Avatar, StatTiles, SwitchRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      <zeus-page-header eyebrow="Admin" [title]="user()?.nickname ?? txt.user" back="/admin/users" backLabel="All users" i18n-eyebrow i18n-backLabel>
        @if (user(); as u) {
          <a hlmBtn variant="outline" class="h-11" [routerLink]="['/players', u.id]">
            <ng-icon name="lucideUser" size="16" aria-hidden="true" /> <ng-container i18n>Public profile</ng-container>
          </a>
        }
      </zeus-page-header>

      @if (loading()) {
        <zeus-loading-skeleton [rows]="6" [avatar]="true" />
      } @else if (!user()) {
        <zeus-error-state [error]="error()" (retry)="load()" />
      } @else if (user(); as u) {
        <section class="panel flex flex-col gap-4 p-4" aria-label="Account" i18n-aria-label>
          <div class="flex items-center gap-3">
            <zeus-avatar [url]="u.avatarUrl" [nickname]="u.nickname" [size]="64" />
            <div class="min-w-0 flex-1">
              @if (fullName()) {
                <p class="truncate font-semibold">{{ fullName() }}</p>
              }
              <a [href]="'mailto:' + u.email" class="block truncate text-sm text-primary underline-offset-2 hover:underline">{{ u.email }}</a>
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                @if (u.isAdmin) {
                  <zeus-status-chip [label]="txt.admin" glyph="★" tone="primary" />
                }
                @if (u.customAccess) {
                  <zeus-status-chip [label]="txt.customAccess" glyph="◆" tone="nav" />
                }
                @if (u.emailVerified) {
                  <zeus-status-chip [label]="txt.emailVerified" glyph="✓" />
                } @else {
                  <zeus-status-chip [label]="txt.notVerified" glyph="!" tone="warning" />
                }
                @if (!u.termsAccepted) {
                  <zeus-status-chip [label]="txt.termsNotAccepted" glyph="!" tone="warning" />
                }
              </div>
            </div>
          </div>

          <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt class="label-caps" i18n>Joined</dt>
              <dd>{{ date(u.createdAt) }}</dd>
            </div>
            <div>
              <dt class="label-caps" i18n>Last active</dt>
              <dd>{{ u.lastActiveAt ? relative(u.lastActiveAt) : txt.never }}</dd>
            </div>
            <div>
              <dt class="label-caps" i18n>Language</dt>
              <dd>{{ language() }}</dd>
            </div>
            <div>
              <dt class="label-caps" i18n>Country</dt>
              <dd>{{ country() ?? '—' }}</dd>
            </div>
            <div>
              <dt class="label-caps" i18n>Club</dt>
              <dd class="truncate">
                @if (u.clubId) {
                  <a [routerLink]="['/clubs', u.clubId]" class="font-semibold text-primary underline-offset-2 hover:underline">{{ u.clubName }}</a>
                } @else {
                  {{ u.clubName ?? '—' }}
                }
              </dd>
            </div>
            <div>
              <dt class="label-caps" i18n>Role</dt>
              <dd>{{ role() }}</dd>
            </div>
          </dl>
        </section>

        <dl class="mt-4 grid grid-cols-3 gap-2" aria-label="Activity" i18n-aria-label>
          @for (c of counts(); track c.label) {
            <div class="panel flex flex-col gap-1 p-3">
              <dt class="label-caps flex items-center gap-1.5"><ng-icon [name]="c.icon" size="13" aria-hidden="true" />{{ c.label }}</dt>
              <dd class="num text-2xl font-bold">{{ c.value }}</dd>
            </div>
          }
        </dl>

        <section class="mt-8" aria-labelledby="au-features">
          <h2 id="au-features" class="label-caps mb-1" i18n>Features</h2>
          <p class="mb-3 text-sm text-muted-foreground" i18n>
            What this user can use in the app. Changes are saved at once; the server applies them on the user's next action and their app updates within a few minutes.
          </p>
          @if (u.isAdmin) {
            <p class="mb-3 flex items-start gap-2 rounded-md border border-border bg-muted p-3 text-sm">
              <ng-icon name="lucideLock" size="16" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span i18n>Platform admins always have every feature. Admins are set with ADMIN_EMAILS on the server.</span>
            </p>
          }
          <ul class="panel divide-y divide-border px-4">
            @for (f of u.features; track f.key) {
              <li class="pb-3">
                <zeus-switch-row [label]="labels[f.key]" [description]="hints[f.key]" [formControl]="controls[f.key]" />
                @if (!u.isAdmin) {
                  <p class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    @if (f.custom) {
                      <zeus-status-chip [label]="txt.customForUser" glyph="◆" tone="nav" />
                      <button type="button" class="tap font-semibold text-primary underline-offset-2 hover:underline" [disabled]="saving() === f.key" (click)="reset(f)">
                        {{ f.default ? txt.resetToDefaultOn : txt.resetToDefaultOff }}
                      </button>
                    } @else {
                      <span>{{ f.default ? txt.defaultOn : txt.defaultOff }}</span>
                    }
                  </p>
                }
              </li>
            }
          </ul>
        </section>

        <section class="mt-8" aria-labelledby="au-events">
          <h2 id="au-events" class="label-caps mb-2" i18n>Latest events</h2>
          @if (u.recentEvents.length) {
            <ul class="panel divide-y divide-border">
              @for (e of u.recentEvents; track e.id) {
                <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-semibold">{{ e.name }}</span>
                    <span class="block text-xs text-muted-foreground">{{ date(e.startAt) }} · {{ e.role === 'gm' ? txt.gameMaster : txt.player }} · {{ memberStatus[e.memberStatus] }}</span>
                  </span>
                  <zeus-status-chip [spec]="statusChip(e.status)" />
                </li>
              }
            </ul>
          } @else {
            <p class="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground" i18n>No events yet.</p>
          }
        </section>

        <section class="mt-8" aria-labelledby="au-stats">
          <h2 id="au-stats" class="label-caps mb-2" i18n>Statistics</h2>
          <zeus-stat-tiles [stats]="u.stats" />
        </section>
      }
    </div>
  `,
})
export class AdminUserScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    user: $localize`User`,
    admin: $localize`Admin`,
    customAccess: $localize`Custom access`,
    customForUser: $localize`Set for this user`,
    emailVerified: $localize`Email verified`,
    notVerified: $localize`Not verified`,
    termsNotAccepted: $localize`Terms not accepted`,
    never: $localize`Never`,
    defaultOn: $localize`Default for everyone: on`,
    defaultOff: $localize`Default for everyone: off`,
    resetToDefaultOn: $localize`Back to the default (on)`,
    resetToDefaultOff: $localize`Back to the default (off)`,
    gameMaster: $localize`Game Master`,
    player: $localize`Player`,
  };

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly userId = input.required<string>();

  protected readonly user = signal<AdminUserDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<unknown>(null);
  /** Feature being saved. */
  protected readonly saving = signal<Feature | null>(null);

  protected readonly labels = FEATURE_LABELS;
  protected readonly hints = FEATURE_HINTS;
  protected readonly memberStatus = MEMBER_STATUS_LABELS;
  protected readonly date = formatDate;
  protected readonly relative = formatRelative;
  protected readonly statusChip = eventStatusChip;

  /** One switch per feature; a change is saved straight away. */
  protected readonly controls = Object.fromEntries(FEATURES.map((k) => [k, new FormControl(false, { nonNullable: true })])) as Record<Feature, FormControl<boolean>>;

  protected readonly fullName = computed(() => {
    const u = this.user();
    return [u?.firstName, u?.lastName].filter(Boolean).join(' ');
  });
  protected readonly language = computed(() => {
    const code = this.user()?.language;
    return UI_LANGUAGES.find((l) => l.code === code)?.name ?? code ?? '—';
  });
  protected readonly country = computed(() => countryName(this.user()?.country));
  protected readonly role = computed(() => {
    const role = this.user()?.playerRole;
    return role ? PLAYER_ROLE_LABELS[role] : '—';
  });
  protected readonly counts = computed(() => {
    const c = this.user()?.counts;
    return [
      { label: $localize`Events played`, value: formatNumber(c?.eventsPlayed), icon: 'lucideCrosshair' },
      { label: $localize`Events run`, value: formatNumber(c?.eventsRun), icon: 'lucideLayoutDashboard' },
      { label: $localize`Support`, value: formatNumber(c?.supportTickets), icon: 'lucideLifeBuoy' },
    ];
  });

  constructor() {
    effect(() => {
      this.userId();
      untracked(() => void this.load());
    });
    for (const key of FEATURES) {
      this.controls[key].valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((on) => void this.save(key, on));
    }
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.show(await this.api.adminUser(this.userId()));
    } catch (e) {
      this.user.set(null);
      this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }

  /** Shows the user and puts the switches in line with what the server says. */
  private show(user: AdminUserDetail): void {
    this.user.set(user);
    for (const f of user.features) {
      const ctrl = this.controls[f.key];
      if (!ctrl) continue;
      ctrl.setValue(f.enabled, { emitEvent: false });
      if (user.isAdmin) ctrl.disable({ emitEvent: false });
      else ctrl.enable({ emitEvent: false });
    }
  }

  private async save(key: Feature, on: boolean | null): Promise<void> {
    const u = this.user();
    if (!u) return;
    this.saving.set(key);
    try {
      const next = await this.api.setUserFeatures(u.id, { [key]: on });
      this.show(next);
      const enabled = next.features.find((f) => f.key === key)?.enabled;
      const label = FEATURE_LABELS[key];
      this.toast.success(
        enabled ? $localize`${label}:feature: is now on for ${u.nickname}:nickname:` : $localize`${label}:feature: is now off for ${u.nickname}:nickname:`,
      );
    } catch (e) {
      // Put the switch back to what was saved.
      this.show(u);
      this.toast.error(e);
    } finally {
      this.saving.set(null);
    }
  }

  protected reset(f: AdminUserFeature): void {
    void this.save(f.key, null);
  }
}
