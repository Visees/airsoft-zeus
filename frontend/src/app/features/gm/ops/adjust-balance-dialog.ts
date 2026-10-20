import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiService } from '../../../core/api/api.service';
import { ApiError } from '../../../core/api/api-error';
import { LedgerKind, Member, Team, Uuid } from '../../../core/api/models';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { ToastService } from '../../../core/ui/toast.service';
import { formatNumber, formatSigned } from '../../../core/util/format';
import { newClientTxId } from '../../../core/util/ids';
import { TeamBadge } from '../../../shared/team-badge';
import { applyServerErrors, controlError, num } from './forms';
import { OpsDialog } from './ops-dialog';

export interface BalanceAdjusted {
  teamId: Uuid;
  kind: LedgerKind;
  balance: number;
  applied: number;
}

/**
 * GM adjustment of a team's victory points or credits (bonus, penalty, correction).
 * Shows the resulting balance before submitting, goes through the confirm dialog and sends a
 * clientTxId that is kept across retries of the same values (idempotent on the server).
 */
@Component({
  selector: 'zeus-adjust-balance-dialog',
  imports: [ReactiveFormsModule, NgIcon, HlmButton, HlmInput, HlmLabel, OpsDialog, TeamBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <zeus-ops-dialog [open]="open()" title="Adjust points or credits" subtitle="Every change is written to the ledger with your name and reason." (closed)="closed.emit()">
      @if (open()) {
        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-4" novalidate>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="adj-team">Team</label>
            <select id="adj-team" formControlName="teamId" class="h-11 w-full rounded-md border border-input bg-transparent px-2 dark:bg-input/30">
              <option value="" disabled>Choose a team</option>
              @for (t of teams(); track t.id) {
                <option [value]="t.id">{{ t.name }}</option>
              }
            </select>
            @if (err('teamId', 'Team'); as e) {
              <p class="field-error">{{ e }}</p>
            }
          </div>

          <fieldset class="flex flex-col gap-1.5">
            <legend class="mb-1.5 text-sm font-medium">Balance</legend>
            <div class="grid grid-cols-2 gap-2" role="radiogroup">
              <label class="flex h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 has-checked:border-primary has-checked:bg-primary/10">
                <input type="radio" formControlName="kind" value="points" class="size-4 accent-primary" />
                <ng-icon name="lucideTrophy" size="16" class="text-primary" aria-hidden="true" /> Victory points
              </label>
              <label class="flex h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 has-checked:border-primary has-checked:bg-primary/10">
                <input type="radio" formControlName="kind" value="currency" class="size-4 accent-primary" />
                <ng-icon name="lucideCoins" size="16" class="text-warning" aria-hidden="true" /> Credits
              </label>
            </div>
          </fieldset>

          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="adj-amount">Amount (negative to deduct)</label>
            <div class="flex gap-2">
              <button hlmBtn type="button" variant="outline" class="h-11 w-14 num" (click)="flipSign()" aria-label="Switch between adding and deducting">±</button>
              <input hlmInput id="adj-amount" type="number" inputmode="numeric" step="1" formControlName="amount" class="num h-11" placeholder="e.g. -150" />
            </div>
            <div class="flex flex-wrap gap-1.5">
              @for (q of quick; track q) {
                <button hlmBtn type="button" size="sm" variant="secondary" class="num h-10 min-w-12" (click)="setAmount(q)">{{ signed(q) }}</button>
              }
            </div>
            @if (err('amount', 'Amount'); as e) {
              <p class="field-error">{{ e }}</p>
            }
          </div>

          @if (amountValue() < 0) {
            <label class="flex min-h-11 cursor-pointer items-center gap-3">
              <input type="checkbox" formControlName="penalty" class="size-5 accent-primary" />
              <span>Record as a penalty <span class="text-sm text-muted-foreground">(shown as "Penalty" in the ledger and results)</span></span>
            </label>
          }

          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="adj-reason">Reason <span aria-hidden="true">*</span></label>
            <input hlmInput id="adj-reason" formControlName="reason" class="h-11" placeholder="e.g. Safety violation at the north gate" maxlength="200" autocomplete="off" />
            @if (err('reason', 'Reason'); as e) {
              <p class="field-error">{{ e }}</p>
            }
          </div>

          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="adj-user">Player (optional)</label>
            <select id="adj-user" formControlName="userId" class="h-11 w-full rounded-md border border-input bg-transparent px-2 dark:bg-input/30">
              <option value="">Whole team</option>
              @for (m of teamMembers(); track m.userId) {
                <option [value]="m.userId">{{ m.nickname }}</option>
              }
            </select>
          </div>

          @if (preview(); as p) {
            <div class="rounded-md border border-border bg-muted p-3 text-sm" aria-live="polite">
              <div class="flex flex-wrap items-center gap-2">
                <zeus-team-badge [team]="p.team" size="sm" />
                <span class="num">{{ p.current }} → <strong>{{ p.next }}</strong> {{ p.unit }}</span>
              </div>
              @if (p.clampNote) {
                <p class="mt-1 text-warning">{{ p.clampNote }}</p>
              }
            </div>
          }

          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button hlmBtn type="button" variant="outline" class="h-11" (click)="closed.emit()">Cancel</button>
            <button hlmBtn type="submit" class="h-11" [disabled]="saving()">
              {{ saving() ? 'Saving…' : 'Review and apply' }}
            </button>
          </div>
        </form>
      }
    </zeus-ops-dialog>
  `,
})
export class AdjustBalanceDialog {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly eventId = input.required<Uuid>();
  readonly teams = input.required<Team[]>();
  readonly members = input<Member[]>([]);
  readonly open = input(false);
  readonly presetTeamId = input<Uuid | null>(null);
  readonly presetUserId = input<Uuid | null>(null);
  readonly presetKind = input<LedgerKind>('points');
  readonly allowNegativePoints = input(false);
  /** 0 = no cap */
  readonly maxCurrency = input(0);

  readonly closed = output<void>();
  readonly adjusted = output<BalanceAdjusted>();

  protected readonly quick = [-100, -50, -10, 10, 50, 100];
  protected readonly saving = signal(false);
  private txId = newClientTxId();

  protected readonly form = new FormGroup({
    teamId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    kind: new FormControl<LedgerKind>('points', { nonNullable: true }),
    amount: new FormControl<number | null>(null, { validators: [Validators.required] }),
    reason: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
    penalty: new FormControl(false, { nonNullable: true }),
    userId: new FormControl('', { nonNullable: true }),
  });

  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly amountValue = computed(() => num(this.value().amount ?? null));

  protected readonly teamMembers = computed(() => {
    const teamId = this.value().teamId;
    return this.members().filter((m) => m.teamId === teamId && m.role === 'player' && m.status === 'approved');
  });

  protected readonly preview = computed(() => {
    const v = this.value();
    const team = this.teams().find((t) => t.id === v.teamId);
    const amount = num(v.amount ?? null);
    if (!team || !amount) return null;
    const isPoints = v.kind === 'points';
    const current = isPoints ? team.points : (team.currency ?? 0);
    let next = current + amount;
    let clampNote: string | null = null;
    if (next < 0 && (!isPoints || !this.allowNegativePoints())) {
      clampNote = `The balance can't go below 0: only ${formatNumber(current)} will be deducted.`;
      next = 0;
    } else if (!isPoints && this.maxCurrency() > 0 && next > this.maxCurrency()) {
      clampNote = `Credits are capped at ${formatNumber(this.maxCurrency())}: only ${formatNumber(this.maxCurrency() - current)} will be added.`;
      next = this.maxCurrency();
    }
    return { team, current: formatNumber(current), next: formatNumber(next), unit: isPoints ? 'points' : 'credits', clampNote };
  });

  constructor() {
    // Reset the form each time the dialog opens; a new intent gets a new clientTxId.
    effect(() => {
      if (!this.open()) return;
      const teamId = this.presetTeamId() ?? '';
      const userId = this.presetUserId() ?? '';
      const kind = this.presetKind();
      untracked(() => {
        this.form.reset({ teamId, kind, amount: null, reason: '', penalty: false, userId });
        this.txId = newClientTxId();
        this.saving.set(false);
      });
    });
    // Changing the values is a different intent; retrying the same values reuses the id.
    this.form.valueChanges.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => {
      if (!this.saving()) this.txId = newClientTxId();
    });
  }

  protected err(path: string, label: string): string | null {
    return controlError(this.form.get(path), label);
  }

  protected signed(n: number): string {
    return formatSigned(n);
  }

  protected setAmount(n: number): void {
    this.form.controls.amount.setValue(n);
    this.form.controls.amount.markAsDirty();
  }

  protected flipSign(): void {
    const v = this.form.controls.amount.value;
    if (typeof v === 'number') this.form.controls.amount.setValue(-v);
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    const amount = Math.trunc(num(v.amount));
    if (!amount) this.form.controls.amount.setErrors({ message: 'Enter an amount other than 0.' });
    if (!v.reason.trim()) this.form.controls.reason.setErrors({ required: true });
    if (this.form.invalid || !amount) return;

    const team = this.teams().find((t) => t.id === v.teamId)!;
    const unit = v.kind === 'points' ? 'points' : 'credits';
    const p = this.preview();
    const member = this.members().find((m) => m.userId === v.userId);
    const consequences = [
      `${team.name} ${amount > 0 ? 'gets' : 'loses'} ${formatNumber(Math.abs(amount))} ${unit}.`,
      `New balance: ${p?.next ?? '—'} ${unit}${p?.clampNote ? ' (' + p.clampNote + ')' : ''}.`,
      `Logged as ${amount < 0 && v.penalty ? 'a penalty' : 'a GM adjustment'}${member ? ' for ' + member.nickname : ''}: "${v.reason.trim()}".`,
      'Players see the new balance immediately.',
    ];
    const ok = await this.confirm.ask({
      title: `${amount > 0 ? 'Add' : 'Deduct'} ${formatNumber(Math.abs(amount))} ${unit}?`,
      consequences,
      confirmLabel: `${amount > 0 ? 'Add' : 'Deduct'} ${unit}`,
      destructive: amount < 0,
    });
    if (!ok) return;

    this.saving.set(true);
    try {
      const res = await this.api.adjustBalance(this.eventId(), {
        teamId: v.teamId,
        kind: v.kind,
        amount,
        reason: v.reason.trim(),
        penalty: amount < 0 ? v.penalty : false,
        userId: v.userId || null,
        clientTxId: this.txId,
      });
      if (res.applied !== amount) {
        this.toast.warning(`${team.name}: ${formatSigned(res.applied)} ${unit} applied`, `${formatSigned(amount)} requested; balance limits applied. New balance ${formatNumber(res.balance)}.`);
      } else {
        this.toast.success(`${team.name}: ${formatSigned(res.applied)} ${unit}`, `New balance ${formatNumber(res.balance)}.`);
      }
      this.adjusted.emit({ teamId: v.teamId, kind: v.kind, balance: res.balance, applied: res.applied });
      this.txId = newClientTxId();
      this.closed.emit();
    } catch (e) {
      const err = ApiError.from(e);
      applyServerErrors(this.form, err);
      this.toast.error(err);
    } finally {
      this.saving.set(false);
    }
  }
}
