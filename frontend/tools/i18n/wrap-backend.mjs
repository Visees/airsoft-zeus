// Backend version of wrap-ts.mjs: wraps UI strings in tr`…` (request language) or, for texts other
// people read (notify title/body, activity/alert message, ledger reason), in (tr) => tr`…`.
// Zod schema messages are left alone (translated by exact match in zodFields).
// Usage: node wrap-backend.mjs <backend/src> <spec.json> [--dry]
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { candidates } from './ts-candidates.mjs';
import { walkTs } from './tpl-lib.mjs';

const root = path.resolve(process.argv[2]);
const spec = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const dry = process.argv.includes('--dry');

const ZOD_METHODS = new Set(['min', 'max', 'regex', 'uuid', 'datetime', 'refine', 'superRefine', 'email', 'url', 'length', 'nonempty', 'int', 'positive', 'nonnegative', 'gte', 'lte', 'startsWith', 'endsWith', 'includes', 'date', 'iso']);
const MSG_CALLS = { notify: ['title', 'body'], activity: ['message'], alert: ['message'], applyLedger: ['reason'] };
const SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP)\b|\bFROM\b|\bWHERE\b|\$\$\{|= \$\{|\$\d|\b(IS NOT NULL|IS NULL|IN \(|DESC|ASC|CASE WHEN)\b|coalesce\(|COALESCE\(|= \?|= (false|true)\b|^\w+\.\w+ (=|IN)|\w\.\*/;

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

function trText(n, sf) {
  if (ts.isStringLiteral(n)) return 'tr`' + esc(n.text) + '`';
  return 'tr' + n.getText(sf); // template literal keeps its ${…}
}

function zodContext(n) {
  let p = n.parent;
  if (ts.isPropertyAssignment(p) && ['message', 'error'].includes(p.name.getText())) p = p.parent.parent; // { message: '…' }
  return ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && ZOD_METHODS.has(p.expression.name.text);
}

/** The property (title/body/message/reason) of a writer call the node sits in, if any. */
function msgProperty(n) {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.parent) && ts.isCallExpression(p.parent.parent)) {
      const callee = p.parent.parent.expression.getText().split('.').pop();
      if (MSG_CALLS[callee]?.includes(p.name.getText())) return p;
      return null;
    }
    if (ts.isFunctionLike(p) || ts.isBlock(p)) return null;
  }
  return null;
}

/** Log lines, header names and values, keys and tokens: not UI text. */
function notText(c) {
  const v = c.text.trim();
  const p = c.node.parent;
  if (ts.isCallExpression(p) && /^(req\.)?(logger|log)\.\w+$/.test(p.expression.getText().replace(/\s+/g, ''))) return true;
  if (/^[A-Z][a-zA-Z]*(-[A-Z][a-zA-Z0-9]*)+$/.test(v)) return true; // Cache-Control
  if (/^[a-z]+[A-Z][A-Za-z]*$/.test(v)) return true; // eventId
  if (/^[A-Z0-9_]+$/.test(v)) return true; // HS256, SIGTERM
  if (/src '|max-age|charset=|filename=|^Helvetica|^[A-Z][a-z]+\/[A-Z]|^[a-z]{2}-[A-Z]{2}$/.test(v)) return true;
  return v === 'AirsoftHub';
}

let total = 0;
const report = [];
for (const file of walkTs(root)) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const s = spec[rel] ?? {};
  if (s.skip === 'all') continue;
  const src = fs.readFileSync(file, 'utf8');
  const list = candidates(file, src);
  if (!list.length) continue;
  const sf = list[0].node.getSourceFile();
  const chosen = list.filter((c, i) => !(s.skip ?? []).includes(i) && !SQL.test(c.text) && !zodContext(c.node) && !notText(c));
  const edits = [];
  const msgProps = new Map(); // property node → literals inside it
  for (const c of chosen) {
    const prop = msgProperty(c.node);
    if (prop) {
      if (!msgProps.has(prop)) msgProps.set(prop, []);
      msgProps.get(prop).push(c.node);
    } else edits.push({ start: c.start, end: c.end, text: trText(c.node, sf) });
  }
  for (const [prop, nodes] of msgProps) {
    const init = prop.initializer;
    let text = init.getText(sf);
    const base = init.getStart(sf);
    for (const n of [...nodes].sort((a, b) => b.getStart(sf) - a.getStart(sf))) {
      const a = n.getStart(sf) - base;
      text = text.slice(0, a) + trText(n, sf) + text.slice(a + (n.end - n.getStart(sf)));
    }
    const needsParens = !ts.isStringLiteral(init) && !ts.isTemplateLiteral(init) && !ts.isNoSubstitutionTemplateLiteral(init);
    edits.push({ start: base, end: init.end, text: `(tr) => ${needsParens ? '(' + text + ')' : text}` });
  }
  total += edits.length;
  report.push(`${rel}: ${edits.length}`);
  if (!dry) {
    let out = src;
    for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    fs.writeFileSync(file, out);
  } else {
    for (const e of edits) report.push('   ' + e.text.replace(/\s+/g, ' ').slice(0, 140));
  }
}
console.log(report.join('\n'));
console.log('edits', total);
