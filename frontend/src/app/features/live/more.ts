import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { LiveStore } from '../../core/live/live-store';
import { LocationTracker, TrackerState } from '../../core/location/location-tracker.service';
import { ConnectivityService } from '../../core/net/connectivity.service';
import { ThemeService } from '../../core/theme/theme.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { formatRelative, formatTime } from '../../core/util/format';
import { nowSignal } from '../../shared/game-timer';
import { ConnectionStatus } from '../../shared/link-status';
import { LiveSession } from './live-session';

const TRACKER_LABELS: Record<TrackerState, string> = {
  idle: 'Not sharing',
  requesting: 'Starting GPS…',
  tracking: 'Sharing your location',
  paused: 'Paused — the game is paused',
  denied: 'Blocked by the browser',
  unavailable: 'No GPS on this device',
  error: 'GPS problem',
};

const FLAG_LABELS: Record<string, string> = {
  future_timestamp: 'Device clock is ahead of the server',
  too_old: 'Some positions arrived too late',
  low_accuracy: 'GPS accuracy too low for the game',
  speed: 'Movement looked too fast',
  mock: 'A mock location app was detected',
  stale: 'Position is stale',
};

/** Location sharing controls, sync status, rules, messages, links, theme, leave event. */
@Component({
  selector: 'zeus-live-more',
  imports: [RouterLink, NgIcon, HlmButton, ConnectionStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-4 pb-8">
      <h2 class="text-2xl uppercase">More</h2>

      <!-- Emergency -->
      @if (gameMasters().length) {
        <section class="rounded-md border-2 border-destructive/70 p-4" aria-labelledby="emergency-title">
          <h3 id="emergency-title" class="flex items-center gap-2 font-bold text-destructive">
            <ng-icon name="lucideSiren" size="18" aria-hidden="true" /> In an emergency
          </h3>
          <p class="mt-1 text-sm">
            Stop playing, call “blind man” / “medic” as the event rules say, and reach a Game Master:
            <span class="font-bold">{{ gameMasters() }}</span>.
          </p>
        </section>
      }

      <!-- Location sharing -->
      <section class="panel flex flex-col gap-3 p-4" aria-labelledby="loc-title">
        <div class="flex items-center justify-between gap-2">
          <h3 id="loc-title" class="label-caps">Location sharing</h3>
          <span class="text-sm font-bold" [class]="sharingTone()">{{ sharingLabel() }}</span>
        </div>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt class="text-xs text-muted-foreground">Accuracy</dt>
            <dd class="num text-lg font-bold">{{ accuracy() }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">Last fix</dt>
            <dd class="num font-semibold">{{ lastFixLabel() }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">Last sent</dt>
            <dd class="num font-semibold">{{ lastSentLabel() }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">Waiting to send</dt>
            <dd class="num text-lg font-bold" [class.text-warning]="tracker.pendingCount() > 0">{{ tracker.pendingCount() }}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-xs text-muted-foreground">Screen</dt>
            <dd class="font-semibold">{{ tracker.wakeLockActive() ? 'Kept awake while sharing' : 'May turn off — keep the app open' }}</dd>
          </div>
          @if (tracker.lastError() && mine()) {
            <div class="col-span-2">
              <dt class="text-xs text-muted-foreground">Last problem</dt>
              <dd class="text-warning">{{ tracker.lastError() }}</dd>
            </div>
          }
        </dl>
        @if (flags().length) {
          <ul class="flex flex-col gap-1 text-sm text-warning">
            @for (f of flags(); track f) {
              <li>◐ {{ f }}</li>
            }
          </ul>
        }
        @if (!isPlayer()) {
          <p class="text-sm text-muted-foreground">Only players share their location. Game Masters see players from the control center.</p>
        } @else if (!consented()) {
          <p class="text-sm text-muted-foreground">You have not agreed to share your location in this event.</p>
          <button hlmBtn type="button" class="h-12" (click)="session.sheetOpen.set(true)">
            <ng-icon name="lucideLocateFixed" size="18" aria-hidden="true" /> Share my location
          </button>
        } @else if (stopped()) {
          <p class="text-sm text-muted-foreground">You stopped sharing. Teammates and the Game Master cannot see you.</p>
          <button hlmBtn type="button" class="h-12" (click)="resume()">
            <ng-icon name="lucideLocateFixed" size="18" aria-hidden="true" /> Resume sharing
          </button>
        } @else if (tracker.state() === 'denied') {
          <button hlmBtn variant="outline" type="button" class="h-12" (click)="session.sheetOpen.set(true)">How to allow location</button>
        } @else {
          @if (!running()) {
            <p class="text-sm text-muted-foreground">Sharing runs only while the game is live.</p>
          }
          <button hlmBtn variant="destructive" type="button" class="h-12" (click)="stopSharing()">
            <ng-icon name="lucideLocateOff" size="18" aria-hidden="true" /> Stop sharing my location
          </button>
        }
      </section>

      <!-- Sync -->
      <section class="panel flex flex-col gap-2 p-4" aria-labelledby="sync-title">
        <h3 id="sync-title" class="label-caps">Connection</h3>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <zeus-connection-status [showSync]="false" />
          <span class="text-sm">Last sync <span class="num font-semibold">{{ lastSyncLabel() }}</span></span>
        </div>
        @if (store.fromCache()) {
          <p class="text-sm text-warning">Showing data saved on this phone. It refreshes when the signal returns.</p>
        }
        <button hlmBtn variant="outline" type="button" class="h-12" (click)="store.reload()" [disabled]="store.loading()">
          <ng-icon name="lucideRefreshCw" size="18" aria-hidden="true" /> {{ store.loading() ? 'Refreshing…' : 'Refresh now' }}
        </button>
      </section>

      <!-- Rules -->
      @if (store.event(); as ev) {
        <section class="flex flex-col gap-2" aria-labelledby="rules-title">
          <h3 id="rules-title" class="label-caps">Rules</h3>
          @for (r of rules(); track r.title) {
            <details class="panel group">
              <summary class="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 font-semibold">
                {{ r.title }}
                <ng-icon name="lucideChevronDown" size="18" class="transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p class="border-t border-border px-4 py-3 text-sm whitespace-pre-line">{{ r.text }}</p>
            </details>
          } @empty {
            <p class="text-sm text-muted-foreground">The Game Master has not written rules for this event.</p>
          }
          @if (fromCacheNote()) {
            <p class="text-xs text-muted-foreground">Saved on this phone, readable without signal.</p>
          }
        </section>
      }

      <!-- Announcements -->
      <section class="flex flex-col gap-2" aria-labelledby="ann-title">
        <h3 id="ann-title" class="label-caps">Announcements · <span class="num">{{ store.announcements().length }}</span></h3>
        @if (!store.announcements().length) {
          <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No announcements yet.</p>
        } @else {
          <ul class="panel flex flex-col divide-y divide-border">
            @for (a of store.announcements(); track a.id) {
              <li class="p-3">
                <p class="label-caps">
                  @if (a.priority === 'emergency') {
                    <span class="text-destructive">Emergency</span> ·
                  } @else if (a.priority === 'high') {
                    <span class="text-warning">Important</span> ·
                  }
                  {{ a.scope === 'team' ? 'Team' : a.scope === 'player' ? 'To you' : 'Everyone' }} · <span class="num">{{ time(a.createdAt) }}</span>
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
      <nav class="panel flex flex-col divide-y divide-border" aria-label="Other pages">
        <a [routerLink]="['/events', eventId()]" class="flex min-h-12 items-center gap-3 px-4 font-semibold hover:bg-muted">
          <ng-icon name="lucideInfo" size="18" aria-hidden="true" /> Event details
          <ng-icon name="lucideChevronRight" size="18" class="ml-auto text-muted-foreground" aria-hidden="true" />
        </a>
        <a routerLink="/notifications" class="flex min-h-12 items-center gap-3 px-4 font-semibold hover:bg-muted">
          <ng-icon name="lucideBell" size="18" aria-hidden="true" /> Notifications
          <ng-icon name="lucideChevronRight" size="18" class="ml-auto text-muted-foreground" aria-hidden="true" />
        </a>
        <a [routerLink]="['/events', eventId(), 'results']" class="flex min-h-12 items-center gap-3 px-4 font-semibold hover:bg-muted">
          <ng-icon name="lucideTrophy" size="18" aria-hidden="true" /> Results
          <ng-icon name="lucideChevronRight" size="18" class="ml-auto text-muted-foreground" aria-hidden="true" />
        </a>
        @if (store.isGm()) {
          <a [routerLink]="['/gm/events', eventId(), 'control']" class="flex min-h-12 items-center gap-3 px-4 font-semibold hover:bg-muted">
            <ng-icon name="lucideLayoutDashboard" size="18" aria-hidden="true" /> Control center
            <ng-icon name="lucideChevronRight" size="18" class="ml-auto text-muted-foreground" aria-hidden="true" />
          </a>
        }
      </nav>

      <!-- Theme -->
      <section class="flex flex-col gap-2" aria-labelledby="theme-title">
        <h3 id="theme-title" class="label-caps">Display</h3>
        <div class="grid grid-cols-2 gap-2" role="group" aria-labelledby="theme-title">
          <button hlmBtn [variant]="theme.isDark() ? 'default' : 'outline'" type="button" class="h-12" [attr.aria-pressed]="theme.isDark()" (click)="theme.setPreference('dark')">
            <ng-icon name="lucideMoon" size="18" aria-hidden="true" /> Dark
          </button>
          <button hlmBtn [variant]="!theme.isDark() ? 'default' : 'outline'" type="button" class="h-12" [attr.aria-pressed]="!theme.isDark()" (click)="theme.setPreference('light')">
            <ng-icon name="lucideSun" size="18" aria-hidden="true" /> Light
          </button>
        </div>
        <p class="text-xs text-muted-foreground">Light is easier to read in direct sun; dark saves battery and night vision.</p>
      </section>

      <!-- Leave -->
      @if (!store.isGm()) {
        <section class="flex flex-col gap-2" aria-labelledby="leave-title">
          <h3 id="leave-title" class="label-caps">Leave</h3>
          <button hlmBtn variant="destructive" type="button" class="h-12" (click)="leave()" [disabled]="leaving()">
            <ng-icon name="lucideLogOut" size="18" aria-hidden="true" /> {{ leaving() ? 'Leaving…' : 'Leave event' }}
          </button>
        </section>
      }
    </div>
  `,
})
export class LiveMoreScreen {
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
  protected readonly isPlayer = computed(() => this.store.me()?.role === 'player' && this.store.me()?.status === 'approved');
  protected readonly mine = computed(() => this.tracker.eventId() === this.store.eventId());
  protected readonly consented = computed(() => !!this.store.me()?.trackingConsented || this.session.hasConsented(this.store.eventId()));
  protected readonly stopped = computed(() => this.session.isStopped(this.store.eventId()));
  protected readonly running = computed(() => {
    const s = this.store.clock()?.status;
    return s === 'live' || s === 'paused';
  });

  protected readonly sharingLabel = computed(() => {
    if (!this.consented()) return 'Not agreed';
    if (this.stopped()) return 'Stopped by you';
    const s = this.tracker.state();
    if (s === 'denied' || s === 'unavailable') return TRACKER_LABELS[s];
    if (!this.mine()) return this.running() ? 'Starting…' : 'Starts with the game';
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
    return f ? formatRelative(new Date(f.timestamp).toISOString()) : 'none';
  });
  protected readonly lastSentLabel = computed(() => {
    this.tick();
    const at = this.tracker.lastSentAt();
    return at ? formatRelative(new Date(at).toISOString()) : 'never';
  });
  protected readonly lastSyncLabel = computed(() => {
    this.tick();
    const at = this.connectivity.lastSyncAt();
    return at ? formatRelative(new Date(at).toISOString()) : 'never';
  });
  protected readonly flags = computed(() => (this.mine() ? this.tracker.lastFlags().map((f) => FLAG_LABELS[f] ?? f) : []));

  protected readonly gameMasters = computed(() =>
    (this.store.event()?.gameMasters ?? []).map((g) => g.nickname).join(', '),
  );

  protected readonly rules = computed(() => {
    const ev = this.store.event();
    if (!ev) return [];
    return [
      { title: 'Game rules', text: ev.rules },
      { title: 'Scenario rules', text: ev.customModeRules ?? '' },
      { title: 'Safety rules', text: ev.safetyRules },
      { title: 'Chrono and FPS limits', text: ev.chronoInfo },
      { title: 'Required equipment', text: ev.requiredEquipment },
    ].filter((r) => r.text?.trim());
  });
  protected readonly fromCacheNote = computed(() => this.rules().length > 0);

  protected async stopSharing(): Promise<void> {
    const id = this.store.eventId();
    if (!id) return;
    const ok = await this.confirm.ask({
      title: 'Stop sharing your location?',
      consequences: [
        'Teammates and the Game Master will stop seeing you',
        'Objectives that need you inside a zone cannot be captured',
        'You can resume sharing here at any time',
      ],
      confirmLabel: 'Stop sharing',
      destructive: true,
    });
    if (!ok) return;
    this.session.setStopped(id, true);
    if (this.tracker.eventId() === id) this.tracker.stop();
    else void this.api.stopTracking(id).catch(() => undefined);
    this.toast.info('Location sharing stopped');
  }

  protected resume(): void {
    const id = this.store.eventId();
    if (!id) return;
    this.session.setStopped(id, false); // the live shell starts the tracker again
    this.toast.success(this.running() ? 'Sharing your location again' : 'Sharing will start with the game');
  }

  protected async leave(): Promise<void> {
    const id = this.store.eventId();
    const ev = this.store.event();
    if (!id || !ev) return;
    const ok = await this.confirm.ask({
      title: `Leave ${ev.name}?`,
      consequences: [
        'You stop playing and sharing your location',
        'Your team loses you as a member; your points so far stay with the team',
        ev.requiresApproval ? 'To come back you must ask to join again and be approved' : 'To come back you must join again',
      ],
      confirmLabel: 'Leave event',
      destructive: true,
    });
    if (!ok) return;
    this.leaving.set(true);
    try {
      await this.api.leaveEvent(id);
      if (this.tracker.eventId() === id) this.tracker.stop();
      this.toast.success(`You left ${ev.name}`);
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
