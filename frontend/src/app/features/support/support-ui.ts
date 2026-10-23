import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { SupportCategory, SupportStatus, SupportTicket } from '../../core/api/models';
import { formatDateTime, formatRelative } from '../../core/util/format';
import { ChipSpec, StatusChip } from '../../shared/status-chip';

export const SUPPORT_CATEGORIES: { value: SupportCategory; label: string; hint: string; icon: string }[] = [
  { value: 'bug', label: $localize`Bug`, hint: $localize`Something in the app does not work as it should`, icon: 'lucideBug' },
  { value: 'report', label: $localize`Report`, hint: $localize`A problem with an event, a club or content in the app`, icon: 'lucideFlag' },
  { value: 'general', label: $localize`General`, hint: $localize`Ideas, questions, partnerships, anything else`, icon: 'lucideMessageSquare' },
];

const CATEGORY_CHIPS: Record<SupportCategory, ChipSpec> = {
  bug: { label: $localize`Bug`, glyph: '✱', tone: 'danger' },
  report: { label: $localize`Report`, glyph: '!', tone: 'warning' },
  general: { label: $localize`General`, glyph: '●', tone: 'nav' },
};

const STATUS_CHIPS: Record<SupportStatus, ChipSpec> = {
  open: { label: $localize`Waiting for the team`, glyph: '◷', tone: 'neutral' },
  answered: { label: $localize`Answered`, glyph: '↩', tone: 'primary' },
  closed: { label: $localize`Closed`, glyph: '✓', tone: 'neutral' },
};

/** Same statuses, worded for the admins' inbox. */
const ADMIN_STATUS_CHIPS: Record<SupportStatus, ChipSpec> = {
  open: { label: $localize`To answer`, glyph: '●', tone: 'warning' },
  answered: { label: $localize`Answered`, glyph: '↩', tone: 'primary' },
  closed: { label: $localize`Closed`, glyph: '✓', tone: 'neutral' },
};

export const supportCategoryChip = (c: SupportCategory): ChipSpec => CATEGORY_CHIPS[c] ?? CATEGORY_CHIPS.general;
export const supportStatusChip = (s: SupportStatus, admin = false): ChipSpec => (admin ? ADMIN_STATUS_CHIPS : STATUS_CHIPS)[s] ?? STATUS_CHIPS.open;

/** A support conversation in lists (/support). Whole card links to the thread. */
@Component({
  selector: 'ah-support-ticket-card',
  imports: [RouterLink, NgIcon, StatusChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block [contain:inline-size]' },
  template: `
    @let t = ticket();
    <a
      [routerLink]="['/support', t.id]"
      class="panel group flex flex-col gap-1.5 p-3 transition-colors hover:border-primary/60 focus-visible:border-primary"
      [class.border-primary/40!]="highlight()"
    >
      <div class="flex flex-wrap items-center gap-1.5">
        <ah-status-chip [spec]="category()" />
        <ah-status-chip [spec]="status()" />
      </div>
      <h3 class="line-clamp-2 font-bold group-hover:text-primary" [class.text-muted-foreground]="t.status === 'closed'">{{ t.subject }}</h3>
      <p class="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        @if (t.userNickname) {
          <span class="font-semibold text-foreground">{{ t.userNickname }}</span>
          <span aria-hidden="true">·</span>
        }
        <span class="inline-flex items-center gap-1"><ng-icon name="lucideMessagesSquare" size="12" aria-hidden="true" /> {{ t.messageCount }}</span>
        <span aria-hidden="true">·</span>
        <time [attr.datetime]="t.lastMessageAt" [attr.title]="absolute()">{{ relative() }}</time>
      </p>
    </a>
  `,
})
export class SupportTicketCard {
  readonly ticket = input.required<SupportTicket>();
  /** Admin wording for the status. */
  readonly admin = input(false);

  protected readonly category = computed(() => supportCategoryChip(this.ticket().category));
  protected readonly status = computed(() => supportStatusChip(this.ticket().status, this.admin()));
  /** Needs the viewer's attention: an answer for the player, a new message for the admins. */
  protected readonly highlight = computed(() => this.ticket().status === (this.admin() ? 'open' : 'answered'));
  protected readonly relative = computed(() => formatRelative(this.ticket().lastMessageAt));
  protected readonly absolute = computed(() => formatDateTime(this.ticket().lastMessageAt));
}
