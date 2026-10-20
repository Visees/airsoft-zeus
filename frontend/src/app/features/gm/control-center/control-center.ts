import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiService } from '../../../core/api/api.service';
import { ApiError } from '../../../core/api/api-error';
import {
  Capture,
  EventStatus,
  GmAlert,
  GmObjectiveAction,
  Member,
  Objective,
  ObjectiveStatus,
  PerkPurchase,
  Precision,
  PositionStatus,
  Squad,
  Team,
  VisibilityRules,
  VisiblePosition,
} from '../../../core/api/models';
import { LiveStore } from '../../../core/live/live-store';
import { ThemeService } from '../../../core/theme/theme.service';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { ToastService } from '../../../core/ui/toast.service';
import {
  OBJECTIVE_STATUS_LABELS,
  PERK_TYPE_LABELS,
  PLAYER_ROLE_LABELS,
  PRECISION_LABELS,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatRelative,
  formatTime,
} from '../../../core/util/format';
import { CurrencyDisplay } from '../../../shared/currency-display';
import { GameTimer, nowSignal } from '../../../shared/game-timer';
import { ConnectionStatus } from '../../../shared/link-status';
import { TacticalMap } from '../../../shared/map/tactical-map';
import { ScoreDisplay } from '../../../shared/score-display';
import { SquadBadge } from '../../../shared/squad-badge';
import { EmptyState, ErrorState, LoadingSkeleton } from '../../../shared/states';
import { StatusChip, eventStatusChip, objectiveStatusChip, purchaseStatusChip } from '../../../shared/status-chip';
import { TeamBadge } from '../../../shared/team-badge';
import { TeamSwatch } from '../../../shared/team-swatch';
import { AdjustBalanceDialog } from '../ops/adjust-balance-dialog';
import { AnnounceForm } from '../ops/announce-form';
import { OpsDialog } from '../ops/ops-dialog';

type PhoneTab = 'teams' | 'objectives' | 'players' | 'alerts' | 'feed' | 'actions';
type LeftTab = 'objectives' | 'players' | 'captures';
type Dialog = 'announce' | 'emergency' | 'adjust' | 'extend' | null;

interface PlayerRow {
  member: Member;
  pos: VisiblePosition | null;
  team: Team | null;
  squad: Squad | null;
  presence: PositionStatus;
  accuracy: number | null;
  suspicious: boolean;
  flags: string[];
  lastUpdate: string | null;
}

const PRESENCE: Record<PositionStatus, { glyph: string; label: string; cls: string }> = {
  online: { glyph: '●', label: 'Online', cls: 'text-primary' },
  stale: { glyph: '◐', label: 'Stale', cls: 'text-warning' },
  offline: { glyph: '○', label: 'Offline', cls: 'text-muted-foreground' },
};

const SEVERITY: Record<GmAlert['severity'], { glyph: string; label: string; tone: 'neutral' | 'warning' | 'danger' }> = {
  critical: { glyph: '■', label: 'Critical', tone: 'danger' },
  warning: { glyph: '▲', label: 'Warning', tone: 'warning' },
  info: { glyph: '●', label: 'Info', tone: 'neutral' },
};

const SELECT_CLASS = 'h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30';
const OBJ_STATUSES: ObjectiveStatus[] = ['active', 'contested', 'captured', 'inactive', 'locked', 'disabled', 'completed'];

/**
 * GM control center (full screen, outside the shell). LiveStore is provided on the route.
 * ≥1024px: command bar + three columns (scoreboard/objectives/players · live map · alerts/requests/feed).
 * Smaller: map on top + tabs.
 */
