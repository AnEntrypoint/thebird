export function runSed(exprs, stdin) {
  const ops = exprs.flatMap(parseSed);
  const lines = stdin.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let deleted = false;
    let printed = false;
    for (const op of ops) {
      if (op.addr != null && !addrMatch(op.addr, i + 1, line)) continue;
      if (op.cmd === 's') { line = line.replace(op.re, op.rep); continue; }
      if (op.cmd === 'd') { deleted = true; break; }
      if (op.cmd === 'p') { out.push(line); printed = true; continue; }
      if (op.cmd === 'a') { out.push(line); out.push(op.text); line = null; break; }
      if (op.cmd === 'i') { out.push(op.text); continue; }
      if (op.cmd === 'c') { line = op.text; continue; }
      if (op.cmd === 'q') { if (!deleted) out.push(line); return out.join('\n'); }
    }
    if (!deleted && line != null) out.push(line);
  }
  return out.join('\n');
}

function parseSed(expr) {
  const out = [];
  for (const part of splitExprs(expr)) {
    const t = part.trim();
    if (!t) continue;
    const addrM = t.match(/^(\d+|\/[^/]+\/|\$)(.+)$/);
    let addr = null; let rest = t;
    if (addrM && !t.startsWith('s')) { addr = addrM[1]; rest = addrM[2]; }
    const sM = rest.match(/^s(.)(.+?)\1(.*?)\1([gip]*)$/);
    if (sM) { out.push({ cmd: 's', addr, re: new RegExp(sM[2], sM[4].includes('g') ? 'g' : ''), rep: sM[3] }); continue; }
    const plain = rest.match(/^([dpq])$/);
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

function addrMatch(addr, n, line) {
  if (addr === '$') return false;
  if (/^\d+$/.test(addr)) return +addr === n;
  const re = addr.match(/^\/(.+)\/$/);
  if (re) return new RegExp(re[1]).test(line);
  return false;
}
