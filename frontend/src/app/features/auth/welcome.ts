import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { AuthLayout } from './auth-layout';

/** Landing for signed-out visitors: what the app does, then create account / log in. */
@Component({
  selector: 'zeus-welcome-screen',
  imports: [AuthLayout, RouterLink, NgIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <zeus-auth-layout [center]="false" width="wide">
      <a layoutAction routerLink="/auth/login" class="tap inline-flex items-center px-2 text-sm font-semibold text-muted-foreground hover:text-foreground" i18n>Log in</a>

      <section class="pt-4 sm:pt-10" aria-labelledby="welcome-title">
        <p class="label-caps" i18n>For players and Game Masters</p>
        <h1 id="welcome-title" class="mt-2 text-3xl uppercase sm:text-5xl" i18n>Airsoft events with a live map and a scoreboard</h1>
        <p class="mt-3 max-w-prose text-muted-foreground" i18n>
          During the game, players see their team and the objectives on their phone. Before it starts, the Game Master draws the field and sets the rules.
        </p>
      </section>

      <ul class="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="How it works" i18n-aria-label>
        <!-- 1. Live map -->
        <li class="panel flex flex-col overflow-hidden">
          <div class="relative h-32 border-b border-border bg-muted" aria-hidden="true">
            <svg viewBox="0 0 200 128" class="absolute inset-0 size-full" preserveAspectRatio="xMidYMid slice">
              <defs>
                <pattern id="wg" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M20 0H0V20" fill="none" stroke="currentColor" stroke-opacity="0.12" stroke-width="1" />
                </pattern>
              </defs>
              <rect width="200" height="128" fill="url(#wg)" class="text-foreground" />
              <path d="M18 104 C60 80 70 40 120 36 S180 20 192 12" fill="none" stroke="var(--border)" stroke-width="10" stroke-linecap="round" />
              <polygon points="130,70 176,64 182,108 128,112" fill="var(--warning)" fill-opacity="0.16" stroke="var(--warning)" stroke-dasharray="4 3" />
              <circle cx="154" cy="88" r="7" fill="var(--warning)" />
              <circle cx="56" cy="78" r="16" fill="var(--nav)" fill-opacity="0.15" />
              <circle cx="56" cy="78" r="5" fill="var(--nav)" stroke="var(--background)" stroke-width="2" />
              <circle cx="78" cy="64" r="4.5" fill="var(--primary)" stroke="var(--background)" stroke-width="2" />
              <circle cx="40" cy="96" r="4.5" fill="var(--primary)" stroke="var(--background)" stroke-width="2" />
              <rect x="146" y="22" width="8" height="8" fill="var(--destructive)" transform="rotate(45 150 26)" />
            </svg>
          </div>
          <div class="flex flex-1 flex-col gap-1 p-4">
            <p class="label-caps" i18n>Map</p>
            <h2 class="text-lg uppercase" i18n>Your team on the map</h2>
            <p class="text-sm text-muted-foreground" i18n>
              Objectives, safe zones and where your teammates are right now. Enemies show up only if the event allows it or your team uses a recon perk.
            </p>
          </div>
        </li>

        <!-- 2. Objectives -->
        <li class="panel flex flex-col overflow-hidden">
          <div class="flex h-32 items-center justify-center gap-3 border-b border-border bg-muted px-4" aria-hidden="true">
            <span class="flex flex-col items-center gap-1.5">
              <span class="num rounded-sm border border-border bg-card px-2 py-1.5 text-sm font-bold tracking-[0.2em]">7K4Q</span>
              <span class="label-caps" i18n>Code</span>
            </span>
            <span class="flex flex-col items-center gap-1.5">
              <span class="grid size-11 place-items-center rounded-sm border border-border bg-card"><ng-icon name="lucideQrCode" size="26" /></span>
              <span class="label-caps" i18n>QR</span>
            </span>
            <span class="flex flex-col items-center gap-1.5">
              <span class="relative grid size-11 place-items-center rounded-full border-2 border-dashed border-warning text-warning">
                <ng-icon name="lucideCrosshair" size="20" />
              </span>
              <span class="label-caps" i18n>Hold zone</span>
            </span>
          </div>
          <div class="flex flex-1 flex-col gap-1 p-4">
            <p class="label-caps" i18n>Objectives</p>
            <h2 class="text-lg uppercase" i18n>Three ways to take a point</h2>
            <p class="text-sm text-muted-foreground" i18n>
              Type the code written at the point, scan its QR tag, or stay in the zone until the timer runs out. The server checks every capture.
            </p>
          </div>
        </li>

        <!-- 3. Points and credits -->
        <li class="panel flex flex-col overflow-hidden">
          <div class="flex h-32 items-center justify-center gap-5 border-b border-border bg-muted px-4" aria-hidden="true">
            <span class="flex flex-col items-center">
              <span class="label-caps" i18n>Points</span>
              <span class="num flex items-center gap-1 text-2xl font-bold"><ng-icon name="lucideTrophy" size="18" class="text-primary" />1,250</span>
            </span>
            <span class="h-10 w-px bg-border"></span>
            <span class="flex flex-col items-center">
              <span class="label-caps" i18n>Credits</span>
              <span class="num flex items-center gap-1 text-2xl font-bold"><ng-icon name="lucideCoins" size="18" class="text-warning" />340</span>
            </span>
          </div>
          <div class="flex flex-1 flex-col gap-1 p-4">
            <p class="label-caps" i18n>Score</p>
            <h2 class="text-lg uppercase" i18n>Points to win, credits to spend</h2>
            <p class="text-sm text-muted-foreground" i18n>
              Taking and holding objectives earns your team both. Credits buy perks such as a UAV sweep or a shield on an objective.
            </p>
          </div>
        </li>
      </ul>

      <div class="sticky bottom-0 -mx-4 mt-8 border-t border-border bg-background/95 px-4 pt-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0"
        style="padding-bottom: calc(1rem + var(--safe-bottom))">
        <div class="flex flex-col gap-2 sm:flex-row">
          <a hlmBtn routerLink="/auth/sign-up" class="h-12 text-base sm:w-56" i18n>Create account</a>
          <a hlmBtn variant="outline" routerLink="/auth/login" class="h-12 text-base sm:w-40" i18n>Log in</a>
        </div>
        <p class="mt-3 text-xs text-muted-foreground" i18n>
          Got a code from your Game Master? Log in or sign up, then enter it under “Join with code”.
        </p>
      </div>
    </zeus-auth-layout>
  `,
})
export class WelcomeScreen {}
