export function runSed(exprs, stdin, opts = {}) {
  const noAutoprint = !!opts.noAutoprint;
  const extended = !!opts.extended;
  const ops = exprs.flatMap(e => parseSed(e, extended));
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
      if (op.addr != null && !addrMatch(op, nr, pat, lines.length)) { pc++; continue; }
      if (op.cmd === 's') { const before = pat; pat = pat.replace(op.re, buildSedReplacer(op.rep)); lastSubOk = pat !== before; pc++; continue; }
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
      if (op.cmd === 'q') { if (!deleted && !noAutoprint && pat != null) out.push(pat); return out.join('\n'); }
      pc++;
    }
    if (!deleted && !noAutoprint && pat != null) out.push(pat);
    i++;
  }
  return out.join('\n');
}

// One raw address token (digits, $, or /regex/) as it appears on either side
// of a comma-range or standalone.
const ADDR_TOKEN = '(?:\\d+|\\/[^/]+\\/|\\$)';
function parseSed(expr, extended) {
  const out = [];
  for (const part of splitExprs(expr)) {
    const t = part.trim();
    if (!t) continue;
    const lbl = t.match(/^:(\w+)$/);
    if (lbl) { out.push({ cmd: ':', label: lbl[1] }); continue; }
    // addr1,addr2 range (e.g. '2,3p', '/start/,/end/d') -- sed ranges are
    // STATEFUL across the line loop: once addr1 matches, every line up to
    // and including the one matching addr2 is "in range", not just lines
    // whose number literally falls between two static numeric bounds (a
    // /regex/ endpoint can't be resolved to a line number ahead of time).
    // addrMatch below tracks the open/closed state on the op object itself
    // (each op is a fresh object per parseSed call, so this is safe reuse).
    const rangeM = t.match(new RegExp('^(' + ADDR_TOKEN + '),(' + ADDR_TOKEN + ')(.+)$'));
    const addrM = t.match(/^(\d+|\/[^/]+\/|\$)(.+)$/);
    let addr = null; let rest = t;
    if (rangeM && !t.startsWith('s')) { addr = { from: rangeM[1], to: rangeM[2], active: false }; rest = rangeM[3]; }
    else if (addrM && !t.startsWith('s')) { addr = addrM[1]; rest = addrM[2]; }
    if (rest[0] === 's' && rest.length > 1) {
      // Escape-aware s/// parse: an escaped delimiter (\<delim>) inside the pattern
      // or replacement is NOT a field terminator. The old `.+?\1.*?\1` regex split
      // on the first delimiter even when backslash-escaped, truncating e.g.
      // s/a\/b/c/. Scan the three fields honoring backslash escapes.
      const delim = rest[1];
      // scan one escape-aware field starting at index `start`; returns {text,next}
      // where next is the index just past the closing delimiter (or end-of-string).
      const scanField = (start) => {
        let cur = ''; let i = start;
        for (; i < rest.length; i++) {
          if (rest[i] === '\\' && i + 1 < rest.length) { cur += rest[i] + rest[i + 1]; i++; continue; }
          if (rest[i] === delim) { return { text: cur, next: i + 1, closed: true }; }
          cur += rest[i];
        }
        return { text: cur, next: i, closed: false };
      };
      const pf = scanField(2);
      const rf = scanField(pf.next);
      if (pf.closed && rf.closed) {
        const flags = rest.slice(rf.next);
        // unescape the delimiter so the regex/replacement see the literal char
        const unesc = s => s.replace(new RegExp('\\\\' + delim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), delim);
        // -E/-r (extended regex): ERE syntax already matches JS regex syntax
        // for grouping/alternation/quantifiers (bare ( ) | + ? are metachars
        // in both), so no BRE->JS translation is needed or correct -- running
        // bre2js on an ERE pattern would wrongly escape the user's literal
        // capture-group parens, breaking \N backreferences in the replacement.
        const pattern = extended ? posixClasses(unesc(pf.text)) : bre2js(posixClasses(unesc(pf.text)));
        // Real sed replacement text is 100% literal except &, \&, and \N
        // backreferences -- unlike JS String.replace()'s special-pattern
        // syntax ($$/$&/$`/$'/$N), which would otherwise silently hijack any
        // literal $ in the replacement (a `$5.00` price, a `$1` shell var
        // reference written as literal text, a regex anchor). Kept as raw
        // text here (unesc(rf.text), no $-escaping) and resolved via a
        // replacer FUNCTION at use time (see 's' handling in runSed below),
        // which JS never re-parses for $-sequences.
        const rep = unesc(rf.text);
        const reFlags = (flags.includes('g') ? 'g' : '') + (flags.includes('i') ? 'i' : '');
        out.push({ cmd: 's', addr, re: new RegExp(pattern, reFlags), rep });
        continue;
      }
    }
    const br = rest.match(/^([bt])\s*(\w*)$/);
    if (br) { out.push({ cmd: br[1], addr, label: br[2] || null }); continue; }
    const plain = rest.match(/^([dpPhHgGxnNDq])$/);
    if (plain) { out.push({ cmd: plain[1], addr }); continue; }
    const textM = rest.match(/^([aic])\\?\s*(.*)$/);
    if (textM) { out.push({ cmd: textM[1], addr, text: textM[2] }); continue; }
  }
  return out;
}

