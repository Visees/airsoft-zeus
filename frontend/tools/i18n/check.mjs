// Checks src/locale/messages.it.json against the extracted source messages (run `ng extract-i18n` first):
// every message translated, no stale ids, same placeholders. Exits 1 on problems.
// Usage: npm run i18n:check   (add --prune to drop stale ids)
import fs from 'node:fs';

const root = new URL('../../src/locale/', import.meta.url);
const source = JSON.parse(fs.readFileSync(new URL('messages.json', root), 'utf8')).translations;
const targetPath = new URL('messages.it.json', root);
const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));

// {$NAME} placeholders and the {NAME} placeholders inside ICU cases.
const placeholders = (s) => [...s.matchAll(/\{\$?([A-Z][A-Z0-9_]*|[a-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort().join(',');

const missing = Object.keys(source).filter((id) => !(id in target.translations));
const stale = Object.keys(target.translations).filter((id) => !(id in source));
const mismatched = Object.keys(source).filter((id) => id in target.translations && placeholders(source[id]) !== placeholders(target.translations[id]));

for (const id of missing) console.log(`missing   ${id}  ${source[id]}`);
for (const id of mismatched) console.log(`placeholders differ  ${id}\n  en: ${source[id]}\n  it: ${target.translations[id]}`);
if (stale.length) {
  if (process.argv.includes('--prune')) {
    for (const id of stale) delete target.translations[id];
    fs.writeFileSync(targetPath, JSON.stringify(target, null, 2) + '\n');
    console.log(`pruned ${stale.length} stale ids`);
  } else console.log(`${stale.length} stale ids (run with --prune to remove them)`);
}
console.log(`${Object.keys(source).length - missing.length}/${Object.keys(source).length} translated, ${mismatched.length} placeholder mismatches`);
process.exit(missing.length || mismatched.length ? 1 : 0);
