import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { EventDetail, MemberStatus, Team } from '../../core/api/models';
import { LocationTracker } from '../../core/location/location-tracker.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { GAME_MODE_LABELS, formatDate, formatDuration, formatTime, initials } from '../../core/util/format';
import { ConnectionStatus } from '../../shared/link-status';
import { ErrorState, PageHeader } from '../../shared/states';
import { StatusChip, eventStatusChip } from '../../shared/status-chip';
import { TeamBadge } from '../../shared/team-badge';
import { JOIN_CODE_PATTERN, copyText, joinLink, normalizeCode, shareOrCopy } from './share-utils';

type Membership = 'gm' | 'none' | MemberStatus;

const TEAM_SELECTION_LABELS: Record<EventDetail['teamSelection'], string> = {
  gm: 'Assigned by the Game Master',
  auto: 'Balanced automatically',
  player: 'Players choose their team',
};

/** Event page: briefing, rules and the join / membership actions. */
@Component({
  selector: 'zeus-event-details-screen',
  imports: [ReactiveFormsModule, RouterLink, NgIcon, HlmButton, HlmInput, HlmLabel, ErrorState, PageHeader, StatusChip, TeamBadge, ConnectionStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (loading() && !event()) {
        <div class="flex flex-col gap-4" role="status" aria-label="Loading event">
          <div class="aspect-16/7 w-full animate-pulse rounded-md bg-muted"></div>
          <div class="h-8 w-2/3 animate-pulse rounded-sm bg-muted"></div>
          <div class="h-4 w-1/2 animate-pulse rounded-sm bg-muted"></div>
          <div class="h-32 w-full animate-pulse rounded-md bg-muted"></div>
          <span class="sr-only">Loading…</span>
        </div>
      } @else if (error() && !event() && hiddenPrivate()) {
        <!-- Private events are invisible to non-members (API answers 404): join blind with the code. -->
        <zeus-page-header title="Private event" back="/events/join" backLabel="Join with a code" />
        <section class="panel mx-auto flex max-w-md flex-col gap-3 p-4" aria-labelledby="blind-join-title">
          <h2 id="blind-join-title" class="text-lg uppercase"><ng-icon name="lucideLock" size="18" class="mr-1 align-[-2px]" aria-hidden="true" /> Join with your code</h2>
          <p class="text-sm text-muted-foreground">The details of this private event are shown once you are registered. The Game Master may need to approve your request.</p>
          <form class="flex flex-col gap-3" [formGroup]="joinForm" (ngSubmit)="joinHidden()" novalidate>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="blind-join-code">Join code</label>
              <input
                hlmInput
                id="blind-join-code"
                formControlName="joinCode"
                class="num h-12 text-center text-xl font-bold tracking-[0.25em] uppercase"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                maxlength="12"
                [attr.aria-invalid]="joinError() ? 'true' : null"
                aria-describedby="blind-join-error"
                (input)="onCodeInput($event)"
              />
              @if (joinError()) {
                <p id="blind-join-error" class="field-error" role="alert">{{ joinError() }}</p>
              }
            </div>
            <button hlmBtn type="submit" class="h-12" [disabled]="busy()">
              @if (busy()) {
                <ng-icon name="lucideLoader2" size="18" class="animate-spin" aria-hidden="true" /> Sending…
              } @else {
                <ng-icon name="lucideUserPlus" size="18" aria-hidden="true" /> Join event
              }
            </button>
          </form>
        </section>
      } @else if (error() && !event()) {
        <zeus-page-header title="Event" back="/events/mine" backLabel="My events" />
        <zeus-error-state [error]="error()" [title]="errorTitle()" (retry)="load()">
          <a hlmBtn variant="ghost" class="tap" routerLink="/events/join">Enter a join code</a>
        </zeus-error-state>
      } @else if (event(); as e) {
        <zeus-page-header [title]="e.name" [eyebrow]="modeLabel()" [back]="e.isGm ? '/events/mine?tab=gm' : '/events/mine'" backLabel="My events">
          <zeus-status-chip [spec]="statusChip()" />
        </zeus-page-header>

        @if (offline()) {
          <div class="mb-3 flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning-surface px-3 py-2 text-sm" role="status">
            <span>Showing saved details. Actions need a connection.</span>
            <zeus-connection-status />
          </div>
        }

        @if (e.status === 'cancelled') {
          <div class="mb-4 flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4" role="alert">
            <ng-icon name="lucideBan" size="22" class="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <p class="font-bold uppercase">✕ Event cancelled</p>
              <p class="text-sm text-muted-foreground">The Game Master cancelled this event. Nothing will be tracked and no game will take place.</p>
            </div>
          </div>
        }

        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <!-- Main column -->
          <div class="flex min-w-0 flex-col gap-6">
            <div class="relative aspect-16/7 overflow-hidden rounded-md border border-border bg-muted">
              @if (e.coverUrl) {
                <img [src]="e.coverUrl" alt="" class="absolute inset-0 size-full object-cover" />
              } @else {
                <div class="absolute inset-0 grid place-items-center text-muted-foreground">
                  <ng-icon name="lucideMapPinned" size="40" aria-hidden="true" />
                </div>
              }
              <div class="absolute bottom-2 left-2 flex flex-wrap gap-1.5">
                @if (e.visibility === 'private') {
                  <span class="hud inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold"><ng-icon name="lucideLock" size="12" aria-hidden="true" /> Private</span>
                }
                @if (e.isTestData) {
                  <span class="hud px-2 py-1 text-xs font-semibold">Test data</span>
                }
              </div>
            </div>

            <!-- Key facts -->
            <section aria-labelledby="facts-title">
              <h2 id="facts-title" class="label-caps mb-2">Briefing</h2>
              <dl class="panel grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
                <div class="flex gap-3 p-3 sm:border-b sm:border-border">
                  <ng-icon name="lucideCalendarDays" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt class="label-caps">Date</dt>
                    <dd class="font-semibold">{{ dateLabel() }}</dd>
                    <dd class="num text-sm text-muted-foreground">{{ timeLabel() }} · {{ durationLabel() }}</dd>
                  </div>
                </div>
                <div class="flex gap-3 p-3 sm:border-b sm:border-l sm:border-border">
                  <ng-icon name="lucideUsers" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt class="label-caps">Players</dt>
                    <dd class="font-semibold"><span class="num">{{ e.approvedCount }} / {{ e.maxPlayers }}</span> registered</dd>
                    <dd class="text-sm text-muted-foreground">
                      Minimum <span class="num">{{ e.minPlayers }}</span>
                      @if (e.isGm && e.pendingCount) {
                        · <span class="text-warning">◐ <span class="num">{{ e.pendingCount }}</span> pending</span>
                      }
                    </dd>
                  </div>
                </div>
                <div class="flex gap-3 p-3 sm:col-span-2 sm:border-b sm:border-border">
                  <ng-icon name="lucideMapPin" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div class="min-w-0 flex-1">
                    <dt class="label-caps">Meeting point</dt>
                    <dd class="font-semibold">{{ e.meetingAddress || (hasMeetingCoords() ? 'Pinned location' : 'Shared by the Game Master before the game') }}</dd>
                    @if (hasMeetingCoords()) {
                      <dd class="num text-xs text-muted-foreground">{{ e.meetingLat!.toFixed(5) }}, {{ e.meetingLng!.toFixed(5) }}</dd>
                    }
                  </div>
                  @if (directionsUrl()) {
                    <a hlmBtn variant="outline" class="tap shrink-0 self-center" [href]="directionsUrl()" target="_blank" rel="noopener noreferrer">
                      <ng-icon name="lucideNavigation" size="16" class="text-nav" aria-hidden="true" /> Directions
                      <span class="sr-only">(opens Google Maps)</span>
                    </a>
                  }
                </div>
                <div class="flex gap-3 p-3">
                  <ng-icon [name]="e.visibility === 'private' ? 'lucideLock' : 'lucideGlobe'" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt class="label-caps">Access</dt>
                    <dd class="font-semibold">{{ e.visibility === 'private' ? 'Private — join code needed' : 'Public' }}</dd>
                    <dd class="text-sm text-muted-foreground">{{ e.requiresApproval ? 'The Game Master approves registrations' : 'Registrations are accepted automatically' }}</dd>
                  </div>
                </div>
                <div class="flex gap-3 p-3 sm:border-l sm:border-border">
                  <ng-icon name="lucideFlag" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt class="label-caps">Teams</dt>
                    <dd class="font-semibold">{{ teamSelectionLabel() }}</dd>
                    @if (e.teamsLocked) {
                      <dd class="text-sm text-muted-foreground">■ Teams are locked</dd>
                    }
                  </div>
                </div>
              </dl>
            </section>

            @if (e.description) {
              <section aria-labelledby="about-title">
                <h2 id="about-title" class="label-caps mb-2">About this event</h2>
                <p class="whitespace-pre-line">{{ e.description }}</p>
              </section>
            }

            <section aria-labelledby="mode-title">
              <h2 id="mode-title" class="label-caps mb-2">Game mode · {{ modeLabel() }}</h2>
              <div class="panel p-4">
                <p class="font-semibold uppercase">{{ modeLabel() }}</p>
                @if (e.customModeRules) {
                  <p class="mt-2 text-sm whitespace-pre-line">{{ e.customModeRules }}</p>
                } @else {
                  <p class="mt-1 text-sm text-muted-foreground">{{ modeHint() }}</p>
                }
              </div>
            </section>

            @if (e.teams.length) {
              <section aria-labelledby="teams-title">
                <h2 id="teams-title" class="label-caps mb-2">Teams · <span class="num">{{ e.teams.length }}</span></h2>
                <ul class="grid gap-2 sm:grid-cols-2">
                  @for (t of sortedTeams(); track t.id) {
                    <li class="panel flex items-center justify-between gap-3 p-3" [class.border-primary]="t.id === e.myTeamId">
                      <zeus-team-badge [team]="t" />
                      <span class="text-right text-sm">
                        <span class="num font-semibold">{{ t.memberCount }}{{ t.capacity ? ' / ' + t.capacity : '' }}</span>
                        <span class="text-muted-foreground"> players</span>
                        @if (t.id === e.myTeamId) {
                          <span class="block text-xs font-semibold text-primary">✓ Your team</span>
                        } @else if (t.capacity && t.memberCount >= t.capacity) {
                          <span class="block text-xs text-muted-foreground">■ Full</span>
                        }
                      </span>
                    </li>
                  }
                </ul>
              </section>
            }

            @for (s of textSections(); track s.id) {
              <section [attr.aria-labelledby]="s.id + '-title'">
                <h2 [id]="s.id + '-title'" class="label-caps mb-2 flex items-center gap-1.5">
                  <ng-icon [name]="s.icon" size="14" aria-hidden="true" /> {{ s.title }}
                </h2>
                <div class="panel p-4" [class.border-warning]="s.id === 'safety'">
                  <p class="text-sm whitespace-pre-line">{{ s.text }}</p>
                </div>
              </section>
            }

            @if (e.gameMasters.length) {
              <section aria-labelledby="gm-title">
                <h2 id="gm-title" class="label-caps mb-2">Game Masters</h2>
                <ul class="flex flex-wrap gap-2">
                  @for (gm of e.gameMasters; track gm.id) {
                    <li>
                      <a [routerLink]="['/players', gm.id]" class="panel tap flex items-center gap-2 py-1 pr-3 pl-1 hover:border-primary/60">
                        @if (gm.avatarUrl) {
                          <img [src]="gm.avatarUrl" alt="" class="size-8 rounded-full object-cover" />
                        } @else {
                          <span class="grid size-8 place-items-center rounded-full bg-muted text-xs font-bold" aria-hidden="true">{{ initialsOf(gm.nickname) }}</span>
                        }
                        <span class="font-semibold">{{ gm.nickname }}</span>
                      </a>
                    </li>
                  }
                </ul>
              </section>
            }
          </div>

          <!-- Action column -->
          <aside class="flex flex-col gap-4 lg:sticky lg:top-4" aria-label="Your participation">
            <section class="panel flex flex-col gap-3 p-4" aria-labelledby="action-title">
              @switch (membership()) {
                @case ('gm') {
                  <h2 id="action-title" class="text-lg uppercase">You run this event</h2>
                  <div class="flex flex-col gap-2">
                    @if (e.status === 'live' || e.status === 'paused' || e.status === 'lobby') {
                      <a hlmBtn class="h-12" [routerLink]="['/gm/events', e.id, 'control']"><ng-icon name="lucideLayoutDashboard" size="18" aria-hidden="true" /> Control center</a>
                    }
                    @if (lobbyStatus()) {
                      <a hlmBtn [variant]="e.status === 'lobby' ? 'outline' : 'default'" class="h-12" [routerLink]="['/events', e.id, 'lobby']"><ng-icon name="lucideUsers" size="18" aria-hidden="true" /> Open lobby</a>
                    }
                    @if (e.status === 'completed') {
                      <a hlmBtn class="h-12" [routerLink]="['/events', e.id, 'results']"><ng-icon name="lucideTrophy" size="18" aria-hidden="true" /> View results</a>
                    }
                    <a hlmBtn variant="outline" class="h-11" [routerLink]="['/gm/events', e.id]"><ng-icon name="lucidePencil" size="16" aria-hidden="true" /> Edit event</a>
                    <a hlmBtn variant="outline" class="h-11" [routerLink]="['/gm/events', e.id, 'players']">
                      <ng-icon name="lucideUserCheck" size="16" aria-hidden="true" /> Manage players
                      @if (e.pendingCount) {
                        <span class="num rounded-sm bg-warning-surface px-1.5 text-xs text-warning">{{ e.pendingCount }}</span>
                      }
                    </a>
                  </div>
                }
                @case ('approved') {
                  <h2 id="action-title" class="text-lg uppercase">✓ You're registered</h2>
                  @if (myTeam(); as t) {
                    <p class="flex items-center gap-2 text-sm"><span class="label-caps">Team</span> <zeus-team-badge [team]="t" size="sm" /></p>
                  } @else if (e.status !== 'completed' && e.status !== 'cancelled') {
                    <p class="text-sm text-muted-foreground">No team yet. {{ e.teamSelection === 'player' ? 'Pick one in the lobby.' : 'The Game Master assigns teams before the start.' }}</p>
                  }
                  @switch (e.status) {
                    @case ('live') {
                      <a hlmBtn class="h-12" [routerLink]="['/events', e.id, 'live']"><ng-icon name="lucideMap" size="18" aria-hidden="true" /> Open live map</a>
                    }
                    @case ('paused') {
                      <a hlmBtn class="h-12" [routerLink]="['/events', e.id, 'live']"><ng-icon name="lucideMap" size="18" aria-hidden="true" /> Open live map</a>
                      <p class="text-sm text-warning">❚❚ The game is paused.</p>
                    }
                    @case ('completed') {
                      <a hlmBtn class="h-12" [routerLink]="['/events', e.id, 'results']"><ng-icon name="lucideTrophy" size="18" aria-hidden="true" /> View results</a>
                    }
                    @case ('cancelled') {}
                    @case ('draft') {
                      <p class="text-sm text-muted-foreground">The Game Master is still preparing this event.</p>
                    }
                    @default {
                      <a hlmBtn class="h-12" [routerLink]="['/events', e.id, 'lobby']"><ng-icon name="lucideUsers" size="18" aria-hidden="true" /> Open lobby</a>
                      <p class="text-sm text-muted-foreground">Accept the rules and get ready in the lobby before the start.</p>
                    }
                  }
                  @if (e.status !== 'completed' && e.status !== 'cancelled') {
                    <button hlmBtn variant="ghost" type="button" class="tap text-destructive" [disabled]="busy()" (click)="leave()">
                      <ng-icon name="lucideLogOut" size="16" aria-hidden="true" /> Leave event
                    </button>
                  }
                }
                @case ('pending') {
                  <h2 id="action-title" class="text-lg uppercase">◐ Waiting for GM approval</h2>
                  <p class="text-sm text-muted-foreground">Your request was sent. You get a notification when the Game Master reviews it.</p>
                  <button hlmBtn variant="outline" type="button" class="h-11" [disabled]="busy()" (click)="withdraw()">
                    <ng-icon name="lucideX" size="16" aria-hidden="true" /> Withdraw request
                  </button>
                }
                @case ('invited') {
                  <h2 id="action-title" class="text-lg uppercase">✉ You're invited</h2>
                  <p class="text-sm text-muted-foreground">The Game Master invited you to this event.</p>
                  <div class="flex gap-2">
                    <button hlmBtn type="button" class="h-12 flex-1" [disabled]="busy()" (click)="respond(true)"><ng-icon name="lucideCheck" size="18" aria-hidden="true" /> Accept</button>
                    <button hlmBtn variant="outline" type="button" class="h-12 flex-1" [disabled]="busy()" (click)="respond(false)">Decline</button>
                  </div>
                }
                @case ('removed') {
                  <h2 id="action-title" class="text-lg uppercase">Removed from this event</h2>
                  <p class="text-sm text-muted-foreground">The Game Master removed you from this event. Contact them if you think this is a mistake.</p>
                }
                @case ('rejected') {
                  <h2 id="action-title" class="text-lg uppercase">Request declined</h2>
                  <p class="text-sm text-muted-foreground">The Game Master declined your registration for this event.</p>
                }
                @default {
                  <h2 id="action-title" class="text-lg uppercase">Join this event</h2>
                  @if (joinBlock(); as reason) {
                    <p class="rounded-sm border border-border bg-muted p-3 text-sm" role="status">■ {{ reason }}</p>
                    @if (e.status === 'completed') {
                      <a hlmBtn variant="outline" class="h-11" [routerLink]="['/events', e.id, 'results']">View results</a>
                    }
                  } @else {
                    <form class="flex flex-col gap-3" [formGroup]="joinForm" (ngSubmit)="join()" novalidate>
                      @if (e.visibility === 'private') {
                        <div class="flex flex-col gap-1.5">
                          <label hlmLabel for="details-join-code">Join code</label>
                          <input
                            hlmInput
                            id="details-join-code"
                            formControlName="joinCode"
                            class="num h-12 text-center text-xl font-bold tracking-[0.25em] uppercase"
                            autocomplete="off"
                            autocapitalize="characters"
                            spellcheck="false"
                            maxlength="12"
                            [attr.aria-invalid]="joinError() ? 'true' : null"
                            aria-describedby="details-join-error"
                            (input)="onCodeInput($event)"
                          />
                          @if (joinError()) {
                            <p id="details-join-error" class="field-error" role="alert">{{ joinError() }}</p>
                          }
                        </div>
                      } @else if (joinError()) {
                        <p class="field-error" role="alert">{{ joinError() }}</p>
                      }
                      @if (e.requiresApproval) {
                        <p class="text-sm text-muted-foreground">◐ The Game Master approves registrations. You'll be notified.</p>
                      }
                      @if (spotsLeft() !== null && spotsLeft()! <= 5) {
                        <p class="text-sm text-warning">▲ <span class="num">{{ spotsLeft() }}</span> {{ spotsLeft() === 1 ? 'place' : 'places' }} left</p>
                      }
                      <button hlmBtn type="submit" class="h-12" [disabled]="busy()">
                        @if (busy()) {
                          <ng-icon name="lucideLoader2" size="18" class="animate-spin" aria-hidden="true" /> Sending…
                        } @else {
                          <ng-icon name="lucideUserPlus" size="18" aria-hidden="true" /> {{ e.requiresApproval ? 'Request to join' : 'Join event' }}
                        }
                      </button>
                    </form>
                  }
                }
              }
            </section>

            @if (e.isGm && e.joinCode && e.status !== 'cancelled' && e.status !== 'completed') {
              <section class="panel flex flex-col gap-3 p-4" aria-labelledby="share-title">
                <h2 id="share-title" class="label-caps">Invite players</h2>
                <div class="flex items-center justify-between gap-2 rounded-sm border border-dashed border-border bg-muted px-3 py-2">
                  <div>
                    <p class="label-caps">Join code</p>
                    <p class="num text-2xl font-bold tracking-[0.2em]">{{ e.joinCode }}</p>
                  </div>
                  <button hlmBtn variant="outline" type="button" class="tap" (click)="copyCode(e.joinCode)" aria-label="Copy join code">
                    <ng-icon [name]="copied() === 'code' ? 'lucideCheck' : 'lucideCopy'" size="16" aria-hidden="true" /> {{ copied() === 'code' ? 'Copied' : 'Copy' }}
                  </button>
                </div>
                <p class="num truncate text-xs text-muted-foreground" [title]="shareUrl()">{{ shareUrl() }}</p>
                <button hlmBtn type="button" variant="secondary" class="h-11" (click)="shareLink()">
                  <ng-icon [name]="copied() === 'link' ? 'lucideCheck' : 'lucideShare2'" size="16" aria-hidden="true" /> {{ copied() === 'link' ? 'Link copied' : 'Share invite link' }}
                </button>
              </section>
            }

            @if (isAdmin()) {
              <section class="panel flex flex-col gap-2 p-4" aria-labelledby="admin-title">
                <h2 id="admin-title" class="label-caps"><ng-icon name="lucideShield" size="14" class="mr-1 align-[-2px]" aria-hidden="true" /> Admin</h2>
                <button hlmBtn variant="destructive" class="h-11 justify-start" type="button" (click)="adminDelete()" [disabled]="busy()">
                  <ng-icon name="lucideTrash2" size="16" aria-hidden="true" /> Delete event
                </button>
              </section>
            }
          </aside>
        </div>
      }
    </div>
  `,
})
export class EventDetailsScreen {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly tracker = inject(LocationTracker);
  private readonly doc = inject(DOCUMENT);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly eventId = input.required<string>();
  /** ?code= from the join screen or an invite link. */
  readonly code = input<string>();

  protected readonly event = signal<EventDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<unknown>(null);
  protected readonly busy = signal(false);
  protected readonly joinError = signal<string | null>(null);
  protected readonly copied = signal<'code' | 'link' | null>(null);
  protected readonly isAdmin = computed(() => !!this.auth.user()?.isAdmin);

  protected readonly joinForm = this.fb.group({ joinCode: this.fb.control('') });
  protected readonly initialsOf = initials;

  protected readonly offline = computed(() => {
    const e = this.error();
    return !!e && !!this.event() && ApiError.from(e).isNetwork;
  });
  protected readonly errorTitle = computed(() => {
    const e = ApiError.from(this.error());
    if (e.status === 404) return 'Event not found';
    if (e.status === 403) return 'This event is private';
    return null;
  });

  /** 404 while holding a join code: most likely a private event we are not a member of yet. */
  protected readonly hiddenPrivate = computed(() => !!this.code() && ApiError.from(this.error()).status === 404);

  protected readonly statusChip = computed(() => eventStatusChip(this.event()!.status));
  protected readonly modeLabel = computed(() => {
    const e = this.event();
    return e ? e.customModeName || GAME_MODE_LABELS[e.gameMode] : '';
  });
  protected readonly modeHint = computed(() => MODE_HINTS[this.event()?.gameMode ?? 'custom']);
  protected readonly dateLabel = computed(() => formatDate(this.event()?.startAt));
  protected readonly timeLabel = computed(() => `${formatTime(this.event()?.startAt)}–${formatTime(this.event()?.endAt)}`);
  protected readonly durationLabel = computed(() => {
    const e = this.event();
    return e ? formatDuration(new Date(e.endAt).getTime() - new Date(e.startAt).getTime()) : '';
  });
  protected readonly hasMeetingCoords = computed(() => {
    const e = this.event();
    return e?.meetingLat != null && e?.meetingLng != null;
  });
  protected readonly directionsUrl = computed(() => {
    const e = this.event();
    if (!e) return null;
    if (e.meetingLat != null && e.meetingLng != null) {
      return `https://www.google.com/maps/dir/?api=1&destination=${e.meetingLat},${e.meetingLng}`;
    }
    return e.meetingAddress ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(e.meetingAddress)}` : null;
  });
  protected readonly teamSelectionLabel = computed(() => TEAM_SELECTION_LABELS[this.event()!.teamSelection]);
  protected readonly sortedTeams = computed(() => [...(this.event()?.teams ?? [])].sort((a, b) => a.sortOrder - b.sortOrder));
  protected readonly myTeam = computed<Team | null>(() => {
    const e = this.event();
    const id = e?.me?.teamId ?? e?.myTeamId;
    return (id && e?.teams.find((t) => t.id === id)) || null;
  });

  protected readonly textSections = computed(() => {
    const e = this.event();
    if (!e) return [];
    return [
      { id: 'rules', title: 'Rules', icon: 'lucideListChecks', text: e.rules },
      { id: 'safety', title: 'Safety rules', icon: 'lucideTriangleAlert', text: e.safetyRules },
      { id: 'equipment', title: 'Required equipment', icon: 'lucidePackage', text: e.requiredEquipment },
      { id: 'chrono', title: 'Chronograph and power limits', icon: 'lucideGauge', text: e.chronoInfo },
    ].filter((s) => !!s.text?.trim());
  });

  protected readonly membership = computed<Membership>(() => {
    const e = this.event();
    if (!e) return 'none';
    if (e.isGm) return 'gm';
    const status = e.me?.status ?? e.myStatus;
    return status ?? 'none';
  });

  protected readonly lobbyStatus = computed(() => {
    const s = this.event()?.status;
    return s === 'published' || s === 'registration_open' || s === 'lobby';
  });

  protected readonly spotsLeft = computed(() => {
    const e = this.event();
    return e ? Math.max(0, e.maxPlayers - e.approvedCount) : null;
  });

  /** Why a non-member cannot join right now, or null. */
  protected readonly joinBlock = computed<string | null>(() => {
    const e = this.event();
    if (!e) return null;
    switch (e.status) {
      case 'cancelled':
        return 'This event was cancelled.';
      case 'completed':
        return 'This event has ended.';
      case 'live':
      case 'paused':
        return 'The game has already started. Registration is closed.';
      case 'draft':
      case 'published':
        return 'Registration has not opened yet. Check back later.';
    }
    if (e.registrationLocked) return 'The Game Master has closed registration.';
    if (e.approvedCount >= e.maxPlayers) return 'This event is full.';
    return null;
  });

  protected readonly shareUrl = computed(() => {
    const code = this.event()?.joinCode;
    return code ? joinLink(this.doc.location.origin, code) : '';
  });

  private requestId = 0;

  constructor() {
    effect(() => {
      this.eventId();
      untracked(() => {
        this.event.set(null);
        void this.load();
      });
    });
    effect(() => {
      const c = this.code();
      if (c) untracked(() => this.joinForm.controls.joinCode.setValue(normalizeCode(c)));
    });
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    try {
      const e = await this.api.event(this.eventId(), this.code() ?? undefined);
      if (id !== this.requestId) return;
      this.event.set(e);
      this.error.set(null);
    } catch (err) {
      if (id === this.requestId) this.error.set(err);
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  protected onCodeInput(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const clean = normalizeCode(el.value);
    if (clean !== el.value) this.joinForm.controls.joinCode.setValue(clean);
    this.joinError.set(null);
  }

  protected async join(): Promise<void> {
    const e = this.event();
    if (!e || this.busy()) return;
    let code: string | undefined;
    if (e.visibility === 'private') {
      code = normalizeCode(this.joinForm.controls.joinCode.value);
      if (!code) {
        this.joinError.set('Enter the join code from the Game Master.');
        return;
      }
      if (!JOIN_CODE_PATTERN.test(code)) {
        this.joinError.set('Codes are 6–10 letters and numbers.');
        return;
      }
    }
    this.busy.set(true);
    this.joinError.set(null);
    try {
      const res = await this.api.joinEvent(e.id, code);
      if (res.status === 'approved') this.toast.success(`You joined ${e.name}`, 'Open the lobby to accept the rules and get ready.');
      else if (res.status === 'pending') this.toast.info('Request sent', 'The Game Master reviews registrations. You will get a notification.');
      await this.load();
    } catch (err) {
      const ae = ApiError.from(err);
      this.joinError.set(ae.fields['joinCode'] ?? ae.fields['code'] ?? ae.message);
      // Capacity or status may have changed: refresh what we show.
      if (ae.status === 409) void this.load();
    } finally {
      this.busy.set(false);
    }
  }

  /** Join a private event whose details we cannot see yet. */
  protected async joinHidden(): Promise<void> {
    if (this.busy()) return;
    const code = normalizeCode(this.joinForm.controls.joinCode.value);
    if (!JOIN_CODE_PATTERN.test(code)) {
      this.joinError.set(code ? 'Codes are 6–10 letters and numbers.' : 'Enter the join code from the Game Master.');
      return;
    }
    this.busy.set(true);
    this.joinError.set(null);
    try {
      const res = await this.api.joinEvent(this.eventId(), code);
      if (res.status === 'approved') this.toast.success('You joined the event', 'Open the lobby to accept the rules and get ready.');
      else this.toast.info('Request sent', 'The Game Master reviews registrations. You will get a notification.');
      await this.load();
    } catch (err) {
      const ae = ApiError.from(err);
      this.joinError.set(ae.fields['joinCode'] ?? ae.message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async withdraw(): Promise<void> {
    const e = this.event();
    if (!e) return;
    const ok = await this.confirm.ask({
      title: 'Withdraw your request?',
      consequences: ['The Game Master no longer sees your request.', e.visibility === 'private' ? 'To ask again you need the join code.' : 'You can request again while registration is open.'],
      confirmLabel: 'Withdraw request',
      destructive: true,
    });
    if (!ok) return;
    await this.runLeave(e, 'Request withdrawn');
  }

  protected async leave(): Promise<void> {
    const e = this.event();
    if (!e) return;
    const live = e.status === 'live' || e.status === 'paused';
    const consequences = [
      this.myTeam() ? `You give up your place in ${this.myTeam()!.name}.` : 'You give up your place in this event.',
      live ? 'Location tracking for this event stops immediately and your position disappears from the map.' : 'Your location will not be tracked for this event.',
    ];
    if (e.requiresApproval || e.visibility === 'private') consequences.push('Coming back needs a new request' + (e.requiresApproval ? ' and Game Master approval.' : ' with the join code.'));
    const ok = await this.confirm.ask({ title: `Leave ${e.name}?`, consequences, confirmLabel: 'Leave event', destructive: true });
    if (!ok) return;
    await this.runLeave(e, `You left ${e.name}`);
  }

  private async runLeave(e: EventDetail, message: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.leaveEvent(e.id);
      if (this.tracker.eventId() === e.id) this.tracker.stop();
      this.toast.info(message);
      await this.load();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async respond(accept: boolean): Promise<void> {
    const e = this.event();
    if (!e) return;
    if (!accept) {
      const ok = await this.confirm.ask({
        title: 'Decline the invitation?',
        consequences: ['The Game Master sees that you declined.', e.visibility === 'private' ? 'Joining later needs the join code.' : 'You can still request to join later.'],
        confirmLabel: 'Decline invitation',
      });
      if (!ok) return;
    }
    this.busy.set(true);
    try {
      const res = await this.api.respondToInvitation(e.id, accept);
      if (accept) this.toast.success(res.status === 'approved' ? `You joined ${e.name}` : 'Invitation accepted — waiting for approval');
      else this.toast.info('Invitation declined');
      await this.load();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async adminDelete(): Promise<void> {
    const e = this.event();
    if (!e) return;
    const registered = e.approvedCount + e.pendingCount;
    const ok = await this.confirm.ask({
      title: `Delete ${e.name}?`,
      consequences: [
        'You are deleting this event as a platform admin.',
        'The event, its teams, map, objectives, perks and results are deleted.',
        registered ? `${registered} registered players lose their place and get a notification.` : 'No players have registered.',
        'This cannot be undone.',
      ],
      destructive: true,
      requireText: 'DELETE',
      confirmLabel: 'Delete event',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.api.deleteEvent(e.id);
      if (this.tracker.eventId() === e.id) this.tracker.stop();
      this.toast.success('Event deleted');
      void this.router.navigate(['/home']);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async copyCode(code: string): Promise<void> {
    if (await copyText(code)) this.flashCopied('code');
    else this.toast.error('Could not copy. Select the code and copy it manually.');
  }

  protected async shareLink(): Promise<void> {
    const e = this.event();
    const url = this.shareUrl();
    if (!e || !url) return;
    const res = await shareOrCopy({ title: e.name, text: `Join ${e.name} on Airsoft Zeus with code ${e.joinCode}`, url });
    if (res === 'copied') this.flashCopied('link');
    else if (res === 'failed') this.toast.error('Could not share the link. Copy the code instead.');
  }

  private flashCopied(what: 'code' | 'link'): void {
    this.copied.set(what);
    setTimeout(() => {
      if (this.copied() === what) this.copied.set(null);
    }, 2000);
  }
}

const MODE_HINTS: Record<EventDetail['gameMode'], string> = {
  sunday: 'A regular Sunday game at the field. Objectives and rules are explained at the briefing.',
  milsim: 'Military simulation: long sessions, chain of command and realistic rules of engagement.',
  scenario: 'A story-driven event with objectives that unlock as the scenario unfolds.',
  championship: 'A competitive match that counts towards the championship standings.',
  plr: 'PLR event. The Game Master explains the format at the briefing.',
  pcr: 'PCR event. The Game Master explains the format at the briefing.',
  custom: 'The Game Master explains the scenario at the briefing.',
};
