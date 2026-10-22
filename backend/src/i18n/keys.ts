import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * Every message the server can show, found in the source: tr`…` keys and the fixed messages of
 * zod schemas. Used by the i18n test (every key needs a translation) and `npm run i18n:missing`.
 */
const ZOD_METHODS = new Set(['min', 'max', 'regex', 'uuid', 'datetime', 'refine', 'email', 'url', 'length', 'nonempty', 'int', 'positive', 'nonnegative', 'gte', 'lte', 'date']);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [join(dir, e.name)] : [],
  );
}

export function sourceKeys(srcDir: string): Map<string, string> {
  const keys = new Map<string, string>(); // key → first location
  for (const file of files(srcDir)) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const add = (key: string, node: ts.Node) => {
      if (!keys.has(key)) keys.set(key, `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
    };
    const visit = (n: ts.Node): void => {
      if (ts.isTaggedTemplateExpression(n) && n.tag.getText(sf) === 'tr') {
        const t = n.template;
        add(ts.isNoSubstitutionTemplateLiteral(t) ? t.text : t.head.text + t.templateSpans.map((s, i) => `{${i}}${s.literal.text}`).join(''), n);
      }
      if (ts.isStringLiteral(n) && /\p{L}{2,}/u.test(n.text)) {
        let call = n.parent;
        if (ts.isPropertyAssignment(call) && ['message', 'error'].includes(call.name.getText(sf))) call = call.parent.parent;
        if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && ZOD_METHODS.has(call.expression.name.text)) add(n.text, n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return keys;
}
