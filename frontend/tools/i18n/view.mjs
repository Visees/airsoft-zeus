// Builds a numbered view of the extracted messages for translating:
//   N | source file | text (placeholders shown as {$NAME=expression})
// Usage: node view.mjs <messages.json> <messages.xlf> <out.txt> [messages.it.json]
// With a translation file, only messages it does not have yet are listed (numbers stay global).
import fs from 'node:fs';

const [, , jsonPath, xlfPath, outPath, donePath] = process.argv;
const msgs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')).translations;
const done = donePath ? JSON.parse(fs.readFileSync(donePath, 'utf8')).translations : {};
const xlf = fs.readFileSync(xlfPath, 'utf8');

const info = new Map();
for (const m of xlf.matchAll(/<trans-unit id="([^"]+)"[\s\S]*?<\/trans-unit>/g)) {
  const unit = m[0];
  const files = [...new Set([...unit.matchAll(/<context context-type="sourcefile">([^<]+)<\/context>/g)].map((f) => f[1].replace(/^.*\//, '').replace(/\.ts$/, '')))];
  const file = files.length > 1 ? files.slice(0, 4).join(',') + (files.length > 4 ? ',…' : '') : (unit.match(/<context context-type="sourcefile">([^<]+)<\/context>/)?.[1] ?? '');
  const eq = new Map();
  for (const x of unit.matchAll(/<x id="([^"]+)"(?: equiv-text="([^"]*)")?/g)) if (x[2] !== undefined) eq.set(x[1], x[2]);
  const meaning = unit.match(/<note priority="1" from="meaning">([^<]+)<\/note>/)?.[1];
  info.set(m[1], { file: file.replace(/^.*src\/app\//, '').replace(/^.*libs\//, 'libs/'), eq, meaning });
}

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const lines = Object.entries(msgs).map(([id, text], i) => {
  const inf = info.get(id) ?? { file: '?', eq: new Map() };
  const shown = text.replace(/\{\$([A-Z0-9_a-z]+)\}/g, (all, name) => {
    const e = inf.eq.get(name);
    return e && /INTERPOLATION|^[a-z]/.test(name) ? `{$${name}=${decode(e).replace(/\s+/g, ' ').slice(0, 40)}}` : all;
  });
  return id in done ? null : `${i}\t${inf.file}${inf.meaning ? ' [' + inf.meaning + ']' : ''}\t${shown.replace(/\s+/g, ' ').trim()}`;
}).filter((l) => l !== null);
fs.writeFileSync(outPath, lines.join('\n') + '\n');
console.log(lines.length, 'lines');
