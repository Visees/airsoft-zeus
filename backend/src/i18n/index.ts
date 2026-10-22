import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { it } from './it.js';

/**
 * Server-side texts in the reader's language.
 *
 * Messages are written in English with the `tr` tag: tr`${name} has started`. The English text
 * (with {0}, {1}… for the values) is the key into the dictionaries; a missing key falls back to
 * English. `tr` uses the language of the current request (Accept-Language, set by the app for
 * every API call). Texts for other people (notifications, emails, the activity feed) are written
 * as a `Msg` and rendered in each reader's language.
 */
export type Lang = 'en' | 'it';
export const LANGS: Lang[] = ['en', 'it'];

const dictionaries: Record<Lang, Record<string, string>> = { en: {}, it };
const store = new AsyncLocalStorage<Lang>();

/** 'it', 'it-IT', 'IT' → 'it'; anything else (de, fr, es, unknown) → 'en'. */
export function toLang(value: unknown): Lang {
  return typeof value === 'string' && value.trim().slice(0, 2).toLowerCase() === 'it' ? 'it' : 'en';
}

/** The first language of an Accept-Language header ("it-IT,it;q=0.9,en;q=0.8" → it). */
export function fromAcceptLanguage(header: string | undefined): Lang {
  return toLang(header?.split(',')[0]);
}

export function requestLang(): Lang {
  return store.getStore() ?? 'en';
}

export function runWithLang<T>(lang: Lang, fn: () => T): T {
  return store.run(lang, fn);
}

/** A tagged template that translates; `lang` is its language (for dates and numbers). */
export type Translate = ((strings: TemplateStringsArray, ...values: unknown[]) => string) & { readonly lang: Lang };

const keyOf = (strings: TemplateStringsArray) => strings.reduce((key, s, i) => key + (i ? `{${i - 1}}` : '') + s, '');

export function translate(lang: Lang, key: string, values: readonly unknown[] = []): string {
  return (dictionaries[lang][key] ?? key).replace(/\{(\d+)\}/g, (_, i: string) => String(values[Number(i)] ?? ''));
}

/** Translator for a given language. */
export const trIn = (lang: Lang): Translate =>
  Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => translate(lang, keyOf(strings), values), { lang });

/** Translate in the language of the current request. */
export const tr = Object.defineProperty(
  (strings: TemplateStringsArray, ...values: unknown[]) => translate(requestLang(), keyOf(strings), values),
  'lang',
  { get: requestLang },
) as Translate;

/** BCP 47 locale for Intl date and number formatting. */
export const localeOf = (lang: Lang) => (lang === 'it' ? 'it-IT' : 'en-GB');

/** A text for several readers: user content as is, or a message rendered in each reader's language. */
export type Msg = string | ((tr: Translate) => string);

export function render(msg: Msg, lang: Lang): string {
  return typeof msg === 'string' ? msg : msg(trIn(lang));
}

/** The message in every language, to store next to the English text. */
export function renderAll(msg: Msg): Record<Lang, string> {
  return { en: render(msg, 'en'), it: render(msg, 'it') };
}

/** A stored text in the request language: its translations if any, else the stored (English) text. */
export function pick(texts: Partial<Record<Lang, string>> | null | undefined, fallback: string, lang = requestLang()): string {
  return texts?.[lang] ?? fallback;
}

/** Exact-match translation for fixed messages created before any request (zod schema messages). */
export function translateKnown(message: string, lang = requestLang()): string {
  return dictionaries[lang][message] ?? message;
}

/** Zod's own messages ("Too small: …") in the request language. */
export function zodErrorMap(lang = requestLang()) {
  return lang === 'it' ? z.locales.it().localeError : undefined;
}

/** "Sat 25 Oct, 10:00" in the given language, in the field's time zone. */
export function eventDate(value: string | Date, lang: Lang): string {
  return new Date(value).toLocaleString(localeOf(lang), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Rome',
  });
}
