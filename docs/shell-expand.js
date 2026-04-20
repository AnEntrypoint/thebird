export function expandParam(name, env, argv, lastExit, arrays) {
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
  return env[name] ?? '';
}

export function expandParamOp(expr, env, argv, lastExit, arrays) {
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
  const sliceM = expr.match(/^([^:]+):(\d+)(?::(\d+))?$/);
  if (sliceM) { const v = expandParam(sliceM[1], env, argv, lastExit, arrays); const s = +sliceM[2]; return sliceM[3] !== undefined ? v.slice(s, s + (+sliceM[3])) : v.slice(s); }
  const defM = expr.match(/^([A-Za-z_][A-Za-z0-9_]*|\?|#|@|[0-9])(:-|:=|:\?|:\+|-|=|\+)(.*)$/s);
  if (defM) {
    const [, name, op, def] = defM;
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
  if (!/^[-+*/%()<>=!&|\s\d?:]+$/.test(src)) return 0;
  try { return Function('"use strict"; return (' + src + ')')() | 0; } catch { return 0; }
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

export function fullExpand(token, env, lastExit, argv, runCap, arrays) {
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
      const end = token.indexOf('}', i + 2);
      if (end < 0) { out += token[i++]; continue; }
      out += expandParamOp(token.slice(i + 2, end), env, argv, lastExit, arrays);
      i = end + 1; continue;
    }
    if (token[i] === '$') {
      const m = token.slice(i + 1).match(/^(\?|!|#|@|\*|[0-9]|[A-Za-z_][A-Za-z0-9_]*)/);
      if (m) { out += expandParam(m[1], env, argv, lastExit, arrays); i += 1 + m[1].length; continue; }
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
