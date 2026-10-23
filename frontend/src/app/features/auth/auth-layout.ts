import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UI_LANGUAGES, UiLanguage, activeLanguage, switchLanguage } from '../../core/i18n/language';
import { Logo } from '../../shared/logo';

/**
 * Minimal full-height layout for screens outside the app shell (auth, system pages):
 * logo, a centred narrow column, safe-area padding.
 */
@Component({
  selector: 'zeus-auth-layout',
  imports: [RouterLink, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-dvh flex-col bg-background text-foreground' },
  template: `
    <header class="flex items-center justify-between gap-3 px-4 sm:px-6" style="padding-top: calc(0.75rem + var(--safe-top))">
      <a routerLink="/" class="tap -ml-1 flex items-center px-1" aria-label="AirsoftHub, start" i18n-aria-label>
        <zeus-logo class="h-6" />
      </a>
      <div class="flex items-center gap-2">
        <ng-content select="[layoutAction]" />
        @for (l of otherLanguages; track l.code) {
          <button type="button" class="tap px-2 text-sm font-semibold text-muted-foreground hover:text-foreground" [attr.lang]="l.code" (click)="switchTo(l.code)">{{ l.name }}</button>
        }
      </div>
    </header>

    <main id="main" class="flex flex-1 flex-col">
      <div
        class="mx-auto flex w-full flex-1 flex-col px-4 py-6 sm:px-6"
        [class.max-w-md]="width() === 'narrow'"
        [class.max-w-2xl]="width() === 'wide'"
        [class.justify-center]="center()"
      >
        <ng-content />
      </div>
    </main>

    <footer class="px-4 text-center text-xs text-muted-foreground" style="padding-bottom: calc(1rem + var(--safe-bottom))">
      <ng-content select="[layoutFooter]" />
    </footer>
  `,
})
export class AuthLayout {
  /** Vertically centre the content column (short forms). */
  readonly center = input(true);
  readonly width = input<'narrow' | 'wide'>('narrow');
  protected readonly otherLanguages = UI_LANGUAGES.filter((l) => l.code !== activeLanguage());

  protected switchTo(lang: UiLanguage): void {
    switchLanguage(lang);
  }
}
