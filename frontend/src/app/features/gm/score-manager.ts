import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiService } from '../../core/api/api.service';
import { EventDetail, LedgerEntry, LedgerKind, Member, Team } from '../../core/api/models';
import { ToastService } from '../../core/ui/toast.service';
import { LEDGER_TYPE_LABELS, downloadBlob, formatDateTime, formatNumber, formatRelative, formatSigned, formatTime } from '../../core/util/format';
import { CurrencyDisplay } from '../../shared/currency-display';
import { ScoreDisplay } from '../../shared/score-display';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { TeamBadge } from '../../shared/team-badge';
import { AdjustBalanceDialog } from './ops/adjust-balance-dialog';

const SELECT_CLASS = 'h-11 w-full rounded-md border border-input bg-transparent px-2 dark:bg-input/30';
/** Ledger row. Phones: time | team, type / details | amount on two lines. Desktop: four columns. */
const ROW_CLASS =
  'grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2 text-sm lg:grid-cols-[7rem_10rem_1fr_9rem] lg:gap-x-4 lg:gap-y-1 lg:p-3';

/** A ledger line: one entry, or a run of automatic "holding objective" payouts folded together. */
interface LedgerRow {
  id: string;
  entry?: LedgerEntry;
  group?: { entries: LedgerEntry[]; first: LedgerEntry; last: LedgerEntry; total: number };
}

/**
 * Folds `recurring` entries (newest first) of the same team, objective and balance into one row,
 * placed where the newest one is. Any other entry on that objective ends the run.
 */
function foldRecurring(entries: LedgerEntry[]): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const open = new Map<string, LedgerRow>();
  for (const e of entries) {
    if (e.type !== 'recurring' || !e.objectiveId) {
      for (const [k, r] of open) if (e.objectiveId && r.group!.last.objectiveId === e.objectiveId) open.delete(k);
      rows.push({ id: e.id, entry: e });
      continue;
    }
    const key = `${e.teamId}|${e.objectiveId}|${e.kind}`;
    // another team holding it now: the earlier run of the previous holder is over
    for (const [k, r] of open) if (k !== key && r.group!.last.objectiveId === e.objectiveId && r.group!.last.kind === e.kind) open.delete(k);
    const run = open.get(key);
    if (run) {
      run.group!.entries.push(e);
      run.group!.first = e;
      run.group!.total += e.amount;
    } else {
      const row: LedgerRow = { id: e.id, group: { entries: [e], first: e, last: e, total: e.amount } };
      open.set(key, row);
      rows.push(row);
    }
  }
  // a single payout reads better as a plain entry
  return rows.map((r) => (r.group && r.group.entries.length === 1 ? { id: r.id, entry: r.group.last } : r));
}

