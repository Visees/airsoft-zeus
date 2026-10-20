import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Bullet list spelling out the consequences ("Team Alpha loses 150 points"). */
  consequences?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  destructive?: boolean;
  /** User must type this exact text to enable the confirm button (e.g. "DELETE"). */
  requireText?: string;
  /** Show a reason field; confirm returns the reason. */
  reason?: { label: string; required: boolean; placeholder?: string };
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (result: { confirmed: boolean; reason: string }) => void;
}

/**
 * Promise-based confirmation dialog. The <zeus-confirm-host> in App renders it.
 *
 *   if (await confirm.ask({ title: 'End game?', destructive: true })) { ... }
 *   const reason = await confirm.askReason({ title: 'Remove player', reason: { label: 'Reason', required: true } });
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly current = signal<ConfirmRequest | null>(null);

  async ask(options: ConfirmOptions): Promise<boolean> {
    return (await this.open(options)).confirmed;
  }

  /** Resolves with the reason text, or null when cancelled. */
  async askReason(options: ConfirmOptions & { reason: NonNullable<ConfirmOptions['reason']> }): Promise<string | null> {
    const res = await this.open(options);
    return res.confirmed ? res.reason : null;
  }

  private open(options: ConfirmOptions): Promise<{ confirmed: boolean; reason: string }> {
    // Only one at a time: cancel any open dialog.
    this.current()?.resolve({ confirmed: false, reason: '' });
    return new Promise((resolve) => {
      this.current.set({
        ...options,
        resolve: (r) => {
          this.current.set(null);
          resolve(r);
        },
      });
    });
  }
}
