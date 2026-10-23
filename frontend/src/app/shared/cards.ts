import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { EventSummary, GeofenceStatus, Member, Objective, Perk, Squad, Team } from '../core/api/models';
import {
  BLOCK_REASON_LABELS,
  GAME_MODE_LABELS,
  PERK_TYPE_LABELS,
  PLAYER_ROLE_LABELS,
  formatDate,
  formatDistance,
  formatDuration,
  formatNumber,
  formatRelative,
  formatTime,
  initials,
} from '../core/util/format';
import { activeLocale } from '../core/i18n/language';
import { CaptureBar, showCaptureBar, zoneCanAccrue } from './capture-bar';
import { CurrencyDisplay } from './currency-display';
import { SquadBadge } from './squad-badge';
import { StatusChip, eventStatusChip, objectiveStatusChip } from './status-chip';
import { TeamBadge } from './team-badge';

/** Event in lists (discover, my events, home). Whole card is a link. */
@Component({
  selector: 'ah-event-card',
  imports: [RouterLink, NgIcon, StatusChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // contain:inline-size: the card takes its width from the list, never from its (truncated) text,
  // so it cannot push a grid/flex parent wider than the screen.
  host: { class: 'block [contain:inline-size]' },
  template: `
    @let e = event();
    <a
      [routerLink]="link() ?? ['/events', e.id]"
      [state]="from() ? { from: from() } : undefined"
      class="panel group flex overflow-hidden transition-colors hover:border-primary/60 focus-visible:border-primary"
      [attr.aria-label]="e.name + ', ' + dateLabel()"
    >
      <div class="relative w-24 shrink-0 bg-muted sm:w-32">
        @if (e.coverUrl) {
          <img [src]="e.coverUrl" alt="" class="absolute inset-0 size-full object-cover" loading="lazy" />
        } @else {
          <div class="absolute inset-0 grid place-items-center text-muted-foreground">
            <ng-icon name="lucideMapPinned" size="28" aria-hidden="true" />
          </div>
        }
        <div class="absolute inset-x-0 bottom-0 bg-background/85 px-2 py-1 text-center">
          <div class="num text-xs font-bold">{{ dayLabel() }}</div>
        </div>
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <div class="flex flex-wrap items-center gap-1.5">
          <ah-status-chip [spec]="statusChip()" />
          @if (e.visibility === 'private') {
            <span class="inline-flex items-center gap-1 text-xs text-muted-foreground"><ng-icon name="lucideLock" size="12" aria-hidden="true" /> <ng-container i18n>Private</ng-container></span>
          }
          @if (e.isGm) {
            <span class="rounded-sm bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary" i18n>Game Master</span>
          } @else if (e.myStatus === 'pending') {
            <span class="rounded-sm bg-warning-surface px-1.5 py-0.5 text-xs font-semibold text-warning" i18n>◐ Awaiting approval</span>
          } @else if (e.myStatus === 'invited') {
            <span class="rounded-sm bg-nav/15 px-1.5 py-0.5 text-xs font-semibold text-nav" i18n>✉ Invited</span>
          } @else if (e.myStatus === 'approved') {
            <span class="rounded-sm bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary" i18n>✓ Joined</span>
          }
          @if (e.isTestData) {
            <span class="rounded-sm border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground" i18n>Test data</span>
          }
        </div>
        <h3 class="truncate text-base font-bold uppercase group-hover:text-primary">{{ e.name }}</h3>
        <p class="num truncate text-sm">{{ timeLabel() }}</p>
        <p class="truncate text-sm text-muted-foreground">
          {{ modeLabel() }}
          @if (e.meetingAddress) {
            · {{ e.meetingAddress }}
          }
        </p>
        <div class="mt-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span class="inline-flex items-center gap-1 whitespace-nowrap"><ng-icon name="lucideUsers" size="13" aria-hidden="true" />
            <ng-container i18n><span class="num">{{ e.approvedCount }}/{{ e.maxPlayers }}</span> players</ng-container></span>
          @if (e.teamCount) {
            <span class="num whitespace-nowrap" i18n>{{ e.teamCount }} teams</span>
          }
        </div>
      </div>
    </a>
  `,
})
export class EventCard {
  readonly event = input.required<EventSummary>();
  /** Override target route (e.g. GM editor). */
  readonly link = input<unknown[] | string | null>(null);
  /** List URL the opened screen links back to (navigation state `from`). */
  readonly from = input<string | null>(null);
  protected readonly statusChip = computed(() => eventStatusChip(this.event().status));
  protected readonly modeLabel = computed(() => this.event().customModeName || GAME_MODE_LABELS[this.event().gameMode]);
  protected readonly dayLabel = computed(() =>
    new Intl.DateTimeFormat(activeLocale(), { day: '2-digit', month: 'short' }).format(new Date(this.event().startAt)).toUpperCase(),
  );
  protected readonly timeLabel = computed(() => `${formatTime(this.event().startAt)}–${formatTime(this.event().endAt)}`);
  protected readonly dateLabel = computed(() => formatDate(this.event().startAt));
}

/** Member row: avatar, nickname, team/squad, role, online state. Project actions into it. */
@Component({
  selector: 'ah-player-list-item',
  imports: [NgIcon, TeamBadge, SquadBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-center gap-3 py-2 min-h-14' },
  template: `
    @let m = member();
    <div class="relative shrink-0">
      @if (m.avatarUrl) {
        <img [src]="m.avatarUrl" alt="" class="size-10 rounded-full object-cover" loading="lazy" />
      } @else {
        <div class="grid size-10 place-items-center rounded-full bg-muted text-sm font-bold" aria-hidden="true">{{ initialsOf(m.nickname) }}</div>
      }
      @if (showPresence()) {
        <span class="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full border-2 border-card text-[8px] leading-none"
          [class]="m.online ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'" aria-hidden="true">{{ m.online ? '●' : '○' }}</span>
      }
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="truncate font-semibold">{{ m.nickname }}</span>
        @if (m.role === 'gm') {
          <span class="rounded-sm bg-primary/15 px-1 text-xs font-semibold text-primary" i18n>GM</span>
        }
        @if (isSelf()) {
          <span class="text-xs text-muted-foreground" i18n>(you)</span>
        }
      </div>
      <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        @if (team()) {
          <ah-team-badge [team]="team()" size="sm" [showIcon]="false" />
        }
        @if (squad()) {
          <ah-squad-badge [squad]="squad()" [leader]="m.isSquadLeader" />
        } @else if (m.isSquadLeader) {
          <span class="font-semibold text-primary" i18n>Squad leader</span>
        }
        @if (m.playerRole) {
          <span>{{ roleLabel(m.playerRole) }}</span>
        }
        @if (showPresence()) {
          <span>
            @if (m.online) {
              {{ txt.online }}
            } @else if (m.lastSeenAt) {
              <ng-container i18n>Seen {{ relative(m.lastSeenAt) }}</ng-container>
            } @else {
              {{ txt.offline }}
            }
          </span>
        }
        @if (m.gpsAccuracy !== null && showGps()) {
          <span class="num inline-flex items-center gap-0.5"><ng-icon name="lucideLocateFixed" size="11" aria-hidden="true" />±{{ m.gpsAccuracy.toFixed(0) }}m</span>
        }
      </div>
    </div>
    <div class="flex shrink-0 items-center gap-1"><ng-content /></div>
  `,
})
export class PlayerListItem {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    online: $localize`Online`,
    offline: $localize`Offline`,
  };

  readonly member = input.required<Member>();
  readonly team = input<Team | null | undefined>(null);
  readonly squad = input<Squad | null | undefined>(null);
  readonly isSelf = input(false);
  readonly showPresence = input(true);
  readonly showGps = input(false);
  protected initialsOf = initials;
  protected roleLabel = (r: keyof typeof PLAYER_ROLE_LABELS) => PLAYER_ROLE_LABELS[r];
  protected relative = (iso: string) => formatRelative(iso);
}

/** Objective card for lists. */
@Component({
  selector: 'ah-objective-card',
  imports: [NgIcon, StatusChip, TeamBadge, HlmButton, CaptureBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let o = objective();
    <article class="panel flex flex-col gap-2 p-3" [class.opacity-70]="o.status === 'disabled' || o.status === 'completed'">
      <button type="button" class="flex items-start gap-3 text-left" (click)="open.emit(o)" ariaLabel="Open {{ o.name }}" i18n-ariaLabel>
        <span class="grid size-11 shrink-0 place-items-center rounded-md border-2" [style.border-color]="o.color" [style.color]="o.color" aria-hidden="true">
          <ng-icon [name]="methodIcon()" size="20" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-center gap-1.5">
            <ah-status-chip [spec]="chip()" />
            @if (o.jammedUntil) {
              <span class="rounded-sm border border-destructive/50 px-1.5 py-0.5 text-xs font-semibold text-destructive" i18n>⌁ Jammed</span>
            }
            @if (o.shieldedUntil) {
              <span class="rounded-sm border border-nav/50 px-1.5 py-0.5 text-xs font-semibold text-nav" i18n>⛉ Shielded</span>
            }
          </span>
          <span class="mt-1 block truncate font-bold uppercase">{{ o.name }}</span>
          <span class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span class="num" i18n><span class="text-primary">+{{ fmt(o.rewards.points) }}</span> pts</span>
            <span class="num" i18n><span class="text-warning">+{{ fmt(o.rewards.currency) }}</span> cr</span>
            @if (o.rewards.recurringPointsPerMinute) {
              <span class="num" i18n>+{{ o.rewards.recurringPointsPerMinute }}/min held</span>
            }
            <span class="inline-flex items-center gap-1">{{ methodsLabel() }}</span>
          </span>
        </span>
        <span class="flex shrink-0 flex-col items-end gap-1 text-right">
          <span class="num text-sm font-semibold text-nav">{{ distance() }}</span>
          @if (timeLeft()) {
            <span class="num text-xs text-warning">{{ timeLeft() }}</span>
          }
        </span>
      </button>
      @if (showBar(capture())) {
        <ah-capture-bar [status]="capture()!" [canAccrue]="canAccrue()" />
      }
      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        @if (owner()) {
          <span class="inline-flex items-center gap-1.5 text-sm"><span class="label-caps" i18n>Held by</span> <ah-team-badge [team]="owner()" size="sm" [showIcon]="false" /></span>
        } @else if (!o.canCapture && o.blockedReason) {
          <span class="text-xs text-muted-foreground">{{ blockedLabel() }}</span>
        } @else {
          <span class="text-xs text-muted-foreground" i18n>Unclaimed</span>
        }
        <button hlmBtn size="sm" variant="outline" class="tap" type="button" (click)="navigate.emit(o)" ariaLabel="Show {{ o.name }} on map" i18n-ariaLabel>
          <ng-icon name="lucideNavigation" size="16" class="text-nav" aria-hidden="true" /> <ng-container i18n>Map</ng-container>
        </button>
      </div>
    </article>
  `,
})
export class ObjectiveCard {
  readonly objective = input.required<Objective>();
  readonly distanceM = input<number | null>(null);
  readonly teams = input<Team[]>([]);
  /** server-corrected now (ms) for remaining time */
  readonly now = input<number>(Date.now());
  /** Viewer's zone capture state for this objective (from the location tracker). */
  readonly capture = input<GeofenceStatus | null>(null);
  readonly open = output<Objective>();
  readonly navigate = output<Objective>();

  protected readonly fmt = formatNumber;
  protected readonly showBar = showCaptureBar;
  protected readonly canAccrue = computed(() => zoneCanAccrue(this.objective()));
  protected readonly chip = computed(() => objectiveStatusChip(this.objective().status));
  protected readonly owner = computed(() => this.teams().find((t) => t.id === this.objective().ownerTeamId) ?? null);
  protected readonly distance = computed(() => formatDistance(this.distanceM()));
  protected readonly blockedLabel = computed(() => {
    const r = this.objective().blockedReason;
    return r ? BLOCK_REASON_LABELS[r] : '';
  });
  protected readonly methodIcon = computed(() => {
    const m = this.objective().methods;
    return m.includes('geofence') ? 'lucideCrosshair' : m.includes('qr') ? 'lucideQrCode' : 'lucideKeyRound';
  });
  protected readonly methodsLabel = computed(() =>
    this.objective()
      .methods.map((m) => (m === 'code' ? $localize`Code` : m === 'qr' ? $localize`QR` : $localize`Hold zone`))
      .join(' / '),
  );
  protected readonly timeLeft = computed(() => {
    const o = this.objective();
    const now = this.now();
    if (o.cooldownUntil && new Date(o.cooldownUntil).getTime() > now) {
      return $localize`Cooldown ${formatDuration(new Date(o.cooldownUntil).getTime() - now)}:getTime:`;
    }
    if (o.availabilityEnd && o.status !== 'completed') {
      const ms = new Date(o.availabilityEnd).getTime() - now;
      if (ms > 0) return $localize`Closes in ${formatDuration(ms)}:ms:`;
    }
    if (o.availabilityStart && o.status === 'inactive') {
      const ms = new Date(o.availabilityStart).getTime() - now;
      if (ms > 0) return $localize`Opens in ${formatDuration(ms)}:ms:`;
    }
    return null;
  });
}

/** Perk card in the store. */
@Component({
  selector: 'ah-perk-card',
  imports: [NgIcon, HlmButton, CurrencyDisplay],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let p = perk();
    <article class="panel flex h-full flex-col gap-3 p-4" [class.opacity-60]="!p.enabled">
      <div class="flex items-start gap-3">
        <span class="grid size-11 shrink-0 place-items-center rounded-md bg-muted text-primary" aria-hidden="true">
          <ng-icon [name]="icon()" size="22" />
        </span>
        <div class="min-w-0 flex-1">
          @if (typeLabel().toLowerCase() !== p.name.toLowerCase()) {
            <p class="label-caps">{{ typeLabel() }}</p>
          }
          <h3 class="truncate font-bold uppercase">{{ p.name }}</h3>
        </div>
        <ah-currency-display [amount]="p.price" size="md" />
      </div>
      <p class="text-sm text-muted-foreground">{{ p.description }}</p>
      <dl class="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt class="label-caps" i18n>Duration</dt>
          <dd class="num">{{ p.durationSec ? dur(p.durationSec * 1000) : txt.instant }}</dd>
        </div>
        <div>
          <dt class="label-caps" i18n>Cooldown</dt>
          <dd class="num">{{ p.cooldownSec ? dur(p.cooldownSec * 1000) : txt.none }}</dd>
        </div>
        <div>
          <dt class="label-caps" i18n>Left</dt>
          <dd class="num">{{ p.remainingQuantity === null ? '∞' : p.remainingQuantity }}</dd>
        </div>
      </dl>
      @if (p.requiresApproval) {
        <p class="text-xs text-warning" i18n>◐ Needs Game Master approval</p>
      }
      <div class="mt-auto flex items-center justify-between gap-2">
        <span class="text-xs text-muted-foreground">{{ availabilityLabel() }}</span>
        <button hlmBtn class="h-11 min-w-28" type="button" [disabled]="!canBuy()" (click)="buy.emit(p)" ariaLabel="Buy {{ p.name }} for {{ p.price }} credits" i18n-ariaLabel>
          <ng-icon name="lucideShoppingCart" size="16" aria-hidden="true" /> <ng-container i18n>Buy</ng-container>
        </button>
      </div>
    </article>
  `,
})
export class PerkCard {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    instant: $localize`Instant`,
    none: $localize`None`,
  };

  readonly perk = input.required<Perk>();
  readonly buy = output<Perk>();
  protected readonly dur = formatDuration;
  protected readonly typeLabel = computed(() => PERK_TYPE_LABELS[this.perk().type]);
  protected readonly icon = computed(() => (this.perk().icon?.startsWith('lucide') ? this.perk().icon : perkIcon(this.perk().type)));
  protected readonly canBuy = computed(() => this.perk().availability?.canBuy ?? false);
  protected readonly availabilityLabel = computed(() => {
    const a = this.perk().availability;
    if (!a || a.canBuy) return a?.teamPurchases ? $localize`Bought ${a.teamPurchases}:teamPurchases:× by your team` : '';
    switch (a.reason) {
      case 'insufficient_funds':
        return $localize`Not enough credits`;
      case 'cooldown':
        return a.cooldownUntil ? $localize`Cooldown until ${formatTime(a.cooldownUntil)}:cooldownUntil:` : $localize`Cooling down`;
      case 'sold_out':
        return $localize`Sold out`;
      case 'team_limit':
        return $localize`Team limit reached`;
      case 'not_eligible':
        return $localize`Your role cannot buy this`;
      case 'store_disabled':
        return $localize`Store closed`;
      case 'not_live':
        return $localize`Available during the game`;
      case 'no_team':
        return $localize`Join a team first`;
      default:
        return $localize`Unavailable`;
    }
  });
}

export function perkIcon(type: Perk['type']): string {
  switch (type) {
    case 'uav':
      return 'lucideRadar';
    case 'recon':
      return 'lucideScan';
    case 'jammer':
      return 'lucideAntenna';
    case 'theft':
      return 'lucideCoins';
    case 'shield':
      return 'lucideShieldCheck';
    case 'double_points':
      return 'lucideSparkles';
    case 'instant_respawn':
      return 'lucideHeartPulse';
    case 'supply_drop':
      return 'lucidePackage';
    case 'comms_jammer':
      return 'lucideRadio';
    default:
      return 'lucideZap';
  }
}
