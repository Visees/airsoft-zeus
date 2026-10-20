import { inject, signal } from '@angular/core';
import { ApiService } from '../../core/api/api.service';
import { ApiError } from '../../core/api/api-error';
import { CaptureResult, Uuid } from '../../core/api/models';
import { LiveStore } from '../../core/live/live-store';
import { newClientTxId } from '../../core/util/ids';
import { vibrate } from './live-util';

export type CaptureState = 'idle' | 'pending' | 'success' | 'error';

export interface CaptureInput {
  method: 'code' | 'qr';
  code?: string;
  qrPayload?: string;
}

/**
 * One capture attempt (code or QR) with the rules the live screens share:
 *
 * - The clientTxId is created once per attempt and reused when the same attempt is retried
 *   after a network or server (5xx) error, so the server never counts it twice.
 * - A definitive answer (any 4xx) clears it: the next submit is a new attempt.
 * - Changing the code/payload starts a new attempt.
 * - Success is shown only after the server confirmed it.
 *
 * Create it in a component field initializer (it uses inject()).
 */
export class CaptureAttempt {
  private readonly api = inject(ApiService);
  private readonly store = inject(LiveStore);

  readonly state = signal<CaptureState>('idle');
  readonly result = signal<CaptureResult | null>(null);
  readonly error = signal<ApiError | null>(null);
  /** The last error left the attempt open: "Try again" reuses the same clientTxId. */
  readonly retryable = signal(false);
  readonly objectiveId = signal<Uuid | null>(null);

  private txId: string | null = null;
  private txKey: string | null = null;

  async submit(objectiveId: Uuid, input: CaptureInput): Promise<boolean> {
    const eventId = this.store.eventId();
    if (!eventId || this.state() === 'pending') return false;
    const key = `${objectiveId}|${input.method}|${input.code ?? input.qrPayload ?? ''}`;
    if (!this.txId || this.txKey !== key) {
      this.txId = newClientTxId();
      this.txKey = key;
    }
    this.objectiveId.set(objectiveId);
    this.state.set('pending');
    this.error.set(null);
    this.result.set(null);
    this.retryable.set(false);
    try {
      const res = await this.api.capture(eventId, objectiveId, { ...input, clientTxId: this.txId });
      this.txId = null;
      this.txKey = null;
      this.result.set(res);
      this.state.set('success');
      vibrate(res.captured ? [90, 60, 220] : 60);
      this.store.refresh('objectives', 'captures');
      return true;
    } catch (e) {
      const err = ApiError.from(e);
      const transient = err.isNetwork || err.status >= 500 || err.status < 0;
      if (!transient) {
        this.txId = null;
        this.txKey = null;
      }
      this.retryable.set(transient);
      this.error.set(err);
      this.state.set('error');
      vibrate([40, 50, 40]);
      return false;
    }
  }

  /** Back to idle. Keeps the clientTxId of an unconfirmed attempt unless `forget`. */
  reset(forget = false): void {
    if (this.state() === 'pending') return;
    this.state.set('idle');
    this.error.set(null);
    this.result.set(null);
    this.retryable.set(false);
    if (forget) {
      this.txId = null;
      this.txKey = null;
    }
  }
}

/** User-facing text for a capture failure. */
export function captureErrorMessage(err: ApiError): string {
  if (err.isNetwork) return 'No connection — the capture was NOT confirmed. Try again when you have signal; it will not be counted twice.';
  if (err.status >= 500) return 'The server did not confirm the capture. Try again; it will not be counted twice.';
  if (err.status === 429) return err.message || 'Too many attempts. Wait a moment before trying again.';
  return err.message;
}
