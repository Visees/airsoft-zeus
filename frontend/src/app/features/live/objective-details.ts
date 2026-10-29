import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiService } from '../../core/api/api.service';
import { ApiError } from '../../core/api/api-error';
import { Capture, CaptureBlockReason, Objective } from '../../core/api/models';
import { LiveStore } from '../../core/live/live-store';
import { LocationTracker } from '../../core/location/location-tracker.service';
import {
  BLOCK_REASON_LABELS,
  OBJECTIVE_TYPE_LABELS,
  formatDistance,
  formatDuration,
  formatNumber,
  formatTime,
} from '../../core/util/format';
import { zoneCanAccrue } from '../../shared/capture-bar';
import { CaptureProgress } from '../../shared/capture-progress';
import { nowSignal } from '../../shared/game-timer';
import { ObjectiveTimers } from '../../shared/objective-timers';
import { ErrorState, LoadingSkeleton } from '../../shared/states';
import { StatusChip, objectiveStatusChip } from '../../shared/status-chip';
import { TeamBadge } from '../../shared/team-badge';
import { CaptureAttempt } from './capture-attempt';
import { CaptureFeedback } from './capture-feedback';
import { LiveSession } from './live-session';
import { bearingLabel, distanceFrom, isFuture, liveLink, remaining } from './live-util';

const METHOD_LABELS: Record<Capture['method'], string> = { code: 'Code', qr: $localize`QR`, geofence: $localize`Zone`, gm: $localize`Game Master` };

