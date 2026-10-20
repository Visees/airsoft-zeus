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
      <h2 id="gm-control-title" class="label-caps">Game control</h2>

      @if (preLobby()) {
        <button hlmBtn type="button" class="h-12" [disabled]="busy() !== null" (click)="openLobby()">
          <ng-icon name="lucideUsers" size="18" aria-hidden="true" /> Open lobby
        </button>
        <p class="-mt-1 text-xs text-muted-foreground">Moves the event to Lobby: players see the start countdown and get ready.</p>
      }

      <button hlmBtn type="button" class="h-12" [variant]="preLobby() ? 'outline' : 'default'" [disabled]="busy() !== null || !startable()" (click)="start()">
        @if (busy() === 'start') {
          <ng-icon name="lucideLoader2" size="18" class="animate-spin" aria-hidden="true" /> Starting…
        } @else {
          <ng-icon name="lucidePlay" size="18" aria-hidden="true" /> Start game
        }
      </button>

      <div class="grid grid-cols-2 gap-2">
        <button hlmBtn variant="outline" type="button" class="h-11" [disabled]="busy() !== null" [attr.aria-expanded]="delayOpen()" aria-controls="delay-form" (click)="toggleDelay()">
          <ng-icon name="lucideClock" size="16" aria-hidden="true" /> Delay start
        </button>
        <button hlmBtn variant="outline" type="button" class="h-11" [disabled]="busy() !== null" (click)="toggleRegistration()">
          <ng-icon [name]="e.registrationLocked ? 'lucideLockOpen' : 'lucideLock'" size="16" aria-hidden="true" />
          {{ e.registrationLocked ? 'Unlock registration' : 'Lock registration' }}
        </button>
      </div>
      <p class="text-xs text-muted-foreground">
        Registration: <span class="font-semibold" [class.text-warning]="e.registrationLocked">{{ e.registrationLocked ? '■ Locked' : '● Open' }}</span>
      </p>

      @if (delayOpen()) {
        <form id="delay-form" class="flex flex-col gap-2 rounded-sm border border-border bg-muted/40 p-3" [formGroup]="delayForm" (ngSubmit)="delay()" novalidate>
          <label hlmLabel for="delay-start">New start time</label>
          <input hlmInput id="delay-start" type="datetime-local" class="h-11" formControlName="start" [attr.aria-invalid]="delayError() ? 'true' : null" aria-describedby="delay-help delay-error" />
          <p id="delay-help" class="text-xs text-muted-foreground">Now {{ startLabel() }}. The end time moves by the same amount and players get an announcement.</p>
          @if (delayError()) {
            <p id="delay-error" class="field-error" role="alert">{{ delayError() }}</p>
          }
          <div class="flex gap-2">
            <button hlmBtn type="submit" class="h-11 flex-1" [disabled]="busy() === 'delay'">{{ busy() === 'delay' ? 'Saving…' : 'Move start' }}</button>
            <button hlmBtn variant="ghost" type="button" class="h-11" (click)="delayOpen.set(false)">Cancel</button>
          </div>
        </form>
      }

      <div class="flex flex-col gap-1 border-t border-border pt-3">
        <a hlmBtn variant="ghost" class="tap justify-start" [routerLink]="['/gm/events', e.id, 'control']"><ng-icon name="lucideLayoutDashboard" size="16" aria-hidden="true" /> Control center</a>
        <a hlmBtn variant="ghost" class="tap justify-start" [routerLink]="['/gm/events', e.id, 'players']"><ng-icon name="lucideUserCheck" size="16" aria-hidden="true" /> Player management</a>
        <a hlmBtn variant="ghost" class="tap justify-start" [routerLink]="['/gm/events', e.id, 'teams']"><ng-icon name="lucideFlag" size="16" aria-hidden="true" /> Teams and squads</a>
        <a hlmBtn variant="ghost" class="tap justify-start" [routerLink]="['/gm/events', e.id]"><ng-icon name="lucidePencil" size="16" aria-hidden="true" /> Edit event</a>
        <button hlmBtn variant="ghost" type="button" class="tap justify-start text-destructive" [disabled]="busy() !== null" (click)="cancelEvent()">
          <ng-icon name="lucideBan" size="16" aria-hidden="true" /> Cancel event
        </button>
      </div>
    </section>

    <!-- Pending requests -->
    @if (pending().length) {
      <section class="panel p-4" aria-labelledby="pending-title">
        <h2 id="pending-title" class="label-caps mb-1">Pending requests · <span class="num">{{ pending().length }}</span></h2>
        <ul class="divide-y divide-border">
          @for (m of pending(); track m.userId) {
            <li>
              <zeus-player-list-item [member]="m" [showPresence]="false">
                <button hlmBtn size="icon-lg" type="button" class="tap" [disabled]="reviewing() === m.userId" (click)="review(m, true)" [attr.aria-label]="'Approve ' + m.nickname">
                  <ng-icon name="lucideCheck" size="18" aria-hidden="true" />
                </button>
                <button hlmBtn size="icon-lg" variant="outline" type="button" class="tap" [disabled]="reviewing() === m.userId" (click)="review(m, false)" [attr.aria-label]="'Reject ' + m.nickname">
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
      <h2 id="announce-title" class="label-caps mb-3">Send announcement</h2>
      <form class="flex flex-col gap-3" [formGroup]="announceForm" (ngSubmit)="announce()" novalidate>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="ann-title">Title</label>
          <input hlmInput id="ann-title" class="h-11" formControlName="title" maxlength="120" autocomplete="off" [attr.aria-invalid]="announceErrors()['title'] ? 'true' : null" aria-describedby="ann-title-error" />
          @if (announceErrors()['title']) {
            <p id="ann-title-error" class="field-error">{{ announceErrors()['title'] }}</p>
          }
        </div>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="ann-body">Message</label>
          <textarea hlmTextarea id="ann-body" rows="3" formControlName="body" maxlength="1000" aria-describedby="ann-body-error"></textarea>
          @if (announceErrors()['body']) {
            <p id="ann-body-error" class="field-error">{{ announceErrors()['body'] }}</p>
          }
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="ann-priority">Priority</label>
            <select id="ann-priority" formControlName="priority" class="h-11 rounded-md border border-input bg-transparent px-2 dark:bg-input/30">
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="emergency">Emergency</option>
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="ann-scope">Send to</label>
            <select id="ann-scope" formControlName="scope" class="h-11 rounded-md border border-input bg-transparent px-2 dark:bg-input/30">
              <option value="all">Everyone</option>
              <option value="team" [disabled]="!e.teams.length">One team</option>
            </select>
          </div>
        </div>
        @if (announceValue().scope === 'team') {
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="ann-team">Team</label>
            <select id="ann-team" formControlName="teamId" class="h-11 rounded-md border border-input bg-transparent px-2 dark:bg-input/30" aria-describedby="ann-team-error">
              <option value="">Choose a team</option>
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
          <p class="text-xs text-destructive">▲ Emergency messages sound an alert on every phone. Use them only for safety.</p>
        }
        <button hlmBtn type="submit" class="h-11" [disabled]="busy() === 'announce'">
          <ng-icon name="lucideMegaphone" size="16" aria-hidden="true" /> {{ busy() === 'announce' ? 'Sending…' : sendLabel() }}
        </button>
      </form>
    </section>
  `,
})
export class LobbyGmControls {
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
  protected readonly startable = computed(() => ['published', 'registration_open', 'lobby'].includes(this.event().status));
  protected readonly startLabel = computed(() => formatDateTime(this.event().startAt));
  protected readonly players = computed(() => this.members().filter((m) => m.status === 'approved' && m.role === 'player'));
  protected readonly pending = computed(() => this.members().filter((m) => m.status === 'pending'));
  protected readonly announceValue = toSignal(this.announceForm.valueChanges, { initialValue: this.announceForm.getRawValue() });
  protected readonly sendLabel = computed(() => {
    const v = this.announceValue();
    const team = this.event().teams.find((t) => t.id === v.teamId);
    return v.scope === 'team' ? `Send to ${team?.name ?? 'team'}` : 'Send to everyone';
  });

  protected async openLobby(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Open the lobby?',
      consequences: [
        'Players see the start countdown and the pre-game checklist.',
        `${this.players().length} registered players are notified.`,
        this.event().registrationLocked ? 'Registration stays locked.' : 'Registration stays open until you lock it.',
      ],
      confirmLabel: 'Open lobby',
    });
    if (!ok) return;
    await this.setStatus('lobby', 'lobby', 'Lobby open');
  }

  protected async start(): Promise<void> {
    const e = this.event();
    const players = this.players();
    const consented = players.filter((m) => m.trackingConsented).length;
    const notReady = players.filter((m) => !m.ready).length;
    const noTeam = players.filter((m) => !m.teamId).length;
    const s = e.scoring;
    const consequences = [
      `The game clock starts now (planned end ${formatTime(e.endAt)}).`,
      `Location tracking starts for ${consented} of ${players.length} players who consented.`,
      e.storeEnabled
        ? `Every team gets its starting balance: ${formatNumber(s.startingPoints)} points and ${formatNumber(s.startingCurrency)} credits.`
        : `Every team starts with ${formatNumber(s.startingPoints)} points.`,
    ];
    if (notReady) consequences.push(`${notReady} ${notReady === 1 ? 'player is' : 'players are'} not ready.`);
    if (noTeam) {
      consequences.push(
        e.teamSelection === 'auto'
          ? `${noTeam} players without a team are balanced automatically.`
          : `${noTeam} ${noTeam === 1 ? 'player has' : 'players have'} no team and cannot capture objectives.`,
      );
    }
    if (players.length < e.minPlayers) consequences.push(`Only ${players.length} players — below the minimum of ${e.minPlayers}.`);
    if (this.pending().length) consequences.push(`${this.pending().length} pending requests stay unanswered.`);
    const ok = await this.confirm.ask({ title: `Start ${e.name}?`, consequences, confirmLabel: 'Start game' });
    if (!ok) return;
    const updated = await this.setStatus('live', 'start', 'Game started');
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
      this.delayError.set('Choose the new start time.');
      return;
    }
    const newStart = new Date(iso).getTime();
    const oldStart = new Date(e.startAt).getTime();
    if (newStart <= Date.now()) {
      this.delayError.set('The new start must be in the future.');
      return;
    }
    if (newStart <= oldStart) {
      this.delayError.set(`Pick a time after the current start (${formatTime(e.startAt)}).`);
      return;
    }
    this.delayError.set(null);
    const delta = newStart - oldStart;
    const newEnd = new Date(new Date(e.endAt).getTime() + delta).toISOString();
    const ok = await this.confirm.ask({
      title: 'Delay the start?',
      consequences: [
        `Start moves from ${formatDateTime(e.startAt)} to ${formatDateTime(iso)} (${formatDuration(delta)} later).`,
        `End moves to ${formatDateTime(newEnd)}.`,
        'Everyone in the event gets an announcement.',
      ],
      confirmLabel: 'Delay start',
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
          title: 'Start delayed',
          body: `The game now starts at ${formatTime(iso)} (${formatDuration(delta)} later). Planned end: ${formatTime(newEnd)}.`,
          priority: 'high',
        });
        this.announcementSent.emit(a);
        this.toast.success('Start delayed', 'Players were notified.');
      } catch {
        this.toast.warning('Start delayed, but the announcement failed', 'Send one yourself so players know.');
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
        title: 'Lock registration?',
        consequences: ['New players cannot join or request to join.', 'Pending requests can still be approved.', 'You can unlock it again at any time.'],
        confirmLabel: 'Lock registration',
      });
      if (!ok) return;
    }
    this.busy.set('lock');
    try {
      this.eventChange.emit(await this.api.updateEvent(e.id, { registrationLocked: lock }));
      this.toast.success(lock ? 'Registration locked' : 'Registration open');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(null);
    }
  }

  protected async cancelEvent(): Promise<void> {
    const e = this.event();
    const reason = await this.confirm.askReason({
      title: `Cancel ${e.name}?`,
      consequences: [
        `${this.players().length} registered players and ${this.pending().length} pending requests are notified with your reason.`,
        'The event cannot be started any more.',
        'No location is tracked.',
      ],
      reason: { label: 'Reason shown to players', required: true, placeholder: 'e.g. Storm warning for the field' },
      confirmLabel: 'Cancel event',
      cancelLabel: 'Keep event',
      destructive: true,
    });
    if (reason === null) return;
    this.busy.set('cancel');
    try {
      this.eventChange.emit(await this.api.setEventStatus(e.id, 'cancelled', reason));
      this.toast.info('Event cancelled');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(null);
    }
  }

  protected async review(m: Member, approve: boolean): Promise<void> {
    if (!approve) {
      const ok = await this.confirm.ask({
        title: `Reject ${m.nickname}?`,
        consequences: [`${m.nickname} is notified that the request was declined.`, 'They cannot join unless you invite them later.'],
        confirmLabel: 'Reject request',
        destructive: true,
      });
      if (!ok) return;
    }
    this.reviewing.set(m.userId);
    try {
      await this.api.reviewMember(this.event().id, m.userId, approve);
      this.toast.success(approve ? `${m.nickname} approved` : `${m.nickname} rejected`);
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
    if (!v.title.trim()) errors['title'] = 'Enter a title.';
    if (v.scope === 'team' && !v.teamId) errors['teamId'] = 'Choose the team.';
    this.announceErrors.set(errors);
    if (Object.keys(errors).length) return;

    const team = this.event().teams.find((t) => t.id === v.teamId);
    if (v.priority === 'emergency') {
      const ok = await this.confirm.ask({
        title: 'Send an emergency message?',
        consequences: [
          v.scope === 'team' ? `Every phone in ${team?.name} sounds an alert.` : 'Every phone in the event sounds an alert.',
          'Use emergency only for safety: injuries, stop of play, evacuation.',
        ],
        confirmLabel: 'Send emergency',
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
      this.toast.success(v.scope === 'team' ? `Sent to ${team?.name}` : 'Announcement sent');
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
