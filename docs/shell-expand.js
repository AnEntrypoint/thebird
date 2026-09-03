export function expandParam(name, env, argv, lastExit, arrays, nounset) {
  if (name === '?') return String(lastExit ?? 0);
  if (name === '!') return env['!'] || '';
  if (name === '$') return env.$ || '0';
  if (name === '#') return String((argv || []).length > 0 ? (argv || []).length - 1 : 0);
  if (name === '@' || name === '*') return (argv || []).slice(1).join(' ');
  if (name === '0') return (argv || [])[0] || '';
  if (/^[1-9]$/.test(name)) return (argv || [])[parseInt(name)] || '';
  const arrM = name.match(/^([A-Za-z_][A-Za-z0-9_]*)\[(.+?)\]$/);
  if (arrM && arrays) {
    const a = arrays[arrM[1]];
    if (a == null) return '';
    if (arrM[2] === '@' || arrM[2] === '*') return Array.isArray(a) ? a.join(' ') : Object.values(a).join(' ');
    if (Array.isArray(a)) return a[parseInt(arrM[2], 10)] || '';
    return a[arrM[2]] || '';
  }
  const lenArrM = name.match(/^#([A-Za-z_][A-Za-z0-9_]*)\[@\]$/);
  if (lenArrM && arrays) { const a = arrays[lenArrM[1]] || []; return String(Array.isArray(a) ? a.length : Object.keys(a).length); }
  // set -u (nounset): referencing an unset variable is a hard error in real
  // bash, not silent empty-string substitution. Only the bare $NAME form is
  // gated here (matches bash's actual scope for nounset) -- ${NAME:-default}
  // and friends are intentionally exempt since they have their own explicit
  // default-value semantics in expandParamOp, not a "variable is unset" bug.
  if (nounset && !(name in env) && !(arrays && name in arrays)) throw new Error(name + ': unbound variable');
  if (env[name] === undefined && arrays && arrays[name] != null) {
    const a = arrays[name];
    return String((Array.isArray(a) ? a[0] : a['0']) ?? '');
  }
  return env[name] ?? '';
}

export function expandParamOp(expr, env, argv, lastExit, arrays, runCap, nounset) {
  if (expr.startsWith('!')) {
    const prefM = expr.match(/^!([A-Za-z_]\w*)([@*])$/);
    if (prefM) return Object.keys(env).filter(k => k.startsWith(prefM[1])).join(' ');
    const keysM = expr.match(/^!([A-Za-z_]\w*)\[[@*]\]$/);
    if (keysM && arrays) { const a = arrays[keysM[1]] || []; return Array.isArray(a) ? a.map((_, i) => i).join(' ') : Object.keys(a).join(' '); }
    const indM = expr.match(/^!([A-Za-z_]\w*)$/);
    if (indM) { const t = env[indM[1]]; return t ? expandParam(t, env, argv, lastExit, arrays) : ''; }
  }
  const caseM = expr.match(/^([A-Za-z_][A-Za-z0-9_]*|@)(\^\^|,,|\^|,)(.*)$/s);
  if (caseM) {
    const v = expandParam(caseM[1], env, argv, lastExit, arrays);
    const op = caseM[2];
    if (op === '^^') return v.toUpperCase();
    if (op === ',,') return v.toLowerCase();
    if (op === '^') return v.charAt(0).toUpperCase() + v.slice(1);
    if (op === ',') return v.charAt(0).toLowerCase() + v.slice(1);
  }
  const qM = expr.match(/^([A-Za-z_][A-Za-z0-9_]*|@)@([QEP])$/);
  if (qM) {
    const v = expandParam(qM[1], env, argv, lastExit, arrays);
    if (qM[2] === 'Q') return "'" + v.replace(/'/g, "'\\''") + "'";
    if (qM[2] === 'E') return v.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    if (qM[2] === 'P') return v;
  }
  const lenArrM = expr.match(/^#([A-Za-z_]\w*)\[[@*]\]$/);
  if (lenArrM) { const a = (arrays || {})[lenArrM[1]] || []; return String(Array.isArray(a) ? a.length : Object.keys(a).length); }
  const lenM = expr.match(/^#(.+)$/);
  if (lenM) return String(expandParam(lenM[1], env, argv, lastExit, arrays).length);
  const sliceM = expr.match(/^([^:]+):(\s*-?\d+)(?::(\s*-?\d+))?$/);
  if (sliceM) {
    const v = expandParam(sliceM[1], env, argv, lastExit, arrays);
    let s = parseInt(sliceM[2], 10);
    if (s < 0) s = Math.max(0, v.length + s);
    if (sliceM[3] !== undefined) {
      let len = parseInt(sliceM[3], 10);
      if (len < 0) return v.slice(s, Math.max(s, v.length + len));
      return v.slice(s, s + len);
    }
    return v.slice(s);
  }
  const defM = expr.match(/^([A-Za-z_][A-Za-z0-9_]*|\?|#|@|[0-9])(:-|:=|:\?|:\+|-|=|\+)(.*)$/s);
  if (defM) {
    const [, name, op, defRaw] = defM;
    const def = /[$`]/.test(defRaw) ? fullExpand(defRaw, env, lastExit, argv, runCap, arrays, nounset) : defRaw;
    const v = expandParam(name, env, argv, lastExit, arrays);
    const defined = v !== '' && v != null;
    if (op === ':-' || op === '-') return defined ? v : def;
    if (op === ':=' || op === '=') { if (!defined) env[name] = def; return defined ? v : def; }
    if (op === ':?' || op === '?') { if (!defined) throw new Error(name + ': ' + (def || 'parameter null')); return v; }
    if (op === ':+' || op === '+') return defined ? def : '';
  }
  const sufM = expr.match(/^([A-Za-z_][A-Za-z0-9_]*|@|#)(%%?|##?)(.+)$/s);
  if (sufM) {
    const [, name, op, pat] = sufM;
    const v = expandParam(name, env, argv, lastExit, arrays);
    const bare = globReLine(pat).replace(/^\^|\$$/g, '');
    if (op === '#') { const m = v.match(new RegExp('^' + bare)); return m ? v.slice(m[0].length) : v; }
    if (op === '##') { const m = v.match(new RegExp('^' + bare.replace(/\.\*/g, '.*?') + '.*')); return m ? '' : v; }
    if (op === '%') { const m = v.match(new RegExp(bare + '$')); return m ? v.slice(0, -m[0].length) : v; }
    if (op === '%%') { const m = v.match(new RegExp('^.*' + bare + '$')); return m ? '' : v; }
  }
  const subM = expr.match(/^([A-Za-z_][A-Za-z0-9_]*|@)\/(\/?)(.+?)\/(.*)$/s);
  if (subM) {
    const [, name, all, pat, rep] = subM;
    const v = expandParam(name, env, argv, lastExit, arrays);
    return v.replace(new RegExp(globReLine(pat).replace(/^\^|\$$/g, ''), all ? 'g' : ''), rep);
  }
  return expandParam(expr, env, argv, lastExit, arrays);
}

function globReLine(pat) { return '^' + pat.replace(/[-[\]{}()+.,\\^$|#]/g, (c) => (c === '*' || c === '?') ? c : '\\' + c).replace(/\*/g, '.*').replace(/\?/g, '.') + '$'; }

export function evalArith(expr, env) {
  const src = expr.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (_, n) => String(parseInt(env[n], 10) || 0));
  if (!/^[-+*/%()<>=!&|^~\s\d?:#]+$/.test(src)) return 0;
  try { return parseArith(src) | 0; } catch (e) { console.error('[shell] arithmetic expression error:', expr, e.message); return 0; }
}

// Recursive-descent arithmetic evaluator: grammar is bounded by construction
// (ternary, ||, &&, comparisons, +-, */%, unary, parens, numbers) rather than
// by a character-allowlist regex feeding a general-purpose eval.
function parseArith(src) {
  let i = 0;
  const len = src.length;
  function skip() { while (i < len && /\s/.test(src[i])) i++; }
  function peek(n) { skip(); return src.slice(i, i + n); }
  function eat(tok) { skip(); if (src.slice(i, i + tok.length) !== tok) throw new Error('expected ' + tok + ' at ' + i); i += tok.length; return tok; }
  function parseTernary() {
    let cond = parseOr();
    skip();
    if (src[i] === '?') {
      i++;
      const a = parseTernary();
      eat(':');
      const b = parseTernary();
      return cond ? a : b;
    }
    return cond;
  }
  function parseOr() {
    let v = parseAnd();
    while (peek(2) === '||') { eat('||'); const r = parseAnd(); v = (v || r) ? 1 : 0; }
    return v;
  }
  function parseAnd() {
    let v = parseBitOr();
    while (peek(2) === '&&') { eat('&&'); const r = parseBitOr(); v = (v && r) ? 1 : 0; }
    return v;
  }
  function parseBitOr() {
    let v = parseBitXor();
    for (;;) {
      skip();
      if (src[i] === '|' && src[i + 1] !== '|') { i++; const r = parseBitXor(); v = v | r; continue; }
      break;
    }
    return v;
  }
  function parseBitXor() {
    let v = parseBitAnd();
    for (;;) {
      skip();
      if (src[i] === '^') { i++; const r = parseBitAnd(); v = v ^ r; continue; }
      break;
    }
    return v;
  }
  function parseBitAnd() {
    let v = parseCmp();
    for (;;) {
      skip();
      if (src[i] === '&' && src[i + 1] !== '&') { i++; const r = parseCmp(); v = v & r; continue; }
      break;
    }
    return v;
  }
  function parseCmp() {
    let v = parseShift();
    for (;;) {
      skip();
      const two = src.slice(i, i + 2);
      if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
        i += 2; const r = parseShift();
        if (two === '==') v = (v === r) ? 1 : 0;
        else if (two === '!=') v = (v !== r) ? 1 : 0;
        else if (two === '<=') v = (v <= r) ? 1 : 0;
        else v = (v >= r) ? 1 : 0;
        continue;
      }
      const one = src[i];
      if (one === '<' || one === '>') {
        i += 1; const r = parseShift();
        v = (one === '<') ? (v < r ? 1 : 0) : (v > r ? 1 : 0);
        continue;
      }
      break;
    }
    return v;
  }
  function parseShift() {
    let v = parseAdd();
    for (;;) {
      skip();
      const two = src.slice(i, i + 2);
      if (two === '<<' || two === '>>') {
        i += 2; const r = parseAdd();
        v = (two === '<<') ? (v << r) : (v >> r);
        continue;
      }
      break;
    }
    return v;
  }
  function parseAdd() {
    let v = parseMul();
    for (;;) {
      skip();
      const c = src[i];
      if (c === '+' || c === '-') { i++; const r = parseMul(); v = (c === '+') ? v + r : v - r; continue; }
      break;
    }
    return v;
  }
  function parseMul() {
    let v = parseExp();
    for (;;) {
      skip();
      const c = src[i];
      // '**' must be checked BEFORE the single-'*' branch (both start with
      // the same char), and consumed here so this stays the "* / %" tier --
      // exponentiation itself is parseExp below, one tier tighter/higher
      // precedence than */%,  matching bash's actual ** > * = / = % ordering.
      if (peek(2) === '**') break;
      if (c === '*' || c === '/' || c === '%') {
        i++; const r = parseExp();
        if (c === '*') v *= r;
        else if (c === '/') v = r === 0 ? 0 : (v / r) | 0;
        else v = r === 0 ? 0 : v % r;
        continue;
      }
      break;
    }
    return v;
  }
  // bash's ** is right-associative (2**3**2 === 2**(3**2) === 512, not
  // (2**3)**2 === 64) -- recursing back into parseExp for the exponent
  // (rather than looping left-to-right like parseMul) gives right-assoc.
  function parseExp() {
    let v = parseUnary();
    skip();
    if (peek(2) === '**') { i += 2; const r = parseExp(); v = Math.pow(v, r); }
    return v;
  }
  function parseUnary() {
    skip();
    if (src[i] === '-') { i++; return -parseUnary(); }
    if (src[i] === '+') { i++; return parseUnary(); }
    if (src[i] === '!') { i++; return parseUnary() ? 0 : 1; }
    if (src[i] === '~') { i++; return ~parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary() {
    skip();
    if (src[i] === '(') {
      i++;
      const v = parseTernary();
      eat(')');
      return v;
    }
    const baseM = /^(\d+)#([0-9a-zA-Z]+)/.exec(src.slice(i));
    if (baseM) {
      i += baseM[0].length;
      return parseInt(baseM[2], parseInt(baseM[1], 10)) || 0;
    }
    const m = /^\d+/.exec(src.slice(i));
    if (!m) throw new Error('expected number at ' + i);
    i += m[0].length;
    return parseInt(m[0], 10);
  }
  const result = parseTernary();
  skip();
  if (i !== len) throw new Error('unexpected trailing input at ' + i);
  return result;
}

export function expandBraces(token) {
  const listM = token.match(/^(.*?)\{([^{}]*,[^{}]*)\}(.*)$/s);
  if (listM) {
    const [, pre, list, post] = listM;
    return list.split(',').flatMap(p => expandBraces(pre + p + post));
  }
  const rangeM = token.match(/^(.*?)\{(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?\}(.*)$/s);
  if (rangeM) {
    const [, pre, a, b, step, post] = rangeM;
    const s = step ? +step : ((+a) <= (+b) ? 1 : -1);
    const out = [];
    for (let i = +a; s > 0 ? i <= +b : i >= +b; i += s) out.push(i);
    return out.flatMap(i => expandBraces(pre + i + post));
  }
  return [token];
}

export function expandTilde(token, env) {
  if (token === '~') return env.HOME || '/';
  if (token.startsWith('~/')) return (env.HOME || '') + token.slice(1);
  const m = token.match(/^~([A-Za-z_][A-Za-z0-9_]*)(\/.*)?$/);
  if (m) return '/home/' + m[1] + (m[2] || '');
  return token;
}

export function fullExpand(token, env, lastExit, argv, runCap, arrays, nounset) {
  let out = '';
  let i = 0;
  while (i < token.length) {
    if (token[i] === '`') {
      const end = token.indexOf('`', i + 1);
      if (end < 0) { out += token.slice(i); break; }
      out += runCap ? runCap(token.slice(i + 1, end)) : '';
      i = end + 1; continue;
    }
    if (token[i] === '$' && token[i + 1] === '(' && token[i + 2] === '(') {
      const close = token.indexOf('))', i + 3);
      if (close < 0) { out += token[i++]; continue; }
      out += String(evalArith(token.slice(i + 3, close), env));
      i = close + 2; continue;
    }
    if (token[i] === '$' && token[i + 1] === '(') {
      const end = findMatch(token, i + 1, '(', ')');
      if (end < 0) { out += token[i++]; continue; }
      out += runCap ? runCap(token.slice(i + 2, end)) : '';
      i = end + 1; continue;
    }
    if (token[i] === '$' && token[i + 1] === '{') {
      const end = findMatch(token, i + 1, '{', '}');
      if (end < 0) { out += token[i++]; continue; }
      out += expandParamOp(token.slice(i + 2, end), env, argv, lastExit, arrays, runCap, nounset);
      i = end + 1; continue;
    }
    if (token[i] === '$') {
      const m = token.slice(i + 1).match(/^(\?|!|#|@|\*|[0-9]|[A-Za-z_][A-Za-z0-9_]*)/);
      if (m) { out += expandParam(m[1], env, argv, lastExit, arrays, nounset); i += 1 + m[1].length; continue; }
    }
    out += token[i++];
  }
  return out;
}

function findMatch(s, start, open, close) {
  let depth = 0; let inSingle = false, inDouble = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return i; }
    }
  }
  return -1;
}
