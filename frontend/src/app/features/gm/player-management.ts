import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { filter } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { EventDetail, Member, MemberStatus, PermissionState, Squad, Team } from '../../core/api/models';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { PLAYER_ROLE_LABELS, formatDateTime, formatNumber, formatRelative, initials } from '../../core/util/format';
import { PlayerListItem } from '../../shared/cards';
import { ConnectionStatus } from '../../shared/link-status';
import { SquadBadge } from '../../shared/squad-badge';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { ChipSpec, StatusChip } from '../../shared/status-chip';
import { TeamBadge } from '../../shared/team-badge';
import { GmPanel } from './common/controls';
import { staticFormTick } from './common/form-utils';
import { DESKTOP_QUERY, mediaQuery } from '../../core/ui/media';
import { MemberAssign, isRunning } from './common/member-assign';

type StatusFilter = 'pending' | 'approved' | 'invited' | 'rejected' | 'removed';
type SortKey = 'nickname' | 'status' | 'team' | 'lastSeen' | 'points';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: $localize`Pending` },
  { value: 'approved', label: $localize`Approved` },
  { value: 'invited', label: $localize`Invited` },
  { value: 'rejected', label: $localize`Rejected` },
  { value: 'removed', label: $localize`Removed / banned / left` },
];

const STATUS_CHIPS: Record<MemberStatus, ChipSpec> = {
  pending: { label: $localize`Waiting for approval`, glyph: '◐', tone: 'warning' },
  approved: { label: $localize`Approved`, glyph: '✓', tone: 'primary' },
  invited: { label: $localize`Invited`, glyph: '✉', tone: 'nav' },
  rejected: { label: $localize`Rejected`, glyph: '✕', tone: 'danger' },
  removed: { label: $localize`Removed`, glyph: '✕', tone: 'danger' },
  banned: { label: $localize`Banned`, glyph: '⊘', tone: 'danger' },
  left: { label: $localize`Left`, glyph: '○', tone: 'neutral' },
};

const PERMISSION_LABELS: Record<PermissionState, string> = {
  granted: $localize`● Allowed`,
  denied: $localize`✕ Blocked`,
  prompt: $localize`◐ Not answered`,
  unknown: $localize`○ Unknown`,
};

function filterOf(s: MemberStatus): StatusFilter {
  return s === 'left' || s === 'banned' ? 'removed' : s;
}

