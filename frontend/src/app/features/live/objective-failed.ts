import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { LiveStore } from '../../core/live/live-store';
import { formatClock } from '../../core/util/format';
import { nowSignal } from '../../shared/game-timer';
import { TeamBadge } from '../../shared/team-badge';
import { liveLink } from './live-util';

interface Failure {
  key: string;
  objectiveId: string;
  objectiveName: string;
  teamId: string;
  limit: string;
}

const seenKey = (eventId: string) => `airsofthub.failedTimers.${eventId}`;

/**
 * "Objective failed" popup: shown once per timer run when a visible team timer (the own team's,
 * or every team's for a referee) passes its limit. Closing it only hides the popup: the timer keeps
 * running below zero until a referee or the Game Master stops it.
 */
@Component({
  selector: 'ah-objective-failed',
  imports: [NgIcon, HlmButton, TeamBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    dialog {
      margin: auto auto 0;
      width: 100%;
      max-width: 100%;
      border-radius: var(--radius) var(--radius) 0 0;
      padding-bottom: calc(1.25rem + var(--safe-bottom));
    }
    @media (min-width: 640px) {
      dialog {
        margin: auto;
        max-width: 26rem;
        border-radius: var(--radius);
        padding-bottom: 1.25rem;
      }
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.7);
    }
  `,
  template: `
    <dialog
      #dlg
      class="border-2 border-destructive bg-popover p-5 text-popover-foreground shadow-2xl"
      role="alertdialog"
      aria-labelledby="failed-title"
      aria-describedby="failed-text"
      (cancel)="$event.preventDefault(); dismiss()"
    >
      @if (current(); as f) {
        <div class="flex flex-col items-center gap-3 text-center">
          <span class="grid size-16 place-items-center rounded-full bg-destructive/15 text-destructive" aria-hidden="true">
            <ng-icon name="lucideX" size="36" />
          </span>
          <h2 id="failed-title" class="text-3xl text-destructive uppercase" i18n>Objective failed</h2>
          <p class="text-lg font-bold uppercase">{{ f.objectiveName }}</p>
          @if (teamOf(f.teamId); as t) {
            <ah-team-badge [team]="t" size="sm" />
          }
          <p id="failed-text" class="text-sm text-muted-foreground" i18n>
            The <span class="num font-semibold">{{ f.limit }}</span> allowed are over. The timer keeps counting below zero until a referee or the Game Master stops it.
          </p>
        </div>
        <div class="mt-5 grid grid-cols-2 gap-2">
          <button hlmBtn type="button" variant="outline" class="h-12" (click)="dismiss()" i18n>Close</button>
          <button hlmBtn type="button" class="h-12 font-bold" (click)="open(f)">
            <ng-icon name="lucideTimer" size="18" aria-hidden="true" /> <ng-container i18n>See timer</ng-container>
          </button>
        </div>
      }
    </dialog>
  `,
})
export class ObjectiveFailedPopup {
  private readonly store = inject(LiveStore);
  private readonly router = inject(Router);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private readonly tick = nowSignal();

  /** Timer runs already shown (this device), so a reload does not show them again. */
  private readonly seen = signal<ReadonlySet<string>>(new Set());

  private readonly failures = computed<Failure[]>(() => {
    const now = this.tick() + this.store.serverOffsetMs();
    const out: Failure[] = [];
    for (const o of this.store.objectives()) {
      if (!o.timerSec) continue;
      for (const t of o.timers) {
        if (t.state === 'stopped') continue;
        const elapsed = t.elapsedMs + (t.ticking ? Math.max(0, now - Date.parse(t.at)) : 0);
        if (elapsed <= o.timerSec * 1000) continue;
        out.push({ key: `${o.id}:${t.teamId}:${t.startedAt}`, objectiveId: o.id, objectiveName: o.name, teamId: t.teamId, limit: formatClock(o.timerSec * 1000) });
      }
    }
    return out;
  });

  protected readonly current = computed(() => this.failures().find((f) => !this.seen().has(f.key)) ?? null);

  constructor() {
    effect(() => {
      const eventId = this.store.eventId();
      untracked(() => this.seen.set(new Set(eventId ? this.load(eventId) : [])));
    });
    let shown: string | null = null;
    effect(() => {
      const f = this.current();
      const dlg = this.dialog().nativeElement;
      if (f && f.key !== shown) {
        shown = f.key;
        if (!dlg.open) dlg.showModal();
        try {
          navigator.vibrate?.([400, 150, 400]);
        } catch {
          /* not supported */
        }
      } else if (!f && dlg.open) {
        shown = null;
        dlg.close();
      }
    });
  }

  protected teamOf(id: string) {
    return this.store.teamById().get(id) ?? null;
  }

  protected dismiss(): void {
    const f = this.current();
    if (!f) return;
    const next = new Set(this.seen()).add(f.key);
    this.seen.set(next);
    const eventId = this.store.eventId();
    if (eventId) this.save(eventId, next);
  }

  protected open(f: Failure): void {
    this.dismiss();
    void this.router.navigate(liveLink(this.store.eventId(), 'objectives', f.objectiveId));
  }

  private load(eventId: string): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(seenKey(eventId)) ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private save(eventId: string, keys: ReadonlySet<string>): void {
    try {
      localStorage.setItem(seenKey(eventId), JSON.stringify([...keys].slice(-100)));
    } catch {
      /* storage unavailable: the popup may show again after a reload */
    }
  }
}
