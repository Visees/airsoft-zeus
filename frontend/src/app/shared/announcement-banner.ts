import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { Announcement } from '../core/api/models';
import { formatRelative } from '../core/util/format';

/** GM announcement banner. Emergency = red with siren; high = amber; normal = neutral. */
@Component({
  selector: 'zeus-announcement-banner',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (announcement(); as a) {
      <div
        [attr.role]="a.priority === 'emergency' ? 'alert' : 'status'"
        class="flex items-start gap-3 rounded-md border p-3 shadow-lg"
        [class]="toneClass()"
      >
        <ng-icon [name]="a.priority === 'emergency' ? 'lucideSiren' : 'lucideMegaphone'" size="20" class="mt-0.5 shrink-0" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="label-caps !text-current opacity-80">
            {{ a.priority === 'emergency' ? txt.emergency : a.scope === 'team' ? txt.teamMessage : a.scope === 'player' ? txt.messageToYou : txt.announcement }}
            · {{ when() }}
          </p>
          <p class="font-bold">{{ a.title }}</p>
          @if (a.body) {
            <p class="mt-0.5 text-sm whitespace-pre-line">{{ a.body }}</p>
          }
        </div>
        @if (dismissible()) {
          <button type="button" class="tap -m-2 grid place-items-center rounded-sm" (click)="dismiss.emit()" aria-label="Dismiss announcement" i18n-aria-label>
            <ng-icon name="lucideX" size="18" aria-hidden="true" />
          </button>
        }
      </div>
    }
  `,
})
export class AnnouncementBanner {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    emergency: $localize`Emergency`,
    teamMessage: $localize`Team message`,
    messageToYou: $localize`Message to you`,
    announcement: $localize`Announcement`,
  };

  readonly announcement = input<Announcement | null>(null);
  readonly dismissible = input(true);
  readonly dismiss = output<void>();

  protected readonly when = computed(() => formatRelative(this.announcement()?.createdAt));
  protected readonly toneClass = computed(() => {
    switch (this.announcement()?.priority) {
      case 'emergency':
        return 'flex items-start gap-3 rounded-md border p-3 shadow-lg border-destructive bg-destructive text-destructive-foreground';
      case 'high':
        return 'flex items-start gap-3 rounded-md border p-3 shadow-lg border-warning bg-warning-surface text-foreground';
      default:
        return 'flex items-start gap-3 rounded-md border p-3 shadow-lg border-border bg-popover text-popover-foreground';
    }
  });
}
