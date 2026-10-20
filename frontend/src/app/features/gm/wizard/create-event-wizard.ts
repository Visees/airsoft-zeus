import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { ApiError } from '../../../core/api/api-error';
import { ApiService } from '../../../core/api/api.service';
import { EventDetail, EventStatus, EventTemplate, MapTemplate, Objective, Perk, Poi, Zone } from '../../../core/api/models';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { ToastService } from '../../../core/ui/toast.service';
import { GAME_MODE_LABELS, formatDate, formatNumber, formatTime } from '../../../core/util/format';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../../shared/states';
import { StatusChip, eventStatusChip } from '../../../shared/status-chip';
import { BASICS_FIELD_MAP, EventBasicsFormComponent, basicsToInput, createBasicsForm, patchBasicsForm } from '../common/event-basics-form';
import { applyServerErrors, controlError, focusFirstInvalid, staticFormTick } from '../common/form-utils';
import { injectLifecycle } from '../common/lifecycle';
import { RulesOfPlayComponent, createRulesForm, patchRulesForm, rulesToInput } from '../common/rules-form';
import { TWO_TEAM_PRESET, nextTeamPreset } from '../common/team-form';
import { TeamEditor } from '../common/team-editor';
import { TeamSelectionSettings } from '../common/team-selection';
import { describeVisibility } from '../common/visibility-matrix';

interface StepDef {
  n: number;
  label: string;
  title: string;
  intro: string;
}

const STEPS: StepDef[] = [
  { n: 1, label: 'Basics', title: 'Basic information', intro: 'Name, date, meeting point and the rules players accept before they play.' },
  { n: 2, label: 'Teams', title: 'Teams', intro: 'At least two teams. Each one gets a colour, a pattern and an icon so nobody depends on colour alone.' },
  { n: 3, label: 'Map', title: 'Tactical map', intro: 'Draw the playable area, bases, safe zones and points of interest.' },
  { n: 4, label: 'Objectives', title: 'Objectives', intro: 'What teams capture, how, and what it is worth.' },
  { n: 5, label: 'Rules of play', title: 'Rules of play', intro: 'Scoring, the perk store, who sees whom on the map, and location tracking.' },
  { n: 6, label: 'Review', title: 'Review and publish', intro: 'Check what is missing, then publish or keep it as a draft.' },
];

interface MapContent {
  zones: Zone[];
  pois: Poi[];
  objectives: Objective[];
  perks: Perk[];
}

interface CheckItem {
  ok: boolean;
  label: string;
  detail: string;
  step: number;
  severity: 'warning' | 'info';
}

function endAfterStart(g: AbstractControl): ValidationErrors | null {
  const v = g.value as { startTime: string; endTime: string };
  return v.startTime && v.endTime && v.endTime <= v.startTime ? { endBeforeStart: true } : null;
}

