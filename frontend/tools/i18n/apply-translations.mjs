// Merges numbered translation chunks ("N<TAB>text" per line, N = index in the frozen messages.json order)
// into src/locale/messages.it.json, checking that each translation keeps the same placeholders.
// Usage: node apply-translations.mjs <frozen messages.json> <messages.it.json> <chunk files...>
import fs from 'node:fs';

const [, , frozenPath, targetPath, ...chunks] = process.argv;
const source = JSON.parse(fs.readFileSync(frozenPath, 'utf8')).translations;
const ids = Object.keys(source);
const target = fs.existsSync(targetPath) ? JSON.parse(fs.readFileSync(targetPath, 'utf8')) : { locale: 'it', translations: {} };

const placeholders = (s) => [...s.matchAll(/\{\$([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort().join(',');
let ok = 0;
let bad = 0;
for (const chunk of chunks) {
  for (const line of fs.readFileSync(chunk, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    const n = Number(line.slice(0, tab));
    const text = line.slice(tab + 1);
    const id = ids[n];
    if (tab < 0 || !Number.isInteger(n) || id === undefined) {
      console.log('BAD LINE', chunk, line.slice(0, 80));
      bad++;
      continue;
    }
    if (placeholders(text) !== placeholders(source[id])) {
      console.log(`PLACEHOLDERS #${n}: "${source[id]}" → "${text}"`);
      bad++;
      continue;
    }
    // Keep the source's edge whitespace: fragments like "Join " are glued to other values.
    const src = source[id];
    target.translations[id] = src.match(/^\s*/)[0] + text.trim() + src.match(/\s*$/)[0];
    ok++;
  }
}
fs.writeFileSync(targetPath, JSON.stringify(target, null, 2) + '\n');
const missing = ids.filter((id) => !(id in target.translations));
console.log(`applied ${ok}, rejected ${bad}, missing ${missing.length} of ${ids.length}`);
