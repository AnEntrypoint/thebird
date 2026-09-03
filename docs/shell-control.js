import { splitTopLevel, globToRe, tokenize } from './shell-parser.js';

export async function runScript(text, run, ctx) {
  let block = [];
  for (const s of text.split('\n').flatMap(l => splitTopLevel(l, [';']).map(p => p.cmd + ';')).map(x => x.trim()).filter(x => x !== ';')) {
    if (block.length || isControlStart(s)) { block.push(s); if (!isBlockOpen(block)) { await runControl(block.slice(), run, ctx); block = []; } continue; }
    await run(s.replace(/;$/, '').trim());
  }
}

export function isControlStart(cmd) {
  const t = cmd.trim();
  const first = t.split(/\s+/)[0];
  if (first === 'if' || first === 'while' || first === 'for' || first === 'case' || first === 'until' || first === 'select') return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)/.test(t)) return true;
  return false;
}

export function isBlockOpen(lines) {
  const joined = lines.join(' ').trim();
  let depth = 0;
  let braceDepth = 0;
  let inSingle = false, inDouble = false;
  let escape = false;
  let unquoted = '';
  for (const ch of joined) {
    if (escape) { escape = false; unquoted += ' '; continue; }
    if (ch === '\\' && !inSingle) { escape = true; unquoted += ' '; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; unquoted += ' '; }
    else if (ch === '"' && !inSingle) { inDouble = !inDouble; unquoted += ' '; }
    else if (!inSingle && !inDouble) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
      unquoted += (ch === ';') ? ' ' : ch;
    } else unquoted += ' ';
  }
  const tokens = unquoted.split(/\s+/);
  for (const t of tokens) {
    if (t === 'if' || t === 'while' || t === 'for' || t === 'case' || t === 'until' || t === 'select') depth++;
    if (t === 'fi' || t === 'done' || t === 'esac') depth--;
  }
  const fnOpen = /\{\s*$/.test(joined) || /\(\s*\)\s*$/.test(joined);
  const fnClose = /\}\s*$/.test(joined);
  return depth > 0 || braceDepth > 0 || (fnOpen && !fnClose);
}

export async function runControl(block, run, ctx) {
  const joined = block.join(' ').trim().replace(/;$/, '').trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)/.test(joined)) return defineFn(joined, ctx);
  if (joined.startsWith('if ')) return runIf(joined, run, ctx);
  if (joined.startsWith('while ')) return runWhile(joined, run, ctx, false);
  if (joined.startsWith('until ')) return runWhile(joined.replace(/^until /, 'while '), run, ctx, true);
  if (joined.startsWith('for ')) return runFor(joined, run, ctx);
  if (joined.startsWith('case ')) return runCase(joined, run, ctx);
  if (joined.startsWith('select ')) return runSelect(joined, run, ctx);
}

async function runSelect(text, run, ctx) {
  const m = text.match(/^select\s+(\w+)\s+in\s+(.+?)\s*;\s*do\s+(.+?)\s*;\s*done$/s);
  if (!m) throw new Error('select: parse error: ' + text);
  const [, varName, listExpr, body] = m;
  const items = listExpr.split(/\s+/).filter(Boolean);
  for (let i = 0; i < items.length; i++) ctx.term.write((i + 1) + ') ' + items[i] + '\r\n');
  for (const it of items) { ctx.env[varName] = it; await run(body); if (ctx.loopFlag === 'break') { ctx.loopFlag = null; break; } }
}

function defineFn(text, ctx) {
  const m = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{?\s*(.+?)\s*\}?\s*$/s);
  if (!m) throw new Error('function: parse error: ' + text);
  const [, name, body] = m;
  ctx.functions = ctx.functions || {};
  ctx.functions[name] = body.replace(/^\{\s*/, '').replace(/\s*\}$/, '').trim();
}

