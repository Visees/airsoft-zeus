import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { PublicProfile } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { countryName } from './countries';
import { Avatar, BadgeGrid, StatTiles, roleText } from './profile-ui';
import { ReportDialog } from './report-dialog';

@Component({
  selector: 'zeus-public-profile-screen',
  imports: [RouterLink, NgIcon, HlmButton, PageHeader, LoadingSkeleton, EmptyState, ErrorState, Avatar, StatTiles, BadgeGrid, ReportDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      @if (loading()) {
        <zeus-loading-skeleton [rows]="3" [avatar]="true" />
      } @else if (notFound()) {
        <zeus-page-header title="Player" i18n-title />
        <zeus-empty-state icon="lucideUserX" title="Player not found" message="This profile does not exist or the link is wrong." i18n-title i18n-message>
          <a hlmBtn routerLink="/home" class="h-11" i18n>Go home</a>
        </zeus-empty-state>
      } @else if (error() && !profile()) {
        <zeus-page-header title="Player" i18n-title />
        <zeus-error-state [error]="error()" (retry)="load(userId())" />
      } @else if (profile(); as p) {
        @if (p.deleted) {
          <zeus-page-header title="Deleted player" i18n-title />
          <div class="panel flex items-center gap-4 p-4">
            <span class="grid size-16 place-items-center rounded-full border border-dashed border-border text-muted-foreground" aria-hidden="true">
              <ng-icon name="lucideUserX" size="26" />
            </span>
            <p class="text-sm text-muted-foreground" i18n>This player deleted their account. Their results stay in past events under “Deleted player”.</p>
          </div>
        } @else {
          <zeus-page-header [title]="p.nickname" eyebrow="Player" i18n-eyebrow>
            @if (isSelf()) {
              <a hlmBtn variant="outline" routerLink="/profile/edit" class="h-11"><ng-icon name="lucidePencil" size="16" aria-hidden="true" /> <ng-container i18n>Edit</ng-container></a>
            } @else {
              <button hlmBtn variant="ghost" type="button" class="h-11 text-muted-foreground" (click)="report()?.open()">
                <ng-icon name="lucideFlag" size="16" aria-hidden="true" /> <ng-container i18n>Report</ng-container>
              </button>
            }
          </zeus-page-header>

          @if (isSelf()) {
            <p class="mb-3 flex items-center gap-2 rounded-md border border-border bg-muted p-3 text-sm">
              <ng-icon name="lucideEye" size="16" class="shrink-0 text-muted-foreground" aria-hidden="true" />
              <span i18n>This is how other players see you. Change what is shown in <a routerLink="/settings/privacy" class="font-semibold text-primary underline-offset-2 hover:underline">Privacy settings</a>.</span>
            </p>
          }

          <section class="panel flex flex-col gap-4 p-4 sm:flex-row sm:items-start" aria-label="Player summary" i18n-aria-label>
            <zeus-avatar [url]="p.avatarUrl" [nickname]="p.nickname" [size]="88" alt="Avatar of {{ p.nickname }}" i18n-alt />
            <div class="flex min-w-0 flex-1 flex-col gap-3">
              @if (hasDetails()) {
                <dl class="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  @if (p.clubName) {
                    <div>
                      <dt class="label-caps" i18n>Club</dt>
                      <dd>
                        @if (p.clubId) {
                          <a [routerLink]="['/clubs', p.clubId]" class="font-semibold text-primary underline-offset-2 hover:underline">{{ p.clubName }}</a>
                        } @else {
                          {{ p.clubName }}
                        }
                      </dd>
                    </div>
                  }
                  @if (role()) {
                    <div>
                      <dt class="label-caps" i18n>Role</dt>
                      <dd>{{ role() }}</dd>
                    </div>
                  }
                  @if (country()) {
                    <div>
                      <dt class="label-caps" i18n>Country</dt>
                      <dd>{{ country() }}</dd>
                    </div>
                  }
                </dl>
              }
              @if (p.bio) {
                <p class="text-sm whitespace-pre-line text-muted-foreground">{{ p.bio }}</p>
              }
              @if (!hasDetails() && !p.bio) {
                <p class="text-sm text-muted-foreground" i18n>This player keeps their profile details private.</p>
              }
            </div>
          </section>

          @if (p.stats) {
            <section class="mt-6" aria-labelledby="pp-stats">
              <h2 id="pp-stats" class="label-caps mb-2" i18n>Statistics</h2>
              <zeus-stat-tiles [stats]="p.stats" />
            </section>
          }

          @if (p.badges.length) {
            <section class="mt-6" aria-labelledby="pp-badges">
              <h2 id="pp-badges" class="label-caps mb-2" i18n>Badges · <span class="num">{{ p.badges.length }}</span></h2>
              <zeus-badge-grid [badges]="p.badges" />
            </section>
          }

          @if (!isSelf()) {
            <zeus-report-dialog [targetUserId]="p.id" [nickname]="p.nickname" />
          }
        }
      }
    </div>
  `,
})
export class PublicProfileScreen {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  protected readonly report = viewChild(ReportDialog);

  readonly userId = input.required<string>();

  protected readonly profile = signal<PublicProfile | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<unknown>(null);
  protected readonly notFound = signal(false);

  protected readonly isSelf = computed(() => this.auth.user()?.id === this.profile()?.id);
  protected readonly role = computed(() => roleText(this.profile()?.playerRole, this.profile()?.customRole));
  protected readonly country = computed(() => countryName(this.profile()?.country));
  protected readonly hasDetails = computed(() => !!(this.profile()?.clubName || this.role() || this.country()));

  constructor() {
    effect(() => {
      const id = this.userId();
      untracked(() => void this.load(id));
    });
  }

  protected async load(id: string): Promise<void> {
    this.loading.set(this.profile()?.id !== id);
    this.error.set(null);
    this.notFound.set(false);
    try {
      this.profile.set(await this.api.publicProfile(id));
    } catch (e) {
      if (ApiError.from(e).status === 404) this.notFound.set(true);
      else this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }
}
