import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, input, output, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { EventDetail, Member, PermissionState, Team, UpdateMyMembershipRequest } from '../../core/api/models';
import { LocationTracker } from '../../core/location/location-tracker.service';
import { PushService } from '../../core/push/push.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { PRECISION_LABELS } from '../../core/util/format';
import { TeamBadge } from '../../shared/team-badge';

type LocState = PermissionState | 'unsupported' | 'checking';
type BusyKind = 'rules' | 'location' | 'notifications' | 'consent' | 'team' | 'ready';

const ALLY_LABELS: Record<EventDetail['visibilityRules']['allies'], string> = {
  none: 'Nobody else on your side',
  squad: 'Your squad',
  team: 'Your team',
  alliance: 'Your team and allied teams',
};
const ENEMY_LABELS: Record<EventDetail['visibilityRules']['enemies'], string> = {
  never: 'Never',
  perk_only: 'Only while they run a perk such as UAV or recon',
  always: 'Always',
};

/** The player's pre-game checklist: rules, permissions, tracking consent, team, ready. */
@Component({
  selector: 'zeus-lobby-checklist',
  imports: [NgIcon, HlmButton, TeamBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let e = event();
    @let m = me();
    <section class="panel" aria-labelledby="checklist-title">
      <header class="flex items-center justify-between gap-2 border-b border-border p-4">
        <h2 id="checklist-title" class="label-caps">My checklist · <span class="num">{{ doneCount() }}/{{ totalCount() }}</span></h2>
        <div class="h-1.5 w-24 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Checklist progress" aria-valuemin="0" [attr.aria-valuemax]="totalCount()" [attr.aria-valuenow]="doneCount()">
          <div class="h-full bg-primary transition-[width] duration-200" [style.width.%]="(doneCount() / totalCount()) * 100"></div>
        </div>
      </header>

      <ol class="divide-y divide-border">
        <!-- 1. Rules -->
        <li class="flex flex-col gap-3 p-4">
          <div class="flex items-start gap-3">
            <span class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-sm font-bold" [class]="m.rulesAccepted ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'" aria-hidden="true">{{ m.rulesAccepted ? '✓' : '1' }}</span>
            <div class="min-w-0 flex-1">
              <h3 class="font-semibold">Read and accept the rules</h3>
              <p class="text-sm text-muted-foreground">{{ m.rulesAccepted ? 'Accepted. You can re-read them below at any time.' : 'Required before you can mark yourself ready.' }}</p>
            </div>
          </div>
          <details class="group rounded-sm border border-border bg-muted/40" [open]="!m.rulesAccepted">
            <summary class="tap flex cursor-pointer items-center justify-between gap-2 px-3 text-sm font-semibold">
              Rules and safety
              <ng-icon name="lucideChevronDown" size="16" class="transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div class="max-h-72 overflow-y-auto px-3 pb-3 text-sm">
              @if (e.rules.trim()) {
                <p class="label-caps mt-1 mb-1">Rules</p>
                <p class="whitespace-pre-line">{{ e.rules }}</p>
              }
              @if (e.safetyRules.trim()) {
                <p class="label-caps mt-3 mb-1 !text-warning">▲ Safety</p>
                <p class="whitespace-pre-line">{{ e.safetyRules }}</p>
              }
              @if (e.chronoInfo.trim()) {
                <p class="label-caps mt-3 mb-1">Chronograph and power limits</p>
                <p class="whitespace-pre-line">{{ e.chronoInfo }}</p>
              }
              @if (!e.rules.trim() && !e.safetyRules.trim()) {
                <p class="text-muted-foreground">The Game Master has not written rules for this event. They are explained at the briefing.</p>
              }
            </div>
          </details>
          @if (!m.rulesAccepted) {
            <button hlmBtn type="button" class="h-11" [disabled]="busy() === 'rules'" (click)="acceptRules()">
              <ng-icon name="lucideCheck" size="16" aria-hidden="true" /> I have read and accept the rules
            </button>
          }
        </li>

        <!-- 2. Location permission -->
        <li class="flex flex-col gap-3 p-4">
          <div class="flex items-start gap-3">
            <span class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-sm font-bold" [class]="locState() === 'granted' ? 'bg-primary text-primary-foreground' : locBad() ? 'border border-destructive text-destructive' : 'border border-border text-muted-foreground'" aria-hidden="true">{{ locState() === 'granted' ? '✓' : locBad() ? '!' : '2' }}</span>
            <div class="min-w-0 flex-1">
              <h3 class="font-semibold">Location access</h3>
              @switch (locState()) {
                @case ('checking') { <p class="text-sm text-muted-foreground">Checking…</p> }
                @case ('granted') { <p class="text-sm text-muted-foreground">Allowed on this device.</p> }
                @case ('denied') {
                  <p class="text-sm text-destructive">Blocked. Open your browser's site settings, allow Location for this site, then reload.</p>
                }
                @case ('unsupported') { <p class="text-sm text-destructive">This browser has no location access. Use a phone with GPS.</p> }
                @default { <p class="text-sm text-muted-foreground">Needed for the live map and for capturing zones. Your browser will ask.</p> }
              }
            </div>
          </div>
          @if (locState() === 'prompt' || locState() === 'unknown') {
            <button hlmBtn variant="secondary" type="button" class="h-11" [disabled]="busy() === 'location'" (click)="requestLocation()">
              <ng-icon name="lucideLocateFixed" size="16" aria-hidden="true" /> {{ busy() === 'location' ? 'Waiting for GPS…' : 'Allow location' }}
            </button>
          } @else if (locState() === 'denied') {
            <button hlmBtn variant="outline" type="button" class="h-11" [disabled]="busy() === 'location'" (click)="requestLocation()">Check again</button>
          }
        </li>

        <!-- 3. Notifications (optional) -->
        <li class="flex flex-col gap-3 p-4">
          <div class="flex items-start gap-3">
            <span class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-sm font-bold" [class]="notifState() === 'granted' ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'" aria-hidden="true">{{ notifState() === 'granted' ? '✓' : '3' }}</span>
            <div class="min-w-0 flex-1">
              <h3 class="font-semibold">Notifications <span class="text-xs font-normal text-muted-foreground">(recommended)</span></h3>
              @switch (notifState()) {
                @case ('granted') { <p class="text-sm text-muted-foreground">On. You get the start signal, announcements and captures.</p> }
                @case ('denied') { <p class="text-sm text-muted-foreground">Blocked in the browser. You will only see messages while the app is open.</p> }
                @case ('unsupported') { <p class="text-sm text-muted-foreground">Not available in this browser. Keep the app open during the game. On iPhone, add the app to the Home Screen first.</p> }
                @default { <p class="text-sm text-muted-foreground">Get the start signal and GM announcements even with the app in the background.</p> }
              }
            </div>
          </div>
          @if (notifState() === 'default') {
            <button hlmBtn variant="secondary" type="button" class="h-11" [disabled]="busy() === 'notifications'" (click)="enableNotifications()">
              <ng-icon name="lucideBellRing" size="16" aria-hidden="true" /> Enable notifications
            </button>
          }
        </li>

        <!-- 4. Location sharing consent -->
        <li class="flex flex-col gap-3 p-4">
          <div class="flex items-start gap-3">
            <span class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-sm font-bold" [class]="m.trackingConsented ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'" aria-hidden="true">{{ m.trackingConsented ? '✓' : '4' }}</span>
            <div class="min-w-0 flex-1">
              <h3 class="font-semibold">Share my location during this game</h3>
              <p class="text-sm text-muted-foreground">{{ m.trackingConsented ? 'You agreed. Sharing starts only when the Game Master starts the game.' : 'Your consent is needed before your position is sent.' }}</p>
            </div>
          </div>
          <dl class="grid gap-x-3 gap-y-1.5 rounded-sm border border-border bg-muted/40 p-3 text-sm sm:grid-cols-[auto_1fr]">
            <dt class="label-caps self-center">When</dt>
            <dd>Only while the game is live{{ e.tracking.stopWhenPaused ? ', not while paused' : '' }}. It stops when the game ends or you leave.</dd>
            <dt class="label-caps self-center">How often</dt>
            <dd>About every <span class="num">{{ e.tracking.intervalSec }}</span> s while you move.</dd>
            <dt class="label-caps self-center">Game Masters</dt>
            <dd>See your exact position, to run the game and find you in an emergency.</dd>
            <dt class="label-caps self-center">Your side</dt>
            <dd>{{ allyLabel() }} · {{ allyPrecision() }}</dd>
            <dt class="label-caps self-center">Enemies</dt>
            <dd>{{ enemyLabel() }}{{ e.visibilityRules.enemies !== 'never' ? ' · ' + enemyPrecision() : '' }}</dd>
            <dt class="label-caps self-center">Kept for</dt>
            <dd><span class="num">{{ e.tracking.retentionDays }}</span> days, then deleted.</dd>
          </dl>
          @if (!e.tracking.background) {
            <p class="text-xs text-muted-foreground">Browsers stop location when the phone sleeps: keep AirsoftHub open during the game. The screen stays on while tracking.</p>
          }
          @if (m.trackingConsented) {
            <button hlmBtn variant="ghost" type="button" class="tap self-start text-muted-foreground" [disabled]="busy() === 'consent'" (click)="withdrawConsent()">Withdraw consent</button>
          } @else {
            <button hlmBtn type="button" class="h-11" [disabled]="busy() === 'consent'" (click)="giveConsent()">
              <ng-icon name="lucideMapPin" size="16" aria-hidden="true" /> Share my location during this game
            </button>
          }
        </li>

        <!-- 5. Team -->
        <li class="flex flex-col gap-3 p-4">
          <div class="flex items-start gap-3">
            <span class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-sm font-bold" [class]="myTeam() ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'" aria-hidden="true">{{ myTeam() ? '✓' : '5' }}</span>
            <div class="min-w-0 flex-1">
              <h3 class="font-semibold">Team</h3>
              @if (myTeam(); as t) {
                <p class="mt-1 flex items-center gap-2 text-sm"><zeus-team-badge [team]="t" size="sm" /></p>
              } @else if (canChooseTeam()) {
                <p class="text-sm text-muted-foreground">Pick the team you play for.</p>
              } @else if (e.teamSelection === 'auto') {
                <p class="text-sm text-muted-foreground">Teams are balanced automatically before the start.</p>
              } @else {
                <p class="text-sm text-muted-foreground">The Game Master assigns your team.</p>
              }
              @if (e.teamsLocked && e.teamSelection === 'player') {
                <p class="text-xs text-muted-foreground">■ Teams are locked.</p>
              }
            </div>
          </div>
          @if (canChooseTeam()) {
            <ul class="grid gap-2 sm:grid-cols-2">
              @for (t of teams(); track t.id) {
                @let full = t.capacity > 0 && t.memberCount >= t.capacity;
                @let mine = t.id === m.teamId;
                <li>
                  <button
                    type="button"
                    class="tap flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left disabled:opacity-60"
                    [class]="mine ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/60'"
                    [disabled]="mine || full || busy() === 'team'"
                    [attr.aria-pressed]="mine"
                    [attr.aria-label]="(mine ? 'Your team: ' : 'Join ') + t.name + ', ' + t.memberCount + (t.capacity ? ' of ' + t.capacity : '') + ' players' + (full && !mine ? ', full' : '')"
                    (click)="chooseTeam(t)"
                  >
                    <zeus-team-badge [team]="t" size="sm" />
                    <span class="num shrink-0 text-xs text-muted-foreground">
                      {{ t.memberCount }}{{ t.capacity ? '/' + t.capacity : '' }}
                      @if (mine) { <span class="text-primary">✓</span> } @else if (full) { ■ Full }
                    </span>
                  </button>
                </li>
              }
            </ul>
          }
        </li>

        <!-- 6. Ready -->
        <li class="flex flex-col gap-3 p-4">
          <div class="flex items-start gap-3">
            <span class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-sm font-bold" [class]="m.ready ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'" aria-hidden="true">{{ m.ready ? '✓' : '6' }}</span>
            <div class="min-w-0 flex-1">
              <h3 class="font-semibold">Ready</h3>
              <p class="text-sm text-muted-foreground">
                {{ m.ready ? 'The Game Master sees you are ready.' : m.rulesAccepted ? 'Tell the Game Master you are kitted up and at the field.' : 'Accept the rules first.' }}
              </p>
            </div>
          </div>
          <button
            hlmBtn
            type="button"
            class="h-12"
            [variant]="m.ready ? 'outline' : 'default'"
            [disabled]="!m.rulesAccepted || busy() === 'ready'"
            [attr.aria-pressed]="m.ready"
            (click)="toggleReady()"
          >
            @if (m.ready) {
              <ng-icon name="lucideCircleCheck" size="18" class="text-primary" aria-hidden="true" /> Ready — tap to undo
            } @else {
              <ng-icon name="lucideCheck" size="18" aria-hidden="true" /> I'm ready
            }
          </button>
        </li>
      </ol>
    </section>
  `,
})
export class LobbyChecklist {
  private readonly api = inject(ApiService);
  private readonly tracker = inject(LocationTracker);
  private readonly push = inject(PushService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly event = input.required<EventDetail>();
  /** Emits the updated membership after every change. */
  readonly memberChange = output<Member>();

  protected readonly busy = signal<BusyKind | null>(null);
  protected readonly locState = signal<LocState>('checking');
  private readonly pushSupported = signal(false);

  protected readonly me = computed(() => this.event().me!);
  protected readonly teams = computed(() => [...this.event().teams].sort((a, b) => a.sortOrder - b.sortOrder));
  protected readonly myTeam = computed(() => this.event().teams.find((t) => t.id === this.me().teamId) ?? null);
  protected readonly canChooseTeam = computed(() => this.event().teamSelection === 'player' && !this.event().teamsLocked && this.event().teams.length > 0);
  protected readonly locBad = computed(() => this.locState() === 'denied' || this.locState() === 'unsupported');
  protected readonly notifState = computed<NotificationPermission | 'unsupported'>(() => {
    const p = this.push.permission();
    if (p === 'granted') return 'granted';
    if (!this.pushSupported() || p === 'unsupported') return 'unsupported';
    return p;
  });

  protected readonly allyLabel = computed(() => ALLY_LABELS[this.event().visibilityRules.allies]);
  protected readonly enemyLabel = computed(() => ENEMY_LABELS[this.event().visibilityRules.enemies]);
  protected readonly allyPrecision = computed(() => precisionText(this.event().visibilityRules.allyPrecision, this.event().visibilityRules));
  protected readonly enemyPrecision = computed(() => precisionText(this.event().visibilityRules.enemyPrecision, this.event().visibilityRules));

  /** Notifications are recommended, not required: they count only once granted. */
  protected readonly totalCount = computed(() => 5 + (this.notifState() === 'granted' ? 1 : 0));
  protected readonly doneCount = computed(() => {
    const m = this.me();
    return (
      (m.rulesAccepted ? 1 : 0) +
      (this.locState() === 'granted' ? 1 : 0) +
      (this.notifState() === 'granted' ? 1 : 0) +
      (m.trackingConsented ? 1 : 0) +
      (this.myTeam() || this.event().teamSelection === 'auto' ? 1 : 0) +
      (m.ready ? 1 : 0)
    );
  });

  constructor() {
    afterNextRender(() => {
      this.pushSupported.set(this.push.supported);
      void this.syncPermissions();
    });
  }

  /** Read the browser's current permissions and report changes so the GM sees them. */
  private async syncPermissions(): Promise<void> {
    const loc = await this.tracker.permissionState();
    this.locState.set(loc);
    const patch: { locationPermission?: PermissionState; notificationPermission?: PermissionState } = {};
    if (loc !== 'unsupported' && loc !== this.me().locationPermission) patch.locationPermission = loc;
    const notif = toPermissionState(this.push.permission());
    if (notif !== this.me().notificationPermission) patch.notificationPermission = notif;
    if (patch.locationPermission || patch.notificationPermission) {
      try {
        this.memberChange.emit(await this.api.updateMyMembership(this.event().id, patch));
      } catch {
        /* silent: informational only */
      }
    }
  }

  protected async acceptRules(): Promise<void> {
    await this.update('rules', { rulesAccepted: true }, 'Rules accepted');
  }

  protected async requestLocation(): Promise<void> {
    this.busy.set('location');
    try {
      const granted = await this.tracker.requestPermission();
      let state = await this.tracker.permissionState();
      if (state === 'prompt' || state === 'unsupported') state = granted ? 'granted' : 'denied';
      this.locState.set(state);
      if (state !== 'granted') this.toast.warning('Location is blocked', 'Allow Location for this site in your browser settings.');
      this.memberChange.emit(await this.api.updateMyMembership(this.event().id, { locationPermission: state }));
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(null);
    }
  }

  protected async enableNotifications(): Promise<void> {
    this.busy.set('notifications');
    try {
      const subscribed = await this.push.enable();
      const perm = this.push.permission();
      if (perm === 'granted' && !subscribed) {
        this.toast.warning('Notifications allowed, but this device could not register for push.', 'Keep the app open during the game.');
      } else if (perm === 'denied') {
        this.toast.info('Notifications stay off', 'You can enable them later in the browser settings.');
      }
      this.memberChange.emit(await this.api.updateMyMembership(this.event().id, { notificationPermission: toPermissionState(perm) }));
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(null);
    }
  }

  protected async giveConsent(): Promise<void> {
    const id = this.event().id;
    this.busy.set('consent');
    try {
      const m = await this.api.updateMyMembership(id, { trackingConsent: true });
      this.memberChange.emit(m);
      await this.api.recordConsent('tracking', true, undefined, id);
      this.toast.success('Location sharing on for this game', 'Sharing starts when the game starts.');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(null);
    }
  }

  protected async withdrawConsent(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Stop sharing your location?',
      consequences: [
        'Your position is not sent during this game.',
        'The Game Master cannot locate you in an emergency.',
        'You cannot capture objectives that require holding a zone.',
      ],
      confirmLabel: 'Withdraw consent',
      destructive: true,
    });
    if (!ok) return;
    const id = this.event().id;
    this.busy.set('consent');
    try {
      const m = await this.api.updateMyMembership(id, { trackingConsent: false });
      this.memberChange.emit(m);
      await this.api.recordConsent('tracking', false, undefined, id);
      if (this.tracker.eventId() === id) this.tracker.stop();
      this.toast.info('Location sharing off for this game');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(null);
    }
  }

  protected async chooseTeam(t: Team): Promise<void> {
    const current = this.myTeam();
    if (current) {
      const ok = await this.confirm.ask({
        title: `Switch to ${t.name}?`,
        consequences: [`You leave ${current.name}${this.me().squadId ? ' and your squad' : ''}.`, 'Your ready state may be reset.'],
        confirmLabel: `Join ${t.name}`,
      });
      if (!ok) return;
    }
    this.busy.set('team');
    try {
      this.memberChange.emit(await this.api.chooseTeam(this.event().id, t.id));
      this.toast.success(`You joined ${t.name}`);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(null);
    }
  }

  protected async toggleReady(): Promise<void> {
    const next = !this.me().ready;
    await this.update('ready', { ready: next }, next ? 'Marked ready' : 'No longer ready');
  }

  private async update(kind: BusyKind, body: UpdateMyMembershipRequest, ok: string): Promise<void> {
    this.busy.set(kind);
    try {
      this.memberChange.emit(await this.api.updateMyMembership(this.event().id, body));
      this.toast.success(ok);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(null);
    }
  }
}

function toPermissionState(p: NotificationPermission | 'unsupported'): PermissionState {
  if (p === 'granted') return 'granted';
  if (p === 'denied') return 'denied';
  if (p === 'default') return 'prompt';
  return 'unknown';
}

function precisionText(p: EventDetail['visibilityRules']['allyPrecision'], rules: EventDetail['visibilityRules']): string {
  switch (p) {
    case 'approximate':
    case 'area':
      return `${PRECISION_LABELS[p].toLowerCase()} (±${rules.approxRadiusM} m)`;
    case 'delayed':
      return `delayed by ${rules.delaySec} s`;
    default:
      return 'exact position';
  }
}
