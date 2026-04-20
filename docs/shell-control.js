export function isControlStart(cmd) {
  const t = cmd.trim();
  const first = t.split(/\s+/)[0];
  if (first === 'if' || first === 'while' || first === 'for' || first === 'case' || first === 'until') return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)/.test(t)) return true;
  return false;
}

export function isBlockOpen(lines) {
  const joined = lines.join(' ').trim();
  let depth = 0;
  const tokens = joined.split(/\s+/);
  for (const t of tokens) {
    if (t === 'if' || t === 'while' || t === 'for' || t === 'case' || t === 'until') depth++;
    if (t === 'fi' || t === 'done' || t === 'esac') depth--;
  }
  const fnOpen = /\{\s*$/.test(joined) || /\(\s*\)\s*$/.test(joined);
  const fnClose = /\}\s*$/.test(joined);
  let braceDepth = 0;
  let inSingle = false, inDouble = false;
  for (const ch of joined) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }
  }
  return depth > 0 || braceDepth > 0 || (fnOpen && !fnClose);
}

export async function runControl(block, run, ctx) {
  const joined = block.join(' ').trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)/.test(joined)) return defineFn(joined, ctx);
  if (joined.startsWith('if ')) return runIf(joined, run, ctx);
  if (joined.startsWith('while ')) return runWhile(joined, run, ctx, false);
  if (joined.startsWith('until ')) return runWhile(joined.replace(/^until /, 'while '), run, ctx, true);
  if (joined.startsWith('for ')) return runFor(joined, run, ctx);
  if (joined.startsWith('case ')) return runCase(joined, run, ctx);
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
  const parts = body.split(/\s*;\s*(?=then|elif|else)\s*/);
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
  let guard = 0;
  ctx.loopFlag = null;
  while (guard++ < 10000) {
    await run(cond);
    const ok = ctx.lastExitCode === 0;
    if ((invert ? ok : !ok)) break;
    await run(body);
    if (ctx.loopFlag === 'break') { ctx.loopFlag = null; break; }
    if (ctx.loopFlag === 'continue') ctx.loopFlag = null;
  }
}

async function runFor(text, run, ctx) {
  const m = text.match(/^for\s+(\w+)\s+in\s+(.+?)\s*;\s*do\s+(.+?)\s*;\s*done$/s);
  if (!m) throw new Error('for: parse error: ' + text);
  const [, varName, listExpr, body] = m;
  const items = listExpr.split(/\s+/).filter(Boolean);
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
  const clauses = body.split(/\s*;;\s*/).filter(Boolean);
  for (const clause of clauses) {
    const cm = clause.match(/^(.+?)\)\s*(.+)$/s);
    if (!cm) continue;
    const [, patterns, cmds] = cm;
    for (const pat of patterns.split('|').map(s => s.trim())) {
      const re = new RegExp('^' + pat.replace(/[-[\]{}()+.,\\^$|#]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      if (re.test(sub)) { await run(cmds); return; }
    }
  }
}
