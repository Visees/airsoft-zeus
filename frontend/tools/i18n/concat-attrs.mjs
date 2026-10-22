// Turns bound attributes built by string concatenation into translatable interpolated attributes:
//   [attr.aria-label]="'Delete ' + a.fileName"  →  aria-label="Delete {{ a.fileName }}" i18n-aria-label
// Only plain `'text' + expr + 'text'` chains are changed; anything else is printed as SKIP.
import fs from 'node:fs';
import { walkTs, findTemplates } from './tpl-lib.mjs';

const dir = process.argv[2];

function splitPlus(e) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < e.length; i++) {
    const ch = e[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') cur += e[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === '+' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

for (const file of walkTs(dir)) {
  let src = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const t of findTemplates(file, src).sort((a, b) => b.start - a.start)) {
    let tpl = t.text;
    tpl = tpl.replace(/\[(attr\.)?(aria-label|title|alt|label|placeholder)\]="([^"]*)"/g, (all, _attr, name, expr) => {
      if (!/'[^']*\p{L}{2,}[^']*'\s*\+|\+\s*'[^']*\p{L}{2,}/u.test(expr)) return all;
      const parts = splitPlus(expr);
      let out = '';
      for (const p of parts) {
        const lit = p.match(/^'((?:[^'\\]|\\.)*)'$/);
        if (lit) out += lit[1].replace(/\\'/g, "'");
        else if (/['"]/.test(p)) {
          console.log('SKIP', file.replace(/^.*src[\\/]app[\\/]/, ''), all.slice(0, 140));
          return all;
        } else out += `{{ ${p.replace(/^\((.*)\)$/, '$1')} }}`;
      }
      changed = true;
      return `${name}="${out}" i18n-${name}`;
    });
    src = src.slice(0, t.start) + tpl + src.slice(t.end);
  }
  if (changed) {
    fs.writeFileSync(file, src);
    console.log('changed', file.replace(/^.*src[\\/]app[\\/]/, ''));
  }
}
