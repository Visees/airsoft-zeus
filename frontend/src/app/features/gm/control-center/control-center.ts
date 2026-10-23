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
import { playsIn } from '../../../core/util/members';
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
  online: { glyph: '●', label: $localize`Online`, cls: 'text-primary' },
  stale: { glyph: '◐', label: $localize`Stale`, cls: 'text-warning' },
  offline: { glyph: '○', label: $localize`Offline`, cls: 'text-muted-foreground' },
};

const SEVERITY: Record<GmAlert['severity'], { glyph: string; label: string; tone: 'neutral' | 'warning' | 'danger' }> = {
  critical: { glyph: '■', label: $localize`Critical`, tone: 'danger' },
  warning: { glyph: '▲', label: $localize`Warning`, tone: 'warning' },
  info: { glyph: '●', label: $localize`Info`, tone: 'neutral' },
};

const SELECT_CLASS = 'h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm dark:bg-input/30';
const OBJ_STATUSES: ObjectiveStatus[] = ['active', 'contested', 'captured', 'inactive', 'locked', 'disabled', 'completed'];

/**
 * GM control center (full screen, outside the shell). LiveStore is provided on the route.
 * ≥1024px: command bar + three columns (scoreboard/objectives/players · live map · alerts/requests/feed).
 * Smaller: map on top + tabs.
 */
