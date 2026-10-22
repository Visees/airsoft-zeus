import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { LiveStore } from '../../core/live/live-store';
import { FixSource, LocationTracker, TrackerState } from '../../core/location/location-tracker.service';
import { ConnectivityService } from '../../core/net/connectivity.service';
import { ThemeService } from '../../core/theme/theme.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { formatRelative, formatTime } from '../../core/util/format';
import { playsIn } from '../../core/util/members';
import { AttachmentList } from '../../shared/attachments';
import { nowSignal } from '../../shared/game-timer';
import { ConnectionStatus, PreciseLocationHelp } from '../../shared/link-status';
import { LiveSession } from './live-session';

const TRACKER_LABELS: Record<TrackerState, string> = {
  idle: $localize`Not sharing`,
  requesting: $localize`Starting GPS…`,
  tracking: $localize`Sharing your location`,
  paused: $localize`Paused — the game is paused`,
  denied: $localize`Blocked by the browser`,
  unavailable: $localize`No GPS on this device`,
  error: $localize`GPS problem`,
};

const FLAG_LABELS: Record<string, string> = {
  future_timestamp: $localize`Device clock is ahead of the server`,
  too_old: $localize`Some positions arrived too late`,
  low_accuracy: $localize`GPS accuracy too low for the game`,
  speed: $localize`Movement looked too fast`,
  mock: $localize`A mock location app was detected`,
  stale: $localize`Position is stale`,
};

const FIX_SOURCE_LABELS: Record<FixSource, string> = {
  permission: $localize`:GPS fix source|:permission`,
  watch: $localize`:GPS fix source|:continuous`,
  poll: $localize`:GPS fix source|:one-off`,
};

