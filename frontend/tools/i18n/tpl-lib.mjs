// Shared helpers: find inline Angular templates in TS files and parse them with Angular's HTML parser.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { HtmlParser } from '@angular/compiler';

export function walkTs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** Inline templates: [{ start, end, text }] with offsets into the file (inside the backticks). */
export function findTemplates(file, src) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const res = [];
  const visit = (n) => {
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'template' && ts.isNoSubstitutionTemplateLiteral(n.initializer)) {
      const lit = n.initializer;
      const start = lit.getStart(sf) + 1;
      const end = lit.end - 1;
      const raw = src.slice(start, end);
      res.push({ start, end, text: raw, cookedDiffers: raw !== lit.text });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return res;
}

export function parseTemplate(text, url) {
  const parser = new HtmlParser();
  const r = parser.parse(text, url, { tokenizeExpansionForms: true, tokenizeBlocks: true, tokenizeLet: true, preserveLineEndings: true });
  return r;
}

export const nodeKind = (n) => n.constructor.name;
