import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { GeofenceStatus, Objective } from '../../core/api/models';
import { LiveStore } from '../../core/live/live-store';
import { LocationTracker } from '../../core/location/location-tracker.service';
import { ObjectiveCard } from '../../shared/cards';
import { nowSignal } from '../../shared/game-timer';
import { EmptyState } from '../../shared/states';
import { distanceFrom, liveLink } from './live-util';

interface Group {
  key: string;
  label: string;
  hint: string | null;
  items: { o: Objective; distance: number | null; note: string | null; capture: GeofenceStatus | null }[];
}

/** Objectives grouped by state, nearest first. */
@Component({
  selector: 'zeus-objective-list',
  imports: [ObjectiveCard, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto flex max-w-3xl flex-col gap-5 px-4 pt-4 pb-8">
      <div>
        <h2 class="text-2xl uppercase">Objectives</h2>
        <p class="text-sm text-muted-foreground">
          @if (hasFix()) {
            Nearest first, measured from your position.
          } @else {
            Waiting for GPS — shown in game order.
          }
        </p>
      </div>

      @if (!store.objectives().length) {
        <zeus-empty-state
          icon="lucideCrosshair"
          title="No objectives visible yet"
          message="The Game Master reveals objectives as the game goes on. They appear here and on the map."
        />
      } @else {
        @for (g of groups(); track g.key) {
          <section [attr.aria-labelledby]="'grp-' + g.key" class="flex flex-col gap-2">
            <h3 [id]="'grp-' + g.key" class="label-caps">
              {{ g.label }} · <span class="num">{{ g.items.length }}</span>
            </h3>
            @if (g.hint) {
              <p class="-mt-1 text-xs text-muted-foreground">{{ g.hint }}</p>
            }
            <ul class="flex flex-col gap-2">
              @for (it of g.items; track it.o.id) {
                <li>
                  <zeus-objective-card
                    [objective]="it.o"
                    [distanceM]="it.distance"
                    [teams]="store.teams()"
                    [now]="serverNow()"
                    [capture]="it.capture"
                    (open)="open($event)"
                    (navigate)="showOnMap($event)"
                  />
                  @if (it.note) {
                    <p class="mt-1 px-1 text-xs text-muted-foreground">{{ it.note }}</p>
                  }
                </li>
              }
            </ul>
          </section>
        }
      }
    </div>
  `,
})
export class ObjectiveListScreen {
  protected readonly store = inject(LiveStore);
  private readonly tracker = inject(LocationTracker);
  private readonly router = inject(Router);

  private readonly tick = nowSignal();
  protected readonly serverNow = computed(() => this.tick() + this.store.serverOffsetMs());
  protected readonly hasFix = computed(() => !!this.tracker.lastFix());

  protected readonly groups = computed<Group[]>(() => {
    const fix = this.tracker.lastFix();
    const geo = new Map(this.tracker.geofence().map((g) => [g.objectiveId, g]));
    const byId = this.store.objectiveById();
    const buckets: Record<string, Group> = {
      progress: { key: 'progress', label: 'Active', hint: 'Contested or being captured right now', items: [] },
      available: { key: 'available', label: 'Available', hint: null, items: [] },
      captured: { key: 'captured', label: 'Captured', hint: null, items: [] },
      locked: { key: 'locked', label: 'Locked', hint: 'Not open yet', items: [] },
      completed: { key: 'completed', label: 'Completed', hint: null, items: [] },
      disabled: { key: 'disabled', label: 'Disabled', hint: null, items: [] },
    };

    for (const o of this.store.objectives()) {
      const g = geo.get(o.id);
      const inProgress = o.status === 'contested' || o.contested || (!!g && !g.captured && (g.inside || g.progressSec > 0));
      let key: string;
      if (o.status === 'disabled') key = 'disabled';
      else if (o.status === 'completed') key = 'completed';
      else if (inProgress) key = 'progress';
      else if (o.status === 'active') key = 'available';
      else if (o.status === 'captured') key = 'captured';
      else key = 'locked'; // locked + inactive
      let note: string | null = null;
      if (o.status === 'locked' && o.prerequisiteIds.length) {
        const names = o.prerequisiteIds.map((id) => byId.get(id)?.name).filter((n): n is string => !!n);
        note = names.length ? `Opens after: ${names.join(', ')}` : 'Opens after other objectives are captured';
      } else if (o.status === 'inactive' && !o.availabilityStart) {
        note = 'Opens when the Game Master activates it';
      }
      buckets[key].items.push({ o, distance: distanceFrom(fix, o), note, capture: g ?? null });
    }

    const order = ['available', 'progress', 'captured', 'locked', 'completed', 'disabled'];
    return order
      .map((k) => buckets[k])
      .filter((g) => g.items.length)
      .map((g) => ({
        ...g,
        items: g.items.sort((a, b) => {
          if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
          if (a.distance !== null) return -1;
          if (b.distance !== null) return 1;
          return a.o.sortOrder - b.o.sortOrder;
        }),
      }));
  });

  protected open(o: Objective): void {
    void this.router.navigate(liveLink(this.store.eventId(), 'objectives', o.id));
  }

  protected showOnMap(o: Objective): void {
    void this.router.navigate(liveLink(this.store.eventId()), { queryParams: { focus: o.id } });
  }
}
