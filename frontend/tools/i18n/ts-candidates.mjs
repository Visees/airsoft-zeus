// Lists string literals in TS code (outside templates) that look like UI text, numbered per file.
// Usage: node ts-candidates.mjs <file...>  → prints "file" then "  #n line: text"
// The numbers are stable for an unchanged file and are what wrap-ts.mjs takes.
import fs from 'node:fs';
import ts from 'typescript';

const SKIP_CALLS = /^(inject|console\.\w+|safeStorage\.\w+|localStorage\.\w+|\w+\.setAttribute|\w+\.getAttribute|\w+\.classList\.\w+|\w+\.querySelector(All)?|provideIcons|\w*addEventListener|\w*removeEventListener|\w*navigateByUrl|\w*navigate|new URL|new Date|\w*\.on|\w*\.emit|\w*\.get|\w*\.post|\w*\.put|\w*\.patch|\w*\.delete|\w*\.append|\w*\.set|\w*\.has|\w*\.startsWith|\w*\.endsWith|\w*\.includes|\w*\.split|\w*\.replace|\w*\.join|\w*\.padStart|\w*\.toLocale\w+|Intl\.\w+|matchMedia|\w*\.matchMedia|\w*\.createElement|\w*\.getPropertyValue|\w*\.setProperty|\w*\.removeAttribute|\w*\.toggleAttribute|\w*\.dispatchEvent|CustomEvent|\w*\.subscribe|\w*\.refresh|\w*\.request|HttpParams|\w*\.params|\w*\.headers?)$/;

export function candidates(file, src) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out = [];
  const visit = (n) => {
    // Skip decorators (component metadata: selector, template, host...), imports, types.
    if (ts.isDecorator(n) || ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isTypeNode(n) || ts.isLiteralTypeNode?.(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      if (ts.isTaggedTemplateExpression(n.parent)) return; // already $localize`...`
      const text = ts.isTemplateExpression(n) ? n.getText(sf).slice(1, -1) : n.text;
      const p = n.parent;
      if (ts.isPropertyAssignment(p) && p.name === n) return;
      if (ts.isElementAccessExpression(p)) return;
      if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return;
      if (ts.isCaseClause(p)) return;
      if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression && SKIP_CALLS.test(p.expression.getText(sf).replace(/\s+/g, ''))) return;
      if (ts.isPropertyAssignment(p) && /^(selector|template|id|key|kind|type|name|icon|tone|variant|class|route|path|href|link|url|mode|status|scope|code|value|field|glyph|color|pattern|size|side|align|role|format|accept|inputmode|autocomplete|ext|mime|contentType|filename|storageKey|dataGroup|channel|event)$/.test(p.name.getText(sf))) return;
      const plain = text.replace(/\$\{[^}]*\}/g, ' ');
      if (!/\p{L}{2,}/u.test(plain)) return;
      if (/^[a-z0-9_.:\-\/#@*]+$/.test(plain.trim())) return; // keys, css, ids, paths
      if (/^lucide|^zeus|^\/|^https?:|^\.|^#|^\[|^data:|^image\/|^application\//.test(plain.trim())) return;
      if (/^[a-z0-9_\-\s:\/\[\]\.!%()=&>]+$/.test(plain) && /-|:/.test(plain)) return; // tailwind class lists
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      out.push({ node: n, start: n.getStart(sf), end: n.end, line: line + 1, text });
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

if (process.argv[1].endsWith('ts-candidates.mjs')) {
  for (const file of process.argv.slice(2)) {
    const src = fs.readFileSync(file, 'utf8');
    const c = candidates(file, src);
    if (!c.length) continue;
    console.log(file.replace(/^.*src\/app\//, ''));
    c.forEach((x, i) => console.log(`  #${i} ${x.line}: ${x.text.replace(/\s+/g, ' ').slice(0, 150)}`));
  }
}
