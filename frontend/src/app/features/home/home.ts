import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { AppNotification, EventDetail, EventSummary, HomeDashboard } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { NotificationCenter } from '../../core/notifications/notification-center.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { GAME_MODE_LABELS, formatDate, formatTime } from '../../core/util/format';
import { EventCard } from '../../shared/cards';
import { GameTimer, nowSignal } from '../../shared/game-timer';
import { ConnectionStatus } from '../../shared/link-status';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { StatusChip, eventStatusChip } from '../../shared/status-chip';
import { NewsCard } from '../news/news-ui';
import { NotificationRow, notificationLink } from '../notifications/notification-ui';
import { StatTiles } from '../profile/profile-ui';

@Component({
  selector: 'zeus-home-screen',
  imports: [
    RouterLink,
    NgIcon,
    HlmButton,
    PageHeader,
    LoadingSkeleton,
    EmptyState,
    ErrorState,
    ConnectionStatus,
    StatusChip,
    EventCard,
    GameTimer,
    StatTiles,
    NotificationRow,
    NewsCard,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <zeus-page-header eyebrow="Home" [title]="title()" i18n-eyebrow>
        <a hlmBtn variant="outline" routerLink="/events/join" class="h-11">
          <ng-icon name="lucideHash" size="16" aria-hidden="true" /> <ng-container i18n>Join with code</ng-container>
        </a>
      </zeus-page-header>

      @if (loading()) {
        <div class="grid gap-4 lg:grid-cols-3">
          <div class="flex flex-col gap-4 lg:col-span-2">
            <div class="panel h-44 animate-pulse bg-muted" aria-hidden="true"></div>
            <zeus-loading-skeleton [rows]="3" />
          </div>
          <zeus-loading-skeleton [rows]="4" />
        </div>
      } @else if (!data()) {
        <zeus-error-state [error]="error()" (retry)="load()" />
      } @else {
        @let d = data()!;
        @if (error()) {
          <div class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted p-3 text-sm" role="status">
            <span class="flex items-center gap-2"><zeus-connection-status /> <span class="text-muted-foreground" i18n>Showing the last loaded data.</span></span>
            <button hlmBtn variant="ghost" size="sm" type="button" class="tap" (click)="load()" i18n>Retry</button>
          </div>
        }

        <div class="grid gap-6 lg:grid-cols-3">
          <div class="flex min-w-0 flex-col gap-6 lg:col-span-2">
            <!-- Active event -->
            @if (d.activeEvent; as e) {
              <section class="panel overflow-hidden border-primary/50!" aria-labelledby="home-active">
                <div class="flex flex-col gap-3 p-4 sm:p-5">
                  <div class="flex flex-wrap items-center gap-2">
                    <zeus-status-chip [spec]="chip(e)" />
                    <span class="label-caps" i18n>Your active event</span>
                    @if (e.isGm) {
                      <span class="rounded-sm bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary" i18n>Game Master</span>
                    }
                  </div>
                  <h2 id="home-active" class="text-2xl uppercase sm:text-3xl">{{ e.name }}</h2>
                  <p class="text-sm text-muted-foreground">
                    {{ modeLabel(e) }} · <span class="num">{{ time(e.startAt) }}–{{ time(e.endAt) }}</span>
                    @if (e.meetingAddress) {
                      · {{ e.meetingAddress }}
                    }
                  </p>
                  @if (isRunning(e) && activeDetail(); as det) {
                    <zeus-game-timer [clock]="det.clock" [serverOffsetMs]="serverOffset()" size="lg" />
                  } @else if (!isRunning(e)) {
                    <zeus-game-timer [startAt]="e.startAt" size="md" />
                  }
                  <div class="mt-1 flex flex-col gap-2 sm:flex-row">
                    @if (isRunning(e)) {
                      <a hlmBtn [routerLink]="['/events', e.id, 'live']" class="h-12 text-base sm:min-w-48">
                        <ng-icon name="lucideMap" size="18" aria-hidden="true" /> <ng-container i18n>Open live map</ng-container>
                      </a>
                      @if (e.isGm) {
                        <a hlmBtn variant="outline" [routerLink]="['/gm/events', e.id, 'control']" class="h-12">
                          <ng-icon name="lucideShield" size="18" aria-hidden="true" /> <ng-container i18n>Enter as Game Master</ng-container>
                        </a>
                      }
                    } @else {
                      <a hlmBtn [routerLink]="['/events', e.id, 'lobby']" class="h-12 text-base sm:min-w-48">
                        <ng-icon name="lucideTent" size="18" aria-hidden="true" /> <ng-container i18n>Open lobby</ng-container>
                      </a>
                      <a hlmBtn variant="outline" [routerLink]="['/events', e.id]" class="h-12" i18n>Event details</a>
                    }
                  </div>
                </div>
              </section>
            }

            <!-- Next event -->
            @if (nextEvent(); as e) {
              <section aria-labelledby="home-next">
                <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="home-next" class="label-caps" i18n>Next event · {{ date(e.startAt) }}</h2>
                  @if (nextCountdown(); as c) {
                    @if (c.timer) {
                      <zeus-game-timer [startAt]="e.startAt" size="sm" />
                    } @else {
                      <span class="label-caps" i18n>Starts <span class="num">{{ c.text }}</span></span>
                    }
                  }
                </div>
                <zeus-event-card [event]="e" />
              </section>
            }

            @if (!d.activeEvent && !nextEvent()) {
              <zeus-empty-state icon="lucideCalendarDays" title="No upcoming events"
                message="Find a public game near you, or enter the code a Game Master gave you." i18n-title i18n-message>
                <a hlmBtn routerLink="/events/discover" class="h-11"><ng-icon name="lucideSearch" size="16" aria-hidden="true" /> <ng-container i18n>Discover events</ng-container></a>
                <a hlmBtn variant="outline" routerLink="/events/join" class="h-11" i18n>Join with code</a>
              </zeus-empty-state>
            }

            <!-- Invitations -->
            @if (d.invitations.length) {
              <section aria-labelledby="home-inv">
                <h2 id="home-inv" class="label-caps mb-2" i18n>Invitations · <span class="num">{{ d.invitations.length }}</span></h2>
                <ul class="flex flex-col gap-3">
                  @for (inv of d.invitations; track inv.id) {
                    <li class="flex flex-col gap-2">
                      <zeus-event-card [event]="inv" />
                      <div class="flex gap-2">
                        <button hlmBtn type="button" class="h-11 flex-1 sm:flex-none" [disabled]="busyId() === inv.id" (click)="respond(inv, true)">
                          <ng-icon name="lucideCheck" size="16" aria-hidden="true" /> <ng-container i18n>Accept</ng-container>
                        </button>
                        <button hlmBtn type="button" variant="outline" class="h-11 flex-1 sm:flex-none" [disabled]="busyId() === inv.id" (click)="respond(inv, false)">
                          <ng-icon name="lucideX" size="16" aria-hidden="true" /> <ng-container i18n>Decline</ng-container>
                        </button>
                      </div>
                    </li>
                  }
                </ul>
              </section>
            }

            <!-- News -->
            @if (d.news.length || isAdmin()) {
              <section aria-labelledby="home-news">
                <div class="mb-2 flex items-baseline justify-between gap-2">
                  <h2 id="home-news" class="label-caps" i18n>News</h2>
                  <a [routerLink]="isAdmin() ? '/admin/news' : '/news'" class="text-sm font-semibold text-primary underline-offset-2 hover:underline">{{ isAdmin() ? txt.manageNews : txt.allNews }}</a>
                </div>
                @if (d.news.length) {
                  <ul class="flex flex-col gap-2">
                    @for (n of d.news; track n.id) {
                      <li><zeus-news-card [news]="n" /></li>
                    }
                  </ul>
                } @else {
                  <p class="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground" i18n>
                    No news published. <a routerLink="/news/new/edit" class="font-semibold text-primary underline-offset-2 hover:underline">Write the first one</a>.
                  </p>
                }
              </section>
            }

            <!-- Game Master -->
            @if (d.gm; as gm) {
              <section class="flex flex-col gap-4 rounded-md border border-border p-4" aria-labelledby="home-gm">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 id="home-gm" class="text-xl uppercase" i18n>Game Master</h2>
                    <p class="text-sm text-muted-foreground" i18n>Events you run.</p>
                  </div>
                  <a hlmBtn routerLink="/gm/new" class="h-11"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> <ng-container i18n>Create event</ng-container></a>
                </div>

                @if (gm.pendingApprovals.length) {
                  <div>
                    <h3 class="label-caps mb-2" i18n>Waiting for approval · <span class="num">{{ pendingTotal() }}</span> players</h3>
                    <ul class="panel divide-y divide-border">
                      @for (p of gm.pendingApprovals; track p.eventId) {
                        <li>
                          <a [routerLink]="['/gm/events', p.eventId, 'players']" class="flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-muted/60">
                            <span class="num grid min-w-8 place-items-center rounded-sm bg-warning-surface px-1.5 py-0.5 text-sm font-bold text-warning">{{ p.count }}</span>
                            <span class="min-w-0 flex-1 truncate font-semibold">{{ p.eventName }}</span>
                            <span class="text-sm text-muted-foreground" i18n>Review</span>
                            <ng-icon name="lucideChevronRight" size="16" class="text-muted-foreground" aria-hidden="true" />
                          </a>
                        </li>
                      }
                    </ul>
                  </div>
                }

                @if (gm.live.length) {
                  <div>
                    <h3 class="label-caps mb-2" i18n>Live now · <span class="num">{{ gm.live.length }}</span></h3>
                    <div class="flex flex-col gap-2">
                      @for (e of gm.live; track e.id) {
                        <zeus-event-card [event]="e" [link]="['/gm/events', e.id, 'control']" />
                      }
                    </div>
                  </div>
                }

                @if (gm.published.length) {
                  <div>
                    <h3 class="label-caps mb-2" i18n>Published · <span class="num">{{ gm.published.length }}</span></h3>
                    <div class="flex flex-col gap-2">
                      @for (e of gm.published; track e.id) {
                        <zeus-event-card [event]="e" [link]="['/gm/events', e.id]" />
                      }
                    </div>
                  </div>
                }

                @if (gm.drafts.length) {
                  <div>
                    <h3 class="label-caps mb-2" i18n>Drafts · <span class="num">{{ gm.drafts.length }}</span></h3>
                    <div class="flex flex-col gap-2">
                      @for (e of gm.drafts; track e.id) {
                        <zeus-event-card [event]="e" [link]="['/gm/events', e.id]" />
                      }
                    </div>
                  </div>
                }

                @if (!gm.live.length && !gm.published.length && !gm.drafts.length && !gm.pendingApprovals.length) {
                  <p class="text-sm text-muted-foreground" i18n>No events yet. Create one to set up teams, the tactical map, objectives and perks.</p>
                }
              </section>
            }

            <!-- Recently played -->
            <section aria-labelledby="home-recent">
              <div class="mb-2 flex items-baseline justify-between gap-2">
                <h2 id="home-recent" class="label-caps" i18n>Recently played</h2>
                @if (d.recentEvents.length) {
                  <a routerLink="/events/mine" [queryParams]="{ tab: 'past' }" class="text-sm font-semibold text-primary underline-offset-2 hover:underline" i18n>All past events</a>
                }
              </div>
              @if (d.recentEvents.length) {
                <div class="flex flex-col gap-2">
                  @for (e of d.recentEvents; track e.id) {
                    <zeus-event-card [event]="e" [link]="['/events', e.id, 'results']" />
                  }
                </div>
              } @else {
                <p class="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground" i18n>Games you finish show up here with their results.</p>
              }
            </section>

            @if (!d.gm) {
              <section class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-border p-4" aria-labelledby="home-gm-cta">
                <div>
                  <h2 id="home-gm-cta" class="font-semibold" i18n>Run your own event</h2>
                  <p class="text-sm text-muted-foreground" i18n>Create an event, draw the map and run it live as Game Master.</p>
                </div>
                <a hlmBtn variant="outline" routerLink="/gm/new" class="h-11"><ng-icon name="lucidePlus" size="16" aria-hidden="true" /> <ng-container i18n>Create event</ng-container></a>
              </section>
            }
          </div>

          <!-- Side column -->
          <div class="flex min-w-0 flex-col gap-6">
            <section aria-labelledby="home-stats">
              <div class="mb-2 flex items-baseline justify-between gap-2">
                <h2 id="home-stats" class="label-caps" i18n>Your stats</h2>
                <a routerLink="/profile/stats" class="text-sm font-semibold text-primary underline-offset-2 hover:underline" i18n>Details</a>
              </div>
              <zeus-stat-tiles [stats]="d.stats" />
            </section>

            <section aria-labelledby="home-notif">
              <div class="mb-2 flex items-baseline justify-between gap-2">
                <h2 id="home-notif" class="label-caps"><ng-container i18n>Event updates</ng-container>
                  @if (d.unreadNotifications) {
                    · <ng-container i18n><span class="num">{{ d.unreadNotifications }}</span> unread</ng-container>
                  }
                </h2>
                <a routerLink="/notifications" class="text-sm font-semibold text-primary underline-offset-2 hover:underline" i18n>See all</a>
              </div>
              @if (d.latestNotifications.length) {
                <ul class="panel divide-y divide-border overflow-hidden">
                  @for (n of d.latestNotifications.slice(0, 4); track n.id) {
                    <li><zeus-notification-row [notification]="n" [now]="now()" (open)="openNotification($event)" /></li>
                  }
                </ul>
              } @else {
                <p class="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground" i18n>New events, invitations and games starting show up here.</p>
              }
            </section>
          </div>
        </div>
      }
    </div>
  `,
})
export class HomeScreen implements OnInit {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    manageNews: $localize`Manage news`,
    allNews: $localize`All news`,
  };

  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly center = inject(NotificationCenter);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly data = signal<HomeDashboard | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<unknown>(null);
  protected readonly busyId = signal<string | null>(null);
  protected readonly activeDetail = signal<EventDetail | null>(null);
  protected readonly serverOffset = signal(0);
  protected readonly now = nowSignal(30_000);

  protected readonly title = computed(() => this.auth.user()?.nickname ?? $localize`Home`);
  protected readonly isAdmin = computed(() => !!this.auth.user()?.isAdmin);
  protected readonly nextEvent = computed(() => {
    const d = this.data();
    if (!d?.nextEvent || d.nextEvent.id === d.activeEvent?.id) return null;
    return d.nextEvent;
  });
  protected readonly nextCountdown = computed(() => {
    const e = this.nextEvent();
    if (!e) return null;
    const ms = new Date(e.startAt).getTime() - this.now();
    if (ms <= 0) return { timer: false, text: $localize`now` };
    if (ms < 24 * 3_600_000) return { timer: true, text: '' };
    const days = Math.round(ms / 86_400_000);
    return { timer: false, text: days <= 1 ? $localize`tomorrow` : $localize`in ${days}:days: days` };
  });
  protected readonly pendingTotal = computed(() => this.data()?.gm?.pendingApprovals.reduce((s, p) => s + p.count, 0) ?? 0);

  protected readonly chip = (e: EventSummary) => eventStatusChip(e.status);
  protected readonly date = formatDate;
  protected readonly time = formatTime;
  protected modeLabel(e: EventSummary): string {
    return e.customModeName || GAME_MODE_LABELS[e.gameMode];
  }
  protected isRunning(e: EventSummary): boolean {
    return e.status === 'live' || e.status === 'paused';
  }

  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.refreshTimer && clearTimeout(this.refreshTimer));
    // A new notification usually means something on this dashboard changed: refresh quietly.
    effect(() => {
      const n = this.center.latest();
      if (!n) return;
      untracked(() => {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => void this.load(true), 800);
      });
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(quiet = false): Promise<void> {
    if (!quiet) this.loading.set(!this.data());
    try {
      const d = await this.api.home();
      this.data.set(d);
      this.error.set(null);
      void this.loadActiveClock(d.activeEvent);
    } catch (e) {
      if (!quiet || !this.data()) this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }

  /** EventSummary has no clock; fetch the detail for the timer when the game is running. */
  private async loadActiveClock(e: EventSummary | null): Promise<void> {
    if (!e || !this.isRunning(e)) {
      this.activeDetail.set(null);
      return;
    }
    try {
      const det = await this.api.event(e.id);
      this.serverOffset.set(new Date(det.clock.serverNow).getTime() - Date.now());
      this.activeDetail.set(det);
    } catch {
      this.activeDetail.set(null);
    }
  }

  protected async respond(e: EventSummary, accept: boolean): Promise<void> {
    if (!accept) {
      const ok = await this.confirm.ask({
        title: $localize`Decline invitation to ${e.name}:name:?`,
        consequences: [$localize`The Game Master is told that you declined.`, $localize`To play later you need a new invitation or the event join code.`],
        confirmLabel: $localize`Decline invitation`,
        destructive: true,
      });
      if (!ok) return;
    }
    this.busyId.set(e.id);
    try {
      const res = await this.api.respondToInvitation(e.id, accept);
      if (!accept) this.toast.info($localize`Invitation declined`);
      else if (res.status === 'pending') this.toast.success($localize`Request sent`, $localize`The Game Master needs to approve your registration.`);
      else this.toast.success($localize`You joined ${e.name}:name:`);
      await this.load(true);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busyId.set(null);
    }
  }

  protected async openNotification(n: AppNotification): Promise<void> {
    if (!n.read) {
      this.data.update((d) =>
        d
          ? {
              ...d,
              unreadNotifications: Math.max(0, d.unreadNotifications - 1),
              latestNotifications: d.latestNotifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
            }
          : d,
      );
      this.center.unread.update((c) => Math.max(0, c - 1));
      void this.api.markNotificationsRead([n.id]).catch(() => undefined);
    }
    await this.router.navigateByUrl(notificationLink(n) ?? '/notifications');
  }
}
