import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { AuthService } from '../core/auth/auth.service';
import { NotificationCenter } from '../core/notifications/notification-center.service';
import { initials } from '../core/util/format';
import { ConnectionStatus } from '../shared/link-status';

interface NavItem {
  label: string;
  icon: string;
  link: string;
  exact?: boolean;
}

/**
 * Main shell for everything outside a live game.
 * Phones: top bar + bottom navigation in thumb reach. ≥1024px: left rail.
 */
@Component({
  selector: 'zeus-app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgIcon, ConnectionStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-h-dvh lg:pl-60' },
  template: `
    <a href="#main" class="sr-only-focusable fixed left-2 top-2 z-50 rounded-sm bg-primary px-3 py-2 text-primary-foreground">Skip to content</a>

    <!-- Desktop rail -->
    <nav class="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex" aria-label="Main">
      <a routerLink="/home" class="flex items-center gap-2 px-5 py-5">
        <span class="grid size-8 place-items-center rounded-sm bg-primary font-mono text-sm font-bold text-primary-foreground" aria-hidden="true">AH</span>
        <span class="text-lg font-bold uppercase tracking-wider" style="font-stretch: 80%">AirsoftHub</span>
      </a>
      <ul class="flex flex-col gap-0.5 px-3">
        @for (item of items; track item.link) {
          <li>
            <a [routerLink]="item.link" routerLinkActive="!bg-sidebar-accent !text-foreground font-semibold" [routerLinkActiveOptions]="{ exact: !!item.exact }"
              class="flex h-11 items-center gap-3 rounded-sm px-3 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
              <ng-icon [name]="item.icon" size="18" aria-hidden="true" />
              {{ item.label }}
              @if (item.link === '/notifications' && notif.unread()) {
                <span class="num ml-auto rounded-sm bg-warning px-1.5 text-xs font-bold text-warning-foreground">{{ notif.unread() }}</span>
              }
            </a>
          </li>
        }
      </ul>
      <p class="label-caps mt-6 px-6">Game Master</p>
      <ul class="mt-1 flex flex-col gap-0.5 px-3">
        <li>
          <a routerLink="/gm/new" routerLinkActive="!bg-sidebar-accent !text-foreground font-semibold"
            class="flex h-11 items-center gap-3 rounded-sm px-3 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
            <ng-icon name="lucidePlus" size="18" aria-hidden="true" /> Create event
          </a>
        </li>
        <li>
          <a routerLink="/events/mine" [queryParams]="{ tab: 'gm' }"
            class="flex h-11 items-center gap-3 rounded-sm px-3 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
            <ng-icon name="lucideLayoutDashboard" size="18" aria-hidden="true" /> Events I run
          </a>
        </li>
      </ul>
      @if (user()?.isAdmin) {
        <p class="label-caps mt-6 px-6">Platform</p>
        <ul class="mt-1 flex flex-col gap-0.5 px-3">
          <li>
            <a routerLink="/admin" routerLinkActive="!bg-sidebar-accent !text-foreground font-semibold"
              class="flex h-11 items-center gap-3 rounded-sm px-3 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
              <ng-icon name="lucideShield" size="18" aria-hidden="true" /> Admin
            </a>
          </li>
        </ul>
      }
      <div class="mt-auto border-t border-sidebar-border p-3">
        <a routerLink="/profile" class="flex items-center gap-3 rounded-sm p-2 hover:bg-sidebar-accent">
          @if (user()?.avatarUrl) {
            <img [src]="user()!.avatarUrl" alt="" class="size-9 rounded-full object-cover" />
          } @else {
            <span class="grid size-9 place-items-center rounded-full bg-muted text-sm font-bold" aria-hidden="true">{{ userInitials() }}</span>
          }
          <span class="min-w-0">
            <span class="block truncate text-sm font-semibold">{{ user()?.nickname }}</span>
            <zeus-connection-status [showSync]="false" />
          </span>
        </a>
      </div>
    </nav>

    <!-- Phone top bar -->
    <header class="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur lg:hidden" style="padding-top: var(--safe-top)">
      <a routerLink="/home" class="flex items-center gap-2" aria-label="AirsoftHub home">
        <span class="grid size-7 place-items-center rounded-sm bg-primary font-mono text-xs font-bold text-primary-foreground" aria-hidden="true">AH</span>
        <span class="text-base font-bold uppercase tracking-wider" style="font-stretch: 80%">AirsoftHub</span>
      </a>
      <span class="ml-auto"><zeus-connection-status [compact]="true" [showSync]="false" /></span>
      <a routerLink="/settings" class="tap grid place-items-center" aria-label="Settings">
        <ng-icon name="lucideSettings" size="20" aria-hidden="true" />
      </a>
    </header>

    <main id="main" class="min-h-[calc(100dvh-3.5rem)] lg:min-h-dvh">
      <router-outlet />
    </main>

    <!-- Phone bottom nav -->
    <nav class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/97 backdrop-blur lg:hidden" aria-label="Main" style="padding-bottom: var(--safe-bottom)">
      <ul class="grid grid-cols-5">
        @for (item of items; track item.link) {
          <li>
            <a [routerLink]="item.link" routerLinkActive="!text-primary" [routerLinkActiveOptions]="{ exact: !!item.exact }" #rla="routerLinkActive"
              [attr.aria-current]="rla.isActive ? 'page' : null"
              class="relative flex h-16 flex-col items-center justify-center gap-1 text-[0.7rem] font-semibold text-muted-foreground">
              <ng-icon [name]="item.icon" size="22" aria-hidden="true" />
              {{ item.short ?? item.label }}
              @if (item.link === '/notifications' && notif.unread()) {
                <span class="num absolute right-[22%] top-2 min-w-4 rounded-sm bg-warning px-1 text-center text-[0.65rem] font-bold text-warning-foreground">{{ notif.unread() > 99 ? '99+' : notif.unread() }}</span>
              }
            </a>
          </li>
        }
      </ul>
    </nav>
  `,
})
export class AppShell {
  private readonly auth = inject(AuthService);
  protected readonly notif = inject(NotificationCenter);
  protected readonly user = this.auth.user;
  protected readonly userInitials = computed(() => initials(this.user()?.nickname));

  protected readonly items: (NavItem & { short?: string })[] = [
    { label: 'Home', icon: 'lucideHouse', link: '/home', exact: true },
    { label: 'Discover events', short: 'Discover', icon: 'lucideSearch', link: '/events/discover' },
    { label: 'My events', short: 'My events', icon: 'lucideCalendarDays', link: '/events/mine' },
    { label: 'Notifications', short: 'Alerts', icon: 'lucideBell', link: '/notifications' },
    { label: 'Profile', icon: 'lucideUser', link: '/profile' },
  ];
}
