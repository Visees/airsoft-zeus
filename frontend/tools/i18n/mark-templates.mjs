// Adds i18n / i18n-<attr> markers to inline Angular templates.
// Usage: node mark-templates.mjs <file...>   (writes files in place, prints a summary)
import fs from 'node:fs';
import { Element, Text, Block, HtmlParser } from '@angular/compiler';
import { findTemplates } from './tpl-lib.mjs';

const ATTRS = new Set(['aria-label', 'title', 'label', 'placeholder', 'backLabel', 'message', 'description', 'eyebrow', 'subtitle', 'alt', 'emptyLabel']);
const PHRASING = new Set(['span', 'strong', 'em', 'b', 'i', 'a', 'code', 'kbd', 'br', 'small', 'abbr', 'mark', 'sup', 'sub', 'time', 'u', 's', 'wbr', 'ng-icon', 'bdi']);
const SKIP_CONTENT = new Set(['script', 'style', 'svg', 'pre', 'textarea', 'ng-icon']);
const SKIP_TEXT = new Set(['AirsoftHub', 'AH']);

const stripInterp = (s) => s.replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ');
const textHasLetters = (s) => {
  const t = stripInterp(s).trim();
  return /\p{L}{2,}/u.test(t) && !SKIP_TEXT.has(t);
};
const hasI18n = (el) => el.attrs.some((a) => a.name === 'i18n');

/** Any non-whitespace text (incl. interpolation) inside. */
function hasAnyText(n) {
  if (n instanceof Text) return n.value.trim().length > 0;
  if (n instanceof Element) return !SKIP_CONTENT.has(n.name) && n.children.some(hasAnyText);
  return false;
}
function hasLetterText(n) {
  if (n instanceof Text) return textHasLetters(n.value);
  if (n instanceof Element) return !SKIP_CONTENT.has(n.name) && n.children.some(hasLetterText);
  return false;
}
function isPhrasing(n) {
  if (n instanceof Text) return true;
  if (!(n instanceof Element)) return false; // blocks, @let, comments break a run
  if (hasI18n(n)) return false;
  if (n.children.length === 0) return !['input', 'select', 'textarea', 'button'].includes(n.name) || !hasAnyText(n);
  if (!PHRASING.has(n.name)) return false;
  return n.children.every((c) => isPhrasing(c) || c.constructor.name === 'Comment');
}

