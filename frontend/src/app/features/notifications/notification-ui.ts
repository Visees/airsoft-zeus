import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { AppNotification, NotificationType } from '../../core/api/models';
import { formatDateTime, formatRelative } from '../../core/util/format';

/** Types that belong to a running game: open the live screen. */
const GAME_TIME_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'game_started',
  'game_resumed',
  'objective_available',
  'objective_captured',
  'objective_contested',
  'objective_lost',
  'perk_purchased',
  'perk_activated',
  'perk_expired',
  'perk_rejected',
  'team_announcement',
  'gm_message',
  'emergency',
  'announcement',
]);

/** Where tapping a notification goes, or null when it has no target. */
export function notificationLink(n: AppNotification): string | null {
  if (n.type === 'support_reply' && typeof n.data['ticketId'] === 'string') return `/support/${encodeURIComponent(n.data['ticketId'])}`;
  if (!n.eventId) return null;
  const id = encodeURIComponent(n.eventId);
  return GAME_TIME_TYPES.has(n.type) ? `/events/${id}/live` : `/events/${id}`;
}

const TYPE_ICONS: Partial<Record<NotificationType, string>> = {
  event_published: 'lucideCalendarPlus',
  event_cancelled: 'lucideCalendarX',
  event_invitation: 'lucideMail',
  registration_approved: 'lucideUserCheck',
  registration_rejected: 'lucideUserX',
  team_assigned: 'lucideUsers',
  event_starting_soon: 'lucideClock',
  game_started: 'lucidePlay',
  game_paused: 'lucidePause',
  game_resumed: 'lucidePlay',
  game_ended: 'lucideFlag',
  objective_available: 'lucideTarget',
  objective_captured: 'lucideFlag',
  objective_contested: 'lucideCrosshair',
  objective_lost: 'lucideFlag',
  perk_purchased: 'lucideShoppingCart',
  perk_activated: 'lucideZap',
  perk_expired: 'lucideHourglass',
  perk_rejected: 'lucideBan',
  team_announcement: 'lucideMegaphone',
  gm_message: 'lucideMessageSquare',
  announcement: 'lucideMegaphone',
  emergency: 'lucideSiren',
  removed_from_event: 'lucideUserMinus',
  support_reply: 'lucideLifeBuoy',
};

/**
 * One notification row. Unread: bold + "●" marker + accent bar. Priority: ⚠ (emergency, red) or
 * ▲ (high, amber) with a text label for screen readers.
 */
@Component({
  selector: 'zeus-notification-row',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let n = notification();
    <button
      type="button"
      class="relative flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60"
      [style.background-color]="n.priority === 'emergency' ? 'color-mix(in oklab, var(--destructive) 7%, transparent)' : null"
      (click)="open.emit(n)"
      [attr.aria-label]="aria()"
    >
      @if (!n.read) {
        <span class="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true"></span>
      }
      <span
        class="grid size-10 shrink-0 place-items-center rounded-md"
        [class]="n.priority === 'emergency' ? 'bg-destructive/15 text-destructive' : n.priority === 'high' ? 'bg-warning-surface text-warning' : 'bg-muted text-muted-foreground'"
        aria-hidden="true"
      >
        <ng-icon [name]="icon()" size="18" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex items-start gap-2">
          @if (n.priority === 'emergency') {
            <span class="font-bold text-destructive" aria-hidden="true">⚠</span>
          } @else if (n.priority === 'high') {
            <span class="font-bold text-warning" aria-hidden="true">▲</span>
          }
          <span class="min-w-0 flex-1" [class.font-bold]="!n.read" [class.font-medium]="n.read" [class.text-muted-foreground]="n.read && n.priority === 'normal'">{{ n.title }}</span>
          @if (!n.read) {
            <span class="mt-1 text-[0.6rem] leading-none text-primary" aria-hidden="true">●</span>
          }
        </span>
        @if (n.body) {
          <span class="mt-0.5 block text-sm text-muted-foreground" [class.line-clamp-2]="clamp()">{{ n.body }}</span>
        }
        <span class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <time [attr.datetime]="n.createdAt" [attr.title]="absolute()">{{ relative() }}</time>
          @if (link()) {
            <span aria-hidden="true">·</span>
            <span class="inline-flex items-center gap-0.5">{{ linkLabel() }} <ng-icon name="lucideChevronRight" size="12" aria-hidden="true" /></span>
          }
        </span>
      </span>
    </button>
  `,
})
export class NotificationRow {
  readonly notification = input.required<AppNotification>();
  /** Current time (ms) so relative times refresh. */
  readonly now = input<number>(Date.now());
  readonly clamp = input(true);
  readonly open = output<AppNotification>();

  protected readonly icon = computed(() => TYPE_ICONS[this.notification().type] ?? 'lucideBell');
  protected readonly link = computed(() => notificationLink(this.notification()));
  protected readonly linkLabel = computed(() => {
    const link = this.link();
    if (link?.startsWith('/support/')) return 'Open conversation';
    return link?.endsWith('/live') ? 'Open live game' : 'Open event';
  });
  protected readonly relative = computed(() => formatRelative(this.notification().createdAt, this.now()));
  protected readonly absolute = computed(() => formatDateTime(this.notification().createdAt));
  protected readonly aria = computed(() => {
    const n = this.notification();
    const parts = [
      n.priority === 'emergency' ? 'Emergency.' : n.priority === 'high' ? 'High priority.' : '',
      n.read ? '' : 'Unread.',
      n.title + '.',
      n.body,
      this.relative() + '.',
    ];
    return parts.filter(Boolean).join(' ');
  });
}
