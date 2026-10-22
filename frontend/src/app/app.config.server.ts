import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { ApplicationConfig, inject, mergeApplicationConfig, provideAppInitializer } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { serverApiInterceptor } from './core/api/server-api.interceptor';
import { activeLanguage } from './core/i18n/language';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    provideHttpClient(withFetch(), withInterceptors([serverApiInterceptor])),
    provideAppInitializer(() => {
      const html = inject(DOCUMENT).documentElement;
      html.setAttribute('lang', activeLanguage());
      html.setAttribute('data-ssr-lang', activeLanguage());
    }),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
