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
import { AttachmentList } from '../../shared/attachments';
import { ConnectionStatus } from '../../shared/link-status';
import { ErrorState, PageHeader } from '../../shared/states';
import { StatusChip, eventStatusChip } from '../../shared/status-chip';
import { TeamBadge } from '../../shared/team-badge';
import { JOIN_CODE_PATTERN, copyText, joinLink, normalizeCode, shareOrCopy } from './share-utils';

type Membership = 'gm' | 'none' | MemberStatus;

const TEAM_SELECTION_LABELS: Record<EventDetail['teamSelection'], string> = {
  gm: $localize`Assigned by the Game Master`,
  auto: $localize`Balanced automatically`,
  player: $localize`Players choose their team`,
};

/** Event page: briefing, rules and the join / membership actions. */
@Component({
  selector: 'zeus-event-details-screen',
  imports: [ReactiveFormsModule, RouterLink, NgIcon, HlmButton, HlmInput, HlmLabel, ErrorState, PageHeader, StatusChip, TeamBadge, ConnectionStatus, AttachmentList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (loading() && !event()) {
        <div class="flex flex-col gap-4" role="status" aria-label="Loading event" i18n-aria-label>
          <div class="aspect-16/7 w-full animate-pulse rounded-md bg-muted"></div>
          <div class="h-8 w-2/3 animate-pulse rounded-sm bg-muted"></div>
          <div class="h-4 w-1/2 animate-pulse rounded-sm bg-muted"></div>
          <div class="h-32 w-full animate-pulse rounded-md bg-muted"></div>
          <span class="sr-only" i18n>Loading…</span>
        </div>
      } @else if (error() && !event() && hiddenPrivate()) {
        <!-- Private events are invisible to non-members (API answers 404): join blind with the code. -->
        <zeus-page-header title="Private event" back="/events/join" backLabel="Join with a code" i18n-title i18n-backLabel />
        <section class="panel mx-auto flex max-w-md flex-col gap-3 p-4" aria-labelledby="blind-join-title">
          <h2 id="blind-join-title" class="text-lg uppercase"><ng-icon name="lucideLock" size="18" class="mr-1 align-[-2px]" aria-hidden="true" /> <ng-container i18n>Join with your code</ng-container></h2>
          <p class="text-sm text-muted-foreground" i18n>The details of this private event are shown once you are registered. The Game Master may need to approve your request.</p>
          <form class="flex flex-col gap-3" [formGroup]="joinForm" (ngSubmit)="joinHidden()" novalidate>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="blind-join-code" i18n>Join code</label>
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
                <ng-icon name="lucideLoader2" size="18" class="animate-spin" aria-hidden="true" /> <ng-container i18n>Sending…</ng-container>
              } @else {
                <ng-icon name="lucideUserPlus" size="18" aria-hidden="true" /> <ng-container i18n>Join event</ng-container>
              }
            </button>
          </form>
        </section>
      } @else if (error() && !event()) {
        <zeus-page-header title="Event" back="/events/mine" backLabel="My events" i18n-title i18n-backLabel />
        <zeus-error-state [error]="error()" [title]="errorTitle()" (retry)="load()">
          <a hlmBtn variant="ghost" class="tap" routerLink="/events/join" i18n>Enter a join code</a>
        </zeus-error-state>
      } @else if (event(); as e) {
        <zeus-page-header [title]="e.name" [eyebrow]="modeLabel()" [back]="e.isGm ? '/events/mine?tab=gm' : '/events/mine'" backLabel="My events" i18n-backLabel>
          <zeus-status-chip [spec]="statusChip()" />
        </zeus-page-header>

        @if (offline()) {
          <div class="mb-3 flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning-surface px-3 py-2 text-sm" role="status">
            <span i18n>Showing saved details. Actions need a connection.</span>
            <zeus-connection-status />
          </div>
        }

        @if (e.status === 'cancelled') {
          <div class="mb-4 flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4" role="alert">
            <ng-icon name="lucideBan" size="22" class="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <p class="font-bold uppercase" i18n>✕ Event cancelled</p>
              <p class="text-sm text-muted-foreground" i18n>The Game Master cancelled this event. Nothing will be tracked and no game will take place.</p>
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
                  <span class="hud inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold"><ng-icon name="lucideLock" size="12" aria-hidden="true" /> <ng-container i18n>Private</ng-container></span>
                }
                @if (e.isTestData) {
                  <span class="hud px-2 py-1 text-xs font-semibold" i18n>Test data</span>
                }
              </div>
            </div>

            <!-- Key facts -->
            <section aria-labelledby="facts-title">
              <h2 id="facts-title" class="label-caps mb-2" i18n>Briefing</h2>
              <dl class="panel grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
                <div class="flex gap-3 p-3 sm:border-b sm:border-border">
                  <ng-icon name="lucideCalendarDays" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt class="label-caps" i18n>Date</dt>
                    <dd class="font-semibold">{{ dateLabel() }}</dd>
                    <dd class="num text-sm text-muted-foreground">{{ timeLabel() }} · {{ durationLabel() }}</dd>
                  </div>
                </div>
                <div class="flex gap-3 p-3 sm:border-b sm:border-l sm:border-border">
                  <ng-icon name="lucideUsers" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt class="label-caps" i18n>Players</dt>
                    <dd class="font-semibold" i18n><span class="num">{{ e.approvedCount }} / {{ e.maxPlayers }}</span> registered</dd>
                    <dd class="text-sm text-muted-foreground">
                      <ng-container i18n>Minimum <span class="num">{{ e.minPlayers }}</span></ng-container>
                      @if (e.isGm && e.pendingCount) {
                        · <span class="text-warning" i18n>◐ <span class="num">{{ e.pendingCount }}</span> pending</span>
                      }
                    </dd>
                  </div>
                </div>
                <div class="flex gap-3 p-3 sm:col-span-2 sm:border-b sm:border-border">
                  <ng-icon name="lucideMapPin" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div class="min-w-0 flex-1">
                    <dt class="label-caps" i18n>Meeting point</dt>
                    <dd class="font-semibold">{{ e.meetingAddress || (hasMeetingCoords() ? txt.pinnedLocation : txt.sharedByTheGame) }}</dd>
                    @if (hasMeetingCoords()) {
                      <dd class="num text-xs text-muted-foreground">{{ e.meetingLat!.toFixed(5) }}, {{ e.meetingLng!.toFixed(5) }}</dd>
                    }
                  </div>
                  @if (directionsUrl()) {
                    <a hlmBtn variant="outline" class="tap shrink-0 self-center" [href]="directionsUrl()" target="_blank" rel="noopener noreferrer">
                      <ng-icon name="lucideNavigation" size="16" class="text-nav" aria-hidden="true" /> <ng-container i18n>Directions
                      <span class="sr-only">(opens Google Maps)</span></ng-container>
                    </a>
                  }
                </div>
                <div class="flex gap-3 p-3">
                  <ng-icon [name]="e.visibility === 'private' ? 'lucideLock' : 'lucideGlobe'" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt class="label-caps" i18n>Access</dt>
                    <dd class="font-semibold">{{ e.visibility === 'private' ? txt.privateJoinCodeNeeded : txt.public }}</dd>
                    <dd class="text-sm text-muted-foreground">{{ e.requiresApproval ? txt.theGameMasterApproves : txt.registrationsAreAcceptedAutomatically }}</dd>
                  </div>
                </div>
                <div class="flex gap-3 p-3 sm:border-l sm:border-border">
                  <ng-icon name="lucideFlag" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt class="label-caps" i18n>Teams</dt>
                    <dd class="font-semibold">{{ teamSelectionLabel() }}</dd>
                    @if (e.teamsLocked) {
                      <dd class="text-sm text-muted-foreground" i18n>■ Teams are locked</dd>
                    }
                  </div>
                </div>
              </dl>
            </section>

            @if (e.description) {
              <section aria-labelledby="about-title">
                <h2 id="about-title" class="label-caps mb-2" i18n>About this event</h2>
                <p class="whitespace-pre-line">{{ e.description }}</p>
              </section>
            }

            <section aria-labelledby="mode-title">
              <h2 id="mode-title" class="label-caps mb-2" i18n>Game mode · {{ modeLabel() }}</h2>
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
                <h2 id="teams-title" class="label-caps mb-2" i18n>Teams · <span class="num">{{ e.teams.length }}</span></h2>
                <ul class="grid gap-2 sm:grid-cols-2">
                  @for (t of sortedTeams(); track t.id) {
                    <li class="panel flex items-center justify-between gap-3 p-3" [class.border-primary]="t.id === e.myTeamId">
                      <zeus-team-badge [team]="t" />
                      <span class="text-right text-sm">
                        <span class="num font-semibold">{{ t.memberCount }}{{ t.capacity ? ' / ' + t.capacity : '' }}</span>
                        <span class="text-muted-foreground" i18n> players</span>
                        @if (t.id === e.myTeamId) {
                          <span class="block text-xs font-semibold text-primary" i18n>✓ Your team</span>
                        } @else if (t.capacity && t.memberCount >= t.capacity) {
                          <span class="block text-xs text-muted-foreground" i18n>■ Full</span>
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

            @if (e.attachmentCount) {
              <section aria-labelledby="att-title">
                <h2 id="att-title" class="label-caps mb-2 flex items-center gap-1.5">
                  <ng-icon name="lucidePaperclip" size="14" aria-hidden="true" /> <ng-container i18n>Attachments · <span class="num">{{ e.attachmentCount }}</span></ng-container>
                </h2>
                @if (e.attachments.length) {
                  <zeus-attachment-list [eventId]="e.id" [attachments]="e.attachments" />
                } @else {
                  <p class="panel flex items-center gap-2 p-4 text-sm text-muted-foreground">
                    <ng-icon name="lucideLock" size="16" class="shrink-0" aria-hidden="true" /> {{ attachmentsHint() }}
                  </p>
                }
              </section>
            }

            @if (e.gameMasters.length) {
              <section aria-labelledby="gm-title">
                <h2 id="gm-title" class="label-caps mb-2" i18n>Game Masters</h2>
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
          <aside class="flex flex-col gap-4 lg:sticky lg:top-4" aria-label="Your participation" i18n-aria-label>
            <section class="panel flex flex-col gap-3 p-4" aria-labelledby="action-title">
              @switch (membership()) {
                @case ('gm') {
                  <h2 id="action-title" class="text-lg uppercase" i18n>You run this event</h2>
                  <div class="flex flex-col gap-2">
                    @if (e.status === 'live' || e.status === 'paused' || e.status === 'lobby') {
                      <a hlmBtn class="h-12" [routerLink]="['/gm/events', e.id, 'control']"><ng-icon name="lucideLayoutDashboard" size="18" aria-hidden="true" /> <ng-container i18n>Control center</ng-container></a>
                    }
                    @if (lobbyStatus()) {
                      <a hlmBtn [variant]="e.status === 'lobby' ? 'outline' : 'default'" class="h-12" [routerLink]="['/events', e.id, 'lobby']"><ng-icon name="lucideUsers" size="18" aria-hidden="true" /> <ng-container i18n>Open lobby</ng-container></a>
                    } @else if (e.status === 'live' || e.status === 'paused') {
                      <a hlmBtn variant="outline" class="h-11" [routerLink]="['/events', e.id, 'lobby']"><ng-icon name="lucideUsers" size="16" aria-hidden="true" /> <ng-container i18n>Play in a team</ng-container></a>
                    }
                    @if (e.status === 'completed') {
                      <a hlmBtn class="h-12" [routerLink]="['/events', e.id, 'results']"><ng-icon name="lucideTrophy" size="18" aria-hidden="true" /> <ng-container i18n>View results</ng-container></a>
                    }
                    <a hlmBtn variant="outline" class="h-11" [routerLink]="['/gm/events', e.id]"><ng-icon name="lucidePencil" size="16" aria-hidden="true" /> <ng-container i18n>Edit event</ng-container></a>
                    <a hlmBtn variant="outline" class="h-11" [routerLink]="['/gm/events', e.id, 'players']">
                      <ng-icon name="lucideUserCheck" size="16" aria-hidden="true" /> <ng-container i18n>Manage players</ng-container>
                      @if (e.pendingCount) {
                        <span class="num rounded-sm bg-warning-surface px-1.5 text-xs text-warning">{{ e.pendingCount }}</span>
                      }
                    </a>
                  </div>
                }
                @case ('approved') {
                  <h2 id="action-title" class="text-lg uppercase" i18n>✓ You're registered</h2>
                  @if (myTeam(); as t) {
                    <p class="flex items-center gap-2 text-sm"><span class="label-caps" i18n>Team</span> <zeus-team-badge [team]="t" size="sm" /></p>
                  } @else if (e.status !== 'completed' && e.status !== 'cancelled') {
                    <p class="text-sm text-muted-foreground" i18n>No team yet. {{ e.teamSelection === 'player' ? txt.pickOneInThe : txt.theGameMasterAssigns }}</p>
                  }
                  @switch (e.status) {
                    @case ('live') {
                      <a hlmBtn class="h-12" [routerLink]="['/events', e.id, 'live']"><ng-icon name="lucideMap" size="18" aria-hidden="true" /> <ng-container i18n>Open live map</ng-container></a>
                    }
                    @case ('paused') {
                      <a hlmBtn class="h-12" [routerLink]="['/events', e.id, 'live']"><ng-icon name="lucideMap" size="18" aria-hidden="true" /> <ng-container i18n>Open live map</ng-container></a>
                      <p class="text-sm text-warning" i18n>❚❚ The game is paused.</p>
                    }
                    @case ('completed') {
                      <a hlmBtn class="h-12" [routerLink]="['/events', e.id, 'results']"><ng-icon name="lucideTrophy" size="18" aria-hidden="true" /> <ng-container i18n>View results</ng-container></a>
                    }
                    @case ('cancelled') {}
                    @case ('draft') {
                      <p class="text-sm text-muted-foreground" i18n>The Game Master is still preparing this event.</p>
                    }
                    @default {
                      <a hlmBtn class="h-12" [routerLink]="['/events', e.id, 'lobby']"><ng-icon name="lucideUsers" size="18" aria-hidden="true" /> <ng-container i18n>Open lobby</ng-container></a>
                      <p class="text-sm text-muted-foreground" i18n>Accept the rules and get ready in the lobby before the start.</p>
                    }
                  }
                  @if (e.status !== 'completed' && e.status !== 'cancelled') {
                    <button hlmBtn variant="ghost" type="button" class="tap text-destructive" [disabled]="busy()" (click)="leave()">
                      <ng-icon name="lucideLogOut" size="16" aria-hidden="true" /> <ng-container i18n>Leave event</ng-container>
                    </button>
                  }
                }
                @case ('pending') {
                  <h2 id="action-title" class="text-lg uppercase" i18n>◐ Waiting for GM approval</h2>
                  <p class="text-sm text-muted-foreground" i18n>Your request was sent. You get a notification when the Game Master reviews it.</p>
                  <button hlmBtn variant="outline" type="button" class="h-11" [disabled]="busy()" (click)="withdraw()">
                    <ng-icon name="lucideX" size="16" aria-hidden="true" /> <ng-container i18n>Withdraw request</ng-container>
                  </button>
                }
                @case ('invited') {
                  <h2 id="action-title" class="text-lg uppercase" i18n>✉ You're invited</h2>
                  <p class="text-sm text-muted-foreground" i18n>The Game Master invited you to this event.</p>
                  <div class="flex gap-2">
                    <button hlmBtn type="button" class="h-12 flex-1" [disabled]="busy()" (click)="respond(true)"><ng-icon name="lucideCheck" size="18" aria-hidden="true" /> <ng-container i18n>Accept</ng-container></button>
                    <button hlmBtn variant="outline" type="button" class="h-12 flex-1" [disabled]="busy()" (click)="respond(false)" i18n>Decline</button>
                  </div>
                }
                @case ('banned') {
                  <h2 id="action-title" class="text-lg uppercase" i18n>Banned from this event</h2>
                  <p class="text-sm text-muted-foreground" i18n>The Game Master banned you from this event. Contact them if you think this is a mistake.</p>
                }
                @case ('rejected') {
                  <h2 id="action-title" class="text-lg uppercase" i18n>Request declined</h2>
                  <p class="text-sm text-muted-foreground" i18n>The Game Master declined your registration for this event.</p>
                }
                @default {
                  <h2 id="action-title" class="text-lg uppercase" i18n>Join this event</h2>
                  @if (membership() === 'removed') {
                    <p class="text-sm text-muted-foreground" i18n>The Game Master removed you from this event. You can join again.</p>
                  }
                  @if (joinBlock(); as reason) {
                    <p class="rounded-sm border border-border bg-muted p-3 text-sm" role="status">■ {{ reason }}</p>
                    @if (e.status === 'completed') {
                      <a hlmBtn variant="outline" class="h-11" [routerLink]="['/events', e.id, 'results']" i18n>View results</a>
                    }
                  } @else {
                    <form class="flex flex-col gap-3" [formGroup]="joinForm" (ngSubmit)="join()" novalidate>
                      @if (e.visibility === 'private') {
                        <div class="flex flex-col gap-1.5">
                          <label hlmLabel for="details-join-code" i18n>Join code</label>
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
                        <p class="text-sm text-muted-foreground" i18n>◐ The Game Master approves registrations. You'll be notified.</p>
                      }
                      @if (spotsLeft() !== null && spotsLeft()! <= 5) {
                        <p class="text-sm text-warning" i18n>▲ {spotsLeft(), plural, =1 {<span class="num">1</span> place left} other {<span class="num">{{ spotsLeft() }}</span> places left}}</p>
                      }
                      <button hlmBtn type="submit" class="h-12" [disabled]="busy()">
                        @if (busy()) {
                          <ng-icon name="lucideLoader2" size="18" class="animate-spin" aria-hidden="true" /> <ng-container i18n>Sending…</ng-container>
                        } @else {
                          <ng-icon name="lucideUserPlus" size="18" aria-hidden="true" /> {{ e.requiresApproval ? txt.requestToJoin : txt.joinEvent }}
                        }
                      </button>
                    </form>
                  }
                }
              }
            </section>

            @if (e.isGm && e.joinCode && e.status !== 'cancelled' && e.status !== 'completed') {
              <section class="panel flex flex-col gap-3 p-4" aria-labelledby="share-title">
                <h2 id="share-title" class="label-caps" i18n>Invite players</h2>
                <div class="flex items-center justify-between gap-2 rounded-sm border border-dashed border-border bg-muted px-3 py-2">
                  <div>
                    <p class="label-caps" i18n>Join code</p>
                    <p class="num text-2xl font-bold tracking-[0.2em]">{{ e.joinCode }}</p>
                  </div>
                  <button hlmBtn variant="outline" type="button" class="tap" (click)="copyCode(e.joinCode)" aria-label="Copy join code" i18n-aria-label>
                    <ng-icon [name]="copied() === 'code' ? 'lucideCheck' : 'lucideCopy'" size="16" aria-hidden="true" /> {{ copied() === 'code' ? txt.copied : txt.copy }}
                  </button>
                </div>
                <p class="num truncate text-xs text-muted-foreground" [title]="shareUrl()">{{ shareUrl() }}</p>
                <button hlmBtn type="button" variant="secondary" class="h-11" (click)="shareLink()">
                  <ng-icon [name]="copied() === 'link' ? 'lucideCheck' : 'lucideShare2'" size="16" aria-hidden="true" /> {{ copied() === 'link' ? txt.linkCopied : txt.shareInviteLink }}
                </button>
              </section>
            }

            @if (isAdmin()) {
              <section class="panel flex flex-col gap-2 p-4" aria-labelledby="admin-title">
                <h2 id="admin-title" class="label-caps"><ng-icon name="lucideShield" size="14" class="mr-1 align-[-2px]" aria-hidden="true" /> <ng-container i18n>Admin</ng-container></h2>
                <button hlmBtn variant="destructive" class="h-11 justify-start" type="button" (click)="adminDelete()" [disabled]="busy()">
                  <ng-icon name="lucideTrash2" size="16" aria-hidden="true" /> <ng-container i18n>Delete event</ng-container>
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
  /** UI text used inside template expressions. */
  protected readonly txt = {
    pinnedLocation: $localize`Pinned location`,
    sharedByTheGame: $localize`Shared by the Game Master before the game`,
    privateJoinCodeNeeded: $localize`Private — join code needed`,
    public: $localize`Public`,
    theGameMasterApproves: $localize`The Game Master approves registrations`,
    registrationsAreAcceptedAutomatically: $localize`Registrations are accepted automatically`,
    pickOneInThe: $localize`Pick one in the lobby.`,
    theGameMasterAssigns: $localize`The Game Master assigns teams before the start.`,
    requestToJoin: $localize`Request to join`,
    joinEvent: $localize`Join event`,
    copied: $localize`Copied`,
    copy: $localize`Copy`,
    linkCopied: $localize`Link copied`,
    shareInviteLink: $localize`Share invite link`,
  };

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
    if (e.status === 404) return $localize`Event not found`;
    if (e.status === 403) return $localize`This event is private`;
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
      { id: 'rules', title: $localize`Rules`, icon: 'lucideListChecks', text: e.rules },
      { id: 'safety', title: $localize`Safety rules`, icon: 'lucideTriangleAlert', text: e.safetyRules },
      { id: 'equipment', title: $localize`Required equipment`, icon: 'lucidePackage', text: e.requiredEquipment },
      { id: 'chrono', title: $localize`Chronograph and power limits`, icon: 'lucideGauge', text: e.chronoInfo },
    ].filter((s) => !!s.text?.trim());
  });

  protected readonly membership = computed<Membership>(() => {
    const e = this.event();
    if (!e) return 'none';
    if (e.isGm) return 'gm';
    const status = e.me?.status ?? e.myStatus;
    return status ?? 'none';
  });

  /** Why the attachments are not downloadable yet (only GMs and approved players get them). */
  protected readonly attachmentsHint = computed(() => {
    switch (this.membership()) {
      case 'pending':
        return $localize`Available to download once the Game Master approves your registration.`;
      case 'invited':
        return $localize`Accept the invitation to download the documents the Game Master shared.`;
      case 'none':
      case 'left':
      case 'removed':
        return $localize`The Game Master shared documents for the players, like the game book. Join the event to download them.`;
      default:
        return $localize`Only registered players can download these documents.`;
    }
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
        return $localize`This event was cancelled.`;
      case 'completed':
        return $localize`This event has ended.`;
      case 'live':
      case 'paused':
        return $localize`The game has already started. Registration is closed.`;
      case 'draft':
      case 'published':
        return $localize`Registration has not opened yet. Check back later.`;
    }
    if (e.registrationLocked) return $localize`The Game Master has closed registration.`;
    if (e.approvedCount >= e.maxPlayers) return $localize`This event is full.`;
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
        this.joinError.set($localize`Enter the join code from the Game Master.`);
        return;
      }
      if (!JOIN_CODE_PATTERN.test(code)) {
        this.joinError.set($localize`Codes are 6–10 letters and numbers.`);
        return;
      }
    }
    this.busy.set(true);
    this.joinError.set(null);
    try {
      const res = await this.api.joinEvent(e.id, code);
      if (res.status === 'approved') this.toast.success($localize`You joined ${e.name}:name:`, $localize`Open the lobby to accept the rules and get ready.`);
      else if (res.status === 'pending') this.toast.info($localize`Request sent`, $localize`The Game Master reviews registrations. You will get a notification.`);
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
      this.joinError.set(code ? $localize`Codes are 6–10 letters and numbers.` : $localize`Enter the join code from the Game Master.`);
      return;
    }
    this.busy.set(true);
    this.joinError.set(null);
    try {
      const res = await this.api.joinEvent(this.eventId(), code);
      if (res.status === 'approved') this.toast.success($localize`You joined the event`, $localize`Open the lobby to accept the rules and get ready.`);
      else this.toast.info($localize`Request sent`, $localize`The Game Master reviews registrations. You will get a notification.`);
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
      title: $localize`Withdraw your request?`,
      consequences: [$localize`The Game Master no longer sees your request.`, e.visibility === 'private' ? $localize`To ask again you need the join code.` : $localize`You can request again while registration is open.`],
      confirmLabel: $localize`Withdraw request`,
      destructive: true,
    });
    if (!ok) return;
    await this.runLeave(e, $localize`Request withdrawn`);
  }

  protected async leave(): Promise<void> {
    const e = this.event();
    if (!e) return;
    const live = e.status === 'live' || e.status === 'paused';
    const consequences = [
      this.myTeam() ? $localize`You give up your place in ${this.myTeam()!.name}:name:.` : $localize`You give up your place in this event.`,
      live ? $localize`Location tracking for this event stops immediately and your position disappears from the map.` : $localize`Your location will not be tracked for this event.`,
    ];
    if (e.requiresApproval || e.visibility === 'private') consequences.push(e.requiresApproval ? $localize`Coming back needs a new request and Game Master approval.` : $localize`Coming back needs a new request with the join code.`);
    const ok = await this.confirm.ask({ title: $localize`Leave ${e.name}:name:?`, consequences, confirmLabel: $localize`Leave event`, destructive: true });
    if (!ok) return;
    await this.runLeave(e, $localize`You left ${e.name}:name:`);
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
        title: $localize`Decline the invitation?`,
        consequences: [$localize`The Game Master sees that you declined.`, e.visibility === 'private' ? $localize`Joining later needs the join code.` : $localize`You can still request to join later.`],
        confirmLabel: $localize`Decline invitation`,
      });
      if (!ok) return;
    }
    this.busy.set(true);
    try {
      const res = await this.api.respondToInvitation(e.id, accept);
      if (accept) this.toast.success(res.status === 'approved' ? $localize`You joined ${e.name}:name:` : $localize`Invitation accepted — waiting for approval`);
      else this.toast.info($localize`Invitation declined`);
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
      title: $localize`Delete ${e.name}:name:?`,
      consequences: [
        $localize`You are deleting this event as a platform admin.`,
        $localize`The event, its teams, map, objectives, perks and results are deleted.`,
        registered ? $localize`${registered}:registered: registered players lose their place and get a notification.` : $localize`No players have registered.`,
        $localize`This cannot be undone.`,
      ],
      destructive: true,
      requireText: $localize`:typed confirmation word|:DELETE`,
      confirmLabel: $localize`Delete event`,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.api.deleteEvent(e.id);
      if (this.tracker.eventId() === e.id) this.tracker.stop();
      this.toast.success($localize`Event deleted`);
      void this.router.navigate(['/home']);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async copyCode(code: string): Promise<void> {
    if (await copyText(code)) this.flashCopied('code');
    else this.toast.error($localize`Could not copy. Select the code and copy it manually.`);
  }

  protected async shareLink(): Promise<void> {
    const e = this.event();
    const url = this.shareUrl();
    if (!e || !url) return;
    const res = await shareOrCopy({ title: e.name, text: $localize`Join ${e.name}:name: on AirsoftHub with code ${e.joinCode}:joinCode:`, url });
    if (res === 'copied') this.flashCopied('link');
    else if (res === 'failed') this.toast.error($localize`Could not share the link. Copy the code instead.`);
  }

  private flashCopied(what: 'code' | 'link'): void {
    this.copied.set(what);
    setTimeout(() => {
      if (this.copied() === what) this.copied.set(null);
    }, 2000);
  }
}

const MODE_HINTS: Record<EventDetail['gameMode'], string> = {
  sunday: $localize`A regular Sunday game at the field. Objectives and rules are explained at the briefing.`,
  milsim: $localize`Military simulation: long sessions, chain of command and realistic rules of engagement.`,
  scenario: $localize`A story-driven event with objectives that unlock as the scenario unfolds.`,
  championship: $localize`A competitive match that counts towards the championship standings.`,
  plr: $localize`PLR event. The Game Master explains the format at the briefing.`,
  pcr: $localize`PCR event. The Game Master explains the format at the briefing.`,
  custom: $localize`The Game Master explains the scenario at the briefing.`,
};
