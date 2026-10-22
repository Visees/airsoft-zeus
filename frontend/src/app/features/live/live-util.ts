import { LatLng, Precision, Uuid, VisibilityRules, VisiblePosition } from '../../core/api/models';
import { bearingDeg, compassPoint, distanceM } from '../../core/util/geo';
import { formatDuration, PRECISION_LABELS } from '../../core/util/format';
import { ChipSpec } from '../../shared/status-chip';

/** Absolute router commands for a screen inside the live area. */
export function liveLink(eventId: Uuid | null, ...parts: string[]): string[] {
  return ['/events', eventId ?? '', 'live', ...parts];
}

export function distanceFrom(from: LatLng | null | undefined, to: LatLng): number | null {
  return from ? distanceM(from, to) : null;
}

/** "NE · 47°" */
export function bearingLabel(from: LatLng | null | undefined, to: LatLng): { deg: number; point: string } | null {
  if (!from) return null;
  const deg = bearingDeg(from, to);
  return { deg: Math.round(deg), point: compassPoint(deg) };
}

/** Remaining time until an ISO date, or null when past/absent. */
export function remaining(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - nowMs;
  return ms > 0 ? formatDuration(ms) : null;
}

export function isFuture(iso: string | null | undefined, nowMs: number): boolean {
  return !!iso && new Date(iso).getTime() > nowMs;
}

/** Haptic feedback where supported (Android Chrome); silently ignored elsewhere. */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* not allowed (no user activation) */
  }
}

export function positionStatusChip(status: VisiblePosition['status']): ChipSpec {
  switch (status) {
    case 'online':
      return { label: $localize`Live`, glyph: '●', tone: 'primary' };
    case 'stale':
      return { label: $localize`Stale`, glyph: '◐', tone: 'warning' };
    default:
      return { label: $localize`Offline`, glyph: '○', tone: 'neutral' };
  }
}

export function positionKindLabel(kind: VisiblePosition['kind']): string {
  switch (kind) {
    case 'self':
      return $localize`You`;
    case 'ally':
      return $localize`Ally`;
    case 'enemy':
      return $localize`Enemy`;
    default:
      return $localize`Intel contact`;
  }
}

function precisionText(p: Precision, rules: VisibilityRules): string {
  if (p === 'exact') return $localize`exact position`;
  if (p === 'approximate' || p === 'area') return $localize`${PRECISION_LABELS[p].toLowerCase()}:p: position (about ${rules.approxRadiusM}:approxRadiusM: m)`;
  return $localize`position delayed by ${rules.delaySec}:delaySec: s`;
}

/** Plain-language list of who sees the player's position, from the event's visibility rules. */
export function sharingAudience(rules: VisibilityRules): string[] {
  const lines: string[] = [];
  const allies =
    rules.allies === 'none'
      ? null
      : rules.allies === 'squad'
        ? $localize`Your squad`
        : rules.allies === 'team'
          ? $localize`Your team`
          : $localize`Your team and allied teams`;
  if (allies) lines.push($localize`${allies}:allies: see your ${precisionText(rules.allyPrecision, rules)}:precisionText:.`);
  else if (rules.squadLeadersSeeSquad) lines.push($localize`Your squad leader sees your position.`);
  else lines.push($localize`Other players on your side do not see you.`);
  if (rules.enemies === 'never') lines.push($localize`Enemy teams never see your position.`);
  else if (rules.enemies === 'perk_only') lines.push($localize`Enemy teams see your ${precisionText(rules.enemyPrecision, rules)}:precisionText: only while they run a UAV or recon perk.`);
  else lines.push($localize`Enemy teams see your ${precisionText(rules.enemyPrecision, rules)}:precisionText:.`);
  lines.push($localize`Game Masters see your position to run the game and for safety.`);
  return lines;
}
