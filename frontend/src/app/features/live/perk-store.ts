import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { ApiError } from '../../core/api/api-error';
import { Perk, PerkPurchase } from '../../core/api/models';
import { LiveStore } from '../../core/live/live-store';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { formatDuration, formatNumber, formatTime } from '../../core/util/format';
import { newClientTxId } from '../../core/util/ids';
import { PerkCard, perkIcon } from '../../shared/cards';
import { CurrencyDisplay } from '../../shared/currency-display';
import { nowSignal } from '../../shared/game-timer';
import { EmptyState } from '../../shared/states';
import { StatusChip, purchaseStatusChip } from '../../shared/status-chip';
import { TeamSwatch } from '../../shared/team-swatch';
import { LiveSheet } from './live-sheet';
import { remaining } from './live-util';

/** One purchase the player decided to make; the clientTxId is reused on retry. */
interface BuyIntent {
  perk: Perk;
  targetTeamId: string | null;
  targetObjectiveId: string | null;
  txId: string;
}

/** Team store: balance, perks, buy flow with targets, purchase history. */
@Component({
  selector: 'ah-perk-store',
  imports: [NgIcon, HlmButton, PerkCard, CurrencyDisplay, EmptyState, StatusChip, TeamSwatch, LiveSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto flex max-w-5xl flex-col gap-5 px-4 pt-4 pb-8">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-2xl uppercase" i18n>Store</h2>
          <p class="text-sm text-muted-foreground" i18n>Perks are paid with your team's credits.</p>
        </div>
        @if (store.myTeam(); as team) {
          <div class="panel flex items-center gap-3 px-4 py-2">
            <ah-team-swatch [color]="team.color" [pattern]="team.pattern" [size]="18" />
            <ah-currency-display [amount]="team.currency" label="Balance" size="lg" i18n-label />
          </div>
        }
      </header>

      @if (!storeEnabled()) {
        <ah-empty-state icon="lucideStore" title="The store is closed" message="The Game Master has not opened the perk store for this event." i18n-title i18n-message />
      } @else {
        @if (!store.myTeam()) {
          <p class="panel border-warning/60 p-3 text-sm font-semibold" role="status" i18n>○ Join a team to buy perks.</p>
        } @else if (!isLive()) {
          <p class="panel border-warning/60 p-3 text-sm font-semibold" role="status">
            {{ status() === 'paused' ? txt.theGameIsPaused : txt.perksCanBeBought }}
          </p>
        }

        <!-- Unconfirmed purchase -->
        @if (failed(); as err) {
          @if (intent(); as it) {
            <div class="rounded-md border-2 border-destructive bg-destructive/10 p-4" role="alert">
              <p class="font-bold text-destructive" i18n>Purchase of {{ it.perk.name }} not confirmed</p>
              <p class="mt-1 text-sm" i18n>{{ err.message }} Trying again will not charge twice.</p>
              <div class="mt-3 flex gap-2">
                <button hlmBtn type="button" class="h-12 flex-1" (click)="submit()" [disabled]="buying()">
                  <ng-icon name="lucideRefreshCw" size="18" aria-hidden="true" /> {{ buying() ? txt.checking : txt.tryAgain }}
                </button>
                <button hlmBtn variant="outline" type="button" class="h-12" (click)="cancelIntent()" [disabled]="buying()" i18n>Cancel</button>
              </div>
            </div>
          }
        }
        @if (buying() && !failed()) {
          <p class="panel flex items-center gap-2 border-warning/60 p-3 text-sm font-semibold" role="status">
            <ng-icon name="lucideLoader2" size="16" class="animate-spin" aria-hidden="true" /> <ng-container i18n>Buying {{ intent()?.perk?.name }} — waiting for the server…</ng-container>
          </p>
        }

        <section class="flex flex-col gap-2" aria-labelledby="perks-title">
          <h3 id="perks-title" class="label-caps" i18n>Perks · <span class="num">{{ perks().length }}</span></h3>
          @if (!perks().length) {
            <ah-empty-state icon="lucideStore" title="No perks for sale" message="The Game Master has not added any perks to the store." i18n-title i18n-message />
          } @else {
            <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              @for (p of perks(); track p.id) {
                <li><ah-perk-card class="h-full" [perk]="p" (buy)="startBuy($event)" /></li>
              }
            </ul>
          }
        </section>
      }

      <!-- History -->
      <section class="flex flex-col gap-2" aria-labelledby="history-title">
        <h3 id="history-title" class="label-caps" i18n>Purchases · <span class="num">{{ purchases().length }}</span></h3>
        @if (!purchases().length) {
          <p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground" i18n>Your team has not bought anything yet.</p>
        } @else {
          <ul class="panel flex flex-col divide-y divide-border">
            @for (pu of purchases(); track pu.id) {
              <li class="flex flex-col gap-2 p-3">
                <div class="flex items-start gap-3">
                  <span class="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-primary" aria-hidden="true">
                    <ng-icon [name]="icon(pu)" size="20" />
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="font-bold uppercase">{{ pu.perkName }}</span>
                      <ah-status-chip [spec]="chip(pu)" />
                    </div>
                    <p class="text-xs text-muted-foreground">
                      <ng-container i18n><span class="num">{{ time(pu.createdAt) }}</span>
                      · {{ pu.buyerNickname || txt.gameMaster }} · <span class="num">{{ fmt(pu.price) }}</span> cr</ng-container>
                      @if (pu.refunded) {
                        <ng-container i18n>· refunded</ng-container>
                      }
                    </p>
                    @if (targetLabel(pu); as tl) {
                      <p class="text-xs" i18n>Target: <span class="font-semibold">{{ tl }}</span></p>
                    }
                    @if (pu.reason && (pu.status === 'rejected' || pu.status === 'cancelled')) {
                      <p class="text-xs text-destructive">{{ pu.reason }}</p>
                    }
                  </div>
                  @if (pu.status === 'active' && expiresIn(pu); as left) {
                    <span class="flex shrink-0 flex-col items-end">
                      <span class="num text-lg font-bold text-warning">{{ left }}</span>
                      <span class="label-caps" i18n>left</span>
                    </span>
                  }
                </div>
                @if (pu.status === 'ready' && canActivate(pu)) {
                  <button hlmBtn type="button" class="h-12" (click)="activate(pu)" [disabled]="activating() === pu.id || !isLive()">
                    <ng-icon name="lucidePlay" size="18" aria-hidden="true" />
                    {{ activating() === pu.id ? txt.activating : txt.activateNow }}
                  </button>
                } @else if (pu.status === 'ready') {
                  <p class="text-xs text-muted-foreground" i18n>The buyer or a squad leader can activate it.</p>
                }
              </li>
            }
          </ul>
        }
      </section>
    </div>

    <!-- Target picker -->
    <ah-live-sheet [open]="pickerOpen()" [heading]="pickerTitle()" eyebrow="Choose target" (closed)="cancelIntent()" i18n-eyebrow>
      @if (intent(); as it) {
        <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); confirmTarget()">
          @if (it.perk.target === 'enemy_team' || it.perk.type === 'jammer') {
            <fieldset class="flex flex-col gap-2">
              <legend class="label-caps mb-1">{{ it.perk.target === 'enemy_team' ? txt.enemyTeam : txt.jamItForOptional }}</legend>
              @if (it.perk.target === 'objective') {
                <label class="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border px-3 has-checked:border-primary has-checked:bg-primary/10">
                  <input type="radio" name="team" class="size-5 accent-primary" [checked]="!pickTeam()" (change)="pickTeam.set(null)" />
                  <span class="font-semibold" i18n>All enemy teams</span>
                </label>
              }
              @for (t of enemyTeams(); track t.id) {
                <label class="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border px-3 has-checked:border-primary has-checked:bg-primary/10">
                  <input type="radio" name="team" class="size-5 accent-primary" [checked]="pickTeam() === t.id" (change)="pickTeam.set(t.id)" />
                  <ah-team-swatch [color]="t.color" [pattern]="t.pattern" [size]="16" />
                  <span class="font-semibold">{{ t.name }}</span>
                  <span class="num ml-auto text-sm text-muted-foreground" i18n>{{ t.points }} pts</span>
                </label>
              } @empty {
                <p class="text-sm text-muted-foreground" i18n>There are no enemy teams.</p>
              }
            </fieldset>
          }
          @if (it.perk.target === 'objective') {
            <fieldset class="flex flex-col gap-2">
              <legend class="label-caps mb-1" i18n>Objective</legend>
              @for (o of targetObjectives(); track o.id) {
                <label class="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border px-3 has-checked:border-primary has-checked:bg-primary/10">
                  <input type="radio" name="objective" class="size-5 accent-primary" [checked]="pickObjective() === o.id" (change)="pickObjective.set(o.id)" />
                  <span class="min-w-0 flex-1 truncate font-semibold uppercase">{{ o.name }}</span>
                  @if (o.ownerTeamId) {
                    <span class="text-xs text-muted-foreground" i18n>held by {{ teamName(o.ownerTeamId) }}</span>
                  }
                </label>
              } @empty {
                <p class="text-sm text-muted-foreground" i18n>No objectives can be targeted right now.</p>
              }
            </fieldset>
          }
          <div class="flex flex-col gap-2">
            <button hlmBtn type="submit" class="h-12" [disabled]="!targetValid()" i18n>Continue</button>
            <button hlmBtn variant="outline" type="button" class="h-12" (click)="cancelIntent()" i18n>Cancel</button>
          </div>
        </form>
      }
    </ah-live-sheet>
  `,
})
export class PerkStoreScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    theGameIsPaused: $localize`❚❚ The game is paused — purchases resume when it restarts.`,
    perksCanBeBought: $localize`◌ Perks can be bought while the game is running.`,
    checking: $localize`Checking…`,
    tryAgain: $localize`Try again`,
    gameMaster: $localize`Game Master`,
    activating: $localize`Activating…`,
    activateNow: $localize`Activate now`,
    enemyTeam: $localize`Enemy team`,
    jamItForOptional: $localize`Jam it for (optional)`,
  };

  protected readonly store = inject(LiveStore);
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  private readonly tick = nowSignal();
  private readonly serverNow = computed(() => this.tick() + this.store.serverOffsetMs());
  protected readonly fmt = formatNumber;

  protected readonly intent = signal<BuyIntent | null>(null);
  protected readonly pickerOpen = signal(false);
  protected readonly pickTeam = signal<string | null>(null);
  protected readonly pickObjective = signal<string | null>(null);
  protected readonly buying = signal(false);
  protected readonly failed = signal<ApiError | null>(null);
  protected readonly activating = signal<string | null>(null);

  protected readonly status = computed(() => this.store.clock()?.status ?? this.store.event()?.status);
  protected readonly isLive = computed(() => this.status() === 'live');
  protected readonly storeEnabled = computed(() => this.store.event()?.storeEnabled ?? false);
  protected readonly perks = computed(() => [...this.store.perks()].filter((p) => p.enabled).sort((a, b) => a.sortOrder - b.sortOrder));

  protected readonly purchases = computed(() => {
    const teamId = this.store.myTeam()?.id;
    return [...this.store.purchases()]
      .filter((p) => !teamId || p.teamId === teamId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  protected readonly enemyTeams = computed(() => {
    const mine = this.store.myTeam();
    return this.store.teams().filter((t) => t.id !== mine?.id && (!mine?.allianceId || t.allianceId !== mine.allianceId));
  });

  protected readonly targetObjectives = computed(() =>
    this.store
      .objectives()
      .filter((o) => o.status !== 'disabled' && o.status !== 'completed')
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  protected readonly pickerTitle = computed(() => this.intent()?.perk.name ?? $localize`Choose target`);

  protected readonly targetValid = computed(() => {
    const it = this.intent();
    if (!it) return false;
    if (it.perk.target === 'enemy_team') return !!this.pickTeam();
    if (it.perk.target === 'objective') return !!this.pickObjective();
    return true;
  });

  protected startBuy(perk: Perk): void {
    if (this.buying()) return;
    this.failed.set(null);
    this.intent.set({ perk, targetTeamId: null, targetObjectiveId: null, txId: newClientTxId() });
    if (perk.target === 'none') {
      void this.confirmAndBuy();
      return;
    }
    this.pickTeam.set(perk.target === 'enemy_team' && this.enemyTeams().length === 1 ? this.enemyTeams()[0].id : null);
    this.pickObjective.set(null);
    this.pickerOpen.set(true);
  }

  protected confirmTarget(): void {
    const it = this.intent();
    if (!it || !this.targetValid()) return;
    this.intent.set({ ...it, targetTeamId: this.pickTeam(), targetObjectiveId: it.perk.target === 'objective' ? this.pickObjective() : null });
    this.pickerOpen.set(false);
    void this.confirmAndBuy();
  }

  protected cancelIntent(): void {
    if (this.buying()) return;
    this.pickerOpen.set(false);
    this.intent.set(null);
    this.failed.set(null);
  }

  private async confirmAndBuy(): Promise<void> {
    const it = this.intent();
    if (!it) return;
    const team = this.store.myTeam();
    const p = it.perk;
    const consequences: string[] = [];
    const teamName = team?.name ?? $localize`your team`;
    if (team?.currency !== null && team?.currency !== undefined) {
      consequences.push(
        $localize`Spends ${formatNumber(p.price)}:price: credits from ${teamName}:teamName: (balance ${formatNumber(team.currency)}:currency: → ${formatNumber(team.currency - p.price)}:currency2:)`,
      );
    } else {
      consequences.push($localize`Spends ${formatNumber(p.price)}:price: credits from ${teamName}:teamName:`);
    }
    if (it.targetTeamId) consequences.push($localize`Targets ${this.teamName(it.targetTeamId)}:teamName:`);
    else if (p.target === 'objective' && p.type === 'jammer') consequences.push($localize`Affects all enemy teams`);
    if (it.targetObjectiveId) consequences.push($localize`On objective ${this.store.objectiveById().get(it.targetObjectiveId)?.name ?? ''}:name:`);
    consequences.push(p.durationSec ? $localize`Lasts ${formatDuration(p.durationSec * 1000)}:duration: once active` : $localize`Takes effect once, no duration`);
    if (p.activation === 'manual') consequences.push($localize`Starts only when someone taps “Activate now”`);
    if (p.requiresApproval) consequences.push($localize`Needs Game Master approval before it can be used`);
    if (p.cooldownSec) consequences.push($localize`Cannot be bought again for ${formatDuration(p.cooldownSec * 1000)}:duration:`);

    const ok = await this.confirm.ask({
      title: $localize`Buy ${p.name}:name:?`,
      message: p.description || undefined,
      consequences,
      confirmLabel: $localize`Buy for ${formatNumber(p.price)}:price: credits`,
    });
    if (!ok) {
      this.intent.set(null);
      return;
    }
    await this.submit();
  }

  /** Sends the current intent. Retries reuse its clientTxId. */
  protected async submit(): Promise<void> {
    const it = this.intent();
    const eventId = this.store.eventId();
    if (!it || !eventId || this.buying()) return;
    this.buying.set(true);
    this.failed.set(null);
    try {
      const res = await this.api.purchasePerk(eventId, it.perk.id, {
        targetTeamId: it.targetTeamId,
        targetObjectiveId: it.targetObjectiveId,
        clientTxId: it.txId,
      });
      this.intent.set(null);
      this.announce(res);
      this.store.refresh('perks', 'purchases', 'effects');
    } catch (e) {
      const err = ApiError.from(e);
      if (err.isNetwork || err.status >= 500 || err.status < 0) {
        this.failed.set(err); // keep the intent: "Try again" reuses the clientTxId
      } else {
        this.intent.set(null);
        this.toast.error(err);
        this.store.refresh('perks', 'purchases');
      }
    } finally {
      this.buying.set(false);
    }
  }

  private announce(p: PerkPurchase): void {
    switch (p.status) {
      case 'pending_approval':
        this.toast.info($localize`${p.perkName}:perkName: requested`, $localize`Waiting for the Game Master to approve it.`);
        break;
      case 'ready':
        this.toast.success($localize`${p.perkName}:perkName: bought`, $localize`Activate it from Purchases when you need it.`);
        break;
      case 'active':
        this.toast.success($localize`${p.perkName}:perkName: is active`, p.expiresAt ? $localize`Until ${formatTime(p.expiresAt)}:expiresAt:` : undefined);
        break;
      case 'completed':
        this.toast.success($localize`${p.perkName}:perkName: used`);
        break;
      default:
        this.toast.info(`${p.perkName}: ${purchaseStatusChip(p.status).label}`);
    }
  }

  protected canActivate(p: PerkPurchase): boolean {
    const me = this.store.me();
    return !!me && (p.buyerId === me.userId || me.isSquadLeader);
  }

  protected async activate(p: PerkPurchase): Promise<void> {
    const eventId = this.store.eventId();
    if (!eventId || this.activating()) return;
    const perk = this.store.perks().find((x) => x.id === p.perkId);
    const ok = await this.confirm.ask({
      title: $localize`Activate ${p.perkName}:perkName: now?`,
      consequences: [
        perk?.durationSec ? $localize`Runs for ${formatDuration(perk.durationSec * 1000)}:duration: from now` : $localize`Takes effect immediately`,
        ...(this.targetLabel(p) ? [$localize`Target: ${this.targetLabel(p)}:targetLabel:`] : []),
        $localize`Cannot be paused or undone`,
      ],
      confirmLabel: $localize`Activate now`,
    });
    if (!ok) return;
    this.activating.set(p.id);
    try {
      const res = await this.api.activatePurchase(eventId, p.id);
      this.announce(res);
      this.store.refresh('purchases', 'effects');
    } catch (e) {
      this.toast.error(e);
      this.store.refresh('purchases');
    } finally {
      this.activating.set(null);
    }
  }

  protected chip(p: PerkPurchase) {
    return purchaseStatusChip(p.status);
  }
  protected icon(p: PerkPurchase): string {
    return perkIcon(p.perkType);
  }
  protected time(iso: string): string {
    return formatTime(iso);
  }
  protected expiresIn(p: PerkPurchase): string | null {
    return remaining(p.expiresAt, this.serverNow());
  }
  protected teamName(id: string): string {
    return this.store.teamById().get(id)?.name ?? $localize`Unknown team`;
  }
  protected targetLabel(p: PerkPurchase): string | null {
    const parts: string[] = [];
    if (p.targetTeamId) parts.push(this.teamName(p.targetTeamId));
    if (p.targetObjectiveId) parts.push(this.store.objectiveById().get(p.targetObjectiveId)?.name ?? $localize`objective`);
    return parts.length ? parts.join(' · ') : null;
  }
}
