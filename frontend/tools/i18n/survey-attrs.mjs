import fs from 'node:fs';
import { walkTs, findTemplates, parseTemplate, nodeKind } from './tpl-lib.mjs';

const root = process.argv[2];
const counts = new Map();
const kinds = new Set();
for (const file of walkTs(root)) {
  const src = fs.readFileSync(file, 'utf8');
  for (const t of findTemplates(file, src)) {
    if (t.cookedDiffers) console.log('COOKED DIFFERS', file);
    const r = parseTemplate(t.text, file);
    if (r.errors.length) console.log('PARSE ERRORS', file, r.errors.map((e) => e.msg).join('; '));
    const visit = (nodes) => {
      for (const n of nodes) {
        kinds.add(nodeKind(n));
        if (n.attrs) {
          for (const a of n.attrs) {
            if (/^[\[\(*#]|^bind-|^on-/.test(a.name)) continue;
            if (!/[A-Za-z]{2,}/.test(a.value) || a.value.includes('{{')) continue;
            const k = a.name;
            const e = counts.get(k) ?? { n: 0, samples: new Set() };
            e.n++;
            if (e.samples.size < 4) e.samples.add(a.value.slice(0, 50));
            counts.set(k, e);
          }
        }
        if (n.children) visit(n.children);
        if (n.cases) for (const c of n.cases) visit(c.expression ?? []);
      }
    };
    visit(r.rootNodes);
  }
}
console.log('node kinds:', [...kinds].join(' '));
for (const [k, v] of [...counts].sort((a, b) => b[1].n - a[1].n)) console.log(String(v.n).padStart(5), k, '|', [...v.samples].join(' | '));
