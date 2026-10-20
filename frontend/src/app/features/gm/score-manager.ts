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

/** Team balances, GM adjustments and the append-only ledger. Route: /gm/events/:eventId/scores */
@Component({
  selector: 'zeus-score-manager-screen',
  imports: [RouterLink, NgIcon, HlmButton, HlmLabel, CurrencyDisplay, ScoreDisplay, EmptyState, ErrorState, LoadingSkeleton, PageHeader, TeamBadge, AdjustBalanceDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <zeus-page-header title="Scores and currency" [eyebrow]="event()?.name ?? 'Game Master'" [back]="'/gm/events/' + eventId()" backLabel="Event editor">
        <a hlmBtn variant="outline" class="h-11" [routerLink]="['/gm/events', eventId(), 'control']">
          <ng-icon name="lucideLayoutDashboard" size="16" aria-hidden="true" /> Control center
        </a>
        <button hlmBtn class="h-11" type="button" (click)="openAdjust(null)" [disabled]="!teams().length">
          <ng-icon name="lucideSlidersHorizontal" size="16" aria-hidden="true" /> Adjust points or credits
        </button>
      </zeus-page-header>

      <!-- balances -->
      <section class="mb-8" aria-labelledby="h-bal">
        <h2 id="h-bal" class="label-caps mb-2">Team balances · {{ teams().length }} teams</h2>
        @if (loadingEvent()) {
          <zeus-loading-skeleton [rows]="3" />
        } @else if (eventError()) {
          <zeus-error-state [error]="eventError()" (retry)="loadEvent()" />
        } @else if (!teams().length) {
          <zeus-empty-state icon="lucideUsers" title="No teams yet" message="Create teams before adjusting scores.">
            <a hlmBtn variant="outline" class="h-11" [routerLink]="['/gm/events', eventId(), 'teams']">Teams and squads</a>
          </zeus-empty-state>
        } @else {
          <div class="panel overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border text-left text-muted-foreground">
                  <th scope="col" class="px-3 py-2 font-medium">#</th>
                  <th scope="col" class="px-3 py-2 font-medium">Team</th>
                  <th scope="col" class="px-3 py-2 text-right font-medium">Points</th>
                  <th scope="col" class="px-3 py-2 text-right font-medium">Credits</th>
                  <th scope="col" class="hidden px-3 py-2 text-right font-medium sm:table-cell">Objectives held</th>
                  <th scope="col" class="px-3 py-2"><span class="sr-only">Actions</span></th>
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
                      <button hlmBtn type="button" variant="outline" class="h-10" (click)="openAdjust(t)" [attr.aria-label]="'Adjust ' + t.name">Adjust</button>
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
            <h2 id="h-ledger" class="label-caps">Ledger · {{ entries().length }}{{ cursor() ? '+' : '' }} entries</h2>
            <p class="mt-1 max-w-prose text-sm text-muted-foreground">
              The ledger is append-only: every capture, purchase and adjustment is a new entry and nothing is edited or deleted. Corrections are new adjustments.
            </p>
          </div>
          <button hlmBtn type="button" variant="outline" class="h-11" (click)="exportCsv()" [disabled]="exporting()">
            <ng-icon name="lucideFileDown" size="16" aria-hidden="true" /> {{ exporting() ? 'Exporting…' : 'Export CSV' }}
          </button>
        </div>
        <div class="mb-3 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="lf-kind">Balance</label>
            <select id="lf-kind" [class]="selectClass" [value]="kind()" (change)="setKind($any($event.target).value)">
              <option value="">Points and credits</option>
              <option value="points">Victory points</option>
              <option value="currency">Credits</option>
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="lf-team">Team</label>
            <select id="lf-team" [class]="selectClass" [value]="teamFilter()" (change)="setTeam($any($event.target).value)">
              <option value="">All teams</option>
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
          <zeus-empty-state icon="lucideHistory" title="No ledger entries" message="Starting balances are written when the game starts; captures, purchases and adjustments follow." />
        } @else {
          <ol class="panel divide-y divide-border">
            @for (l of entries(); track l.id) {
              <li class="grid gap-x-4 gap-y-1 p-3 text-sm lg:grid-cols-[7rem_10rem_1fr_9rem]">
                <div class="flex items-center gap-2 lg:flex-col lg:items-start lg:gap-0">
                  <time class="num font-semibold" [attr.datetime]="l.createdAt" [title]="dateTime(l.createdAt)">{{ time(l.createdAt) }}</time>
                  <span class="text-xs text-muted-foreground">{{ relative(l.createdAt) }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-2 lg:flex-col lg:items-start lg:gap-1">
                  <zeus-team-badge [team]="teamById().get(l.teamId)" size="sm" emptyLabel="Unknown team" />
                  <span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <ng-icon [name]="l.kind === 'points' ? 'lucideTrophy' : 'lucideCoins'" size="12" [class]="l.kind === 'points' ? 'text-primary' : 'text-warning'" aria-hidden="true" />
                    {{ l.kind === 'points' ? 'Points' : 'Credits' }} · {{ typeLabel(l) }}
                  </span>
                </div>
                <div class="min-w-0">
                  @if (l.reason) {
                    <p class="wrap-break-word">{{ l.reason }}</p>
                  }
                  <p class="text-xs text-muted-foreground">
                    @if (l.nickname) {
                      Player {{ l.nickname }} ·
                    }
                    @if (l.objectiveName) {
                      Objective {{ l.objectiveName }} ·
                    }
                    @if (l.perkId) {
                      Perk purchase ·
                    }
                    By {{ l.actorNickname ?? 'System' }}
                  </p>
                </div>
                <div class="flex items-baseline justify-between gap-2 lg:flex-col lg:items-end">
                  <span class="num text-base font-bold" [class.text-destructive]="l.amount < 0" [class.text-primary]="l.amount > 0">{{ signed(l.amount) }}</span>
                  @if (clampNote(l); as c) {
                    <span class="text-xs text-warning lg:text-right">{{ c }}</span>
                  }
                  <span class="num text-xs text-muted-foreground">balance {{ number(l.balanceAfter) }}</span>
                </div>
              </li>
            }
          </ol>
          <div class="mt-3 flex justify-center">
            @if (cursor()) {
              <button hlmBtn type="button" variant="outline" class="h-11" (click)="loadMore()" [disabled]="ledgerLoading()">
                {{ ledgerLoading() ? 'Loading…' : 'Load more' }}
              </button>
            } @else {
              <p class="text-sm text-muted-foreground">Start of the ledger.</p>
            }
          </div>
          @if (ledgerError()) {
            <p class="field-error mt-2 text-center" role="alert">Could not load more entries. Try again.</p>
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

  protected typeLabel(l: LedgerEntry): string {
    return LEDGER_TYPE_LABELS[l.type] ?? l.type;
  }

  /** "−200 requested, −150 applied (balance can't go below 0)" when the server clamped it. */
  protected clampNote(l: LedgerEntry): string | null {
    if (l.requested === l.amount || l.requested === undefined || l.requested === null) return null;
    const why = l.requested < 0 ? "balance can't go below 0" : 'credit cap reached';
    return `${formatSigned(l.requested)} requested, ${formatSigned(l.amount)} applied (${why})`;
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
      this.toast.success('Ledger exported');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.exporting.set(false);
    }
  }
}