async function runIf(text, run, ctx) {
  const body = text.replace(/^if\s+/, '').replace(/\s*;\s*fi$/, '');
  const parts = body.split(/\s*;\s*(then|elif|else)\s*/).map(p => p.trim()).filter(p => p !== '');
  const branches = [];
  let i = 0;
  while (i < parts.length) {
    if (parts[i] === 'then' || parts[i] === 'elif' || parts[i] === 'else') { i++; continue; }
    if (parts[i - 1] === 'else') { branches.push({ cond: null, body: parts[i] }); i++; continue; }
    const cond = parts[i]; const bodyPart = parts[i + 2] || parts[i + 1];
    branches.push({ cond, body: bodyPart });
    i += (parts[i + 1] === 'then' ? 3 : 2);
  }
  for (const br of branches) {
    if (br.cond === null) { await run(br.body); return; }
    await run(br.cond);
    if (ctx.lastExitCode === 0) { await run(br.body); return; }
  }
}

async function runWhile(text, run, ctx, invert) {
  const m = text.match(/^while\s+(.+?)\s*;\s*do\s+(.+?)\s*;\s*done$/s);
  if (!m) throw new Error('while: parse error: ' + text);
  const [, cond, body] = m;
  const LOOP_CAP = 10000000;
  let guard = 0;
  ctx.loopFlag = null;
  while (guard < LOOP_CAP) {
    guard++;
    await run(cond);
    const ok = ctx.lastExitCode === 0;
    if ((invert ? ok : !ok)) break;
    await run(body);
    if (ctx.loopFlag === 'break') { ctx.loopFlag = null; break; }
    if (ctx.loopFlag === 'continue') ctx.loopFlag = null;
  }
  if (guard >= LOOP_CAP) ctx.term.write((invert ? 'until' : 'while') + ': loop terminated after ' + LOOP_CAP + ' iterations\r\n');
}

function forListItems(listExpr, ctx) {
  const words = tokenize(listExpr);
  const ifs = ctx.env && ctx.env.IFS !== undefined ? ctx.env.IFS : ' \t\n';
  const ifsRe = ifs.length ? new RegExp('[' + ifs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ']+') : null;
  const items = [];
  for (const w of words) {
    const expanded = ctx.expand ? ctx.expand(w) : w;
    if (ifsRe) items.push(...expanded.split(ifsRe).filter(Boolean));
    else items.push(expanded);
  }
  return items;
}

async function runFor(text, run, ctx) {
  const m = text.match(/^for\s+(\w+)\s+in\s+(.+?)\s*;\s*do\s+(.+?)\s*;\s*done$/s);
  if (!m) throw new Error('for: parse error: ' + text);
  const [, varName, listExpr, body] = m;
  const items = forListItems(listExpr, ctx);
  ctx.loopFlag = null;
  for (const item of items) {
    ctx.env[varName] = item;
    await run(body);
    if (ctx.loopFlag === 'break') { ctx.loopFlag = null; break; }
    if (ctx.loopFlag === 'continue') { ctx.loopFlag = null; continue; }
  }
}

async function runCase(text, run, ctx) {
  const m = text.match(/^case\s+(.+?)\s+in\s+(.+?)\s*;\s*esac$/s);
  if (!m) throw new Error('case: parse error: ' + text);
  const [, subject, body] = m;
  const sub = (ctx.expand ? ctx.expand(subject) : subject).trim();
  const rawClauses = body.split(/\s*(;;&|;&|;;)\s*/);
  const clauses = [];
  for (let i = 0; i < rawClauses.length; i += 2) {
    const text2 = rawClauses[i];
    if (!text2 || !text2.trim()) continue;
    const term = rawClauses[i + 1] || ';;';
    clauses.push({ text: text2, term });
  }
  let fallthrough = false;
  for (const clause of clauses) {
    const cm = clause.text.match(/^(.+?)\)\s*(.+)$/s);
    if (!cm) { fallthrough = false; continue; }
    const [, patterns, cmds] = cm;
    let matched = fallthrough;
    if (!matched) {
      for (const pat of patterns.split('|').map(s => s.trim())) {
        const re = globToRe(pat);
        if (re.test(sub)) { matched = true; break; }
      }
    }
    if (matched) {
      await run(cmds);
      if (clause.term === ';&') { fallthrough = true; continue; }
      if (clause.term === ';;&') { fallthrough = false; continue; }
      return;
    }
    fallthrough = false;
  }
}
