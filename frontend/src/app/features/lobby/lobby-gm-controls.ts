import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { Announcement, AnnouncementRequest, EventDetail, Member, Priority } from '../../core/api/models';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { formatDateTime, formatDuration, formatNumber, formatTime, fromLocalInput, toLocalInput } from '../../core/util/format';
import { PlayerListItem } from '../../shared/cards';

type Busy = 'lobby' | 'start' | 'delay' | 'cancel' | 'lock' | 'announce' | null;

/** GM tools in the lobby: status, registration, pending requests, announcements. */
@Component({
  selector: 'zeus-lobby-gm-controls',
  imports: [ReactiveFormsModule, RouterLink, NgIcon, HlmButton, HlmInput, HlmLabel, HlmTextarea, PlayerListItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4' },
  template: `
    @let e = event();
    <!-- Game control -->
    <section class="panel flex flex-col gap-3 p-4" aria-labelledby="gm-control-title">
      <h2 id="gm-control-title" class="label-caps" i18n>Game control</h2>

      @if (preLobby()) {
        <button hlmBtn type="button" class="h-12" [disabled]="busy() !== null" (click)="openLobby()">
          <ng-icon name="lucideUsers" size="18" aria-hidden="true" /> <ng-container i18n>Open lobby</ng-container>
        </button>
        <p class="-mt-1 text-xs text-muted-foreground" i18n>Moves the event to Lobby: players see the start countdown and get ready. The game can only start from the lobby.</p>
      }

      <button hlmBtn type="button" class="h-12" [variant]="preLobby() ? 'outline' : 'default'" [disabled]="busy() !== null || !!startBlock()" [attr.aria-describedby]="startBlock() ? 'start-block' : null" (click)="start()">
        @if (busy() === 'start') {
          <ng-icon name="lucideLoader2" size="18" class="animate-spin" aria-hidden="true" /> <ng-container i18n>Starting…</ng-container>
        } @else {
          <ng-icon name="lucidePlay" size="18" aria-hidden="true" /> <ng-container i18n>Start game</ng-container>
        }
      </button>
      @if (startBlock(); as why) {
        <p id="start-block" class="-mt-1 text-xs text-muted-foreground">{{ why }}</p>
      }

      <div class="grid grid-cols-2 gap-2">
        <button hlmBtn variant="outline" type="button" class="h-11" [disabled]="busy() !== null" [attr.aria-expanded]="delayOpen()" aria-controls="delay-form" (click)="toggleDelay()">
          <ng-icon name="lucideClock" size="16" aria-hidden="true" /> <ng-container i18n>Delay start</ng-container>
        </button>
        <button hlmBtn variant="outline" type="button" class="h-11" [disabled]="busy() !== null" (click)="toggleRegistration()">
          <ng-icon [name]="e.registrationLocked ? 'lucideLockOpen' : 'lucideLock'" size="16" aria-hidden="true" />
          {{ e.registrationLocked ? txt.unlockRegistration : txt.lockRegistration }}
        </button>
      </div>
      <p class="text-xs text-muted-foreground" i18n>
        Registration: <span class="font-semibold" [class.text-warning]="e.registrationLocked">{{ e.registrationLocked ? txt.locked : txt.open }}</span>
      </p>

      @if (delayOpen()) {
        <form id="delay-form" class="flex flex-col gap-2 rounded-sm border border-border bg-muted/40 p-3" [formGroup]="delayForm" (ngSubmit)="delay()" novalidate>
          <label hlmLabel for="delay-start" i18n>New start time</label>
          <input hlmInput id="delay-start" type="datetime-local" class="h-11" formControlName="start" [attr.aria-invalid]="delayError() ? 'true' : null" aria-describedby="delay-help delay-error" />
          <p id="delay-help" class="text-xs text-muted-foreground" i18n>Now {{ startLabel() }}. The end time moves by the same amount and players get an announcement.</p>
          @if (delayError()) {
            <p id="delay-error" class="field-error" role="alert">{{ delayError() }}</p>
          }
          <div class="flex gap-2">
            <button hlmBtn type="submit" class="h-11 flex-1" [disabled]="busy() === 'delay'">{{ busy() === 'delay' ? txt.saving : txt.moveStart }}</button>
            <button hlmBtn variant="ghost" type="button" class="h-11" (click)="delayOpen.set(false)" i18n>Cancel</button>
          </div>
        </form>
      }

      <div class="flex flex-col gap-1 border-t border-border pt-3">
        <a hlmBtn variant="ghost" class="tap justify-start" [routerLink]="['/gm/events', e.id, 'control']"><ng-icon name="lucideLayoutDashboard" size="16" aria-hidden="true" /> <ng-container i18n>Control center</ng-container></a>
        <a hlmBtn variant="ghost" class="tap justify-start" [routerLink]="['/gm/events', e.id, 'players']"><ng-icon name="lucideUserCheck" size="16" aria-hidden="true" /> <ng-container i18n>Player management</ng-container></a>
        <a hlmBtn variant="ghost" class="tap justify-start" [routerLink]="['/gm/events', e.id, 'teams']"><ng-icon name="lucideFlag" size="16" aria-hidden="true" /> <ng-container i18n>Teams and squads</ng-container></a>
        <a hlmBtn variant="ghost" class="tap justify-start" [routerLink]="['/gm/events', e.id]"><ng-icon name="lucidePencil" size="16" aria-hidden="true" /> <ng-container i18n>Edit event</ng-container></a>
        <button hlmBtn variant="ghost" type="button" class="tap justify-start text-destructive" [disabled]="busy() !== null" (click)="cancelEvent()">
          <ng-icon name="lucideBan" size="16" aria-hidden="true" /> <ng-container i18n>Cancel event</ng-container>
        </button>
      </div>
    </section>

    <!-- Pending requests -->
    @if (pending().length) {
      <section class="panel p-4" aria-labelledby="pending-title">
        <h2 id="pending-title" class="label-caps mb-1" i18n>Pending requests · <span class="num">{{ pending().length }}</span></h2>
        <ul class="divide-y divide-border">
          @for (m of pending(); track m.userId) {
            <li>
              <zeus-player-list-item [member]="m" [showPresence]="false">
                <button hlmBtn size="icon-lg" type="button" class="tap" [disabled]="reviewing() === m.userId" (click)="review(m, true)" aria-label="Approve {{ m.nickname }}" i18n-aria-label>
                  <ng-icon name="lucideCheck" size="18" aria-hidden="true" />
                </button>
                <button hlmBtn size="icon-lg" variant="outline" type="button" class="tap" [disabled]="reviewing() === m.userId" (click)="review(m, false)" aria-label="Reject {{ m.nickname }}" i18n-aria-label>
                  <ng-icon name="lucideX" size="18" aria-hidden="true" />
                </button>
              </zeus-player-list-item>
            </li>
          }
        </ul>
      </section>
    }

    <!-- Announcement -->
    <section class="panel p-4" aria-labelledby="announce-title">
      <h2 id="announce-title" class="label-caps mb-3" i18n>Send announcement</h2>
      <form class="flex flex-col gap-3" [formGroup]="announceForm" (ngSubmit)="announce()" novalidate>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="ann-title" i18n>Title</label>
          <input hlmInput id="ann-title" class="h-11" formControlName="title" maxlength="120" autocomplete="off" [attr.aria-invalid]="announceErrors()['title'] ? 'true' : null" aria-describedby="ann-title-error" />
          @if (announceErrors()['title']) {
            <p id="ann-title-error" class="field-error">{{ announceErrors()['title'] }}</p>
          }
        </div>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="ann-body" i18n>Message</label>
          <textarea hlmTextarea id="ann-body" rows="3" formControlName="body" maxlength="1000" aria-describedby="ann-body-error"></textarea>
          @if (announceErrors()['body']) {
            <p id="ann-body-error" class="field-error">{{ announceErrors()['body'] }}</p>
          }
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="ann-priority" i18n>Priority</label>
            <select id="ann-priority" formControlName="priority" class="h-11 rounded-md border border-input bg-transparent px-2 dark:bg-input/30">
              <option value="normal" i18n>Normal</option>
              <option value="high" i18n>High</option>
              <option value="emergency" i18n>Emergency</option>
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="ann-scope" i18n>Send to</label>
            <select id="ann-scope" formControlName="scope" class="h-11 rounded-md border border-input bg-transparent px-2 dark:bg-input/30">
              <option value="all" i18n>Everyone</option>
              <option value="team" [disabled]="!e.teams.length" i18n>One team</option>
            </select>
          </div>
        </div>
        @if (announceValue().scope === 'team') {
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="ann-team" i18n>Team</label>
            <select id="ann-team" formControlName="teamId" class="h-11 rounded-md border border-input bg-transparent px-2 dark:bg-input/30" aria-describedby="ann-team-error">
              <option value="" i18n>Choose a team</option>
              @for (t of e.teams; track t.id) {
                <option [value]="t.id">{{ t.name }}</option>
              }
            </select>
            @if (announceErrors()['teamId']) {
              <p id="ann-team-error" class="field-error">{{ announceErrors()['teamId'] }}</p>
            }
          </div>
        }
        @if (announceValue().priority === 'emergency') {
          <p class="text-xs text-destructive" i18n>▲ Emergency messages sound an alert on every phone. Use them only for safety.</p>
        }
        <button hlmBtn type="submit" class="h-11" [disabled]="busy() === 'announce'">
          <ng-icon name="lucideMegaphone" size="16" aria-hidden="true" /> {{ busy() === 'announce' ? txt.sending : sendLabel() }}
        </button>
      </form>
    </section>
  `,
})
export class LobbyGmControls {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    unlockRegistration: $localize`Unlock registration`,
    lockRegistration: $localize`Lock registration`,
    locked: $localize`■ Locked`,
    open: $localize`● Open`,
    saving: $localize`Saving…`,
    moveStart: $localize`Move start`,
    sending: $localize`Sending…`,
  };

  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly event = input.required<EventDetail>();
  readonly members = input.required<Member[]>();
  readonly eventChange = output<EventDetail>();
  readonly announcementSent = output<Announcement>();
  readonly membersChanged = output<void>();

  protected readonly busy = signal<Busy>(null);
  protected readonly reviewing = signal<string | null>(null);
  protected readonly delayOpen = signal(false);
  protected readonly delayError = signal<string | null>(null);
  protected readonly announceErrors = signal<Record<string, string>>({});

  protected readonly delayForm = this.fb.group({ start: this.fb.control('', Validators.required) });
  protected readonly announceForm = this.fb.group({
    title: this.fb.control('', [Validators.required, Validators.maxLength(120)]),
    body: this.fb.control('', [Validators.maxLength(1000)]),
    priority: this.fb.control<Priority>('normal'),
    scope: this.fb.control<'all' | 'team'>('all'),
    teamId: this.fb.control(''),
  });

  protected readonly preLobby = computed(() => {
    const s = this.event().status;
    return s === 'published' || s === 'registration_open';
  });
  /** The API only allows lobby → live, with at least two teams. */
  protected readonly startBlock = computed<string | null>(() => {
    const e = this.event();
    if (e.status !== 'lobby') return $localize`Open the lobby first, then start the game from here.`;
    if (e.teams.length < 2) return $localize`Create at least two teams before starting.`;
    return null;
  });
  protected readonly startLabel = computed(() => formatDateTime(this.event().startAt));
  protected readonly players = computed(() => this.members().filter((m) => m.status === 'approved' && m.role === 'player'));
  protected readonly pending = computed(() => this.members().filter((m) => m.status === 'pending'));
  protected readonly announceValue = toSignal(this.announceForm.valueChanges, { initialValue: this.announceForm.getRawValue() });
  protected readonly sendLabel = computed(() => {
    const v = this.announceValue();
    const team = this.event().teams.find((t) => t.id === v.teamId);
    return v.scope === 'team' ? $localize`Send to ${team?.name ?? $localize`the team`}:team:` : $localize`Send to everyone`;
  });

  protected async openLobby(): Promise<void> {
    const ok = await this.confirm.ask({
      title: $localize`Open the lobby?`,
      consequences: [
        $localize`Players see the start countdown and the pre-game checklist.`,
        $localize`${this.players().length}:length: registered players are notified.`,
        this.event().registrationLocked ? $localize`Registration stays locked.` : $localize`Registration stays open until you lock it.`,
      ],
      confirmLabel: $localize`Open lobby`,
    });
    if (!ok) return;
    await this.setStatus('lobby', 'lobby', $localize`Lobby open`);
  }

  protected async start(): Promise<void> {
    const e = this.event();
    const players = this.players();
    const consented = players.filter((m) => m.trackingConsented).length;
    const notReady = players.filter((m) => !m.ready).length;
    const noTeam = players.filter((m) => !m.teamId).length;
    const s = e.scoring;
    const plannedMs = new Date(e.endAt).getTime() - new Date(e.startAt).getTime();
    const consequences = [
      $localize`The game clock starts now and runs for ${formatDuration(plannedMs)}:plannedMs: (until about ${formatTime(new Date(Date.now() + plannedMs).toISOString())}:toISOString:).`,
      $localize`Location tracking starts for ${consented}:consented: of ${players.length}:length: players who consented.`,
      e.storeEnabled
        ? $localize`Every team gets its starting balance: ${formatNumber(s.startingPoints)}:startingPoints: points and ${formatNumber(s.startingCurrency)}:startingCurrency: credits.`
        : $localize`Every team starts with ${formatNumber(s.startingPoints)}:startingPoints: points.`,
    ];
    if (notReady) consequences.push(notReady === 1 ? $localize`1 player is not ready.` : $localize`${notReady}:count: players are not ready.`);
    if (noTeam) {
      consequences.push(
        e.teamSelection === 'auto'
          ? $localize`${noTeam}:noTeam: players without a team are balanced automatically.`
          : (noTeam === 1 ? $localize`1 player has no team and cannot capture objectives.` : $localize`${noTeam}:count: players have no team and cannot capture objectives.`),
      );
    }
    if (players.length < e.minPlayers) consequences.push($localize`Only ${players.length}:length: players — below the minimum of ${e.minPlayers}:minPlayers:.`);
    if (this.pending().length) consequences.push($localize`${this.pending().length}:length: pending requests stay unanswered.`);
    const ok = await this.confirm.ask({ title: $localize`Start ${e.name}:name:?`, consequences, confirmLabel: $localize`Start game` });
    if (!ok) return;
    const updated = await this.setStatus('live', 'start', $localize`Game started`);
    if (updated) void this.router.navigate(['/gm/events', e.id, 'control']);
  }

  protected toggleDelay(): void {
    const open = !this.delayOpen();
    this.delayOpen.set(open);
    this.delayError.set(null);
    if (open) {
      const base = Math.max(Date.now(), new Date(this.event().startAt).getTime());
      const next = new Date(Math.ceil((base + 15 * 60_000) / 300_000) * 300_000);
      this.delayForm.controls.start.setValue(toLocalInput(next.toISOString()));
    }
  }

  protected async delay(): Promise<void> {
    const e = this.event();
    const iso = fromLocalInput(this.delayForm.controls.start.value);
    if (!iso) {
      this.delayError.set($localize`Choose the new start time.`);
      return;
    }
    const newStart = new Date(iso).getTime();
    const oldStart = new Date(e.startAt).getTime();
    if (newStart <= Date.now()) {
      this.delayError.set($localize`The new start must be in the future.`);
      return;
    }
    if (newStart <= oldStart) {
      this.delayError.set($localize`Pick a time after the current start (${formatTime(e.startAt)}:startAt:).`);
      return;
    }
    this.delayError.set(null);
    const delta = newStart - oldStart;
    const newEnd = new Date(new Date(e.endAt).getTime() + delta).toISOString();
    const ok = await this.confirm.ask({
      title: $localize`Delay the start?`,
      consequences: [
        $localize`Start moves from ${formatDateTime(e.startAt)}:startAt: to ${formatDateTime(iso)}:iso: (${formatDuration(delta)}:delta: later).`,
        $localize`End moves to ${formatDateTime(newEnd)}:newEnd:.`,
        $localize`Everyone in the event gets an announcement.`,
      ],
      confirmLabel: $localize`Delay start`,
    });
    if (!ok) return;
    this.busy.set('delay');
    try {
      const updated = await this.api.updateEvent(e.id, { startAt: iso, endAt: newEnd });
      this.eventChange.emit(updated);
      this.delayOpen.set(false);
      try {
        const a = await this.api.sendAnnouncement(e.id, {
          scope: 'all',
          title: $localize`Start delayed`,
          body: $localize`The game now starts at ${formatTime(iso)}:iso: (${formatDuration(delta)}:delta: later). Planned end: ${formatTime(newEnd)}:newEnd:.`,
          priority: 'high',
        });
        this.announcementSent.emit(a);
        this.toast.success($localize`Start delayed`, $localize`Players were notified.`);
      } catch {
        this.toast.warning($localize`Start delayed, but the announcement failed`, $localize`Send one yourself so players know.`);
      }
    } catch (err) {
      const ae = ApiError.from(err);
      this.delayError.set(ae.fields['startAt'] ?? ae.fields['endAt'] ?? ae.message);
    } finally {
      this.busy.set(null);
    }
  }

  protected async toggleRegistration(): Promise<void> {
    const e = this.event();
    const lock = !e.registrationLocked;
    if (lock) {
      const ok = await this.confirm.ask({
        title: $localize`Lock registration?`,
        consequences: [$localize`New players cannot join or request to join.`, $localize`Pending requests can still be approved.`, $localize`You can unlock it again at any time.`],
        confirmLabel: $localize`Lock registration`,
      });
      if (!ok) return;
    }
    this.busy.set('lock');
    try {
      this.eventChange.emit(await this.api.updateEvent(e.id, { registrationLocked: lock }));
      this.toast.success(lock ? $localize`Registration locked` : $localize`Registration open`);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(null);
    }
  }

  protected async cancelEvent(): Promise<void> {
    const e = this.event();
    const reason = await this.confirm.askReason({
      title: $localize`Cancel ${e.name}:name:?`,
      consequences: [
        $localize`${this.players().length}:length: registered players and ${this.pending().length}:length2: pending requests are notified with your reason.`,
        $localize`The event cannot be started any more.`,
        $localize`No location is tracked.`,
      ],
      reason: { label: $localize`Reason shown to players`, required: true, placeholder: $localize`e.g. Storm warning for the field` },
      confirmLabel: $localize`Cancel event`,
      cancelLabel: $localize`Keep event`,
      destructive: true,
    });
    if (reason === null) return;
    this.busy.set('cancel');
    try {
      this.eventChange.emit(await this.api.setEventStatus(e.id, 'cancelled', reason));
      this.toast.info($localize`Event cancelled`);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(null);
    }
  }

  protected async review(m: Member, approve: boolean): Promise<void> {
    if (!approve) {
      const ok = await this.confirm.ask({
        title: $localize`Reject ${m.nickname}:nickname:?`,
        consequences: [$localize`${m.nickname}:nickname: is notified that the request was declined.`, $localize`They cannot join unless you invite them later.`],
        confirmLabel: $localize`Reject request`,
        destructive: true,
      });
      if (!ok) return;
    }
    this.reviewing.set(m.userId);
    try {
      await this.api.reviewMember(this.event().id, m.userId, approve);
      this.toast.success(approve ? $localize`${m.nickname}:nickname: approved` : $localize`${m.nickname}:nickname: rejected`);
      this.membersChanged.emit();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.reviewing.set(null);
    }
  }

  protected async announce(): Promise<void> {
    const v = this.announceForm.getRawValue();
    const errors: Record<string, string> = {};
    if (!v.title.trim()) errors['title'] = $localize`Enter a title.`;
    if (v.scope === 'team' && !v.teamId) errors['teamId'] = $localize`Choose the team.`;
    this.announceErrors.set(errors);
    if (Object.keys(errors).length) return;

    const team = this.event().teams.find((t) => t.id === v.teamId);
    if (v.priority === 'emergency') {
      const ok = await this.confirm.ask({
        title: $localize`Send an emergency message?`,
        consequences: [
          v.scope === 'team' ? $localize`Every phone in ${team?.name}:name: sounds an alert.` : $localize`Every phone in the event sounds an alert.`,
          $localize`Use emergency only for safety: injuries, stop of play, evacuation.`,
        ],
        confirmLabel: $localize`Send emergency`,
        destructive: true,
      });
      if (!ok) return;
    }
    const body: AnnouncementRequest = {
      scope: v.scope,
      teamId: v.scope === 'team' ? v.teamId : null,
      title: v.title.trim(),
      body: v.body.trim(),
      priority: v.priority,
    };
    this.busy.set('announce');
    try {
      const a = await this.api.sendAnnouncement(this.event().id, body);
      this.announcementSent.emit(a);
      this.announceForm.reset({ title: '', body: '', priority: 'normal', scope: 'all', teamId: '' });
      this.toast.success(v.scope === 'team' ? $localize`Sent to ${team?.name}:name:` : $localize`Announcement sent`);
    } catch (err) {
      const ae = ApiError.from(err);
      if (Object.keys(ae.fields).length) this.announceErrors.set(ae.fields);
      else this.toast.error(ae);
    } finally {
      this.busy.set(null);
    }
  }

  private async setStatus(status: EventDetail['status'], busy: Busy, message: string): Promise<EventDetail | null> {
    this.busy.set(busy);
    try {
      const updated = await this.api.setEventStatus(this.event().id, status);
      this.eventChange.emit(updated);
      this.toast.success(message);
      return updated;
    } catch (err) {
      this.toast.error(err);
      return null;
    } finally {
      this.busy.set(null);
    }
  }
}
