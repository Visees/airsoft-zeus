// Lists tr`…` evaluated at module load (outside any function): they would always be English.
import fs from 'node:fs';
import ts from 'typescript';
import { walkTs } from './tpl-lib.mjs';

for (const file of walkTs(process.argv[2])) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const visit = (n, inFn) => {
    if (ts.isFunctionLike(n)) inFn = true;
    if (ts.isTaggedTemplateExpression(n) && n.tag.getText(sf) === 'tr' && !inFn) {
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      console.log(`${file.replace(/^.*src[\\/]/, '')}:${line + 1}: ${n.getText(sf).slice(0, 80)}`);
    }
    ts.forEachChild(n, (c) => visit(c, inFn));
  };
  visit(sf, false);
}
