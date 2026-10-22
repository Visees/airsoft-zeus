import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withComponentInputBinding, withInMemoryScrolling, withRouterConfig } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideIcons } from '@ng-icons/core';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { playerViewInterceptor } from './core/live/player-view';
import { KeepAliveRouteStrategy } from './core/routing/keep-alive-route-strategy';
import { activeLanguage } from './core/i18n/language';
import { APP_ICONS } from './core/ui/icons';

/**
 * The server renders shared pages in one language (data-ssr-lang on <html>, see server-i18n.ts).
 * In another language the browser renders the page again instead of hydrating server HTML
 * whose text would not match.
 */
const hydrate =
  typeof document === 'undefined' || (document.documentElement.getAttribute('data-ssr-lang') ?? activeLanguage()) === activeLanguage();

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    { provide: RouteReuseStrategy, useExisting: KeepAliveRouteStrategy },
    provideHttpClient(withFetch(), withInterceptors([authInterceptor, playerViewInterceptor])),
    hydrate ? provideClientHydration(withEventReplay()) : [],
    provideIcons(APP_ICONS),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
