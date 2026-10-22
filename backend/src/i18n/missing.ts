import { resolve } from 'node:path';
import { it } from './it.js';
import { sourceKeys } from './keys.js';

/** `npm run i18n:missing`: server messages without an Italian text (key, then where it is used). */
const keys = sourceKeys(resolve(import.meta.dirname, '..'));
const missing = [...keys].filter(([k]) => !(k in it));
for (const [key, at] of missing) console.log(`${JSON.stringify(key)}\t${at.replace(/^.*[\\/]src[\\/]/, '')}`);
console.error(`${missing.length} of ${keys.size} messages have no Italian text`);
