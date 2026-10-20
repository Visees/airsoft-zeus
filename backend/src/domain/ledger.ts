import type { Tx } from '../db.js';
import { conflict } from '../errors.js';
import { hub } from '../realtime/hub.js';
import type { Scoring } from './defaults.js';

export type LedgerKind = 'points' | 'currency';
export type LedgerType =
  | 'starting_balance'
  | 'capture'
  | 'capture_bonus'
  | 'recurring'
  | 'defense_bonus'
  | 'completion_bonus'
  | 'gm_adjustment'
  | 'penalty'
  | 'perk_purchase'
  | 'perk_refund'
  | 'theft_in'
  | 'theft_out'
  | 'capture_revoked';

export interface LedgerInput {
  eventId: string;
  teamId: string;
  kind: LedgerKind;
  type: LedgerType;
  amount: number;
  scoring: Scoring;
  userId?: string | null;
  objectiveId?: string | null;
  perkId?: string | null;
  purchaseId?: string | null;
  captureId?: string | null;
  reason?: string;
  actorId?: string | null;
  clientTxId?: string | null;
  /** Fail instead of clamping when the balance is too low (purchases). */
  requireFunds?: boolean;
}

export interface LedgerResult {
  applied: number;
  balance: number;
}

/**
 * The only way team points or currency change. Locks the team row, clamps the new balance
 * (currency ≥ 0 and ≤ maxCurrency; points ≥ 0 unless negative points are allowed), writes an
 * append-only ledger entry with the requested and the applied amount, and updates the
 * player's contribution counters.
 */
export async function applyLedger(t: Tx, input: LedgerInput): Promise<LedgerResult> {
  const amount = Math.trunc(input.amount);
  const { rows } = await t.query<{ points: number; currency: number }>('SELECT points, currency FROM teams WHERE id = $1 AND event_id = $2 FOR UPDATE', [
    input.teamId,
    input.eventId,
  ]);
  const team = rows[0];
  if (!team) throw conflict('Team not found in this event.', 'team_not_found');
  const current = input.kind === 'points' ? Number(team.points) : Number(team.currency);

  let next = current + amount;
  if (input.kind === 'currency') {
    if (input.requireFunds && next < 0) throw conflict('Your team does not have enough credits.', 'insufficient_funds');
    next = Math.max(0, next);
    if (input.scoring.maxCurrency > 0) next = Math.min(input.scoring.maxCurrency, next);
  } else if (!input.scoring.allowNegativePoints) {
    next = Math.max(0, next);
  }
  const applied = next - current;

  if (applied !== 0) {
    await t.query(`UPDATE teams SET ${input.kind === 'points' ? 'points' : 'currency'} = $1 WHERE id = $2`, [next, input.teamId]);
  }
  // Log even zero-applied requests (e.g. clamped at the cap) so GMs can see what happened.
  await t.query(
    `INSERT INTO ledger_entries (event_id, team_id, kind, type, amount, requested, balance_after, user_id, objective_id, perk_id, purchase_id,
                                 capture_id, reason, actor_id, client_tx_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      input.eventId,
      input.teamId,
      input.kind,
      input.type,
      applied,
      amount,
      next,
      input.userId ?? null,
      input.objectiveId ?? null,
      input.perkId ?? null,
      input.purchaseId ?? null,
      input.captureId ?? null,
      input.reason ?? '',
      input.actorId ?? null,
      input.clientTxId ?? null,
    ],
  );

  if (input.userId && applied !== 0 && ['capture', 'capture_bonus', 'completion_bonus', 'recurring', 'defense_bonus', 'capture_revoked'].includes(input.type)) {
    const col = input.kind === 'points' ? 'points' : 'currency_earned';
    await t.query(`UPDATE event_members SET ${col} = GREATEST(0, ${col} + $1) WHERE event_id = $2 AND user_id = $3`, [applied, input.eventId, input.userId]);
  }

  t.afterCommit(() => {
    hub.teams(input.eventId);
    // Perk availability (insufficient_funds) is computed against the team balance, so refresh it too.
    hub.invalidate(input.eventId, input.kind === 'currency' ? ['ledger', 'perks'] : ['ledger'], ['gm', { teamId: input.teamId }]);
  });
  return { applied, balance: next };
}
