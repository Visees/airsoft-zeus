import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { AuthService } from '../../core/auth/auth.service';
import { formatDate, formatList } from '../../core/util/format';
import { EmptyState, PageHeader } from '../../shared/states';
import { countryName } from './countries';
import { Avatar, BadgeGrid, StatTiles, roleText } from './profile-ui';

@Component({
  selector: 'ah-profile-screen',
  imports: [RouterLink, NgIcon, HlmButton, PageHeader, EmptyState, Avatar, StatTiles, BadgeGrid],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      @if (user(); as u) {
        <ah-page-header title="Profile" i18n-title>
          <a hlmBtn variant="outline" routerLink="/profile/edit" class="h-11"><ng-icon name="lucidePencil" size="16" aria-hidden="true" /> <ng-container i18n>Edit profile</ng-container></a>
        </ah-page-header>

        <section class="panel flex flex-col gap-4 p-4 sm:flex-row sm:items-start" aria-label="Profile summary" i18n-aria-label>
          <ah-avatar [url]="u.avatarUrl" [nickname]="u.nickname" [size]="88" alt="Avatar of {{ u.nickname }}" i18n-alt />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <div>
              <p class="label-caps" i18n>Nickname · public</p>
              <p class="truncate text-2xl font-bold uppercase" style="font-stretch: 85%">{{ u.nickname }}</p>
            </div>
            @if (realName()) {
              <div>
                <p class="label-caps flex items-center gap-1"><ng-icon name="lucideLock" size="12" aria-hidden="true" /> <ng-container i18n>Real name · only you see this</ng-container></p>
                <p>{{ realName() }}</p>
              </div>
            }
            <dl class="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt class="label-caps" i18n>Club</dt>
                <dd>
                  @if (u.clubId) {
                    <a [routerLink]="['/clubs', u.clubId]" class="font-semibold text-primary underline-offset-2 hover:underline">{{ u.clubName || txt.viewClub }}</a>
                  } @else {
                    {{ u.clubName || '—' }}
                  }
                </dd>
              </div>
              <div>
                <dt class="label-caps" i18n>Role</dt>
                <dd>{{ role() }}</dd>
              </div>
              <div>
                <dt class="label-caps" i18n>Country</dt>
                <dd>{{ country() ?? '—' }}</dd>
              </div>
              <div>
                <dt class="label-caps" i18n>Member since</dt>
                <dd>{{ since() }}</dd>
              </div>
            </dl>
            @if (u.bio) {
              <p class="text-sm whitespace-pre-line text-muted-foreground">{{ u.bio }}</p>
            }
          </div>
        </section>

        @if (missing().length) {
          <a routerLink="/profile/edit" class="mt-3 flex items-center gap-3 rounded-md border border-dashed border-border p-3 text-sm hover:bg-muted/60">
            <ng-icon name="lucideInfo" size="18" class="shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="flex-1" i18n>Add {{ missingList() }} to complete your profile.</span>
            <ng-icon name="lucideChevronRight" size="16" class="text-muted-foreground" aria-hidden="true" />
          </a>
        }

        <section class="mt-6" aria-labelledby="pr-stats">
          <div class="mb-2 flex items-baseline justify-between">
            <h2 id="pr-stats" class="label-caps" i18n>Statistics</h2>
            <a routerLink="/profile/stats" class="hit text-sm font-semibold text-primary underline-offset-2 hover:underline" i18n>Game history</a>
          </div>
          <ah-stat-tiles [stats]="u.stats" />
        </section>

        <section class="mt-6" aria-labelledby="pr-badges">
          <h2 id="pr-badges" class="label-caps mb-2" i18n>Badges · <span class="num">{{ u.badges.length }}</span></h2>
          <ah-badge-grid [badges]="u.badges" [compact]="true" />
        </section>

        <nav class="mt-6" aria-label="Profile links" i18n-aria-label>
          <ul class="panel divide-y divide-border overflow-hidden">
            @for (l of links(); track l.link) {
              <li>
                <a [routerLink]="l.link" class="flex min-h-14 items-center gap-3 px-4 hover:bg-muted/60">
                  <ng-icon [name]="l.icon" size="18" class="text-muted-foreground" aria-hidden="true" />
                  <span class="flex-1">
                    <span class="block font-semibold">{{ l.label }}</span>
                    <span class="block text-xs text-muted-foreground">{{ l.hint }}</span>
                  </span>
                  <ng-icon name="lucideChevronRight" size="16" class="text-muted-foreground" aria-hidden="true" />
                </a>
              </li>
            }
            <li>
              <a [routerLink]="['/players', u.id]" class="flex min-h-14 items-center gap-3 px-4 hover:bg-muted/60">
                <ng-icon name="lucideEye" size="18" class="text-muted-foreground" aria-hidden="true" />
                <span class="flex-1">
                  <span class="block font-semibold" i18n>See my public profile</span>
                  <span class="block text-xs text-muted-foreground" i18n>What other players see</span>
                </span>
                <ng-icon name="lucideChevronRight" size="16" class="text-muted-foreground" aria-hidden="true" />
              </a>
            </li>
          </ul>
        </nav>

        <button hlmBtn variant="outline" type="button" class="mt-6 h-12 w-full" [disabled]="loggingOut()" (click)="logout()">
          <ng-icon name="lucideLogOut" size="18" aria-hidden="true" /> {{ loggingOut() ? txt.loggingOut : txt.logOut }}
        </button>
      } @else {
        <ah-empty-state icon="lucideUser" title="Not signed in" message="Log in to see your profile." i18n-title i18n-message>
          <a hlmBtn routerLink="/auth/login" class="h-11" i18n>Log in</a>
        </ah-empty-state>
      }
    </div>
  `,
})
export class ProfileScreen implements OnInit {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    viewClub: $localize`View club`,
    loggingOut: $localize`Logging out…`,
    logOut: $localize`Log out`,
  };

  private readonly auth = inject(AuthService);
  protected readonly user = this.auth.user;
  protected readonly loggingOut = signal(false);

  protected readonly realName = computed(() => {
    const u = this.user();
    return [u?.firstName, u?.lastName].filter(Boolean).join(' ');
  });
  protected readonly role = computed(() => roleText(this.user()?.playerRole, this.user()?.customRole) ?? '—');
  protected readonly country = computed(() => countryName(this.user()?.country));
  protected readonly since = computed(() => formatDate(this.user()?.createdAt));
  protected readonly missingList = computed(() => formatList(this.missing()));
  protected readonly missing = computed(() => {
    const u = this.user();
    if (!u) return [];
    const m: string[] = [];
    if (!u.avatarUrl) m.push($localize`a photo`);
    if (!u.clubName && !u.clubId) m.push($localize`your club`);
    if (!u.emergencyContact) m.push($localize`an emergency contact`);
    return m;
  });

  protected readonly links = computed(() => [
    { label: $localize`Edit profile`, hint: $localize`Photo, nickname, club, role, emergency contact`, icon: 'lucidePencil', link: '/profile/edit' },
    { label: $localize`Statistics`, hint: $localize`Game history, results and badges`, icon: 'lucideChartColumn', link: '/profile/stats' },
    { label: $localize`Settings`, hint: $localize`Theme, notifications, password, data`, icon: 'lucideSettings', link: '/settings' },
    { label: $localize`Privacy`, hint: $localize`What other players and Game Masters see`, icon: 'lucideShieldCheck', link: '/settings/privacy' },
    ...(this.auth.can('support')
      ? [{ label: $localize`Help & feedback`, hint: $localize`Report a bug, flag a problem, write to the team`, icon: 'lucideLifeBuoy', link: '/support' }]
      : []),
    ...(this.user()?.isAdmin ? [{ label: $localize`Admin`, hint: $localize`Users, support tickets and News`, icon: 'lucideShield', link: '/admin' }] : []),
  ]);

  ngOnInit(): void {
    // Stats and badges change after games: refresh in the background.
    void this.auth.reloadUser();
  }

  protected async logout(): Promise<void> {
    this.loggingOut.set(true);
    await this.auth.logout();
    this.loggingOut.set(false);
  }
}
