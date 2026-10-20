import { Capture, EventResults, TeamResult } from '../../core/api/models';
import { formatClock } from '../../core/util/format';

export const CAPTURE_METHOD_LABELS: Record<Capture['method'], string> = {
  code: 'Code',
  qr: 'QR scan',
  geofence: 'Zone hold',
  gm: 'Game Master',
};

export function teamsById(r: EventResults): Map<string, TeamResult> {
  return new Map(r.teams.map((t) => [t.teamId, t]));
}

/** TeamResult → the shape zeus-team-badge expects. */
export function badgeOf(t: TeamResult | null | undefined): { name: string; color: string; pattern: TeamResult['pattern']; icon: string } | null {
  return t ? { name: t.name, color: t.color, pattern: t.pattern, icon: t.icon } : null;
}

/** Game time of an event relative to the start: "+01:23:45". */
export function elapsedLabel(iso: string, startedAt: string | null): string {
  if (!startedAt) return '';
  return '+' + formatClock(new Date(iso).getTime() - new Date(startedAt).getTime());
}

/** File-name friendly slug: "Operation Nightfall" → "operation-nightfall". */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'event';
}

export function publicResultsUrl(origin: string, token: string): string {
  return `${origin}/r/${encodeURIComponent(token)}`;
}

/** Teams that share first place (for draws). */
export function leaders(r: EventResults): TeamResult[] {
  if (!r.teams.length) return [];
  const best = Math.min(...r.teams.map((t) => t.rank));
  return r.teams.filter((t) => t.rank === best);
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
