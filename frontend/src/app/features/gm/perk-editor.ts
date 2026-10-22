import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { filter } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { EventDetail, Perk, PerkConfig, PerkInput, PerkType, PlayerRole, Precision } from '../../core/api/models';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { PERK_TYPE_LABELS, PLAYER_ROLE_LABELS, PRECISION_LABELS, formatDuration } from '../../core/util/format';
import { perkIcon } from '../../shared/cards';
import { CurrencyDisplay } from '../../shared/currency-display';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { GmPanel, SaveState, SaveStateIndicator, SegmentOption, SegmentedControl, SwitchRow } from './common/controls';
import { applyServerErrors, controlError, focusFirstInvalid, integerValidator, staticFormTick } from './common/form-utils';

/** Lucide icons (all registered in core/ui/icons.ts) a perk can use. */
const PERK_ICONS: { name: string; label: string }[] = [
  { name: 'lucideRadar', label: $localize`Radar` },
  { name: 'lucideSatellite', label: $localize`Satellite` },
  { name: 'lucideScan', label: $localize`Scan` },
  { name: 'lucideEye', label: $localize`Eye` },
  { name: 'lucideAntenna', label: $localize`Antenna` },
  { name: 'lucideRadio', label: $localize`Radio` },
  { name: 'lucideCoins', label: $localize`Coins` },
  { name: 'lucideShieldCheck', label: $localize`Shield` },
  { name: 'lucideSparkles', label: $localize`Sparkles` },
  { name: 'lucideHeartPulse', label: $localize`Heart pulse` },
  { name: 'lucideAmbulance', label: $localize`Ambulance` },
  { name: 'lucidePackage', label: $localize`Package` },
  { name: 'lucideTruck', label: $localize`Truck` },
  { name: 'lucideZap', label: $localize`Bolt` },
  { name: 'lucideTarget', label: $localize`Target` },
  { name: 'lucideCrosshair', label: $localize`Crosshair` },
  { name: 'lucideLocateFixed', label: $localize`Locate` },
  { name: 'lucideCompass', label: $localize`Compass` },
  { name: 'lucideFlag', label: $localize`Flag` },
  { name: 'lucideBan', label: $localize`Ban` },
  { name: 'lucideLock', label: $localize`Lock` },
  { name: 'lucideTimer', label: $localize`Timer` },
  { name: 'lucideHourglass', label: $localize`Hourglass` },
  { name: 'lucideMegaphone', label: $localize`Megaphone` },
  { name: 'lucideSiren', label: $localize`Siren` },
  { name: 'lucideStar', label: $localize`Star` },
];

const TYPE_TARGET: Partial<Record<PerkType, Perk['target']>> = {
  uav: 'enemy_team',
  theft: 'enemy_team',
  recon: 'enemy_team',
  comms_jammer: 'enemy_team',
  jammer: 'objective',
  shield: 'objective',
};

const DEFAULT_CONFIG: Required<PerkConfig> = {
  uav: { refreshSec: 10, precision: 'exact', delaySec: 0, areaRadiusM: 75 },
  recon: { precision: 'approximate', revealSec: 15 },
  theft: { mode: 'percent', amount: 20, protectionSec: 600 },
  doublePoints: { multiplier: 2 },
};

const intCtl = (v: number, min: number, max: number) =>
  new FormControl(v, { nonNullable: true, validators: [Validators.required, Validators.min(min), Validators.max(max), integerValidator] });
const numCtl = (v: number, min: number, max: number) => new FormControl(v, { nonNullable: true, validators: [Validators.required, Validators.min(min), Validators.max(max)] });

function theftAmountValidator(g: AbstractControl): ValidationErrors | null {
  const v = g.value as { mode: string; amount: number };
  return v.mode === 'percent' && Number(v.amount) > 100 ? { percentTooHigh: true } : null;
}

function rolesValidator(g: AbstractControl): ValidationErrors | null {
  const v = g.value as { eligible: string; eligibleRoles: PlayerRole[] };
  return v.eligible === 'roles' && !v.eligibleRoles?.length ? { rolesRequired: true } : null;
}