export function markTemplate(text) {
  const r = new HtmlParser().parse(text, 'x', { tokenizeExpansionForms: true, tokenizeBlocks: true, tokenizeLet: true, preserveLineEndings: true });
  if (r.errors.length) throw new Error(r.errors.map((e) => e.msg).join('; '));
  const ins = []; // { at, text, rank }
  const stats = { elements: 0, wrappers: 0, attrs: 0 };

  const attrInsertAt = (el) => {
    if (el.attrs.length) return Math.max(...el.attrs.map((a) => a.sourceSpan.end.offset));
    return el.startSourceSpan.start.offset + 1 + el.name.length;
  };
  const markEl = (el) => {
    ins.push({ at: attrInsertAt(el), text: ' i18n', rank: 2 });
    stats.elements++;
  };

  const nodeStart = (n) => {
    if (n instanceof Text) {
      const raw = text.slice(n.sourceSpan.start.offset, n.sourceSpan.end.offset);
      return n.sourceSpan.start.offset + (raw.length - raw.trimStart().length);
    }
    return n.sourceSpan.start.offset;
  };
  const nodeEnd = (n) => {
    if (n instanceof Text) {
      const raw = text.slice(n.sourceSpan.start.offset, n.sourceSpan.end.offset);
      return n.sourceSpan.end.offset - (raw.length - raw.trimEnd().length);
    }
    return (n.endSourceSpan ?? n.sourceSpan).end.offset;
  };

  function attrsOnly(nodes) {
    for (const n of nodes) {
      if (n instanceof Element) {
        doAttrs(n);
        attrsOnly(n.children);
      } else if (n instanceof Block) attrsOnly(n.children);
    }
  }
  function doAttrs(el) {
    const have = new Set(el.attrs.map((a) => a.name));
    const add = [];
    for (const a of el.attrs) {
      if (!ATTRS.has(a.name) || have.has('i18n-' + a.name)) continue;
      const v = a.value;
      if (v.includes('{{') || !/\p{L}{2,}/u.test(v) || /^https?:|^[A-Z0-9-]+$/.test(v) || SKIP_TEXT.has(v.trim())) continue;
      add.push('i18n-' + a.name);
    }
    if (add.length) {
      ins.push({ at: attrInsertAt(el), text: add.map((x) => ' ' + x).join(''), rank: 3 });
      stats.attrs += add.length;
    }
  }

  /** Content that belongs in a message: letters or an interpolation (icons and glyph-only spans don't). */
  const meaningful = (n) => {
    if (n instanceof Text) return textHasLetters(n.value) || n.value.includes('{{');
    if (n instanceof Element) return !SKIP_CONTENT.has(n.name) && n.children.some(meaningful);
    return false;
  };
  /** A message needs its own sentence text, not just a row of elements that each have text. */
  const directLetters = (nodes) => nodes.some((n) => n instanceof Text && textHasLetters(n.value));

  function processChildren(children, parent) {
    const kids = children.filter((c) => c.constructor.name !== 'Comment');
    if (parent && kids.length && kids.every(isPhrasing) && directLetters(kids)) {
      const first = kids.findIndex(meaningful);
      const last = kids.length - 1 - [...kids].reverse().findIndex(meaningful);
      const edgesClean = kids.slice(0, first).every((c) => c instanceof Text) && kids.slice(last + 1).every((c) => c instanceof Text);
      if (edgesClean) {
        markEl(parent);
        return attrsOnly(kids);
      }
    }
    // Group into runs of phrasing nodes; recurse into everything else.
    let run = [];
    const flush = () => {
      let a = 0;
      let b = run.length - 1;
      while (a <= b && !meaningful(run[a])) a++;
      while (b >= a && !meaningful(run[b])) b--;
      const core = run.slice(a, b + 1);
      if (core.length && directLetters(core)) {
        ins.push({ at: nodeStart(core[0]), text: '<ng-container i18n>', rank: 1 });
        ins.push({ at: nodeEnd(core[core.length - 1]), text: '</ng-container>', rank: 0 });
        stats.wrappers++;
        for (const n of run) if (n instanceof Element) attrsOnly([n]);
      } else {
        for (const n of run) if (n instanceof Element) visit(n);
      }
      run = [];
    };
    for (const c of kids) {
      if (isPhrasing(c)) run.push(c);
      else {
        flush();
        visit(c);
      }
    }
    flush();
  }

  function visit(n) {
    if (n instanceof Element) {
      doAttrs(n);
      if (SKIP_CONTENT.has(n.name) || hasI18n(n)) return attrsOnly(n.children);
      return processChildren(n.children, n);
    }
    if (n instanceof Block) return processChildren(n.children);
  }

  processChildren(r.rootNodes);

  ins.sort((x, y) => y.at - x.at || y.rank - x.rank);
  let out = text;
  for (const i of ins) out = out.slice(0, i.at) + i.text + out.slice(i.at);
  return { out, stats };
}

const files = process.argv.slice(2);
for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  const tpls = findTemplates(file, src).sort((a, b) => b.start - a.start);
  if (!tpls.length) continue;
  const total = { elements: 0, wrappers: 0, attrs: 0 };
  for (const t of tpls) {
    if (t.text.includes(' i18n')) {
      console.log('SKIP (already marked)', file);
      continue;
    }
    const { out, stats } = markTemplate(t.text);
    for (const k in total) total[k] += stats[k];
    src = src.slice(0, t.start) + out + src.slice(t.end);
  }
  fs.writeFileSync(file, src);
  console.log(file, JSON.stringify(total));
}
