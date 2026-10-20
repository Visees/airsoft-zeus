import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { safeStorage } from '../util/storage';

export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * Light/dark handling. Live game screens call setLiveMode(true): they go dark unless the
 * user explicitly chose light, because dark is easier on night vision and battery outdoors.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly systemDark = signal(false);
  private readonly liveMode = signal(false);

  readonly preference = signal<ThemePreference>(safeStorage.get<ThemePreference>('zeus.theme') ?? 'system');
  readonly isDark = computed(() => {
    const pref = this.preference();
    if (pref === 'dark') return true;
    if (pref === 'light') return false;
    return this.liveMode() || this.systemDark();
  });

  constructor() {
    if (this.isBrowser && typeof matchMedia !== 'undefined') {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      this.systemDark.set(mq.matches);
      mq.addEventListener('change', (e) => this.systemDark.set(e.matches));
    }
    effect(() => {
      const dark = this.isDark();
      this.doc.documentElement.classList.toggle('dark', dark);
      const meta = this.doc.querySelector('meta[name="theme-color"]');
      meta?.setAttribute('content', dark ? '#0e100f' : '#f2f2ec');
    });
  }

  setPreference(pref: ThemePreference): void {
    this.preference.set(pref);
    safeStorage.set('zeus.theme', pref);
  }

  setLiveMode(on: boolean): void {
    this.liveMode.set(on);
  }
}
