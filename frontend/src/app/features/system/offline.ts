import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ConnectivityService } from '../../core/net/connectivity.service';
import { ConnectionStatus } from '../../shared/link-status';
import { AuthLayout } from '../auth/auth-layout';

@Component({
  selector: 'ah-offline-screen',
  imports: [AuthLayout, RouterLink, NgIcon, HlmButton, ConnectionStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ah-auth-layout>
      <ah-connection-status layoutAction [compact]="true" [showSync]="false" />
      <div class="flex flex-col items-start gap-3">
        <span class="grid size-12 place-items-center rounded-md bg-destructive/10 text-destructive" aria-hidden="true"><ng-icon name="lucideWifiOff" size="24" /></span>
        <h1 class="text-3xl uppercase" i18n>You are offline</h1>
        <p class="text-muted-foreground" i18n>AirsoftHub cannot reach the server. Check mobile data or move to a spot with better signal.</p>
        <ul class="panel flex w-full flex-col divide-y divide-border text-sm">
          <li class="flex gap-3 p-3"><ng-icon name="lucideMap" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span i18n><strong>During a live game</strong> the live screens keep the last loaded map, objectives and team scores, and your GPS positions are queued and sent when the signal returns.</span></li>
          <li class="flex gap-3 p-3"><ng-icon name="lucideClock" size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span i18n>Captures by code or QR need a connection to be confirmed. Note the code and enter it when you are back online.</span></li>
          <li class="flex gap-3 p-3"><ng-icon name="lucideSiren" size="18" class="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
            <span i18n>In an emergency, do not wait for the app: use your phone or radio and follow the field safety procedure.</span></li>
        </ul>
        <div class="mt-2 flex w-full flex-col gap-2">
          <button hlmBtn type="button" class="h-12 text-base" [disabled]="retrying()" (click)="retry()">
            <ng-icon name="lucideRefreshCw" size="18" [class.animate-spin]="retrying()" aria-hidden="true" /> {{ retrying() ? txt.reloading : txt.tryAgain }}
          </button>
          <a hlmBtn variant="ghost" routerLink="/" class="h-11" i18n>Go to start</a>
        </div>
        @if (conn.browserOnline()) {
          <p class="text-sm text-muted-foreground" role="status" i18n>Your device reports a connection again. Tap “Try again”.</p>
        }
      </div>
    </ah-auth-layout>
  `,
})
export class OfflineScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    reloading: $localize`Reloading…`,
    tryAgain: $localize`Try again`,
  };

  private readonly doc = inject(DOCUMENT);
  protected readonly conn = inject(ConnectivityService);
  protected readonly retrying = signal(false);

  protected retry(): void {
    this.retrying.set(true);
    this.doc.defaultView?.location.reload();
  }
}
