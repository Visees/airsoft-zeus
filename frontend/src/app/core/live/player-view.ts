import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { Uuid } from '../api/models';

/**
 * Events whose player screens are open. A Game Master who plays on a team sees those screens
 * as their team does: `/api/events/<id>/…` requests carry `X-AirsoftHub-View: player` and the socket
 * subscribes with `{ view: 'player' }`. The server ignores both for everyone else, so the
 * live shell can always ask for it.
 */
@Injectable({ providedIn: 'root' })
export class PlayerViewService {
  private readonly ids = new Set<Uuid>();
  /** Emits the event id whose view changed (synchronously, so the socket re-subscribes at once). */
  readonly changes = new Subject<Uuid>();

  has(eventId: Uuid): boolean {
    return this.ids.has(eventId);
  }

  enter(eventId: Uuid): void {
    if (this.ids.has(eventId)) return;
    this.ids.add(eventId);
    this.changes.next(eventId);
  }

  leave(eventId: Uuid): void {
    if (this.ids.delete(eventId)) this.changes.next(eventId);
  }
}

const EVENT_URL = /^\/api\/events\/([0-9a-f-]{36})(?:[/?]|$)/i;

export const playerViewInterceptor: HttpInterceptorFn = (req, next) => {
  const id = EVENT_URL.exec(req.url)?.[1];
  if (!id || !inject(PlayerViewService).has(id)) return next(req);
  return next(req.clone({ setHeaders: { 'X-AirsoftHub-View': 'player' } }));
};
