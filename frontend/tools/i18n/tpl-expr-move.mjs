// Moves UI text literals out of template expressions ({{ a ? 'Saving…' : 'Save' }}, [label]="'Text'")
// into a `txt` object of $localize strings on the component, so they can be translated.
// Literals glued to other values with `+` are only reported (MANUAL): word order differs by language.
// Usage: node tpl-expr-move.mjs [--dry] <dir>
import fs from 'node:fs';
import ts from 'typescript';
import { walkTs } from './tpl-lib.mjs';

const dry = process.argv.includes('--dry');
const dir = process.argv.filter((a) => !a.startsWith('--'))[2];
const NOT_TEXT = new Set(['dark', 'light', 'page', 'true', 'false', 'step', 'location', 'polite', 'assertive', 'off', 'on', 'auto', 'none', 'done']);

function isUiText(v) {
  if (!/\p{L}{2,}/u.test(v)) return false;
  if (NOT_TEXT.has(v)) return false;
  if (/^lucide|^ah-|^https?:|^\/|^#|^mailto:|^tel:/.test(v)) return false;
  if (/\b[a-z]+-[a-z0-9[]|[a-z]:[a-z]|\/\d|!$/.test(v) && !/^[A-Z]/.test(v)) return false; // tailwind classes
  if (/^[a-z0-9_.-]+$/.test(v) && !/…$/.test(v)) return false; // keys, ids
  if (!/\s/.test(v) && /[a-z][A-Z]/.test(v)) return false; // camelCase keys and form paths
  return true;
}

function keyFor(text, used, byText) {
  if (byText.has(text)) return byText.get(text);
  const words = text
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  let k = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') || 'text';
  if (/^\d/.test(k)) k = 'n' + k;
  let key = k;
  for (let i = 2; used.has(key); i++) key = k + i;
  used.add(key);
  byText.set(text, key);
  return key;
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

let moved = 0;
for (const file of walkTs(dir)) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('template: `')) continue;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const edits = []; // { start, end, text }
  const report = [];
  const visit = (n) => {
    if (ts.isClassDeclaration(n) && n.modifiers?.some((m) => ts.isDecorator(m) && m.getText(sf).startsWith('@Component'))) {
      const deco = n.modifiers.find((m) => ts.isDecorator(m) && m.getText(sf).startsWith('@Component'));
      let tplNode;
      deco.forEachChild(function f(c) {
        if (ts.isPropertyAssignment(c) && c.name.getText(sf) === 'template' && ts.isNoSubstitutionTemplateLiteral(c.initializer)) tplNode = c.initializer;
        c.forEachChild(f);
      });
      if (!tplNode) return;
      const tStart = tplNode.getStart(sf) + 1;
      const tpl = src.slice(tStart, tplNode.end - 1);
      const used = new Set();
      const byText = new Map();
      const exprs = [];
      for (const m of tpl.matchAll(/\{\{([\s\S]*?)\}\}/g)) exprs.push({ at: m.index + 2, e: m[1] });
      for (const m of tpl.matchAll(/\s(\[[\w.-]+\])="([^"]*)"/g)) {
        if (/^\[(class|style|ngClass|ngStyle|routerLink|queryParams|name|size|variant|tone|glyph|icon|formControl|formGroup|id|for|type|value|href|src|kind)(\.|\])/.test(m[1])) continue;
        exprs.push({ at: m.index + m[0].indexOf('="') + 2, e: m[2] });
      }
      const local = [];
      for (const { at, e } of exprs) {
        for (const s of e.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
          const v = (s[1] ?? s[2]).replace(/\\'/g, "'");
          if (!isUiText(v)) continue;
          const before = e.slice(0, s.index).trimEnd();
          const after = e.slice(s.index + s[0].length).trimStart();
          if (/(===|!==|==|!=)$/.test(before) || /^(===|!==|==|!=)/.test(after)) continue;
          if (/[(,]$/.test(before) && !/\?\?$/.test(before)) continue; // function argument
          if (/\+$/.test(before) || /^\+/.test(after)) {
            report.push(`MANUAL ${v}  ←  ${e.trim().replace(/\s+/g, ' ').slice(0, 110)}`);
            continue;
          }
          const key = keyFor(v, used, byText);
          const start = tStart + at + s.index;
          edits.push({ start, end: start + s[0].length, text: 'txt.' + key });
          local.push([key, v]);
        }
      }
      if (local.length) {
        const entries = [...new Map(local).entries()];
        const body = entries.map(([k, v]) => `    ${k}: $localize\`${esc(v)}\`,`).join('\n');
        const brace = n.members.pos; // right after the class's opening brace
        edits.push({ start: brace, end: brace, text: `\n  /** UI text used inside template expressions. */\n  protected readonly txt = {\n${body}\n  };\n` });
        for (const [k, v] of entries) report.push(`txt.${k} = ${v}`);
        moved += entries.length;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (report.length) console.log('\n' + file.replace(/^.*src[\\/]app[\\/]/, '') + '\n  ' + report.join('\n  '));
  if (!dry && edits.length) {
    let out = src;
    for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    fs.writeFileSync(file, out);
  }
}
console.log('\nmoved', moved);
