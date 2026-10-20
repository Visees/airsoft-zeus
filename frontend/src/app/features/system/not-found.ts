import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { AuthService } from '../../core/auth/auth.service';
import { AuthLayout } from '../auth/auth-layout';

@Component({
  selector: 'zeus-not-found-screen',
  imports: [AuthLayout, RouterLink, NgIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <zeus-auth-layout>
      <div class="flex flex-col items-start gap-3">
        <p class="num text-5xl font-bold text-muted-foreground" aria-hidden="true">404</p>
        <h1 class="text-3xl uppercase">Page not found</h1>
        <p class="text-muted-foreground">
          There is nothing at <span class="num break-all text-foreground">{{ path }}</span>. The link may be old, or the event or page was removed.
        </p>
        <nav class="mt-2 flex w-full flex-col gap-2" aria-label="Where to go">
          @if (auth.isLoggedIn()) {
            <a hlmBtn routerLink="/home" class="h-12 text-base"><ng-icon name="lucideHouse" size="18" aria-hidden="true" /> Go home</a>
            <a hlmBtn variant="outline" routerLink="/events/mine" class="h-11"><ng-icon name="lucideCalendarDays" size="16" aria-hidden="true" /> My events</a>
            <a hlmBtn variant="outline" routerLink="/events/discover" class="h-11"><ng-icon name="lucideSearch" size="16" aria-hidden="true" /> Discover events</a>
            <a hlmBtn variant="ghost" routerLink="/events/join" class="h-11">Join with a code</a>
          } @else {
            <a hlmBtn routerLink="/welcome" class="h-12 text-base">Go to start</a>
            <a hlmBtn variant="outline" routerLink="/auth/login" class="h-11">Log in</a>
          }
        </nav>
      </div>
    </zeus-auth-layout>
  `,
})
export class NotFoundScreen {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** The URL being navigated to (router.url still holds the previous one during activation). */
  protected readonly path = this.router.serializeUrl(this.router.currentNavigation()?.finalUrl ?? this.router.parseUrl(this.router.url));
}
