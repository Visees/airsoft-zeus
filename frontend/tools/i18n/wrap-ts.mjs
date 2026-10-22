// Wraps the UI string literals found by ts-candidates.mjs in $localize, following ts-spec.json
// ({ "<path under src/app>": { skip: [n] | "all", only: [n], manual: [...] } }; manual ones are left alone).
// Usage (from tools/i18n): node wrap-ts.mjs ../../src/app
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { candidates } from './ts-candidates.mjs';
import { walkTs } from './tpl-lib.mjs';

const root = path.resolve(process.argv[2]);
const spec = JSON.parse(fs.readFileSync(new URL('./ts-spec.json', import.meta.url), 'utf8'));

const escape = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

function nameOf(e, sf) {
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isCallExpression(e)) {
    const callee = e.expression;
    const calleeName = nameOf(callee, sf);
    if (/^format/.test(calleeName) && e.arguments.length) {
      const a = nameOf(e.arguments[0], sf);
      return a === 'value' ? calleeName.replace(/^format/, '').replace(/^./, (c) => c.toLowerCase()) || 'value' : a;
    }
    if (['round', 'max', 'min', 'abs', 'floor', 'ceil', 'join', 'toLowerCase', 'toUpperCase', 'trim'].includes(calleeName) && ts.isPropertyAccessExpression(callee)) {
      return calleeName === 'join' || calleeName.startsWith('to') || calleeName === 'trim' ? nameOf(callee.expression, sf) : e.arguments.length ? nameOf(e.arguments[0], sf) : 'value';
    }
    return calleeName;
  }
  if (ts.isElementAccessExpression(e)) return nameOf(e.argumentExpression, sf);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return nameOf(e.left, sf);
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(e.operatorToken.kind)) return nameOf(e.left, sf);
  return 'value';
}

let total = 0;
for (const file of walkTs(root)) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const s = spec[rel] ?? {};
  if (s.skip === 'all') continue;
  const src = fs.readFileSync(file, 'utf8');
  const list = candidates(file, src);
  if (!list.length) continue;
  const sf = list[0].node.getSourceFile();
  const chosen = list.filter((_, i) => (s.only ? s.only.includes(i) : !(s.skip ?? []).includes(i)) && !(s.manual ?? []).includes(i));
  let out = src;
  for (const c of [...chosen].sort((a, b) => b.start - a.start)) {
    const n = c.node;
    let rep;
    if (ts.isStringLiteral(n)) rep = '$localize`' + escape(n.text) + '`';
    else if (ts.isNoSubstitutionTemplateLiteral(n)) rep = '$localize' + n.getText(sf);
    else {
      const used = new Map();
      let t = '$localize`' + n.head.getText(sf).slice(1, -2);
      for (const span of n.templateSpans) {
        const exprText = span.expression.getText(sf);
        let name = nameOf(span.expression, sf).replace(/[^A-Za-z0-9_]/g, '') || 'value';
        if (!/^[A-Za-z_]/.test(name)) name = 'value';
        let k = name;
        for (let i = 2; used.has(k) && used.get(k) !== exprText; i++) k = name + i;
        used.set(k, exprText);
        const lit = span.literal.getText(sf); // "}...${" or "}...`"
        const tail = ts.isTemplateTail(span.literal) ? lit.slice(1, -1) : lit.slice(1, -2);
        t += '${' + exprText + '}:' + k + ':' + tail;
      }
      rep = t + '`';
    }
    out = out.slice(0, c.start) + rep + out.slice(c.end);
    total++;
  }
  fs.writeFileSync(file, out);
  console.log(rel, chosen.length);
}
console.log('wrapped', total);