// Resolve a raw (unescaped-only-for-delimiter, otherwise fully literal) sed
// replacement string into a String.replace() REPLACER FUNCTION -- never a
// plain string, which would let JS reinterpret $$/$&/$`/$'/$N sequences that
// are meant to be literal text in POSIX sed. Real sed's replacement grammar:
// & = whole match, \& = literal '&', \N = the Nth capture group, \\ = literal
// backslash, anything else literal (including a bare $).
function buildSedReplacer(rep) {
  return (...args) => {
    // String.replace callback args: (match, p1, p2, ..., offset, fullString[, groups])
    const groups = args.slice(1, -2);
    const match = args[0];
    let out = '';
    for (let i = 0; i < rep.length; i++) {
      const c = rep[i];
      if (c === '\\' && i + 1 < rep.length) {
        const n = rep[i + 1];
        if (n === '&') { out += '&'; i++; continue; }
        if (n >= '1' && n <= '9') { out += groups[+n - 1] ?? ''; i++; continue; }
        if (n === '\\') { out += '\\'; i++; continue; }
        out += n; i++; continue;
      }
      if (c === '&') { out += match; continue; }
      out += c;
    }
    return out;
  };
}

// Translate BRE grouping/alternation/quantifier escapes to JS regex syntax:
// BRE \( \) \{ \} \| \+ \? are metachars (group/interval/alt/quantifier) in BRE
// but literal chars in JS, so strip the backslash; BRE bare ( ) { } | + ? are
// literal chars in BRE but metachars in JS, so escape them. \1-\9 backreferences
// are already valid JS syntax and pass through untouched.
function bre2js(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      if ('(){}|+?'.includes(n)) { out += n; i++; continue; }
      out += c + n; i++; continue;
    }
    if ('(){}|+?'.includes(c)) { out += '\\' + c; continue; }
    out += c;
  }
  return out;
}

// Expand POSIX bracket-expression classes ([[:digit:]] etc.) to their JS
// character-class fragment equivalents, in place within surrounding [...].
const POSIX_CLASSES = {
  digit: '0-9', alpha: 'A-Za-z', alnum: 'A-Za-z0-9', space: '\\s',
  upper: 'A-Z', lower: 'a-z', punct: '!-/:-@\\[-`{-~', blank: ' \\t',
  cntrl: '\\x00-\\x1f\\x7f', print: '\\x20-\\x7e', graph: '\\x21-\\x7e',
  xdigit: '0-9A-Fa-f',
};
export function posixClasses(s) {
  return s.replace(/\[:(\w+):\]/g, (m, name) => POSIX_CLASSES[name] ?? m);
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

function addrTokenMatch(addr, n, line, totalLines) {
  if (addr === '$') return n === totalLines;
  if (/^\d+$/.test(addr)) return +addr === n;
  const re = addr.match(/^\/(.+)\/$/);
  if (re) return new RegExp(re[1]).test(line);
  return false;
}

// op.addr is either a bare address string (single-line match) or a range
// object {from, to, active} for addr1,addr2 (mutated in place on op, which
// is safe: each op is a fresh object per parseSed() call). A range starts
// matching on the line where `from` matches and continues matching every
// subsequent line, INCLUSIVE, until the line where `to` matches -- real
// sed's actual semantics, not a static [n1,n2] line-number interval (an
// endpoint can be a /regex/ that isn't resolvable to a line number upfront).
function addrMatch(op, n, line, totalLines) {
  const addr = op.addr;
  if (typeof addr === 'string') return addrTokenMatch(addr, n, line, totalLines);
  if (!addr.active) {
    if (!addrTokenMatch(addr.from, n, line, totalLines)) return false;
    addr.active = true;
    // A purely-numeric `to` that's already <= the start line matches only
    // this one line (matches GNU sed's single-line-range edge case).
    if (/^\d+$/.test(addr.to) && +addr.to <= n) addr.active = false;
    return true;
  }
  if (addrTokenMatch(addr.to, n, line, totalLines)) addr.active = false;
  return true;
}
