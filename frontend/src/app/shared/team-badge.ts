import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { TeamPattern } from '../core/api/models';
import { TeamSwatch } from './team-swatch';

export interface TeamLike {
  name: string;
  color: string;
  pattern: TeamPattern;
  icon?: string;
}

export const TEAM_ICONS: { value: string; label: string; icon: string }[] = [
  { value: 'shield', label: 'Shield', icon: 'lucideShield' },
  { value: 'star', label: 'Star', icon: 'lucideStar' },
  { value: 'flag', label: 'Flag', icon: 'lucideFlag' },
  { value: 'target', label: 'Target', icon: 'lucideTarget' },
  { value: 'hexagon', label: 'Hexagon', icon: 'lucideHexagon' },
  { value: 'compass', label: 'Compass', icon: 'lucideCompass' },
  { value: 'radar', label: 'Radar', icon: 'lucideRadar' },
  { value: 'zap', label: 'Bolt', icon: 'lucideZap' },
  { value: 'award', label: 'Award', icon: 'lucideAward' },
  { value: 'globe', label: 'Globe', icon: 'lucideGlobe' },
];

export const TEAM_PATTERNS: TeamPattern[] = ['solid', 'stripes', 'dots', 'chevron', 'cross', 'grid'];

/** Colour-blind friendly defaults (Okabe–Ito inspired, tuned for dark and light). */
export const TEAM_COLORS = ['#3B82C4', '#D9822B', '#9DAE5C', '#C75B9B', '#E0C341', '#5BB8B0', '#8E7CC3', '#B0B5A8'];

export function teamIconName(icon: string | null | undefined): string {
  return TEAM_ICONS.find((i) => i.value === icon)?.icon ?? 'lucideShield';
}

/** Team identity: pattern swatch + icon + name. */
@Component({
  selector: 'zeus-team-badge',
  imports: [TeamSwatch, NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-1.5 min-w-0' },
  template: `
    @if (team(); as t) {
      <zeus-team-swatch [color]="t.color" [pattern]="t.pattern" [size]="size() === 'lg' ? 20 : 14" />
      @if (showIcon() && t.icon) {
        <ng-icon [name]="iconName(t.icon)" [size]="size() === 'lg' ? '18' : '14'" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      }
      <span class="truncate font-semibold" [class.text-lg]="size() === 'lg'" [class.text-sm]="size() === 'sm'">{{ t.name }}</span>
    } @else {
      <span class="text-sm text-muted-foreground">{{ emptyLabel() }}</span>
    }
  `,
})
export class TeamBadge {
  readonly team = input<TeamLike | null | undefined>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly showIcon = input(true);
  readonly emptyLabel = input('No team');

  protected iconName(icon: string): string {
    return teamIconName(icon);
  }
}
