import { safeStorage } from '../util/storage';

/**
 * UI language. Translations are loaded once at startup (`main.ts`) before the app is imported,
 * so the language is fixed for a page load: changing it stores the choice and reloads.
 *
 * Keep this file free of `$localize` and app imports: it runs before translations exist.
 */
export type UiLanguage = 'en' | 'it';

export const UI_LANGUAGES: { code: UiLanguage; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'it', name: 'Italiano' },
];

const STORAGE_KEY = 'zeus.lang';

let active: UiLanguage = 'en';

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === 'en' || value === 'it';
}

/** Stored choice, then the browser's languages, then English. */
export function detectLanguage(): UiLanguage {
  const stored = safeStorage.get<string>(STORAGE_KEY);
  if (isUiLanguage(stored)) return stored;
  const preferred = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  for (const tag of preferred) {
    const base = tag?.slice(0, 2).toLowerCase();
    if (isUiLanguage(base)) return base;
  }
  return 'en';
}

export function activeLanguage(): UiLanguage {
  return active;
}

/** Called once at startup, before translations are loaded. */
export function setActiveLanguage(lang: UiLanguage): void {
  active = lang;
}

/** BCP 47 tag for Intl date and number formatting. */
export function activeLocale(): string {
  return active === 'it' ? 'it-IT' : 'en-GB';
}

/** Remember the language for this device without reloading (e.g. from the profile on login). */
export function rememberLanguage(lang: UiLanguage): void {
  safeStorage.set(STORAGE_KEY, lang);
}

/** Switch the UI language: translations are fixed per page load, so this reloads the page. */
export function switchLanguage(lang: UiLanguage): void {
  rememberLanguage(lang);
  if (lang !== active && typeof location !== 'undefined') location.reload();
}
