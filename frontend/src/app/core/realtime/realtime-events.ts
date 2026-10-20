// Socket.IO contract. Mirrored in backend/src/realtime/events.ts.
// The socket connects to the same origin at /socket.io with { auth: { token: <access token> } }.
// After connecting, the client calls `subscribe` for the event it is viewing; the server checks
// membership and joins the right rooms. Everything the server pushes is already filtered for
// the receiving user, so restricted data (enemy positions, hidden objectives) never reaches them.

import {
  ActivityItem,
  Announcement,
  AppNotification,
  GameClock,
  GmAlert,
  Team,
  Uuid,
  VisiblePosition,
} from '../api/models';

/** Which REST resources the client should refetch. */
export type InvalidateScope =
  | 'event'
  | 'me'
  | 'members'
  | 'squads'
  | 'objectives'
  | 'pois'
  | 'zones'
  | 'perks'
  | 'purchases'
  | 'effects'
  | 'alerts'
  | 'captures'
  | 'ledger';

export interface ServerToClientEvents {
  /** Clock/status changed (start, pause, resume, extend, end). */
  clock: (p: { eventId: Uuid; clock: GameClock }) => void;
  /** Team scores/balances, filtered for the viewer (enemy currency may be null). */
  teams: (p: { eventId: Uuid; teams: Team[] }) => void;
  /** Full list of positions this viewer may see. Sent every few seconds while the game is live. */
  positions: (p: { eventId: Uuid; positions: VisiblePosition[]; serverNow: string }) => void;
  invalidate: (p: { eventId: Uuid; scopes: InvalidateScope[] }) => void;
  announcement: (p: { eventId: Uuid; announcement: Announcement }) => void;
  activity: (p: { eventId: Uuid; item: ActivityItem }) => void;
  notification: (n: AppNotification) => void;
  /** GM only */
  alert: (p: { eventId: Uuid; alert: GmAlert }) => void;
  /** The user was removed from the event or the event was deleted. */
  kicked: (p: { eventId: Uuid; reason: string }) => void;
}

export interface SubscribeAck {
  ok: boolean;
  error?: string;
  role?: 'gm' | 'player';
}

export interface ClientToServerEvents {
  subscribe: (eventId: Uuid, ack: (res: SubscribeAck) => void) => void;
  unsubscribe: (eventId: Uuid) => void;
}