@Component({
  selector: 'ah-control-center-screen',
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
      <a [routerLink]="['/gm/events', eventId()]" hlmBtn variant="ghost" size="icon" class="size-11 shrink-0" aria-label="Back to the event editor" i18n-aria-label>
        <ng-icon name="lucideArrowLeft" size="20" aria-hidden="true" />
      </a>
      <div class="min-w-32 flex-1 lg:flex-none">
        <p class="label-caps truncate leading-none" i18n>Control center</p>
        <h1 class="max-w-[18rem] truncate text-base uppercase lg:text-lg">{{ store.event()?.name ?? txt.loading }}</h1>
      </div>
      @if (status(); as s) {
        <ah-status-chip [spec]="statusChip(s)" />
      }
      <ah-game-timer [clock]="store.clock()" [startAt]="store.event()?.startAt ?? null" [serverOffsetMs]="store.serverOffsetMs()" size="md" />
      <ah-connection-status [compact]="!wide()" />
      @if (store.fromCache()) {
        <span class="text-xs text-warning" i18n>Showing cached data</span>
      }

      @if (wide()) {
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <ng-container [ngTemplateOutlet]="gameControls" />
          <button hlmBtn type="button" variant="outline" class="h-11" (click)="openAnnounce()">
            <ng-icon name="lucideMegaphone" size="16" aria-hidden="true" /> <ng-container i18n>Announce</ng-container>
          </button>
          <button hlmBtn type="button" variant="outline" class="h-11" (click)="openAdjust(null, null)">
            <ng-icon name="lucideSlidersHorizontal" size="16" aria-hidden="true" /> <ng-container i18n>Adjust</ng-container>
          </button>
          <button hlmBtn type="button" class="h-11 bg-destructive! text-destructive-foreground! hover:bg-destructive/85!" (click)="dialog.set('emergency')" [disabled]="ended()">
            <ng-icon name="lucideSiren" size="16" aria-hidden="true" /> <ng-container i18n>Emergency</ng-container>
          </button>
          <div class="relative">
            <button hlmBtn type="button" variant="ghost" size="icon" class="size-11" (click)="moreOpen.set(!moreOpen())" [attr.aria-expanded]="moreOpen()" aria-controls="cc-more" aria-label="Settings and links" i18n-aria-label>
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
        <button hlmBtn type="button" size="icon" class="size-11 bg-destructive! text-destructive-foreground!" (click)="dialog.set('emergency')" [disabled]="ended()" aria-label="Send emergency alert" i18n-aria-label>
          <ng-icon name="lucideSiren" size="18" aria-hidden="true" />
        </button>
      }
    </header>

    @if (store.loading() && !store.event()) {
      <div class="p-4"><ah-loading-skeleton [rows]="6" /></div>
    } @else if (store.error() && !store.event()) {
      <div class="mx-auto w-full max-w-lg p-4"><ah-error-state [error]="store.error()" (retry)="store.reload()" /></div>
    } @else if (wide()) {
      <!-- ======================= desktop ======================= -->
      <div class="grid min-h-0 flex-1 grid-cols-[20rem_1fr_22rem] xl:grid-cols-[23rem_1fr_25rem]">
        <aside class="flex min-h-0 flex-col overflow-hidden border-r border-border" aria-label="Teams, objectives and players" i18n-aria-label>
          <div class="shrink-0 border-b border-border p-3"><ng-container [ngTemplateOutlet]="teamsTpl" /></div>
          <div role="tablist" aria-label="Lists" class="flex shrink-0 border-b border-border" i18n-aria-label>
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
        <aside class="flex min-h-0 flex-col gap-5 overflow-y-auto border-l border-border p-3" aria-label="Alerts, requests and activity" i18n-aria-label>
          <ng-container [ngTemplateOutlet]="alertsTpl" />
          <ng-container [ngTemplateOutlet]="purchasesTpl" />
          <ng-container [ngTemplateOutlet]="effectsTpl" />
          <ng-container [ngTemplateOutlet]="feedTpl" />
        </aside>
      </div>
    } @else {
      <!-- ======================= phone / tablet portrait ======================= -->
      <!-- Phone held sideways (compact:): map on the left, tabs and list on the right -->
      <div class="flex min-h-0 flex-1 flex-col compact:grid compact:grid-cols-[minmax(0,1fr)_20rem] compact:grid-rows-[auto_minmax(0,1fr)]">
        <div class="relative h-[42dvh] shrink-0 border-b border-border compact:col-start-1 compact:row-span-2 compact:row-start-1 compact:h-auto compact:border-r compact:border-b-0"><ng-container [ngTemplateOutlet]="mapTpl" /></div>
        <div role="tablist" aria-label="Sections" class="relative flex shrink-0 overflow-x-auto border-b border-border bg-card compact:col-start-2 compact:row-start-1" i18n-aria-label>
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
        <div class="min-h-0 flex-1 overflow-y-auto p-3 compact:col-start-2 compact:row-start-2" role="tabpanel">
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
                  <h2 id="h-ctl" class="label-caps mb-2" i18n>Game controls</h2>
                  <div class="flex flex-wrap gap-2"><ng-container [ngTemplateOutlet]="gameControls" /></div>
                </section>
                <div class="grid grid-cols-2 gap-2">
                  <button hlmBtn type="button" variant="outline" class="h-12" (click)="openAnnounce()">
                    <ng-icon name="lucideMegaphone" size="16" aria-hidden="true" /> <ng-container i18n>Announce</ng-container>
                  </button>
                  <button hlmBtn type="button" variant="outline" class="h-12" (click)="openAdjust(null, null)">
                    <ng-icon name="lucideSlidersHorizontal" size="16" aria-hidden="true" /> <ng-container i18n>Adjust score</ng-container>
                  </button>
                  <button hlmBtn type="button" class="col-span-2 h-12 bg-destructive! text-destructive-foreground!" (click)="dialog.set('emergency')" [disabled]="ended()">
                    <ng-icon name="lucideSiren" size="16" aria-hidden="true" /> <ng-container i18n>Emergency alert</ng-container>
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
            <ng-icon name="lucidePlay" size="16" aria-hidden="true" /> <ng-container i18n>Start game</ng-container>
          </button>
        }
        @case ('live') {
          <button hlmBtn type="button" variant="outline" class="h-11" (click)="pause()" [disabled]="busy()">
            <ng-icon name="lucidePause" size="16" aria-hidden="true" /> <ng-container i18n>Pause</ng-container>
          </button>
        }
        @case ('paused') {
          <button hlmBtn type="button" class="h-11" (click)="resume()" [disabled]="busy()">
            <ng-icon name="lucidePlay" size="16" aria-hidden="true" /> <ng-container i18n>Resume</ng-container>
          </button>
        }
        @case ('published') {
          <button hlmBtn type="button" variant="outline" class="h-11" (click)="openLobby()" [disabled]="busy()">
            <ng-icon name="lucideUsers" size="16" aria-hidden="true" /> <ng-container i18n>Open lobby</ng-container>
          </button>
        }
        @case ('registration_open') {
          <button hlmBtn type="button" variant="outline" class="h-11" (click)="openLobby()" [disabled]="busy()">
            <ng-icon name="lucideUsers" size="16" aria-hidden="true" /> <ng-container i18n>Open lobby</ng-container>
          </button>
        }
      }
      @if (status() === 'live' || status() === 'paused' || status() === 'lobby') {
        <button hlmBtn type="button" variant="outline" class="h-11" (click)="dialog.set('extend')" [disabled]="busy()">
          <ng-icon name="lucideTimer" size="16" aria-hidden="true" /> <ng-container i18n>Extend</ng-container>
        </button>
      }
      @if (status() === 'live' || status() === 'paused') {
        <button hlmBtn type="button" variant="destructive" class="h-11" (click)="endGame()" [disabled]="busy()">
          <ng-icon name="lucideCircleStop" size="16" aria-hidden="true" /> <ng-container i18n>End game</ng-container>
        </button>
      }
      @if (status() === 'completed') {
        <a hlmBtn class="h-11" [routerLink]="['/events', eventId(), 'results', 'export']">
          <ng-icon name="lucideFileDown" size="16" aria-hidden="true" /> <ng-container i18n>Export results</ng-container>
        </a>
      }
    </ng-template>

    <!-- ---------- teams ---------- -->
    <ng-template #teamsTpl>
      <section aria-labelledby="h-teams">
        <h2 id="h-teams" class="label-caps mb-2" i18n>Scoreboard · {{ teams().length }} teams</h2>
        @if (!teams().length) {
          <p class="text-sm text-muted-foreground" i18n>No teams.</p>
        }
        <ol class="flex flex-col gap-1.5">
          @for (t of rankedTeams(); track t.id; let i = $index) {
            <li class="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
              <span class="num w-4 text-xs text-muted-foreground">{{ i + 1 }}</span>
              <div class="min-w-0 flex-1">
                <ah-team-badge [team]="t" size="sm" />
                <p class="num text-xs text-muted-foreground" i18n>{{ onlineByTeam().get(t.id) ?? 0 }}/{{ t.memberCount }} online · {{ t.objectivesHeld }} held</p>
              </div>
              <div class="flex flex-col items-end">
                <ah-score-display [points]="t.points" size="sm" [showUnit]="false" />
                <ah-currency-display [amount]="t.currency" size="sm" [showUnit]="false" />
              </div>
              <button hlmBtn type="button" variant="ghost" size="icon" class="size-10" (click)="openAdjust(t.id, null)" ariaLabel="Adjust points or credits of {{ t.name }}" i18n-ariaLabel>
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
          <h2 id="h-objs" class="label-caps" i18n>Objectives · {{ activeObjectiveCount() }} active</h2>
          <div class="flex items-center gap-1.5">
            <select [class]="selectClass + ' w-auto!'" [value]="statusFilter()" (change)="statusFilter.set($any($event.target).value)" aria-label="Filter objectives by status" i18n-aria-label>
              <option value="" i18n>All statuses</option>
              @for (s of objStatuses; track s) {
                <option [value]="s">{{ objStatusLabels[s] }}</option>
              }
            </select>
            <a hlmBtn variant="outline" class="h-10 shrink-0" [routerLink]="['/gm/events', eventId(), 'objectives', 'new']" [queryParams]="{ returnTo: controlUrl() }">
              <ng-icon name="lucidePlus" size="14" aria-hidden="true" /> <ng-container i18n>New</ng-container>
            </a>
          </div>
        </div>
        @if (!filteredObjectives().length) {
          <ah-empty-state icon="lucideFlag" [title]="statusFilter() ? txt.noObjectivesWithThis : txt.noObjectives" />
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
                      <ah-status-chip [spec]="objChip(o.status)" />
                      @if (o.ownerTeamId && teamById().get(o.ownerTeamId); as owner) {
                        <ah-team-badge [team]="owner" size="sm" [showIcon]="false" />
                      }
                    </div>
                  </div>
                  <span class="num text-xs text-muted-foreground" title="{{ o.captureCount }} captures" i18n-title>×{{ o.captureCount }}</span>
                </summary>
                <div class="flex flex-col gap-2 border-t border-border p-2">
                  <p class="text-xs text-muted-foreground">
                    @if (o.lastCapturedAt) {
                      @if (o.lastCapturedByNickname) {
                        <ng-container i18n>Last capture {{ rel(o.lastCapturedAt) }} by {{ o.lastCapturedByNickname }}.</ng-container>
                      } @else {
                        <ng-container i18n>Last capture {{ rel(o.lastCapturedAt) }}.</ng-container>
                      }
                    }
                    @if (o.cooldownUntil && isFuture(o.cooldownUntil)) {
                      <ng-container i18n>Cooldown until {{ time(o.cooldownUntil) }}.</ng-container>
                    }
                    {{ o.methods.join(' · ').toUpperCase() }}
                  </p>
                  <div class="grid grid-cols-2 gap-1.5">
                    @if (o.status === 'disabled') {
                      <button hlmBtn type="button" variant="outline" class="h-10" (click)="objAction(o, 'activate')" i18n>Activate</button>
                    } @else {
                      <button hlmBtn type="button" variant="outline" class="h-10" (click)="objAction(o, 'disable')" i18n>Disable</button>
                    }
                    @if (o.contested) {
                      <button hlmBtn type="button" variant="outline" class="h-10" (click)="objAction(o, 'uncontest')" i18n>Clear contest</button>
                    } @else {
                      <button hlmBtn type="button" variant="outline" class="h-10" (click)="objAction(o, 'contest')" i18n>Mark contested</button>
                    }
                    @if (o.ownerTeamId) {
                      <button hlmBtn type="button" variant="outline" class="h-10" (click)="objAction(o, 'clear_owner')" i18n>Clear owner</button>
                    }
                    <button hlmBtn type="button" variant="destructive" class="h-10" (click)="objAction(o, 'reset')" i18n>Reset</button>
                  </div>
                  <div class="flex gap-1.5">
                    <label class="sr-only" [for]="'own-' + o.id" i18n>New owner of {{ o.name }}</label>
                    <select [id]="'own-' + o.id" [class]="selectClass" #ownSel>
                      @for (t of teams(); track t.id) {
                        <option [value]="t.id" [selected]="t.id === o.ownerTeamId">{{ t.name }}</option>
                      }
                    </select>
                    <button hlmBtn type="button" variant="outline" class="h-10 shrink-0" (click)="objAction(o, 'set_owner', ownSel.value)" [disabled]="!teams().length" i18n>Set owner</button>
                  </div>
                  <div class="flex gap-1.5">
                    <button hlmBtn type="button" variant="ghost" class="h-10 flex-1" (click)="locate(o)">
                      <ng-icon name="lucideCrosshair" size="14" aria-hidden="true" /> <ng-container i18n>Show on map</ng-container>
                    </button>
                    <a hlmBtn variant="ghost" class="h-10 flex-1" [routerLink]="['/gm/events', eventId(), 'objectives', o.id]" [queryParams]="{ returnTo: controlUrl() }">
                      <ng-icon name="lucidePencil" size="14" aria-hidden="true" /> <ng-container i18n>Edit</ng-container>
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
          <h2 id="h-caps" class="label-caps" i18n>Recent captures</h2>
          <button hlmBtn type="button" variant="ghost" size="icon" class="size-10" (click)="loadCaptures()" aria-label="Reload captures" i18n-aria-label>
            <ng-icon name="lucideRefreshCw" size="14" aria-hidden="true" />
          </button>
        </div>
        @if (capturesError()) {
          <ah-error-state [error]="capturesError()" (retry)="loadCaptures()" />
        } @else if (!captures().length) {
          <p class="text-sm text-muted-foreground" i18n>No captures yet.</p>
        }
        <ul class="flex flex-col gap-1.5">
          @for (c of captures(); track c.id) {
            <li class="rounded-md border border-border bg-card p-2 text-sm" [class.opacity-60]="c.revoked">
              <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <p class="truncate font-semibold" [class.line-through]="c.revoked">{{ c.objectiveName }}</p>
                  <p class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <ah-team-badge [team]="teamById().get(c.teamId)" size="sm" [showIcon]="false" />
                    {{ c.nickname ?? (c.method === 'gm' ? txt.gm : '—') }} · <span class="num uppercase">{{ c.method }}</span> · <time [attr.datetime]="c.createdAt" [title]="abs(c.createdAt)">{{ rel(c.createdAt) }}</time>
                  </p>
                </div>
                @if (c.revoked) {
                  <ah-status-chip label="Revoked" glyph="✕" tone="danger" i18n-label />
                }
              </div>
              @if (!c.revoked) {
                <div class="mt-1.5 flex items-center justify-between gap-2">
                  <label class="flex min-h-10 cursor-pointer items-center gap-2 text-xs">
                    <input type="checkbox" class="size-5 accent-primary" [checked]="!keepRewards().has(c.id)" (change)="toggleSet(keepRewards, c.id, !$any($event.target).checked)" />
                    <ng-container i18n>Reverse {{ n(c.points) }} pts / {{ n(c.currency) }} cr</ng-container>
                  </label>
                  <button hlmBtn type="button" variant="destructive" class="h-10" (click)="revokeCapture(c)" i18n>Revoke</button>
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
        <h2 id="h-players" class="label-caps mb-2">
          <ng-container i18n>Players · {{ onlineCount() }}/{{ players().length }} online</ng-container>
          @if (suspiciousCount()) {
            · <ng-container i18n>{{ suspiciousCount() }} flagged</ng-container>
          }
        </h2>
        @if (!filteredPlayers().length) {
          <ah-empty-state icon="lucideUsers" [title]="players().length ? txt.noPlayersMatchThe : txt.noApprovedPlayers" />
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
                  <ah-team-swatch [color]="p.team.color" [pattern]="p.team.pattern" />
                } @else {
                  <span class="inline-block size-3.5 rounded-xs border border-dashed border-border" aria-hidden="true"></span>
                }
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-semibold">{{ p.member.nickname }}</span>
                  <span class="block truncate text-xs text-muted-foreground">{{ p.team?.name ?? txt.noTeam }}{{ p.squad ? ' · ' + (p.squad.callsign || p.squad.name) : '' }}</span>
                </span>
                @if (p.suspicious) {
                  <span class="text-xs font-semibold text-destructive" title="Suspicious GPS" i18n i18n-title>▲ GPS</span>
                }
                <span class="flex w-20 flex-col items-end text-xs">
                  <span [class]="presence(p.presence).cls"><span aria-hidden="true">{{ presence(p.presence).glyph }}</span> {{ presence(p.presence).label }}</span>
                  <span class="num text-muted-foreground">{{ p.accuracy !== null ? '±' + round(p.accuracy) + ' m' : '—' }} · {{ p.lastUpdate ? rel(p.lastUpdate) : txt.never }}</span>
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
              <ah-team-badge [team]="p.team" size="sm" />
              @if (p.squad) {
                <ah-squad-badge [squad]="p.squad" [leader]="p.member.isSquadLeader" />
              }
              @if (p.member.playerRole) {
                <span class="text-xs text-muted-foreground">{{ roleLabels[p.member.playerRole] }}</span>
              }
            </div>
          </div>
          <button hlmBtn type="button" variant="ghost" size="icon" class="size-10 shrink-0" (click)="selectedPlayerId.set(null)" aria-label="Close player details" i18n-aria-label>
            <ng-icon name="lucideX" size="16" aria-hidden="true" />
          </button>
        </div>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt class="text-muted-foreground" i18n>Status</dt>
          <dd [class]="presence(p.presence).cls"><span aria-hidden="true">{{ presence(p.presence).glyph }}</span> {{ presence(p.presence).label }}</dd>
          <dt class="text-muted-foreground" i18n>GPS</dt>
          <dd class="num">{{ p.accuracy !== null ? '±' + round(p.accuracy) + ' m' : txt.noFix }}{{ p.member.trackingActive ? '' : txt.notSharing }}</dd>
          <dt class="text-muted-foreground" i18n>Last update</dt>
          <dd>{{ p.lastUpdate ? rel(p.lastUpdate) + ' · ' + time(p.lastUpdate) : txt.never }}</dd>
          @if (p.suspicious || p.flags.length) {
            <dt class="text-destructive" i18n>Flags</dt>
            <dd class="text-destructive">▲ {{ p.flags.length ? p.flags.join(', ') : txt.suspiciousMovement }}</dd>
          }
        </dl>
        <div class="grid grid-cols-2 gap-1.5">
          <button hlmBtn type="button" variant="outline" class="h-10" (click)="locatePlayer(p)" [disabled]="!p.pos">
            <ng-icon name="lucideCrosshair" size="14" aria-hidden="true" /> <ng-container i18n>Locate</ng-container>
          </button>
          <button hlmBtn type="button" variant="outline" class="h-10" (click)="openAnnounce('player', null, p.member.userId)">
            <ng-icon name="lucideMessageSquare" size="14" aria-hidden="true" /> <ng-container i18n>Message</ng-container>
          </button>
          <button hlmBtn type="button" variant="outline" class="h-10" (click)="openAdjust(p.member.teamId, p.member.userId)" [disabled]="!p.member.teamId">
            <ng-icon name="lucideSlidersHorizontal" size="14" aria-hidden="true" /> <ng-container i18n>Team score</ng-container>
          </button>
          @if (p.member.role === 'player') {
            <button hlmBtn type="button" variant="destructive" class="h-10" (click)="removePlayer(p.member)">
              <ng-icon name="lucideUserX" size="14" aria-hidden="true" /> <ng-container i18n>Remove</ng-container>
            </button>
          }
        </div>
        <div class="flex gap-1.5">
          <label class="sr-only" for="cc-move-team" i18n>Move {{ p.member.nickname }} to team</label>
          <select id="cc-move-team" [class]="selectClass" #moveSel>
            @for (t of teams(); track t.id) {
              <option [value]="t.id" [selected]="t.id === p.member.teamId">{{ t.name }}</option>
            }
          </select>
          <button hlmBtn type="button" variant="outline" class="h-10 shrink-0" (click)="movePlayer(p.member, moveSel.value)" i18n>Move</button>
        </div>
      </div>
    </ng-template>

    <!-- ---------- map ---------- -->
    <ng-template #mapTpl>
      <ah-tactical-map
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
            <label for="cc-search" class="sr-only" i18n>Find a player</label>
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
              (keydown.enter)="selectFirstMatch()" i18n-placeholder
            />
            <kbd class="num pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-sm border border-border px-1 text-xs text-muted-foreground sm:block" aria-hidden="true">/</kbd>
          </div>
          <button hlmBtn type="button" [variant]="filtersOpen() || filtersActive() ? 'secondary' : 'outline'" class="h-10" (click)="filtersOpen.set(!filtersOpen())" [attr.aria-expanded]="filtersOpen()">
            <ng-icon name="lucideFilter" size="14" aria-hidden="true" /> <ng-container i18n>Filters{{ filtersActive() ? ' •' : '' }}</ng-container>
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
                <ah-team-swatch [color]="t.color" [pattern]="t.pattern" /> {{ t.name }}
              </button>
            }
            @if (squads().length) {
              <select [class]="selectClass + ' w-auto!'" [value]="squadFilter()" (change)="squadFilter.set($any($event.target).value)" aria-label="Filter by squad" i18n-aria-label>
                <option value="" i18n>All squads</option>
                @for (s of squads(); track s.id) {
                  <option [value]="s.id">{{ s.callsign || s.name }}</option>
                }
              </select>
            }
            <select [class]="selectClass + ' w-auto!'" [value]="statusFilter()" (change)="statusFilter.set($any($event.target).value)" aria-label="Filter objectives by status" i18n-aria-label>
              <option value="" i18n>All objectives</option>
              @for (s of objStatuses; track s) {
                <option [value]="s">{{ objStatusLabels[s] }}</option>
              }
            </select>
            <label class="flex h-10 cursor-pointer items-center gap-2 rounded-sm border border-border px-2 text-xs font-semibold">
              <input type="checkbox" class="size-4 accent-primary" [checked]="onlineOnly()" (change)="onlineOnly.set($any($event.target).checked)" /> <ng-container i18n>Online only</ng-container>
            </label>
            <label class="flex h-10 cursor-pointer items-center gap-2 rounded-sm border border-border px-2 text-xs font-semibold">
              <input type="checkbox" class="size-4 accent-primary" [checked]="showMapLabels()" (change)="showMapLabels.set($any($event.target).checked)" /> <ng-container i18n>Names</ng-container>
            </label>
            @if (filtersActive()) {
              <button hlmBtn type="button" variant="ghost" class="h-10 text-xs" (click)="clearFilters()" i18n>Clear</button>
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
          <h2 id="h-alerts" class="label-caps mr-auto" i18n>Alerts</h2>
          @for (s of severities; track s) {
            @if (alertCounts()[s]) {
              <ah-status-chip [label]="alertCounts()[s] + ' ' + sevSpec(s).label.toLowerCase()" [glyph]="sevSpec(s).glyph" [tone]="sevSpec(s).tone" />
            }
          }
        </div>
        @if (!sortedAlerts().length) {
          <p class="text-sm text-muted-foreground" i18n>No alerts.</p>
        }
        <ul class="flex flex-col gap-1.5">
          @for (a of sortedAlerts(); track a.id) {
            <li class="rounded-md border bg-card p-2 text-sm" [class]="a.acknowledged ? 'border-border opacity-60' : a.severity === 'critical' ? 'border-destructive/60' : a.severity === 'warning' ? 'border-warning/50' : 'border-border'">
              <div class="flex items-start gap-2">
                <ah-status-chip [label]="sevSpec(a.severity).label" [glyph]="sevSpec(a.severity).glyph" [tone]="sevSpec(a.severity).tone" />
                <div class="min-w-0 flex-1">
                  <p>{{ a.message }}</p>
                  <p class="text-xs text-muted-foreground">{{ a.nickname ? a.nickname + ' · ' : '' }}<time [attr.datetime]="a.createdAt" [title]="abs(a.createdAt)">{{ rel(a.createdAt) }}</time></p>
                </div>
              </div>
              @if (!a.acknowledged || a.userId) {
                <div class="mt-1.5 flex justify-end gap-1.5">
                  @if (a.userId) {
                    <button hlmBtn type="button" variant="ghost" class="h-10" (click)="selectPlayer(a.userId, true)" i18n>Locate</button>
                  }
                  @if (!a.acknowledged) {
                    <button hlmBtn type="button" variant="outline" class="h-10" (click)="ack(a)" [disabled]="busyId() === a.id" i18n>Acknowledge</button>
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
        <h2 id="h-reqs" class="label-caps mb-2" i18n>Purchase requests · {{ pendingPurchases().length }}</h2>
        @if (!pendingPurchases().length) {
          <p class="text-sm text-muted-foreground" i18n>No requests waiting.</p>
        }
        <ul class="flex flex-col gap-1.5">
          @for (p of pendingPurchases(); track p.id) {
            <li class="rounded-md border border-warning/50 bg-card p-2 text-sm">
              <p class="font-semibold">{{ p.perkName }} <span class="text-xs font-normal text-muted-foreground">· {{ perkTypeLabels[p.perkType] }}</span></p>
              <p class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <ah-team-badge [team]="teamById().get(p.teamId)" size="sm" [showIcon]="false" />
                {{ p.buyerNickname ?? '' }} · <span class="num" i18n>{{ n(p.price) }} cr</span> · {{ rel(p.createdAt) }}
                @if (p.targetTeamId) {
                  <ng-container i18n>· target {{ teamById().get(p.targetTeamId)?.name }}</ng-container>
                }
              </p>
              <div class="mt-1.5 grid grid-cols-2 gap-1.5">
                <button hlmBtn type="button" variant="destructive" class="h-10" (click)="reviewPurchase(p, false)" [disabled]="busyId() === p.id" i18n>Reject</button>
                <button hlmBtn type="button" class="h-10" (click)="reviewPurchase(p, true)" [disabled]="busyId() === p.id" i18n>Approve</button>
              </div>
            </li>
          }
        </ul>
      </section>
    </ng-template>

    <!-- ---------- active perks / effects ---------- -->
    <ng-template #effectsTpl>
      <section aria-labelledby="h-effects">
        <h2 id="h-effects" class="label-caps mb-2" i18n>Active perks · {{ activePurchases().length }}</h2>
        @if (!activePurchases().length) {
          <p class="text-sm text-muted-foreground" i18n>No perk is active.</p>
        }
        <ul class="flex flex-col gap-1.5">
          @for (p of activePurchases(); track p.id) {
            <li class="rounded-md border border-border bg-card p-2 text-sm">
              <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <p class="font-semibold">{{ p.perkName }}</p>
                  <p class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <ah-team-badge [team]="teamById().get(p.teamId)" size="sm" [showIcon]="false" />
                    @if (p.targetTeamId) {
                      → {{ teamById().get(p.targetTeamId)?.name }}
                    }
                    @if (p.expiresAt) {
                      · <ng-container i18n><span class="num">{{ remaining(p.expiresAt) }}</span> left</ng-container>
                    }
                  </p>
                </div>
                <ah-status-chip [spec]="purchaseChip(p)" />
              </div>
              <div class="mt-1.5 flex items-center justify-between gap-2">
                <label class="flex min-h-10 cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" class="size-5 accent-primary" [checked]="refundIds().has(p.id)" [disabled]="p.refunded" (change)="toggleSet(refundIds, p.id, $any($event.target).checked)" />
                  <ng-container i18n>Refund {{ n(p.price) }} cr</ng-container>
                </label>
                <button hlmBtn type="button" variant="destructive" class="h-10" (click)="cancelPurchase(p)" [disabled]="busyId() === p.id" i18n>Cancel perk</button>
              </div>
            </li>
          }
        </ul>
        @if (otherEffects().length) {
          <h3 class="label-caps mb-1 mt-3" i18n>Other effects</h3>
          <ul class="flex flex-col gap-1 text-xs">
            @for (e of otherEffects(); track e.id) {
              <li class="flex items-center gap-2">
                <ah-team-badge [team]="teamById().get(e.teamId)" size="sm" [showIcon]="false" />
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
          <h2 id="h-feed" class="label-caps" i18n>Activity</h2>
          <a [routerLink]="['/gm/events', eventId(), 'activity']" class="text-xs text-muted-foreground underline-offset-4 hover:underline" i18n>Full log</a>
        </div>
        @if (!store.activity().length) {
          <p class="text-sm text-muted-foreground" i18n>Nothing yet.</p>
        }
        <ol class="flex flex-col" aria-live="polite" aria-relevant="additions">
          @for (a of feed(); track a.id) {
            <li class="flex gap-2 border-b border-border py-1.5 text-sm last:border-0">
              <time class="num w-12 shrink-0 text-xs text-muted-foreground" [attr.datetime]="a.createdAt" [title]="abs(a.createdAt)">{{ time(a.createdAt) }}</time>
              <span class="min-w-0 flex-1">{{ a.message }}</span>
              @if (a.scope === 'gm') {
                <span class="text-[0.65rem] font-semibold text-muted-foreground" i18n>GM</span>
              }
            </li>
          }
        </ol>
      </section>
    </ng-template>

    <!-- ---------- settings and links ---------- -->
    <ng-template #settingsTpl>
      <section class="flex flex-col gap-3" aria-labelledby="h-vis">
        <h2 id="h-vis" class="label-caps" i18n>Map visibility (applies immediately)</h2>
        @if (rules(); as r) {
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="cc-ally" i18n>Teammates' precision</label>
            <select id="cc-ally" [class]="selectClass" [value]="r.allyPrecision" (change)="setRule('allyPrecision', $event, precisionLabels)">
              @for (p of precisions; track p) {
                <option [value]="p">{{ precisionLabels[p] }}</option>
              }
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="cc-enemy" i18n>Enemy positions</label>
            <select id="cc-enemy" [class]="selectClass" [value]="r.enemies" (change)="setRule('enemies', $event, enemyLabels)">
              <option value="never">{{ enemyLabels['never'] }}</option>
              <option value="perk_only">{{ enemyLabels['perk_only'] }}</option>
              <option value="always">{{ enemyLabels['always'] }}</option>
            </select>
          </div>
          <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" class="size-5 accent-primary" [checked]="r.showNicknames" (change)="setNicknames($event)" /> <ng-container i18n>Show nicknames on players' maps</ng-container>
          </label>
        }
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="cc-interval" i18n>Location update interval</label>
          <select id="cc-interval" [class]="selectClass" [value]="intervalValue()" (change)="setInterval($event)">
            @for (s of intervals; track s) {
              <option [value]="s" i18n>Every {{ s }} s</option>
            }
          </select>
          <p class="text-xs text-muted-foreground" i18n>Shorter is more precise but uses more battery.</p>
        </div>
      </section>
      <nav class="mt-4 flex flex-col" aria-label="GM tools" i18n-aria-label>
        <h2 class="label-caps mb-1" i18n>Tools</h2>
        <a [routerLink]="['/events', eventId(), 'results', 'export']" class="flex min-h-11 items-center gap-3 rounded-sm px-2 text-sm hover:bg-muted"><ng-icon name="lucideFileDown" size="16" aria-hidden="true" /> <ng-container i18n>Export results</ng-container></a>
        <a [routerLink]="['/gm/events', eventId(), 'activity']" class="flex min-h-11 items-center gap-3 rounded-sm px-2 text-sm hover:bg-muted"><ng-icon name="lucideHistory" size="16" aria-hidden="true" /> <ng-container i18n>Activity log</ng-container></a>
        <a [routerLink]="['/gm/events', eventId(), 'scores']" class="flex min-h-11 items-center gap-3 rounded-sm px-2 text-sm hover:bg-muted"><ng-icon name="lucideTrophy" size="16" aria-hidden="true" /> <ng-container i18n>Score manager</ng-container></a>
        <a [routerLink]="['/gm/events', eventId(), 'players']" class="flex min-h-11 items-center gap-3 rounded-sm px-2 text-sm hover:bg-muted"><ng-icon name="lucideUsers" size="16" aria-hidden="true" /> <ng-container i18n>Player management</ng-container></a>
        <a [routerLink]="['/gm/events', eventId(), 'map']" class="flex min-h-11 items-center gap-3 rounded-sm px-2 text-sm hover:bg-muted"><ng-icon name="lucideMap" size="16" aria-hidden="true" /> <ng-container i18n>Map editor</ng-container></a>
      </nav>
      <p class="mt-3 text-xs text-muted-foreground" i18n>Shortcuts: <kbd class="num rounded-sm border border-border px-1">/</kbd> find player · <kbd class="num rounded-sm border border-border px-1">Esc</kbd> clear selection</p>
    </ng-template>

    <!-- ======================= dialogs ======================= -->
    <ah-ops-dialog [open]="dialog() === 'announce'" title="Send announcement" (closed)="dialog.set(null)" i18n-title>
      @if (dialog() === 'announce') {
        <ah-announce-form
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
    </ah-ops-dialog>

    <ah-ops-dialog [open]="dialog() === 'emergency'" title="Emergency alert" (closed)="dialog.set(null)" i18n-title>
      @if (dialog() === 'emergency') {
        <ah-announce-form [eventId]="eventId()" [teams]="teams()" [members]="store.members()" [emergency]="true" (sent)="dialog.set(null)" (cancel)="dialog.set(null)" />
      }
    </ah-ops-dialog>

    <ah-ops-dialog [open]="dialog() === 'extend'" title="Extend game time" [subtitle]="endsAtLabel()" (closed)="dialog.set(null)" i18n-title>
      @if (dialog() === 'extend') {
        <div class="flex flex-col gap-4">
          <div class="grid grid-cols-3 gap-2">
            @for (m of [5, 10, 15]; track m) {
              <button hlmBtn type="button" variant="outline" class="num h-12 text-base" (click)="extend(m)" [disabled]="busy()" i18n>+{{ m }} min</button>
            }
          </div>
          <form class="flex items-end gap-2" (submit)="$event.preventDefault(); extend(customMinutes.valueAsNumber)">
            <div class="flex flex-1 flex-col gap-1.5">
              <label hlmLabel for="cc-ext" i18n>Custom (minutes)</label>
              <input hlmInput #customMinutes id="cc-ext" type="number" min="1" max="600" step="1" value="30" class="num h-11" />
            </div>
            <button hlmBtn type="submit" class="h-11" [disabled]="busy()" i18n>Extend</button>
          </form>
        </div>
      }
    </ah-ops-dialog>

    <ah-adjust-balance-dialog
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
  /** UI text used inside template expressions. */
  protected readonly txt = {
    loading: $localize`Loading…`,
    gm: $localize`GM`,
    noTeam: $localize`No team`,
    noFix: $localize`No fix`,
    notSharing: $localize` · not sharing`,
    never: $localize`Never`,
    suspiciousMovement: $localize`Suspicious movement`,
    noObjectivesWithThis: $localize`No objectives with this status`,
    noObjectives: $localize`No objectives`,
    noPlayersMatchThe: $localize`No players match the filters`,
    noApprovedPlayers: $localize`No approved players`,
  };

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
  protected readonly enemyLabels: Record<string, string> = { never: $localize`Never shown`, perk_only: $localize`Only with a perk (UAV, recon)`, always: $localize`Always shown` };
  protected readonly intervals = [5, 10, 15, 30, 60];
  protected readonly severities: GmAlert['severity'][] = ['critical', 'warning', 'info'];
  protected readonly leftTabs: { id: LeftTab; label: string }[] = [
    { id: 'objectives', label: $localize`Objectives` },
    { id: 'players', label: $localize`Players` },
    { id: 'captures', label: $localize`Captures` },
  ];
  protected readonly phoneTabs: { id: PhoneTab; label: string; icon: string }[] = [
    { id: 'teams', label: $localize`Teams`, icon: 'lucideTrophy' },
    { id: 'objectives', label: $localize`Objectives`, icon: 'lucideFlag' },
    { id: 'players', label: $localize`Players`, icon: 'lucideUsers' },
    { id: 'alerts', label: $localize`Alerts`, icon: 'lucideBell' },
    { id: 'feed', label: $localize`Feed`, icon: 'lucideActivity' },
    { id: 'actions', label: $localize`Actions`, icon: 'lucideSlidersHorizontal' },
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
      .filter(playsIn)
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
    return ends ? $localize`The game currently ends at ${formatTime(ends)}:ends:.` : $localize`The game has no end time yet.`;
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
      if (err?.status !== 404) this.toast.warning($localize`The control center is for Game Masters`);
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
      title: $localize`Open the lobby?`,
      consequences: [$localize`Players can check in, mark themselves ready and see their team.`, $localize`From the lobby you can start the game.`],
      confirmLabel: $localize`Open lobby`,
    });
    if (ok) await this.setStatus('lobby', $localize`Lobby open`);
  }

  protected async start(): Promise<void> {
    const ev = this.store.event();
    if (!ev) return;
    const dur = new Date(ev.endAt).getTime() - new Date(ev.startAt).getTime();
    const s = ev.scoring;
    const ready = this.store.members().filter((m) => m.role === 'player' && m.status === 'approved');
    const consequences = [
      $localize`The game clock starts now and runs for ${formatDuration(Math.max(60_000, dur))}:duration:.`,
      s.startingPoints || s.startingCurrency
        ? $localize`Every team gets its starting balance (${formatNumber(s.startingPoints)}:startingPoints: points, ${formatNumber(s.startingCurrency)}:startingCurrency: credits).`
        : $localize`Teams start at 0 points and 0 credits.`,
      $localize`${ready.length}:length: players are notified; location sharing starts for players who consented.`,
      $localize`Objectives become capturable according to their availability.`,
    ];
    const noTeam = ready.filter((m) => !m.teamId).length;
    if (noTeam) consequences.push(noTeam === 1 ? $localize`1 approved player has no team and cannot capture.` : $localize`${noTeam}:count: approved players have no team and cannot capture.`);
    const ok = await this.confirm.ask({ title: $localize`Start the game?`, consequences, confirmLabel: $localize`Start game` });
    if (ok) await this.setStatus('live', $localize`Game started`);
  }

  protected async pause(): Promise<void> {
    const stopTracking = this.store.event()?.tracking.stopWhenPaused;
    const reason = await this.confirm.askReason({
      title: $localize`Pause the game?`,
      consequences: [
        $localize`The game clock, capture timers and points for held objectives stop.`,
        $localize`Players see the game as paused and cannot capture or buy perks.`,
        stopTracking ? $localize`Location sharing pauses until you resume.` : $localize`Location sharing continues so you can still see everyone.`,
      ],
      confirmLabel: $localize`Pause game`,
      reason: { label: $localize`Message to players (optional)`, required: false, placeholder: $localize`e.g. Injury at the north gate` },
    });
    if (reason !== null) await this.setStatus('paused', $localize`Game paused`, reason.trim() || undefined);
  }

  protected async resume(): Promise<void> {
    const ok = await this.confirm.ask({
      title: $localize`Resume the game?`,
      consequences: [$localize`The clock restarts; the end time moves later by the length of the pause.`, $localize`Captures, perks and held-objective points resume.`],
      confirmLabel: $localize`Resume game`,
    });
    if (ok) await this.setStatus('live', $localize`Game resumed`);
  }

  protected async endGame(): Promise<void> {
    const leader = this.rankedTeams()[0];
    const ok = await this.confirm.ask({
      title: $localize`End the game now?`,
      consequences: [
        leader ? $localize`Final scores are locked (${leader.name}:leader: leads with ${formatNumber(leader.points)}:points: points).` : $localize`Final scores are locked.`,
        $localize`Location tracking stops for all players.`,
        $localize`No more captures, purchases or perks.`,
        $localize`This cannot be undone.`,
      ],
      confirmLabel: $localize`End game`,
      destructive: true,
      requireText: $localize`:typed confirmation word|:END`,
    });
    if (ok) await this.setStatus('completed', $localize`Game over: final scores locked`);
  }

  protected async extend(minutes: number): Promise<void> {
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) {
      this.toast.warning($localize`Enter between 1 and 600 minutes`);
      return;
    }
    minutes = Math.round(minutes);
    const ends = this.store.clock()?.endsAt;
    const newEnd = ends ? new Date(new Date(ends).getTime() + minutes * 60_000).toISOString() : null;
    const ok = await this.confirm.ask({
      title: $localize`Extend by ${minutes}:minutes: minutes?`,
      consequences: [ends && newEnd ? $localize`The game ends at ${formatTime(newEnd)}:newEnd: instead of ${formatTime(ends)}:ends:.` : $localize`The game gets ${minutes}:minutes: more minutes.`, $localize`Players see the new remaining time immediately.`],
      confirmLabel: $localize`Add ${minutes}:minutes: min`,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const ev = await this.api.extendGame(this.eventId(), minutes);
      this.store.event.set(ev);
      this.store.clock.set(ev.clock);
      this.dialog.set(null);
      this.toast.success($localize`Game extended by ${minutes}:minutes: min`, ev.clock.endsAt ? $localize`Ends at ${formatTime(ev.clock.endsAt)}:endsAt:.` : undefined);
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
      activate: { title: $localize`Activate ${o.name}:name:?`, label: $localize`Activate`, consequences: [$localize`It becomes visible and capturable again (subject to its rules).`, $localize`Players are notified.`] },
      disable: { title: $localize`Disable ${o.name}:name:?`, label: $localize`Disable`, destructive: true, consequences: [$localize`Nobody can capture it until you activate it again.`, $localize`Its current owner keeps it.`, $localize`Players are notified.`] },
      set_owner: {
        title: $localize`Give ${o.name}:name: to ${team?.name ?? $localize`the team`}:team:?`,
        label: $localize`Set owner`,
        consequences: live
          ? [$localize`Counts as a capture by ${team?.name}:name:: they receive its rewards (${formatNumber(o.rewards.points)}:points: points, ${formatNumber(o.rewards.currency)}:currency: credits or their team override).`, $localize`Players are notified like a normal capture.`]
          : [$localize`${team?.name}:name: becomes the owner. No rewards are given before the game is live.`],
      },
      clear_owner: { title: $localize`Clear the owner of ${o.name}:name:?`, label: $localize`Clear owner`, destructive: true, consequences: [owner ? $localize`${owner.name}:owner: no longer holds it; points for holding it stop.` : $localize`The owner no longer holds it; points for holding it stop.`, $localize`Points already earned are kept.`] },
      contest: { title: $localize`Mark ${o.name}:name: as contested?`, label: $localize`Mark contested`, consequences: [$localize`Captures are blocked until you clear the contest.`, $localize`Players see it as contested.`] },
      uncontest: { title: $localize`Clear the contest on ${o.name}:name:?`, label: $localize`Clear contest`, consequences: [$localize`Captures are possible again; geofence presence is reset.`] },
      reset: {
        title: $localize`Reset ${o.name}:name:?`,
        label: $localize`Reset objective`,
        destructive: true,
        consequences: [$localize`Owner, capture count, cooldown, contest and capture progress are cleared.`, $localize`Points and credits already awarded stay in the ledger.`],
      },
    };
    const s = spec[action];
    const reason = await this.confirm.askReason({
      title: s.title,
      consequences: [...s.consequences, $localize`Logged in the audit log with your reason.`],
      confirmLabel: s.label,
      destructive: s.destructive,
      reason: { label: $localize`Reason`, required: true, placeholder: $localize`At least 3 characters` },
    });
    if (reason === null) return;
    if (reason.trim().length < 3) {
      this.toast.warning($localize`Give a reason of at least 3 characters`);
      return;
    }
    this.busyId.set(o.id);
    try {
      const updated = await this.api.gmObjectiveAction(this.eventId(), o.id, action, reason.trim(), teamId ?? null);
      if (updated) this.store.objectives.update((l) => l.map((x) => (x.id === updated.id ? updated : x)));
      this.store.refresh('objectives', 'event');
      this.toast.success($localize`${o.name}:name:: ${s.label.toLowerCase()}:label: done`);
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
    const team = this.teamById().get(c.teamId)?.name ?? $localize`The team`;
    const reason = await this.confirm.askReason({
      title: $localize`Revoke the capture of ${c.objectiveName}:objectiveName:?`,
      consequences: [
        c.nickname ? $localize`The capture by ${c.nickname}:nickname: (${team}:team:) is marked as revoked.` : $localize`The capture by ${team}:team: is marked as revoked.`,
        reverse ? $localize`${team}:team: loses the ${formatNumber(c.points)}:points: points and ${formatNumber(c.currency)}:currency: credits it awarded.` : $localize`Points and credits already awarded are kept.`,
        $localize`Logged in the audit log with your reason.`,
      ],
      confirmLabel: $localize`Revoke capture`,
      destructive: true,
      reason: { label: $localize`Reason`, required: true, placeholder: $localize`e.g. Code shared over the radio` },
    });
    if (reason === null) return;
    if (reason.trim().length < 3) {
      this.toast.warning($localize`Give a reason of at least 3 characters`);
      return;
    }
    try {
      await this.api.revokeCapture(this.eventId(), c.id, reverse, reason.trim());
      this.captures.update((l) => l.map((x) => (x.id === c.id ? { ...x, revoked: true } : x)));
      this.store.refresh('objectives', 'event');
      this.toast.success($localize`Capture revoked`, reverse ? $localize`Rewards reversed.` : $localize`Rewards kept.`);
    } catch (e) {
      this.toast.error(e);
    }
  }

  // ------------------------------------------------------------------ purchases

  protected async reviewPurchase(p: PerkPurchase, approve: boolean): Promise<void> {
    const team = this.teamById().get(p.teamId)?.name ?? $localize`The team`;
    let reason: string | null = null;
    if (approve) {
      const ok = await this.confirm.ask({
        title: $localize`Approve ${p.perkName}:perkName: for ${team}:team:?`,
        consequences: [$localize`${team}:team: keeps the ${formatNumber(p.price)}:price: credits already paid.`, $localize`The perk becomes ready or active according to its settings.`],
        confirmLabel: $localize`Approve`,
      });
      if (!ok) return;
    } else {
      reason = await this.confirm.askReason({
        title: $localize`Reject ${p.perkName}:perkName:?`,
        consequences: [$localize`${team}:team: gets the ${formatNumber(p.price)}:price: credits back.`, $localize`The buyer sees your reason.`],
        confirmLabel: $localize`Reject`,
        destructive: true,
        reason: { label: $localize`Reason`, required: true },
      });
      if (reason === null) return;
    }
    this.busyId.set(p.id);
    try {
      const updated = await this.api.reviewPurchase(this.eventId(), p.id, approve, reason?.trim() || undefined);
      this.store.purchases.update((l) => l.map((x) => (x.id === updated.id ? updated : x)));
      this.store.refresh('purchases', 'effects', 'event', 'alerts');
      this.toast.success(approve ? $localize`Request approved` : $localize`Request rejected`);
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
    const team = this.teamById().get(p.teamId)?.name ?? $localize`The team`;
    const reason = await this.confirm.askReason({
      title: $localize`Cancel ${p.perkName}:perkName:?`,
      consequences: [
        $localize`Its effect ends immediately.`,
        refund ? $localize`${team}:team: gets the ${formatNumber(p.price)}:price: credits back.` : $localize`No refund: ${team}:team: does not get the credits back.`,
        $localize`Logged in the audit log with your reason.`,
      ],
      confirmLabel: $localize`Cancel perk`,
      cancelLabel: $localize`Keep it`,
      destructive: true,
      reason: { label: $localize`Reason`, required: true },
    });
    if (reason === null) return;
    if (reason.trim().length < 3) {
      this.toast.warning($localize`Give a reason of at least 3 characters`);
      return;
    }
    this.busyId.set(p.id);
    try {
      const updated = await this.api.cancelPurchase(this.eventId(), p.id, refund, reason.trim());
      this.store.purchases.update((l) => l.map((x) => (x.id === updated.id ? updated : x)));
      this.store.refresh('purchases', 'effects', 'event');
      this.toast.success($localize`Perk cancelled`, refund ? $localize`Credits refunded.` : undefined);
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
    const to = this.teamById().get(teamId)?.name ?? $localize`the team`;
    const ok = await this.confirm.ask({
      title: $localize`Move ${m.nickname}:nickname: to ${to}:to:?`,
      consequences: [
        from ? $localize`${m.nickname}:nickname: leaves ${from}:from: and their squad, and joins ${to}:to:.` : $localize`${m.nickname}:nickname: joins ${to}:to:.`,
        $localize`They see ${to}:to:'s map, objectives and store from now on.`,
        $localize`Points already earned stay with the previous team.`,
      ],
      confirmLabel: $localize`Move to ${to}:to:`,
    });
    if (!ok) return;
    try {
      await this.api.assignMember(this.eventId(), m.userId, { teamId, squadId: null });
      this.store.refresh('members', 'event');
      this.toast.success($localize`${m.nickname}:nickname: moved to ${to}:to:`);
    } catch (e) {
      this.toast.error(e);
    }
  }

  protected async removePlayer(m: Member): Promise<void> {
    const res = await this.confirm.askChoice({
      title: $localize`Remove ${m.nickname}:nickname: from the event?`,
      consequences: [$localize`They lose access to the live game immediately and their location stops being shared.`, $localize`Their past captures stay in the results.`],
      choices: [
        { value: 'remove', label: $localize`Remove`, hint: $localize`They can join the event again.`, confirmLabel: $localize`Remove player` },
        { value: 'ban', label: $localize`:remove a player|:Ban`, hint: $localize`They cannot join again unless you invite them.`, confirmLabel: $localize`Ban player` },
      ],
      destructive: true,
      reason: { label: $localize`Reason (shown to the player)`, required: true },
    });
    if (res === null) return;
    const ban = res.choice === 'ban';
    try {
      await this.api.removeMember(this.eventId(), m.userId, res.reason.trim(), ban);
      this.selectedPlayerId.set(null);
      this.store.refresh('members', 'event');
      this.toast.success(ban ? $localize`${m.nickname}:nickname: banned` : $localize`${m.nickname}:nickname: removed`);
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
      title: $localize`Change map visibility?`,
      consequences: [
        `${key === 'allyPrecision' ? "Teammates' positions" : 'Enemy positions'}: ${labels[prev] ?? prev} → ${labels[value] ?? value}.`,
        $localize`Applies to all players immediately.`,
      ],
      confirmLabel: $localize`Apply`,
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
      title: value ? $localize`Show nicknames on maps?` : $localize`Hide nicknames on maps?`,
      consequences: [value ? $localize`Players see the nicknames of the people they are allowed to see.` : $localize`Players see markers without nicknames.`, $localize`Applies to all players immediately.`],
      confirmLabel: $localize`Apply`,
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
      this.toast.success($localize`Map visibility updated`);
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
      title: $localize`Update positions every ${sec}:sec: s?`,
      consequences: [
        sec < Number(prev) ? $localize`More precise positions; phones use more battery and data.` : $localize`Saves battery; positions on the map are less fresh.`,
        $localize`Applies to all players within a few seconds.`,
      ],
      confirmLabel: $localize`Apply`,
    });
    if (!ok) {
      el.value = prev;
      return;
    }
    try {
      const updated = await this.api.updateEvent(this.eventId(), { tracking: { intervalSec: sec } });
      this.store.event.set(updated);
      this.toast.success($localize`Location updates every ${sec}:sec: s`);
    } catch (e) {
      el.value = prev;
      this.toast.error(e);
    }
  }
}