/** Location sharing controls, sync status, rules, messages, links, theme, leave event. */
@Component({
  selector: 'zeus-live-more',
  imports: [RouterLink, NgIcon, HlmButton, ConnectionStatus, PreciseLocationHelp, AttachmentList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-4 pb-8">
      <h2 class="text-2xl uppercase" i18n>More</h2>

      <!-- Emergency -->
      @if (gameMasters().length) {
        <section class="rounded-md border-2 border-destructive/70 p-4" aria-labelledby="emergency-title">
          <h3 id="emergency-title" class="flex items-center gap-2 font-bold text-destructive">
            <ng-icon name="lucideSiren" size="18" aria-hidden="true" /> <ng-container i18n>In an emergency</ng-container>
          </h3>
          <p class="mt-1 text-sm" i18n>
            Stop playing, call “blind man” / “medic” as the event rules say, and reach a Game Master:
            <span class="font-bold">{{ gameMasters() }}</span>.
          </p>
        </section>
      }

      <!-- Location sharing -->
      <section class="panel flex flex-col gap-3 p-4" aria-labelledby="loc-title">
        <div class="flex items-center justify-between gap-2">
          <h3 id="loc-title" class="label-caps" i18n>Location sharing</h3>
          <span class="text-sm font-bold" [class]="sharingTone()">{{ sharingLabel() }}</span>
        </div>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt class="text-xs text-muted-foreground" i18n>Accuracy</dt>
            <dd class="num text-lg font-bold">{{ accuracy() }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground" i18n>Last fix</dt>
            <dd class="num font-semibold">{{ lastFixLabel() }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground" i18n>Last sent</dt>
            <dd class="num font-semibold">{{ lastSentLabel() }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground" i18n>Waiting to send</dt>
            <dd class="num text-lg font-bold" [class.text-warning]="tracker.pendingCount() > 0">{{ tracker.pendingCount() }}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-xs text-muted-foreground" i18n>Screen</dt>
            <dd class="font-semibold" [class.text-warning]="tracker.wakeLockUnreliable">
              {{ tracker.wakeLockUnreliable ? txt.thisIphoneCanT : tracker.wakeLockActive() ? txt.keptAwakeWhileSharing : txt.mayTurnOffKeep }}
            </dd>
          </div>
          @if (tracker.lastError() && mine()) {
            <div class="col-span-2">
              <dt class="text-xs text-muted-foreground" i18n>Last problem</dt>
              <dd class="text-warning">{{ tracker.lastError() }}</dd>
            </div>
          }
        </dl>
        @if (mine() && tracker.approximateOnly()) {
          <zeus-precise-location-help />
        }
        @if (flags().length) {
          <ul class="flex flex-col gap-1 text-sm text-warning">
            @for (f of flags(); track f) {
              <li>◐ {{ f }}</li>
            }
          </ul>
        }
        @if (mine()) {
          <details class="rounded-sm border border-border text-xs">
            <summary class="flex min-h-10 cursor-pointer items-center px-3 font-semibold" i18n>GPS diagnostics</summary>
            <div class="flex flex-col gap-2 border-t border-border px-3 py-2">
              <p i18n>High accuracy requested: <span class="font-bold">{{ highAccuracyLabel() }}</span></p>
              @if (fixRows().length) {
                <table class="num w-full text-left">
                  <thead class="text-muted-foreground">
                    <tr>
                      <th class="font-normal" i18n>Received</th>
                      <th class="font-normal" i18n>Source</th>
                      <th class="font-normal" i18n>Accuracy</th>
                      <th class="font-normal" i18n>Fix age</th>
                      <th class="font-normal" i18n>Kept</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (r of fixRows(); track $index) {
                      <tr [class.text-muted-foreground]="!r.accepted">
                        <td>-{{ r.receivedAgoS }} s</td>
                        <td>{{ r.source }}</td>
                        <td>±{{ r.accuracy }} m</td>
                        <td>{{ r.ageS }} s</td>
                        <td>{{ r.accepted ? txt.yes : txt.no }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              } @else {
                <p class="text-muted-foreground" i18n>No positions received yet.</p>
              }
            </div>
          </details>
        }
        @if (!isPlayer()) {
          <p class="text-sm text-muted-foreground" i18n>Only players share their location. Game Masters see players from the control center.</p>
        } @else if (!consented()) {
          <p class="text-sm text-muted-foreground" i18n>You have not agreed to share your location in this event.</p>
          <button hlmBtn type="button" class="h-12" (click)="session.sheetOpen.set(true)">
            <ng-icon name="lucideLocateFixed" size="18" aria-hidden="true" /> <ng-container i18n>Share my location</ng-container>
          </button>
        } @else if (stopped()) {
          <p class="text-sm text-muted-foreground" i18n>You stopped sharing. Teammates and the Game Master cannot see you.</p>
          <button hlmBtn type="button" class="h-12" (click)="resume()">
            <ng-icon name="lucideLocateFixed" size="18" aria-hidden="true" /> <ng-container i18n>Resume sharing</ng-container>
          </button>
        } @else if (tracker.state() === 'denied') {
          <button hlmBtn variant="outline" type="button" class="h-12" (click)="session.sheetOpen.set(true)" i18n>How to allow location</button>
        } @else {
          @if (!running()) {
            <p class="text-sm text-muted-foreground" i18n>Sharing runs only while the game is live.</p>
          }
          <button hlmBtn variant="destructive" type="button" class="h-12" (click)="stopSharing()">
            <ng-icon name="lucideLocateOff" size="18" aria-hidden="true" /> <ng-container i18n>Stop sharing my location</ng-container>
          </button>
        }
      </section>

      <!-- Sync -->
      <section class="panel flex flex-col gap-2 p-4" aria-labelledby="sync-title">
        <h3 id="sync-title" class="label-caps" i18n>Connection</h3>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <zeus-connection-status [showSync]="false" />
          <span class="text-sm" i18n>Last sync <span class="num font-semibold">{{ lastSyncLabel() }}</span></span>
        </div>
        @if (store.fromCache()) {
          <p class="text-sm text-warning" i18n>Showing data saved on this phone. It refreshes when the signal returns.</p>
        }
        <button hlmBtn variant="outline" type="button" class="h-12" (click)="store.reload()" [disabled]="store.loading()">
          <ng-icon name="lucideRefreshCw" size="18" aria-hidden="true" /> {{ store.loading() ? txt.refreshing : txt.refreshNow }}
        </button>
      </section>

      <!-- Rules -->
      @if (store.event(); as ev) {
        <section class="flex flex-col gap-2" aria-labelledby="rules-title">
          <h3 id="rules-title" class="label-caps" i18n>Rules</h3>
          @for (r of rules(); track r.title) {
            <details class="panel group">
              <summary class="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 font-semibold">
                {{ r.title }}
                <ng-icon name="lucideChevronDown" size="18" class="transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p class="border-t border-border px-4 py-3 text-sm whitespace-pre-line">{{ r.text }}</p>
            </details>
          } @empty {
            <p class="text-sm text-muted-foreground" i18n>The Game Master has not written rules for this event.</p>
          }
          @if (fromCacheNote()) {
            <p class="text-xs text-muted-foreground" i18n>Saved on this phone, readable without signal.</p>
          }
        </section>

        @if (attachments().length) {
          <section class="flex flex-col gap-2" aria-labelledby="att-title">
            <h3 id="att-title" class="label-caps" i18n>Attachments · <span class="num">{{ attachments().length }}</span></h3>
            <zeus-attachment-list [eventId]="ev.id" [attachments]="attachments()" />
          </section>
        }
      }

      <!-- Announcements -->
      <section class="flex flex-col gap-2" aria-labelledby="ann-title">
        <h3 id="ann-title" class="label-caps" i18n>Announcements · <span class="num">{{ store.announcements().length }}</span></h3>
        @if (!store.announcements().length) {
          <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground" i18n>No announcements yet.</p>
        } @else {
          <ul class="panel flex flex-col divide-y divide-border">
            @for (a of store.announcements(); track a.id) {
              <li class="p-3">
                <p class="label-caps">
                  @if (a.priority === 'emergency') {
                    <span class="text-destructive" i18n>Emergency</span> ·
                  } @else if (a.priority === 'high') {
                    <span class="text-warning" i18n>Important</span> ·
                  }
                  {{ a.scope === 'team' ? txt.team : a.scope === 'player' ? txt.toYou : txt.everyone }} · <span class="num">{{ time(a.createdAt) }}</span>
                </p>
                <p class="font-bold">{{ a.title }}</p>
                @if (a.body) {
                  <p class="text-sm whitespace-pre-line">{{ a.body }}</p>
                }
              </li>
            }
          </ul>
        }
      </section>

      <!-- Links -->
      <nav class="panel flex flex-col divide-y divide-border" aria-label="Other pages" i18n-aria-label>
        <a [routerLink]="['/events', eventId()]" class="flex min-h-12 items-center gap-3 px-4 font-semibold hover:bg-muted">
          <ng-icon name="lucideInfo" size="18" aria-hidden="true" /> <ng-container i18n>Event details</ng-container>
          <ng-icon name="lucideChevronRight" size="18" class="ml-auto text-muted-foreground" aria-hidden="true" />
        </a>
        <a routerLink="/notifications" class="flex min-h-12 items-center gap-3 px-4 font-semibold hover:bg-muted">
          <ng-icon name="lucideBell" size="18" aria-hidden="true" /> <ng-container i18n>Notifications</ng-container>
          <ng-icon name="lucideChevronRight" size="18" class="ml-auto text-muted-foreground" aria-hidden="true" />
        </a>
        <a [routerLink]="['/events', eventId(), 'results']" class="flex min-h-12 items-center gap-3 px-4 font-semibold hover:bg-muted">
          <ng-icon name="lucideTrophy" size="18" aria-hidden="true" /> <ng-container i18n>Results</ng-container>
          <ng-icon name="lucideChevronRight" size="18" class="ml-auto text-muted-foreground" aria-hidden="true" />
        </a>
        @if (gameMaster()) {
          <a [routerLink]="['/gm/events', eventId(), 'control']" class="flex min-h-12 items-center gap-3 px-4 font-semibold hover:bg-muted">
            <ng-icon name="lucideLayoutDashboard" size="18" aria-hidden="true" /> <ng-container i18n>Control center</ng-container>
            <ng-icon name="lucideChevronRight" size="18" class="ml-auto text-muted-foreground" aria-hidden="true" />
          </a>
        }
      </nav>

      <!-- Theme -->
      <section class="flex flex-col gap-2" aria-labelledby="theme-title">
        <h3 id="theme-title" class="label-caps" i18n>Display</h3>
        <div class="grid grid-cols-2 gap-2" role="group" aria-labelledby="theme-title">
          <button hlmBtn [variant]="theme.isDark() ? 'default' : 'outline'" type="button" class="h-12" [attr.aria-pressed]="theme.isDark()" (click)="theme.setPreference('dark')">
            <ng-icon name="lucideMoon" size="18" aria-hidden="true" /> <ng-container i18n>Dark</ng-container>
          </button>
          <button hlmBtn [variant]="!theme.isDark() ? 'default' : 'outline'" type="button" class="h-12" [attr.aria-pressed]="!theme.isDark()" (click)="theme.setPreference('light')">
            <ng-icon name="lucideSun" size="18" aria-hidden="true" /> <ng-container i18n>Light</ng-container>
          </button>
        </div>
        <p class="text-xs text-muted-foreground" i18n>Light is easier to read in direct sun; dark saves battery and night vision.</p>
      </section>

      <!-- Leave -->
      @if (!gameMaster()) {
        <section class="flex flex-col gap-2" aria-labelledby="leave-title">
          <h3 id="leave-title" class="label-caps" i18n>Leave</h3>
          <button hlmBtn variant="destructive" type="button" class="h-12" (click)="leave()" [disabled]="leaving()">
            <ng-icon name="lucideLogOut" size="18" aria-hidden="true" /> {{ leaving() ? txt.leaving : txt.leaveEvent }}
          </button>
        </section>
      }
    </div>
  `,
})
export class LiveMoreScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    thisIphoneCanT: $localize`This iPhone can’t keep it on — set Settings › Display & Brightness › Auto-Lock to Never`,
    keptAwakeWhileSharing: $localize`Kept awake while sharing`,
    mayTurnOffKeep: $localize`May turn off — keep the app open`,
    refreshing: $localize`Refreshing…`,
    refreshNow: $localize`Refresh now`,
    team: $localize`Team`,
    toYou: $localize`To you`,
    everyone: $localize`Everyone`,
    leaving: $localize`Leaving…`,
    leaveEvent: $localize`Leave event`,
    yes: $localize`yes`,
    no: $localize`no`,
  };

  protected readonly store = inject(LiveStore);
  protected readonly tracker = inject(LocationTracker);
  protected readonly session = inject(LiveSession);
  protected readonly theme = inject(ThemeService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  private readonly tick = nowSignal(5000);
  protected readonly leaving = signal(false);

  protected readonly eventId = computed(() => this.store.eventId() ?? '');
  protected readonly isPlayer = computed(() => playsIn(this.store.me()));
  /** Also true for a Game Master playing on a team (the player view reports isGm false then). */
  protected readonly gameMaster = computed(() => this.store.isGm() || this.store.me()?.role === 'gm');
  protected readonly mine = computed(() => this.tracker.eventId() === this.store.eventId());
  protected readonly consented = computed(() => !!this.store.me()?.trackingConsented || this.session.hasConsented(this.store.eventId()));
  protected readonly stopped = computed(() => this.session.isStopped(this.store.eventId()));
  protected readonly running = computed(() => {
    const s = this.store.clock()?.status;
    return s === 'live' || s === 'paused';
  });

  protected readonly sharingLabel = computed(() => {
    if (!this.consented()) return $localize`Not agreed`;
    if (this.stopped()) return $localize`Stopped by you`;
    const s = this.tracker.state();
    if (s === 'denied' || s === 'unavailable') return TRACKER_LABELS[s];
    if (!this.mine()) return this.running() ? $localize`Starting…` : $localize`Starts with the game`;
    return TRACKER_LABELS[s];
  });
  protected readonly sharingTone = computed(() => {
    const s = this.tracker.state();
    if (s === 'denied' || s === 'unavailable') return 'text-destructive';
    if (this.mine() && s === 'tracking' && !this.stopped()) return 'text-nav';
    return 'text-warning';
  });

  protected readonly accuracy = computed(() => {
    const f = this.tracker.lastFix();
    return f ? `±${Math.round(f.accuracy)} m` : '—';
  });
  protected readonly lastFixLabel = computed(() => {
    this.tick();
    const f = this.tracker.lastFix();
    return f ? formatRelative(new Date(f.timestamp).toISOString()) : $localize`none`;
  });
  protected readonly lastSentLabel = computed(() => {
    this.tick();
    const at = this.tracker.lastSentAt();
    return at ? formatRelative(new Date(at).toISOString()) : $localize`never`;
  });
  protected readonly lastSyncLabel = computed(() => {
    this.tick();
    const at = this.connectivity.lastSyncAt();
    return at ? formatRelative(new Date(at).toISOString()) : $localize`never`;
  });
  protected readonly highAccuracyLabel = computed(() => {
    const h = this.tracker.highAccuracyRequested();
    return h === null ? '—' : h ? this.txt.yes : this.txt.no;
  });
  protected readonly fixRows = computed(() => {
    const now = this.tick();
    return this.tracker.fixLog().map((e) => ({
      receivedAgoS: Math.max(0, Math.round((now - e.receivedAt) / 1000)),
      source: FIX_SOURCE_LABELS[e.source],
      accuracy: Math.round(e.accuracy),
      ageS: Math.round(e.ageMs / 1000),
      accepted: e.accepted,
    }));
  });
  protected readonly flags = computed(() => (this.mine() ? this.tracker.lastFlags().map((f) => FLAG_LABELS[f] ?? f) : []));

  protected readonly gameMasters = computed(() =>
    (this.store.event()?.gameMasters ?? []).map((g) => g.nickname).join(', '),
  );

  /** `?? []`: an event saved on the phone by an older version has no attachments field. */
  protected readonly attachments = computed(() => this.store.event()?.attachments ?? []);
  protected readonly rules = computed(() => {
    const ev = this.store.event();
    if (!ev) return [];
    return [
      { title: $localize`Game rules`, text: ev.rules },
      { title: $localize`Scenario rules`, text: ev.customModeRules ?? '' },
      { title: $localize`Safety rules`, text: ev.safetyRules },
      { title: $localize`Chrono and FPS limits`, text: ev.chronoInfo },
      { title: $localize`Required equipment`, text: ev.requiredEquipment },
    ].filter((r) => r.text?.trim());
  });
  protected readonly fromCacheNote = computed(() => this.rules().length > 0);

  protected async stopSharing(): Promise<void> {
    const id = this.store.eventId();
    if (!id) return;
    const ok = await this.confirm.ask({
      title: $localize`Stop sharing your location?`,
      consequences: [
        $localize`Teammates and the Game Master will stop seeing you`,
        $localize`Objectives that need you inside a zone cannot be captured`,
        $localize`You can resume sharing here at any time`,
      ],
      confirmLabel: $localize`Stop sharing`,
      destructive: true,
    });
    if (!ok) return;
    this.session.setStopped(id, true);
    if (this.tracker.eventId() === id) this.tracker.stop();
    else void this.api.stopTracking(id).catch(() => undefined);
    this.toast.info($localize`Location sharing stopped`);
  }

  protected resume(): void {
    const id = this.store.eventId();
    if (!id) return;
    this.session.setStopped(id, false); // the live shell starts the tracker again
    this.toast.success(this.running() ? $localize`Sharing your location again` : $localize`Sharing will start with the game`);
  }

  protected async leave(): Promise<void> {
    const id = this.store.eventId();
    const ev = this.store.event();
    if (!id || !ev) return;
    const ok = await this.confirm.ask({
      title: $localize`Leave ${ev.name}:name:?`,
      consequences: [
        $localize`You stop playing and sharing your location`,
        $localize`Your team loses you as a member; your points so far stay with the team`,
        ev.requiresApproval ? $localize`To come back you must ask to join again and be approved` : $localize`To come back you must join again`,
      ],
      confirmLabel: $localize`Leave event`,
      destructive: true,
    });
    if (!ok) return;
    this.leaving.set(true);
    try {
      await this.api.leaveEvent(id);
      if (this.tracker.eventId() === id) this.tracker.stop();
      this.toast.success($localize`You left ${ev.name}:name:`);
      void this.router.navigate(['/home']);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.leaving.set(false);
    }
  }

  protected time(iso: string): string {
    return formatTime(iso);
  }
}
