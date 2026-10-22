import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { EventDetail, ExportKind } from '../../core/api/models';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { downloadBlob } from '../../core/util/format';
import { ConnectionStatus } from '../../shared/link-status';
import { ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { copyText, shareOrCopy } from '../events/share-utils';
import { publicResultsUrl, slugify } from './results-utils';

type JobId = 'pdf' | ExportKind;

const CSV_KINDS: { kind: ExportKind; label: string; description: string; gmOnly?: boolean }[] = [
  { kind: 'leaderboard', label: 'Team leaderboard', description: 'Rank, points, credits, objectives and perks per team.' },
  { kind: 'players', label: 'Players', description: 'Points, captures and credits earned per player.' },
  { kind: 'captures', label: 'Captures', description: 'Every capture with time, objective, team, player and method.' },
  { kind: 'ledger', label: 'Score ledger', description: 'Every points and credits movement with its reason.', gmOnly: true },
  { kind: 'perks', label: 'Perk purchases', description: 'Every perk bought, its price, target and outcome.' },
];

/** Downloads (PDF, CSV) and the shareable results page. */
@Component({
  selector: 'zeus-export-results-screen',
  imports: [RouterLink, NgIcon, HlmButton, ConnectionStatus, ErrorState, LoadingSkeleton, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      @if (loading() && !event()) {
        <div class="mb-4 h-10 w-2/3 animate-pulse rounded-sm bg-muted" aria-hidden="true"></div>
        <zeus-loading-skeleton [rows]="5" />
      } @else if (error() && !event()) {
        <zeus-page-header title="Export results" [back]="'/events/' + eventId() + '/results'" backLabel="Results" />
        <zeus-error-state [error]="error()" (retry)="load()" />
      } @else if (event(); as e) {
        <zeus-page-header title="Export results" [eyebrow]="e.name" [back]="'/events/' + e.id + '/results'" backLabel="Results">
          <zeus-connection-status [compact]="true" />
        </zeus-page-header>

        @if (!canExport()) {
          <div class="mb-4 rounded-md border border-border bg-muted p-4 text-sm" role="status">
            ◌ Downloads are available when the game is over.
            <a class="font-semibold text-primary underline-offset-4 hover:underline" [routerLink]="['/events', e.id]">Back to the event</a>
          </div>
        }

        <section class="mb-6" aria-labelledby="pdf-title">
          <h2 id="pdf-title" class="label-caps mb-2">Report</h2>
          <div class="panel flex items-center gap-3 p-4">
            <span class="grid size-11 shrink-0 place-items-center rounded-md bg-muted text-primary" aria-hidden="true"><ng-icon name="lucideFileText" size="22" /></span>
            <div class="min-w-0 flex-1">
              <p class="font-semibold">PDF report</p>
              <p class="text-sm text-muted-foreground">Winner, leaderboard, timeline and top players on printable pages.</p>
            </div>
            <button hlmBtn type="button" class="h-11 shrink-0" [disabled]="!canExport() || running().has('pdf')" (click)="download('pdf')" [attr.aria-label]="'Download PDF report'">
              @if (running().has('pdf')) {
                <ng-icon name="lucideLoader2" size="16" class="animate-spin" aria-hidden="true" /> Preparing…
              } @else if (done().has('pdf')) {
                <ng-icon name="lucideCheck" size="16" aria-hidden="true" /> Again
              } @else {
                <ng-icon name="lucideDownload" size="16" aria-hidden="true" /> PDF
              }
            </button>
          </div>
        </section>

        <section class="mb-6" aria-labelledby="csv-title">
          <h2 id="csv-title" class="label-caps mb-2">Spreadsheets (CSV)</h2>
          <ul class="panel divide-y divide-border">
            @for (c of csvKinds(); track c.kind) {
              <li class="flex items-center gap-3 p-4">
                <div class="min-w-0 flex-1">
                  <p class="font-semibold">{{ c.label }}</p>
                  <p class="text-sm text-muted-foreground">{{ c.description }}</p>
                </div>
                <button hlmBtn variant="outline" type="button" class="h-11 shrink-0" [disabled]="!canExport() || running().has(c.kind)" (click)="download(c.kind)" [attr.aria-label]="'Download ' + c.label + ' CSV'">
                  @if (running().has(c.kind)) {
                    <ng-icon name="lucideLoader2" size="16" class="animate-spin" aria-hidden="true" /> Preparing…
                  } @else if (done().has(c.kind)) {
                    <ng-icon name="lucideCheck" size="16" class="text-primary" aria-hidden="true" /> Again
                  } @else {
                    <ng-icon name="lucideFileDown" size="16" aria-hidden="true" /> CSV
                  }
                </button>
              </li>
            }
          </ul>
          @if (!e.isGm) {
            <p class="mt-2 text-xs text-muted-foreground">The full score ledger is available to Game Masters only.</p>
          }
        </section>

        <section aria-labelledby="page-title">
          <h2 id="page-title" class="label-caps mb-2">Shareable results page</h2>
          <div class="panel flex flex-col gap-3 p-4">
            @if (published() && shareUrl()) {
              <p class="text-sm"><span class="font-semibold text-primary">● Published.</span> Anyone with the link sees the winner, leaderboard and timeline. No positions or player accounts are shown.</p>
              <p class="num truncate rounded-sm border border-dashed border-border bg-muted px-2 py-1.5 text-xs" [title]="shareUrl()">{{ shareUrl() }}</p>
              <div class="grid grid-cols-2 gap-2">
                <button hlmBtn variant="outline" type="button" class="h-11" (click)="copyLink()">
                  <ng-icon [name]="copied() ? 'lucideCheck' : 'lucideCopy'" size="16" aria-hidden="true" /> {{ copied() ? 'Copied' : 'Copy link' }}
                </button>
                <button hlmBtn type="button" class="h-11" (click)="share()"><ng-icon name="lucideShare2" size="16" aria-hidden="true" /> Share</button>
              </div>
              @if (e.isGm) {
                <button hlmBtn variant="ghost" type="button" class="tap self-start text-destructive" [disabled]="publishing()" (click)="unpublish()">
                  <ng-icon name="lucideEyeOff" size="16" aria-hidden="true" /> Unpublish
                </button>
              }
            } @else if (e.isGm) {
              <p class="text-sm text-muted-foreground">
                {{ published() === false && e.resultsToken ? '○ Unpublished. The link shows "not available" until you publish again.' : '○ Not published. Publish a public page to share the outcome with players and your club.' }}
              </p>
              <button hlmBtn type="button" class="h-11" [disabled]="publishing() || e.status !== 'completed'" (click)="publish()">
                <ng-icon name="lucideGlobe" size="16" aria-hidden="true" /> {{ publishing() ? 'Publishing…' : published() === false && e.resultsToken ? 'Publish again' : 'Publish results page' }}
              </button>
              @if (e.status !== 'completed') {
                <p class="text-xs text-muted-foreground">Results can be published when the game is over.</p>
              }
            } @else {
              <p class="text-sm text-muted-foreground">○ The Game Master has not published a results page for this event.</p>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class ExportResultsScreen {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly doc = inject(DOCUMENT);

  readonly eventId = input.required<string>();

  protected readonly event = signal<EventDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<unknown>(null);
  protected readonly running = signal<ReadonlySet<JobId>>(new Set());
  protected readonly done = signal<ReadonlySet<JobId>>(new Set());
  protected readonly publishing = signal(false);
  protected readonly copied = signal(false);
  /** null = unknown. GMs get the token even when unpublished, so their state is probed. */
  protected readonly published = signal<boolean | null>(null);
  private readonly token = signal<string | null>(null);

  protected readonly csvKinds = computed(() => (this.event()?.isGm ? CSV_KINDS : CSV_KINDS.filter((c) => !c.gmOnly)));
  /** The API serves exports to GMs at any time and to players once the game is over. */
  protected readonly canExport = computed(() => {
    const e = this.event();
    return !!e && (e.isGm || e.status === 'completed');
  });
  protected readonly shareUrl = computed(() => {
    const t = this.token();
    return t ? publicResultsUrl(this.doc.location.origin, t) : null;
  });

  private requestId = 0;

  constructor() {
    effect(() => {
      this.eventId();
      untracked(() => {
        this.event.set(null);
        void this.load();
      });
    });
  }

  async load(): Promise<void> {
    const req = ++this.requestId;
    this.loading.set(true);
    try {
      const e = await this.api.event(this.eventId());
      if (req !== this.requestId) return;
      this.event.set(e);
      this.token.set(e.resultsToken);
      this.error.set(null);
      if (e.resultsToken && e.isGm) {
        const pub = await this.api.publicResults(e.resultsToken).then(
          () => true,
          (err: unknown) => (ApiError.from(err).status === 404 ? false : null),
        );
        if (req === this.requestId) this.published.set(pub);
      } else {
        this.published.set(!!e.resultsToken);
      }
    } catch (err) {
      if (req === this.requestId) this.error.set(err);
    } finally {
      if (req === this.requestId) this.loading.set(false);
    }
  }

  protected async download(job: JobId): Promise<void> {
    const e = this.event();
    if (!e || this.running().has(job)) return;
    this.running.update((s) => new Set(s).add(job));
    try {
      const blob = job === 'pdf' ? await this.api.exportFile(e.id, 'pdf') : await this.api.exportFile(e.id, 'csv', job);
      const name = job === 'pdf' ? `${slugify(e.name)}-results.pdf` : `${slugify(e.name)}-${job}.csv`;
      downloadBlob(blob, name);
      this.done.update((s) => new Set(s).add(job));
    } catch (err) {
      // Blob responses carry no readable error body: explain the common cases here.
      const ae = ApiError.from(err);
      if (ae.status === 403) this.toast.error('You cannot download this export', 'Players can download once the game is over; the ledger is for Game Masters.');
      else if (ae.status === 429) this.toast.error('Too many downloads', 'Wait a few minutes and try again.');
      else this.toast.error(ae);
    } finally {
      this.running.update((s) => {
        const n = new Set(s);
        n.delete(job);
        return n;
      });
    }
  }

  protected async publish(): Promise<void> {
    const e = this.event();
    if (!e) return;
    this.publishing.set(true);
    try {
      const res = await this.api.publishResults(e.id);
      this.token.set(res.token);
      this.event.update((ev) => (ev ? { ...ev, resultsToken: res.token } : ev));
      this.published.set(true);
      this.toast.success('Results page published');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.publishing.set(false);
    }
  }

  protected async unpublish(): Promise<void> {
    const e = this.event();
    if (!e) return;
    const ok = await this.confirm.ask({
      title: 'Unpublish the results page?',
      consequences: ['The link stops working for everyone who has it.', 'Publishing again brings back the same link.'],
      confirmLabel: 'Unpublish',
      destructive: true,
    });
    if (!ok) return;
    this.publishing.set(true);
    try {
      await this.api.unpublishResults(e.id);
      this.published.set(false);
      this.toast.info('Results page unpublished');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.publishing.set(false);
    }
  }

  protected async copyLink(): Promise<void> {
    const url = this.shareUrl();
    if (!url) return;
    if (await copyText(url)) {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } else {
      this.toast.error('Could not copy the link.');
    }
  }

  protected async share(): Promise<void> {
    const e = this.event();
    const url = this.shareUrl();
    if (!e || !url) return;
    const res = await shareOrCopy({ title: `${e.name} — results`, text: `Results of ${e.name} on AirsoftHub`, url });
    if (res === 'copied') this.toast.success('Link copied');
    else if (res === 'failed') this.toast.error('Could not share the link.');
  }
}
