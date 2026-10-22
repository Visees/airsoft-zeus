import { DestroyRef, Signal, inject, signal } from '@angular/core';

/** Signal that follows a CSS media query (false on the server). Call in an injection context. */
export function mediaQuery(query: string): Signal<boolean> {
  const s = signal(false);
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return s.asReadonly();
  const mql = window.matchMedia(query);
  s.set(mql.matches);
  const handler = (e: MediaQueryListEvent) => s.set(e.matches);
  mql.addEventListener('change', handler);
  inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', handler));
  return s.asReadonly();
}

/** ≥1024px: GM screens switch to tables and side panels. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * A phone held sideways: little height, so the live screens use a side rail and a one-line HUD.
 * Same query as the `compact:` Tailwind variant in styles.css.
 */
export const COMPACT_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px)';
