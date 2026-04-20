export function runAwk(program, stdin, fs_sep) {
  const fs = fs_sep || /\s+/;
  const blocks = parseAwk(program);
  const out = [];
  const ctx = { NR: 0, vars: {} };
  const emit = s => out.push(s);
  for (const b of blocks.filter(b => b.when === 'BEGIN')) execAction(b.action, { $: [], NR: 0, NF: 0 }, emit, ctx);
  const lines = (stdin || '').split('\n');
  const effective = lines.length > 0 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  for (const line of effective) {
    ctx.NR++;
    const fields = line.split(fs).filter((_, i, a) => i > 0 || a.length === 1 || _ !== '');
    const rec = { $: [line, ...fields], NR: ctx.NR, NF: fields.length };
    for (const b of blocks.filter(b => b.when !== 'BEGIN' && b.when !== 'END')) {
      if (!b.when || matchCond(b.when, rec, ctx)) execAction(b.action, rec, emit, ctx);
    }
  }
  for (const b of blocks.filter(b => b.when === 'END')) execAction(b.action, { $: [], NR: ctx.NR, NF: 0 }, emit, ctx);
  return out.join('\n');
}

function parseAwk(prog) {
  const blocks = [];
  let i = 0;
  while (i < prog.length) {
    while (i < prog.length && /\s/.test(prog[i])) i++;
    if (i >= prog.length) break;
    let when = '';
    while (i < prog.length && prog[i] !== '{') { when += prog[i++]; }
    when = when.trim();
    if (prog[i] !== '{') { if (when) blocks.push({ when, action: 'print' }); break; }
    let depth = 1; i++;
    let action = '';
    while (i < prog.length && depth > 0) {
      if (prog[i] === '{') depth++;
      else if (prog[i] === '}') { depth--; if (!depth) break; }
      action += prog[i++];
    }
    i++;
    blocks.push({ when: when || null, action: action.trim() || 'print' });
  }
  return blocks;
}

function matchCond(cond, rec, ctx) {
  const re = cond.match(/^\/(.+)\/$/);
  if (re) return new RegExp(re[1]).test(rec.$[0]);
  const cmp = cond.match(/^\$(\d+)\s*(==|!=|<|>|~)\s*"(.*)"$/);
  if (cmp) { const v = rec.$[+cmp[1]] || ''; const OPS = { '==': v === cmp[3], '!=': v !== cmp[3], '<': v < cmp[3], '>': v > cmp[3], '~': new RegExp(cmp[3]).test(v) }; return OPS[cmp[2]]; }
  if (cond === 'NR==1') return rec.NR === 1;
  try { return !!Function('$', 'NR', 'NF', 'return (' + cond.replace(/\$(\d+)/g, (_, n) => '$[' + n + ']') + ')')(rec.$, rec.NR, rec.NF); } catch { return false; }
}

function execAction(action, rec, emit, ctx) {
  for (const stmt of action.split(';').map(s => s.trim()).filter(Boolean)) {
    const pr = stmt.match(/^print\s*(.*)$/);
    if (pr) { emit(evalPrint(pr[1] || '$0', rec, ctx)); continue; }
    const printf = stmt.match(/^printf\s+(.+)$/);
    if (printf) { const parts = splitTop(printf[1], ','); const vals = parts.map(p => evalExpr(p.trim(), rec, ctx)); emit(AWK_FNS.sprintf(vals[0], ...vals.slice(1))); continue; }
    const assign = stmt.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (assign) { ctx.vars[assign[1]] = evalExpr(assign[2], rec, ctx); continue; }
    if (stmt === 'next') { ctx.skipRest = true; continue; }
    try { evalExpr(stmt, rec, ctx); } catch {}
  }
}

function evalPrint(args, rec, ctx) {
  if (!args) return rec.$[0] || '';
  const parts = splitTop(args, ',');
  return parts.map(p => String(evalExpr(p.trim(), rec, ctx))).join(' ');
}

const AWK_FNS = {
  length: s => String(s ?? '').length,
  substr: (s, i, n) => String(s).substr((i|0) - 1, n == null ? undefined : n|0),
  tolower: s => String(s).toLowerCase(),
  toupper: s => String(s).toUpperCase(),
  index: (s, t) => String(s).indexOf(String(t)) + 1,
  match: (s, re) => { const m = String(s).match(new RegExp(re)); return m ? m.index + 1 : 0; },
  split: (s, arr, re) => { const parts = String(s).split(new RegExp(re || /\s+/)); for (let i = 0; i < parts.length; i++) arr[i + 1] = parts[i]; return parts.length; },
  sub: (re, rep, s) => { const r = new RegExp(re); const v = String(s ?? ''); return v.replace(r, rep); },
  gsub: (re, rep, s) => { const r = new RegExp(re, 'g'); const v = String(s ?? ''); return v.replace(r, rep); },
  sprintf: (fmt, ...a) => { let i = 0; return String(fmt).replace(/%([sdfox])/g, (_, k) => { const v = a[i++]; if (k === 'd') return String(parseInt(v, 10) || 0); if (k === 's') return String(v ?? ''); if (k === 'f') return String(parseFloat(v) || 0); if (k === 'x') return (parseInt(v, 10) || 0).toString(16); if (k === 'o') return (parseInt(v, 10) || 0).toString(8); return ''; }); },
};

function evalExpr(expr, rec, ctx) {
  const s = expr.trim();
  const strM = s.match(/^"(.*)"$/);
  if (strM) return strM[1];
  const fldM = s.match(/^\$(\d+|NF)$/);
  if (fldM) { const n = fldM[1] === 'NF' ? rec.NF : +fldM[1]; return rec.$[n] || ''; }
  if (s === 'NR') return rec.NR;
  if (s === 'NF') return rec.NF;
  if (ctx.vars[s] !== undefined) return ctx.vars[s];
  const num = +s;
  if (!isNaN(num)) return num;
  try {
    const body = 'return (' + s.replace(/\$(\d+|NF)/g, (_, n) => n === 'NF' ? 'NF' : '$[' + n + ']').replace(/\b([A-Za-z_]\w*)\b/g, (_, n) => AWK_FNS[n] ? 'F.' + n : 'v.' + n) + ')';
    return Function('$', 'NR', 'NF', 'v', 'F', body)(rec.$, rec.NR, rec.NF, ctx.vars, AWK_FNS) ?? '';
  } catch { return s; }
}

function splitTop(s, sep) {
  const out = []; let cur = ''; let depth = 0; let inStr = false;
  for (const c of s) {
    if (c === '"') inStr = !inStr;
    else if (!inStr) { if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--; }
    if (c === sep && !inStr && !depth) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
