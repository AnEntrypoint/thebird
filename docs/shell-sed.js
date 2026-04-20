export function runSed(exprs, stdin) {
  const ops = exprs.flatMap(parseSed);
  const labels = {};
  ops.forEach((op, i) => { if (op.cmd === ':') labels[op.label] = i; });
  const lines = stdin.split('\n');
  const out = [];
  let pat = null, hold = '';
  let nr = 0;
  let i = 0;
  while (i < lines.length) {
    pat = lines[i]; nr = i + 1;
    let pc = 0, deleted = false, lastSubOk = false;
    while (pc < ops.length) {
      const op = ops[pc];
      if (op.cmd === ':') { pc++; continue; }
      if (op.addr != null && !addrMatch(op.addr, nr, pat, lines.length)) { pc++; continue; }
      if (op.cmd === 's') { const before = pat; pat = pat.replace(op.re, op.rep); lastSubOk = pat !== before; pc++; continue; }
      if (op.cmd === 'd') { deleted = true; break; }
      if (op.cmd === 'p') { out.push(pat); pc++; continue; }
      if (op.cmd === 'P') { out.push(pat.split('\n')[0]); pc++; continue; }
      if (op.cmd === 'h') { hold = pat; pc++; continue; }
      if (op.cmd === 'H') { hold += '\n' + pat; pc++; continue; }
      if (op.cmd === 'g') { pat = hold; pc++; continue; }
      if (op.cmd === 'G') { pat += '\n' + hold; pc++; continue; }
      if (op.cmd === 'x') { const t = pat; pat = hold; hold = t; pc++; continue; }
      if (op.cmd === 'n') { out.push(pat); i++; if (i >= lines.length) { pat = null; break; } pat = lines[i]; nr = i + 1; pc++; continue; }
      if (op.cmd === 'N') { i++; if (i >= lines.length) break; pat += '\n' + lines[i]; nr = i + 1; pc++; continue; }
      if (op.cmd === 'D') { const nl = pat.indexOf('\n'); if (nl < 0) { deleted = true; break; } pat = pat.slice(nl + 1); pc = 0; continue; }
      if (op.cmd === 'b') { pc = op.label ? (labels[op.label] ?? ops.length) : ops.length; continue; }
      if (op.cmd === 't') { if (lastSubOk) { lastSubOk = false; pc = op.label ? (labels[op.label] ?? ops.length) : ops.length; continue; } pc++; continue; }
      if (op.cmd === 'a') { out.push(pat); out.push(op.text); pat = null; break; }
      if (op.cmd === 'i') { out.push(op.text); pc++; continue; }
      if (op.cmd === 'c') { pat = op.text; pc++; continue; }
      if (op.cmd === 'q') { if (!deleted && pat != null) out.push(pat); return out.join('\n'); }
      pc++;
    }
    if (!deleted && pat != null) out.push(pat);
    i++;
  }
  return out.join('\n');
}

function parseSed(expr) {
  const out = [];
  for (const part of splitExprs(expr)) {
    const t = part.trim();
    if (!t) continue;
    const lbl = t.match(/^:(\w+)$/);
    if (lbl) { out.push({ cmd: ':', label: lbl[1] }); continue; }
    const addrM = t.match(/^(\d+|\/[^/]+\/|\$)(.+)$/);
    let addr = null; let rest = t;
    if (addrM && !t.startsWith('s')) { addr = addrM[1]; rest = addrM[2]; }
    const sM = rest.match(/^s(.)(.+?)\1(.*?)\1([gip]*)$/);
    if (sM) { out.push({ cmd: 's', addr, re: new RegExp(sM[2], sM[4].includes('g') ? 'g' : ''), rep: sM[3] }); continue; }
    const br = rest.match(/^([bt])\s*(\w*)$/);
    if (br) { out.push({ cmd: br[1], addr, label: br[2] || null }); continue; }
    const plain = rest.match(/^([dpPhHgGxnNDq])$/);
    if (plain) { out.push({ cmd: plain[1], addr }); continue; }
    const textM = rest.match(/^([aic])\\?\s*(.*)$/);
    if (textM) { out.push({ cmd: textM[1], addr, text: textM[2] }); continue; }
  }
  return out;
}

function splitExprs(s) {
  const out = []; let cur = ''; let escape = false;
  for (const c of s) {
    if (escape) { cur += c; escape = false; continue; }
    if (c === '\\') { cur += c; escape = true; continue; }
    if (c === ';') { if (cur) out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function addrMatch(addr, n, line, totalLines) {
  if (addr === '$') return n === totalLines;
  if (/^\d+$/.test(addr)) return +addr === n;
  const re = addr.match(/^\/(.+)\/$/);
  if (re) return new RegExp(re[1]).test(line);
  return false;
}
