import { one, pool, type Queryable, type Row } from '../db.js';
import { forbidden, notFound } from '../errors.js';
import { scoring, tracking, visibility, type Scoring, type Tracking, type VisibilityRules } from './defaults.js';
import type { EventStatus, Viewer } from './rules.js';

export interface EventRow extends Row {
  id: string;
  owner_id: string;
  name: string;
  status: EventStatus;
  visibility: 'public' | 'private';
  phase: string | null;
  tracking: unknown;
  visibility_rules: unknown;
  scoring: unknown;
  store_enabled: boolean;
  started_at: Date | null;
  paused_at: Date | null;
  paused_total_ms: number;
  ends_at: Date | null;
  ended_at: Date | null;
  start_at: Date;
  end_at: Date;
}

export interface MemberRow extends Row {
  event_id: string;
  user_id: string;
  role: 'gm' | 'player';
  status: 'invited' | 'pending' | 'approved' | 'rejected' | 'removed' | 'left';
  team_id: string | null;
  squad_id: string | null;
  is_squad_leader: boolean;
  player_role: string;
  tracking_consent_at: Date | null;
  tracking_active: boolean;
}

export interface EventContext {
  event: EventRow;
  member: MemberRow | null;
  isGm: boolean;
  viewer: Viewer;
  tracking: Tracking;
  rules: VisibilityRules;
  scoring: Scoring;
}

export async function loadEvent(eventId: string, q: Queryable = pool, lock = false): Promise<EventRow> {
  const ev = await one<EventRow>(`SELECT * FROM events WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [eventId], q);
  if (!ev) throw notFound('Event not found.');
  return ev;
}

export async function loadMember(eventId: string, userId: string, q: Queryable = pool): Promise<MemberRow | null> {
  return one<MemberRow>('SELECT * FROM event_members WHERE event_id = $1 AND user_id = $2', [eventId, userId], q);
}

export async function teamAllianceOf(teamId: string | null, q: Queryable = pool): Promise<string | null> {
  if (!teamId) return null;
  const row = await one<{ alliance_id: string | null }>('SELECT alliance_id FROM teams WHERE id = $1', [teamId], q);
  return row?.alliance_id ?? null;
}

export function viewerFrom(userId: string, member: MemberRow | null, isGm: boolean, allianceId: string | null): Viewer {
  return {
    userId,
    isGm,
    approved: member?.status === 'approved',
    teamId: member?.status === 'approved' ? member.team_id : null,
    squadId: member?.status === 'approved' ? member.squad_id : null,
    isSquadLeader: !!member?.is_squad_leader,
    playerRole: member?.player_role ?? 'rifleman',
    allianceId: allianceId,
  };
}

export async function eventContext(eventId: string, userId: string, q: Queryable = pool, lockEvent = false): Promise<EventContext> {
  const event = await loadEvent(eventId, q, lockEvent);
  const member = await loadMember(eventId, userId, q);
  const isGm = (member?.role === 'gm' && member.status === 'approved') || event.owner_id === userId;
  const alliance = member?.team_id ? await teamAllianceOf(member.team_id, q) : null;
  return {
    event,
    member,
    isGm,
    viewer: viewerFrom(userId, member, isGm, alliance),
    tracking: tracking(event.tracking),
    rules: visibility(event.visibility_rules),
    scoring: scoring(event.scoring),
  };
}

/** Can the user see the event at all (public listing, member, invited, GM)? */
export function canViewEvent(ctx: EventContext): boolean {
  if (ctx.isGm) return true;
  if (ctx.member && ['invited', 'pending', 'approved'].includes(ctx.member.status)) return true;
  return ctx.event.visibility === 'public' && ctx.event.status !== 'draft';
}

export async function requireGm(eventId: string, userId: string, q: Queryable = pool, lockEvent = false): Promise<EventContext> {
  const ctx = await eventContext(eventId, userId, q, lockEvent);
  if (!ctx.isGm) {
    if (!canViewEvent(ctx)) throw notFound('Event not found.');
    throw forbidden('Only the Game Masters of this event can do that.', 'not_gm');
  }
  return ctx;
}

/** Approved player or GM. */
export async function requireMember(eventId: string, userId: string, q: Queryable = pool, lockEvent = false): Promise<EventContext> {
  const ctx = await eventContext(eventId, userId, q, lockEvent);
  if (ctx.isGm || ctx.member?.status === 'approved') return ctx;
  if (!canViewEvent(ctx)) throw notFound('Event not found.');
  throw forbidden('Join the event first.', 'not_member');
}

export async function requireViewable(eventId: string, userId: string, q: Queryable = pool): Promise<EventContext> {
  const ctx = await eventContext(eventId, userId, q);
  if (!canViewEvent(ctx)) throw notFound('Event not found.');
  return ctx;
}

/** Statuses in which the event content can no longer be edited structurally. */
export const FINISHED: EventStatus[] = ['completed', 'cancelled'];
