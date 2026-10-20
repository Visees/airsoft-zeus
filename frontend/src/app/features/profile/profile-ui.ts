import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { Badge, PlayerRole, PlayerStats } from '../../core/api/models';
import { PLAYER_ROLE_LABELS, formatDate, formatNumber, initials } from '../../core/util/format';

/** Round avatar with initials fallback. */
@Component({
  selector: 'zeus-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block shrink-0' },
  template: `
    @if (url()) {
      <img [src]="url()" [alt]="alt()" class="rounded-full border border-border object-cover" [style.width.px]="size()" [style.height.px]="size()" />
    } @else {
      <span
        class="grid place-items-center rounded-full border border-border bg-muted font-bold text-muted-foreground"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [style.font-size.px]="size() * 0.36"
        [attr.role]="alt() ? 'img' : null"
        [attr.aria-label]="alt() || null"
        [attr.aria-hidden]="alt() ? null : 'true'"
        >{{ letters() }}</span
      >
    }
  `,
})
export class Avatar {
  readonly url = input<string | null | undefined>(null);
  readonly nickname = input<string | null | undefined>('');
  readonly size = input(48);
  /** Accessible text; empty = decorative. */
  readonly alt = input('');
  protected readonly letters = computed(() => initials(this.nickname()));
}

export function winRate(stats: PlayerStats): number | null {
  const decided = stats.wins + stats.losses + stats.draws;
  const base = decided || stats.gamesPlayed;
  return base ? Math.round((stats.wins / base) * 100) : null;
}

/** Stat tiles: games, captures, points, wins, win rate. */
@Component({
  selector: 'zeus-stat-tiles',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <dl [class]="wide() ? 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5' : 'grid grid-cols-2 gap-2 sm:grid-cols-3'">
      @for (t of tiles(); track t.label) {
        <div [class]="t.span ? 'panel col-span-2 flex flex-col gap-1 p-3 sm:col-span-1' : 'panel flex flex-col gap-1 p-3'">
          <dt class="label-caps flex items-center gap-1.5"><ng-icon [name]="t.icon" size="13" aria-hidden="true" />{{ t.label }}</dt>
          <dd class="num text-2xl font-bold">{{ t.value }}</dd>
        </div>
      }
    </dl>
  `,
})
export class StatTiles {
  readonly stats = input.required<PlayerStats>();
  /** Five tiles in one row on large screens. */
  readonly wide = input(false);
  protected readonly tiles = computed(() => {
    const s = this.stats();
    const rate = winRate(s);
    return [
      { label: 'Games', value: formatNumber(s.gamesPlayed), icon: 'lucideCalendarDays', span: false },
      { label: 'Captures', value: formatNumber(s.objectivesCaptured), icon: 'lucideFlag', span: false },
      { label: 'Points', value: formatNumber(s.totalPoints), icon: 'lucideTrophy', span: false },
      { label: 'Wins', value: formatNumber(s.wins), icon: 'lucideMedal', span: false },
      { label: 'Win rate', value: rate === null ? '—' : `${rate}%`, icon: 'lucideGauge', span: true },
    ];
  });
}

/** Badges grid with descriptions. */
@Component({
  selector: 'zeus-badge-grid',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (badges().length) {
      <ul [class]="compact() ? 'grid gap-2 sm:grid-cols-2' : 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3'">
        @for (b of badges(); track b.code + b.awardedAt) {
          <li class="panel flex items-start gap-3 p-3">
            <span class="grid size-10 shrink-0 place-items-center rounded-md bg-primary/15 text-primary" aria-hidden="true">
              <ng-icon name="lucideAward" size="20" />
            </span>
            <div class="min-w-0">
              <p class="font-semibold">{{ b.label }}</p>
              @if (!compact()) {
                <p class="text-sm text-muted-foreground">{{ b.description }}</p>
              }
              <p class="mt-0.5 text-xs text-muted-foreground">Earned {{ date(b.awardedAt) }}</p>
            </div>
          </li>
        }
      </ul>
    } @else {
      <p class="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">{{ emptyText() }}</p>
    }
  `,
})
export class BadgeGrid {
  readonly badges = input.required<Badge[]>();
  readonly compact = input(false);
  readonly emptyText = input('No badges yet. Badges are awarded for first captures, wins and milestones in games.');
  protected readonly date = formatDate;
}

export function roleText(role: PlayerRole | null | undefined, customRole: string | null | undefined): string | null {
  if (!role) return null;
  if (role === 'custom') return customRole?.trim() || PLAYER_ROLE_LABELS.custom;
  return PLAYER_ROLE_LABELS[role];
}
