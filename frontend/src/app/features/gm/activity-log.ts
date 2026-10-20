import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { ApiService } from '../../core/api/api.service';
import { ActivityItem, AuditLogEntry, Capture, EventDetail, GmAlert, Page } from '../../core/api/models';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { formatDateTime, formatNumber, formatRelative } from '../../core/util/format';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { StatusChip } from '../../shared/status-chip';
import { TeamBadge } from '../../shared/team-badge';

type Tab = 'activity' | 'audit' | 'captures' | 'alerts';

/** Cursor-paginated list state for one tab. */
class Pager<T> {
  readonly items = signal<T[]>([]);
  readonly cursor = signal<string | null>(null);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<unknown>(null);
  private seq = 0;

  constructor(private readonly fetch: (cursor: string | null) => Promise<Page<T>>) {}

  async load(more = false): Promise<void> {
    const seq = ++this.seq;
    const cursor = more ? this.cursor() : null;
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.fetch(cursor);
      if (seq !== this.seq) return;
      this.items.update((l) => (more ? [...l, ...page.items] : page.items));
      this.cursor.set(page.nextCursor);
      this.loaded.set(true);
    } catch (e) {
      if (seq === this.seq) this.error.set(e);
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }
}

interface DiffRow {
  key: string;
  before: string;
  after: string;
}

const ALERT_TONE: Record<GmAlert['severity'], { glyph: string; tone: 'neutral' | 'warning' | 'danger'; label: string }> = {
  info: { glyph: '●', tone: 'neutral', label: 'Info' },
  warning: { glyph: '▲', tone: 'warning', label: 'Warning' },
  critical: { glyph: '■', tone: 'danger', label: 'Critical' },
};