@Component({
  selector: 'zeus-control-center-screen',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    NgIcon,
    HlmButton,
    HlmInput,
    HlmLabel,
    TacticalMap,
    GameTimer,
    ConnectionStatus,
    ScoreDisplay,
    CurrencyDisplay,
    StatusChip,
    TeamBadge,
    TeamSwatch,
    SquadBadge,
    EmptyState,
    ErrorState,
    LoadingSkeleton,
    OpsDialog,
    AnnounceForm,
    AdjustBalanceDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'fixed inset-0 flex flex-col bg-background text-foreground', '(document:keydown)': 'onKey($event)' },
  template: `
    <!-- ======================= command bar ======================= -->
    <header class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-2 py-2 lg:px-3">
      <a [routerLink]="['/gm/events', eventId()]" hlmBtn variant="ghost" size="icon" class="size-11 shrink-0" aria-label="Back to the event editor">
        <ng-icon name="lucideArrowLeft" size="20" aria-hidden="true" />
      </a>
      <div class="min-w-0 flex-1 lg:flex-none">
        <p class="label-caps leading-none">Control center</p>
        <h1 class="max-w-[18rem] truncate text-base uppercase lg:text-lg">{{ store.event()?.name ?? 'Loading…' }}</h1>
      </div>
      @if (status(); as s) {
        <zeus-status-chip [spec]="statusChip(s)" />
      }
      <zeus-game-timer [clock]="store.clock()" [startAt]="store.event()?.startAt ?? null" [serverOffsetMs]="store.serverOffsetMs()" size="md" />
      <zeus-connection-status [compact]="!wide()" />
      @if (store.fromCache()) {
        <span class="text-xs text-warning">Showing cached data</span>
      }

      @if (wide()) {
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <ng-container [ngTemplateOutlet]="gameControls" />
          <button hlmBtn type="button" variant="outline" class="h-11" (click)="openAnnounce()">
            <ng-icon name="lucideMegaphone" size="16" aria-hidden="true" /> Announce
          </button>
          <button hlmBtn type="button" variant="outline" class="h-11" (click)="openAdjust(null, null)">
            <ng-icon name="lucideSlidersHorizontal" size="16" aria-hidden="true" /> Adjust
          </button>
          <button hlmBtn type="button" class="h-11 bg-destructive! text-destructive-foreground! hover:bg-destructive/85!" (click)="dialog.set('emergency')" [disabled]="ended()">
            <ng-icon name="lucideSiren" size="16" aria-hidden="true" /> Emergency
          </button>
          <div class="relative">
            <button hlmBtn type="button" variant="ghost" size="icon" class="size-11" (click)="moreOpen.set(!moreOpen())" [attr.aria-expanded]="moreOpen()" aria-controls="cc-more" aria-label="Settings and links">
              <ng-icon name="lucideEllipsisVertical" size="18" aria-hidden="true" />
            </button>
            @if (moreOpen()) {
              <div id="cc-more" class="panel absolute right-0 top-12 z-40 max-h-[80dvh] w-80 overflow-y-auto p-3 shadow-2xl">
                <ng-container [ngTemplateOutlet]="settingsTpl" />
              </div>
            }
          </div>
        </div>
      } @else {
        <button hlmBtn type="button" size="icon" class="size-11 bg-destructive! text-destructive-foreground!" (click)="dialog.set('emergency')" [disabled]="ended()" aria-label="Send emergency alert">
          <ng-icon name="lucideSiren" size="18" aria-hidden="true" />
        </button>
      }
    </header>

    @if (store.loading() && !store.event()) {
      <div class="p-4"><zeus-loading-skeleton [rows]="6" /></div>
    } @else if (store.error() && !store.event()) {
      <div class="mx-auto w-full max-w-lg p-4"><zeus-error-state [error]="store.error()" (retry)="store.reload()" /></div>
    } @else if (wide()) {
      <!-- ======================= desktop ======================= -->
      <div class="grid min-h-0 flex-1 grid-cols-[20rem_1fr_22rem] xl:grid-cols-[23rem_1fr_25rem]">
        <aside class="flex min-h-0 flex-col overflow-hidden border-r border-border" aria-label="Teams, objectives and players">
          <div class="shrink-0 border-b border-border p-3"><ng-container [ngTemplateOutlet]="teamsTpl" /></div>
          <div role="tablist" aria-label="Lists" class="flex shrink-0 border-b border-border">
            @for (t of leftTabs; track t.id) {
              <button
                type="button"
                role="tab"
                class="h-11 flex-1 border-b-2 text-sm font-semibold"
                [class]="leftTab() === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
                [attr.aria-selected]="leftTab() === t.id"
                (click)="leftTab.set(t.id)"
              >
                {{ t.label }}
              </button>
            }
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto p-3" role="tabpanel">
            @switch (leftTab()) {
              @case ('objectives') {
                <ng-container [ngTemplateOutlet]="objectivesTpl" />
              }
              @case ('players') {
                <ng-container [ngTemplateOutlet]="playersTpl" />
              }
              @case ('captures') {
                <ng-container [ngTemplateOutlet]="capturesTpl" />
              }
            }
          </div>
        </aside>
        <main class="relative min-h-0 min-w-0"><ng-container [ngTemplateOutlet]="mapTpl" /></main>
        <aside class="flex min-h-0 flex-col gap-5 overflow-y-auto border-l border-border p-3" aria-label="Alerts, requests and activity">
          <ng-container [ngTemplateOutlet]="alertsTpl" />
          <ng-container [ngTemplateOutlet]="purchasesTpl" />
          <ng-container [ngTemplateOutlet]="effectsTpl" />
          <ng-container [ngTemplateOutlet]="feedTpl" />
        </aside>
      </div>
    } @else {
      <!-- ======================= phone / tablet portrait ======================= -->
      <div class="flex min-h-0 flex-1 flex-col">
        <div class="relative h-[42dvh] shrink-0 border-b border-border"><ng-container [ngTemplateOutlet]="mapTpl" /></div>
        <div role="tablist" aria-label="Sections" class="flex shrink-0 overflow-x-auto border-b border-border bg-card">
          @for (t of phoneTabs; track t.id) {
            <button
              type="button"
              role="tab"
              class="relative flex h-12 min-w-16 flex-1 flex-col items-center justify-center gap-0.5 border-b-2 px-2 text-[0.7rem] font-semibold"
              [class]="phoneTab() === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'"
              [attr.aria-selected]="phoneTab() === t.id"
              (click)="phoneTab.set(t.id)"
            >
              <ng-icon [name]="t.icon" size="16" aria-hidden="true" />
              {{ t.label }}
              @if (t.id === 'alerts' && openAlertCount()) {
                <span class="num absolute right-1 top-1 rounded-sm bg-destructive px-1 text-[0.65rem] text-destructive-foreground">{{ openAlertCount() }}</span>
              }
            </button>
          }
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-3" role="tabpanel">
          @switch (phoneTab()) {
            @case ('teams') {
              <ng-container [ngTemplateOutlet]="teamsTpl" />
            }
            @case ('objectives') {
              <ng-container [ngTemplateOutlet]="objectivesTpl" />
              <div class="mt-5"><ng-container [ngTemplateOutlet]="capturesTpl" /></div>
            }
            @case ('players') {
              @if (selectedPlayer(); as p) {
                <div class="panel mb-3 p-3"><ng-container [ngTemplateOutlet]="playerDetailsTpl" [ngTemplateOutletContext]="{ $implicit: p }" /></div>
              }
              <ng-container [ngTemplateOutlet]="playersTpl" />
            }
            @case ('alerts') {
              <div class="flex flex-col gap-5">
                <ng-container [ngTemplateOutlet]="alertsTpl" />
                <ng-container [ngTemplateOutlet]="purchasesTpl" />
                <ng-container [ngTemplateOutlet]="effectsTpl" />
              </div>
            }
            @case ('feed') {
              <ng-container [ngTemplateOutlet]="feedTpl" />
            }
            @case ('actions') {
              <div class="flex flex-col gap-4">
                <section aria-labelledby="h-ctl">
                  <h2 id="h-ctl" class="label-caps mb-2">Game controls</h2>
                  <div class="flex flex-wrap gap-2"><ng-container [ngTemplateOutlet]="gameControls" /></div>
                </section>
                <div class="grid grid-cols-2 gap-2">
                  <button hlmBtn type="button" variant="outline" class="h-12" (click)="openAnnounce()">
                    <ng-icon name="lucideMegaphone" size="16" aria-hidden="true" /> Announce
                  </button>
                  <button hlmBtn type="button" variant="outline" class="h-12" (click)="openAdjust(null, null)">
                    <ng-icon name="lucideSlidersHorizontal" size="16" aria-hidden="true" /> Adjust score
                  </button>
                  <button hlmBtn type="button" class="col-span-2 h-12 bg-destructive! text-destructive-foreground!" (click)="dialog.set('emergency')" [disabled]="ended()">
                    <ng-icon name="lucideSiren" size="16" aria-hidden="true" /> Emergency alert
                  </button>
                </div>
                <ng-container [ngTemplateOutlet]="settingsTpl" />
              </div>
            }
          }
        </div>
      </div>
    }

    <!-- ======================= templates ======================= -->

    <ng-template #gameControls>
      @switch (status()) {
        @case ('lobby') {
          <button hlmBtn type="button" class="h-11" (click)="start()" [disabled]="busy()">
            <ng-icon name="lucidePlay" size="16" aria-hidden="true" /> Start game
          </button>
        }
        @case ('live') {
          <button hlmBtn type="button" variant="outline" class="h-11" (click)="pause()" [disabled]="busy()">
            <ng-icon name="lucidePause" size="16" aria-hidden="true" /> Pause
          </button>
        }
        @case ('paused') {
          <button hlmBtn type="button" class="h-11" (click)="resume()" [disabled]="busy()">
            <ng-icon name="lucidePlay" size="16" aria-hidden="true" /> Resume
          </button>
        }
        @case ('published') {
          <button hlmBtn type="button" variant="outline" class="h-11" (click)="openLobby()" [disabled]="busy()">
            <ng-icon name="lucideUsers" size="16" aria-hidden="true" /> Open lobby
          </button>
        }
        @case ('registration_open') {
          <button hlmBtn type="button" variant="outline" class="h-11" (click)="openLobby()" [disabled]="busy()">
            <ng-icon name="lucideUsers" size="16" aria-hidden="true" /> Open lobby
          </button>
        }
      }
      @if (status() === 'live' || status() === 'paused' || status() === 'lobby') {
        <button hlmBtn type="button" variant="outline" class="h-11" (click)="dialog.set('extend')" [disabled]="busy()">
          <ng-icon name="lucideTimer" size="16" aria-hidden="true" /> Extend
        </button>
      }
      @if (status() === 'live' || status() === 'paused') {
        <button hlmBtn type="button" variant="destructive" class="h-11" (click)="endGame()" [disabled]="busy()">
          <ng-icon name="lucideCircleStop" size="16" aria-hidden="true" /> End game
        </button>
      }
      @if (status() === 'completed') {
        <a hlmBtn class="h-11" [routerLink]="['/events', eventId(), 'results', 'export']">
          <ng-icon name="lucideFileDown" size="16" aria-hidden="true" /> Export results
        </a>
      }
    </ng-template>

    <!-- ---------- teams ---------- -->
    <ng-template #teamsTpl>
      <section aria-labelledby="h-teams">
        <h2 id="h-teams" class="label-caps mb-2">Scoreboard · {{ teams().length }} teams</h2>
        @if (!teams().length) {
          <p class="text-sm text-muted-foreground">No teams.</p>
        }
        <ol class="flex flex-col gap-1.5">
          @for (t of rankedTeams(); track t.id; let i = $index) {
            <li class="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
              <span class="num w-4 text-xs text-muted-foreground">{{ i + 1 }}</span>
              <div class="min-w-0 flex-1">
                <zeus-team-badge [team]="t" size="sm" />
                <p class="num text-xs text-muted-foreground">{{ onlineByTeam().get(t.id) ?? 0 }}/{{ t.memberCount }} online · {{ t.objectivesHeld }} held</p>
              </div>
              <div class="flex flex-col items-end">
                <zeus-score-display [points]="t.points" size="sm" [showUnit]="false" />
                <zeus-currency-display [amount]="t.currency" size="sm" [showUnit]="false" />
              </div>
              <button hlmBtn type="button" variant="ghost" size="icon" class="size-10" (click)="openAdjust(t.id, null)" [attr.aria-label]="'Adjust points or credits of ' + t.name">
                <ng-icon name="lucideSlidersHorizontal" size="16" aria-hidden="true" />
              </button>
            </li>
          }
        </ol>
      </section>
    </ng-template>

    <!-- ---------- objectives ---------- -->
    <ng-template #objectivesTpl>
      <section aria-labelledby="h-objs">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h2 id="h-objs" class="label-caps">Objectives · {{ activeObjectiveCount() }} active</h2>
          <select [class]="selectClass + ' w-auto!'" [value]="statusFilter()" (change)="statusFilter.set($any($event.target).value)" aria-label="Filter objectives by status">
            <option value="">All statuses</option>
            @for (s of objStatuses; track s) {
              <option [value]="s">{{ objStatusLabels[s] }}</option>
            }
          </select>
        </div>
        @if (!filteredObjectives().length) {
          <zeus-empty-state icon="lucideFlag" [title]="statusFilter() ? 'No objectives with this status' : 'No objectives'" />
        }
        <ul class="flex flex-col gap-1.5">
          @for (o of filteredObjectives(); track o.id) {
            <li class="rounded-md border border-border bg-card" [class.ring-2]="focusObjectiveId() === o.id" [class.ring-nav]="focusObjectiveId() === o.id" [id]="'cc-obj-' + o.id">
              <details [open]="focusObjectiveId() === o.id" class="group">
                <summary class="flex min-h-12 cursor-pointer list-none items-center gap-2 px-2 py-1.5 [&::-webkit-details-marker]:hidden">
                  <ng-icon name="lucideChevronRight" size="14" class="shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold">{{ o.name }}</p>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <zeus-status-chip [spec]="objChip(o.status)" />
                      @if (o.ownerTeamId && teamById().get(o.ownerTeamId); as owner) {
                        <zeus-team-badge [team]="owner" size="sm" [showIcon]="false" />
                      }
                    </div>
                  </div>
                  <span class="num text-xs text-muted-foreground" [title]="o.captureCount + ' captures'">×{{ o.captureCount }}</span>
                </summary>
                <div class="flex flex-col gap-2 border-t border-border p-2">
                  <p class="text-xs text-muted-foreground">
                    @if (o.lastCapturedAt) {
                      Last capture {{ rel(o.lastCapturedAt) }}{{ o.lastCapturedByNickname ? ' by ' + o.lastCapturedByNickname : '' }}.
                    }
                    @if (o.cooldownUntil && isFuture(o.cooldownUntil)) {
                      Cooldown until {{ time(o.cooldownUntil) }}.
                    }
                    {{ o.methods.join(' · ').toUpperCase() }}
                  </p>
                  <div class="grid grid-cols-2 gap-1.5">
                    @if (o.status === 'disabled') {
                      <button hlmBtn type="button" variant="outline" class="h-10" (click)="objAction(o, 'activate')">Activate</button>
                    } @else {
                      <button hlmBtn type="button" variant="outline" class="h-10" (click)="objAction(o, 'disable')">Disable</button>
                    }
                    @if (o.contested) {
                      <button hlmBtn type="button" variant="outline" class="h-10" (click)="objAction(o, 'uncontest')">Clear contest</button>
                    } @else {
                      <button hlmBtn type="button" variant="outline" class="h-10" (click)="objAction(o, 'contest')">Mark contested</button>
                    }
                    @if (o.ownerTeamId) {
                      <button hlmBtn type="button" variant="outline" class="h-10" (click)="objAction(o, 'clear_owner')">Clear owner</button>
                    }
                    <button hlmBtn type="button" variant="destructive" class="h-10" (click)="objAction(o, 'reset')">Reset</button>
                  </div>
                  <div class="flex gap-1.5">
                    <label class="sr-only" [for]="'own-' + o.id">New owner of {{ o.name }}</label>
                    <select [id]="'own-' + o.id" [class]="selectClass" #ownSel>
                      @for (t of teams(); track t.id) {
                        <option [value]="t.id" [selected]="t.id === o.ownerTeamId">{{ t.name }}</option>
                      }
                    </select>
                    <button hlmBtn type="button" variant="outline" class="h-10 shrink-0" (click)="objAction(o, 'set_owner', ownSel.value)" [disabled]="!teams().length">Set owner</button>
                  </div>
                  <div class="flex gap-1.5">
                    <button hlmBtn type="button" variant="ghost" class="h-10 flex-1" (click)="locate(o)">
                      <ng-icon name="lucideCrosshair" size="14" aria-hidden="true" /> Show on map
                    </button>
                    <a hlmBtn variant="ghost" class="h-10 flex-1" [routerLink]="['/gm/events', eventId(), 'objectives', o.id]" [queryParams]="{ returnTo: controlUrl() }">
                      <ng-icon name="lucidePencil" size="14" aria-hidden="true" /> Edit
                    </a>
                  </div>
                </div>
              </details>
            </li>
          }
        </ul>
      </section>
    </ng-template>

    <!-- ---------- captures ---------- -->
    <ng-template #capturesTpl>
      <section aria-labelledby="h-caps">
        <div class="mb-2 flex items-center justify-between">
          <h2 id="h-caps" class="label-caps">Recent captures</h2>
          <button hlmBtn type="button" variant="ghost" size="icon" class="size-10" (click)="loadCaptures()" aria-label="Reload captures">
            <ng-icon name="lucideRefreshCw" size="14" aria-hidden="true" />
          </button>
        </div>
        @if (capturesError()) {
          <zeus-error-state [error]="capturesError()" (retry)="loadCaptures()" />
        } @else if (!captures().length) {
          <p class="text-sm text-muted-foreground">No captures yet.</p>
        }
        <ul class="flex flex-col gap-1.5">
          @for (c of captures(); track c.id) {
            <li class="rounded-md border border-border bg-card p-2 text-sm" [class.opacity-60]="c.revoked">
              <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <p class="truncate font-semibold" [class.line-through]="c.revoked">{{ c.objectiveName }}</p>
                  <p class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <zeus-team-badge [team]="teamById().get(c.teamId)" size="sm" [showIcon]="false" />
                    {{ c.nickname ?? (c.method === 'gm' ? 'GM' : '—') }} · <span class="num uppercase">{{ c.method }}</span> · <time [attr.datetime]="c.createdAt" [title]="abs(c.createdAt)">{{ rel(c.createdAt) }}</time>
                  </p>
                </div>
                @if (c.revoked) {
                  <zeus-status-chip label="Revoked" glyph="✕" tone="danger" />
                }
              </div>
              @if (!c.revoked) {
                <div class="mt-1.5 flex items-center justify-between gap-2">
                  <label class="flex min-h-10 cursor-pointer items-center gap-2 text-xs">
                    <input type="checkbox" class="size-5 accent-primary" [checked]="!keepRewards().has(c.id)" (change)="toggleSet(keepRewards, c.id, !$any($event.target).checked)" />
                    Reverse {{ n(c.points) }} pts / {{ n(c.currency) }} cr
                  </label>
                  <button hlmBtn type="button" variant="destructive" class="h-10" (click)="revokeCapture(c)">Revoke</button>
                </div>
              }
            </li>
          }
        </ul>
      </section>
    </ng-template>

    <!-- ---------- players ---------- -->
    <ng-template #playersTpl>
      <section aria-labelledby="h-players">
        <h2 id="h-players" class="label-caps mb-2">Players · {{ onlineCount() }}/{{ players().length }} online{{ suspiciousCount() ? ' · ' + suspiciousCount() + ' flagged' : '' }}</h2>
        @if (!filteredPlayers().length) {
          <zeus-empty-state icon="lucideUsers" [title]="players().length ? 'No players match the filters' : 'No approved players'" />
        }
        <ul class="flex flex-col">
          @for (p of filteredPlayers(); track p.member.userId) {
            <li>
              <button
                type="button"
                class="flex min-h-12 w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-muted"
                [class.bg-muted]="selectedPlayerId() === p.member.userId"
                [attr.aria-pressed]="selectedPlayerId() === p.member.userId"
                (click)="selectPlayer(p.member.userId, true)"
              >
                @if (p.team) {
                  <zeus-team-swatch [color]="p.team.color" [pattern]="p.team.pattern" />
                } @else {
                  <span class="inline-block size-3.5 rounded-xs border border-dashed border-border" aria-hidden="true"></span>
                }
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-semibold">{{ p.member.nickname }}</span>
                  <span class="block truncate text-xs text-muted-foreground">{{ p.team?.name ?? 'No team' }}{{ p.squad ? ' · ' + (p.squad.callsign || p.squad.name) : '' }}</span>
                </span>
                @if (p.suspicious) {
                  <span class="text-xs font-semibold text-destructive" title="Suspicious GPS">▲ GPS</span>
                }
                <span class="flex w-20 flex-col items-end text-xs">
                  <span [class]="presence(p.presence).cls"><span aria-hidden="true">{{ presence(p.presence).glyph }}</span> {{ presence(p.presence).label }}</span>
                  <span class="num text-muted-foreground">{{ p.accuracy !== null ? '±' + round(p.accuracy) + ' m' : '—' }} · {{ p.lastUpdate ? rel(p.lastUpdate) : 'never' }}</span>
                </span>
              </button>
            </li>
          }
        </ul>
      </section>
    </ng-template>

    <ng-template #playerDetailsTpl let-p>
      <div class="flex flex-col gap-2 text-sm">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-base font-bold">{{ p.member.nickname }}</p>
            <div class="flex flex-wrap items-center gap-1.5">
              <zeus-team-badge [team]="p.team" size="sm" />
              @if (p.squad) {
                <zeus-squad-badge [squad]="p.squad" [leader]="p.member.isSquadLeader" />
              }
              @if (p.member.playerRole) {
                <span class="text-xs text-muted-foreground">{{ roleLabels[p.member.playerRole] }}</span>
              }
            </div>
          </div>
          <button hlmBtn type="button" variant="ghost" size="icon" class="size-10 shrink-0" (click)="selectedPlayerId.set(null)" aria-label="Close player details">
            <ng-icon name="lucideX" size="16" aria-hidden="true" />
          </button>
        </div>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt class="text-muted-foreground">Status</dt>
          <dd [class]="presence(p.presence).cls"><span aria-hidden="true">{{ presence(p.presence).glyph }}</span> {{ presence(p.presence).label }}</dd>
          <dt class="text-muted-foreground">GPS</dt>
          <dd class="num">{{ p.accuracy !== null ? '±' + round(p.accuracy) + ' m' : 'No fix' }}{{ p.member.trackingActive ? '' : ' · not sharing' }}</dd>
          <dt class="text-muted-foreground">Last update</dt>
          <dd>{{ p.lastUpdate ? rel(p.lastUpdate) + ' · ' + time(p.lastUpdate) : 'Never' }}</dd>
          @if (p.suspicious || p.flags.length) {
            <dt class="text-destructive">Flags</dt>
            <dd class="text-destructive">▲ {{ p.flags.length ? p.flags.join(', ') : 'Suspicious movement' }}</dd>
          }
        </dl>
        <div class="grid grid-cols-2 gap-1.5">
          <button hlmBtn type="button" variant="outline" class="h-10" (click)="locatePlayer(p)" [disabled]="!p.pos">
            <ng-icon name="lucideCrosshair" size="14" aria-hidden="true" /> Locate
          </button>
          <button hlmBtn type="button" variant="outline" class="h-10" (click)="openAnnounce('player', null, p.member.userId)">
            <ng-icon name="lucideMessageSquare" size="14" aria-hidden="true" /> Message
          </button>
          <button hlmBtn type="button" variant="outline" class="h-10" (click)="openAdjust(p.member.teamId, p.member.userId)" [disabled]="!p.member.teamId">
            <ng-icon name="lucideSlidersHorizontal" size="14" aria-hidden="true" /> Team score
          </button>
          <button hlmBtn type="button" variant="destructive" class="h-10" (click)="removePlayer(p.member)">
            <ng-icon name="lucideUserX" size="14" aria-hidden="true" /> Remove
          </button>
        </div>
        <div class="flex gap-1.5">
          <label class="sr-only" for="cc-move-team">Move {{ p.member.nickname }} to team</label>
          <select id="cc-move-team" [class]="selectClass" #moveSel>
            @for (t of teams(); track t.id) {
              <option [value]="t.id" [selected]="t.id === p.member.teamId">{{ t.name }}</option>
            }
          </select>
          <button hlmBtn type="button" variant="outline" class="h-10 shrink-0" (click)="movePlayer(p.member, moveSel.value)">Move</button>
        </div>
      </div>
    </ng-template>

    <!-- ---------- map ---------- -->
    <ng-template #mapTpl>
      <zeus-tactical-map
        #map
        class="absolute inset-0"
        [objectives]="filteredObjectives()"
        [pois]="store.pois()"
        [zones]="store.zones()"
        [positions]="mapPositions()"
        [teams]="teams()"
        [selectedId]="selectedPlayerId() ?? focusObjectiveId()"
        [center]="areaCenter()"
        [zoom]="store.event()?.area?.zoom ?? 16"
        [showLabels]="showMapLabels()"
        [fitKey]="fitKey()"
        (playerClick)="selectPlayer($event.userId, false)"
        (objectiveClick)="focusObjective($event.id)"
        (mapClick)="selectedPlayerId.set(null)"
      />
      <div class="hud absolute left-2 right-16 top-2 z-10 flex flex-col gap-2 p-2">
        <div class="flex items-center gap-2">
          <div class="relative min-w-0 flex-1">
            <label for="cc-search" class="sr-only">Find a player</label>
            <ng-icon name="lucideSearch" size="14" class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              #search
              hlmInput
              id="cc-search"
              type="search"
              class="h-10 pl-7"
              placeholder="Find player"
              autocomplete="off"
              aria-keyshortcuts="/"
              [value]="query()"
              (input)="onSearch($any($event.target).value)"
              (keydown.enter)="selectFirstMatch()"
            />
            <kbd class="num pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-sm border border-border px-1 text-xs text-muted-foreground sm:block" aria-hidden="true">/</kbd>
          </div>
          <button hlmBtn type="button" [variant]="filtersOpen() || filtersActive() ? 'secondary' : 'outline'" class="h-10" (click)="filtersOpen.set(!filtersOpen())" [attr.aria-expanded]="filtersOpen()">
            <ng-icon name="lucideFilter" size="14" aria-hidden="true" /> Filters{{ filtersActive() ? ' •' : '' }}
          </button>
        </div>
        @if (filtersOpen()) {
          <div class="flex flex-wrap items-center gap-1.5">
            @for (t of teams(); track t.id) {
              <button
                type="button"
                class="flex h-10 items-center gap-1.5 rounded-sm border px-2 text-xs font-semibold"
                [class]="teamFilter().has(t.id) ? 'border-primary bg-primary/15' : 'border-border'"
                [attr.aria-pressed]="teamFilter().has(t.id)"
                (click)="toggleSet(teamFilter, t.id, !teamFilter().has(t.id))"
              >
                <zeus-team-swatch [color]="t.color" [pattern]="t.pattern" /> {{ t.name }}
              </button>
            }
            @if (squads().length) {
              <select [class]="selectClass + ' w-auto!'" [value]="squadFilter()" (change)="squadFilter.set($any($event.target).value)" aria-label="Filter by squad">
                <option value="">All squads</option>
                @for (s of squads(); track s.id) {
                  <option [value]="s.id">{{ s.callsign || s.name }}</option>
                }
              </select>
            }
            <select [class]="selectClass + ' w-auto!'" [value]="statusFilter()" (change)="statusFilter.set($any($event.target).value)" aria-label="Filter objectives by status">
              <option value="">All objectives</option>
              @for (s of objStatuses; track s) {
                <option [value]="s">{{ objStatusLabels[s] }}</option>
              }
            </select>
            <label class="flex h-10 cursor-pointer items-center gap-2 rounded-sm border border-border px-2 text-xs font-semibold">
              <input type="checkbox" class="size-4 accent-primary" [checked]="onlineOnly()" (change)="onlineOnly.set($any($event.target).checked)" /> Online only
            </label>
            <label class="flex h-10 cursor-pointer items-center gap-2 rounded-sm border border-border px-2 text-xs font-semibold">
              <input type="checkbox" class="size-4 accent-primary" [checked]="showMapLabels()" (change)="showMapLabels.set($any($event.target).checked)" /> Names
            </label>
            @if (filtersActive()) {
              <button hlmBtn type="button" variant="ghost" class="h-10 text-xs" (click)="clearFilters()">Clear</button>
            }
          </div>
        }
      </div>
      @if (wide() && selectedPlayer(); as p) {
        <div class="hud absolute bottom-3 left-3 z-10 w-80 p-3">
          <ng-container [ngTemplateOutlet]="playerDetailsTpl" [ngTemplateOutletContext]="{ $implicit: p }" />
        </div>
      }
    </ng-template>

    <!-- ---------- alerts ---------- -->
    <ng-template #alertsTpl>
      <section aria-labelledby="h-alerts">
        <div class="mb-2 flex flex-wrap items-center gap-1.5">
          <h2 id="h-alerts" class="label-caps mr-auto">Alerts</h2>
          @for (s of severities; track s) {
            @if (alertCounts()[s]) {
              <zeus-status-chip [label]="alertCounts()[s] + ' ' + sevSpec(s).label.toLowerCase()" [glyph]="sevSpec(s).glyph" [tone]="sevSpec(s).tone" />
            }
          }
        </div>
        @if (!sortedAlerts().length) {
          <p class="text-sm text-muted-foreground">No alerts.</p>
        }
        <ul class="flex flex-col gap-1.5">
          @for (a of sortedAlerts(); track a.id) {
            <li class="rounded-md border bg-card p-2 text-sm" [class]="a.acknowledged ? 'border-border opacity-60' : a.severity === 'critical' ? 'border-destructive/60' : a.severity === 'warning' ? 'border-warning/50' : 'border-border'">
              <div class="flex items-start gap-2">
                <zeus-status-chip [label]="sevSpec(a.severity).label" [glyph]="sevSpec(a.severity).glyph" [tone]="sevSpec(a.severity).tone" />
                <div class="min-w-0 flex-1">
                  <p>{{ a.message }}</p>
                  <p class="text-xs text-muted-foreground">{{ a.nickname ? a.nickname + ' · ' : '' }}<time [attr.datetime]="a.createdAt" [title]="abs(a.createdAt)">{{ rel(a.createdAt) }}</time></p>
                </div>
              </div>
              @if (!a.acknowledged || a.userId) {
                <div class="mt-1.5 flex justify-end gap-1.5">
                  @if (a.userId) {
                    <button hlmBtn type="button" variant="ghost" class="h-10" (click)="selectPlayer(a.userId, true)">Locate</button>
                  }
                  @if (!a.acknowledged) {
                    <button hlmBtn type="button" variant="outline" class="h-10" (click)="ack(a)" [disabled]="busyId() === a.id">Acknowledge</button>
                  }
                </div>
              }
            </li>
          }
        </ul>
      </section>
    </ng-template>

    <!-- ---------- purchase requests ---------- -->
    <ng-template #purchasesTpl>
      <section aria-labelledby="h-reqs">
        <h2 id="h-reqs" class="label-caps mb-2">Purchase requests · {{ pendingPurchases().length }}</h2>
        @if (!pendingPurchases().length) {
          <p class="text-sm text-muted-foreground">No requests waiting.</p>
        }
        <ul class="flex flex-col gap-1.5">
          @for (p of pendingPurchases(); track p.id) {
            <li class="rounded-md border border-warning/50 bg-card p-2 text-sm">
              <p class="font-semibold">{{ p.perkName }} <span class="text-xs font-normal text-muted-foreground">· {{ perkTypeLabels[p.perkType] }}</span></p>
              <p class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <zeus-team-badge [team]="teamById().get(p.teamId)" size="sm" [showIcon]="false" />
                {{ p.buyerNickname ?? '' }} · <span class="num">{{ n(p.price) }} cr</span> · {{ rel(p.createdAt) }}
                @if (p.targetTeamId) {
                  · target {{ teamById().get(p.targetTeamId)?.name }}
                }
              </p>
              <div class="mt-1.5 grid grid-cols-2 gap-1.5">
                <button hlmBtn type="button" variant="destructive" class="h-10" (click)="reviewPurchase(p, false)" [disabled]="busyId() === p.id">Reject</button>
                <button hlmBtn type="button" class="h-10" (click)="reviewPurchase(p, true)" [disabled]="busyId() === p.id">Approve</button>
              </div>
            </li>
          }
        </ul>
      </section>
    </ng-template>

    <!-- ---------- active perks / effects ---------- -->
    <ng-template #effectsTpl>
      <section aria-labelledby="h-effects">
        <h2 id="h-effects" class="label-caps mb-2">Active perks · {{ activePurchases().length }}</h2>
        @if (!activePurchases().length) {
          <p class="text-sm text-muted-foreground">No perk is active.</p>
        }
        <ul class="flex flex-col gap-1.5">
          @for (p of activePurchases(); track p.id) {
            <li class="rounded-md border border-border bg-card p-2 text-sm">
              <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <p class="font-semibold">{{ p.perkName }}</p>
                  <p class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <zeus-team-badge [team]="teamById().get(p.teamId)" size="sm" [showIcon]="false" />
                    @if (p.targetTeamId) {
                      → {{ teamById().get(p.targetTeamId)?.name }}
                    }
                    @if (p.expiresAt) {
                      · <span class="num">{{ remaining(p.expiresAt) }}</span> left
                    }
                  </p>
                </div>
                <zeus-status-chip [spec]="purchaseChip(p)" />
              </div>
              <div class="mt-1.5 flex items-center justify-between gap-2">
                <label class="flex min-h-10 cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" class="size-5 accent-primary" [checked]="refundIds().has(p.id)" [disabled]="p.refunded" (change)="toggleSet(refundIds, p.id, $any($event.target).checked)" />
                  Refund {{ n(p.price) }} cr
                </label>
                <button hlmBtn type="button" variant="destructive" class="h-10" (click)="cancelPurchase(p)" [disabled]="busyId() === p.id">Cancel perk</button>
              </div>
            </li>
          }
        </ul>
        @if (otherEffects().length) {
          <h3 class="label-caps mb-1 mt-3">Other effects</h3>
          <ul class="flex flex-col gap-1 text-xs">
            @for (e of otherEffects(); track e.id) {
              <li class="flex items-center gap-2">
                <zeus-team-badge [team]="teamById().get(e.teamId)" size="sm" [showIcon]="false" />
                <span class="flex-1">{{ e.label }}</span>
                <span class="num text-muted-foreground">{{ remaining(e.expiresAt) }}</span>
              </li>
            }
          </ul>
        }
      </section>
    </ng-template>

    <!-- ---------- feed ---------- -->
    <ng-template #feedTpl>
      <section aria-labelledby="h-feed">
        <div class="mb-2 flex items-center justify-between">
          <h2 id="h-feed" class="label-caps">Activity</h2>
          <a [routerLink]="['/gm/events', eventId(), 'activity']" class="text-xs text-muted-foreground underline-offset-4 hover:underline">Full log</a>
        </div>
        @if (!store.activity().length) {
          <p class="text-sm text-muted-foreground">Nothing yet.</p>
        }
        <ol class="flex flex-col" aria-live="polite" aria-relevant="additions">
          @for (a of feed(); track a.id) {
            <li class="flex gap-2 border-b border-border py-1.5 text-sm last:border-0">
              <time class="num w-12 shrink-0 text-xs text-muted-foreground" [attr.datetime]="a.createdAt" [title]="abs(a.createdAt)">{{ time(a.createdAt) }}</time>
              <span class="min-w-0 flex-1">{{ a.message }}</span>
              @if (a.scope === 'gm') {
                <span class="text-[0.65rem] font-semibold text-muted-foreground">GM</span>
              }
            </li>
          }
        </ol>
      </section>
    </ng-template>

    <!-- ---------- settings and links ---------- -->
    <ng-template #settingsTpl>
      <section class="flex flex-col gap-3" aria-labelledby="h-vis">
        <h2 id="h-vis" class="label-caps">Map visibility (applies immediately)</h2>
        @if (rules(); as r) {
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="cc-ally">Teammates' precision</label>
            <select id="cc-ally" [class]="selectClass" [value]="r.allyPrecision" (change)="setRule('allyPrecision', $event, precisionLabels)">
              @for (p of precisions; track p) {
                <option [value]="p">{{ precisionLabels[p] }}</option>
              }
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="cc-enemy">Enemy positions</label>
            <select id="cc-enemy" [class]="selectClass" [value]="r.enemies" (change)="setRule('enemies', $event, enemyLabels)">
              <option value="never">{{ enemyLabels['never'] }}</option>
              <option value="perk_only">{{ enemyLabels['perk_only'] }}</option>
              <option value="always">{{ enemyLabels['always'] }}</option>
            </select>
          </div>
          <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" class="size-5 accent-primary" [checked]="r.showNicknames" (change)="setNicknames($event)" /> Show nicknames on players' maps
          </label>
        }
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="cc-interval">Location update interval</label>
          <select id="cc-interval" [class]="selectClass" [value]="intervalValue()" (change)="setInterval($event)">
            @for (s of intervals; track s) {
              <option [value]="s">Every {{ s }} s</option>
            }
          </select>
          <p class="text-xs text-muted-foreground">Shorter is more precise but uses more battery.</p>
        </div>
      </section>
      <nav class="mt-4 flex flex-col" aria-label="GM tools">
        <h2 class="label-caps mb-1">Tools</h2>
        <a [routerLink]="['/events', eventId(), 'results', 'export']" class="flex min-h-11 items-center gap-3 rounded-sm px-2 text-sm hover:bg-muted"><ng-icon name="lucideFileDown" size="16" aria-hidden="true" /> Export results</a>
        <a [routerLink]="['/gm/events', eventId(), 'activity']" class="flex min-h-11 items-center gap-3 rounded-sm px-2 text-sm hover:bg-muted"><ng-icon name="lucideHistory" size="16" aria-hidden="true" /> Activity log</a>
        <a [routerLink]="['/gm/events', eventId(), 'scores']" class="flex min-h-11 items-center gap-3 rounded-sm px-2 text-sm hover:bg-muted"><ng-icon name="lucideTrophy" size="16" aria-hidden="true" /> Score manager</a>
        <a [routerLink]="['/gm/events', eventId(), 'players']" class="flex min-h-11 items-center gap-3 rounded-sm px-2 text-sm hover:bg-muted"><ng-icon name="lucideUsers" size="16" aria-hidden="true" /> Player management</a>
        <a [routerLink]="['/gm/events', eventId(), 'map']" class="flex min-h-11 items-center gap-3 rounded-sm px-2 text-sm hover:bg-muted"><ng-icon name="lucideMap" size="16" aria-hidden="true" /> Map editor</a>
      </nav>
      <p class="mt-3 text-xs text-muted-foreground">Shortcuts: <kbd class="num rounded-sm border border-border px-1">/</kbd> find player · <kbd class="num rounded-sm border border-border px-1">Esc</kbd> clear selection</p>
    </ng-template>

    <!-- ======================= dialogs ======================= -->
    <zeus-ops-dialog [open]="dialog() === 'announce'" title="Send announcement" (closed)="dialog.set(null)">
      @if (dialog() === 'announce') {
        <zeus-announce-form
          [eventId]="eventId()"
          [teams]="teams()"
          [members]="store.members()"
          [presetScope]="announceScope()"
          [presetTeamId]="announceTeamId()"
          [presetUserId]="announceUserId()"
          (sent)="dialog.set(null)"
          (cancel)="dialog.set(null)"
        />
      }
    </zeus-ops-dialog>

    <zeus-ops-dialog [open]="dialog() === 'emergency'" title="Emergency alert" (closed)="dialog.set(null)">
      @if (dialog() === 'emergency') {
        <zeus-announce-form [eventId]="eventId()" [teams]="teams()" [members]="store.members()" [emergency]="true" (sent)="dialog.set(null)" (cancel)="dialog.set(null)" />
      }
    </zeus-ops-dialog>

    <zeus-ops-dialog [open]="dialog() === 'extend'" title="Extend game time" [subtitle]="endsAtLabel()" (closed)="dialog.set(null)">
      @if (dialog() === 'extend') {
        <div class="flex flex-col gap-4">
          <div class="grid grid-cols-3 gap-2">
            @for (m of [5, 10, 15]; track m) {
              <button hlmBtn type="button" variant="outline" class="num h-12 text-base" (click)="extend(m)" [disabled]="busy()">+{{ m }} min</button>
            }
          </div>
          <form class="flex items-end gap-2" (submit)="$event.preventDefault(); extend(customMinutes.valueAsNumber)">
            <div class="flex flex-1 flex-col gap-1.5">
              <label hlmLabel for="cc-ext">Custom (minutes)</label>
              <input hlmInput #customMinutes id="cc-ext" type="number" min="1" max="600" step="1" value="30" class="num h-11" />
            </div>
            <button hlmBtn type="submit" class="h-11" [disabled]="busy()">Extend</button>
          </form>
        </div>
      }
    </zeus-ops-dialog>

    <zeus-adjust-balance-dialog
      [eventId]="eventId()"
      [teams]="teams()"
      [members]="store.members()"
      [open]="dialog() === 'adjust'"
      [presetTeamId]="adjustTeamId()"
      [presetUserId]="adjustUserId()"
      [allowNegativePoints]="store.event()?.scoring?.allowNegativePoints ?? false"
      [maxCurrency]="store.event()?.scoring?.maxCurrency ?? 0"
      (closed)="dialog.set(null)"
      (adjusted)="store.refresh('event')"
    />
  `,
})
export class ControlCenterScreen {
  protected readonly store = inject(LiveStore);
  private readonly api = inject(ApiService);
  private readonly theme = inject(ThemeService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly eventId = input.required<string>();

  // ---- static
  protected readonly selectClass = SELECT_CLASS;
  protected readonly objStatuses = OBJ_STATUSES;
  protected readonly objStatusLabels = OBJECTIVE_STATUS_LABELS;
  protected readonly perkTypeLabels = PERK_TYPE_LABELS;
  protected readonly roleLabels: Record<string, string> = PLAYER_ROLE_LABELS;
  protected readonly precisionLabels: Record<string, string> = PRECISION_LABELS;
  protected readonly precisions = Object.keys(PRECISION_LABELS) as Precision[];
  protected readonly enemyLabels: Record<string, string> = { never: 'Never shown', perk_only: 'Only with a perk (UAV, recon)', always: 'Always shown' };
  protected readonly intervals = [5, 10, 15, 30, 60];
  protected readonly severities: GmAlert['severity'][] = ['critical', 'warning', 'info'];
  protected readonly leftTabs: { id: LeftTab; label: string }[] = [
    { id: 'objectives', label: 'Objectives' },
    { id: 'players', label: 'Players' },
    { id: 'captures', label: 'Captures' },
  ];
  protected readonly phoneTabs: { id: PhoneTab; label: string; icon: string }[] = [
    { id: 'teams', label: 'Teams', icon: 'lucideTrophy' },
    { id: 'objectives', label: 'Objectives', icon: 'lucideFlag' },
    { id: 'players', label: 'Players', icon: 'lucideUsers' },
    { id: 'alerts', label: 'Alerts', icon: 'lucideBell' },
    { id: 'feed', label: 'Feed', icon: 'lucideActivity' },
    { id: 'actions', label: 'Actions', icon: 'lucideSlidersHorizontal' },
  ];
  protected readonly statusChip = eventStatusChip;
  protected readonly objChip = objectiveStatusChip;
  protected readonly purchaseChip = (p: PerkPurchase) => purchaseStatusChip(p.status);
  protected readonly presence = (s: PositionStatus) => PRESENCE[s];
  protected readonly sevSpec = (s: GmAlert['severity']) => SEVERITY[s];
  protected readonly abs = formatDateTime;
  protected readonly time = formatTime;
  protected readonly n = formatNumber;
  protected readonly round = Math.round;

  // ---- UI state
  protected readonly wide = signal(true);
  protected readonly phoneTab = signal<PhoneTab>('teams');
  protected readonly leftTab = signal<LeftTab>('objectives');
  protected readonly moreOpen = signal(false);
  protected readonly filtersOpen = signal(false);
  protected readonly dialog = signal<Dialog>(null);
  protected readonly busy = signal(false);
  protected readonly busyId = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly teamFilter = signal(new Set<string>());
  protected readonly squadFilter = signal('');
  protected readonly statusFilter = signal<'' | ObjectiveStatus>('');
  protected readonly onlineOnly = signal(false);
  protected readonly showMapLabels = signal(true);
  protected readonly selectedPlayerId = signal<string | null>(null);
  protected readonly focusObjectiveId = signal<string | null>(null);
  protected readonly fitKey = signal(0);
  protected readonly announceScope = signal<'all' | 'team' | 'player'>('all');
  protected readonly announceTeamId = signal<string | null>(null);
  protected readonly announceUserId = signal<string | null>(null);
  protected readonly adjustTeamId = signal<string | null>(null);
  protected readonly adjustUserId = signal<string | null>(null);
  protected readonly captures = signal<Capture[]>([]);
  protected readonly capturesError = signal<unknown>(null);
  /** Captures for which "reverse rewards" was unticked. */
  protected readonly keepRewards = signal(new Set<string>());
  /** Purchases for which "refund" is ticked. */
  protected readonly refundIds = signal(new Set<string>());

  private readonly mapRef = viewChild<TacticalMap>('map');
  private readonly searchRef = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly tick = nowSignal(1000);

  // ---- derived
  protected readonly status = computed<EventStatus | null>(() => this.store.clock()?.status ?? this.store.event()?.status ?? null);
  protected readonly ended = computed(() => this.status() === 'completed' || this.status() === 'cancelled');
  protected readonly teams = computed(() => this.store.teams());
  protected readonly teamById = this.store.teamById;
  protected readonly rankedTeams = computed(() => [...this.teams()].sort((a, b) => b.points - a.points || a.sortOrder - b.sortOrder));
  protected readonly squads = computed(() => this.store.event()?.squads ?? []);
  protected readonly rules = computed(() => this.store.event()?.visibilityRules ?? null);
  protected readonly intervalValue = computed(() => String(this.store.event()?.tracking.intervalSec ?? 10));
  protected readonly areaCenter = computed(() => {
    const a = this.store.event()?.area;
    return a ? { lat: a.lat, lng: a.lng } : null;
  });
  protected readonly controlUrl = computed(() => `/gm/events/${this.eventId()}/control`);

  protected readonly players = computed<PlayerRow[]>(() => {
    const posById = new Map(this.store.positions().map((p) => [p.userId, p]));
    const squadById = new Map(this.squads().map((s) => [s.id, s]));
    const teams = this.teamById();
    return this.store
      .members()
      .filter((m) => m.role === 'player' && m.status === 'approved')
      .map((m) => {
        const pos = posById.get(m.userId) ?? null;
        const presence: PositionStatus = pos?.status ?? (m.online ? 'stale' : 'offline');
        return {
          member: m,
          pos,
          team: m.teamId ? (teams.get(m.teamId) ?? null) : null,
          squad: m.squadId ? (squadById.get(m.squadId) ?? null) : null,
          presence,
          accuracy: pos?.accuracyM ?? m.gpsAccuracy,
          suspicious: !!pos?.suspicious,
          flags: pos?.flags ?? [],
          lastUpdate: pos?.receivedAt ?? m.lastLocationAt,
        };
      })
      .sort((a, b) => Number(b.suspicious) - Number(a.suspicious) || a.member.nickname.localeCompare(b.member.nickname));
  });

  protected readonly filtersActive = computed(() => this.teamFilter().size > 0 || !!this.squadFilter() || !!this.statusFilter() || this.onlineOnly());

  protected readonly filteredPlayers = computed(() => {
    const teams = this.teamFilter();
    const squad = this.squadFilter();
    const online = this.onlineOnly();
    const q = this.query().trim().toLowerCase();
    return this.players().filter(
      (p) =>
        (!teams.size || (p.member.teamId && teams.has(p.member.teamId))) &&
        (!squad || p.member.squadId === squad) &&
        (!online || p.presence === 'online') &&
        (!q || p.member.nickname.toLowerCase().includes(q)),
    );
  });

  protected readonly mapPositions = computed(() => {
    const ids = new Set(this.filteredPlayers().map((p) => p.member.userId));
    const known = new Set(this.players().map((p) => p.member.userId));
    // GM receives everyone; positions of users not in the member list are shown unless a filter is active
    const anyFilter = this.filtersActive() || !!this.query().trim();
    return this.store.positions().filter((p) => ids.has(p.userId) || (!known.has(p.userId) && !anyFilter));
  });

  protected readonly selectedPlayer = computed(() => {
    const id = this.selectedPlayerId();
    return id ? (this.players().find((p) => p.member.userId === id) ?? null) : null;
  });

  protected readonly onlineCount = computed(() => this.players().filter((p) => p.presence === 'online').length);
  protected readonly suspiciousCount = computed(() => this.players().filter((p) => p.suspicious).length);
  protected readonly onlineByTeam = computed(() => {
    const m = new Map<string, number>();
    for (const p of this.players()) if (p.presence === 'online' && p.member.teamId) m.set(p.member.teamId, (m.get(p.member.teamId) ?? 0) + 1);
    return m;
  });

  protected readonly filteredObjectives = computed(() => {
    const s = this.statusFilter();
    return s ? this.store.objectives().filter((o) => o.status === s) : this.store.objectives();
  });
  protected readonly activeObjectiveCount = computed(() => this.store.objectives().filter((o) => o.status === 'active' || o.status === 'contested').length);

  protected readonly sortedAlerts = computed(() =>
    [...this.store.alerts()]
      .sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, 60),
  );
  protected readonly alertCounts = computed(() => {
    const c: Record<GmAlert['severity'], number> = { critical: 0, warning: 0, info: 0 };
    for (const a of this.store.alerts()) if (!a.acknowledged) c[a.severity]++;
    return c;
  });
  protected readonly openAlertCount = computed(() => {
    const c = this.alertCounts();
    return c.critical + c.warning + c.info;
  });

