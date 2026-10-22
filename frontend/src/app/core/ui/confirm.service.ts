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
  /** Radio options; confirm returns the picked value. The first one is preselected. */
  choices?: ConfirmChoice[];
}

export interface ConfirmChoice {
  value: string;
  label: string;
  hint?: string;
  /** Replaces confirmLabel while this option is picked. */
  confirmLabel?: string;
}

export interface ConfirmResult {
  confirmed: boolean;
  reason: string;
  choice: string | null;
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (result: ConfirmResult) => void;
}

/**
 * Promise-based confirmation dialog. The <zeus-confirm-host> in App renders it.
 *
 *   if (await confirm.ask({ title: 'End game?', destructive: true })) { ... }
 *   const reason = await confirm.askReason({ title: 'Remove player', reason: { label: 'Reason', required: true } });
 *   const res = await confirm.askChoice({ title: 'Remove player', choices: [{ value: 'remove', label: 'Remove' }, { value: 'ban', label: 'Ban' }] });
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

  /** Resolves with the picked choice and the reason text, or null when cancelled. */
  async askChoice<T extends string>(
    options: ConfirmOptions & { choices: (ConfirmChoice & { value: T })[] },
  ): Promise<{ choice: T; reason: string } | null> {
    const res = await this.open(options);
    return res.confirmed ? { choice: res.choice as T, reason: res.reason } : null;
  }

  private open(options: ConfirmOptions): Promise<ConfirmResult> {
    // Only one at a time: cancel any open dialog.
    this.current()?.resolve({ confirmed: false, reason: '', choice: null });
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
