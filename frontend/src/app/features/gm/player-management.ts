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
import { DESKTOP_QUERY, mediaQuery } from './common/media';
import { MemberAssign, isRunning } from './common/member-assign';

type StatusFilter = 'pending' | 'approved' | 'invited' | 'rejected' | 'removed';
type SortKey = 'nickname' | 'status' | 'team' | 'lastSeen' | 'points';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'invited', label: 'Invited' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'removed', label: 'Removed / left' },
];

const STATUS_CHIPS: Record<MemberStatus, ChipSpec> = {
  pending: { label: 'Waiting for approval', glyph: '◐', tone: 'warning' },
  approved: { label: 'Approved', glyph: '✓', tone: 'primary' },
  invited: { label: 'Invited', glyph: '✉', tone: 'nav' },
  rejected: { label: 'Rejected', glyph: '✕', tone: 'danger' },
  removed: { label: 'Removed', glyph: '✕', tone: 'danger' },
  left: { label: 'Left', glyph: '○', tone: 'neutral' },
};

const PERMISSION_LABELS: Record<PermissionState, string> = {
  granted: '● Allowed',
  denied: '✕ Blocked',
  prompt: '◐ Not answered',
  unknown: '○ Unknown',
};

function filterOf(s: MemberStatus): StatusFilter {
  return s === 'left' ? 'removed' : s;
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
      <zeus-page-header title="Players" [eyebrow]="event()?.name ?? null" [back]="'/gm/events/' + eventId()" backLabel="Event editor" [subtitle]="subtitle()">
        <zeus-connection-status [compact]="true" />
        <a hlmBtn variant="outline" class="h-11" [routerLink]="['/gm/events', eventId(), 'teams']">
          <ng-icon name="lucideUsers" size="16" aria-hidden="true" /> Teams and squads
        </a>
      </zeus-page-header>

      <!-- Invite -->
      <form [formGroup]="inviteForm" (ngSubmit)="invite()" class="panel mb-4 flex flex-col gap-1.5 p-3" [attr.data-rev]="inviteTick()">
        <label hlmLabel for="inv-nick">Invite a player by nickname</label>
        <div class="flex gap-2">
          <input hlmInput id="inv-nick" class="h-11 flex-1" formControlName="nickname" autocomplete="off" placeholder="nickname" [attr.aria-invalid]="!!inviteError()" aria-describedby="inv-e" />
          <button hlmBtn class="h-11" type="submit" [disabled]="inviting()">
            <ng-icon name="lucideMail" size="16" aria-hidden="true" /> {{ inviting() ? 'Inviting…' : 'Invite' }}
          </button>
        </div>
        @if (inviteError(); as m) {
          <p id="inv-e" class="field-error">{{ m }}</p>
        }
      </form>

      <!-- Filters -->
      <div class="mb-3 flex flex-col gap-3">
        <div role="radiogroup" aria-label="Filter by status" class="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          @for (f of statusFilters; track f.value) {
            <label class="flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-sm border px-3 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring"
              [class]="status() === f.value ? 'border-primary bg-primary/10 font-semibold' : 'border-border text-muted-foreground hover:text-foreground'">
              <input type="radio" name="status-filter" class="sr-only" [checked]="status() === f.value" (change)="setStatus(f.value)" />
              {{ f.label }}
              <span class="num rounded-sm px-1 text-xs" [class]="f.value === 'pending' && counts()[f.value] ? 'bg-warning text-warning-foreground' : 'bg-muted'">{{ counts()[f.value] }}</span>
            </label>
          }
        </div>
        <div class="grid gap-2 sm:grid-cols-[1fr_14rem]">
          <div class="relative">
            <label for="pl-search" class="sr-only">Search by nickname</label>
            <ng-icon name="lucideSearch" size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input hlmInput id="pl-search" type="search" class="h-11 pl-9" placeholder="Search by nickname" [value]="search()" (input)="search.set($any($event.target).value)" />
          </div>
          <div>
            <label for="pl-team" class="sr-only">Filter by team</label>
            <select id="pl-team" class="h-11 w-full rounded-md border border-input bg-background px-2.5 text-sm dark:bg-input/30" (change)="teamFilter.set($any($event.target).value)">
              <option value="" [selected]="teamFilter() === ''">All teams</option>
              <option value="none" [selected]="teamFilter() === 'none'">No team</option>
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
              Select all ({{ visible().length }})
            </label>
            <button hlmBtn class="ml-auto h-11" type="button" [disabled]="!selected().size || bulkBusy()" (click)="bulkApprove()">
              <ng-icon name="lucideUserCheck" size="16" aria-hidden="true" /> {{ bulkBusy() ? 'Approving…' : 'Approve selected (' + selected().size + ')' }}
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
            <zeus-empty-state icon="lucideUsers" [title]="emptyTitle()" [message]="search() || teamFilter() ? 'No player matches the filters.' : null" />
          } @else if (desktop()) {
            <!-- Desktop table -->
            <div class="panel overflow-x-auto">
              <table class="w-full text-left text-sm">
                <caption class="sr-only">{{ statusLabel() }} players, {{ visible().length }} shown</caption>
                <thead class="border-b border-border">
                  <tr>
                    @if (status() === 'pending') {
                      <th scope="col" class="w-10 px-3"><span class="sr-only">Select</span></th>
                    }
                    @for (c of columns; track c.key) {
                      <th scope="col" class="px-3 py-2" [attr.aria-sort]="sortKey() === c.key ? (sortDir() === 1 ? 'ascending' : 'descending') : null">
                        <button type="button" class="label-caps inline-flex min-h-11 items-center gap-1 hover:text-foreground" (click)="sortBy(c.key)">
                          {{ c.label }}
                          <span aria-hidden="true" class="num">{{ sortKey() === c.key ? (sortDir() === 1 ? '▲' : '▼') : '↕' }}</span>
                        </button>
                      </th>
                    }
                    <th scope="col" class="label-caps px-3 py-2">Ready</th>
                    <th scope="col" class="label-caps px-3 py-2">Location</th>
                    <th scope="col" class="px-3 py-2"><span class="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border">
                  @for (m of visible(); track m.userId) {
                    <tr [class]="detailId() === m.userId ? 'bg-primary/5' : ''">
                      @if (status() === 'pending') {
                        <td class="px-3">
                          <input type="checkbox" class="size-5 accent-primary" [checked]="selected().has(m.userId)" (change)="toggleSelect(m.userId)" [attr.aria-label]="'Select ' + m.nickname" />
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
                      <td class="num px-3 py-2 text-xs text-muted-foreground">{{ m.online ? '● Online' : m.lastSeenAt ? relative(m.lastSeenAt) : '—' }}</td>
                      <td class="num px-3 py-2 text-right">{{ fmt(m.points) }}</td>
                      <td class="px-3 py-2 text-xs">
                        <span [class.text-primary]="m.ready">{{ m.ready ? '✓ Ready' : '○ Not ready' }}</span>
                        <span class="block text-muted-foreground">{{ m.rulesAccepted ? 'Rules accepted' : 'Rules not accepted' }}</span>
                      </td>
                      <td class="px-3 py-2 text-xs">
                        <span [class.text-primary]="m.trackingActive">{{ m.trackingActive ? '● Tracking' : m.trackingConsented ? '◐ Consented' : '○ No consent' }}</span>
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
              <label for="pl-sort" class="label-caps">Sort</label>
              <select id="pl-sort" class="h-11 rounded-md border border-input bg-background px-2 text-sm dark:bg-input/30" (change)="sortBy($any($event.target).value, true)">
                @for (c of columns; track c.key) {
                  <option [value]="c.key" [selected]="sortKey() === c.key">{{ c.label }}</option>
                }
              </select>
              <button hlmBtn variant="ghost" size="sm" class="h-11" type="button" (click)="sortDir.set(sortDir() === 1 ? -1 : 1)" [attr.aria-label]="sortDir() === 1 ? 'Ascending, switch to descending' : 'Descending, switch to ascending'">
                {{ sortDir() === 1 ? '▲' : '▼' }}
              </button>
            </div>
            <ul class="panel divide-y divide-border px-3">
              @for (m of visible(); track m.userId) {
                <li class="py-1">
                  <div class="flex items-center gap-2">
                    @if (status() === 'pending') {
                      <label class="grid size-11 shrink-0 cursor-pointer place-items-center">
                        <input type="checkbox" class="size-5 accent-primary" [checked]="selected().has(m.userId)" (change)="toggleSelect(m.userId)" [attr.aria-label]="'Select ' + m.nickname" />
                      </label>
                    }
                    <zeus-player-list-item class="min-w-0 flex-1" [member]="m" [team]="teamOf(m)" [squad]="squadOf(m)" [showPresence]="m.status === 'approved'" [showGps]="running()">
                      <button hlmBtn variant="ghost" size="icon" class="tap" type="button" (click)="openDetail(m)" [attr.aria-label]="'Details of ' + m.nickname">
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

        <zeus-gm-panel [open]="!!detail()" [title]="detail()?.nickname ?? 'Player'" eyebrow="Player details" (closed)="detailId.set(null)">
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
                  <p class="mt-1 text-muted-foreground">{{ m.playerRole ? roleLabel(m) : 'Role not set' }} · joined {{ dateTime(m.joinedAt) }}</p>
                  <a [routerLink]="['/players', m.userId]" class="text-xs text-primary underline-offset-4 hover:underline">Public profile</a>
                </div>
              </div>

              <section aria-labelledby="d-team">
                <h3 id="d-team" class="label-caps mb-1">Team</h3>
                @if (m.status === 'approved') {
                  <zeus-member-assign [eventId]="eventId()" [member]="m" [teams]="teams()" [squads]="squads()" [running]="running()" (assigned)="onAssigned($event)" />
                } @else {
                  <zeus-team-badge [team]="teamOf(m)" emptyLabel="No team" />
                }
              </section>

              <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
                <div><dt class="label-caps">Ready</dt><dd [class.text-primary]="m.ready">{{ m.ready ? '✓ Ready' : '○ Not ready' }}</dd></div>
                <div><dt class="label-caps">Rules</dt><dd [class.text-primary]="m.rulesAccepted">{{ m.rulesAccepted ? '✓ Accepted' : '○ Not accepted' }}</dd></div>
                <div><dt class="label-caps">Location permission</dt><dd>{{ permission(m.locationPermission) }}</dd></div>
                <div><dt class="label-caps">Notifications</dt><dd>{{ permission(m.notificationPermission) }}</dd></div>
                <div><dt class="label-caps">Tracking consent</dt><dd>{{ m.trackingConsented ? '✓ Given' : '○ Not given' }}</dd></div>
                <div><dt class="label-caps">Tracking</dt><dd [class.text-primary]="m.trackingActive">{{ m.trackingActive ? '● Active' : '○ Off' }}</dd></div>
                <div><dt class="label-caps">Last seen</dt><dd class="num">{{ m.online ? '● Online now' : m.lastSeenAt ? relative(m.lastSeenAt) : 'Never' }}</dd></div>
                <div><dt class="label-caps">Last position</dt><dd class="num">{{ m.lastLocationAt ? relative(m.lastLocationAt) : '—' }}</dd></div>
                <div><dt class="label-caps">GPS accuracy</dt><dd class="num">{{ m.gpsAccuracy !== null ? '±' + m.gpsAccuracy.toFixed(0) + ' m' : '—' }}</dd></div>
                <div><dt class="label-caps">Points · captures</dt><dd class="num">{{ fmt(m.points) }} · {{ m.captures }}</dd></div>
              </dl>

              @if (m.emergencyContact; as ec) {
                <section class="rounded-sm border border-destructive/40 bg-destructive/5 p-3" aria-labelledby="d-ec">
                  <h3 id="d-ec" class="label-caps flex items-center gap-1.5 text-destructive!">
                    <ng-icon name="lucideLock" size="14" aria-hidden="true" /> Emergency contact · confidential
                  </h3>
                  <p class="mt-1 text-xs text-muted-foreground">Shared by the player for emergencies only. Do not copy or pass it on.</p>
                  <p class="mt-2 font-semibold">{{ ec.name }} <span class="font-normal text-muted-foreground">({{ ec.relation }})</span></p>
                  <a [href]="'tel:' + ec.phone" class="num mt-1 inline-flex min-h-11 items-center gap-1.5 text-base font-semibold underline-offset-4 hover:underline">
                    <ng-icon name="lucidePhone" size="16" aria-hidden="true" /> {{ ec.phone }}
                  </a>
                </section>
              } @else if (m.status === 'approved') {
                <p class="text-xs text-muted-foreground">No emergency contact shared.</p>
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
          <button hlmBtn size="sm" class="h-11" type="button" [disabled]="busyId() === m.userId" (click)="review(m, true)" [attr.aria-label]="'Approve ' + m.nickname">
            <ng-icon name="lucideUserCheck" size="14" aria-hidden="true" /> Approve
          </button>
          <button hlmBtn variant="destructive" size="sm" class="h-11" type="button" [disabled]="busyId() === m.userId" (click)="review(m, false)" [attr.aria-label]="'Reject ' + m.nickname">
            <ng-icon name="lucideUserX" size="14" aria-hidden="true" /> Reject
          </button>
        }
        @case ('approved') {
          <button hlmBtn variant="destructive" size="sm" class="h-11" type="button" [disabled]="busyId() === m.userId" (click)="remove(m)" [attr.aria-label]="'Remove ' + m.nickname">
            <ng-icon name="lucideUserMinus" size="14" aria-hidden="true" /> {{ full ? 'Remove from event' : 'Remove' }}
          </button>
        }
        @case ('invited') {
          <button hlmBtn variant="ghost" size="sm" class="h-11" type="button" [disabled]="busyId() === m.userId" (click)="remove(m)" [attr.aria-label]="'Cancel invitation of ' + m.nickname">
            <ng-icon name="lucideX" size="14" aria-hidden="true" /> Cancel invitation
          </button>
        }
      }
      @if (desktop() && !full) {
        <button hlmBtn variant="ghost" size="icon" class="tap" type="button" (click)="openDetail(m)" [attr.aria-label]="'Details of ' + m.nickname">
          <ng-icon name="lucideInfo" size="16" aria-hidden="true" />
        </button>
      }
    </ng-template>
  `,
})
export class PlayerManagementScreen {
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
    { key: 'nickname', label: 'Player' },
    { key: 'status', label: 'Status' },
    { key: 'team', label: 'Team / squad' },
    { key: 'lastSeen', label: 'Last seen' },
    { key: 'points', label: 'Points' },
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
        return 'No registrations waiting';
      case 'approved':
        return 'No approved players yet';
      case 'invited':
        return 'No open invitations';
      case 'rejected':
        return 'No rejected registrations';
      default:
        return 'Nobody was removed or left';
    }
  });
  protected readonly subtitle = computed(() => {
    const e = this.event();
    if (!e) return null;
    const c = this.counts();
    return `${c.approved} approved of ${e.maxPlayers} places${c.pending ? ` · ${c.pending} waiting for approval` : ''}`;
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
        title: `Reject ${m.nickname}?`,
        consequences: [`${m.nickname} is notified that the registration was declined.`, 'They cannot register again for this event.'],
        destructive: true,
        confirmLabel: 'Reject',
      });
      if (!ok) return;
    } else if (e && this.counts().approved >= e.maxPlayers) {
      const ok = await this.confirm.ask({
        title: 'The event is full',
        message: `${this.counts().approved} of ${e.maxPlayers} places are taken.`,
        consequences: [`Approving ${m.nickname} goes over the maximum you set.`],
        confirmLabel: 'Approve anyway',
      });
      if (!ok) return;
    }
    this.busyId.set(m.userId);
    try {
      const updated = await this.api.reviewMember(this.eventId(), m.userId, approve);
      this.replaceMember(updated);
      this.toast.success(approve ? `${m.nickname} approved` : `${m.nickname} rejected`);
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
      title: `Approve ${list.length} players?`,
      consequences: [
        `${list.length} players are notified that they are in.`,
        ...(e?.teamSelection === 'auto' ? ['They are placed in teams automatically.'] : []),
        ...(over > 0 ? [`This goes ${over} over the maximum of ${e!.maxPlayers} players.`] : []),
      ],
      confirmLabel: `Approve ${list.length}`,
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
    if (failed.length) this.toast.warning(`${done} approved, ${failed.length} failed`, `Not approved: ${failed.join(', ')}`);
    else this.toast.success(`${done} players approved`);
    void this.load();
  }

  protected async remove(m: Member): Promise<void> {
    const invited = m.status === 'invited';
    const reason = await this.confirm.askReason({
      title: invited ? `Cancel the invitation of ${m.nickname}?` : `Remove ${m.nickname} from the event?`,
      consequences: invited
        ? [`${m.nickname} can no longer accept the invitation.`, 'They see your reason.']
        : [
            `${m.nickname} loses access to the event${this.running() ? ' and is disconnected from the live game immediately' : ''}.`,
            'Location tracking stops and their emergency contact is no longer shared.',
            'They see your reason and cannot register again.',
          ],
      destructive: true,
      confirmLabel: invited ? 'Cancel invitation' : 'Remove player',
      reason: { label: 'Reason (shown to the player)', required: true, placeholder: invited ? 'Event full' : 'Did not respect the safety rules' },
    });
    if (reason === null) return;
    this.busyId.set(m.userId);
    try {
      await this.api.removeMember(this.eventId(), m.userId, reason);
      this.toast.success(invited ? 'Invitation cancelled' : `${m.nickname} removed`);
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
      this.inviteError.set('Enter a nickname.');
      return;
    }
    const nickname = c.value.trim();
    this.inviting.set(true);
    try {
      const m = await this.api.invitePlayer(this.eventId(), nickname);
      this.inviteForm.reset();
      this.members.update((list) => [...(list ?? []).filter((x) => x.userId !== m.userId), m]);
      this.toast.success(`${m.nickname} invited`, 'They get a notification and can accept from the event page.');
    } catch (err) {
      const e = ApiError.from(err);
      this.inviteError.set(e.fields['nickname'] ?? e.message);
    } finally {
      this.inviting.set(false);
    }
  }
}
