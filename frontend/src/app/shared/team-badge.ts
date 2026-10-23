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
  { value: 'shield', label: $localize`Shield`, icon: 'lucideShield' },
  { value: 'star', label: $localize`Star`, icon: 'lucideStar' },
  { value: 'flag', label: $localize`Flag`, icon: 'lucideFlag' },
  { value: 'target', label: $localize`Target`, icon: 'lucideTarget' },
  { value: 'hexagon', label: $localize`Hexagon`, icon: 'lucideHexagon' },
  { value: 'compass', label: $localize`Compass`, icon: 'lucideCompass' },
  { value: 'radar', label: $localize`Radar`, icon: 'lucideRadar' },
  { value: 'zap', label: $localize`Bolt`, icon: 'lucideZap' },
  { value: 'award', label: $localize`Award`, icon: 'lucideAward' },
  { value: 'globe', label: $localize`Globe`, icon: 'lucideGlobe' },
];

export const TEAM_PATTERNS: TeamPattern[] = ['solid', 'stripes', 'dots', 'chevron', 'cross', 'grid'];

export const TEAM_PATTERN_LABELS: Record<TeamPattern, string> = {
  solid: $localize`:team pattern|:Solid`,
  stripes: $localize`:team pattern|:Stripes`,
  dots: $localize`:team pattern|:Dots`,
  chevron: $localize`:team pattern|:Chevron`,
  cross: $localize`:team pattern|:Cross`,
  grid: $localize`:team pattern|:Grid`,
};

/** Colour-blind friendly defaults (Okabe–Ito inspired, tuned for dark and light). */
export const TEAM_COLORS = ['#3B82C4', '#D9822B', '#9DAE5C', '#C75B9B', '#E0C341', '#5BB8B0', '#8E7CC3', '#B0B5A8'];

export function teamIconName(icon: string | null | undefined): string {
  return TEAM_ICONS.find((i) => i.value === icon)?.icon ?? 'lucideShield';
}

/** Team identity: pattern swatch + icon + name. */
@Component({
  selector: 'ah-team-badge',
  imports: [TeamSwatch, NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-1.5 min-w-0' },
  template: `
    @if (team(); as t) {
      <ah-team-swatch [color]="t.color" [pattern]="t.pattern" [size]="size() === 'lg' ? 20 : 14" />
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
  readonly emptyLabel = input($localize`No team`);

  protected iconName(icon: string): string {
    return teamIconName(icon);
  }
}
