import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { filter } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { EventDetail, EventStatus, Objective } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { GAME_MODE_LABELS, formatDate, formatNumber, formatTime, initials } from '../../core/util/format';
import { ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { StatusChip, eventStatusChip } from '../../shared/status-chip';
import { AttachmentManager } from './common/attachment-manager';
import { SaveState, SaveStateIndicator, SegmentOption, SegmentedControl, SwitchRow } from './common/controls';
import { BASICS_FIELD_MAP, EventBasicsFormComponent, basicsToInput, createBasicsForm, patchBasicsForm } from './common/event-basics-form';
import { applyServerErrors, copyText, focusFirstInvalid, staticFormTick } from './common/form-utils';
import { injectLifecycle, lifecycleActions } from './common/lifecycle';
import { RulesOfPlayComponent, createRulesForm, patchRulesForm, rulesToInput } from './common/rules-form';

type Section = 'basics' | 'registration' | 'rules';

interface NavCard {
  title: string;
  detail: string;
  icon: string;
  link: unknown[];
  query?: Record<string, string>;
  tone?: 'warning' | 'primary';
}

@Component({
  selector: 'zeus-event-editor-screen',
  imports: [
    ReactiveFormsModule,
    NgTemplateOutlet,
    RouterLink,
    NgIcon,
    HlmButton,
    HlmInput,
    HlmLabel,
    HlmTabsImports,
    PageHeader,
    LoadingSkeleton,
    ErrorState,
    StatusChip,
    SaveStateIndicator,
    SegmentedControl,
    SwitchRow,
    EventBasicsFormComponent,
    RulesOfPlayComponent,
    AttachmentManager,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" #root>
      @if (loading() && !event()) {
        <zeus-page-header title="Event editor" back="/events/mine" backLabel="My events" i18n-title i18n-backLabel />
        <zeus-loading-skeleton [rows]="6" />
      } @else if (loadError(); as err) {
        <zeus-page-header title="Event editor" back="/events/mine" backLabel="My events" i18n-title i18n-backLabel />
        <zeus-error-state [error]="err" (retry)="load()" />
      } @else if (event(); as e) {
        <zeus-page-header [title]="e.name" eyebrow="Event editor" back="/events/mine" backLabel="My events" [subtitle]="subtitle()" i18n-eyebrow i18n-backLabel>
          <zeus-status-chip [spec]="chip()" />
        </zeus-page-header>

        <!-- Lifecycle -->
        <section class="mb-4 flex flex-wrap items-center gap-2" aria-label="Event status actions" i18n-aria-label>
          @if (running() || e.status === 'lobby') {
            <a hlmBtn class="h-11" [routerLink]="['/gm/events', e.id, 'control']">
              <ng-icon name="lucideLayoutDashboard" size="16" aria-hidden="true" /> <ng-container i18n>Control center</ng-container>
            </a>
          }
          @for (a of actions(); track a.to) {
            <button
              hlmBtn
              class="h-11"
              [variant]="a.variant === 'default' && (running() || e.status === 'lobby') ? 'outline' : a.variant"
              type="button"
              [disabled]="statusBusy()"
              (click)="changeStatus(a.to)"
            >
              <ng-icon [name]="a.icon" size="16" aria-hidden="true" /> {{ a.label }}
            </button>
          }
          @if (e.status === 'draft') {
            <a hlmBtn variant="ghost" class="h-11" routerLink="/gm/new" [queryParams]="{ eventId: e.id, step: 6 }">
              <ng-icon name="lucideListChecks" size="16" aria-hidden="true" /> <ng-container i18n>Setup checklist</ng-container>
            </a>
          }
        </section>

        @if (running()) {
          <div class="mb-4 flex gap-2 rounded-sm border border-warning/50 bg-warning-surface p-3 text-sm text-warning" role="alert">
            <ng-icon name="lucideTriangleAlert" size="18" class="shrink-0" aria-hidden="true" />
            <p i18n><strong>{e.status, select, paused {The game is paused.} other {The game is live.}}</strong> Changes you save here apply immediately to the running game.</p>
          </div>
        } @else if (e.status === 'completed' || e.status === 'cancelled') {
          <div class="mb-4 flex gap-2 rounded-sm border border-border bg-muted p-3 text-sm text-muted-foreground" role="status">
            <ng-icon name="lucideInfo" size="18" class="shrink-0" aria-hidden="true" />
            <p i18n>{e.status, select, completed {This event has ended. Settings are kept for the record and the results.} other {This event was cancelled. Settings are kept for the record.}}</p>
          </div>
        }

        <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <!-- Settings tabs -->
          <div hlmTabs [tab]="tab()" (tabActivated)="tab.set($any($event))" class="min-w-0">
            <div class="-mx-1 overflow-x-auto px-1 pb-1">
              <div hlmTabsList class="h-11 w-full min-w-max" aria-label="Event settings" i18n-aria-label>
                <button hlmTabsTrigger="basics" class="h-full px-3"><ng-container i18n>Basics</ng-container> @if (dirtyMark('basics')) { <span aria-label="unsaved" class="text-warning" i18n-aria-label>◐</span> }</button>
                <button hlmTabsTrigger="registration" class="h-full px-3"><ng-container i18n>Registration</ng-container> @if (dirtyMark('registration')) { <span aria-label="unsaved" class="text-warning" i18n-aria-label>◐</span> }</button>
                <button hlmTabsTrigger="rules" class="h-full px-3"><ng-container i18n>Rules of play</ng-container> @if (dirtyMark('rules')) { <span aria-label="unsaved" class="text-warning" i18n-aria-label>◐</span> }</button>
                <button hlmTabsTrigger="attachments" class="h-full px-3"><ng-container i18n>Attachments</ng-container> @if (e.attachmentCount) { <span class="num text-muted-foreground">{{ e.attachmentCount }}</span> }</button>
                <button hlmTabsTrigger="gms" class="h-full px-3" i18n>Game Masters</button>
              </div>
            </div>

            <div hlmTabsContent="basics" class="pt-3">
              <zeus-event-basics-form [form]="basicsForm" [showRegistration]="false" />
              <ng-container *ngTemplateOutlet="saveBar; context: { section: 'basics' }" />
            </div>

            <div hlmTabsContent="registration" class="pt-3">
              <form [formGroup]="regForm" class="flex flex-col gap-4" (ngSubmit)="save('registration')" [attr.data-rev]="regTick()">
                <fieldset class="panel flex flex-col gap-3 p-4">
                  <legend class="label-caps float-left mb-1 w-full" i18n>Who can join</legend>
                  <span hlmLabel id="reg-vis-l" i18n>Visibility</span>
                  <zeus-segmented formControlName="visibility" [options]="visibilityOptions" labelledby="reg-vis-l" stacked />
                  <div class="divide-y divide-border">
                    <zeus-switch-row formControlName="requiresApproval" label="Approve players manually" description="Each registration waits for your approval in Players." i18n-label i18n-description />
                    <zeus-switch-row formControlName="registrationLocked" label="Lock registration" description="No new registrations, even while registration is open. Invitations still work." i18n-label i18n-description />
                    <zeus-switch-row formControlName="autoEnd" label="End the game automatically" description="The game ends by itself at the expected end time. Off: you end it from the control center." i18n-label i18n-description />
                  </div>
                </fieldset>
                <section class="panel flex flex-col gap-2 p-4" aria-labelledby="jc-h">
                  <h3 id="jc-h" class="label-caps" i18n>Join code</h3>
                  @if (e.joinCode) {
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="num text-3xl font-bold tracking-[0.2em]" aria-label="Join code" i18n-aria-label>{{ e.joinCode }}</span>
                      <button hlmBtn variant="outline" class="h-11" type="button" (click)="copyCode(e.joinCode)">
                        <ng-icon name="lucideCopy" size="16" aria-hidden="true" /> <ng-container i18n>Copy</ng-container>
                      </button>
                      <button hlmBtn variant="ghost" class="h-11" type="button" (click)="regenerateCode()" [disabled]="codeBusy()">
                        <ng-icon name="lucideRefreshCw" size="16" aria-hidden="true" /> {{ codeBusy() ? txt.regenerating : txt.regenerate }}
                      </button>
                    </div>
                    <p class="text-xs text-muted-foreground" i18n>
                      Players enter it under Join event{{ e.visibility === 'public' ? txt.theEventIsPublic : txt.privateEventsCanOnly }}
                    </p>
                  } @else {
                    <p class="text-sm text-muted-foreground" i18n>A join code is generated when the event is private. Switch to Private and save.</p>
                  }
                </section>
                <ng-container *ngTemplateOutlet="saveBar; context: { section: 'registration' }" />
              </form>
            </div>

            <div hlmTabsContent="rules" class="pt-3">
              <zeus-rules-of-play [form]="rulesForm" [eventId]="e.id" [perkCount]="perkCount()" (perksAdded)="loadSide()" />
              <ng-container *ngTemplateOutlet="saveBar; context: { section: 'rules' }" />
            </div>

            <div hlmTabsContent="attachments" class="pt-3">
              <zeus-attachment-manager [eventId]="e.id" [attachments]="e.attachments" [readonly]="e.status === 'completed' || e.status === 'cancelled'" (changed)="refresh()" />
            </div>

            <div hlmTabsContent="gms" class="pt-3">
              <section class="panel flex flex-col gap-3 p-4" aria-labelledby="gm-h">
                <h3 id="gm-h" class="label-caps" i18n>Game Masters · {{ e.gameMasters.length }}</h3>
                <p class="text-sm text-muted-foreground" i18n>Co-GMs can edit everything here and run the control center. Game Masters cannot play in the event.</p>
                <ul class="divide-y divide-border">
                  @for (g of e.gameMasters; track g.id) {
                    <li class="flex items-center gap-3 py-2">
                      @if (g.avatarUrl) {
                        <img [src]="g.avatarUrl" alt="" class="size-10 rounded-full object-cover" />
                      } @else {
                        <span class="grid size-10 place-items-center rounded-full bg-muted text-sm font-bold" aria-hidden="true">{{ initialsOf(g.nickname) }}</span>
                      }
                      <span class="min-w-0 flex-1 truncate font-semibold">
                        {{ g.nickname }}
                        @if (g.id === meId()) {
                          <span class="text-xs font-normal text-muted-foreground" i18n>(you)</span>
                        }
                      </span>
                      @if (e.gameMasters.length > 1) {
                        <button hlmBtn variant="ghost" size="sm" class="h-11 text-destructive" type="button" (click)="removeGm(g)" aria-label="Remove {{ g.nickname }} as Game Master" i18n-aria-label>
                          <ng-icon name="lucideUserMinus" size="16" aria-hidden="true" /> <ng-container i18n>Remove</ng-container>
                        </button>
                      }
                    </li>
                  }
                </ul>
                <form [formGroup]="gmForm" (ngSubmit)="addGm()" class="flex flex-col gap-1.5 border-t border-border pt-3" [attr.data-rev]="gmTick()">
                  <label hlmLabel for="gm-nick" i18n>Add a co-Game Master by nickname</label>
                  <div class="flex gap-2">
                    <input hlmInput id="gm-nick" class="h-11 flex-1" formControlName="nickname" autocomplete="off" placeholder="nickname" [attr.aria-invalid]="!!gmError()" aria-describedby="gm-nick-e" i18n-placeholder />
                    <button hlmBtn class="h-11" type="submit" [disabled]="gmBusy()">
                      <ng-icon name="lucideUserPlus" size="16" aria-hidden="true" /> {{ gmBusy() ? txt.adding : txt.add }}
                    </button>
                  </div>
                  @if (gmError(); as m) {
                    <p id="gm-nick-e" class="field-error">{{ m }}</p>
                  }
                </form>
              </section>
            </div>
          </div>

          <!-- Navigation -->
          <aside class="flex flex-col gap-4" aria-label="Event sections" i18n-aria-label>
            <nav class="grid gap-2 sm:grid-cols-2 lg:grid-cols-1" aria-label="Manage" i18n-aria-label>
              @for (c of navCards(); track c.title) {
                <a [routerLink]="c.link" [queryParams]="c.query ?? null" class="panel flex min-h-14 items-center gap-3 p-3 hover:border-primary/60">
                  <ng-icon [name]="c.icon" size="20" class="shrink-0" [class.text-warning]="c.tone === 'warning'" [class.text-primary]="c.tone !== 'warning'" aria-hidden="true" />
                  <span class="min-w-0 flex-1">
                    <span class="block text-sm font-bold uppercase">{{ c.title }}</span>
                    <span class="block truncate text-xs" [class.text-warning]="c.tone === 'warning'" [class.text-muted-foreground]="c.tone !== 'warning'">{{ c.detail }}</span>
                  </span>
                  <ng-icon name="lucideChevronRight" size="16" class="text-muted-foreground" aria-hidden="true" />
                </a>
              }
            </nav>

            <section class="panel flex flex-col gap-2 p-3" aria-labelledby="obj-h">
              <div class="flex items-center justify-between gap-2">
                <h2 id="obj-h" class="label-caps" i18n>Objectives · {{ objectives()?.length ?? '…' }}</h2>
                <a hlmBtn variant="ghost" size="sm" class="h-11" [routerLink]="['/gm/events', e.id, 'objectives', 'new']">
                  <ng-icon name="lucidePlus" size="14" aria-hidden="true" /> <ng-container i18n>New</ng-container>
                </a>
              </div>
              @if (sideError(); as err) {
                <zeus-error-state [error]="err" (retry)="loadSide()" />
              } @else if (objectives() === null) {
                <zeus-loading-skeleton [rows]="2" />
              } @else {
                <ul class="flex flex-col">
                  @for (o of objectives(); track o.id) {
                    <li>
                      <a [routerLink]="['/gm/events', e.id, 'objectives', o.id]" class="flex min-h-11 items-center gap-2 rounded-sm px-1 text-sm hover:bg-muted">
                        <span class="size-2.5 shrink-0 rounded-full" [style.background]="o.color" aria-hidden="true"></span>
                        <span class="min-w-0 flex-1 truncate">{{ o.name }}</span>
                        <span class="num text-xs text-muted-foreground">+{{ fmt(o.rewards.points) }}</span>
                      </a>
                    </li>
                  } @empty {
                    <li><p class="text-sm text-muted-foreground" i18n>No objectives yet.</p></li>
                  }
                </ul>
              }
            </section>

            <section class="panel flex flex-col gap-2 p-3" aria-labelledby="more-h">
              <h2 id="more-h" class="label-caps" i18n>More actions</h2>
              <button hlmBtn variant="outline" class="h-11 justify-start" type="button" (click)="duplicate()" [disabled]="moreBusy()">
                <ng-icon name="lucideCopy" size="16" aria-hidden="true" /> <ng-container i18n>Duplicate event</ng-container>
              </button>
              <button hlmBtn variant="outline" class="h-11 justify-start" type="button" (click)="saveTemplate()" [disabled]="moreBusy()">
                <ng-icon name="lucideSave" size="16" aria-hidden="true" /> <ng-container i18n>Save as template</ng-container>
              </button>
              @if (e.status === 'draft' || e.status === 'cancelled') {
                <button hlmBtn variant="destructive" class="h-11 justify-start" type="button" (click)="deleteDraft()" [disabled]="moreBusy()">
                  <ng-icon name="lucideTrash2" size="16" aria-hidden="true" /> {{ e.status === 'draft' ? txt.deleteDraft : txt.deleteEvent }}
                </button>
              }
            </section>
          </aside>
        </div>
      }
    </div>

    <ng-template #saveBar let-section="section">
      <div class="sticky bottom-[calc(4rem+var(--safe-bottom))] z-10 mt-4 flex items-center justify-end gap-3 border-t border-border bg-background/95 py-3 backdrop-blur lg:bottom-0">
        <zeus-save-state [state]="sectionState(section)" [error]="errorOf(section)" />
        <button hlmBtn class="h-11 min-w-28" type="button" (click)="save(section)" [disabled]="sectionState(section) === 'saving'">
          {{ sectionState(section) === 'saving' ? txt.saving : txt.save }}
        </button>
      </div>
    </ng-template>
  `,
})
export class EventEditorScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    regenerating: $localize`Regenerating…`,
    regenerate: $localize`Regenerate`,
    theEventIsPublic: $localize`. The event is public, so the code is optional.`,
    privateEventsCanOnly: $localize`. Private events can only be joined with it or by invitation.`,
    adding: $localize`Adding…`,
    add: $localize`Add`,
    deleteDraft: $localize`Delete draft`,
    deleteEvent: $localize`Delete event`,
    saving: $localize`Saving…`,
    save: $localize`Save`,
  };

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly realtime = inject(RealtimeService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly lifecycle = injectLifecycle();

  readonly eventId = input.required<string>();

  private readonly root = viewChild<ElementRef<HTMLElement>>('root');

  protected readonly event = signal<EventDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<unknown>(null);
  protected readonly objectives = signal<Objective[] | null>(null);
  protected readonly perkCount = signal<number | null>(null);
  protected readonly sideError = signal<unknown>(null);
  protected readonly tab = signal('basics');
  protected readonly statusBusy = signal(false);
  protected readonly codeBusy = signal(false);
  protected readonly gmBusy = signal(false);
  protected readonly gmError = signal<string | null>(null);
  protected readonly moreBusy = signal(false);
  protected readonly states = signal<Record<Section, SaveState>>({ basics: 'idle', registration: 'idle', rules: 'idle' });
  protected readonly saveErrors = signal<Partial<Record<Section, string>>>({});

  protected readonly basicsForm = createBasicsForm();
  protected readonly rulesForm = createRulesForm();
  protected readonly regForm = new FormGroup({
    visibility: new FormControl<'public' | 'private'>('public', { nonNullable: true }),
    requiresApproval: new FormControl(false, { nonNullable: true }),
    registrationLocked: new FormControl(false, { nonNullable: true }),
    autoEnd: new FormControl(true, { nonNullable: true }),
  });
  protected readonly gmForm = new FormGroup({
    nickname: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(40)] }),
  });
  private readonly basicsTick = staticFormTick(this.basicsForm);
  private readonly rulesTick = staticFormTick(this.rulesForm);
  protected readonly regTick = staticFormTick(this.regForm);
  protected readonly gmTick = staticFormTick(this.gmForm);

  protected readonly visibilityOptions: SegmentOption<'public' | 'private'>[] = [
    { value: 'public', label: $localize`Public`, hint: $localize`Listed in Discover; anyone can register.` },
    { value: 'private', label: $localize`Private`, hint: $localize`Hidden from Discover; players need the join code or an invitation.` },
  ];

  protected readonly meId = computed(() => this.auth.user()?.id ?? null);
  protected readonly running = computed(() => {
    const s = this.event()?.status;
    return s === 'live' || s === 'paused';
  });
  protected readonly chip = computed(() => eventStatusChip(this.event()?.status ?? 'draft'));
  protected readonly actions = computed(() => lifecycleActions(this.event()?.status ?? 'draft'));
  protected readonly subtitle = computed(() => {
    const e = this.event();
    if (!e) return null;
    return `${e.customModeName || GAME_MODE_LABELS[e.gameMode]} · ${formatDate(e.startAt)} ${formatTime(e.startAt)}–${formatTime(e.endAt)}`;
  });

  protected readonly navCards = computed<NavCard[]>(() => {
    const e = this.event();
    if (!e) return [];
    const base = ['/gm/events', e.id];
    const cards: NavCard[] = [
      {
        title: $localize`Teams & squads`,
        detail: e.teams.length < 2 ? $localize`${e.teams.length}:length: teams · at least 2 needed` : $localize`${e.teams.length}:length: teams · ${e.squads.length}:length2: squads`,
        icon: 'lucideUsers',
        link: [...base, 'teams'],
        tone: e.teams.length < 2 ? 'warning' : 'primary',
      },
      { title: $localize`Tactical map`, detail: $localize`Zones, points of interest, objectives`, icon: 'lucideMap', link: [...base, 'map'] },
      {
        title: $localize`Players`,
        detail: e.pendingCount ? $localize`${e.approvedCount}:approved: approved · ${e.pendingCount}:pending: waiting for approval` : $localize`${e.approvedCount}:approved: approved`,
        icon: 'lucideUserCheck',
        link: [...base, 'players'],
        tone: e.pendingCount ? 'warning' : 'primary',
      },
      {
        title: $localize`Perk store`,
        detail: (e.storeEnabled ? $localize`:perk store|:Open` : $localize`:perk store|:Closed`) + (this.perkCount() !== null ? $localize` · ${this.perkCount()}:count: perks` : ''),
        icon: 'lucideStore',
        link: [...base, 'perks'],
      },
      { title: $localize`Scores`, detail: $localize`Points, credits, adjustments`, icon: 'lucideTrophy', link: [...base, 'scores'] },
      { title: $localize`Activity log`, detail: $localize`Everything that happened, with who did it`, icon: 'lucideHistory', link: [...base, 'activity'] },
    ];
    if (e.status === 'completed') cards.push({ title: $localize`Results`, detail: $localize`Leaderboard, statistics, export`, icon: 'lucideChartColumn', link: ['/events', e.id, 'results'] });
    return cards;
  });

  constructor() {
    effect(() => {
      const id = this.eventId();
      untracked(() => {
        this.event.set(null);
        void this.load();
        void this.realtime.subscribe(id, this.destroyRef);
      });
    });
    this.realtime
      .on('invalidate')
      .pipe(
        filter((p) => p.eventId === this.eventId()),
        takeUntilDestroyed(),
      )
      .subscribe((p) => {
        if (p.scopes.includes('event')) void this.refresh();
        if (p.scopes.includes('objectives') || p.scopes.includes('perks')) void this.loadSide();
      });
    this.realtime
      .on('clock')
      .pipe(
        filter((p) => p.eventId === this.eventId()),
        takeUntilDestroyed(),
      )
      .subscribe(() => void this.refresh());
  }

  // --- data -------------------------------------------------------------------------

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const e = await this.api.event(this.eventId());
      this.applyEvent(e, true);
      void this.loadSide();
    } catch (err) {
      this.loadError.set(err);
    } finally {
      this.loading.set(false);
    }
  }

  protected async refresh(): Promise<void> {
    try {
      this.applyEvent(await this.api.event(this.eventId()), false);
    } catch {
      /* keep what we have; the next action will surface errors */
    }
  }

  async loadSide(): Promise<void> {
    this.sideError.set(null);
    try {
      const [objectives, perks] = await Promise.all([this.api.objectives(this.eventId()), this.api.perks(this.eventId())]);
      this.objectives.set([...objectives].sort((a, b) => a.sortOrder - b.sortOrder));
      this.perkCount.set(perks.length);
    } catch (err) {
      this.sideError.set(err);
    }
  }

  /** Update the event; forms are only overwritten when they have no unsaved edits (or `force`). */
  private applyEvent(e: EventDetail, force: boolean): void {
    this.event.set(e);
    if (force || !this.basicsForm.dirty) patchBasicsForm(this.basicsForm, e);
    if (force || !this.rulesForm.dirty) patchRulesForm(this.rulesForm, e);
    if (force || !this.regForm.dirty) {
      this.regForm.reset({ visibility: e.visibility, requiresApproval: e.requiresApproval, registrationLocked: e.registrationLocked, autoEnd: e.autoEnd });
    }
  }

  // --- save state ---------------------------------------------------------------------

  private formFor(section: Section) {
    return section === 'basics' ? this.basicsForm : section === 'rules' ? this.rulesForm : this.regForm;
  }

  protected sectionState(section: Section): SaveState {
    this.basicsTick();
    this.rulesTick();
    this.regTick();
    const s = this.states()[section];
    if (s === 'saving' || s === 'failed') return s;
    return this.formFor(section).dirty ? 'unsaved' : s;
  }

  protected errorOf(section: Section): string | null {
    return this.saveErrors()[section] ?? null;
  }

  protected dirtyMark(section: Section): boolean {
    return this.sectionState(section) === 'unsaved' || this.sectionState(section) === 'failed';
  }

  private setState(section: Section, state: SaveState, error?: string): void {
    this.states.update((s) => ({ ...s, [section]: state }));
    this.saveErrors.update((s) => ({ ...s, [section]: error }));
  }

  protected async save(section: Section): Promise<void> {
    const e = this.event();
    if (!e) return;
    const form = this.formFor(section);
    if (form.invalid) {
      form.markAllAsTouched();
      this.setState(section, 'failed', $localize`Fix the highlighted fields.`);
      focusFirstInvalid(this.root()?.nativeElement);
      return;
    }
    this.setState(section, 'saving');
    try {
      const body =
        section === 'basics' ? basicsToInput(this.basicsForm, { includeRegistration: false }) : section === 'rules' ? rulesToInput(this.rulesForm) : this.regForm.getRawValue();
      const updated = await this.api.updateEvent(e.id, body);
      form.markAsPristine();
      this.applyEvent(updated, false);
      // Re-sync this section from the server's merged result.
      if (section === 'basics') patchBasicsForm(this.basicsForm, updated);
      if (section === 'rules') patchRulesForm(this.rulesForm, updated);
      this.setState(section, 'saved');
      if (section === 'registration' && updated.visibility === 'private' && !e.joinCode && updated.joinCode) {
        this.toast.success($localize`Private event`, $localize`Join code ${updated.joinCode}:joinCode:`);
      }
    } catch (err) {
      const apiErr = ApiError.from(err);
      this.setState(section, 'failed', apiErr.message);
      const unplaced = applyServerErrors(form, err, section === 'basics' ? BASICS_FIELD_MAP : {});
      focusFirstInvalid(this.root()?.nativeElement);
      if (unplaced.length || !Object.keys(apiErr.fields).length) this.toast.error(err);
    }
  }

  // --- lifecycle ----------------------------------------------------------------------

  protected async changeStatus(to: EventStatus): Promise<void> {
    const e = this.event();
    if (!e) return;
    this.statusBusy.set(true);
    try {
      const updated = await this.lifecycle(e, to);
      if (updated) this.applyEvent(updated, false);
      else void this.refresh();
    } finally {
      this.statusBusy.set(false);
    }
  }

  // --- registration -------------------------------------------------------------------

  protected async copyCode(code: string): Promise<void> {
    if (await copyText(code)) this.toast.success($localize`Join code copied`);
    else this.toast.error($localize`Copy failed. Select the code and copy it manually.`);
  }

  protected async regenerateCode(): Promise<void> {
    const e = this.event();
    if (!e) return;
    const ok = await this.confirm.ask({
      title: $localize`Regenerate the join code?`,
      consequences: [$localize`The old code ${e.joinCode}:joinCode: stops working immediately.`, $localize`Players who already joined keep their place.`, $localize`Share the new code with anyone still to join.`],
      confirmLabel: $localize`Regenerate code`,
    });
    if (!ok) return;
    this.codeBusy.set(true);
    try {
      const { joinCode } = await this.api.regenerateJoinCode(e.id);
      this.event.update((cur) => (cur ? { ...cur, joinCode } : cur));
      this.toast.success($localize`New join code`, joinCode);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.codeBusy.set(false);
    }
  }

  // --- game masters -------------------------------------------------------------------

  protected readonly initialsOf = initials;
  protected readonly fmt = formatNumber;

  protected async addGm(): Promise<void> {
    const e = this.event();
    const c = this.gmForm.controls.nickname;
    this.gmError.set(null);
    if (!e) return;
    if (c.invalid) {
      c.markAsTouched();
      this.gmError.set($localize`Enter a nickname.`);
      return;
    }
    const nickname = c.value.trim();
    this.gmBusy.set(true);
    try {
      await this.api.addGameMaster(e.id, nickname);
      this.gmForm.reset();
      this.toast.success($localize`${nickname}:nickname: is now a Game Master`);
      await this.refresh();
    } catch (err) {
      const apiErr = ApiError.from(err);
      this.gmError.set(apiErr.fields['nickname'] ?? apiErr.message);
    } finally {
      this.gmBusy.set(false);
    }
  }

  protected async removeGm(g: { id: string; nickname: string }): Promise<void> {
    const e = this.event();
    if (!e) return;
    const self = g.id === this.meId();
    const ok = await this.confirm.ask({
      title: self ? $localize`Step down as Game Master?` : $localize`Remove ${g.nickname}:nickname: as Game Master?`,
      consequences: self
        ? [$localize`You lose access to this editor and the control center.`, $localize`The other Game Masters keep running the event.`]
        : [$localize`${g.nickname}:nickname: can no longer edit the event or use the control center.`, $localize`Their past actions stay in the activity log.`],
      destructive: true,
      confirmLabel: self ? $localize`Step down` : $localize`Remove`,
    });
    if (!ok) return;
    try {
      await this.api.removeGameMaster(e.id, g.id);
      this.toast.success(self ? $localize`You are no longer a Game Master of this event` : $localize`${g.nickname}:nickname: removed`);
      if (self) void this.router.navigate(['/events/mine'], { queryParams: { tab: 'gm' } });
      else await this.refresh();
    } catch (err) {
      this.toast.error(err);
    }
  }

  // --- more actions -------------------------------------------------------------------

  protected async duplicate(): Promise<void> {
    const e = this.event();
    if (!e) return;
    this.moreBusy.set(true);
    try {
      const copy = await this.api.duplicateEvent(e.id);
      this.toast.success($localize`Event duplicated`, $localize`${copy.name}:name: is a new draft.`);
      void this.router.navigate(['/gm/events', copy.id]);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.moreBusy.set(false);
    }
  }

  protected async saveTemplate(): Promise<void> {
    const e = this.event();
    if (!e) return;
    const name = await this.confirm.askReason({
      title: $localize`Save as template`,
      message: $localize`Reuse the teams, rules of play and map of this event when creating a new one.`,
      consequences: [$localize`Players, scores and dates are not included.`],
      confirmLabel: $localize`Save template`,
      reason: { label: $localize`Template name`, required: true, placeholder: $localize`${e.name}:name: setup` },
    });
    if (!name) return;
    this.moreBusy.set(true);
    try {
      const t = await this.api.saveEventTemplate(e.id, name);
      this.toast.success($localize`Template saved`, $localize`"${t.name}:name:" is available when you create an event.`);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.moreBusy.set(false);
    }
  }

  protected async deleteDraft(): Promise<void> {
    const e = this.event();
    if (!e) return;
    const ok = await this.confirm.ask({
      title: $localize`Delete ${e.name}:name:?`,
      consequences: [
        $localize`The event, its teams, map, objectives and perks are deleted.`,
        $localize`Only the event owner can do this.`,
        e.approvedCount + e.pendingCount ? $localize`${e.approvedCount + e.pendingCount}:approvedCount: registered players lose their place.` : $localize`No players have registered.`,
        $localize`This cannot be undone.`,
      ],
      destructive: true,
      requireText: $localize`:typed confirmation word|:DELETE`,
      confirmLabel: $localize`Delete event`,
    });
    if (!ok) return;
    this.moreBusy.set(true);
    try {
      await this.api.deleteEvent(e.id);
      this.toast.success($localize`Event deleted`);
      void this.router.navigate(['/events/mine'], { queryParams: { tab: 'gm' } });
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.moreBusy.set(false);
    }
  }
}
