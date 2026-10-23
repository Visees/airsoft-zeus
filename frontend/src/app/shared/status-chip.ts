import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EventStatus, ObjectiveStatus, PurchaseStatus } from '../core/api/models';
import { EVENT_STATUS_LABELS, OBJECTIVE_STATUS_GLYPHS, OBJECTIVE_STATUS_LABELS, PURCHASE_STATUS_LABELS } from '../core/util/format';

export type ChipTone = 'neutral' | 'primary' | 'warning' | 'danger' | 'nav';

export interface ChipSpec {
  label: string;
  glyph: string;
  tone: ChipTone;
}

const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: 'border-border bg-muted text-foreground',
  primary: 'border-primary/40 bg-primary/10 text-primary',
  warning: 'border-warning/45 bg-warning-surface text-warning',
  danger: 'border-destructive/45 bg-destructive/10 text-destructive',
  nav: 'border-nav/45 bg-nav/10 text-nav',
};

/** Status label with a shape glyph — never colour alone. Use `[spec]` or label/glyph/tone. */
@Component({
  selector: 'zeus-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClass()' },
  template: `<span aria-hidden="true">{{ resolved().glyph }}</span><span class="truncate">{{ resolved().label }}</span>`,
})
export class StatusChip {
  readonly spec = input<ChipSpec | null>(null);
  readonly label = input('');
  readonly glyph = input('●');
  readonly tone = input<ChipTone>('neutral');

  protected readonly resolved = computed<ChipSpec>(() => this.spec() ?? { label: this.label(), glyph: this.glyph(), tone: this.tone() });
  protected readonly hostClass = computed(
    () =>
      // max-w-full + truncate: on a narrow screen or with a large system font the label ends in … instead of being cut
      `inline-flex max-w-full items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE_CLASSES[this.resolved().tone]}`,
  );
}

export function eventStatusChip(status: EventStatus): ChipSpec {
  const label = EVENT_STATUS_LABELS[status];
  switch (status) {
    case 'live':
      return { label, glyph: '●', tone: 'primary' };
    case 'paused':
      return { label, glyph: '❚❚', tone: 'warning' };
    case 'lobby':
    case 'registration_open':
      return { label, glyph: '◐', tone: 'nav' };
    case 'cancelled':
      return { label, glyph: '✕', tone: 'danger' };
    case 'completed':
      return { label, glyph: '✓', tone: 'neutral' };
    default:
      return { label, glyph: '○', tone: 'neutral' };
  }
}

export function objectiveStatusChip(status: ObjectiveStatus): ChipSpec {
  const tone: ChipTone =
    status === 'active' ? 'warning' : status === 'contested' ? 'danger' : status === 'captured' ? 'primary' : 'neutral';
  return { label: OBJECTIVE_STATUS_LABELS[status], glyph: OBJECTIVE_STATUS_GLYPHS[status], tone };
}

export function purchaseStatusChip(status: PurchaseStatus): ChipSpec {
  const label = PURCHASE_STATUS_LABELS[status];
  switch (status) {
    case 'active':
      return { label, glyph: '●', tone: 'primary' };
    case 'pending_approval':
      return { label, glyph: '◐', tone: 'warning' };
    case 'ready':
      return { label, glyph: '▶', tone: 'nav' };
    case 'rejected':
    case 'cancelled':
      return { label, glyph: '✕', tone: 'danger' };
    default:
      return { label, glyph: '○', tone: 'neutral' };
  }
}
