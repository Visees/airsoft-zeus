import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { Club } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { PLAYER_ROLE_LABELS } from '../../core/util/format';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { countryName } from '../profile/countries';
import { Avatar } from '../profile/profile-ui';
import { ClubForm } from './club-form';

@Component({
  selector: 'ah-club-screen',
  imports: [RouterLink, NgIcon, HlmButton, PageHeader, LoadingSkeleton, EmptyState, ErrorState, Avatar, ClubForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isNew()) {
      <div class="page-narrow">
        <ah-page-header title="Create a club" back="/profile/edit" backLabel="Edit profile"
          subtitle="A club page groups your team mates. You become its owner and it is set as your club." i18n-title i18n-backLabel i18n-subtitle />
        <div class="panel p-4">
          <ah-club-form (saved)="created($event)" (cancel)="back()" />
        </div>
      </div>
    } @else {
      <div class="page-narrow">
        @if (loading()) {
          <ah-loading-skeleton [rows]="4" [avatar]="true" />
        } @else if (notFound()) {
          <ah-page-header title="Club" i18n-title />
          <ah-empty-state icon="lucideShield" title="Club not found" message="It may have been removed, or the link is wrong." i18n-title i18n-message>
            @if (auth.can('create_clubs')) {
              <a hlmBtn routerLink="/clubs/new" class="h-11" i18n>Create a club</a>
            }
          </ah-empty-state>
        } @else if (error() && !club()) {
          <ah-page-header title="Club" i18n-title />
          <ah-error-state [error]="error()" (retry)="load(clubId())" />
        } @else if (club(); as c) {
          @if (editing()) {
            <ah-page-header title="Edit club" [subtitle]="c.name" i18n-title />
            <div class="panel p-4">
              <ah-club-form [club]="c" (saved)="updated($event)" (cancel)="editing.set(false)" />
            </div>
          } @else {
            <ah-page-header [title]="c.name" eyebrow="Club" i18n-eyebrow>
              @if (isOwner()) {
                <button hlmBtn variant="outline" type="button" class="h-11" (click)="editing.set(true)">
                  <ng-icon name="lucidePencil" size="16" aria-hidden="true" /> <ng-container i18n>Edit club</ng-container>
                </button>
              }
            </ah-page-header>

            <section class="panel flex flex-col gap-4 p-4 sm:flex-row sm:items-start" aria-label="Club details" i18n-aria-label>
              <div class="grid size-24 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted">
                @if (c.logoUrl) {
                  <img [src]="c.logoUrl" alt="{{ c.name }} logo" i18n-alt class="size-full object-cover" />
                } @else {
                  <ng-icon name="lucideShield" size="36" class="text-muted-foreground" aria-hidden="true" />
                }
              </div>
              <div class="flex min-w-0 flex-1 flex-col gap-2">
                <dl class="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  @if (place()) {
                    <div>
                      <dt class="label-caps" i18n>Based in</dt>
                      <dd>{{ place() }}</dd>
                    </div>
                  }
                  <div>
                    <dt class="label-caps" i18n>Members</dt>
                    <dd class="num">{{ c.memberCount }}</dd>
                  </div>
                  @if (c.website) {
                    <div class="sm:col-span-2">
                      <dt class="label-caps" i18n>Website</dt>
                      <dd>
                        <a [href]="c.website" target="_blank" rel="noopener noreferrer nofollow" class="inline-flex items-center gap-1 font-semibold break-all text-primary underline-offset-2 hover:underline">
                          {{ c.website }} <ng-icon name="lucideExternalLink" size="13" aria-hidden="true" /><span class="sr-only" i18n>(opens in a new tab)</span>
                        </a>
                      </dd>
                    </div>
                  }
                </dl>
                @if (c.description) {
                  <p class="text-sm whitespace-pre-line text-muted-foreground">{{ c.description }}</p>
                }
                <div class="mt-1 flex flex-wrap items-center gap-2">
                  @if (isMyClub()) {
                    <span class="rounded-sm bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary" i18n>✓ Your club</span>
                    @if (!isOwner()) {
                      <button hlmBtn variant="ghost" size="sm" type="button" class="tap" [disabled]="busy()" (click)="leave()" i18n>Leave club</button>
                    }
                  } @else {
                    <button hlmBtn type="button" class="h-11" [disabled]="busy()" (click)="join()">
                      <ng-icon name="lucideUserPlus" size="16" aria-hidden="true" /> <ng-container i18n>Set as my club</ng-container>
                    </button>
                  }
                </div>
              </div>
            </section>

            <section class="mt-6" aria-labelledby="club-members">
              <h2 id="club-members" class="label-caps mb-2" i18n>Members · <span class="num">{{ members().length }}</span></h2>
              @if (members().length) {
                <ul class="panel divide-y divide-border overflow-hidden">
                  @for (m of members(); track m.id) {
                    <li>
                      <a [routerLink]="['/players', m.id]" class="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-muted/60">
                        <ah-avatar [url]="m.avatarUrl" [nickname]="m.nickname" [size]="40" />
                        <span class="min-w-0 flex-1">
                          <span class="block truncate font-semibold">{{ m.nickname }}
                            @if (m.id === ownerId()) {
                              <span class="ml-1 rounded-sm bg-muted px-1 text-xs font-semibold text-muted-foreground" i18n>Owner</span>
                            }
                          </span>
                          @if (m.playerRole) {
                            <span class="block text-xs text-muted-foreground">{{ roleLabel(m.playerRole) }}</span>
                          }
                        </span>
                        <ng-icon name="lucideChevronRight" size="16" class="text-muted-foreground" aria-hidden="true" />
                      </a>
                    </li>
                  }
                </ul>
                @if (members().length < c.memberCount) {
                  <p class="mt-2 text-xs text-muted-foreground" i18n>Members who hide their club are not listed.</p>
                }
              } @else {
                <p class="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground" i18n>No public members yet. Players appear here when they set this club in their profile.</p>
              }
            </section>
          }
        }
      </div>
    }
  `,
})
export class ClubScreen {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  /** 'new' = create form */
  readonly clubId = input.required<string>();

  protected readonly club = signal<Club | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<unknown>(null);
  protected readonly notFound = signal(false);
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);

  protected readonly isNew = computed(() => this.clubId() === 'new');
  protected readonly isOwner = computed(() => !!this.club()?.ownerId && this.club()?.ownerId === this.auth.user()?.id);
  protected readonly ownerId = computed(() => this.club()?.ownerId ?? null);
  protected readonly isMyClub = computed(() => !!this.club() && this.auth.user()?.clubId === this.club()?.id);
  protected readonly members = computed(() => this.club()?.members ?? []);
  protected readonly place = computed(() => {
    const c = this.club();
    return c ? [c.city, countryName(c.country)].filter(Boolean).join(', ') : '';
  });
  protected readonly roleLabel = (r: keyof typeof PLAYER_ROLE_LABELS) => PLAYER_ROLE_LABELS[r];

  constructor() {
    effect(() => {
      const id = this.clubId();
      untracked(() => {
        this.editing.set(false);
        if (id !== 'new') void this.load(id);
      });
    });
  }

  protected async load(id: string): Promise<void> {
    this.loading.set(this.club()?.id !== id);
    this.error.set(null);
    this.notFound.set(false);
    try {
      this.club.set(await this.api.club(id));
    } catch (e) {
      const err = ApiError.from(e);
      if (err.status === 404 || err.status === 400) this.notFound.set(true);
      else this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }

  protected async created(c: Club): Promise<void> {
    this.toast.success($localize`${c.name}:name: created`, $localize`It is now set as your club.`);
    // The server links the new club to the creator's profile.
    await this.auth.reloadUser();
    await this.router.navigate(['/clubs', c.id], { replaceUrl: true });
  }

  protected async updated(c: Club): Promise<void> {
    this.toast.success($localize`Club saved`);
    this.editing.set(false);
    await this.load(c.id);
    void this.auth.reloadUser();
  }

  protected back(): void {
    void this.router.navigateByUrl('/profile/edit');
  }

  protected async join(): Promise<void> {
    const c = this.club();
    if (!c) return;
    this.busy.set(true);
    try {
      this.auth.setUser(await this.api.updateMe({ clubId: c.id, clubName: c.name }));
      this.toast.success($localize`${c.name}:name: is now your club`);
      await this.load(c.id);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async leave(): Promise<void> {
    const c = this.club();
    if (!c) return;
    const ok = await this.confirm.ask({
      title: $localize`Leave ${c.name}:name:?`,
      consequences: [$localize`The club is removed from your profile.`, $localize`You can set it again at any time.`],
      confirmLabel: $localize`Leave club`,
      destructive: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      this.auth.setUser(await this.api.updateMe({ clubId: null, clubName: null }));
      this.toast.info($localize`You left ${c.name}:name:`);
      await this.load(c.id);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
