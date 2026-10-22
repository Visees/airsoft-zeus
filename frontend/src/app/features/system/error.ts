import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { AuthService } from '../../core/auth/auth.service';
import { AuthLayout } from '../auth/auth-layout';

@Component({
  selector: 'zeus-error-screen',
  imports: [AuthLayout, RouterLink, NgIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <zeus-auth-layout>
      <div class="flex flex-col items-start gap-3" role="alert">
        <span class="grid size-12 place-items-center rounded-md bg-destructive/10 text-destructive" aria-hidden="true"><ng-icon name="lucideTriangleAlert" size="24" /></span>
        <h1 class="text-3xl uppercase" i18n>Something went wrong</h1>
        <p class="text-muted-foreground" i18n>
          The app hit an unexpected problem. Your games, scores and captures are stored on the server, so nothing is lost.
        </p>
        <p class="text-sm text-muted-foreground" i18n>If it keeps happening, reload the app or tell the Game Master if you are in a live game.</p>
        <div class="mt-2 flex w-full flex-col gap-2">
          <button hlmBtn type="button" class="h-12 text-base" (click)="tryAgain()">
            <ng-icon name="lucideRefreshCw" size="18" aria-hidden="true" /> <ng-container i18n>Try again</ng-container>
          </button>
          <a hlmBtn variant="outline" [routerLink]="auth.isLoggedIn() ? '/home' : '/welcome'" class="h-11">
            <ng-icon name="lucideHouse" size="16" aria-hidden="true" /> <ng-container i18n>Go home</ng-container>
          </a>
        </div>
      </div>
    </zeus-auth-layout>
  `,
})
export class ErrorScreen {
  private readonly doc = inject(DOCUMENT);
  protected readonly auth = inject(AuthService);

  /** Back to the screen that failed when there is one, otherwise reload. */
  protected tryAgain(): void {
    const win = this.doc.defaultView;
    if (!win) return;
    if (win.history.length > 1) win.history.back();
    else win.location.reload();
  }
}
