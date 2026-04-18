export function isControlStart(cmd) {
  const first = cmd.trim().split(/\s+/)[0];
  return first === 'if' || first === 'while' || first === 'for';
}

export function isBlockOpen(lines) {
  const joined = lines.join(' ').trim();
  const depth = countDepth(joined);
  return depth > 0;
}

function countDepth(text) {
  let depth = 0;
  const tokens = text.split(/\s+/);
  for (const t of tokens) {
    if (t === 'if' || t === 'while' || t === 'for') depth++;
    if (t === 'fi' || t === 'done') depth--;
  }
  return depth;
}

export async function runControl(block, run, ctx) {
  const joined = block.join(' ').trim();
  if (joined.startsWith('if ')) return runIf(joined, run, ctx);
  if (joined.startsWith('while ')) return runWhile(joined, run, ctx);
  if (joined.startsWith('for ')) return runFor(joined, run, ctx);
}

async function runIf(text, run, ctx) {
  const m = text.match(/^if\s+(.+?)\s*;\s*then\s+(.+?)(?:\s*;\s*else\s+(.+?))?\s*;\s*fi$/s);
  if (!m) throw new Error('if: parse error: ' + text);
  const [, cond, thenBody, elseBody] = m;
  await run(cond);
  if (ctx.lastExitCode === 0) await run(thenBody);
  else if (elseBody) await run(elseBody);
}

async function runWhile(text, run, ctx) {
  const m = text.match(/^while\s+(.+?)\s*;\s*do\s+(.+?)\s*;\s*done$/s);
  if (!m) throw new Error('while: parse error: ' + text);
  const [, cond, body] = m;
  let guard = 0;
  while (guard++ < 1000) {
    await run(cond);
    if (ctx.lastExitCode !== 0) break;
    await run(body);
  }
}

async function runFor(text, run, ctx) {
  const m = text.match(/^for\s+(\w+)\s+in\s+(.+?)\s*;\s*do\s+(.+?)\s*;\s*done$/s);
  if (!m) throw new Error('for: parse error: ' + text);
  const [, varName, listExpr, body] = m;
  const items = listExpr.split(/\s+/).filter(Boolean);
  for (const item of items) {
    ctx.env[varName] = item;
    await run(body);
  }
}
