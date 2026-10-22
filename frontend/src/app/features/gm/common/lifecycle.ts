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
    add('published', $localize`Publish`, 'lucideEye', 'default');
    add('registration_open', $localize`Open registration`, 'lucideUserPlus');
  } else if (status === 'published') {
    add('registration_open', $localize`Open registration`, 'lucideUserPlus', 'default');
    add('lobby', $localize`Open lobby`, 'lucideUsers');
    add('draft', $localize`Back to draft`, 'lucideEyeOff');
  } else if (status === 'registration_open') {
    add('lobby', $localize`Open lobby`, 'lucideUsers', 'default');
    add('published', $localize`Close registration`, 'lucideLock');
  } else if (status === 'lobby') {
    add('registration_open', $localize`Reopen registration`, 'lucideLockOpen');
  } else if (status === 'cancelled') {
    add('draft', $localize`Restore as draft`, 'lucideRotateCcw', 'default');
  }
  add('cancelled', $localize`Cancel event`, 'lucideBan', 'destructive');
  return out;
}

function consequencesFor(event: EventDetail, to: EventStatus): { title: string; message: string; consequences: string[]; confirmLabel: string } {
  const players = event.approvedCount;
  switch (to) {
    case 'published':
      return {
        title: $localize`Publish ${event.name}:name:?`,
        message: $localize`Players can see the event and its details.`,
        consequences: [
          event.visibility === 'public' ? $localize`It appears in Discover for everyone.` : $localize`Only people with the join code or an invitation can find it.`,
          $localize`Registration stays closed until you open it.`,
        ],
        confirmLabel: $localize`Publish`,
      };
    case 'registration_open':
      return {
        title: $localize`Open registration?`,
        message: $localize`Players can join the event now.`,
        consequences: [
          event.requiresApproval ? $localize`Each request waits for your approval.` : $localize`Players are approved automatically.`,
          $localize`Up to ${event.maxPlayers}:maxPlayers: players can register.`,
        ],
        confirmLabel: $localize`Open registration`,
      };
    case 'lobby':
      return {
        title: $localize`Open the lobby?`,
        message: $localize`Approved players move to the pre-game lobby to get ready.`,
        consequences: [$localize`${players}:players: approved players are notified.`, $localize`New registrations are closed.`, $localize`Start the game from the control center when everyone is ready.`],
        confirmLabel: $localize`Open lobby`,
      };
    case 'draft':
      return {
        title: $localize`Back to draft?`,
        message: $localize`The event is hidden from players until you publish it again.`,
        consequences: [$localize`It disappears from Discover.`, $localize`Registered players keep their place.`],
        confirmLabel: $localize`Back to draft`,
      };
    default:
      return {
        title: $localize`Change status to ${EVENT_STATUS_LABELS[to]}:to:?`,
        message: '',
        consequences: [],
        confirmLabel: $localize`Confirm`,
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
        title: $localize`Cancel ${event.name}:name:?`,
        message: $localize`Players see the event as cancelled.`,
        consequences: [
          $localize`${event.approvedCount}:approvedCount: approved and ${event.pendingCount}:pendingCount: pending players are notified with your reason.`,
          $localize`The event cannot be played; you can restore it as a draft later.`,
        ],
        destructive: true,
        confirmLabel: $localize`Cancel event`,
        cancelLabel: $localize`Keep event`,
        reason: { label: $localize`Reason shown to players`, required: true, placeholder: $localize`Field closed after storm damage` },
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
      toast.success($localize`Status: ${EVENT_STATUS_LABELS[updated.status]}:status:`);
      return updated;
    } catch (err) {
      const e = ApiError.from(err);
      if (e.code === 'not_enough_teams') toast.error($localize`Create at least two teams first.`);
      else if (e.code === 'invalid_transition') toast.error($localize`That status change is not possible right now. Reload to see the current status.`);
      else toast.error(e);
      return null;
    }
  };
}
