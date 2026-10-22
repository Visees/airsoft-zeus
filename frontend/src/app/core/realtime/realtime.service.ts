import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, NgZone, PLATFORM_ID, effect, inject, signal } from '@angular/core';
import { Observable, Subject, filter, map } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from '../auth/auth.service';
import { PlayerViewService } from '../live/player-view';
import { ConnectivityService } from '../net/connectivity.service';
import { ClientToServerEvents, ServerToClientEvents, SubscribeAck } from './realtime-events';

type EventName = keyof ServerToClientEvents;
type Payload<K extends EventName> = Parameters<ServerToClientEvents[K]>[0];

/**
 * One Socket.IO connection per signed-in session. Reconnects with the current access
 * token and re-subscribes to the event rooms the app is viewing.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly auth = inject(AuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly zone = inject(NgZone);
  private readonly playerView = inject(PlayerViewService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private readonly subscriptions = new Map<string, number>();
  private readonly messages = new Subject<{ name: EventName; payload: unknown }>();
  readonly connected = signal(false);

  constructor() {
    if (!this.isBrowser) return;
    effect(() => {
      const token = this.auth.token();
      if (token && !this.socket) this.connect();
      if (!token && this.socket) this.disconnect();
    });
    // The player screens opened or closed: join the rooms of the new view.
    this.playerView.changes.subscribe((eventId) => {
      if (this.subscriptions.has(eventId)) void this.emitSubscribe(eventId);
    });
  }

  /** Stream of one server event type. */
  on<K extends EventName>(name: K): Observable<Payload<K>> {
    return this.messages.pipe(
      filter((m) => m.name === name),
      map((m) => m.payload as Payload<K>),
    );
  }

  /**
   * Join an event's rooms. Reference counted: several screens can subscribe to the same
   * event; the room is left when the last one unsubscribes.
   */
  subscribe(eventId: string, destroyRef?: DestroyRef): Promise<SubscribeAck> {
    this.subscriptions.set(eventId, (this.subscriptions.get(eventId) ?? 0) + 1);
    destroyRef?.onDestroy(() => this.unsubscribe(eventId));
    return this.emitSubscribe(eventId);
  }

  unsubscribe(eventId: string): void {
    const n = (this.subscriptions.get(eventId) ?? 1) - 1;
    if (n <= 0) {
      this.subscriptions.delete(eventId);
      this.socket?.emit('unsubscribe', eventId);
    } else {
      this.subscriptions.set(eventId, n);
    }
  }

  private emitSubscribe(eventId: string): Promise<SubscribeAck> {
    const socket = this.socket;
    if (!socket || !socket.connected) return Promise.resolve({ ok: false, error: 'not_connected' });
    return new Promise((resolve) => {
      const view = this.playerView.has(eventId) ? 'player' : 'gm';
      socket.timeout(8000).emit('subscribe', eventId, { view }, (err: Error | null, res: SubscribeAck) => {
        resolve(err ? { ok: false, error: 'timeout' } : res);
      });
    });
  }

  private connect(): void {
    this.zone.runOutsideAngular(() => {
      const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        auth: (cb) => cb({ token: this.auth.token() }),
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10_000,
      });
      this.socket = socket;

      socket.on('connect', () =>
        this.zone.run(() => {
          this.connected.set(true);
          this.connectivity.socketConnected.set(true);
          this.connectivity.markSynced();
          for (const id of this.subscriptions.keys()) void this.emitSubscribe(id);
        }),
      );
      socket.on('disconnect', () =>
        this.zone.run(() => {
          this.connected.set(false);
          this.connectivity.socketConnected.set(false);
        }),
      );
      socket.on('connect_error', async (err) => {
        // Expired token: refresh, then the auth callback supplies the new one on retry.
        if (err.message === 'unauthorized') await this.auth.refresh();
      });
      socket.onAny((name: EventName, payload: unknown) =>
        this.zone.run(() => {
          this.connectivity.markSynced();
          this.messages.next({ name, payload });
        }),
      );
    });
  }

  private disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
    this.connectivity.socketConnected.set(false);
  }
}