  protected readonly pendingPurchases = computed(() => this.store.purchases().filter((p) => p.status === 'pending_approval'));
  protected readonly activePurchases = computed(() => this.store.purchases().filter((p) => p.status === 'active' || p.status === 'ready'));
  protected readonly otherEffects = computed(() => {
    const purchaseIds = new Set(this.activePurchases().map((p) => p.id));
    return this.store.activeEffects().filter((e) => !e.purchaseId || !purchaseIds.has(e.purchaseId));
  });
  protected readonly feed = computed(() => this.store.activity().slice(0, 80));

  protected readonly endsAtLabel = computed(() => {
    const ends = this.store.clock()?.endsAt;
    return ends ? `The game currently ends at ${formatTime(ends)}.` : 'The game has no end time yet.';
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.theme.setLiveMode(true);
    destroyRef.onDestroy(() => this.theme.setLiveMode(false));

    afterNextRender(() => {
      if (typeof matchMedia === 'undefined') return;
      const mq = matchMedia('(min-width: 1024px)');
      this.wide.set(mq.matches);
      const onChange = (e: MediaQueryListEvent) => this.wide.set(e.matches);
      mq.addEventListener('change', onChange);
      destroyRef.onDestroy(() => mq.removeEventListener('change', onChange));
    });

    effect(() => {
      const id = this.eventId();
      untracked(() => void this.init(id));
    });

    // Recent captures follow objective changes (captures invalidate objectives in the store).
    let timer: ReturnType<typeof setTimeout> | null = null;
    effect(() => {
      this.store.objectives();
      if (!this.store.isGm()) return;
      untracked(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void this.loadCaptures(), 600);
      });
    });
  }

  private async init(id: string): Promise<void> {
    await this.store.load(id);
    const err = this.store.error();
    if ((this.store.event() && !this.store.isGm()) || (err && (err.status === 403 || err.status === 404))) {
      if (err?.status !== 404) this.toast.warning('The control center is for Game Masters');
      await this.router.navigate(['/events', id], { replaceUrl: true });
      return;
    }
    if (!this.store.event()?.area) this.fitKey.update((k) => k + 1);
  }

  // ------------------------------------------------------------------ helpers

  protected rel(iso: string): string {
    this.tick();
    return formatRelative(iso, this.store.now());
  }

  protected remaining(iso: string): string {
    this.tick();
    return formatDuration(new Date(iso).getTime() - this.store.now());
  }

  protected isFuture(iso: string): boolean {
    return new Date(iso).getTime() > this.store.now();
  }

  protected toggleSet(sig: ReturnType<typeof signal<Set<string>>>, id: string, on: boolean): void {
    sig.update((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected clearFilters(): void {
    this.teamFilter.set(new Set());
    this.squadFilter.set('');
    this.statusFilter.set('');
    this.onlineOnly.set(false);
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t?.closest('input, textarea, select, [contenteditable="true"]');
    if (e.key === '/' && !typing) {
      e.preventDefault();
      if (!this.wide()) this.phoneTab.set('players');
      this.searchRef()?.nativeElement.focus();
      return;
    }
    if (e.key === 'Escape') {
      if (this.moreOpen()) this.moreOpen.set(false);
      else if (typing && this.query()) this.onSearch('');
      else {
        this.selectedPlayerId.set(null);
        this.focusObjectiveId.set(null);
      }
    }
  }

  // ------------------------------------------------------------------ selection

  protected onSearch(q: string): void {
    this.query.set(q);
    if (!q.trim()) return;
    const matches = this.filteredPlayers();
    if (matches.length === 1) this.selectPlayer(matches[0].member.userId, true);
  }

  protected selectFirstMatch(): void {
    const first = this.filteredPlayers()[0];
    if (first) this.selectPlayer(first.member.userId, true);
  }

  protected selectPlayer(userId: string, pan: boolean): void {
    this.selectedPlayerId.set(userId);
    this.focusObjectiveId.set(null);
    if (this.wide()) this.leftTab.set('players');
    else this.phoneTab.set('players');
    if (pan) {
      const pos = this.store.positions().find((p) => p.userId === userId);
      if (pos) this.mapRef()?.panTo({ lat: pos.lat, lng: pos.lng });
    }
  }

  protected locatePlayer(p: PlayerRow): void {
    if (p.pos) this.mapRef()?.panTo({ lat: p.pos.lat, lng: p.pos.lng }, 18);
  }

  protected focusObjective(id: string): void {
    this.focusObjectiveId.set(id);
    this.selectedPlayerId.set(null);
    if (this.wide()) this.leftTab.set('objectives');
    else this.phoneTab.set('objectives');
    setTimeout(() => document.getElementById('cc-obj-' + id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  protected locate(o: Objective): void {
    this.focusObjectiveId.set(o.id);
    this.mapRef()?.panTo({ lat: o.lat, lng: o.lng }, 18);
  }

  // ------------------------------------------------------------------ dialogs

  protected openAnnounce(scope: 'all' | 'team' | 'player' = 'all', teamId: string | null = null, userId: string | null = null): void {
    this.announceScope.set(scope);
    this.announceTeamId.set(teamId);
    this.announceUserId.set(userId);
    this.moreOpen.set(false);
    this.dialog.set('announce');
  }

  protected openAdjust(teamId: string | null, userId: string | null): void {
    this.adjustTeamId.set(teamId);
    this.adjustUserId.set(userId);
    this.moreOpen.set(false);
    this.dialog.set('adjust');
  }

  // ------------------------------------------------------------------ game controls

  private async setStatus(to: EventStatus, success: string, reason?: string): Promise<void> {
    this.busy.set(true);
    try {
      const ev = await this.api.setEventStatus(this.eventId(), to, reason);
      this.store.event.set(ev);
      this.store.clock.set(ev.clock);
      this.store.refresh('event', 'objectives');
      this.toast.success(success);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async openLobby(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Open the lobby?',
      consequences: ['Players can check in, mark themselves ready and see their team.', 'From the lobby you can start the game.'],
      confirmLabel: 'Open lobby',
    });
    if (ok) await this.setStatus('lobby', 'Lobby open');
  }

  protected async start(): Promise<void> {
    const ev = this.store.event();
    if (!ev) return;
    const dur = new Date(ev.endAt).getTime() - new Date(ev.startAt).getTime();
    const s = ev.scoring;
    const ready = this.store.members().filter((m) => m.role === 'player' && m.status === 'approved');
    const consequences = [
      `The game clock starts now and runs for ${formatDuration(Math.max(60_000, dur))}.`,
      s.startingPoints || s.startingCurrency
        ? `Every team gets its starting balance (${formatNumber(s.startingPoints)} points, ${formatNumber(s.startingCurrency)} credits).`
        : 'Teams start at 0 points and 0 credits.',
      `${ready.length} players are notified; location sharing starts for players who consented.`,
      'Objectives become capturable according to their availability.',
    ];
    const noTeam = ready.filter((m) => !m.teamId).length;
    if (noTeam) consequences.push(`${noTeam} approved player(s) have no team and cannot capture.`);
    const ok = await this.confirm.ask({ title: 'Start the game?', consequences, confirmLabel: 'Start game' });
    if (ok) await this.setStatus('live', 'Game started');
  }

  protected async pause(): Promise<void> {
    const stopTracking = this.store.event()?.tracking.stopWhenPaused;
    const reason = await this.confirm.askReason({
      title: 'Pause the game?',
      consequences: [
        'The game clock, capture timers and points for held objectives stop.',
        'Players see the game as paused and cannot capture or buy perks.',
        stopTracking ? 'Location sharing pauses until you resume.' : 'Location sharing continues so you can still see everyone.',
      ],
      confirmLabel: 'Pause game',
      reason: { label: 'Message to players (optional)', required: false, placeholder: 'e.g. Injury at the north gate' },
    });
    if (reason !== null) await this.setStatus('paused', 'Game paused', reason.trim() || undefined);
  }

  protected async resume(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Resume the game?',
      consequences: ['The clock restarts; the end time moves later by the length of the pause.', 'Captures, perks and held-objective points resume.'],
      confirmLabel: 'Resume game',
    });
    if (ok) await this.setStatus('live', 'Game resumed');
  }

  protected async endGame(): Promise<void> {
    const leader = this.rankedTeams()[0];
    const ok = await this.confirm.ask({
      title: 'End the game now?',
      consequences: [
        'Final scores are locked' + (leader ? ` (${leader.name} leads with ${formatNumber(leader.points)} points).` : '.'),
        'Location tracking stops for all players.',
        'No more captures, purchases or perks.',
        'This cannot be undone.',
      ],
      confirmLabel: 'End game',
      destructive: true,
      requireText: 'END',
    });
    if (ok) await this.setStatus('completed', 'Game over: final scores locked');
  }

  protected async extend(minutes: number): Promise<void> {
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) {
      this.toast.warning('Enter between 1 and 600 minutes');
      return;
    }
    minutes = Math.round(minutes);
    const ends = this.store.clock()?.endsAt;
    const newEnd = ends ? new Date(new Date(ends).getTime() + minutes * 60_000).toISOString() : null;
    const ok = await this.confirm.ask({
      title: `Extend by ${minutes} minutes?`,
      consequences: [ends && newEnd ? `The game ends at ${formatTime(newEnd)} instead of ${formatTime(ends)}.` : `The game gets ${minutes} more minutes.`, 'Players see the new remaining time immediately.'],
      confirmLabel: `Add ${minutes} min`,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const ev = await this.api.extendGame(this.eventId(), minutes);
      this.store.event.set(ev);
      this.store.clock.set(ev.clock);
      this.dialog.set(null);
      this.toast.success(`Game extended by ${minutes} min`, ev.clock.endsAt ? `Ends at ${formatTime(ev.clock.endsAt)}.` : undefined);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  // ------------------------------------------------------------------ objectives & captures

  protected async objAction(o: Objective, action: GmObjectiveAction, teamId?: string): Promise<void> {
    const live = this.status() === 'live';
    const team = teamId ? this.teamById().get(teamId) : null;
    const owner = o.ownerTeamId ? this.teamById().get(o.ownerTeamId) : null;
    const spec: Record<GmObjectiveAction, { title: string; consequences: string[]; destructive?: boolean; label: string }> = {
      activate: { title: `Activate ${o.name}?`, label: 'Activate', consequences: ['It becomes visible and capturable again (subject to its rules).', 'Players are notified.'] },
      disable: { title: `Disable ${o.name}?`, label: 'Disable', destructive: true, consequences: ['Nobody can capture it until you activate it again.', 'Its current owner keeps it.', 'Players are notified.'] },
      set_owner: {
        title: `Give ${o.name} to ${team?.name ?? 'team'}?`,
        label: 'Set owner',
        consequences: live
          ? [`Counts as a capture by ${team?.name}: they receive its rewards (${formatNumber(o.rewards.points)} points, ${formatNumber(o.rewards.currency)} credits or their team override).`, 'Players are notified like a normal capture.']
          : [`${team?.name} becomes the owner. No rewards are given before the game is live.`],
      },
      clear_owner: { title: `Clear the owner of ${o.name}?`, label: 'Clear owner', destructive: true, consequences: [`${owner?.name ?? 'The owner'} no longer holds it; points for holding it stop.`, 'Points already earned are kept.'] },
      contest: { title: `Mark ${o.name} as contested?`, label: 'Mark contested', consequences: ['Captures are blocked until you clear the contest.', 'Players see it as contested.'] },
      uncontest: { title: `Clear the contest on ${o.name}?`, label: 'Clear contest', consequences: ['Captures are possible again; geofence presence is reset.'] },
      reset: {
        title: `Reset ${o.name}?`,
        label: 'Reset objective',
        destructive: true,
        consequences: ['Owner, capture count, cooldown, contest and capture progress are cleared.', 'Points and credits already awarded stay in the ledger.'],
      },
    };
    const s = spec[action];
    const reason = await this.confirm.askReason({
      title: s.title,
      consequences: [...s.consequences, 'Logged in the audit log with your reason.'],
      confirmLabel: s.label,
      destructive: s.destructive,
      reason: { label: 'Reason', required: true, placeholder: 'At least 3 characters' },
    });
    if (reason === null) return;
    if (reason.trim().length < 3) {
      this.toast.warning('Give a reason of at least 3 characters');
      return;
    }
    this.busyId.set(o.id);
    try {
      const updated = await this.api.gmObjectiveAction(this.eventId(), o.id, action, reason.trim(), teamId ?? null);
      if (updated) this.store.objectives.update((l) => l.map((x) => (x.id === updated.id ? updated : x)));
      this.store.refresh('objectives', 'event');
      this.toast.success(`${o.name}: ${s.label.toLowerCase()} done`);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busyId.set(null);
    }
  }

  async loadCaptures(): Promise<void> {
    try {
      const page = await this.api.captures(this.eventId());
      this.captures.set(page.items.slice(0, 25));
      this.capturesError.set(null);
    } catch (e) {
      this.capturesError.set(e);
    }
  }

  protected async revokeCapture(c: Capture): Promise<void> {
    const reverse = !this.keepRewards().has(c.id);
    const team = this.teamById().get(c.teamId)?.name ?? 'The team';
    const reason = await this.confirm.askReason({
      title: `Revoke the capture of ${c.objectiveName}?`,
      consequences: [
        `${team}'s capture${c.nickname ? ' by ' + c.nickname : ''} is marked as revoked.`,
        reverse ? `${team} loses the ${formatNumber(c.points)} points and ${formatNumber(c.currency)} credits it awarded.` : 'Points and credits already awarded are kept.',
        'Logged in the audit log with your reason.',
      ],
      confirmLabel: 'Revoke capture',
      destructive: true,
      reason: { label: 'Reason', required: true, placeholder: 'e.g. Code shared over the radio' },
    });
    if (reason === null) return;
    if (reason.trim().length < 3) {
      this.toast.warning('Give a reason of at least 3 characters');
      return;
    }
    try {
      await this.api.revokeCapture(this.eventId(), c.id, reverse, reason.trim());
      this.captures.update((l) => l.map((x) => (x.id === c.id ? { ...x, revoked: true } : x)));
      this.store.refresh('objectives', 'event');
      this.toast.success('Capture revoked', reverse ? 'Rewards reversed.' : 'Rewards kept.');
    } catch (e) {
      this.toast.error(e);
    }
  }

  // ------------------------------------------------------------------ purchases

  protected async reviewPurchase(p: PerkPurchase, approve: boolean): Promise<void> {
    const team = this.teamById().get(p.teamId)?.name ?? 'The team';
    let reason: string | null = null;
    if (approve) {
      const ok = await this.confirm.ask({
        title: `Approve ${p.perkName} for ${team}?`,
        consequences: [`${team} keeps the ${formatNumber(p.price)} credits already paid.`, 'The perk becomes ready or active according to its settings.'],
        confirmLabel: 'Approve',
      });
      if (!ok) return;
    } else {
      reason = await this.confirm.askReason({
        title: `Reject ${p.perkName}?`,
        consequences: [`${team} gets the ${formatNumber(p.price)} credits back.`, 'The buyer sees your reason.'],
        confirmLabel: 'Reject',
        destructive: true,
        reason: { label: 'Reason', required: true },
      });
      if (reason === null) return;
    }
    this.busyId.set(p.id);
    try {
      const updated = await this.api.reviewPurchase(this.eventId(), p.id, approve, reason?.trim() || undefined);
      this.store.purchases.update((l) => l.map((x) => (x.id === updated.id ? updated : x)));
      this.store.refresh('purchases', 'effects', 'event', 'alerts');
      this.toast.success(approve ? 'Request approved' : 'Request rejected');
    } catch (e) {
      const err = ApiError.from(e);
      if (err.code === 'invalid_state') this.store.refresh('purchases');
      this.toast.error(err);
    } finally {
      this.busyId.set(null);
    }
  }

  protected async cancelPurchase(p: PerkPurchase): Promise<void> {
    const refund = this.refundIds().has(p.id) && !p.refunded;
    const team = this.teamById().get(p.teamId)?.name ?? 'The team';
    const reason = await this.confirm.askReason({
      title: `Cancel ${p.perkName}?`,
      consequences: [
        'Its effect ends immediately.',
        refund ? `${team} gets the ${formatNumber(p.price)} credits back.` : `No refund: ${team} does not get the credits back.`,
        'Logged in the audit log with your reason.',
      ],
      confirmLabel: 'Cancel perk',
      cancelLabel: 'Keep it',
      destructive: true,
      reason: { label: 'Reason', required: true },
    });
    if (reason === null) return;
    if (reason.trim().length < 3) {
      this.toast.warning('Give a reason of at least 3 characters');
      return;
    }
    this.busyId.set(p.id);
    try {
      const updated = await this.api.cancelPurchase(this.eventId(), p.id, refund, reason.trim());
      this.store.purchases.update((l) => l.map((x) => (x.id === updated.id ? updated : x)));
      this.store.refresh('purchases', 'effects', 'event');
      this.toast.success('Perk cancelled', refund ? 'Credits refunded.' : undefined);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busyId.set(null);
    }
  }

  // ------------------------------------------------------------------ alerts

  protected async ack(a: GmAlert): Promise<void> {
    this.busyId.set(a.id);
    try {
      await this.api.acknowledgeAlert(this.eventId(), a.id);
      this.store.alerts.update((l) => l.map((x) => (x.id === a.id ? { ...x, acknowledged: true } : x)));
      this.store.refresh('alerts');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busyId.set(null);
    }
  }

  // ------------------------------------------------------------------ players

  protected async movePlayer(m: Member, teamId: string): Promise<void> {
    if (!teamId || teamId === m.teamId) return;
    const from = m.teamId ? this.teamById().get(m.teamId)?.name : null;
    const to = this.teamById().get(teamId)?.name ?? 'the team';
    const ok = await this.confirm.ask({
      title: `Move ${m.nickname} to ${to}?`,
      consequences: [
        `${m.nickname} leaves ${from ?? 'no team'} and their squad, and joins ${to}.`,
        `They see ${to}'s map, objectives and store from now on.`,
        'Points already earned stay with the previous team.',
      ],
      confirmLabel: `Move to ${to}`,
    });
    if (!ok) return;
    try {
      await this.api.assignMember(this.eventId(), m.userId, { teamId, squadId: null });
      this.store.refresh('members', 'event');
      this.toast.success(`${m.nickname} moved to ${to}`);
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected async removePlayer(m: Member): Promise<void> {
    const reason = await this.confirm.askReason({
      title: `Remove ${m.nickname} from the event?`,
      consequences: ['They lose access to the live game immediately and their location stops being shared.', 'They cannot rejoin with the join code.', 'Their past captures stay in the results.'],
      confirmLabel: 'Remove player',
      destructive: true,
      reason: { label: 'Reason (shown to the player)', required: true },
    });
    if (reason === null) return;
    try {
      await this.api.removeMember(this.eventId(), m.userId, reason.trim());
      this.selectedPlayerId.set(null);
      this.store.refresh('members', 'event');
      this.toast.success(`${m.nickname} removed`);
    } catch (e) {
      this.toast.error(e);
    }
  }

  // ------------------------------------------------------------------ settings

  protected async setRule(key: 'allyPrecision' | 'enemies', ev: Event, labels: Record<string, string>): Promise<void> {
    const el = ev.target as HTMLSelectElement;
    const prev = this.rules()?.[key] ?? '';
    const value = el.value;
    const ok = await this.confirm.ask({
      title: 'Change map visibility?',
      consequences: [
        `${key === 'allyPrecision' ? "Teammates' positions" : 'Enemy positions'}: ${labels[prev] ?? prev} → ${labels[value] ?? value}.`,
        'Applies to all players immediately.',
      ],
      confirmLabel: 'Apply',
    });
    if (!ok) {
      el.value = prev;
      return;
    }
    await this.patchRules({ [key]: value } as Partial<VisibilityRules>, () => (el.value = prev));
  }

  protected async setNicknames(ev: Event): Promise<void> {
    const el = ev.target as HTMLInputElement;
    const value = el.checked;
    const ok = await this.confirm.ask({
      title: value ? 'Show nicknames on maps?' : 'Hide nicknames on maps?',
      consequences: [value ? 'Players see the nicknames of the people they are allowed to see.' : 'Players see markers without nicknames.', 'Applies to all players immediately.'],
      confirmLabel: 'Apply',
    });
    if (!ok) {
      el.checked = !value;
      return;
    }
    await this.patchRules({ showNicknames: value }, () => (el.checked = !value));
  }

  private async patchRules(patch: Partial<VisibilityRules>, revert: () => void): Promise<void> {
    try {
      const ev = await this.api.updateEvent(this.eventId(), { visibilityRules: patch });
      this.store.event.set(ev);
      this.toast.success('Map visibility updated');
    } catch (e) {
      revert();
      this.toast.error(e);
    }
  }

  protected async setInterval(ev: Event): Promise<void> {
    const el = ev.target as HTMLSelectElement;
    const prev = this.intervalValue();
    const sec = Number(el.value);
    const ok = await this.confirm.ask({
      title: `Update positions every ${sec} s?`,
      consequences: [
        sec < Number(prev) ? 'More precise positions; phones use more battery and data.' : 'Saves battery; positions on the map are less fresh.',
        'Applies to all players within a few seconds.',
      ],
      confirmLabel: 'Apply',
    });
    if (!ok) {
      el.value = prev;
      return;
    }
    try {
      const updated = await this.api.updateEvent(this.eventId(), { tracking: { intervalSec: sec } });
      this.store.event.set(updated);
      this.toast.success(`Location updates every ${sec} s`);
    } catch (e) {
      el.value = prev;
      this.toast.error(e);
    }
  }
}
