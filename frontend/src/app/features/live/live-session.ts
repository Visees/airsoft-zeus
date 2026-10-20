import { Injectable, signal } from '@angular/core';
import { Uuid } from '../../core/api/models';
import { safeStorage } from '../../core/util/storage';

const STOPPED_KEY = 'zeus.live.sharingStopped';

/**
 * Player choices about location sharing that must survive navigation between the live
 * screens (and, for "stop sharing", a page reload): the shell decides whether to run the
 * tracker from these, the More screen changes them.
 */
@Injectable({ providedIn: 'root' })
export class LiveSession {
  /** Events where the player tapped "Stop sharing my location". Persisted so a reload never resumes silently. */
  private readonly stopped = signal<Record<Uuid, boolean>>(safeStorage.get<Record<Uuid, boolean>>(STOPPED_KEY) ?? {});
  /** Events where the player tapped "Not now" on the consent sheet (this session only). */
  private readonly declined = signal<Record<Uuid, boolean>>({});
  /** Consent given in this session, before the refreshed membership arrives. */
  private readonly consented = signal<Record<Uuid, boolean>>({});

  /** The shell renders the consent / permission sheet while this is true. */
  readonly sheetOpen = signal(false);

  isStopped(eventId: Uuid | null): boolean {
    return !!eventId && !!this.stopped()[eventId];
  }

  setStopped(eventId: Uuid, value: boolean): void {
    this.stopped.update((m) => {
      const next = { ...m };
      if (value) next[eventId] = true;
      else delete next[eventId];
      safeStorage.set(STOPPED_KEY, next);
      return next;
    });
  }

  hasDeclined(eventId: Uuid | null): boolean {
    return !!eventId && !!this.declined()[eventId];
  }

  setDeclined(eventId: Uuid, value: boolean): void {
    this.declined.update((m) => ({ ...m, [eventId]: value }));
  }

  hasConsented(eventId: Uuid | null): boolean {
    return !!eventId && !!this.consented()[eventId];
  }

  markConsented(eventId: Uuid): void {
    this.consented.update((m) => ({ ...m, [eventId]: true }));
  }
}
