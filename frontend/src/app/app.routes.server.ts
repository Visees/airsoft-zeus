import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Only the public results page is rendered on the server (shareable link with real HTML
 * for previews and crawlers). The app itself is behind a login and renders in the browser.
 */
export const serverRoutes: ServerRoute[] = [
  { path: 'r/:token', renderMode: RenderMode.Server },
  { path: '**', renderMode: RenderMode.Client },
];
