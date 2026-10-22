// Lists string literals inside template expressions ({{ }} and [bound]="...") that look like UI text.
// These can't be marked with i18n; move them to $localize in the component or use @if blocks.
import fs from 'node:fs';
import { walkTs, findTemplates } from './tpl-lib.mjs';

for (const file of walkTs(process.argv[2])) {
  const src = fs.readFileSync(file, 'utf8');
  for (const t of findTemplates(file, src)) {
    const exprs = [];
    for (const m of t.text.matchAll(/\{\{([\s\S]*?)\}\}/g)) exprs.push([m.index, m[1]]);
    for (const m of t.text.matchAll(/\s(?:\[[\w.-]+\]|\(\w+\))="([^"]*)"/g)) exprs.push([m.index, m[1]]);
    for (const [at, e] of exprs) {
      for (const s of e.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
        const v = s[1];
        if (!/\p{L}{2,}/u.test(v)) continue;
        if (/^[a-z0-9_\-.:\/ ]+$/.test(v) && !/ [a-z]+ /.test(' ' + v + ' ') && !/^ ?(by|in|of|and|or|left|ago|flagged|held|online|pts|cr) ?$/.test(v)) {
          if (/^[a-z_\-]+$/.test(v) || /[:\/-]/.test(v)) continue;
        }
        const line = src.slice(0, t.start + at).split('\n').length;
        console.log(`${file.replace(/^.*src[\\/]app[\\/]/, '')}:${line}: '${v}'  ←  ${e.trim().replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
  }
}
