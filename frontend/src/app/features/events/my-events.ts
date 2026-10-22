import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { EventSummary } from '../../core/api/models';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { EventCard } from '../../shared/cards';
import { ConnectionStatus } from '../../shared/link-status';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';

type Tab = 'upcoming' | 'past' | 'gm' | 'invitations';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'upcoming', label: $localize`Upcoming`, icon: 'lucideCalendar' },
  { id: 'past', label: $localize`Past`, icon: 'lucideHistory' },
  { id: 'invitations', label: $localize`Invitations`, icon: 'lucideMail' },
  { id: 'gm', label: $localize`As Game Master`, icon: 'lucideShield' },
];

const EMPTY: Record<Tab, { icon: string; title: string; message: string }> = {
  upcoming: { icon: 'lucideCalendar', title: $localize`No upcoming events`, message: $localize`Events you join or request to join appear here.` },
  past: { icon: 'lucideHistory', title: $localize`No past events`, message: $localize`Finished games and their results appear here.` },
  invitations: { icon: 'lucideMail', title: $localize`No invitations`, message: $localize`When a Game Master invites you to a private event it appears here.` },
  gm: { icon: 'lucideShield', title: $localize`You are not running any events`, message: $localize`Create an event to set up teams, objectives and the map.` },
};

/** My events with tabs bound to ?tab=. */
@Component({
  selector: 'zeus-my-events-screen',
  imports: [RouterLink, NgIcon, HlmButton, EventCard, EmptyState, ErrorState, LoadingSkeleton, PageHeader, ConnectionStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <zeus-page-header title="My events" i18n-title>
        @if (activeTab() === 'gm') {
          @if (auth.can('create_events')) {
            <a hlmBtn class="tap" routerLink="/gm/new"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> <ng-container i18n>Create event</ng-container></a>
          }
        } @else if (auth.can('discover_events')) {
          <a hlmBtn variant="outline" class="tap" routerLink="/events/discover"><ng-icon name="lucideSearch" size="16" aria-hidden="true" /> <ng-container i18n>Discover</ng-container></a>
        }
      </zeus-page-header>

      <nav aria-label="Event lists" class="relative -mx-4 mb-4 overflow-x-auto px-4" i18n-aria-label>
        <ul class="flex min-w-max gap-1 border-b border-border">
          @for (t of tabs; track t.id) {
            <li>
              <a
                [routerLink]="[]"
                [queryParams]="{ tab: t.id }"
                [replaceUrl]="true"
                class="tap -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 text-sm font-semibold"
                [class]="activeTab() === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
                [attr.aria-current]="activeTab() === t.id ? 'page' : null"
              >
                <ng-icon [name]="t.icon" size="15" aria-hidden="true" /> {{ t.label }}
              </a>
            </li>
          }
        </ul>
      </nav>

      @if (offline() && items().length) {
        <div class="mb-3 flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning-surface px-3 py-2 text-sm" role="status">
          <span i18n>Showing the last list loaded.</span>
          <zeus-connection-status />
        </div>
      }

      @if (loading() && !items().length) {
        <zeus-loading-skeleton [rows]="4" />
      } @else if (error() && !items().length) {
        <zeus-error-state [error]="error()" (retry)="load(activeTab())" />
      } @else if (!items().length) {
        <zeus-empty-state [icon]="empty().icon" [title]="empty().title" [message]="empty().message">
          @switch (activeTab()) {
            @case ('gm') {
              @if (auth.can('create_events')) {
                <a hlmBtn class="tap" routerLink="/gm/new"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> <ng-container i18n>Create event</ng-container></a>
              }
            }
            @case ('invitations') {
              <a hlmBtn variant="outline" class="tap" routerLink="/events/join" i18n>Join with a code</a>
            }
            @default {
              @if (auth.can('discover_events')) {
                <a hlmBtn class="tap" routerLink="/events/discover" i18n>Discover events</a>
              } @else {
                <a hlmBtn variant="outline" class="tap" routerLink="/events/join" i18n>Join with a code</a>
              }
            }
          }
        </zeus-empty-state>
      } @else {
        <h2 class="label-caps mb-2">{{ tabLabel() }} · <span class="num">{{ items().length }}</span></h2>
        <ul class="grid grid-cols-1 gap-3 md:grid-cols-2" [attr.aria-busy]="loading()">
          @for (e of items(); track e.id) {
            <li class="flex flex-col gap-2">
              <zeus-event-card [event]="e" [link]="linkFor(e)" />
              @if (activeTab() === 'invitations' && e.myStatus === 'invited') {
                <div class="flex gap-2">
                  <button hlmBtn class="h-11 flex-1" type="button" [disabled]="busy() === e.id" (click)="respond(e, true)">
                    <ng-icon name="lucideCheck" size="16" aria-hidden="true" /> <ng-container i18n>Accept</ng-container>
                  </button>
                  <button hlmBtn variant="outline" class="h-11 flex-1" type="button" [disabled]="busy() === e.id" (click)="respond(e, false)">
                    <ng-icon name="lucideX" size="16" aria-hidden="true" /> <ng-container i18n>Decline</ng-container>
                  </button>
                </div>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class MyEventsScreen {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  /** ?tab= query param */
  readonly tab = input<string>();

  protected readonly tabs = TABS;
  protected readonly activeTab = computed<Tab>(() => {
    const t = this.tab();
    return TABS.some((x) => x.id === t) ? (t as Tab) : 'upcoming';
  });
  protected readonly tabLabel = computed(() => TABS.find((t) => t.id === this.activeTab())!.label);
  protected readonly empty = computed(() => EMPTY[this.activeTab()]);

  protected readonly items = signal<EventSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<unknown>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly offline = computed(() => {
    const e = this.error();
    return !!e && ApiError.from(e).isNetwork;
  });

  private requestId = 0;

  constructor() {
    effect(() => {
      const tab = this.activeTab();
      untracked(() => {
        this.items.set([]);
        void this.load(tab);
      });
    });
  }

  protected linkFor(e: EventSummary): unknown[] | null {
    if (this.activeTab() !== 'gm' || !e.isGm) return null;
    return e.status === 'live' || e.status === 'paused' ? ['/gm/events', e.id, 'control'] : ['/gm/events', e.id];
  }

  protected async load(tab: Tab): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    try {
      const list = await this.api.myEvents(tab);
      if (id !== this.requestId) return;
      this.items.set(list);
      this.error.set(null);
    } catch (err) {
      if (id === this.requestId) this.error.set(err);
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  protected async respond(e: EventSummary, accept: boolean): Promise<void> {
    if (!accept) {
      const ok = await this.confirm.ask({
        title: $localize`Decline ${e.name}:name:?`,
        consequences: [
          $localize`The Game Master sees that you declined.`,
          e.visibility === 'private' ? $localize`To join later you need the join code or a new invitation.` : $localize`You can still request to join later.`,
        ],
        confirmLabel: $localize`Decline invitation`,
      });
      if (!ok) return;
    }
    this.busy.set(e.id);
    try {
      const res = await this.api.respondToInvitation(e.id, accept);
      this.items.update((list) => list.filter((x) => x.id !== e.id));
      if (accept) {
        this.toast.success(res.status === 'approved' ? $localize`You joined ${e.name}:name:` : $localize`Request sent to the Game Master of ${e.name}:name:`);
        void this.router.navigate(['/events', e.id]);
      } else {
        this.toast.info($localize`Invitation to ${e.name}:name: declined`);
      }
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(null);
    }
  }
}