/** GM history: activity feed, audit log, captures (with revoke) and alerts. Route: /gm/events/:eventId/activity */
@Component({
  selector: 'zeus-activity-log-screen',
  imports: [RouterLink, NgIcon, HlmButton, HlmInput, EmptyState, ErrorState, LoadingSkeleton, PageHeader, StatusChip, TeamBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <zeus-page-header title="Activity log" [eyebrow]="event()?.name ?? 'Game Master'" [back]="'/gm/events/' + eventId()" backLabel="Event editor">
        <a hlmBtn variant="outline" class="h-11" [routerLink]="['/gm/events', eventId(), 'control']">
          <ng-icon name="lucideLayoutDashboard" size="16" aria-hidden="true" /> Control center
        </a>
      </zeus-page-header>

      <div class="mb-3 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Log" class="flex overflow-x-auto rounded-md border border-border bg-muted p-1">
          @for (t of tabs; track t.id) {
            <button
              type="button"
              role="tab"
              [id]="'tab-' + t.id"
              [attr.aria-selected]="tab() === t.id"
              [attr.aria-controls]="'panel-' + t.id"
              [attr.tabindex]="tab() === t.id ? 0 : -1"
              class="h-10 whitespace-nowrap rounded-sm px-3 text-sm font-semibold"
              [class]="tab() === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              (click)="select(t.id)"
              (keydown)="tabKey($event)"
            >
              {{ t.label }}
              @if (t.id === 'alerts' && openAlerts()) {
                <span class="num ml-1 rounded-sm bg-warning-surface px-1 text-xs text-warning">{{ openAlerts() }}</span>
              }
            </button>
          }
        </div>
        <div class="relative min-w-56 flex-1 sm:max-w-sm">
          <label for="log-search" class="sr-only">Search loaded entries</label>
          <ng-icon name="lucideSearch" size="16" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input hlmInput id="log-search" type="search" class="h-11 pl-8" placeholder="Search loaded entries" [value]="query()" (input)="query.set($any($event.target).value)" />
        </div>
      </div>

      <div [id]="'panel-' + tab()" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
        @switch (tab()) {
          @case ('activity') {
            @if (activity.loading() && !activity.items().length) {
              <zeus-loading-skeleton [rows]="6" />
            } @else if (activity.error() && !activity.items().length) {
              <zeus-error-state [error]="activity.error()" (retry)="activity.load()" />
            } @else if (!filteredActivity().length) {
              <zeus-empty-state icon="lucideActivity" [title]="query() ? 'No matching entries' : 'No activity yet'" [message]="query() ? 'Clear the search or load more.' : 'Captures, purchases and GM actions appear here.'" />
            } @else {
              <ol class="panel divide-y divide-border">
                @for (a of filteredActivity(); track a.id) {
                  <li class="flex gap-3 p-3 text-sm">
                    <time class="w-20 shrink-0" [attr.datetime]="a.createdAt" [title]="abs(a.createdAt)">
                      <span class="num block font-semibold">{{ rel(a.createdAt) }}</span>
                      <span class="block text-xs text-muted-foreground">{{ abs(a.createdAt) }}</span>
                    </time>
                    <div class="min-w-0 flex-1">
                      <p class="wrap-break-word">{{ a.message }}</p>
                      <p class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span class="num">{{ a.type }}</span>
                        <span>· {{ scopeLabel(a.scope) }}</span>
                        @if (a.teamId && teamById().get(a.teamId); as t) {
                          <zeus-team-badge [team]="t" size="sm" />
                        }
                      </p>
                    </div>
                  </li>
                }
              </ol>
            }
            <div class="mt-3 flex justify-center">
              @if (activity.cursor()) {
                <button hlmBtn type="button" variant="outline" class="h-11" (click)="activity.load(true)" [disabled]="activity.loading()">{{ activity.loading() ? 'Loading…' : 'Load more' }}</button>
              } @else if (activity.loaded() && activity.items().length) {
                <p class="text-sm text-muted-foreground">Start of the log.</p>
              }
            </div>
          }

          @case ('audit') {
            @if (audit.loading() && !audit.items().length) {
              <zeus-loading-skeleton [rows]="6" />
            } @else if (audit.error() && !audit.items().length) {
              <zeus-error-state [error]="audit.error()" (retry)="audit.load()" />
            } @else if (!filteredAudit().length) {
              <zeus-empty-state icon="lucideHistory" [title]="query() ? 'No matching entries' : 'No audit entries yet'" message="Every change made by a Game Master is recorded here with its reason." />
            } @else {
              <ol class="flex flex-col gap-2">
                @for (a of filteredAudit(); track a.id) {
                  <li class="panel text-sm">
                    <details class="group">
                      <summary class="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 p-3 [&::-webkit-details-marker]:hidden">
                        <ng-icon name="lucideChevronRight" size="16" class="shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
                        <span class="num font-semibold">{{ a.action }}</span>
                        <span class="text-muted-foreground">by {{ a.actorNickname ?? 'System' }}</span>
                        @if (a.targetType) {
                          <span class="text-muted-foreground">· {{ a.targetType }} <span class="num">{{ shortId(a.targetId) }}</span></span>
                        }
                        <time class="ml-auto text-xs text-muted-foreground" [attr.datetime]="a.createdAt" [title]="abs(a.createdAt)">{{ rel(a.createdAt) }} · {{ abs(a.createdAt) }}</time>
                        @if (a.reason) {
                          <span class="w-full pl-7 text-foreground">Reason: “{{ a.reason }}”</span>
                        }
                      </summary>
                      <div class="border-t border-border p-3">
                        @if (diff(a); as rows) {
                          @if (rows.length) {
                            <div class="overflow-x-auto">
                              <table class="w-full min-w-md text-xs">
                                <thead>
                                  <tr class="text-left text-muted-foreground">
                                    <th scope="col" class="py-1 pr-3 font-medium">Field</th>
                                    <th scope="col" class="py-1 pr-3 font-medium">Before</th>
                                    <th scope="col" class="py-1 font-medium">After</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  @for (r of rows; track r.key) {
                                    <tr class="border-t border-border align-top">
                                      <td class="num py-1 pr-3">{{ r.key }}</td>
                                      <td class="num py-1 pr-3 break-all text-destructive"><span class="sr-only">Before: </span>{{ r.before }}</td>
                                      <td class="num py-1 break-all text-primary"><span class="sr-only">After: </span>{{ r.after }}</td>
                                    </tr>
                                  }
                                </tbody>
                              </table>
                            </div>
                          } @else {
                            <p class="text-muted-foreground">No field changes recorded.</p>
                          }
                        }
                        <details class="mt-2">
                          <summary class="cursor-pointer text-xs text-muted-foreground">Raw JSON</summary>
                          <pre class="num mt-1 max-h-64 overflow-auto rounded-sm bg-muted p-2 text-xs">{{ raw(a) }}</pre>
                        </details>
                      </div>
                    </details>
                  </li>
                }
              </ol>
            }
            <div class="mt-3 flex justify-center">
              @if (audit.cursor()) {
                <button hlmBtn type="button" variant="outline" class="h-11" (click)="audit.load(true)" [disabled]="audit.loading()">{{ audit.loading() ? 'Loading…' : 'Load more' }}</button>
              }
            </div>
          }

          @case ('captures') {
            @if (captures.loading() && !captures.items().length) {
              <zeus-loading-skeleton [rows]="5" />
            } @else if (captures.error() && !captures.items().length) {
              <zeus-error-state [error]="captures.error()" (retry)="captures.load()" />
            } @else if (!filteredCaptures().length) {
              <zeus-empty-state icon="lucideFlag" [title]="query() ? 'No matching captures' : 'No captures yet'" />
            } @else {
              <ol class="panel divide-y divide-border">
                @for (c of filteredCaptures(); track c.id) {
                  <li class="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm" [class.opacity-60]="c.revoked">
                    <time class="w-24 shrink-0" [attr.datetime]="c.createdAt" [title]="abs(c.createdAt)">
                      <span class="num block font-semibold">{{ rel(c.createdAt) }}</span>
                      <span class="block text-xs text-muted-foreground">{{ abs(c.createdAt) }}</span>
                    </time>
                    <div class="min-w-0 flex-1">
                      <p class="font-semibold" [class.line-through]="c.revoked">{{ c.objectiveName }}</p>
                      <p class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <zeus-team-badge [team]="teamById().get(c.teamId)" size="sm" emptyLabel="Unknown team" />
                        <span>{{ c.nickname ?? (c.method === 'gm' ? 'Game Master' : 'Unknown player') }}</span>
                        <span class="num uppercase">· {{ c.method }}</span>
                        <span class="num">· +{{ n(c.points) }} pts · +{{ n(c.currency) }} cr</span>
                      </p>
                    </div>
                    @if (c.revoked) {
                      <zeus-status-chip label="Revoked" glyph="✕" tone="danger" />
                    } @else {
                      <label class="flex min-h-10 cursor-pointer items-center gap-2 text-xs">
                        <input type="checkbox" class="size-5 accent-primary" [checked]="!keepRewards().has(c.id)" (change)="setReverse(c.id, $any($event.target).checked)" />
                        Reverse rewards
                      </label>
                      <button hlmBtn type="button" variant="destructive" class="h-10" (click)="revoke(c)" [disabled]="busyId() === c.id">
                        {{ busyId() === c.id ? 'Revoking…' : 'Revoke' }}
                      </button>
                    }
                  </li>
                }
              </ol>
            }
            <div class="mt-3 flex justify-center">
              @if (captures.cursor()) {
                <button hlmBtn type="button" variant="outline" class="h-11" (click)="captures.load(true)" [disabled]="captures.loading()">{{ captures.loading() ? 'Loading…' : 'Load more' }}</button>
              }
            </div>
          }

          @case ('alerts') {
            @if (alerts.loading() && !alerts.items().length) {
              <zeus-loading-skeleton [rows]="5" />
            } @else if (alerts.error() && !alerts.items().length) {
              <zeus-error-state [error]="alerts.error()" (retry)="alerts.load()" />
            } @else if (!filteredAlerts().length) {
              <zeus-empty-state icon="lucideBell" [title]="query() ? 'No matching alerts' : 'No alerts'" message="GPS warnings, disconnections and purchase requests appear here." />
            } @else {
              <ol class="panel divide-y divide-border">
                @for (a of filteredAlerts(); track a.id) {
                  <li class="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm" [class.opacity-60]="a.acknowledged">
                    <zeus-status-chip [label]="sev(a).label" [glyph]="sev(a).glyph" [tone]="sev(a).tone" />
                    <div class="min-w-0 flex-1">
                      <p>{{ a.message }}</p>
                      <p class="text-xs text-muted-foreground">
                        {{ a.nickname ? a.nickname + ' · ' : '' }}<span class="num">{{ a.type }}</span> · <time [attr.datetime]="a.createdAt">{{ rel(a.createdAt) }} · {{ abs(a.createdAt) }}</time>
                      </p>
                    </div>
                    @if (a.acknowledged) {
                      <span class="text-xs text-muted-foreground">✓ Acknowledged</span>
                    } @else {
                      <button hlmBtn type="button" variant="outline" class="h-10" (click)="ack(a)" [disabled]="busyId() === a.id">Acknowledge</button>
                    }
                  </li>
                }
              </ol>
            }
            <div class="mt-3 flex justify-center">
              @if (alerts.cursor()) {
                <button hlmBtn type="button" variant="outline" class="h-11" (click)="alerts.load(true)" [disabled]="alerts.loading()">{{ alerts.loading() ? 'Loading…' : 'Load more' }}</button>
              }
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class ActivityLogScreen {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly eventId = input.required<string>();
  /** ?tab=activity|audit|captures|alerts */
  readonly initialTab = input<string | undefined>(undefined, { alias: 'tab' });

  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'activity', label: 'Activity' },
    { id: 'audit', label: 'Audit log' },
    { id: 'captures', label: 'Captures' },
    { id: 'alerts', label: 'Alerts' },
  ];
  protected readonly tab = signal<Tab>('activity');
  protected readonly query = signal('');
  protected readonly event = signal<EventDetail | null>(null);
  protected readonly busyId = signal<string | null>(null);
  /** Captures for which the GM unticked "Reverse rewards". */
  protected readonly keepRewards = signal(new Set<string>());

  protected readonly activity = new Pager<ActivityItem>((c) => this.api.activity(this.eventId(), c));
  protected readonly audit = new Pager<AuditLogEntry>((c) => this.api.auditLog(this.eventId(), c));
  protected readonly captures = new Pager<Capture>((c) => this.api.captures(this.eventId(), c));
  protected readonly alerts = new Pager<GmAlert>((c) => this.api.alerts(this.eventId(), c));

  protected readonly teamById = computed(() => new Map((this.event()?.teams ?? []).map((t) => [t.id, t])));
  protected readonly openAlerts = computed(() => this.alerts.items().filter((a) => !a.acknowledged).length);

  private readonly q = computed(() => this.query().trim().toLowerCase());
  protected readonly filteredActivity = computed(() => this.filter(this.activity.items(), (a) => [a.message, a.type, this.teamName(a.teamId)]));
  protected readonly filteredAudit = computed(() =>
    this.filter(this.audit.items(), (a) => [a.action, a.actorNickname, a.targetType, a.targetId, a.reason, JSON.stringify(a.after ?? ''), JSON.stringify(a.before ?? '')]),
  );
  protected readonly filteredCaptures = computed(() =>
    this.filter(this.captures.items(), (c) => [c.objectiveName, c.nickname, c.method, this.teamName(c.teamId), c.revoked ? 'revoked' : '']),
  );
  protected readonly filteredAlerts = computed(() => this.filter(this.alerts.items(), (a) => [a.message, a.nickname, a.type, a.severity]));

  protected readonly rel = (iso: string) => formatRelative(iso);
  protected readonly abs = formatDateTime;
  protected readonly n = formatNumber;
  protected readonly sev = (a: GmAlert) => ALERT_TONE[a.severity];

  private readonly diffCache = new WeakMap<AuditLogEntry, DiffRow[]>();

  constructor() {
    effect(() => {
      const t = this.initialTab();
      if (t === 'activity' || t === 'audit' || t === 'captures' || t === 'alerts') untracked(() => this.select(t));
    });
    effect(() => {
      const id = this.eventId();
      untracked(() => {
        void this.api
          .event(id)
          .then((e) => this.event.set(e))
          .catch(() => undefined);
        void this.alerts.load();
        void this.pagerFor(this.tab()).load();
      });
    });
  }

  protected select(t: Tab): void {
    this.tab.set(t);
    const p = this.pagerFor(t);
    if (!p.loaded() && !p.loading()) void p.load();
  }

  protected tabKey(e: KeyboardEvent): void {
    const idx = this.tabs.findIndex((t) => t.id === this.tab());
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % this.tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + this.tabs.length) % this.tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = this.tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    this.select(this.tabs[next].id);
    document.getElementById('tab-' + this.tabs[next].id)?.focus();
  }

  private pagerFor(t: Tab): Pager<unknown> {
    return (t === 'activity' ? this.activity : t === 'audit' ? this.audit : t === 'captures' ? this.captures : this.alerts) as Pager<unknown>;
  }

  private teamName(id: string | null): string {
    return id ? (this.teamById().get(id)?.name ?? '') : '';
  }

  private filter<T>(items: T[], fields: (x: T) => (string | null | undefined)[]): T[] {
    const q = this.q();
    if (!q) return items;
    return items.filter((x) => fields(x).some((f) => !!f && f.toLowerCase().includes(q)));
  }

  protected scopeLabel(s: ActivityItem['scope']): string {
    return s === 'all' ? 'Everyone' : s === 'team' ? 'Team' : 'GM only';
  }

  protected shortId(id: string | null): string {
    return id ? id.slice(0, 8) : '';
  }

  protected raw(a: AuditLogEntry): string {
    return JSON.stringify({ before: a.before ?? null, after: a.after ?? null }, null, 2);
  }

  /** Flattened before/after comparison of changed fields. */
  protected diff(a: AuditLogEntry): DiffRow[] {
    const cached = this.diffCache.get(a);
    if (cached) return cached;
    const before = flatten(a.before);
    const after = flatten(a.after);
    const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
    const rows = keys
      .filter((k) => before.get(k) !== after.get(k))
      .map((k) => ({ key: k || '(value)', before: before.has(k) ? before.get(k)! : '—', after: after.has(k) ? after.get(k)! : '—' }));
    this.diffCache.set(a, rows);
    return rows;
  }

  protected setReverse(id: string, reverse: boolean): void {
    this.keepRewards.update((s) => {
      const next = new Set(s);
      if (reverse) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected async revoke(c: Capture): Promise<void> {
    const reverse = !this.keepRewards().has(c.id);
    const team = this.teamById().get(c.teamId)?.name ?? 'The team';
    const consequences = [
      `The capture of ${c.objectiveName} by ${team}${c.nickname ? ' (' + c.nickname + ')' : ''} is marked as revoked.`,
      reverse
        ? `${team} loses the ${formatNumber(c.points)} points and ${formatNumber(c.currency)} credits it awarded (a "Capture revoked" ledger entry).`
        : 'Points and credits already awarded are kept.',
      'Recorded in the audit log with your reason.',
    ];
    const reason = await this.confirm.askReason({
      title: 'Revoke this capture?',
      consequences,
      confirmLabel: 'Revoke capture',
      destructive: true,
      reason: { label: 'Reason', required: true, placeholder: 'e.g. Code was shared over the radio' },
    });
    if (reason === null) return;
    if (reason.trim().length < 3) {
      this.toast.warning('Give a reason of at least 3 characters');
      return;
    }
    this.busyId.set(c.id);
    try {
      await this.api.revokeCapture(this.eventId(), c.id, reverse, reason.trim());
      this.captures.items.update((l) => l.map((x) => (x.id === c.id ? { ...x, revoked: true } : x)));
      this.toast.success('Capture revoked', reverse ? 'Rewards reversed.' : 'Rewards kept.');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busyId.set(null);
    }
  }

  protected async ack(a: GmAlert): Promise<void> {
    this.busyId.set(a.id);
    try {
      await this.api.acknowledgeAlert(this.eventId(), a.id);
      this.alerts.items.update((l) => l.map((x) => (x.id === a.id ? { ...x, acknowledged: true } : x)));
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busyId.set(null);
    }
  }
}

function flatten(v: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (v === undefined) return out;
  if (v === null || typeof v !== 'object') {
    out.set(prefix, v === null ? 'null' : String(v));
    return out;
  }
  if (Array.isArray(v)) {
    out.set(prefix, JSON.stringify(v));
    return out;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) out.set(prefix, '{}');
  for (const [k, val] of entries) flatten(val, prefix ? `${prefix}.${k}` : k, out);
  return out;
}
