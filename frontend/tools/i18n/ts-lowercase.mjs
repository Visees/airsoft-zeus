// Second pass for ts-candidates.mjs: lowercase words and phrases ('never', 'gets', 'not yet') that the
// first pass skips as probable keys. Prints them with their line for review.
import fs from 'node:fs';
import ts from 'typescript';
import { walkTs } from './tpl-lib.mjs';

const KEYISH = /^(selector|template|id|key|kind|type|name|icon|tone|variant|class|cls|route|path|href|link|url|mode|status|scope|code|value|field|glyph|color|pattern|size|side|align|role|format|accept|inputmode|autocomplete|ext|mime|contentType|filename|storageKey|channel|event|state|method|action|section|tab|priority|level|severity|geometry|target|unit|precision|visibility|teamSelection|allies|enemies|when|by|layout|position|sort|dir|order|outcome|reason_code|font|weight)$/;

for (const file of walkTs(process.argv[2])) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out = [];
  const visit = (n) => {
    if (ts.isDecorator(n) || ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isTypeNode(n)) return;
    if (ts.isTaggedTemplateExpression(n)) return;
    if (ts.isStringLiteral(n)) {
      const v = n.text;
      const p = n.parent;
      if (!/^[a-z][a-z ’']*[a-z]$/.test(v) || v.length < 3) return;
      if (ts.isPropertyAssignment(p) && (p.name === n || KEYISH.test(p.name.getText(sf)))) return;
      if (ts.isBinaryExpression(p) && /=|in/.test(ts.tokenToString(p.operatorToken.kind) ?? '')) return;
      if (ts.isCaseClause(p) || ts.isElementAccessExpression(p) || ts.isPropertyAccessExpression(p)) return;
      if (ts.isCallExpression(p) || ts.isNewExpression(p)) return; // arguments: events, keys, selectors
      if (ts.isArrayLiteralExpression(p) && ts.isAsExpression(p.parent)) return; // const tuples
      if (ts.isParameter(p) || ts.isEnumMember(p)) return;
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      out.push(`  ${line + 1}: '${v}'  ←  ${p.getText(sf).replace(/\s+/g, ' ').slice(0, 100)}`);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (out.length) console.log(file.replace(/^.*src[\\/]app[\\/]/, '') + '\n' + out.join('\n'));
}
