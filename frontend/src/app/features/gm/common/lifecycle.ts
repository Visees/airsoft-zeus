import { inject } from '@angular/core';
import { ApiError } from '../../../core/api/api-error';
import { ApiService } from '../../../core/api/api.service';
import { EventDetail, EventStatus } from '../../../core/api/models';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { ToastService } from '../../../core/ui/toast.service';
import { EVENT_STATUS_LABELS } from '../../../core/util/format';

/** Mirrors the server's lifecycle rules (the server is the authority and answers 409 otherwise). */
export const STATUS_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  draft: ['published', 'registration_open', 'cancelled'],
  published: ['registration_open', 'lobby', 'draft', 'cancelled'],
  registration_open: ['lobby', 'published', 'cancelled'],
  lobby: ['live', 'registration_open', 'cancelled'],
  live: ['paused', 'completed'],
  paused: ['live', 'completed'],
  completed: [],
  cancelled: ['draft'],
};

export interface LifecycleAction {
  to: EventStatus;
  label: string;
  icon: string;
  variant: 'default' | 'outline' | 'destructive';
}

/**
 * Setup-side actions for a status. Starting, pausing and ending the game live in the
 * control center, so lobby→live and live/paused transitions are not offered here.
 */
export function lifecycleActions(status: EventStatus): LifecycleAction[] {
  const allowed = STATUS_TRANSITIONS[status];
  const out: LifecycleAction[] = [];
  const add = (to: EventStatus, label: string, icon: string, variant: LifecycleAction['variant'] = 'outline') => {
    if (allowed.includes(to)) out.push({ to, label, icon, variant });
  };
  if (status === 'draft') {
    add('published', 'Publish', 'lucideEye', 'default');
    add('registration_open', 'Open registration', 'lucideUserPlus');
  } else if (status === 'published') {
    add('registration_open', 'Open registration', 'lucideUserPlus', 'default');
    add('lobby', 'Open lobby', 'lucideUsers');
    add('draft', 'Back to draft', 'lucideEyeOff');
  } else if (status === 'registration_open') {
    add('lobby', 'Open lobby', 'lucideUsers', 'default');
    add('published', 'Close registration', 'lucideLock');
  } else if (status === 'lobby') {
    add('registration_open', 'Reopen registration', 'lucideLockOpen');
  } else if (status === 'cancelled') {
    add('draft', 'Restore as draft', 'lucideRotateCcw', 'default');
  }
  add('cancelled', 'Cancel event', 'lucideBan', 'destructive');
  return out;
}

function consequencesFor(event: EventDetail, to: EventStatus): { title: string; message: string; consequences: string[]; confirmLabel: string } {
  const players = event.approvedCount;
  switch (to) {
    case 'published':
      return {
        title: `Publish ${event.name}?`,
        message: 'Players can see the event and its details.',
        consequences: [
          event.visibility === 'public' ? 'It appears in Discover for everyone.' : 'Only people with the join code or an invitation can find it.',
          'Registration stays closed until you open it.',
        ],
        confirmLabel: 'Publish',
      };
    case 'registration_open':
      return {
        title: 'Open registration?',
        message: 'Players can join the event now.',
        consequences: [
          event.requiresApproval ? 'Each request waits for your approval.' : 'Players are approved automatically.',
          `Up to ${event.maxPlayers} players can register.`,
        ],
        confirmLabel: 'Open registration',
      };
    case 'lobby':
      return {
        title: 'Open the lobby?',
        message: 'Approved players move to the pre-game lobby to get ready.',
        consequences: [`${players} approved players are notified.`, 'New registrations are closed.', 'Start the game from the control center when everyone is ready.'],
        confirmLabel: 'Open lobby',
      };
    case 'draft':
      return {
        title: 'Back to draft?',
        message: 'The event is hidden from players until you publish it again.',
        consequences: ['It disappears from Discover.', 'Registered players keep their place.'],
        confirmLabel: 'Back to draft',
      };
    default:
      return {
        title: `Change status to ${EVENT_STATUS_LABELS[to]}?`,
        message: '',
        consequences: [],
        confirmLabel: 'Confirm',
      };
  }
}

/**
 * Asks for confirmation (with consequences, and a reason for cancelling), then calls
 * setEventStatus. Returns the updated event, or null when cancelled or failed.
 */
export function injectLifecycle() {
  const api = inject(ApiService);
  const confirm = inject(ConfirmService);
  const toast = inject(ToastService);

  return async function changeStatus(event: EventDetail, to: EventStatus, opts: { skipConfirm?: boolean } = {}): Promise<EventDetail | null> {
    let reason: string | undefined;
    if (to === 'cancelled') {
      const r = await confirm.askReason({
        title: `Cancel ${event.name}?`,
        message: 'Players see the event as cancelled.',
        consequences: [
          `${event.approvedCount} approved and ${event.pendingCount} pending players are notified with your reason.`,
          'The event cannot be played; you can restore it as a draft later.',
        ],
        destructive: true,
        confirmLabel: 'Cancel event',
        cancelLabel: 'Keep event',
        reason: { label: 'Reason shown to players', required: true, placeholder: 'Field closed after storm damage' },
      });
      if (r === null) return null;
      reason = r;
    } else if (!opts.skipConfirm) {
      const c = consequencesFor(event, to);
      const ok = await confirm.ask({ ...c, consequences: c.consequences.length ? c.consequences : undefined });
      if (!ok) return null;
    }
    try {
      const updated = await api.setEventStatus(event.id, to, reason);
      toast.success(`Status: ${EVENT_STATUS_LABELS[updated.status]}`);
      return updated;
    } catch (err) {
      const e = ApiError.from(err);
      if (e.code === 'not_enough_teams') toast.error('Create at least two teams first.');
      else if (e.code === 'invalid_transition') toast.error('That status change is not possible right now. Reload to see the current status.');
      else toast.error(e);
      return null;
    }
  };
}
