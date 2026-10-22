// Wraps the untagged template literals on the given lines in $localize (same placeholder naming as wrap-ts).
// Usage: node wrap-lines.mjs <srcAppDir> <file:line,line> ...
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function nameOf(e) {
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isCallExpression(e)) {
    const c = nameOf(e.expression);
    if (/^format/.test(c) && e.arguments.length) return nameOf(e.arguments[0]);
    if (['toLowerCase', 'toUpperCase', 'trim', 'join'].includes(c) && ts.isPropertyAccessExpression(e.expression)) return nameOf(e.expression.expression);
    return c;
  }
  if (ts.isElementAccessExpression(e)) return nameOf(e.argumentExpression);
  if (ts.isBinaryExpression(e)) return nameOf(e.left);
  return 'value';
}

const root = process.argv[2];
for (const spec of process.argv.slice(3)) {
  const [rel, lines] = spec.split(':');
  const wanted = new Set(lines.split(',').map(Number));
  const file = path.join(root, rel);
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const hits = [];
  const visit = (n) => {
    if (ts.isTemplateExpression(n) && !ts.isTaggedTemplateExpression(n.parent)) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      if (wanted.has(line)) hits.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  let out = src;
  for (const n of hits.sort((a, b) => b.getStart(sf) - a.getStart(sf))) {
    const used = new Map();
    let t = '$localize`' + n.head.getText(sf).slice(1, -2);
    for (const span of n.templateSpans) {
      const exprText = span.expression.getText(sf);
      let name = nameOf(span.expression).replace(/[^A-Za-z0-9_]/g, '') || 'value';
      if (!/^[A-Za-z_]/.test(name)) name = 'value';
      let k = name;
      for (let i = 2; used.has(k) && used.get(k) !== exprText; i++) k = name + i;
      used.set(k, exprText);
      const lit = span.literal.getText(sf);
      t += '${' + exprText + '}:' + k + ':' + (ts.isTemplateTail(span.literal) ? lit.slice(1, -1) : lit.slice(1, -2));
    }
    out = out.slice(0, n.getStart(sf)) + t + '`' + out.slice(n.end);
  }
  fs.writeFileSync(file, out);
  console.log(rel, hits.length, '/', wanted.size, 'lines');
}