@Component({
  selector: 'zeus-create-event-wizard-screen',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    NgIcon,
    HlmButton,
    HlmInput,
    HlmLabel,
    PageHeader,
    LoadingSkeleton,
    ErrorState,
    EmptyState,
    StatusChip,
    EventBasicsFormComponent,
    RulesOfPlayComponent,
    TeamEditor,
    TeamSelectionSettings,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page pb-44 lg:pb-8" #root>
      <zeus-page-header
        [title]="event()?.name || 'Create event'"
        [eyebrow]="event() ? 'Event setup' : 'New event'"
        [back]="event() ? '/gm/events/' + event()!.id : '/events/mine'"
        [backLabel]="event() ? 'Event editor' : 'My events'"
      >
        @if (event(); as e) {
          <zeus-status-chip [spec]="statusChip(e.status)" />
        }
      </zeus-page-header>

      @if (currentStep() > 0) {
        <nav aria-label="Setup steps" class="mb-6">
          <p class="label-caps mb-2 sm:hidden">Step {{ currentStep() }} of {{ steps.length }} · {{ currentDef().label }}</p>
          <ol class="grid grid-cols-6 gap-1 sm:gap-2">
            @for (s of steps; track s.n) {
              @let state = stepState(s.n);
              <li>
                <button
                  type="button"
                  class="group flex w-full flex-col items-stretch gap-1.5 text-left disabled:cursor-not-allowed"
                  [disabled]="!event() || busy()"
                  [attr.aria-current]="state === 'current' ? 'step' : null"
                  [attr.aria-label]="'Step ' + s.n + ': ' + s.label + (state === 'complete' ? ', complete' : state === 'current' ? ', current step' : '')"
                  (click)="jump(s.n)"
                >
                  <span
                    class="h-1.5 rounded-full"
                    [class]="state === 'current' ? 'bg-primary' : state === 'complete' ? 'bg-primary/50' : 'bg-muted'"
                    aria-hidden="true"
                  ></span>
                  <span class="hidden items-center gap-1.5 sm:flex">
                    <span
                      class="num grid size-6 shrink-0 place-items-center rounded-full border text-xs font-bold"
                      [class]="
                        state === 'current'
                          ? 'border-primary bg-primary text-primary-foreground'
                          : state === 'complete'
                            ? 'border-primary text-primary'
                            : 'border-border text-muted-foreground'
                      "
                      aria-hidden="true"
                      >{{ state === 'complete' ? '✓' : s.n }}</span
                    >
                    <span class="truncate text-xs" [class]="state === 'current' ? 'font-bold text-foreground underline underline-offset-4' : 'text-muted-foreground group-hover:text-foreground'">{{
                      s.label
                    }}</span>
                  </span>
                </button>
              </li>
            }
          </ol>
        </nav>
      }

      @if (loading() && !event()) {
        <zeus-loading-skeleton [rows]="5" />
      } @else if (loadError(); as err) {
        <zeus-error-state [error]="err" (retry)="reload()" />
      } @else {
        <section aria-labelledby="wizard-step-title">
          <div class="mb-4">
            <h2 id="wizard-step-title" tabindex="-1" class="text-xl uppercase outline-none">{{ currentStep() === 0 ? 'How do you want to start?' : currentDef().title }}</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              {{ currentStep() === 0 ? 'Start from scratch or reuse one of your saved event templates.' : currentDef().intro }}
            </p>
          </div>

          @switch (currentStep()) {
            <!-- STEP 0 · start -->
            @case (0) {
              <div class="grid gap-4 lg:grid-cols-2">
                <button type="button" class="panel flex items-start gap-3 p-4 text-left hover:border-primary/60" (click)="goto(1)">
                  <ng-icon name="lucidePlus" size="24" class="text-primary" aria-hidden="true" />
                  <span>
                    <span class="block font-bold uppercase">Start from scratch</span>
                    <span class="mt-1 block text-sm text-muted-foreground">An empty draft with sensible defaults for tracking, visibility and scoring.</span>
                  </span>
                </button>
                <div class="panel flex flex-col gap-3 p-4">
                  <h3 class="font-bold uppercase">From a template</h3>
                  @if (templatesLoading()) {
                    <zeus-loading-skeleton [rows]="2" />
                  } @else if (templatesError(); as err) {
                    <zeus-error-state [error]="err" (retry)="loadTemplates()" />
                  } @else if (!templates().length) {
                    <p class="text-sm text-muted-foreground">No templates yet. Save an event as a template from its editor to reuse teams, rules and the map.</p>
                  } @else {
                    <ul class="flex flex-col gap-1.5" role="radiogroup" aria-label="Event templates">
                      @for (t of templates(); track t.id) {
                        <li>
                          <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 has-focus-visible:ring-2 has-focus-visible:ring-ring"
                            [class]="selectedTemplate() === t.id ? 'border-primary bg-primary/10' : 'border-border'">
                            <input type="radio" name="tpl" class="sr-only" [checked]="selectedTemplate() === t.id" (change)="selectedTemplate.set(t.id)" />
                            <span aria-hidden="true" class="num text-xs" [class.text-primary]="selectedTemplate() === t.id">{{ selectedTemplate() === t.id ? '●' : '○' }}</span>
                            <span class="min-w-0 flex-1">
                              <span class="block truncate font-semibold">{{ t.name }}</span>
                              <span class="block text-xs text-muted-foreground">{{ modeLabel(t.gameMode) }} · saved {{ date(t.createdAt) }}</span>
                            </span>
                          </label>
                        </li>
                      }
                    </ul>
                    @if (selectedTemplate()) {
                      <form [formGroup]="templateForm" (ngSubmit)="createFromTemplate()" class="flex flex-col gap-3 border-t border-border pt-3" [attr.data-rev]="templateTick()">
                        <div class="flex flex-col gap-1.5">
                          <label hlmLabel for="tf-name">New event name</label>
                          <input hlmInput id="tf-name" class="h-11" formControlName="name" [attr.aria-invalid]="!!tErr('name')" />
                          @if (tErr('name'); as e) {
                            <p class="field-error">{{ e }}</p>
                          }
                        </div>
                        <div class="grid grid-cols-3 gap-2">
                          <div class="flex flex-col gap-1.5">
                            <label hlmLabel for="tf-date">Date</label>
                            <input hlmInput id="tf-date" type="date" class="h-11" formControlName="date" />
                          </div>
                          <div class="flex flex-col gap-1.5">
                            <label hlmLabel for="tf-start">Start</label>
                            <input hlmInput id="tf-start" type="time" class="h-11" formControlName="startTime" />
                          </div>
                          <div class="flex flex-col gap-1.5">
                            <label hlmLabel for="tf-end">End</label>
                            <input hlmInput id="tf-end" type="time" class="h-11" formControlName="endTime" [attr.aria-invalid]="!!templateForm.errors?.['endBeforeStart']" />
                          </div>
                        </div>
                        @if (templateForm.errors?.['endBeforeStart']) {
                          <p class="field-error">The end time must be after the start time.</p>
                        }
                        <button hlmBtn type="submit" class="h-12" [disabled]="busy()">
                          {{ busy() ? 'Creating…' : 'Create from template' }}
                        </button>
                      </form>
                    }
                  }
                </div>
              </div>
            }

            <!-- STEP 1 · basics -->
            @case (1) {
              <zeus-event-basics-form [form]="basicsForm" [joinCode]="event()?.joinCode ?? null" />
            }

            <!-- STEP 2 · teams -->
            @case (2) {
              @if (event(); as e) {
                <div class="flex flex-col gap-4">
                  @if (sortedTeams().length < 2) {
                    <div class="flex gap-2 rounded-sm border border-warning/50 bg-warning-surface p-3 text-sm text-warning" role="status">
                      <span aria-hidden="true">◐</span>
                      <span>The game needs at least two teams to start. You can add them later, but publishing now shows this as a warning.</span>
                    </div>
                  }
                  @if (!sortedTeams().length) {
                    <zeus-empty-state icon="lucideUsers" title="No teams yet" message="Add the usual two-team setup in one click, then rename and recolour as you like.">
                      <button hlmBtn class="h-11" type="button" (click)="addTwoTeams()" [disabled]="busy()">
                        <ng-icon name="lucideSparkles" size="16" aria-hidden="true" /> Add two teams (Alpha and Bravo)
                      </button>
                      <button hlmBtn variant="outline" class="h-11" type="button" (click)="addTeam()" [disabled]="busy()">
                        <ng-icon name="lucidePlus" size="16" aria-hidden="true" /> Add one team
                      </button>
                    </zeus-empty-state>
                  } @else {
                    <div class="grid gap-4 lg:grid-cols-2">
                      @for (t of sortedTeams(); track t.id) {
                        <zeus-team-editor [eventId]="e.id" [team]="t" [allTeams]="e.teams" [squads]="e.squads" startExpanded (changed)="refreshEvent()" />
                      }
                    </div>
                    <div>
                      <button hlmBtn variant="outline" class="h-11" type="button" (click)="addTeam()" [disabled]="busy()">
                        <ng-icon name="lucidePlus" size="16" aria-hidden="true" /> {{ busy() ? 'Adding…' : 'Add team' }}
                      </button>
                    </div>
                  }
                  <zeus-team-selection-settings [event]="e" (updated)="onEventUpdated($event)" />
                </div>
              }
            }

            <!-- STEP 3 · map -->
            @case (3) {
              @if (event(); as e) {
                <div class="grid gap-4 lg:grid-cols-[3fr_2fr]">
                  <section class="panel flex flex-col gap-4 p-4" aria-labelledby="map-sum">
                    <h3 id="map-sum" class="label-caps">Map content</h3>
                    @if (contentLoading() && !content()) {
                      <zeus-loading-skeleton [rows]="1" />
                    } @else if (contentError(); as err) {
                      <zeus-error-state [error]="err" (retry)="loadContent()" />
                    } @else {
                      <dl class="grid grid-cols-3 gap-3 text-center">
                        <div class="rounded-sm bg-muted p-3">
                          <dt class="label-caps">Zones</dt>
                          <dd class="num text-2xl font-bold">{{ content()?.zones?.length ?? 0 }}</dd>
                        </div>
                        <div class="rounded-sm bg-muted p-3">
                          <dt class="label-caps">Points</dt>
                          <dd class="num text-2xl font-bold">{{ content()?.pois?.length ?? 0 }}</dd>
                        </div>
                        <div class="rounded-sm bg-muted p-3">
                          <dt class="label-caps">Objectives</dt>
                          <dd class="num text-2xl font-bold">{{ content()?.objectives?.length ?? 0 }}</dd>
                        </div>
                      </dl>
                      <p class="text-sm" [class.text-warning]="!hasPlayableArea()" [class.text-primary]="hasPlayableArea()">
                        {{ hasPlayableArea() ? '✓ Playable area drawn' : '◐ No playable area yet: draw its boundary so players get out-of-bounds warnings.' }}
                      </p>
                    }
                    <a hlmBtn class="h-12" [routerLink]="['/gm/events', e.id, 'map']">
                      <ng-icon name="lucideMap" size="18" aria-hidden="true" /> Open map editor
                    </a>
                    <p class="text-xs text-muted-foreground">The editor opens full screen. Use your browser's back button to return here.</p>
                  </section>

                  <section class="panel flex flex-col gap-3 p-4" aria-labelledby="map-tpl">
                    <h3 id="map-tpl" class="label-caps">Apply a saved map template</h3>
                    @if (mapTemplatesLoading()) {
                      <zeus-loading-skeleton [rows]="2" />
                    } @else if (!mapTemplates().length) {
                      <p class="text-sm text-muted-foreground">No map templates yet. Save one from the map editor of a finished event to reuse its zones, points and objectives.</p>
                    } @else {
                      <ul class="flex flex-col gap-2">
                        @for (t of mapTemplates(); track t.id) {
                          <li class="flex items-center gap-3 rounded-sm border border-border p-2">
                            <span class="min-w-0 flex-1">
                              <span class="block truncate font-semibold">{{ t.name }}</span>
                              <span class="num block text-xs text-muted-foreground">{{ t.zoneCount }} zones · {{ t.poiCount }} points · {{ t.objectiveCount }} objectives</span>
                            </span>
                            <button hlmBtn variant="outline" size="sm" class="h-11" type="button" (click)="applyMapTemplate(t)" [disabled]="busy()">Apply</button>
                          </li>
                        }
                      </ul>
                    }
                  </section>
                </div>
              }
            }

            <!-- STEP 4 · objectives -->
            @case (4) {
              @if (event(); as e) {
                <div class="flex flex-col gap-4">
                  <section class="panel p-4 text-sm" aria-labelledby="cap-methods">
                    <h3 id="cap-methods" class="label-caps mb-2">Capture methods</h3>
                    <ul class="grid gap-3 sm:grid-cols-3">
                      <li class="flex gap-2"><ng-icon name="lucideKeyRound" size="18" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" /><span><strong>Code</strong> — players type a code written at the objective.</span></li>
                      <li class="flex gap-2"><ng-icon name="lucideQrCode" size="18" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" /><span><strong>QR</strong> — players scan a printed QR code placed on site.</span></li>
                      <li class="flex gap-2"><ng-icon name="lucideCrosshair" size="18" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" /><span><strong>Hold zone</strong> — players stay inside a radius for a set time; GPS checks it.</span></li>
                    </ul>
                  </section>

                  <div class="flex items-center justify-between gap-2">
                    <h3 class="label-caps">Objectives · {{ content()?.objectives?.length ?? 0 }}</h3>
                    <a hlmBtn class="h-11" [routerLink]="['/gm/events', e.id, 'objectives', 'new']" [queryParams]="{ returnTo: returnTo() }">
                      <ng-icon name="lucidePlus" size="16" aria-hidden="true" /> Add objective
                    </a>
                  </div>
                  @if (contentLoading() && !content()) {
                    <zeus-loading-skeleton [rows]="3" />
                  } @else if (contentError(); as err) {
                    <zeus-error-state [error]="err" (retry)="loadContent()" />
                  } @else {
                    <ul class="flex flex-col gap-2">
                      @for (o of content()?.objectives ?? []; track o.id) {
                        <li class="panel flex flex-wrap items-center gap-3 p-3">
                          <span class="grid size-10 shrink-0 place-items-center rounded-sm border-2" [style.border-color]="o.color" aria-hidden="true">
                            <ng-icon name="lucideTarget" size="18" />
                          </span>
                          <span class="min-w-0 flex-1">
                            <span class="block truncate font-semibold uppercase">{{ o.name }}</span>
                            <span class="block text-xs text-muted-foreground">
                              {{ methodsLabel(o) }} · <span class="num">+{{ fmt(o.rewards.points) }} pts · +{{ fmt(o.rewards.currency) }} cr</span>
                              @if (!o.enabled) {
                                · Disabled
                              }
                            </span>
                          </span>
                          <a hlmBtn variant="outline" size="sm" class="h-11" [routerLink]="['/gm/events', e.id, 'objectives', o.id]" [queryParams]="{ returnTo: returnTo() }" [attr.aria-label]="'Edit ' + o.name">
                            <ng-icon name="lucidePencil" size="14" aria-hidden="true" /> Edit
                          </a>
                        </li>
                      } @empty {
                        <li>
                          <zeus-empty-state icon="lucideTarget" title="No objectives yet" message="Add control points, intel drops or flags. You can also place them from the map editor." />
                        </li>
                      }
                    </ul>
                  }
                </div>
              }
            }

            <!-- STEP 5 · rules of play -->
            @case (5) {
              @if (event(); as e) {
                <zeus-rules-of-play [form]="rulesForm" [eventId]="e.id" [perkCount]="content()?.perks?.length ?? null" (perksAdded)="loadContent()" />
              }
            }

            <!-- STEP 6 · review -->
            @case (6) {
              @if (event(); as e) {
                <div class="grid gap-4 lg:grid-cols-[3fr_2fr]">
                  <section class="panel p-4" aria-labelledby="chk">
                    <h3 id="chk" class="label-caps mb-2">Checklist · {{ warnings().length }} {{ warnings().length === 1 ? 'warning' : 'warnings' }}</h3>
                    @if (contentLoading() && !content()) {
                      <zeus-loading-skeleton [rows]="3" />
                    } @else {
                      <ul class="divide-y divide-border">
                        @for (c of checklist(); track c.label) {
                          <li class="flex items-start gap-3 py-3">
                            <span aria-hidden="true" class="mt-0.5 w-4 text-center font-bold" [class]="c.ok ? 'text-primary' : c.severity === 'warning' ? 'text-warning' : 'text-muted-foreground'">{{
                              c.ok ? '✓' : c.severity === 'warning' ? '▲' : '○'
                            }}</span>
                            <span class="min-w-0 flex-1">
                              <span class="block text-sm font-semibold">
                                <span class="sr-only">{{ c.ok ? 'Done: ' : c.severity === 'warning' ? 'Warning: ' : 'Optional: ' }}</span>{{ c.label }}
                              </span>
                              <span class="block text-xs text-muted-foreground">{{ c.detail }}</span>
                            </span>
                            @if (!c.ok) {
                              <button hlmBtn variant="ghost" size="sm" class="h-11" type="button" (click)="jump(c.step)">Fix</button>
                            }
                          </li>
                        }
                      </ul>
                    }
                  </section>

                  <section class="flex flex-col gap-4" aria-labelledby="pub">
                    <div class="panel flex flex-col gap-2 p-4 text-sm">
                      <h3 class="label-caps">Summary</h3>
                      <p class="font-semibold uppercase">{{ e.name }}</p>
                      <p class="text-muted-foreground">
                        {{ e.customModeName || modeLabel(e.gameMode) }} · <span class="num">{{ date(e.startAt) }} {{ time(e.startAt) }}–{{ time(e.endAt) }}</span>
                      </p>
                      <p class="text-muted-foreground">
                        {{ e.visibility === 'private' ? 'Private (join code)' : 'Public' }} · {{ e.requiresApproval ? 'Manual approval' : 'Automatic approval' }} ·
                        <span class="num">{{ e.minPlayers }}–{{ e.maxPlayers }}</span> players
                      </p>
                      <p class="text-muted-foreground">{{ visibilitySummary() }}</p>
                    </div>

                    <div class="panel flex flex-col gap-2 p-4">
                      <h3 id="pub" class="label-caps">Publish</h3>
                      @if (e.status === 'draft') {
                        <p class="text-sm text-muted-foreground">Drafts are only visible to Game Masters. Publish to show the event; open registration to let players join.</p>
                        <button hlmBtn class="h-12" type="button" (click)="changeStatus('registration_open')" [disabled]="busy()">
                          <ng-icon name="lucideUserPlus" size="18" aria-hidden="true" /> Open registration
                        </button>
                        <button hlmBtn variant="outline" class="h-12" type="button" (click)="changeStatus('published')" [disabled]="busy()">
                          <ng-icon name="lucideEye" size="18" aria-hidden="true" /> Publish (registration closed)
                        </button>
                        <a hlmBtn variant="ghost" class="h-12" [routerLink]="['/gm/events', e.id]">
                          <ng-icon name="lucideSave" size="18" aria-hidden="true" /> Save as draft
                        </a>
                      } @else {
                        <p class="text-sm text-muted-foreground">This event is already {{ statusChip(e.status).label.toLowerCase() }}. Manage its status from the event editor.</p>
                        <a hlmBtn class="h-12" [routerLink]="['/gm/events', e.id]">Go to event editor</a>
                      }
                    </div>
                  </section>
                </div>
              }
            }
          }
        </section>
      }

      <!-- Back / Next: pinned above the bottom nav on phones -->
      @if (currentStep() > 0 && !(loading() && !event())) {
        <div
          class="fixed inset-x-0 bottom-[calc(4rem+var(--safe-bottom))] z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:static lg:mt-8 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none"
        >
          <div class="mx-auto flex max-w-6xl items-center gap-3">
            @if (currentStep() > 1 || !event()) {
              <button hlmBtn variant="outline" class="h-12 min-w-24" type="button" (click)="back()" [disabled]="busy()">
                <ng-icon name="lucideArrowLeft" size="16" aria-hidden="true" /> Back
              </button>
            }
            <span class="num ml-auto hidden text-sm text-muted-foreground sm:inline">{{ currentStep() }} / {{ steps.length }}</span>
            @if (currentStep() < steps.length) {
              <button hlmBtn class="ml-auto h-12 min-w-32 sm:ml-0" type="button" (click)="next()" [disabled]="busy()">
                {{ busy() ? 'Saving…' : currentStep() === 1 && !event() ? 'Create draft' : 'Next' }}
                @if (!busy()) {
                  <ng-icon name="lucideArrowRight" size="16" aria-hidden="true" />
                }
              </button>
            } @else if (event(); as e) {
              <a hlmBtn variant="outline" class="ml-auto h-12 sm:ml-0" [routerLink]="['/gm/events', e.id]">Finish later</a>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class CreateEventWizardScreen {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly lifecycle = injectLifecycle();

  /** Query params */
  readonly eventId = input<string>();
  readonly step = input<string>();
  readonly template = input<string>();

  private readonly root = viewChild<ElementRef<HTMLElement>>('root');

  protected readonly steps = STEPS;
  protected readonly event = signal<EventDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<unknown>(null);
  protected readonly busy = signal(false);

  protected readonly content = signal<MapContent | null>(null);
  protected readonly contentLoading = signal(false);
  protected readonly contentError = signal<unknown>(null);

  protected readonly templates = signal<EventTemplate[]>([]);
  protected readonly templatesLoading = signal(false);
  protected readonly templatesError = signal<unknown>(null);
  protected readonly selectedTemplate = signal<string | null>(null);
  protected readonly mapTemplates = signal<MapTemplate[]>([]);
  protected readonly mapTemplatesLoading = signal(false);

  protected readonly basicsForm = createBasicsForm();
  protected readonly rulesForm = createRulesForm();
  protected readonly templateForm = new FormGroup(
    {
      name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
      date: new FormControl(this.basicsForm.controls.date.value, { nonNullable: true, validators: [Validators.required] }),
      startTime: new FormControl('09:00', { nonNullable: true, validators: [Validators.required] }),
      endTime: new FormControl('15:00', { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: [endAfterStart] },
  );
  protected readonly templateTick = staticFormTick(this.templateForm);

  protected readonly currentStep = computed(() => {
    const id = this.eventId();
    const raw = Math.floor(Number(this.step()));
    if (!id) return raw === 1 ? 1 : 0;
    if (!Number.isFinite(raw) || raw < 1) return 1;
    return Math.min(STEPS.length, raw);
  });
  protected readonly currentDef = computed(() => STEPS[Math.max(0, this.currentStep() - 1)]);
  protected readonly sortedTeams = computed(() => [...(this.event()?.teams ?? [])].sort((a, b) => a.sortOrder - b.sortOrder));
  protected readonly hasPlayableArea = computed(() => !!this.content()?.zones.some((z) => z.kind === 'playable'));
  protected readonly visibilitySummary = computed(() => {
    const e = this.event();
    return e ? describeVisibility(e.visibilityRules) : '';
  });

  protected readonly checklist = computed<CheckItem[]>(() => {
    const e = this.event();
    if (!e) return [];
    const c = this.content();
    const objectives = c?.objectives.length ?? 0;
    return [
      {
        ok: e.teams.length >= 2,
        label: e.teams.length >= 2 ? `${e.teams.length} teams` : `Fewer than 2 teams (${e.teams.length})`,
        detail: e.teams.length >= 2 ? 'Ready to start.' : 'The game cannot start with fewer than two teams.',
        step: 2,
        severity: 'warning',
      },
      {
        ok: objectives > 0,
        label: objectives ? `${objectives} objectives` : 'No objectives',
        detail: objectives ? 'Players have something to capture.' : 'Without objectives only GM adjustments change the score.',
        step: 4,
        severity: 'warning',
      },
      {
        ok: this.hasPlayableArea(),
        label: this.hasPlayableArea() ? 'Playable area drawn' : 'No playable area zone',
        detail: this.hasPlayableArea() ? 'Players are warned when they leave it.' : 'Draw the boundary in the map editor so players see where they can go.',
        step: 3,
        severity: 'warning',
      },
      {
        ok: !!e.safetyRules?.trim(),
        label: e.safetyRules?.trim() ? 'Safety rules written' : 'No safety rules',
        detail: e.safetyRules?.trim() ? 'Players accept them before the game.' : 'Add eye protection, safe zone and emergency procedures.',
        step: 1,
        severity: 'warning',
      },
      {
        ok: !!e.meetingAddress || e.meetingLat !== null,
        label: e.meetingAddress || e.meetingLat !== null ? 'Meeting point set' : 'No meeting point',
        detail: 'Optional, but players need to know where to park.',
        step: 1,
        severity: 'info',
      },
      {
        ok: !e.storeEnabled || (c?.perks.length ?? 0) > 0,
        label: !e.storeEnabled ? 'Perk store off' : (c?.perks.length ?? 0) > 0 ? `${c?.perks.length} perks in the store` : 'Store open but empty',
        detail: !e.storeEnabled || (c?.perks.length ?? 0) > 0 ? 'Store settings are consistent.' : 'Add the default perks or turn the store off.',
        step: 5,
        severity: 'info',
      },
    ];
  });
  protected readonly warnings = computed(() => this.checklist().filter((c) => !c.ok && c.severity === 'warning'));

  protected readonly statusChip = eventStatusChip;
  protected readonly fmt = formatNumber;
  protected readonly date = formatDate;
  protected readonly time = formatTime;
  protected modeLabel(m: keyof typeof GAME_MODE_LABELS): string {
    return GAME_MODE_LABELS[m];
  }

  private firstStepRender = true;

  constructor() {
    // Load the draft whenever eventId changes (and it is not the one we already hold).
    effect(() => {
      const id = this.eventId();
      untracked(() => {
        if (id && this.event()?.id !== id) void this.load(id);
      });
    });
    // Per-step data.
    effect(() => {
      const step = this.currentStep();
      const id = this.eventId();
      untracked(() => {
        if (step === 0 && !this.templates().length) void this.loadTemplates();
        if (id && (step === 3 || step === 4 || step === 5 || step === 6)) void this.loadContent();
        if (id && step === 3 && !this.mapTemplates().length) void this.loadMapTemplates();
        if (id && step === 6) void this.refreshEvent();
      });
    });
    effect(() => {
      const t = this.template();
      if (t) untracked(() => this.selectedTemplate.set(t));
    });
    // Move focus to the step title on step changes (keyboard and screen reader users).
    effect(() => {
      this.currentStep();
      untracked(() => {
        if (this.firstStepRender) {
          this.firstStepRender = false;
          return;
        }
        queueMicrotask(() => document.getElementById('wizard-step-title')?.focus());
      });
    });
  }

  protected stepState(n: number): 'complete' | 'current' | 'upcoming' {
    const cur = this.currentStep();
    if (n === cur) return 'current';
    return n < cur && this.event() ? 'complete' : 'upcoming';
  }

  protected returnTo(): string {
    return this.router.url;
  }

  protected methodsLabel(o: Objective): string {
    return o.methods.map((m) => (m === 'code' ? 'Code' : m === 'qr' ? 'QR' : 'Hold zone')).join(' / ') || 'No capture method';
  }

  // --- data ------------------------------------------------------------------------

  protected reload(): void {
    const id = this.eventId();
    if (id) void this.load(id);
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const e = await this.api.event(id);
      this.setEvent(e, true);
    } catch (err) {
      this.loadError.set(err);
    } finally {
      this.loading.set(false);
    }
  }

  private setEvent(e: EventDetail, patchForms: boolean): void {
    this.event.set(e);
    if (patchForms || !this.basicsForm.dirty) patchBasicsForm(this.basicsForm, e);
    if (patchForms || !this.rulesForm.dirty) patchRulesForm(this.rulesForm, e);
  }

  protected async refreshEvent(): Promise<void> {
    const id = this.event()?.id;
    if (!id) return;
    try {
      const e = await this.api.event(id);
      this.setEvent(e, false);
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected onEventUpdated(e: EventDetail): void {
    this.setEvent(e, false);
  }

  async loadContent(): Promise<void> {
    const id = this.eventId();
    if (!id) return;
    this.contentLoading.set(true);
    this.contentError.set(null);
    try {
      const [zones, pois, objectives, perks] = await Promise.all([this.api.zones(id), this.api.pois(id), this.api.objectives(id), this.api.perks(id)]);
      this.content.set({ zones, pois, objectives: [...objectives].sort((a, b) => a.sortOrder - b.sortOrder), perks });
    } catch (err) {
      this.contentError.set(err);
    } finally {
      this.contentLoading.set(false);
    }
  }

  async loadTemplates(): Promise<void> {
    this.templatesLoading.set(true);
    this.templatesError.set(null);
    try {
      this.templates.set(await this.api.eventTemplates());
    } catch (err) {
      this.templatesError.set(err);
    } finally {
      this.templatesLoading.set(false);
    }
  }

  private async loadMapTemplates(): Promise<void> {
    this.mapTemplatesLoading.set(true);
    try {
      this.mapTemplates.set(await this.api.mapTemplates());
    } catch {
      this.mapTemplates.set([]);
    } finally {
      this.mapTemplatesLoading.set(false);
    }
  }

  // --- navigation ------------------------------------------------------------------

  protected goto(step: number, eventId: string | undefined = this.event()?.id ?? this.eventId()): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { eventId: eventId ?? null, step, template: null },
      replaceUrl: true,
    });
  }

  protected async next(): Promise<void> {
    const step = this.currentStep();
    const id = await this.persist(step);
    if (id === false) return;
    this.goto(step + 1, id ?? undefined);
  }

  protected async back(): Promise<void> {
    const step = this.currentStep();
    if (step <= 1 && !this.event()) {
      this.goto(0);
      return;
    }
    const id = await this.persist(step);
    if (id === false) return;
    this.goto(Math.max(1, step - 1));
  }

  protected async jump(target: number): Promise<void> {
    if (!this.event() || target === this.currentStep()) return;
    const id = await this.persist(this.currentStep());
    if (id === false) return;
    this.goto(target);
  }

  /** Saves the current step. Returns the event id, or false when the step is invalid or saving failed. */
  private async persist(step: number): Promise<string | null | false> {
    if (step === 1) return this.saveBasics();
    if (step === 5) return this.saveRules();
    return this.event()?.id ?? null;
  }

  private async saveBasics(): Promise<string | false> {
    const f = this.basicsForm;
    if (f.invalid) {
      f.markAllAsTouched();
      focusFirstInvalid(this.root()?.nativeElement);
      this.toast.error('Check the highlighted fields.');
      return false;
    }
    const existing = this.event();
    if (existing && !f.dirty) return existing.id;
    this.busy.set(true);
    try {
      const body = basicsToInput(f);
      const e = existing ? await this.api.updateEvent(existing.id, body) : await this.api.createEvent(body);
      this.setEvent(e, true);
      if (!existing) this.toast.success('Draft created', e.visibility === 'private' && e.joinCode ? `Join code ${e.joinCode}` : 'It stays a draft until you publish it.');
      return e.id;
    } catch (err) {
      const unplaced = applyServerErrors(f, err, BASICS_FIELD_MAP);
      focusFirstInvalid(this.root()?.nativeElement);
      if (unplaced.length || !Object.keys(ApiError.from(err).fields).length) this.toast.error(err);
      else this.toast.error('Check the highlighted fields.');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async saveRules(): Promise<string | false> {
    const e = this.event();
    if (!e) return false;
    const f = this.rulesForm;
    if (f.invalid) {
      f.markAllAsTouched();
      focusFirstInvalid(this.root()?.nativeElement);
      this.toast.error('Check the highlighted fields.');
      return false;
    }
    if (!f.dirty) return e.id;
    this.busy.set(true);
    try {
      const updated = await this.api.updateEvent(e.id, rulesToInput(f));
      this.setEvent(updated, true);
      return e.id;
    } catch (err) {
      applyServerErrors(f, err);
      focusFirstInvalid(this.root()?.nativeElement);
      this.toast.error(err);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  // --- step 0 ----------------------------------------------------------------------

  protected tErr(name: 'name'): string | null {
    return controlError(this.templateForm.controls[name]);
  }

  protected async createFromTemplate(): Promise<void> {
    const tpl = this.selectedTemplate();
    const f = this.templateForm;
    if (!tpl) return;
    if (f.invalid) {
      f.markAllAsTouched();
      return;
    }
    const v = f.getRawValue();
    this.busy.set(true);
    try {
      const e = await this.api.createEventFromTemplate(tpl, {
        name: v.name.trim(),
        startAt: new Date(`${v.date}T${v.startTime}`).toISOString(),
        endAt: new Date(`${v.date}T${v.endTime}`).toISOString(),
      });
      this.setEvent(e, true);
      this.toast.success('Draft created from template', 'Check each step before publishing.');
      this.goto(1, e.id);
    } catch (err) {
      applyServerErrors(f, err, { startAt: 'startTime', endAt: 'endTime' });
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  // --- step 2 ----------------------------------------------------------------------

  protected async addTwoTeams(): Promise<void> {
    const e = this.event();
    if (!e) return;
    this.busy.set(true);
    try {
      for (const preset of TWO_TEAM_PRESET) {
        if (!e.teams.some((t) => t.name.toLowerCase() === preset.name!.toLowerCase())) await this.api.createTeam(e.id, preset);
      }
      this.toast.success('Teams Alpha and Bravo added');
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
      await this.refreshEvent();
    }
  }

  protected async addTeam(): Promise<void> {
    const e = this.event();
    if (!e) return;
    this.busy.set(true);
    try {
      const t = await this.api.createTeam(e.id, nextTeamPreset(e.teams));
      this.toast.success(`Team ${t.name} added`);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
      await this.refreshEvent();
    }
  }

  // --- step 3 ----------------------------------------------------------------------

  protected async applyMapTemplate(t: MapTemplate): Promise<void> {
    const e = this.event();
    if (!e) return;
    const c = this.content();
    const existing = (c?.zones.length ?? 0) + (c?.pois.length ?? 0) + (c?.objectives.length ?? 0);
    const ok = await this.confirm.ask({
      title: `Apply map template ${t.name}?`,
      consequences: [
        `Adds ${t.zoneCount} zones, ${t.poiCount} points of interest and ${t.objectiveCount} objectives to this event.`,
        existing ? `The ${existing} items already on this map stay; check for duplicates afterwards.` : 'The map is empty, nothing is overwritten.',
      ],
      confirmLabel: 'Apply template',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      const r = await this.api.applyMapTemplate(e.id, t.id);
      this.toast.success('Map template applied', `${r.zones} zones, ${r.pois} points, ${r.objectives} objectives added.`);
      await this.loadContent();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  // --- step 6 ----------------------------------------------------------------------

  protected async changeStatus(to: EventStatus): Promise<void> {
    const e = this.event();
    if (!e) return;
    this.busy.set(true);
    try {
      const updated = await this.lifecycle(e, to);
      if (updated) {
        this.event.set(updated);
        void this.router.navigate(['/gm/events', updated.id]);
      }
    } finally {
      this.busy.set(false);
    }
  }
}