@Component({
  selector: 'zeus-player-management-screen',
  imports: [
    ReactiveFormsModule,
    NgTemplateOutlet,
    RouterLink,
    NgIcon,
    HlmButton,
    HlmInput,
    HlmLabel,
    PageHeader,
    LoadingSkeleton,
    ErrorState,
    EmptyState,
    PlayerListItem,
    StatusChip,
    TeamBadge,
    SquadBadge,
    MemberAssign,
    GmPanel,
    ConnectionStatus,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <zeus-page-header title="Players" [eyebrow]="event()?.name ?? null" [back]="'/gm/events/' + eventId()" backLabel="Event editor" [subtitle]="subtitle()" i18n-title i18n-backLabel>
        <zeus-connection-status [compact]="true" [quietOnline]="true" />
        <a hlmBtn variant="outline" class="h-11" [routerLink]="['/gm/events', eventId(), 'teams']">
          <ng-icon name="lucideUsers" size="16" aria-hidden="true" /> <ng-container i18n>Teams and squads</ng-container>
        </a>
      </zeus-page-header>

      <!-- Invite -->
      <form [formGroup]="inviteForm" (ngSubmit)="invite()" class="panel mb-4 flex flex-col gap-1.5 p-3" [attr.data-rev]="inviteTick()">
        <label hlmLabel for="inv-nick" i18n>Invite a player by nickname</label>
        <div class="flex gap-2">
          <input hlmInput id="inv-nick" class="h-11 flex-1" formControlName="nickname" autocomplete="off" placeholder="nickname" [attr.aria-invalid]="!!inviteError()" aria-describedby="inv-e" i18n-placeholder />
          <button hlmBtn class="h-11" type="submit" [disabled]="inviting()">
            <ng-icon name="lucideMail" size="16" aria-hidden="true" /> {{ inviting() ? txt.inviting : txt.invite }}
          </button>
        </div>
        @if (inviteError(); as m) {
          <p id="inv-e" class="field-error">{{ m }}</p>
        }
      </form>

      <!-- Filters -->
      <div class="mb-3 flex flex-col gap-3">
        <div role="radiogroup" aria-label="Filter by status" class="relative -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" i18n-aria-label>
          @for (f of statusFilters; track f.value) {
            <label class="flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-sm border px-3 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring"
              [class]="status() === f.value ? 'border-primary bg-primary/10 font-semibold' : 'border-border text-muted-foreground hover:text-foreground'">
              <input type="radio" name="status-filter" class="sr-only" [checked]="status() === f.value" (change)="setStatus(f.value)" />
              {{ f.label }}
              <span class="num rounded-sm px-1 text-xs" [class]="f.value === 'pending' && counts()[f.value] ? 'bg-warning text-warning-foreground' : 'bg-muted'">{{ counts()[f.value] }}</span>
            </label>
          }
        </div>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_14rem]">
          <div class="relative">
            <label for="pl-search" class="sr-only" i18n>Search by nickname</label>
            <ng-icon name="lucideSearch" size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input hlmInput id="pl-search" type="search" class="h-11 pl-9" placeholder="Search by nickname" [value]="search()" (input)="search.set($any($event.target).value)" i18n-placeholder />
          </div>
          <div>
            <label for="pl-team" class="sr-only" i18n>Filter by team</label>
            <select id="pl-team" class="h-11 w-full rounded-md border border-input bg-background px-2.5 text-sm dark:bg-input/30" (change)="teamFilter.set($any($event.target).value)">
              <option value="" [selected]="teamFilter() === ''" i18n>All teams</option>
              <option value="none" [selected]="teamFilter() === 'none'" i18n>No team</option>
              @for (t of teams(); track t.id) {
                <option [value]="t.id" [selected]="teamFilter() === t.id">{{ t.name }}</option>
              }
            </select>
          </div>
        </div>
        @if (status() === 'pending' && visible().length) {
          <div class="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-muted px-3 py-1">
            <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" class="size-5 accent-primary" [checked]="allSelected()" [indeterminate]="someSelected()" (change)="toggleAll()" />
              <ng-container i18n>Select all ({{ visible().length }})</ng-container>
            </label>
            <button hlmBtn class="ml-auto h-11" type="button" [disabled]="!selected().size || bulkBusy()" (click)="bulkApprove()">
              <ng-icon name="lucideUserCheck" size="16" aria-hidden="true" />
              @if (bulkBusy()) {
                {{ txt.approving }}
              } @else {
                <ng-container i18n>Approve selected ({{ selected().size }})</ng-container>
              }
            </button>
          </div>
        }
      </div>

      <div [class]="detailId() && desktop() ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]' : 'grid gap-4'">
        <div class="min-w-0">
          @if (loading() && !members()) {
            <zeus-loading-skeleton [rows]="6" [avatar]="true" />
          } @else if (loadError(); as err) {
            <zeus-error-state [error]="err" (retry)="load()" />
          } @else if (!visible().length) {
            <zeus-empty-state icon="lucideUsers" [title]="emptyTitle()" [message]="search() || teamFilter() ? txt.noPlayerMatchesThe : null" />
          } @else if (desktop()) {
            <!-- Desktop table -->
            <div class="relative panel overflow-x-auto">
              <table class="w-full text-left text-sm">
                <caption class="sr-only" i18n>{{ statusLabel() }} players, {{ visible().length }} shown</caption>
                <thead class="border-b border-border">
                  <tr>
                    @if (status() === 'pending') {
                      <th scope="col" class="w-10 px-3"><span class="sr-only" i18n>Select</span></th>
                    }
                    @for (c of columns; track c.key) {
                      <th scope="col" class="px-3 py-2" [attr.aria-sort]="sortKey() === c.key ? (sortDir() === 1 ? 'ascending' : 'descending') : null">
                        <button type="button" class="label-caps inline-flex min-h-11 items-center gap-1 hover:text-foreground" (click)="sortBy(c.key)">
                          {{ c.label }}
                          <span aria-hidden="true" class="num">{{ sortKey() === c.key ? (sortDir() === 1 ? '▲' : '▼') : '↕' }}</span>
                        </button>
                      </th>
                    }
                    <th scope="col" class="label-caps px-3 py-2" i18n>Ready</th>
                    <th scope="col" class="label-caps px-3 py-2" i18n>Location</th>
                    <th scope="col" class="px-3 py-2"><span class="sr-only" i18n>Actions</span></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border">
                  @for (m of visible(); track m.userId) {
                    <tr [class]="detailId() === m.userId ? 'bg-primary/5' : ''">
                      @if (status() === 'pending') {
                        <td class="px-3">
                          <input type="checkbox" class="size-5 accent-primary" [checked]="selected().has(m.userId)" (change)="toggleSelect(m.userId)" ariaLabel="Select {{ m.nickname }}" i18n-ariaLabel />
                        </td>
                      }
                      <td class="px-3 py-2">
                        <button type="button" class="flex min-h-11 items-center gap-2 text-left hover:underline" (click)="openDetail(m)">
                          @if (m.avatarUrl) {
                            <img [src]="m.avatarUrl" alt="" class="size-8 rounded-full object-cover" />
                          } @else {
                            <span class="grid size-8 place-items-center rounded-full bg-muted text-xs font-bold" aria-hidden="true">{{ initialsOf(m.nickname) }}</span>
                          }
                          <span>
                            <span class="block font-semibold">{{ m.nickname }}</span>
                            @if (m.playerRole) {
                              <span class="block text-xs text-muted-foreground">{{ roleLabel(m) }}</span>
                            }
                          </span>
                        </button>
                      </td>
                      <td class="px-3 py-2"><zeus-status-chip [spec]="chipOf(m)" /></td>
                      <td class="px-3 py-2">
                        @if (m.status === 'approved') {
                          <zeus-member-assign [eventId]="eventId()" [member]="m" [teams]="teams()" [squads]="squads()" [running]="running()" (assigned)="onAssigned($event)" />
                        } @else {
                          <span class="flex flex-wrap items-center gap-1.5">
                            <zeus-team-badge [team]="teamOf(m)" size="sm" emptyLabel="—" />
                            @if (squadOf(m); as s) {
                              <zeus-squad-badge [squad]="s" [leader]="m.isSquadLeader" />
                            }
                          </span>
                        }
                      </td>
                      <td class="num px-3 py-2 text-xs text-muted-foreground">{{ m.online ? txt.online : m.lastSeenAt ? relative(m.lastSeenAt) : '—' }}</td>
                      <td class="num px-3 py-2 text-right">{{ fmt(m.points) }}</td>
                      <td class="px-3 py-2 text-xs">
                        <span [class.text-primary]="m.ready">{{ m.ready ? txt.ready : txt.notReady }}</span>
                        <span class="block text-muted-foreground">{{ m.rulesAccepted ? txt.rulesAccepted : txt.rulesNotAccepted }}</span>
                      </td>
                      <td class="px-3 py-2 text-xs">
                        <span [class.text-primary]="m.trackingActive">{{ m.trackingActive ? txt.tracking : m.trackingConsented ? txt.consented : txt.noConsent }}</span>
                        @if (m.gpsAccuracy !== null) {
                          <span class="num block text-muted-foreground">±{{ m.gpsAccuracy.toFixed(0) }} m</span>
                        }
                      </td>
                      <td class="px-3 py-2">
                        <div class="flex justify-end gap-1">
                          <ng-container *ngTemplateOutlet="rowActions; context: { $implicit: m }" />
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <!-- Phone list -->
            <div class="mb-2 flex items-center gap-2">
              <label for="pl-sort" class="label-caps" i18n>Sort</label>
              <select id="pl-sort" class="h-11 rounded-md border border-input bg-background px-2 text-sm dark:bg-input/30" (change)="sortBy($any($event.target).value, true)">
                @for (c of columns; track c.key) {
                  <option [value]="c.key" [selected]="sortKey() === c.key">{{ c.label }}</option>
                }
              </select>
              <button hlmBtn variant="ghost" size="sm" class="h-11" type="button" (click)="sortDir.set(sortDir() === 1 ? -1 : 1)" [attr.aria-label]="sortDir() === 1 ? txt.ascendingSwitchToDescending : txt.descendingSwitchToAscending">
                {{ sortDir() === 1 ? '▲' : '▼' }}
              </button>
            </div>
            <ul class="panel divide-y divide-border px-3">
              @for (m of visible(); track m.userId) {
                <li class="py-1">
                  <div class="flex items-center gap-2">
                    @if (status() === 'pending') {
                      <label class="grid size-11 shrink-0 cursor-pointer place-items-center">
                        <input type="checkbox" class="size-5 accent-primary" [checked]="selected().has(m.userId)" (change)="toggleSelect(m.userId)" ariaLabel="Select {{ m.nickname }}" i18n-ariaLabel />
                      </label>
                    }
                    <zeus-player-list-item class="min-w-0 flex-1" [member]="m" [team]="teamOf(m)" [squad]="squadOf(m)" [showPresence]="m.status === 'approved'" [showGps]="running()">
                      <button hlmBtn variant="ghost" size="icon" class="tap" type="button" (click)="openDetail(m)" ariaLabel="Details of {{ m.nickname }}" i18n-ariaLabel>
                        <ng-icon name="lucideInfo" size="18" aria-hidden="true" />
                      </button>
                    </zeus-player-list-item>
                  </div>
                  <div class="flex flex-wrap items-center gap-1.5 pb-2 pl-13">
                    @if (m.status === 'approved') {
                      <zeus-member-assign [eventId]="eventId()" [member]="m" [teams]="teams()" [squads]="squads()" [running]="running()" (assigned)="onAssigned($event)" />
                    }
                    <ng-container *ngTemplateOutlet="rowActions; context: { $implicit: m }" />
                  </div>
                </li>
              }
            </ul>
          }
        </div>

        <zeus-gm-panel [open]="!!detail()" [title]="detail()?.nickname ?? txt.player" eyebrow="Player details" (closed)="detailId.set(null)" i18n-eyebrow>
          @if (detail(); as m) {
            <div class="flex flex-col gap-4 text-sm">
              <div class="flex items-center gap-3">
                @if (m.avatarUrl) {
                  <img [src]="m.avatarUrl" alt="" class="size-14 rounded-full object-cover" />
                } @else {
                  <span class="grid size-14 place-items-center rounded-full bg-muted text-lg font-bold" aria-hidden="true">{{ initialsOf(m.nickname) }}</span>
                }
                <div class="min-w-0">
                  <zeus-status-chip [spec]="chipOf(m)" />
                  <p class="mt-1 text-muted-foreground" i18n>{{ m.playerRole ? roleLabel(m) : txt.roleNotSet }} · joined {{ dateTime(m.joinedAt) }}</p>
                  <a [routerLink]="['/players', m.userId]" class="text-xs text-primary underline-offset-4 hover:underline" i18n>Public profile</a>
                </div>
              </div>

              <section aria-labelledby="d-team">
                <h3 id="d-team" class="label-caps mb-1" i18n>Team</h3>
                @if (m.status === 'approved') {
                  <zeus-member-assign [eventId]="eventId()" [member]="m" [teams]="teams()" [squads]="squads()" [running]="running()" (assigned)="onAssigned($event)" />
                } @else {
                  <zeus-team-badge [team]="teamOf(m)" emptyLabel="No team" i18n-emptyLabel />
                }
              </section>

              <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
                <div><dt class="label-caps" i18n>Ready</dt><dd [class.text-primary]="m.ready">{{ m.ready ? txt.ready : txt.notReady }}</dd></div>
                <div><dt class="label-caps" i18n>Rules</dt><dd [class.text-primary]="m.rulesAccepted">{{ m.rulesAccepted ? txt.accepted : txt.notAccepted }}</dd></div>
                <div><dt class="label-caps" i18n>Location permission</dt><dd>{{ permission(m.locationPermission) }}</dd></div>
                <div><dt class="label-caps" i18n>Notifications</dt><dd>{{ permission(m.notificationPermission) }}</dd></div>
                <div><dt class="label-caps" i18n>Tracking consent</dt><dd>{{ m.trackingConsented ? txt.given : txt.notGiven }}</dd></div>
                <div><dt class="label-caps" i18n>Tracking</dt><dd [class.text-primary]="m.trackingActive">{{ m.trackingActive ? txt.active : txt.off }}</dd></div>
                <div><dt class="label-caps" i18n>Last seen</dt><dd class="num">{{ m.online ? txt.onlineNow : m.lastSeenAt ? relative(m.lastSeenAt) : txt.never }}</dd></div>
                <div><dt class="label-caps" i18n>Last position</dt><dd class="num">{{ m.lastLocationAt ? relative(m.lastLocationAt) : '—' }}</dd></div>
                <div><dt class="label-caps" i18n>GPS accuracy</dt><dd class="num">{{ m.gpsAccuracy !== null ? '±' + m.gpsAccuracy.toFixed(0) + ' m' : '—' }}</dd></div>
                <div><dt class="label-caps" i18n>Points · captures</dt><dd class="num">{{ fmt(m.points) }} · {{ m.captures }}</dd></div>
              </dl>

              @if (m.emergencyContact; as ec) {
                <section class="rounded-sm border border-destructive/40 bg-destructive/5 p-3" aria-labelledby="d-ec">
                  <h3 id="d-ec" class="label-caps flex items-center gap-1.5 text-destructive!">
                    <ng-icon name="lucideLock" size="14" aria-hidden="true" /> <ng-container i18n>Emergency contact · confidential</ng-container>
                  </h3>
                  <p class="mt-1 text-xs text-muted-foreground" i18n>Shared by the player for emergencies only. Do not copy or pass it on.</p>
                  <p class="mt-2 font-semibold">{{ ec.name }} <span class="font-normal text-muted-foreground">({{ ec.relation }})</span></p>
                  <a [href]="'tel:' + ec.phone" class="num mt-1 inline-flex min-h-11 items-center gap-1.5 text-base font-semibold underline-offset-4 hover:underline">
                    <ng-icon name="lucidePhone" size="16" aria-hidden="true" /> {{ ec.phone }}
                  </a>
                </section>
              } @else if (m.status === 'approved') {
                <p class="text-xs text-muted-foreground" i18n>No emergency contact shared.</p>
              }

              <div class="flex flex-wrap gap-2 border-t border-border pt-3">
                <ng-container *ngTemplateOutlet="rowActions; context: { $implicit: m, full: true }" />
              </div>
            </div>
          }
        </zeus-gm-panel>
      </div>
    </div>

    <ng-template #rowActions let-m let-full="full">
      @switch (m.status) {
        @case ('pending') {
          <button hlmBtn size="sm" class="h-11" type="button" [disabled]="busyId() === m.userId" (click)="review(m, true)" ariaLabel="Approve {{ m.nickname }}" i18n-ariaLabel>
            <ng-icon name="lucideUserCheck" size="14" aria-hidden="true" /> <ng-container i18n>Approve</ng-container>
          </button>
          <button hlmBtn variant="destructive" size="sm" class="h-11" type="button" [disabled]="busyId() === m.userId" (click)="review(m, false)" ariaLabel="Reject {{ m.nickname }}" i18n-ariaLabel>
            <ng-icon name="lucideUserX" size="14" aria-hidden="true" /> <ng-container i18n>Reject</ng-container>
          </button>
        }
        @case ('approved') {
          <button hlmBtn variant="destructive" size="sm" class="h-11" type="button" [disabled]="busyId() === m.userId" (click)="remove(m)" ariaLabel="Remove {{ m.nickname }}" i18n-ariaLabel>
            <ng-icon name="lucideUserMinus" size="14" aria-hidden="true" /> {{ full ? txt.removeFromEvent : txt.remove }}
          </button>
        }
        @case ('invited') {
          <button hlmBtn variant="ghost" size="sm" class="h-11" type="button" [disabled]="busyId() === m.userId" (click)="remove(m)" ariaLabel="Cancel invitation of {{ m.nickname }}" i18n-ariaLabel>
            <ng-icon name="lucideX" size="14" aria-hidden="true" /> <ng-container i18n>Cancel invitation</ng-container>
          </button>
        }
      }
      @if (desktop() && !full) {
        <button hlmBtn variant="ghost" size="icon" class="tap" type="button" (click)="openDetail(m)" ariaLabel="Details of {{ m.nickname }}" i18n-ariaLabel>
          <ng-icon name="lucideInfo" size="16" aria-hidden="true" />
        </button>
      }
    </ng-template>
  `,
})
export class PlayerManagementScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    inviting: $localize`Inviting…`,
    invite: $localize`Invite`,
    approving: $localize`Approving…`,
    online: $localize`● Online`,
    ready: $localize`✓ Ready`,
    notReady: $localize`○ Not ready`,
    rulesAccepted: $localize`Rules accepted`,
    rulesNotAccepted: $localize`Rules not accepted`,
    tracking: $localize`● Tracking`,
    consented: $localize`◐ Consented`,
    noConsent: $localize`○ No consent`,
    roleNotSet: $localize`Role not set`,
    accepted: $localize`✓ Accepted`,
    notAccepted: $localize`○ Not accepted`,
    given: $localize`✓ Given`,
    notGiven: $localize`○ Not given`,
    active: $localize`● Active`,
    off: $localize`○ Off`,
    onlineNow: $localize`● Online now`,
    never: $localize`Never`,
    removeFromEvent: $localize`Remove from event`,
    remove: $localize`Remove`,
    noPlayerMatchesThe: $localize`No player matches the filters.`,
    ascendingSwitchToDescending: $localize`Ascending, switch to descending`,
    descendingSwitchToAscending: $localize`Descending, switch to ascending`,
    player: $localize`Player`,
  };

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly realtime = inject(RealtimeService);
  private readonly destroyRef = inject(DestroyRef);

  readonly eventId = input.required<string>();

  protected readonly desktop = mediaQuery(DESKTOP_QUERY);
  protected readonly event = signal<EventDetail | null>(null);
  protected readonly members = signal<Member[] | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<unknown>(null);
  protected readonly status = signal<StatusFilter>('approved');
  protected readonly teamFilter = signal('');
  protected readonly search = signal('');
  protected readonly sortKey = signal<SortKey>('nickname');
  protected readonly sortDir = signal<1 | -1>(1);
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly bulkBusy = signal(false);
  protected readonly busyId = signal<string | null>(null);
  protected readonly detailId = signal<string | null>(null);
  protected readonly inviting = signal(false);
  protected readonly inviteError = signal<string | null>(null);

  protected readonly inviteForm = new FormGroup({
    nickname: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(40)] }),
  });
  protected readonly inviteTick = staticFormTick(this.inviteForm);

  protected readonly statusFilters = STATUS_FILTERS;
  protected readonly columns: { key: SortKey; label: string }[] = [
    { key: 'nickname', label: $localize`Player` },
    { key: 'status', label: $localize`Status` },
    { key: 'team', label: $localize`Team / squad` },
    { key: 'lastSeen', label: $localize`Last seen` },
    { key: 'points', label: $localize`Points` },
  ];

  protected readonly teams = computed<Team[]>(() => [...(this.event()?.teams ?? [])].sort((a, b) => a.sortOrder - b.sortOrder));
  protected readonly squads = computed<Squad[]>(() => this.event()?.squads ?? []);
  protected readonly running = computed(() => isRunning(this.event()?.status));
  protected readonly players = computed(() => (this.members() ?? []).filter((m) => m.role === 'player'));
  protected readonly counts = computed(() => {
    const c: Record<StatusFilter, number> = { pending: 0, approved: 0, invited: 0, rejected: 0, removed: 0 };
    for (const m of this.players()) c[filterOf(m.status)]++;
    return c;
  });
  protected readonly visible = computed(() => {
    const st = this.status();
    const team = this.teamFilter();
    const q = this.search().trim().toLowerCase();
    const key = this.sortKey();
    const dir = this.sortDir();
    const teamName = (m: Member) => this.teams().find((t) => t.id === m.teamId)?.name ?? '￿';
    const list = this.players().filter(
      (m) => filterOf(m.status) === st && (!team || (team === 'none' ? !m.teamId : m.teamId === team)) && (!q || m.nickname.toLowerCase().includes(q)),
    );
    const cmp = (a: Member, b: Member): number => {
      switch (key) {
        case 'status':
          return a.status.localeCompare(b.status);
        case 'team':
          return teamName(a).localeCompare(teamName(b));
        case 'lastSeen': {
          const ta = a.online ? Infinity : a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0;
          const tb = b.online ? Infinity : b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0;
          return ta === tb ? 0 : ta > tb ? -1 : 1;
        }
        case 'points':
          return b.points - a.points;
        default:
          return 0;
      }
    };
    return [...list].sort((a, b) => dir * (cmp(a, b) || a.nickname.localeCompare(b.nickname)));
  });
  protected readonly allSelected = computed(() => this.visible().length > 0 && this.visible().every((m) => this.selected().has(m.userId)));
  protected readonly someSelected = computed(() => !this.allSelected() && this.visible().some((m) => this.selected().has(m.userId)));
  protected readonly detail = computed(() => (this.members() ?? []).find((m) => m.userId === this.detailId()) ?? null);
  protected readonly statusLabel = computed(() => STATUS_FILTERS.find((f) => f.value === this.status())?.label ?? '');
  protected readonly emptyTitle = computed(() => {
    switch (this.status()) {
      case 'pending':
        return $localize`No registrations waiting`;
      case 'approved':
        return $localize`No approved players yet`;
      case 'invited':
        return $localize`No open invitations`;
      case 'rejected':
        return $localize`No rejected registrations`;
      default:
        return $localize`Nobody was removed or left`;
    }
  });
  protected readonly subtitle = computed(() => {
    const e = this.event();
    if (!e) return null;
    const c = this.counts();
    return c.pending ? $localize`${c.approved}:approved: approved of ${e.maxPlayers}:max: places · ${c.pending}:pending: waiting for approval` : $localize`${c.approved}:approved: approved of ${e.maxPlayers}:max: places`;
  });

  protected readonly initialsOf = initials;
  protected readonly fmt = formatNumber;
  protected readonly dateTime = formatDateTime;
  protected relative(iso: string): string {
    return formatRelative(iso);
  }
  protected roleLabel(m: Member): string {
    return m.playerRole ? PLAYER_ROLE_LABELS[m.playerRole] : '';
  }
  protected permission(p: PermissionState): string {
    return PERMISSION_LABELS[p] ?? p;
  }
  protected chipOf(m: Member): ChipSpec {
    return STATUS_CHIPS[m.status];
  }
  protected teamOf(m: Member): Team | null {
    return this.teams().find((t) => t.id === m.teamId) ?? null;
  }
  protected squadOf(m: Member): Squad | null {
    return this.squads().find((s) => s.id === m.squadId) ?? null;
  }

  private initialFilterSet = false;

  constructor() {
    effect(() => {
      const id = this.eventId();
      untracked(() => {
        this.members.set(null);
        this.initialFilterSet = false;
        void this.load();
        void this.realtime.subscribe(id, this.destroyRef);
      });
    });
    this.realtime
      .on('invalidate')
      .pipe(
        filter((p) => p.eventId === this.eventId() && (p.scopes.includes('members') || p.scopes.includes('event') || p.scopes.includes('squads'))),
        takeUntilDestroyed(),
      )
      .subscribe((p) => {
        if (p.scopes.includes('event') || p.scopes.includes('squads')) void this.loadEvent();
        if (p.scopes.includes('members')) void this.loadMembers();
      });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [e, members] = await Promise.all([this.api.event(this.eventId()), this.api.members(this.eventId())]);
      this.event.set(e);
      this.setMembers(members);
    } catch (err) {
      this.loadError.set(err);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadEvent(): Promise<void> {
    try {
      this.event.set(await this.api.event(this.eventId()));
    } catch {
      /* keep current data */
    }
  }

  private async loadMembers(): Promise<void> {
    try {
      this.setMembers(await this.api.members(this.eventId()));
    } catch {
      /* keep current data; the connection indicator shows the problem */
    }
  }

  private setMembers(members: Member[]): void {
    this.members.set(members);
    if (!this.initialFilterSet) {
      this.initialFilterSet = true;
      this.status.set(members.some((m) => m.role === 'player' && m.status === 'pending') ? 'pending' : 'approved');
    }
    // Drop selections that are no longer pending.
    const pending = new Set(members.filter((m) => m.status === 'pending').map((m) => m.userId));
    this.selected.update((s) => new Set([...s].filter((id) => pending.has(id))));
  }

  private replaceMember(m: Member): void {
    this.members.update((list) => (list ?? []).map((x) => (x.userId === m.userId ? m : x)));
  }

  // --- filters & sorting ---------------------------------------------------------------

  protected setStatus(s: StatusFilter): void {
    this.status.set(s);
    this.selected.set(new Set());
  }

  protected sortBy(key: SortKey, keepDir = false): void {
    if (!keepDir && this.sortKey() === key) this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    else if (!keepDir) this.sortDir.set(1);
    this.sortKey.set(key);
  }

  protected toggleSelect(id: string): void {
    this.selected.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  protected toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.visible().map((m) => m.userId)));
  }

  protected openDetail(m: Member): void {
    this.detailId.set(m.userId);
  }

  // --- actions -------------------------------------------------------------------------

  protected onAssigned(m: Member): void {
    this.replaceMember(m);
    void this.loadEvent();
  }

  protected async review(m: Member, approve: boolean): Promise<void> {
    const e = this.event();
    if (!approve) {
      const ok = await this.confirm.ask({
        title: $localize`Reject ${m.nickname}:nickname:?`,
        consequences: [$localize`${m.nickname}:nickname: is notified that the registration was declined.`, $localize`They cannot register again for this event.`],
        destructive: true,
        confirmLabel: $localize`Reject`,
      });
      if (!ok) return;
    } else if (e && this.counts().approved >= e.maxPlayers) {
      const ok = await this.confirm.ask({
        title: $localize`The event is full`,
        message: $localize`${this.counts().approved}:approved: of ${e.maxPlayers}:maxPlayers: places are taken.`,
        consequences: [$localize`Approving ${m.nickname}:nickname: goes over the maximum you set.`],
        confirmLabel: $localize`Approve anyway`,
      });
      if (!ok) return;
    }
    this.busyId.set(m.userId);
    try {
      const updated = await this.api.reviewMember(this.eventId(), m.userId, approve);
      this.replaceMember(updated);
      this.toast.success(approve ? $localize`${m.nickname}:nickname: approved` : $localize`${m.nickname}:nickname: rejected`);
      void this.loadEvent();
    } catch (err) {
      this.toast.error(err);
      void this.loadMembers();
    } finally {
      this.busyId.set(null);
    }
  }

  protected async bulkApprove(): Promise<void> {
    const e = this.event();
    const ids = [...this.selected()];
    const list = this.players().filter((m) => ids.includes(m.userId));
    if (!list.length) return;
    const over = e ? this.counts().approved + list.length - e.maxPlayers : 0;
    const ok = await this.confirm.ask({
      title: $localize`Approve ${list.length}:length: players?`,
      consequences: [
        $localize`${list.length}:length: players are notified that they are in.`,
        ...(e?.teamSelection === 'auto' ? [$localize`They are placed in teams automatically.`] : []),
        ...(over > 0 ? [$localize`This goes ${over}:over: over the maximum of ${e!.maxPlayers}:maxPlayers: players.`] : []),
      ],
      confirmLabel: $localize`Approve ${list.length}:length:`,
    });
    if (!ok) return;
    this.bulkBusy.set(true);
    let done = 0;
    const failed: string[] = [];
    for (const m of list) {
      try {
        this.replaceMember(await this.api.reviewMember(this.eventId(), m.userId, true));
        done++;
      } catch {
        failed.push(m.nickname);
      }
    }
    this.bulkBusy.set(false);
    this.selected.set(new Set());
    if (failed.length) this.toast.warning($localize`${done}:done: approved, ${failed.length}:length: failed`, $localize`Not approved: ${failed.join(', ')}:failed:`);
    else this.toast.success($localize`${done}:done: players approved`);
    void this.load();
  }

  protected async remove(m: Member): Promise<void> {
    const invited = m.status === 'invited';
    const res = await this.confirm.askChoice({
      title: invited ? $localize`Cancel the invitation of ${m.nickname}:nickname:?` : $localize`Remove ${m.nickname}:nickname: from the event?`,
      consequences: invited
        ? [$localize`${m.nickname}:nickname: can no longer accept the invitation.`, $localize`They see your reason.`]
        : [
            this.running() ? $localize`${m.nickname}:nickname: loses access to the event and is disconnected from the live game immediately.` : $localize`${m.nickname}:nickname: loses access to the event.`,
            $localize`Location tracking stops and their emergency contact is no longer shared.`,
            $localize`They see your reason.`,
          ],
      choices: invited
        ? []
        : [
            { value: 'remove', label: $localize`Remove`, hint: $localize`They can join the event again.`, confirmLabel: $localize`Remove player` },
            { value: 'ban', label: $localize`:remove a player|:Ban`, hint: $localize`They cannot join again unless you invite them.`, confirmLabel: $localize`Ban player` },
          ],
      destructive: true,
      confirmLabel: invited ? $localize`Cancel invitation` : $localize`Remove player`,
      reason: { label: $localize`Reason (shown to the player)`, required: true, placeholder: invited ? $localize`Event full` : $localize`Did not respect the safety rules` },
    });
    if (res === null) return;
    const ban = res.choice === 'ban';
    this.busyId.set(m.userId);
    try {
      await this.api.removeMember(this.eventId(), m.userId, res.reason, ban);
      this.toast.success(invited ? $localize`Invitation cancelled` : ban ? $localize`${m.nickname}:nickname: banned` : $localize`${m.nickname}:nickname: removed`);
      if (this.detailId() === m.userId) this.detailId.set(null);
      await this.loadMembers();
      void this.loadEvent();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busyId.set(null);
    }
  }

  protected async invite(): Promise<void> {
    const c = this.inviteForm.controls.nickname;
    this.inviteError.set(null);
    if (c.invalid) {
      c.markAsTouched();
      this.inviteError.set($localize`Enter a nickname.`);
      return;
    }
    const nickname = c.value.trim();
    this.inviting.set(true);
    try {
      const m = await this.api.invitePlayer(this.eventId(), nickname);
      this.inviteForm.reset();
      this.members.update((list) => [...(list ?? []).filter((x) => x.userId !== m.userId), m]);
      this.toast.success($localize`${m.nickname}:nickname: invited`, $localize`They get a notification and can accept from the event page.`);
    } catch (err) {
      const e = ApiError.from(err);
      this.inviteError.set(e.fields['nickname'] ?? e.message);
    } finally {
      this.inviting.set(false);
    }
  }
}