function createPerkForm() {
  return new FormGroup(
    {
      name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2), Validators.maxLength(80)] }),
      description: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(1000)] }),
      icon: new FormControl('lucideZap', { nonNullable: true }),
      type: new FormControl<PerkType>('custom', { nonNullable: true }),
      price: intCtl(100, 0, 1_000_000),
      durationSec: intCtl(0, 0, 86_400),
      cooldownSec: intCtl(0, 0, 86_400),
      totalQuantity: intCtl(0, 0, 10_000),
      perTeamLimit: intCtl(0, 0, 10_000),
      eligible: new FormControl<Perk['eligible']>('any', { nonNullable: true }),
      eligibleRoles: new FormControl<PlayerRole[]>([], { nonNullable: true }),
      requiresApproval: new FormControl(false, { nonNullable: true }),
      activation: new FormControl<Perk['activation']>('immediate', { nonNullable: true }),
      target: new FormControl<Perk['target']>('none', { nonNullable: true }),
      enabled: new FormControl(true, { nonNullable: true }),
      uav: new FormGroup({
        refreshSec: intCtl(10, 2, 600),
        precision: new FormControl<Precision>('exact', { nonNullable: true }),
        delaySec: intCtl(0, 0, 3600),
        areaRadiusM: numCtl(75, 5, 1000),
      }),
      recon: new FormGroup({
        precision: new FormControl<Precision>('approximate', { nonNullable: true }),
        revealSec: intCtl(15, 5, 600),
      }),
      theft: new FormGroup(
        {
          mode: new FormControl<'fixed' | 'percent'>('percent', { nonNullable: true }),
          amount: numCtl(20, 0, 1_000_000),
          protectionSec: intCtl(600, 0, 86_400),
        },
        { validators: [theftAmountValidator] },
      ),
      doublePoints: new FormGroup({ multiplier: numCtl(2, 1, 10) }),
    },
    { validators: [rolesValidator] },
  );
}
type PerkForm = ReturnType<typeof createPerkForm>;
const CONFIG_KEYS = ['uav', 'recon', 'theft', 'doublePoints'] as const;
type ConfigKey = (typeof CONFIG_KEYS)[number];

function configKeyFor(type: PerkType): ConfigKey | null {
  return type === 'uav' ? 'uav' : type === 'recon' ? 'recon' : type === 'theft' ? 'theft' : type === 'double_points' ? 'doublePoints' : null;
}