/** Team balances, GM adjustments and the append-only ledger. Route: /gm/events/:eventId/scores */
@Component({
  selector: 'zeus-score-manager-screen',
  imports: [NgTemplateOutlet, RouterLink, NgIcon, HlmButton, HlmLabel, CurrencyDisplay, ScoreDisplay, EmptyState, ErrorState, LoadingSkeleton, PageHeader, TeamBadge, AdjustBalanceDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <zeus-page-header title="Scores and currency" [eyebrow]="event()?.name ?? txt.gameMaster" [back]="'/gm/events/' + eventId()" backLabel="Event editor" i18n-title i18n-backLabel>
        <a hlmBtn variant="outline" class="h-11" [routerLink]="['/gm/events', eventId(), 'control']">
          <ng-icon name="lucideLayoutDashboard" size="16" aria-hidden="true" /> <ng-container i18n>Control center</ng-container>
        </a>
        <button hlmBtn class="h-11" type="button" (click)="openAdjust(null)" [disabled]="!teams().length">
          <ng-icon name="lucideSlidersHorizontal" size="16" aria-hidden="true" /> <ng-container i18n>Adjust points or credits</ng-container>
        </button>
      </zeus-page-header>

      <!-- balances -->
      <section class="mb-8" aria-labelledby="h-bal">
        <h2 id="h-bal" class="label-caps mb-2" i18n>Team balances · {{ teams().length }} teams</h2>
        @if (loadingEvent()) {
          <zeus-loading-skeleton [rows]="3" />
        } @else if (eventError()) {
          <zeus-error-state [error]="eventError()" (retry)="loadEvent()" />
        } @else if (!teams().length) {
          <zeus-empty-state icon="lucideUsers" title="No teams yet" message="Create teams before adjusting scores." i18n-title i18n-message>
            <a hlmBtn variant="outline" class="h-11" [routerLink]="['/gm/events', eventId(), 'teams']" i18n>Teams and squads</a>
          </zeus-empty-state>
        } @else {
          <div class="relative panel overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border text-left text-muted-foreground">
                  <th scope="col" class="px-3 py-2 font-medium">#</th>
                  <th scope="col" class="px-3 py-2 font-medium" i18n>Team</th>
                  <th scope="col" class="px-3 py-2 text-right font-medium" i18n>Points</th>
                  <th scope="col" class="px-3 py-2 text-right font-medium" i18n>Credits</th>
                  <th scope="col" class="hidden px-3 py-2 text-right font-medium sm:table-cell" i18n>Objectives held</th>
                  <th scope="col" class="px-3 py-2"><span class="sr-only" i18n>Actions</span></th>
                </tr>
              </thead>
              <tbody>
                @for (t of rankedTeams(); track t.id; let i = $index) {
                  <tr class="border-b border-border last:border-0">
                    <td class="num px-3 py-2 text-muted-foreground">{{ i + 1 }}</td>
                    <td class="px-3 py-2"><zeus-team-badge [team]="t" size="sm" /></td>
                    <td class="px-3 py-2 text-right"><zeus-score-display [points]="t.points" size="sm" [showUnit]="false" /></td>
                    <td class="px-3 py-2 text-right"><zeus-currency-display [amount]="t.currency" size="sm" [showUnit]="false" /></td>
                    <td class="num hidden px-3 py-2 text-right sm:table-cell">{{ t.objectivesHeld }}</td>
                    <td class="px-3 py-1 text-right">
                      <button hlmBtn type="button" variant="outline" class="h-10" (click)="openAdjust(t)" ariaLabel="Adjust {{ t.name }}" i18n-ariaLabel i18n>Adjust</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <!-- ledger -->
      <section aria-labelledby="h-ledger">
        <div class="mb-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="h-ledger" class="label-caps" i18n>Ledger · {{ entries().length }}{{ cursor() ? '+' : '' }} entries</h2>
            <p class="mt-1 max-w-prose text-sm text-muted-foreground" i18n>
              The ledger is append-only: every capture, purchase and adjustment is a new entry and nothing is edited or deleted. Corrections are new adjustments.
            </p>
          </div>
          <button hlmBtn type="button" variant="outline" class="h-11" (click)="exportCsv()" [disabled]="exporting()">
            <ng-icon name="lucideFileDown" size="16" aria-hidden="true" /> {{ exporting() ? txt.exporting : txt.exportCsv }}
          </button>
        </div>
        <div class="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="lf-kind" i18n>Balance</label>
            <select id="lf-kind" [class]="selectClass" [value]="kind()" (change)="setKind($any($event.target).value)">
              <option value="" i18n>Points and credits</option>
              <option value="points" i18n>Victory points</option>
              <option value="currency" i18n>Credits</option>
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="lf-team" i18n>Team</label>
            <select id="lf-team" [class]="selectClass" [value]="teamFilter()" (change)="setTeam($any($event.target).value)">
              <option value="" i18n>All teams</option>
              @for (t of teams(); track t.id) {
                <option [value]="t.id">{{ t.name }}</option>
              }
            </select>
          </div>
        </div>

        @if (ledgerLoading() && !entries().length) {
          <zeus-loading-skeleton [rows]="5" />
        } @else if (ledgerError() && !entries().length) {
          <zeus-error-state [error]="ledgerError()" (retry)="reloadLedger()" />
        } @else if (!entries().length) {
          <zeus-empty-state icon="lucideHistory" title="No ledger entries" message="Starting balances are written when the game starts; captures, purchases and adjustments follow." i18n-title i18n-message />
        } @else {
          <ol class="panel divide-y divide-border">
            @for (r of rows(); track r.id) {
              @if (r.group; as g) {
                <!-- Automatic "holding objective" payouts in a row, folded into one line -->
                <li>
                  <button type="button" [class]="rowClass + ' w-full text-left hover:bg-muted'" [attr.aria-expanded]="expanded().has(r.id)" (click)="toggleGroup(r.id)">
                    <div class="row-span-2 lg:row-span-1">
                      <time class="num font-semibold" [attr.datetime]="g.last.createdAt" [title]="dateTime(g.last.createdAt)">{{ time(g.last.createdAt) }}</time>
                      <span class="block text-xs text-muted-foreground max-lg:hidden">{{ relative(g.last.createdAt) }}</span>
                    </div>
                    <div class="flex min-w-0 flex-wrap items-center gap-x-2 lg:flex-col lg:items-start lg:gap-1">
                      <zeus-team-badge [team]="teamById().get(g.last.teamId)" size="sm" emptyLabel="Unknown team" i18n-emptyLabel />
                      <ng-container [ngTemplateOutlet]="kindTpl" [ngTemplateOutletContext]="{ $implicit: g.last }" />
                    </div>
                    <p class="col-start-2 flex min-w-0 items-start gap-1 text-xs text-muted-foreground lg:col-start-auto lg:items-center lg:text-sm lg:text-foreground">
                      <ng-icon [name]="expanded().has(r.id) ? 'lucideChevronDown' : 'lucideChevronRight'" size="14" class="shrink-0" aria-hidden="true" />
                      <span class="min-w-0 lg:truncate">{{ g.last.objectiveName }} · <span class="num">{{ g.entries.length }} × {{ signed(g.last.amount) }}</span> · <span class="num">{{ time(g.first.createdAt) }}–{{ time(g.last.createdAt) }}</span></span>
                    </p>
                    <ng-container [ngTemplateOutlet]="amountTpl" [ngTemplateOutletContext]="{ amount: g.total, balance: g.last.balanceAfter }" />
                  </button>
                  @if (expanded().has(r.id)) {
                    <ol class="divide-y divide-border border-t border-border bg-muted/40">
                      @for (l of g.entries; track l.id) {
                        <li><ng-container [ngTemplateOutlet]="entryTpl" [ngTemplateOutletContext]="{ $implicit: l }" /></li>
                      }
                    </ol>
                  }
                </li>
              } @else if (r.entry; as l) {
                <li><ng-container [ngTemplateOutlet]="entryTpl" [ngTemplateOutletContext]="{ $implicit: l }" /></li>
              }
            }
          </ol>

          <!-- One entry. Phones: time | team, type / reason, details | amount, balance -->
          <ng-template #entryTpl let-l>
            <div [class]="rowClass">
              <div class="row-span-2 lg:row-span-1">
                <time class="num font-semibold" [attr.datetime]="l.createdAt" [title]="dateTime(l.createdAt)">{{ time(l.createdAt) }}</time>
                <span class="block text-xs text-muted-foreground max-lg:hidden">{{ relative(l.createdAt) }}</span>
              </div>
              <div class="flex min-w-0 flex-wrap items-center gap-x-2 lg:flex-col lg:items-start lg:gap-1">
                <zeus-team-badge [team]="teamById().get(l.teamId)" size="sm" emptyLabel="Unknown team" i18n-emptyLabel />
                <ng-container [ngTemplateOutlet]="kindTpl" [ngTemplateOutletContext]="{ $implicit: l }" />
              </div>
              <div class="col-start-2 min-w-0 lg:col-start-auto">
                @if (l.reason) {
                  <p class="wrap-break-word">{{ l.reason }}</p>
                }
                <p class="text-xs text-muted-foreground">
                  @if (l.nickname) {
                    <ng-container i18n>Player {{ l.nickname }} ·</ng-container>
                  }
                  @if (l.objectiveName) {
                    <ng-container i18n>Objective {{ l.objectiveName }} ·</ng-container>
                  }
                  @if (l.perkId) {
                    <ng-container i18n>Perk purchase ·</ng-container>
                  }
                  <ng-container i18n>By {{ l.actorNickname ?? txt.system }}</ng-container>
                </p>
                @if (clampNote(l); as c) {
                  <p class="text-xs text-warning">{{ c }}</p>
                }
              </div>
              <ng-container [ngTemplateOutlet]="amountTpl" [ngTemplateOutletContext]="{ amount: l.amount, balance: l.balanceAfter }" />
            </div>
          </ng-template>
          <ng-template #kindTpl let-l>
            <span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ng-icon [name]="l.kind === 'points' ? 'lucideTrophy' : 'lucideCoins'" size="12" [class]="l.kind === 'points' ? 'text-primary' : 'text-warning'" aria-hidden="true" />
              {{ l.kind === 'points' ? txt.points : txt.credits }} · {{ typeLabel(l) }}
            </span>
          </ng-template>
          <ng-template #amountTpl let-amount="amount" let-balance="balance">
            <div class="col-start-3 row-span-2 row-start-1 flex flex-col items-end lg:col-start-auto lg:row-span-1 lg:row-start-auto">
              <span class="num text-base font-bold" [class.text-destructive]="amount < 0" [class.text-primary]="amount > 0">{{ signed(amount) }}</span>
              <span class="num text-xs text-muted-foreground" i18n>balance {{ number(balance) }}</span>
            </div>
          </ng-template>
          <div class="mt-3 flex justify-center">
            @if (cursor()) {
              <button hlmBtn type="button" variant="outline" class="h-11" (click)="loadMore()" [disabled]="ledgerLoading()">
                {{ ledgerLoading() ? txt.loading : txt.loadMore }}
              </button>
            } @else {
              <p class="text-sm text-muted-foreground" i18n>Start of the ledger.</p>
            }
          </div>
          @if (ledgerError()) {
            <p class="field-error mt-2 text-center" role="alert" i18n>Could not load more entries. Try again.</p>
          }
        }
      </section>
    </div>

    <zeus-adjust-balance-dialog
      [eventId]="eventId()"
      [teams]="teams()"
      [members]="members()"
      [open]="adjustOpen()"
      [presetTeamId]="adjustTeamId()"
      [allowNegativePoints]="event()?.scoring?.allowNegativePoints ?? false"
      [maxCurrency]="event()?.scoring?.maxCurrency ?? 0"
      (closed)="adjustOpen.set(false)"
      (adjusted)="afterAdjust()"
    />
  `,
})
export class ScoreManagerScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    exporting: $localize`Exporting…`,
    exportCsv: $localize`Export CSV`,
    points: $localize`Points`,
    credits: $localize`Credits`,
    system: $localize`System`,
    loading: $localize`Loading…`,
    loadMore: $localize`Load more`,
    gameMaster: $localize`Game Master`,
  };

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly eventId = input.required<string>();

  protected readonly selectClass = SELECT_CLASS;
  protected readonly event = signal<EventDetail | null>(null);
  protected readonly members = signal<Member[]>([]);
  protected readonly loadingEvent = signal(true);
  protected readonly eventError = signal<unknown>(null);

  protected readonly entries = signal<LedgerEntry[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly ledgerLoading = signal(false);
  protected readonly ledgerError = signal<unknown>(null);
  protected readonly kind = signal<'' | LedgerKind>('');
  protected readonly teamFilter = signal('');
  protected readonly exporting = signal(false);

  protected readonly adjustOpen = signal(false);
  protected readonly adjustTeamId = signal<string | null>(null);

  protected readonly rowClass = ROW_CLASS;
  protected readonly rows = computed(() => foldRecurring(this.entries()));
  /** Folded runs the GM opened, by row id. */
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());

  protected readonly teams = computed(() => this.event()?.teams ?? []);
  protected readonly rankedTeams = computed(() => [...this.teams()].sort((a, b) => b.points - a.points || a.sortOrder - b.sortOrder));
  protected readonly teamById = computed(() => new Map(this.teams().map((t) => [t.id, t])));

  protected readonly time = formatTime;
  protected readonly dateTime = formatDateTime;
  protected readonly relative = (iso: string) => formatRelative(iso);
  protected readonly signed = formatSigned;
  protected readonly number = formatNumber;
  private ledgerSeq = 0;

  constructor() {
    effect(() => {
      this.eventId();
      untracked(() => {
        void this.loadEvent();
        void this.reloadLedger();
      });
    });
  }

  async loadEvent(): Promise<void> {
    this.eventError.set(null);
    try {
      const [ev, members] = await Promise.all([this.api.event(this.eventId()), this.api.members(this.eventId()).catch(() => [] as Member[])]);
      this.event.set(ev);
      this.members.set(members);
    } catch (e) {
      this.eventError.set(e);
    } finally {
      this.loadingEvent.set(false);
    }
  }

  async reloadLedger(): Promise<void> {
    this.entries.set([]);
    this.cursor.set(null);
    await this.fetchLedger(null);
  }

  protected loadMore(): void {
    void this.fetchLedger(this.cursor());
  }

  private async fetchLedger(cursor: string | null): Promise<void> {
    const seq = ++this.ledgerSeq;
    this.ledgerLoading.set(true);
    this.ledgerError.set(null);
    try {
      const page = await this.api.ledger(this.eventId(), { kind: this.kind() || undefined, teamId: this.teamFilter() || undefined, cursor });
      if (seq !== this.ledgerSeq) return; // a newer filter won
      this.entries.update((l) => (cursor ? [...l, ...page.items] : page.items));
      this.cursor.set(page.nextCursor);
    } catch (e) {
      if (seq === this.ledgerSeq) this.ledgerError.set(e);
    } finally {
      if (seq === this.ledgerSeq) this.ledgerLoading.set(false);
    }
  }

  protected setKind(v: string): void {
    this.kind.set(v as '' | LedgerKind);
    void this.reloadLedger();
  }

  protected setTeam(v: string): void {
    this.teamFilter.set(v);
    void this.reloadLedger();
  }

  protected toggleGroup(id: string): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected typeLabel(l: LedgerEntry): string {
    return LEDGER_TYPE_LABELS[l.type] ?? l.type;
  }

  /** "−200 requested, −150 applied (balance can't go below 0)" when the server clamped it. */
  protected clampNote(l: LedgerEntry): string | null {
    if (l.requested === l.amount || l.requested === undefined || l.requested === null) return null;
    const why = l.requested < 0 ? $localize`balance can't go below 0` : $localize`credit cap reached`;
    return $localize`${formatSigned(l.requested)}:requested: requested, ${formatSigned(l.amount)}:amount: applied (${why}:why:)`;
  }

  protected openAdjust(t: Team | null): void {
    this.adjustTeamId.set(t?.id ?? null);
    this.adjustOpen.set(true);
  }

  protected afterAdjust(): void {
    void this.loadEvent();
    void this.reloadLedger();
  }

  protected async exportCsv(): Promise<void> {
    this.exporting.set(true);
    try {
      const blob = await this.api.exportFile(this.eventId(), 'csv', 'ledger');
      const name = (this.event()?.name ?? 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      downloadBlob(blob, `${name || 'event'}-ledger.csv`);
      this.toast.success($localize`Ledger exported`);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.exporting.set(false);
    }
  }
}
