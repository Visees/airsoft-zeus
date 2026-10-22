// Third pass: untagged template literals whose static text has lowercase words (`${n} players`).
import fs from 'node:fs';
import ts from 'typescript';
import { walkTs } from './tpl-lib.mjs';

for (const file of walkTs(process.argv[2])) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out = [];
  const visit = (n) => {
    if (ts.isDecorator(n) || ts.isImportDeclaration(n) || ts.isTypeNode(n)) return;
    if (ts.isTaggedTemplateExpression(n)) return;
    if (ts.isTemplateExpression(n)) {
      const statics = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' ');
      if (/\b[a-z]{2,}\b/.test(statics) && !/px|rgba|translate|solid|calc|deg|url\(|var\(|^\/|\/\w|=|\?|#|%|\|/.test(statics)) {
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        out.push(`  ${line + 1}: ${n.getText(sf).replace(/\s+/g, ' ').slice(0, 150)}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (out.length) console.log(file.replace(/^.*src[\\/]app[\\/]/, '') + '\n' + out.join('\n'));
}
