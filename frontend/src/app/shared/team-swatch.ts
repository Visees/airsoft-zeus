import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TeamPattern } from '../core/api/models';

let uid = 0;

/** Square swatch filled with the team colour + pattern, so teams never differ by hue alone. */
@Component({
  selector: 'ah-team-swatch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block shrink-0 align-middle', 'aria-hidden': 'true' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 16 16" class="block rounded-[3px]">
      <defs>
        <pattern [attr.id]="pid" width="4" height="4" patternUnits="userSpaceOnUse">
          @switch (pattern()) {
            @case ('stripes') {
              <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" [attr.stroke]="ink()" stroke-width="1.1" />
            }
            @case ('dots') {
              <circle cx="2" cy="2" r="0.9" [attr.fill]="ink()" />
            }
            @case ('chevron') {
              <path d="M0,3 l2,-2 l2,2" fill="none" [attr.stroke]="ink()" stroke-width="0.9" />
            }
            @case ('cross') {
              <path d="M2,0.5 v3 M0.5,2 h3" [attr.stroke]="ink()" stroke-width="0.9" />
            }
            @case ('grid') {
              <path d="M0,0 h4 M0,0 v4" [attr.stroke]="ink()" stroke-width="0.9" />
            }
          }
        </pattern>
      </defs>
      <rect width="16" height="16" [attr.fill]="color()" />
      @if (pattern() !== 'solid') {
        <rect width="16" height="16" [attr.fill]="'url(#' + pid + ')'" />
      }
      <rect x="0.5" y="0.5" width="15" height="15" fill="none" stroke="currentColor" stroke-opacity="0.35" rx="2.5" />
    </svg>
  `,
})
export class TeamSwatch {
  readonly color = input.required<string>();
  readonly pattern = input<TeamPattern>('solid');
  readonly size = input(14);
  protected readonly pid = `tp${++uid}`;
  /** Pattern ink contrasts with the fill. */
  protected readonly ink = computed(() => (luminance(this.color()) > 0.45 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.6)'));
}

export function luminance(hex: string): number {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return 0.5;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
