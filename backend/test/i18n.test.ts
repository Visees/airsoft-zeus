import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { it as italian } from '../src/i18n/it.js';
import { sourceKeys } from '../src/i18n/keys.js';
import { renderAll, runWithLang, tr, translate } from '../src/i18n/index.js';

const placeholders = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');

describe('i18n', () => {
  const keys = sourceKeys(resolve(import.meta.dirname, '../src'));

  it('has an Italian text for every server message', () => {
    const missing = [...keys].filter(([k]) => !(k in italian)).map(([k, at]) => `${k}  (${at})`);
    expect(missing).toEqual([]);
  });

  it('keeps the placeholders of every message', () => {
    const wrong = Object.entries(italian).filter(([en, itText]) => placeholders(en) !== placeholders(itText));
    expect(wrong).toEqual([]);
  });

  it('has no Italian texts for messages that no longer exist', () => {
    expect(Object.keys(italian).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('translates in the request language and falls back to English', () => {
    expect(runWithLang('it', () => tr`Event not found.`)).toBe(italian['Event not found.']);
    expect(runWithLang('en', () => tr`Event not found.`)).toBe('Event not found.');
    expect(translate('it', 'Not a known message {0}', ['x'])).toBe('Not a known message x');
    expect(renderAll((t) => t`Game resumed`)).toEqual({ en: 'Game resumed', it: italian['Game resumed'] });
  });
});
