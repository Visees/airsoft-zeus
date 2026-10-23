import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { ApiService } from '../../../core/api/api.service';
import { ApiError } from '../../../core/api/api-error';
import { Announcement, AnnouncementRequest, Member, Priority, Team, Uuid } from '../../../core/api/models';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { ToastService } from '../../../core/ui/toast.service';
import { applyServerErrors, controlError } from './forms';

type Scope = AnnouncementRequest['scope'];

const EMERGENCY_PRESETS = [
  { label: $localize`Ceasefire`, title: $localize`CEASEFIRE`, body: $localize`Stop playing now. Point your replica at the ground, put your eye protection on and wait for instructions.` },
  { label: $localize`Medical`, title: $localize`MEDICAL EMERGENCY`, body: $localize`Stop playing now. Stay where you are, keep eye protection on and keep the access routes clear for the medics.` },
  { label: $localize`Evacuate`, title: $localize`EVACUATE THE FIELD`, body: $localize`Stop playing and walk to the safe zone now. Eye protection stays on until you reach it.` },
];

/**
 * Announcement / private message / emergency alert form for Game Masters.
 * Host it inside an OpsDialog with `@if (open)` so it starts fresh.
 */
@Component({
  selector: 'ah-announce-form',
  imports: [ReactiveFormsModule, NgIcon, HlmButton, HlmInput, HlmLabel, HlmTextarea],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-4" novalidate>
      @if (emergency()) {
        <div class="flex gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm" role="note">
          <ng-icon name="lucideSiren" size="18" class="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          <p i18n>Sent to <strong>everyone in the event</strong> with emergency priority (sound and vibration; also as a push notification when players enabled them).</p>
        </div>
        <div class="flex flex-wrap gap-1.5">
          @for (p of presets; track p.label) {
            <button hlmBtn type="button" size="sm" variant="outline" class="h-10" (click)="usePreset(p)">{{ p.label }}</button>
          }
        </div>
      } @else {
        <fieldset>
          <legend class="mb-1.5 text-sm font-medium" i18n>Send to</legend>
          <div class="grid grid-cols-3 gap-2">
            @for (s of scopes; track s.value) {
              <label class="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border px-2 text-sm has-checked:border-primary has-checked:bg-primary/10">
                <input type="radio" formControlName="scope" [value]="s.value" class="size-4 accent-primary" /> {{ s.label }}
              </label>
            }
          </div>
        </fieldset>
        @if (scope() === 'team') {
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="ann-team" i18n>Team</label>
            <select id="ann-team" formControlName="teamId" class="h-11 w-full rounded-md border border-input bg-transparent px-2 dark:bg-input/30">
              <option value="" disabled i18n>Choose a team</option>
              @for (t of teams(); track t.id) {
                <option [value]="t.id">{{ t.name }}</option>
              }
            </select>
            @if (err('teamId', 'Team'); as e) {
              <p class="field-error">{{ e }}</p>
            }
          </div>
        }
        @if (scope() === 'player') {
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="ann-user" i18n>Player</label>
            <select id="ann-user" formControlName="targetUserId" class="h-11 w-full rounded-md border border-input bg-transparent px-2 dark:bg-input/30">
              <option value="" disabled i18n>Choose a player</option>
              @for (m of players(); track m.userId) {
                <option [value]="m.userId">{{ m.nickname }}</option>
              }
            </select>
            @if (err('targetUserId', 'Player'); as e) {
              <p class="field-error">{{ e }}</p>
            }
          </div>
        }
        <fieldset>
          <legend class="mb-1.5 text-sm font-medium" i18n>Priority</legend>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm has-checked:border-primary has-checked:bg-primary/10">
              <input type="radio" formControlName="priority" value="normal" class="size-4 accent-primary" /> <ng-container i18n>Normal</ng-container>
            </label>
            <label class="flex h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm has-checked:border-warning has-checked:bg-warning-surface">
              <input type="radio" formControlName="priority" value="high" class="size-4 accent-primary" /> <ng-container i18n>High <span class="text-xs text-muted-foreground">(sound + banner)</span></ng-container>
            </label>
          </div>
        </fieldset>
      }

      <div class="flex flex-col gap-1.5">
        <label hlmLabel for="ann-title"><ng-container i18n>Title</ng-container> <span aria-hidden="true">*</span></label>
        <input hlmInput id="ann-title" formControlName="title" class="h-11" maxlength="80" autocomplete="off" />
        @if (err('title', 'Title'); as e) {
          <p class="field-error">{{ e }}</p>
        }
      </div>
      <div class="flex flex-col gap-1.5">
        <label hlmLabel for="ann-body"><ng-container i18n>Message</ng-container> @if (emergency()) {<span aria-hidden="true">*</span>}</label>
        <textarea hlmTextarea id="ann-body" formControlName="body" rows="3" maxlength="500"></textarea>
        @if (err('body', 'Message'); as e) {
          <p class="field-error">{{ e }}</p>
        }
      </div>

      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button hlmBtn type="button" variant="outline" class="h-11" (click)="cancel.emit()" i18n>Cancel</button>
        <button
          hlmBtn
          type="submit"
          class="h-11"
          [class]="emergency() ? 'bg-destructive! text-destructive-foreground! hover:bg-destructive/85!' : ''"
          [disabled]="sending()"
        >
          <ng-icon [name]="emergency() ? 'lucideSiren' : 'lucideMegaphone'" size="16" aria-hidden="true" />
          {{ sending() ? txt.sending : submitLabel() }}
        </button>
      </div>
    </form>
  `,
})
export class AnnounceForm implements OnInit {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    sending: $localize`Sending…`,
  };

  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly eventId = input.required<Uuid>();
  readonly teams = input<Team[]>([]);
  readonly members = input<Member[]>([]);
  readonly emergency = input(false);
  readonly presetScope = input<Scope>('all');
  readonly presetTeamId = input<Uuid | null>(null);
  readonly presetUserId = input<Uuid | null>(null);

  readonly sent = output<Announcement>();
  readonly cancel = output<void>();

  protected readonly presets = EMERGENCY_PRESETS;
  protected readonly scopes: { value: Scope; label: string }[] = [
    { value: 'all', label: $localize`Everyone` },
    { value: 'team', label: $localize`Team` },
    { value: 'player', label: $localize`Player` },
  ];
  protected readonly sending = signal(false);

  protected readonly form = new FormGroup({
    scope: new FormControl<Scope>('all', { nonNullable: true }),
    teamId: new FormControl('', { nonNullable: true }),
    targetUserId: new FormControl('', { nonNullable: true }),
    priority: new FormControl<Priority>('normal', { nonNullable: true }),
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    body: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });

  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly scope = computed(() => this.value().scope);
  protected readonly players = computed(() =>
    this.members()
      .filter((m) => m.status === 'approved' && m.role === 'player')
      .sort((a, b) => a.nickname.localeCompare(b.nickname)),
  );
  protected readonly submitLabel = computed(() => {
    if (this.emergency()) return $localize`Send emergency alert`;
    const v = this.value();
    if (v.scope === 'team') return $localize`Send to ${this.teams().find((t) => t.id === v.teamId)?.name ?? 'team'}:name:`;
    if (v.scope === 'player') return $localize`Send to ${this.members().find((m) => m.userId === v.targetUserId)?.nickname ?? 'player'}:nickname:`;
    return $localize`Send to everyone`;
  });

  ngOnInit(): void {
    this.form.reset({
      scope: this.emergency() ? 'all' : this.presetScope(),
      teamId: this.presetTeamId() ?? '',
      targetUserId: this.presetUserId() ?? '',
      priority: this.emergency() ? 'emergency' : 'normal',
      title: '',
      body: '',
    });
  }

  protected err(path: string, label: string): string | null {
    return controlError(this.form.get(path), label);
  }

  protected usePreset(p: { title: string; body: string }): void {
    this.form.patchValue({ title: p.title, body: p.body });
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    if (v.scope === 'team' && !v.teamId) this.form.controls.teamId.setErrors({ required: true });
    if (v.scope === 'player' && !v.targetUserId) this.form.controls.targetUserId.setErrors({ required: true });
    if (this.emergency() && !v.body.trim()) this.form.controls.body.setErrors({ required: true });
    if (!v.title.trim()) this.form.controls.title.setErrors({ required: true });
    if (this.form.invalid) return;

    const body: AnnouncementRequest = {
      scope: this.emergency() ? 'all' : v.scope,
      teamId: v.scope === 'team' ? v.teamId : null,
      targetUserId: v.scope === 'player' ? v.targetUserId : null,
      title: v.title.trim(),
      body: v.body.trim(),
      priority: this.emergency() ? 'emergency' : v.priority,
    };

    if (this.emergency()) {
      const ok = await this.confirm.ask({
        title: $localize`Send emergency alert?`,
        message: `"${body.title}"`,
        consequences: [
          $localize`Every player and Game Master receives it immediately with emergency priority (sound and vibration).`,
          $localize`It cannot be recalled once sent.`,
          $localize`It does not pause the game: pause it too if play must stop.`,
        ],
        confirmLabel: $localize`Send emergency alert`,
        destructive: true,
      });
      if (!ok) return;
    }

    this.sending.set(true);
    try {
      const a = await this.api.sendAnnouncement(this.eventId(), body);
      this.toast.success(this.emergency() ? $localize`Emergency alert sent` : $localize`Announcement sent`, body.title);
      this.sent.emit(a);
    } catch (e) {
      const err = ApiError.from(e);
      applyServerErrors(this.form, err);
      this.toast.error(err);
    } finally {
      this.sending.set(false);
    }
  }
}