/** One objective: state, conditions, capture controls (code / QR / zone) and capture history. */
@Component({
  selector: 'ah-objective-details',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    NgIcon,
    HlmButton,
    HlmInput,
    HlmLabel,
    CaptureProgress,
    CaptureFeedback,
    ObjectiveTimers,
    StatusChip,
    TeamBadge,
    LoadingSkeleton,
    ErrorState,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-2 pb-8">
      <a [routerLink]="listLink()" class="tap -ml-2 inline-flex items-center gap-1 self-start px-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ng-icon name="lucideArrowLeft" size="16" aria-hidden="true" /> <ng-container i18n>Objectives</ng-container>
      </a>

      @if (objective(); as o) {
        <!-- Header -->
        <header class="flex flex-col gap-1.5">
          <div class="flex flex-wrap items-center gap-1.5">
            <ah-status-chip [spec]="chip()" />
            <span class="label-caps">{{ typeLabel() }}</span>
            @if (jamLeft()) {
              <ah-status-chip label="Jammed" glyph="⌁" tone="danger" i18n-label />
            }
            @if (shieldLeft()) {
              <ah-status-chip label="Shielded" glyph="⛉" tone="nav" i18n-label />
            }
          </div>
          <h2 class="text-3xl uppercase">{{ o.name }}</h2>
          <p class="flex flex-wrap items-center gap-2 text-sm">
            @if (owner(); as t) {
              <span class="label-caps" i18n>Held by</span> <ah-team-badge [team]="t" />
              @if (o.ownerTeamId === myTeamId()) {
                <span class="font-semibold text-primary" i18n>(your team)</span>
              }
            } @else {
              <span class="text-muted-foreground" i18n>Not held by any team</span>
            }
          </p>
        </header>

        <!-- Time limit: referees run every team's timer, players see their own -->
        @if (o.timerSec > 0) {
          <ah-objective-timers [objective]="o" [control]="o.isReferee" />
        }

        <!-- Distance and direction -->
        <div class="panel flex items-center gap-3 p-3">
          @if (direction(); as d) {
            <ng-icon name="lucideNavigation2" size="28" class="shrink-0 text-nav" aria-hidden="true" [style.transform]="'rotate(' + d.deg + 'deg)'" />
            <div class="min-w-0 flex-1">
              <p class="num text-2xl font-bold text-nav">{{ distanceLabel() }}</p>
              <p class="num text-sm font-semibold" i18n>{{ d.point }} · {{ d.deg }}° from you</p>
            </div>
          } @else {
            <ng-icon name="lucideLocateOff" size="24" class="shrink-0 text-muted-foreground" aria-hidden="true" />
            <p class="flex-1 text-sm text-muted-foreground" i18n>No GPS fix yet — distance and direction appear when your position is known.</p>
          }
          <a hlmBtn variant="outline" class="h-12 shrink-0" [routerLink]="mapLink()" [queryParams]="{ focus: o.id }">
            <ng-icon name="lucideMap" size="18" aria-hidden="true" /> <ng-container i18n>Map</ng-container>
          </a>
        </div>

        <!-- Rewards -->
        <section class="panel p-3" aria-labelledby="rewards-title">
          <h3 id="rewards-title" class="label-caps" i18n>Rewards</h3>
          <dl class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt class="text-xs text-muted-foreground" i18n>Points</dt>
              <dd class="num text-2xl font-bold text-primary">+{{ fmt(rewards().points) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground" i18n>Credits</dt>
              <dd class="num text-2xl font-bold text-warning">+{{ fmt(rewards().currency) }}</dd>
            </div>
            @if (o.rewards.recurringPointsPerMinute || o.rewards.recurringCurrencyPerMinute) {
              <div class="col-span-2">
                <dt class="text-xs text-muted-foreground" i18n>While held, per minute</dt>
                <dd class="num text-lg font-bold" i18n>
                  +{{ o.rewards.recurringPointsPerMinute }} pts · +{{ o.rewards.recurringCurrencyPerMinute }} cr
                </dd>
              </div>
            }
          </dl>
          @if (rewards().custom) {
            <p class="mt-2 text-xs text-muted-foreground" i18n>Rewards shown are the ones for your team.</p>
          }
          @if (o.rewards.captureBonus || o.rewards.defenseBonus || o.rewards.completionBonus) {
            <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              @if (o.rewards.captureBonus) {
                <li i18n>First capture <span class="num font-semibold">+{{ o.rewards.captureBonus }}</span></li>
              }
              @if (o.rewards.defenseBonus) {
                <li i18n>Defense <span class="num font-semibold">+{{ o.rewards.defenseBonus }}</span></li>
              }
              @if (o.rewards.completionBonus) {
                <li i18n>Completion <span class="num font-semibold">+{{ o.rewards.completionBonus }}</span></li>
              }
            </ul>
          }
        </section>

        <!-- Conditions -->
        @if (conditions().length || contested()) {
          <section class="flex flex-col gap-2" aria-label="Conditions" i18n-aria-label>
            @if (contested()) {
              <div class="rounded-md border-2 border-destructive bg-destructive/10 p-3" role="status">
                <p class="font-bold text-destructive" i18n>▲ Contested</p>
                <p class="text-sm" i18n>Enemy players are in the zone. Clear it to continue the capture.</p>
              </div>
            }
            @if (conditions().length) {
              <ul class="panel flex flex-col divide-y divide-border">
                @for (c of conditions(); track c.text) {
                  <li class="flex items-start gap-2 p-3 text-sm">
                    <ng-icon [name]="c.icon" size="16" class="mt-0.5 shrink-0" [class]="c.tone" aria-hidden="true" />
                    <span class="min-w-0 flex-1">{{ c.text }}</span>
                    @if (c.time) {
                      <span class="num shrink-0 font-bold" [class]="c.tone">{{ c.time }}</span>
                    }
                  </li>
                }
              </ul>
            }
          </section>
        }

        <!-- Capture -->
        <section class="flex flex-col gap-3" aria-labelledby="capture-title">
          <h3 id="capture-title" class="label-caps" i18n>Capture</h3>

          @if (block(); as reason) {
            <div class="panel flex items-start gap-2 border-warning/60 p-3" role="status">
              <ng-icon name="lucideLock" size="18" class="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              <p class="text-sm"><span class="font-bold" i18n>Cannot capture now.</span> {{ blockLabel(reason) }}</p>
            </div>
          }

          @if (o.requireGeofence) {
            <div class="panel p-3 text-sm" [class.border-primary]="geo()?.armed">
              @if (geo()?.armed) {
                <p class="font-bold text-primary" i18n>✓ Zone held — the code or QR is accepted now</p>
              } @else {
                <p class="font-bold" i18n>Hold the zone first</p>
                <p class="text-muted-foreground" i18n>
                  Your team must be inside the zone (radius <span class="num">{{ o.geofence.radiusM }}</span> m) before the
                  {{ hasCode() && hasQr() ? txt.codeOrQr : hasQr() ? txt.qr : txt.code }} is accepted.
                </p>
              }
            </div>
          }

          @if (usesZone()) {
            <div class="panel p-4">
              @if (geo(); as g) {
                <ah-capture-progress [status]="g" [canAccrue]="canAccrue(o)" />
              } @else if (!sharingActive()) {
                <div class="flex flex-col gap-2 text-sm">
                  <p class="font-bold" i18n>Location sharing is off</p>
                  <p class="text-muted-foreground" i18n>Holding the zone only counts when your position is shared with the game.</p>
                  <button hlmBtn variant="outline" type="button" class="h-12" (click)="enableSharing()">
                    <ng-icon name="lucideLocateFixed" size="18" aria-hidden="true" /> <ng-container i18n>Turn on location sharing</ng-container>
                  </button>
                </div>
              } @else if (!fix()) {
                <p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <ng-icon name="lucideLoader2" size="16" class="animate-spin" aria-hidden="true" /> <ng-container i18n>Waiting for GPS…</ng-container>
                </p>
              } @else {
                <div class="text-sm" role="status">
                  @if (toEdge() !== null && toEdge()! > 0) {
                    <p class="font-bold" i18n>Move closer</p>
                    <p class="text-muted-foreground" i18n>
                      About <span class="num font-semibold text-nav">{{ dist(toEdge()) }}</span> to the edge of the zone.
                    </p>
                  } @else {
                    <p class="flex items-center gap-2 font-bold">
                      <ng-icon name="lucideLoader2" size="16" class="animate-spin" aria-hidden="true" /> <ng-container i18n>Checking your position with the server…</ng-container>
                    </p>
                  }
                </div>
              }
              @if (accuracyTooLow()) {
                <p class="mt-2 text-sm font-semibold text-warning" i18n>
                  ◐ GPS accuracy ±<span class="num">{{ fixAccuracy() }}</span> m — this zone needs ±<span class="num">{{ o.geofence.maxAccuracyM }}</span> m
                  or better. Move into the open.
                </p>
              } @else if (fix() && usesZone()) {
                <p class="mt-2 text-sm text-muted-foreground" [class.text-warning]="roughForZone()">
                  <ng-container i18n>GPS ±<span class="num">{{ fixAccuracy() }}</span></ng-container> m
                  @if (roughForZone()) {
                    <ng-container i18n>— rough for a <span class="num">{{ o.geofence.radiusM }}</span> m zone. Open sky gives the best fix: step out from under trees or away from walls.</ng-container>
                  }
                </p>
              }
              @if (tracker.wakeLockUnreliable) {
                <p class="mt-2 text-sm font-semibold text-warning" i18n>
                  ▲ This iPhone can't keep the screen on from the app, and GPS stops when it locks. Set Settings › Display &amp; Brightness › Auto-Lock to Never during the game.
                </p>
              }
              <p class="mt-2 text-xs text-muted-foreground">
                <ng-container i18n>Hold for <span class="num">{{ holdLabel() }}</span></ng-container>.
                @if (o.geofence.resetOnExit) { <ng-container i18n>Leaving the zone resets the progress.</ng-container> }
                @if (o.geofence.contestable && o.geofence.contestRule === 'majority') {
                  <ng-container i18n>If several teams are inside, the one with the most players keeps capturing.</ng-container>
                } @else if (o.geofence.contestable) {
                  <ng-container i18n>Enemies inside stop the capture.</ng-container>
                }
                @if (o.geofence.multiPlayerBoost) { <ng-container i18n>More teammates inside make it faster.</ng-container> }
                @if (o.geofence.requireScreenOpen) { <ng-container i18n>Keep this screen open while you hold it.</ng-container> }
              </p>
            </div>
          }

          @if (hasCode()) {
            <form [formGroup]="form" (ngSubmit)="submitCode()" class="panel flex flex-col gap-2 p-4" novalidate>
              <label hlmLabel for="capture-code" class="font-semibold" i18n>Capture code</label>
              <input
                hlmInput
                id="capture-code"
                formControlName="code"
                class="num h-14 text-center text-2xl font-bold tracking-[0.18em] uppercase"
                autocomplete="off"
                autocapitalize="characters"
                autocorrect="off"
                spellcheck="false"
                inputmode="text"
                enterkeyhint="send"
                maxlength="64"
                [attr.aria-invalid]="codeError() ? 'true' : null"
                [attr.aria-describedby]="codeError() ? 'capture-code-error' : 'capture-code-hint'"
              />
              @if (codeError()) {
                <p id="capture-code-error" class="field-error">{{ codeError() }}</p>
              } @else {
                <p id="capture-code-hint" class="text-xs text-muted-foreground" i18n>The code is written on the objective. Capitals, spaces and dashes do not matter.</p>
              }
              <button hlmBtn type="submit" class="h-14 text-base font-bold" [disabled]="attempt.state() === 'pending' || !!block()">
                @if (attempt.state() === 'pending' && attempt.objectiveId() === o.id) {
                  <ng-icon name="lucideLoader2" size="18" class="animate-spin" aria-hidden="true" /> <ng-container i18n>Checking…</ng-container>
                } @else {
                  <ng-icon name="lucideKeyRound" size="18" aria-hidden="true" /> <ng-container i18n>Capture objective</ng-container>
                }
              </button>
            </form>
          }

          @if (hasQr()) {
            <a
              hlmBtn
              [variant]="hasCode() ? 'outline' : 'default'"
              class="h-14 text-base font-bold"
              [class.pointer-events-none]="!!block()"
              [class.opacity-50]="!!block()"
              [attr.aria-disabled]="block() ? 'true' : null"
              [attr.tabindex]="block() ? -1 : null"
              [routerLink]="scanLink()"
              [queryParams]="{ objective: o.id }"
            >
              <ng-icon name="lucideScanQrCode" size="20" aria-hidden="true" /> <ng-container i18n>Scan the QR code</ng-container>
            </a>
          }

          <ah-capture-feedback [attempt]="attempt" [objectiveName]="o.name" (retry)="retry()" />
        </section>

        <!-- Briefing -->
        @if (o.description || o.instructions || o.imageUrl || o.documentUrl) {
          <section class="panel flex flex-col gap-3 p-4" aria-labelledby="brief-title">
            <h3 id="brief-title" class="label-caps" i18n>Briefing</h3>
            @if (o.description) {
              <p class="whitespace-pre-line">{{ o.description }}</p>
            }
            @if (o.instructions) {
              <div>
                <p class="label-caps" i18n>Instructions</p>
                <p class="mt-1 whitespace-pre-line">{{ o.instructions }}</p>
              </div>
            }
            @if (o.imageUrl) {
              <img [src]="o.imageUrl" alt="Photo of {{ o.name }}" i18n-alt class="max-h-72 w-full rounded-sm object-cover" loading="lazy" />
            }
            @if (o.documentUrl) {
              <a hlmBtn variant="outline" class="h-12 self-start" [href]="o.documentUrl" target="_blank" rel="noopener">
                <ng-icon name="lucideFileText" size="18" aria-hidden="true" /> <ng-container i18n>Open briefing document</ng-container>
                <ng-icon name="lucideExternalLink" size="14" aria-hidden="true" />
              </a>
            }
          </section>
        }

        <!-- History -->
        <section class="flex flex-col gap-2" aria-labelledby="history-title">
          <h3 id="history-title" class="label-caps">
            <ng-container i18n>Capture history</ng-container>
            @if (captures().length) {
              · <span class="num">{{ captures().length }}</span>
            }
          </h3>
          @if (detailLoading() && !captures().length) {
            <ah-loading-skeleton [rows]="2" />
          } @else if (detailError() && !captures().length) {
            <ah-error-state [error]="detailError()" title="Could not load the history" (retry)="loadDetail()" i18n-title />
          } @else if (!captures().length) {
            <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground" i18n>Not captured yet.</p>
          } @else {
            <ol class="panel flex flex-col divide-y divide-border">
              @for (c of captures(); track c.id) {
                <li class="flex items-center gap-3 p-3 text-sm" [class.opacity-60]="c.revoked">
                  <span class="num w-12 shrink-0 font-semibold">{{ time(c.createdAt) }}</span>
                  <span class="min-w-0 flex-1">
                    <span class="flex flex-wrap items-center gap-x-2">
                      <ah-team-badge [team]="teamOf(c.teamId)" size="sm" [showIcon]="false" />
                      <span [class.line-through]="c.revoked">{{ c.nickname || txt.gameMaster }}</span>
                    </span>
                    <span class="text-xs text-muted-foreground">
                      {{ methodLabel(c.method) }}
                      @if (c.revoked) {
                        <ng-container i18n>· ✕ Revoked by the Game Master</ng-container>
                      }
                    </span>
                  </span>
                  <span class="num shrink-0 font-bold text-primary" [class.line-through]="c.revoked">+{{ c.points }}</span>
                </li>
              }
            </ol>
          }
        </section>
      } @else if (detailLoading() || store.loading()) {
        <ah-loading-skeleton [rows]="3" />
      } @else {
        <ah-error-state
          [error]="detailError()"
          title="Objective not available"
          [showRetry]="!!detailError()"
          (retry)="loadDetail()" i18n-title
        >
          <a hlmBtn variant="outline" class="tap" [routerLink]="listLink()" i18n>All objectives</a>
        </ah-error-state>
      }
    </div>
  `,
})
export class ObjectiveDetailsScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    codeOrQr: $localize`code or QR`,
    qr: $localize`QR`,
    code: $localize`code`,
    gameMaster: $localize`Game Master`,
  };

  readonly objectiveId = input.required<string>();

  protected readonly store = inject(LiveStore);
  private readonly tracker = inject(LocationTracker);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly session = inject(LiveSession);

  protected readonly attempt = new CaptureAttempt();
  protected readonly fmt = formatNumber;
  protected readonly dist = formatDistance;

  private readonly tick = nowSignal();
  private readonly serverNow = computed(() => this.tick() + this.store.serverOffsetMs());

  protected readonly form = new FormGroup({
    code: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  private readonly submitted = signal(false);
  private readonly codeValue = signal('');

  private readonly fetched = signal<Objective | null>(null);
  protected readonly captures = signal<Capture[]>([]);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal<ApiError | null>(null);

  protected readonly objective = computed(() => this.store.objectiveById().get(this.objectiveId()) ?? this.fetched());
  protected readonly myTeamId = computed(() => this.store.me()?.teamId ?? null);
  protected readonly fix = this.tracker.lastFix;
  protected readonly canAccrue = zoneCanAccrue;
  protected readonly geo = computed(() => this.tracker.geofence().find((g) => g.objectiveId === this.objectiveId()) ?? null);

  protected readonly listLink = computed(() => liveLink(this.store.eventId(), 'objectives'));
  protected readonly mapLink = computed(() => liveLink(this.store.eventId()));
  protected readonly scanLink = computed(() => liveLink(this.store.eventId(), 'scan'));

  protected readonly chip = computed(() => objectiveStatusChip(this.objective()?.status ?? 'inactive'));
  protected readonly typeLabel = computed(() => {
    const o = this.objective();
    return o ? OBJECTIVE_TYPE_LABELS[o.type] : '';
  });
  protected readonly owner = computed(() => {
    const id = this.objective()?.ownerTeamId;
    return id ? (this.store.teamById().get(id) ?? null) : null;
  });
  protected readonly hasCode = computed(() => !!this.objective()?.methods.includes('code'));
  protected readonly hasQr = computed(() => !!this.objective()?.methods.includes('qr'));
  protected readonly usesZone = computed(() => {
    const o = this.objective();
    return !!o && (o.methods.includes('geofence') || o.requireGeofence);
  });
  protected readonly contested = computed(() => {
    const o = this.objective();
    return !!o && (o.contested || o.status === 'contested' || !!this.geo()?.contested);
  });
  protected readonly sharingActive = computed(() => this.tracker.eventId() === this.store.eventId() && this.tracker.state() !== 'denied');


  protected readonly direction = computed(() => {
    const o = this.objective();
    return o ? bearingLabel(this.fix(), o) : null;
  });
  protected readonly distanceLabel = computed(() => {
    const o = this.objective();
    return o ? formatDistance(distanceFrom(this.fix(), o)) : '—';
  });
  protected readonly toEdge = computed(() => {
    const o = this.objective();
    const d = o ? distanceFrom(this.fix(), o) : null;
    return d === null || !o ? null : d - o.geofence.radiusM;
  });
  protected readonly fixAccuracy = computed(() => Math.round(this.fix()?.accuracy ?? 0));
  protected readonly accuracyTooLow = computed(() => {
    const o = this.objective();
    const f = this.fix();
    return !!o && !!f && this.usesZone() && o.geofence.maxAccuracyM > 0 && f.accuracy > o.geofence.maxAccuracyM;
  });
  /** Error comparable to the zone: players near the edge will drop in and out. */
  protected readonly roughForZone = computed(() => {
    const o = this.objective();
    const f = this.fix();
    return !!o && !!f && f.accuracy > o.geofence.radiusM / 2;
  });
  protected readonly holdLabel = computed(() => formatDuration((this.objective()?.geofence.durationSec ?? 0) * 1000));

  protected readonly rewards = computed(() => {
    const o = this.objective();
    const teamId = this.myTeamId();
    const custom = o && teamId ? o.rewards.perTeam?.[teamId] : undefined;
    return { points: custom?.points ?? o?.rewards.points ?? 0, currency: custom?.currency ?? o?.rewards.currency ?? 0, custom: !!custom };
  });

  protected readonly jamLeft = computed(() => remaining(this.objective()?.jammedUntil, this.serverNow()));
  protected readonly shieldLeft = computed(() => remaining(this.objective()?.shieldedUntil, this.serverNow()));

  /** Blocking reason that still applies now (time-based blocks expire locally before the next refresh). */
  protected readonly block = computed<CaptureBlockReason | null>(() => {
    const o = this.objective();
    if (!o || o.canCapture || !o.blockedReason) return null;
    const now = this.serverNow();
    switch (o.blockedReason) {
      case 'cooldown':
        return isFuture(o.cooldownUntil, now) ? 'cooldown' : null;
      case 'jammed':
        return isFuture(o.jammedUntil, now) ? 'jammed' : null;
      case 'shielded':
        return isFuture(o.shieldedUntil, now) ? 'shielded' : null;
      case 'geofence_required':
        return this.geo()?.armed ? null : 'geofence_required';
      case 'inactive':
        return o.availabilityStart && !isFuture(o.availabilityStart, now) && !(o.availabilityEnd && !isFuture(o.availabilityEnd, now))
          ? null
          : 'inactive';
      default:
        return o.blockedReason;
    }
  });

  protected readonly conditions = computed(() => {
    const o = this.objective();
    if (!o) return [];
    const now = this.serverNow();
    const list: { icon: string; text: string; time: string | null; tone: string }[] = [];
    if (o.availabilityStart && isFuture(o.availabilityStart, now)) {
      list.push({ icon: 'lucideClock', text: $localize`Opens at ${formatTime(o.availabilityStart)}:availabilityStart:`, time: remaining(o.availabilityStart, now), tone: 'text-warning' });
    }
    if (o.availabilityEnd) {
      const open = isFuture(o.availabilityEnd, now);
      list.push({
        icon: 'lucideHourglass',
        text: open ? $localize`Closes at ${formatTime(o.availabilityEnd)}:availabilityEnd:` : $localize`Closed at ${formatTime(o.availabilityEnd)}:availabilityEnd:`,
        time: open ? remaining(o.availabilityEnd, now) : null,
        tone: open ? 'text-warning' : 'text-muted-foreground',
      });
    }
    const cd = remaining(o.cooldownUntil, now);
    if (cd) list.push({ icon: 'lucideTimer', text: $localize`Cooling down — capturable again in`, time: cd, tone: 'text-warning' });
    const jam = this.jamLeft();
    if (jam) list.push({ icon: 'lucideAntenna', text: $localize`Jammed for your team by an enemy perk`, time: jam, tone: 'text-destructive' });
    const shield = this.shieldLeft();
    if (shield) {
      const by = o.shieldedTeamId ? this.store.teamById().get(o.shieldedTeamId)?.name : null;
      list.push({ icon: 'lucideShieldCheck', text: by ? $localize`Shielded by ${by}:by:` : $localize`Shielded`, time: shield, tone: 'text-nav' });
    }
    if (o.maxCaptures > 0) {
      list.push({ icon: 'lucideFlag', text: $localize`Captured ${o.captureCount}:captureCount: of ${o.maxCaptures}:maxCaptures: allowed times`, time: null, tone: 'text-muted-foreground' });
    }
    if (o.lastCapturedAt) {
      list.push({
        icon: 'lucideHistory',
        text: o.lastCapturedByNickname ? $localize`Last captured at ${formatTime(o.lastCapturedAt)}:time: by ${o.lastCapturedByNickname}:nickname:` : $localize`Last captured at ${formatTime(o.lastCapturedAt)}:time:`,
        time: null,
        tone: 'text-muted-foreground',
      });
    }
    return list;
  });

  protected readonly codeError = computed(() => {
    if (!this.submitted()) return null;
    return this.codeValue().trim() ? null : $localize`Enter the code written on the objective.`;
  });

  constructor() {
    this.form.controls.code.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => this.codeValue.set(v));

    // Tell the server which objective screen is open (some zones need it) and send a fresh fix now.
    effect(() => {
      const id = this.objectiveId();
      untracked(() => {
        this.tracker.screenObjectiveId.set(id);
        this.tracker.flushNow();
        this.attempt.reset(true);
        this.fetched.set(null);
        this.captures.set([]);
        void this.loadDetail();
      });
    });
    inject(DestroyRef).onDestroy(() => this.tracker.screenObjectiveId.set(null));

    // Refetch the history when the objective's capture state changes.
    let lastKey: string | null = null;
    effect(() => {
      const o = this.store.objectiveById().get(this.objectiveId());
      const key = o ? `${o.captureCount}|${o.lastCapturedAt}|${o.ownerTeamId}` : null;
      if (lastKey !== null && key !== null && key !== lastKey) untracked(() => void this.loadDetail());
      if (key !== null) lastKey = key;
    });
  }

  async loadDetail(): Promise<void> {
    const eventId = this.store.eventId();
    const id = this.objectiveId();
    if (!eventId) return;
    this.detailLoading.set(true);
    this.detailError.set(null);
    try {
      const res = await this.api.objective(eventId, id);
      if (id !== this.objectiveId()) return;
      this.fetched.set(res.objective);
      this.captures.set([...res.captures].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (e) {
      this.detailError.set(ApiError.from(e));
    } finally {
      this.detailLoading.set(false);
    }
  }

  protected async submitCode(): Promise<void> {
    this.submitted.set(true);
    const code = this.form.controls.code.value.trim();
    const o = this.objective();
    if (!code || !o || this.block()) return;
    const ok = await this.attempt.submit(o.id, { method: 'code', code });
    if (ok) {
      this.form.reset();
      this.submitted.set(false);
      void this.loadDetail();
    }
  }

  protected retry(): void {
    void this.submitCode();
  }

  protected enableSharing(): void {
    const id = this.store.eventId();
    if (id && this.session.isStopped(id)) {
      void this.router.navigate(liveLink(id, 'more'));
    } else {
      this.session.sheetOpen.set(true);
    }
  }

  protected blockLabel(r: CaptureBlockReason): string {
    return BLOCK_REASON_LABELS[r];
  }
  protected teamOf(id: string) {
    return this.store.teamById().get(id) ?? null;
  }
  protected methodLabel(m: Capture['method']): string {
    return METHOD_LABELS[m];
  }
  protected time(iso: string): string {
    return formatTime(iso);
  }
}