@Component({
  selector: 'zeus-perk-editor-screen',
  imports: [
    ReactiveFormsModule,
    NgIcon,
    HlmButton,
    HlmInput,
    HlmLabel,
    HlmSwitch,
    HlmTextarea,
    PageHeader,
    LoadingSkeleton,
    ErrorState,
    EmptyState,
    CurrencyDisplay,
    GmPanel,
    SaveStateIndicator,
    SegmentedControl,
    SwitchRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <zeus-page-header title="Perk store" [eyebrow]="event()?.name ?? null" [back]="'/gm/events/' + eventId()" backLabel="Event editor" i18n-title i18n-backLabel>
        <button hlmBtn variant="outline" class="h-11" type="button" (click)="addDefaults()" [disabled]="busy()">
          <ng-icon name="lucideSparkles" size="16" aria-hidden="true" /> <ng-container i18n>Add default perks</ng-container>
        </button>
        <button hlmBtn class="h-11" type="button" (click)="openNew()">
          <ng-icon name="lucidePlus" size="16" aria-hidden="true" /> <ng-container i18n>New custom perk</ng-container>
        </button>
      </zeus-page-header>

      <div [class]="editing() ? 'grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_28rem]' : 'grid items-start gap-6'">
        <div class="flex min-w-0 flex-col gap-4">
          @if (event(); as e) {
            @for (k of [storeRev()]; track k) {
            <section class="panel px-4 py-2" aria-label="Store status" i18n-aria-label>
              <zeus-switch-row
                label="Store open during the game"
                [description]="e.storeEnabled ? txt.teamsCanBuyEnabled : txt.theStoreIsClosed"
                [checked]="e.storeEnabled"
                [disabled]="storeBusy()"
                (checkedChange)="setStore($event)" i18n-label
              />
            </section>
            }
          }

          @if (loading() && !perks()) {
            <zeus-loading-skeleton [rows]="5" />
          } @else if (loadError(); as err) {
            <zeus-error-state [error]="err" (retry)="load()" />
          } @else if (!sortedPerks().length) {
            <zeus-empty-state icon="lucideStore" title="No perks yet" message="Add the default set (UAV, jammer, theft, recon, respawn, shield, double points, supply drop, comms jammer) or create your own." i18n-title i18n-message>
              <button hlmBtn class="h-11" type="button" (click)="addDefaults()" [disabled]="busy()" i18n>Add default perks</button>
              <button hlmBtn variant="outline" class="h-11" type="button" (click)="openNew()" i18n>New custom perk</button>
            </zeus-empty-state>
          } @else {
            <h2 class="label-caps" i18n>Perks · {{ sortedPerks().length }} · {{ enabledCount() }} enabled</h2>
            <ul class="flex flex-col gap-2">
              @for (p of sortedPerks(); track p.id) {
                <li class="panel flex flex-wrap items-center gap-3 p-3" [class.opacity-70]="!p.enabled" [class.border-primary]="editingId() === p.id">
                  <span class="grid size-11 shrink-0 place-items-center rounded-md bg-muted text-primary" aria-hidden="true">
                    <ng-icon [name]="iconOf(p)" size="20" />
                  </span>
                  <div class="min-w-0 flex-1 basis-48">
                    <p class="label-caps">{{ typeLabel(p.type) }}{{ p.requiresApproval ? txt.needsApproval : '' }}</p>
                    <p class="truncate font-bold uppercase">{{ p.name }}</p>
                    <p class="num text-xs text-muted-foreground">
                      <ng-container i18n>{{ p.durationSec ? dur(p.durationSec) : txt.instant }} · cooldown {{ p.cooldownSec ? dur(p.cooldownSec) : txt.noCooldown }} · left
                      {{ p.totalQuantity === 0 ? '∞' : (p.remainingQuantity ?? p.totalQuantity) + '/' + p.totalQuantity }}</ng-container>
                      @if (p.perTeamLimit) {
                        <ng-container i18n>· {{ p.perTeamLimit }}/team</ng-container>
                      }
                    </p>
                  </div>
                  <!-- Phones: price and controls on their own line, so the name keeps the full width -->
                  <div class="flex w-full items-center gap-3 sm:w-auto">
                    <zeus-currency-display class="mr-auto sm:mr-0" [amount]="p.price" size="md" />
                    <span class="flex min-h-11 items-center gap-2">
                      <hlm-switch [checked]="p.enabled" [aria-label]="(p.enabled ? txt.disable : txt.enable) + p.name" (checkedChange)="toggleEnabled(p, $event)" />
                      <span class="w-14 text-xs text-muted-foreground" aria-hidden="true">{{ p.enabled ? txt.on : txt.off }}</span>
                    </span>
                    <button hlmBtn variant="outline" size="sm" class="h-11" type="button" (click)="openEdit(p)" ariaLabel="Edit {{ p.name }}" i18n-ariaLabel>
                      <ng-icon name="lucidePencil" size="14" aria-hidden="true" /> <ng-container i18n>Edit</ng-container>
                    </button>
                  </div>
                </li>
              }
            </ul>
          }
        </div>

        <zeus-gm-panel [open]="editing()" [title]="editingId() ? txt.editPerk : txt.newPerk" [eyebrow]="typeLabel(form.controls.type.value)" (closed)="closeEditor()">
          <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-5" #editorForm [attr.data-rev]="tick()">
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="pk-type" i18n>Type</label>
              <select id="pk-type" formControlName="type" class="h-11 rounded-md border border-input bg-background px-2.5 text-base dark:bg-input/30" (change)="onTypeChange()">
                @for (t of types; track t.value) {
                  <option [value]="t.value">{{ t.label }}</option>
                }
              </select>
            </div>

            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="pk-name" i18n>Name</label>
              <input hlmInput id="pk-name" class="h-11" formControlName="name" autocomplete="off" [attr.aria-invalid]="!!err('name')" />
              @if (err('name'); as e) {
                <p class="field-error">{{ e }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="pk-desc" i18n>Description</label>
              <textarea hlmTextarea id="pk-desc" rows="3" formControlName="description" placeholder="What the team gets, in one or two sentences." i18n-placeholder></textarea>
            </div>

            <div class="flex flex-col gap-1.5">
              <span hlmLabel id="pk-icon-l" i18n>Icon</span>
              <div role="radiogroup" aria-labelledby="pk-icon-l" class="flex flex-wrap gap-1">
                @for (i of icons; track i.name) {
                  <label class="grid size-11 cursor-pointer place-items-center rounded-sm border has-focus-visible:ring-2 has-focus-visible:ring-ring"
                    [class]="form.controls.icon.value === i.name ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'">
                    <input type="radio" name="pk-icon" class="sr-only" [checked]="form.controls.icon.value === i.name" (change)="setIcon(i.name)" [attr.aria-label]="i.label" />
                    <ng-icon [name]="i.name" size="18" aria-hidden="true" />
                  </label>
                }
              </div>
            </div>

            <fieldset class="grid grid-cols-2 gap-3">
              <legend class="label-caps col-span-2 mb-1" i18n>Price and limits</legend>
              @for (f of numberFields; track f.key) {
                <div class="flex flex-col gap-1.5">
                  <label hlmLabel [for]="'pk-' + f.key">{{ f.label }}</label>
                  <input hlmInput [id]="'pk-' + f.key" type="number" min="0" inputmode="numeric" class="num h-11" [formControlName]="f.key" [attr.aria-invalid]="!!err(f.key)" />
                  @if (err(f.key); as e) {
                    <p class="field-error">{{ e }}</p>
                  } @else {
                    <p class="text-xs text-muted-foreground">{{ f.hint }}</p>
                  }
                </div>
              }
            </fieldset>

            <fieldset class="flex flex-col gap-2">
              <legend class="label-caps mb-1" i18n>Who can buy</legend>
              <zeus-segmented formControlName="eligible" [options]="eligibleOptions" stacked />
              @if (form.controls.eligible.value === 'roles') {
                <div class="grid grid-cols-2 gap-1 rounded-sm border border-border p-2" role="group" aria-label="Roles that can buy" i18n-aria-label>
                  @for (r of roles; track r.value) {
                    <label class="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm hover:bg-muted">
                      <input type="checkbox" class="size-5 accent-primary" [checked]="hasRole(r.value)" (change)="toggleRole(r.value)" />
                      {{ r.label }}
                    </label>
                  }
                </div>
                @if (form.errors?.['rolesRequired']) {
                  <p class="field-error" i18n>Pick at least one role.</p>
                }
              }
            </fieldset>

            <div class="divide-y divide-border">
              <zeus-switch-row formControlName="requiresApproval" label="Requires GM approval" description="Purchases wait in your control center; credits are refunded if you reject them." i18n-label i18n-description />
              <zeus-switch-row formControlName="enabled" label="Enabled" description="Disabled perks are hidden from the store." i18n-label i18n-description />
            </div>

            <fieldset class="flex flex-col gap-2">
              <legend class="label-caps mb-1" i18n>Activation</legend>
              <zeus-segmented formControlName="activation" [options]="activationOptions" stacked />
            </fieldset>

            <fieldset class="flex flex-col gap-2">
              <legend class="label-caps mb-1" i18n>Target</legend>
              <zeus-segmented formControlName="target" [options]="targetOptions" />
              <p class="text-xs text-muted-foreground" i18n>Preset from the type: UAV, recon and theft target an enemy team; jammer and shield target an objective.</p>
            </fieldset>

            @switch (configKey()) {
              @case ('uav') {
                <fieldset formGroupName="uav" class="flex flex-col gap-3 rounded-sm border border-border p-3">
                  <legend class="label-caps px-1" i18n>UAV settings</legend>
                  <p class="flex gap-2 text-xs text-muted-foreground">
                    <ng-icon name="lucideShieldCheck" size="14" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                    <ng-container i18n>Enemy positions are never sent to the buying team before activation or after expiry.</ng-container>
                  </p>
                  <span hlmLabel id="uav-prec-l" i18n>Precision</span>
                  <zeus-segmented formControlName="precision" [options]="precisionOptions" labelledby="uav-prec-l" />
                  <div class="grid grid-cols-3 gap-2">
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="uav-ref" i18n>Refresh (s)</label>
                      <input hlmInput id="uav-ref" type="number" min="2" class="num h-11" formControlName="refreshSec" [attr.aria-invalid]="!!cErr('uav', 'refreshSec')" />
                      @if (cErr('uav', 'refreshSec'); as e) {
                        <p class="field-error">{{ e }}</p>
                      }
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="uav-del" i18n>Delay (s)</label>
                      <input hlmInput id="uav-del" type="number" min="0" class="num h-11" formControlName="delaySec" [attr.aria-invalid]="!!cErr('uav', 'delaySec')" />
                      @if (cErr('uav', 'delaySec'); as e) {
                        <p class="field-error">{{ e }}</p>
                      }
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="uav-rad" i18n>Area radius (m)</label>
                      <input hlmInput id="uav-rad" type="number" min="5" class="num h-11" formControlName="areaRadiusM" [attr.aria-invalid]="!!cErr('uav', 'areaRadiusM')" />
                      @if (cErr('uav', 'areaRadiusM'); as e) {
                        <p class="field-error">{{ e }}</p>
                      }
                    </div>
                  </div>
                </fieldset>
              }
              @case ('recon') {
                <fieldset formGroupName="recon" class="flex flex-col gap-3 rounded-sm border border-border p-3">
                  <legend class="label-caps px-1" i18n>Recon scan settings</legend>
                  <p class="text-xs text-muted-foreground" i18n>A one-off snapshot of enemy positions, shown for a short time.</p>
                  <span hlmLabel id="rec-prec-l" i18n>Precision</span>
                  <zeus-segmented formControlName="precision" [options]="precisionOptions" labelledby="rec-prec-l" />
                  <div class="flex flex-col gap-1.5">
                    <label hlmLabel for="rec-rev" i18n>Reveal for (s)</label>
                    <input hlmInput id="rec-rev" type="number" min="5" class="num h-11 max-w-32" formControlName="revealSec" [attr.aria-invalid]="!!cErr('recon', 'revealSec')" />
                    @if (cErr('recon', 'revealSec'); as e) {
                      <p class="field-error">{{ e }}</p>
                    }
                  </div>
                </fieldset>
              }
              @case ('theft') {
                <fieldset formGroupName="theft" class="flex flex-col gap-3 rounded-sm border border-border p-3">
                  <legend class="label-caps px-1" i18n>Currency theft settings</legend>
                  <zeus-segmented formControlName="mode" [options]="theftModeOptions" />
                  <div class="grid grid-cols-2 gap-2">
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="th-amt">{{ form.controls.theft.controls.mode.value === 'percent' ? txt.percentStolen : txt.creditsStolen }}</label>
                      <input hlmInput id="th-amt" type="number" min="0" class="num h-11" formControlName="amount" [attr.aria-invalid]="!!cErr('theft', 'amount') || !!form.controls.theft.errors?.['percentTooHigh']" />
                      @if (cErr('theft', 'amount'); as e) {
                        <p class="field-error">{{ e }}</p>
                      } @else if (form.controls.theft.errors?.['percentTooHigh']) {
                        <p class="field-error" i18n>At most 100%.</p>
                      }
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label hlmLabel for="th-prot" i18n>Protection (s)</label>
                      <input hlmInput id="th-prot" type="number" min="0" class="num h-11" formControlName="protectionSec" [attr.aria-invalid]="!!cErr('theft', 'protectionSec')" />
                      @if (cErr('theft', 'protectionSec'); as e) {
                        <p class="field-error">{{ e }}</p>
                      }
                    </div>
                  </div>
                  <p class="text-xs text-muted-foreground" i18n>
                    Protection: after being robbed, a team cannot be robbed again for this long. Balances never go negative: a team only loses what it has.
                  </p>
                </fieldset>
              }
              @case ('doublePoints') {
                <fieldset formGroupName="doublePoints" class="flex flex-col gap-3 rounded-sm border border-border p-3">
                  <legend class="label-caps px-1" i18n>Double points settings</legend>
                  <div class="flex flex-col gap-1.5">
                    <label hlmLabel for="dp-mul" i18n>Multiplier</label>
                    <input hlmInput id="dp-mul" type="number" min="1" max="10" step="0.5" class="num h-11 max-w-32" formControlName="multiplier" [attr.aria-invalid]="!!cErr('doublePoints', 'multiplier')" />
                    @if (cErr('doublePoints', 'multiplier'); as e) {
                      <p class="field-error">{{ e }}</p>
                    } @else {
                      <p class="text-xs text-muted-foreground" i18n>Capture points are multiplied while the perk is active (1–10).</p>
                    }
                  </div>
                </fieldset>
              }
            }

            <div class="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-card px-4 py-3">
              @if (editingId()) {
                <button hlmBtn variant="destructive" class="h-11" type="button" (click)="remove()" [disabled]="saveState() === 'saving'">
                  <ng-icon name="lucideTrash2" size="16" aria-hidden="true" /> <ng-container i18n>Delete</ng-container>
                </button>
              }
              <span class="ml-auto"><zeus-save-state [state]="effectiveState()" [error]="saveError()" /></span>
              <button hlmBtn class="h-11 min-w-28" type="submit" [disabled]="saveState() === 'saving'">
                {{ saveState() === 'saving' ? txt.saving : editingId() ? txt.savePerk : txt.createPerk }}
              </button>
            </div>
          </form>
        </zeus-gm-panel>
      </div>
    </div>
  `,
})
export class PerkEditorScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    needsApproval: $localize` · needs approval`,
    instant: $localize`Instant`,
    noCooldown: $localize`:cooldown|:none`,
    on: $localize`On`,
    off: $localize`Off`,
    percentStolen: $localize`Percent stolen`,
    creditsStolen: $localize`Credits stolen`,
    saving: $localize`Saving…`,
    savePerk: $localize`Save perk`,
    createPerk: $localize`Create perk`,
    teamsCanBuyEnabled: $localize`Teams can buy enabled perks with their credits while the game is live.`,
    theStoreIsClosed: $localize`The store is closed: players see it but cannot buy anything.`,
    disable: $localize`Disable `,
    enable: $localize`Enable `,
    editPerk: $localize`Edit perk`,
    newPerk: $localize`New perk`,
  };

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly realtime = inject(RealtimeService);
  private readonly destroyRef = inject(DestroyRef);

  readonly eventId = input.required<string>();

  private readonly editorForm = viewChild<ElementRef<HTMLElement>>('editorForm');

  protected readonly event = signal<EventDetail | null>(null);
  protected readonly perks = signal<Perk[] | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<unknown>(null);
  protected readonly busy = signal(false);
  protected readonly storeBusy = signal(false);
  /** Bumped after a failed store toggle to rebuild the switch from the unchanged event. */
  protected readonly storeRev = signal(0);
  protected readonly editing = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly saveState = signal<SaveState>('idle');
  protected readonly saveError = signal<string | null>(null);

  protected readonly form: PerkForm = createPerkForm();
  protected readonly tick = staticFormTick(this.form);

  protected readonly icons = PERK_ICONS;
  protected readonly types = (Object.keys(PERK_TYPE_LABELS) as PerkType[]).map((t) => ({ value: t, label: PERK_TYPE_LABELS[t] }));
  protected readonly roles = (Object.keys(PLAYER_ROLE_LABELS) as PlayerRole[]).map((r) => ({ value: r, label: PLAYER_ROLE_LABELS[r] }));
  protected readonly numberFields: { key: 'price' | 'durationSec' | 'cooldownSec' | 'totalQuantity' | 'perTeamLimit'; label: string; hint: string }[] = [
    { key: 'price', label: $localize`Price (credits)`, hint: $localize`0 = free` },
    { key: 'durationSec', label: $localize`Duration (s)`, hint: $localize`0 = instant effect` },
    { key: 'cooldownSec', label: $localize`Cooldown (s)`, hint: $localize`Per team, between purchases` },
    { key: 'totalQuantity', label: $localize`Total quantity`, hint: $localize`0 = unlimited` },
    { key: 'perTeamLimit', label: $localize`Per-team limit`, hint: $localize`0 = unlimited` },
  ];
  protected readonly eligibleOptions: SegmentOption<Perk['eligible']>[] = [
    { value: 'any', label: $localize`Any player`, hint: $localize`Every team member can buy it.` },
    { value: 'squad_leaders', label: $localize`Squad leaders`, hint: $localize`Only players marked as squad leader.` },
    { value: 'roles', label: $localize`Specific roles`, hint: $localize`Only players with the roles you pick.` },
  ];
  protected readonly activationOptions: SegmentOption<Perk['activation']>[] = [
    { value: 'immediate', label: $localize`Immediately`, hint: $localize`Takes effect as soon as it is bought (or approved).` },
    { value: 'manual', label: $localize`When the team activates it`, hint: $localize`Bought now, triggered later from the store.` },
  ];
  protected readonly targetOptions: SegmentOption<Perk['target']>[] = [
    { value: 'none', label: $localize`None` },
    { value: 'enemy_team', label: $localize`Enemy team` },
    { value: 'objective', label: $localize`Objective` },
  ];
  protected readonly precisionOptions: SegmentOption<Precision>[] = (['exact', 'approximate', 'delayed', 'area'] as Precision[]).map((p) => ({ value: p, label: PRECISION_LABELS[p] }));
  protected readonly theftModeOptions: SegmentOption<'fixed' | 'percent'>[] = [
    { value: 'percent', label: $localize`Percent of balance` },
    { value: 'fixed', label: $localize`Fixed amount` },
  ];

  protected readonly sortedPerks = computed(() => [...(this.perks() ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
  protected readonly enabledCount = computed(() => (this.perks() ?? []).filter((p) => p.enabled).length);
  protected readonly configKey = computed(() => {
    this.tick();
    return configKeyFor(this.form.controls.type.value);
  });
  protected readonly effectiveState = computed<SaveState>(() => {
    this.tick();
    const s = this.saveState();
    if (s === 'saving' || s === 'failed') return s;
    return this.form.dirty ? 'unsaved' : s;
  });

  constructor() {
    effect(() => {
      const id = this.eventId();
      untracked(() => {
        void this.load();
        void this.realtime.subscribe(id, this.destroyRef);
      });
    });
    this.realtime
      .on('invalidate')
      .pipe(
        filter((p) => p.eventId === this.eventId() && (p.scopes.includes('perks') || p.scopes.includes('event'))),
        takeUntilDestroyed(),
      )
      .subscribe(() => void this.load(true));
  }

  async load(quiet = false): Promise<void> {
    if (!quiet) this.loading.set(true);
    this.loadError.set(null);
    try {
      const [e, perks] = await Promise.all([this.api.event(this.eventId()), this.api.perks(this.eventId())]);
      this.event.set(e);
      this.perks.set(perks);
    } catch (err) {
      if (quiet && this.perks()) return;
      this.loadError.set(err);
    } finally {
      this.loading.set(false);
    }
  }

  protected typeLabel(t: PerkType): string {
    return PERK_TYPE_LABELS[t];
  }
  protected dur(sec: number): string {
    return formatDuration(sec * 1000);
  }
  protected iconOf(p: Perk): string {
    return PERK_ICONS.some((i) => i.name === p.icon) ? p.icon : perkIcon(p.type);
  }
  protected err(name: 'name' | 'price' | 'durationSec' | 'cooldownSec' | 'totalQuantity' | 'perTeamLimit'): string | null {
    return controlError(this.form.controls[name]);
  }
  protected cErr(group: ConfigKey, name: string): string | null {
    return controlError(this.form.get(`${group}.${name}`));
  }

  // --- store & list -----------------------------------------------------------------

  protected async setStore(enabled: boolean): Promise<void> {
    const e = this.event();
    if (!e) return;
    this.storeBusy.set(true);
    try {
      this.event.set(await this.api.updateEvent(e.id, { storeEnabled: enabled }));
      this.toast.success(enabled ? $localize`Store open` : $localize`Store closed`);
    } catch (err) {
      this.toast.error(err);
      this.storeRev.update((n) => n + 1);
    } finally {
      this.storeBusy.set(false);
    }
  }

  protected async addDefaults(): Promise<void> {
    this.busy.set(true);
    try {
      const added = await this.api.addDefaultPerks(this.eventId());
      this.toast.success(added.length ? $localize`${added.length}:length: default perks added` : $localize`All default perks are already in the store`, added.length ? $localize`Review prices and limits before the game.` : undefined);
      await this.load(true);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggleEnabled(p: Perk, enabled: boolean): Promise<void> {
    this.perks.update((list) => (list ?? []).map((x) => (x.id === p.id ? { ...x, enabled } : x)));
    try {
      const updated = await this.api.updatePerk(this.eventId(), p.id, { enabled });
      this.perks.update((list) => (list ?? []).map((x) => (x.id === p.id ? updated : x)));
    } catch (err) {
      this.toast.error(err);
      this.perks.update((list) => (list ?? []).map((x) => (x.id === p.id ? { ...p } : x)));
    }
  }

  // --- editor -----------------------------------------------------------------------

  private async confirmDiscard(): Promise<boolean> {
    if (!this.editing() || !this.form.dirty) return true;
    return this.confirm.ask({ title: $localize`Discard changes?`, consequences: [$localize`Your unsaved changes to this perk are lost.`], confirmLabel: $localize`Discard`, destructive: true });
  }

  protected async openNew(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.resetForm({
      name: '',
      description: '',
      icon: 'lucideZap',
      type: 'custom',
      price: 100,
      durationSec: 0,
      cooldownSec: 0,
      totalQuantity: 0,
      perTeamLimit: 0,
      eligible: 'any',
      eligibleRoles: [],
      requiresApproval: false,
      activation: 'immediate',
      target: 'none',
      enabled: true,
      config: {},
    });
    this.editingId.set(null);
    this.editing.set(true);
    queueMicrotask(() => document.getElementById('pk-type')?.focus());
  }

  protected async openEdit(p: Perk): Promise<void> {
    if (this.editingId() !== p.id && !(await this.confirmDiscard())) return;
    this.resetForm(p);
    this.editingId.set(p.id);
    this.editing.set(true);
    queueMicrotask(() => document.getElementById('pk-name')?.focus());
  }

  protected async closeEditor(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.editing.set(false);
    this.editingId.set(null);
    this.form.markAsPristine();
  }

  private resetForm(p: Omit<PerkInput, 'config'> & { config: PerkConfig }): void {
    this.form.reset({
      name: p.name ?? '',
      description: p.description ?? '',
      icon: p.icon || 'lucideZap',
      type: p.type ?? 'custom',
      price: p.price ?? 0,
      durationSec: p.durationSec ?? 0,
      cooldownSec: p.cooldownSec ?? 0,
      totalQuantity: p.totalQuantity ?? 0,
      perTeamLimit: p.perTeamLimit ?? 0,
      eligible: p.eligible ?? 'any',
      eligibleRoles: p.eligibleRoles ?? [],
      requiresApproval: p.requiresApproval ?? false,
      activation: p.activation ?? 'immediate',
      target: p.target ?? 'none',
      enabled: p.enabled ?? true,
      uav: { ...DEFAULT_CONFIG.uav, ...(p.config.uav ?? {}) },
      recon: { ...DEFAULT_CONFIG.recon, ...(p.config.recon ?? {}) },
      theft: { ...DEFAULT_CONFIG.theft, ...(p.config.theft ?? {}) },
      doublePoints: { ...DEFAULT_CONFIG.doublePoints, ...(p.config.doublePoints ?? {}) },
    });
    this.syncConfigGroups();
    this.saveState.set('idle');
    this.saveError.set(null);
  }

  /** Only the config group for the current type is validated and sent. */
  private syncConfigGroups(): void {
    const key = configKeyFor(this.form.controls.type.value);
    for (const k of CONFIG_KEYS) {
      const g = this.form.controls[k];
      if (k === key) g.enable({ emitEvent: false });
      else g.disable({ emitEvent: false });
    }
    this.form.updateValueAndValidity();
  }

  protected onTypeChange(): void {
    const type = this.form.controls.type.value;
    const preset = TYPE_TARGET[type] ?? 'none';
    this.form.controls.target.setValue(preset);
    const icon = this.form.controls.icon.value;
    if (icon === 'lucideZap' || PERK_ICONS.some((i) => i.name === icon && this.types.some((t) => perkIcon(t.value) === icon))) {
      this.form.controls.icon.setValue(perkIcon(type));
    }
    if (!this.form.controls.name.value.trim()) this.form.controls.name.setValue(PERK_TYPE_LABELS[type]);
    this.syncConfigGroups();
  }

  protected setIcon(name: string): void {
    this.form.controls.icon.setValue(name);
    this.form.controls.icon.markAsDirty();
  }

  protected hasRole(r: PlayerRole): boolean {
    return this.form.controls.eligibleRoles.value.includes(r);
  }

  protected toggleRole(r: PlayerRole): void {
    const c = this.form.controls.eligibleRoles;
    c.setValue(this.hasRole(r) ? c.value.filter((x) => x !== r) : [...c.value, r]);
    c.markAsDirty();
  }

  private toInput(): PerkInput {
    const v = this.form.getRawValue();
    const key = configKeyFor(v.type);
    const config: PerkConfig = {};
    if (key === 'uav') config.uav = { ...v.uav, refreshSec: Number(v.uav.refreshSec), delaySec: Number(v.uav.delaySec), areaRadiusM: Number(v.uav.areaRadiusM) };
    if (key === 'recon') config.recon = { ...v.recon, revealSec: Number(v.recon.revealSec) };
    if (key === 'theft') config.theft = { ...v.theft, amount: Number(v.theft.amount), protectionSec: Number(v.theft.protectionSec) };
    if (key === 'doublePoints') config.doublePoints = { multiplier: Number(v.doublePoints.multiplier) };
    return {
      name: v.name.trim(),
      description: v.description.trim(),
      icon: v.icon,
      type: v.type,
      price: Number(v.price),
      durationSec: Number(v.durationSec),
      cooldownSec: Number(v.cooldownSec),
      totalQuantity: Number(v.totalQuantity),
      perTeamLimit: Number(v.perTeamLimit),
      eligible: v.eligible,
      eligibleRoles: v.eligible === 'roles' ? v.eligibleRoles : [],
      requiresApproval: v.requiresApproval,
      activation: v.activation,
      target: v.target,
      enabled: v.enabled,
      config,
    };
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.saveState.set('failed');
      this.saveError.set($localize`Fix the highlighted fields.`);
      focusFirstInvalid(this.editorForm()?.nativeElement);
      return;
    }
    const id = this.editingId();
    this.saveState.set('saving');
    this.saveError.set(null);
    try {
      const body = this.toInput();
      const saved = id ? await this.api.updatePerk(this.eventId(), id, body) : await this.api.createPerk(this.eventId(), body);
      this.perks.update((list) => (id ? (list ?? []).map((x) => (x.id === id ? saved : x)) : [...(list ?? []), saved]));
      this.editingId.set(saved.id);
      this.form.markAsPristine();
      this.saveState.set('saved');
      this.toast.success(id ? $localize`${saved.name}:name: saved` : $localize`${saved.name}:name: created`);
    } catch (err) {
      const apiErr = ApiError.from(err);
      this.saveState.set('failed');
      this.saveError.set(apiErr.message);
      const unplaced = applyServerErrors(this.form, err, {}, 'config.');
      if (unplaced.length || !Object.keys(apiErr.fields).length) this.toast.error(err);
      focusFirstInvalid(this.editorForm()?.nativeElement);
    }
  }

  protected async remove(): Promise<void> {
    const id = this.editingId();
    const p = this.perks()?.find((x) => x.id === id);
    if (!p) return;
    const ok = await this.confirm.ask({
      title: $localize`Delete ${p.name}:name:?`,
      consequences: [
        $localize`It disappears from the store.`,
        $localize`If a team already bought it, it is disabled instead of deleted so the purchase history stays.`,
      ],
      destructive: true,
      confirmLabel: $localize`Delete perk`,
    });
    if (!ok) return;
    try {
      await this.api.deletePerk(this.eventId(), p.id);
      this.toast.success($localize`${p.name}:name: deleted`);
      this.form.markAsPristine();
      this.editing.set(false);
      this.editingId.set(null);
      await this.load(true);
    } catch (err) {
      this.toast.error(err);
    }
  }
}
