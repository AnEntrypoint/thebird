export function tokenize(line) {
  const tokens = [];
  let cur = '';
  let quote = null;
  let escape = false;
  // Process-substitution depth: `<(cmd)`/`>(cmd)` must stay one token even
  // though `cmd` itself is whitespace-separated (e.g. `>(cat > /out.txt)`) --
  // shell-exec.js's replaceProcSub()/expandProcSub() only ever see whole
  // tokens, so splitting on whitespace inside the parens here silently tears
  // the substitution into unrelated fragments before either ever runs.
  let procsubDepth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (escape) {
      if (quote === '"' && !'"\\`$'.includes(c)) cur += '\\';
      cur += c; escape = false; continue;
    }
    if (c === '\\' && quote !== "'") { escape = true; continue; }
    if (quote) {
      if (c === quote) { quote = null; continue; }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (procsubDepth === 0 && (c === '<' || c === '>') && line[i + 1] === '(') { procsubDepth = 1; cur += c + '('; i++; continue; }
    if (procsubDepth > 0) {
      if (c === '(') procsubDepth++;
      else if (c === ')') procsubDepth--;
      cur += c;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur) { tokens.push(cur); cur = ''; }
      continue;
    }
    cur += c;
  }
  if (escape || quote) { if (cur) tokens.push(cur); throw new Error('syntax error: unterminated escape or quote'); }
  if (cur) tokens.push(cur);
  return tokens;
}

export function parsePipeline(line) {
  const chunks = splitTopLevel(line, ['&&', '||', ';']);
  return chunks;
}

export function splitTopLevel(line, seps) {
  const cmds = [];
  const separators = [];
  let cur = '';
  let quote = null;
  let escape = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (escape) { cur += c; escape = false; continue; }
    if (c === '\\' && quote !== "'") { cur += c; escape = true; continue; }
    if (quote) {
      if (c === quote) quote = null;
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    let matched = null;
    for (const sep of seps) if (line.startsWith(sep, i)) { matched = sep; break; }
    if (matched) {
      cmds.push(cur.trim());
      separators.push(matched);
      cur = '';
      i += matched.length - 1;
      continue;
    }
    cur += c;
  }
  if (quote || escape) throw new Error('syntax error: unterminated quote or escape in command separator context');
  if (cur.trim()) cmds.push(cur.trim());
  return cmds.map((cmd, i) => ({ cmd, sep: separators[i - 1] || null }));
}

export function parseRedirects(tokens) {
  const out = { args: [], stdout: null, stdoutAppend: false, stdin: null, stderrToStdout: false };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '>' || t === '>>') { const f = tokens[++i]; if (f === undefined) throw new Error('syntax error: redirect without file'); out.stdout = f; out.stdoutAppend = t === '>>'; continue; }
    if (t === '<') { const f = tokens[++i]; if (f === undefined) throw new Error('syntax error: redirect without file'); out.stdin = f; continue; }
    // stderrToStdout is intentionally accepted-but-inert: this shell has a single output
    // channel (all builtin/command output funnels through one writeOut/term.write path,
    // no separate stderr sink), so 2>&1/1>&2 are already satisfied by that single-stream
    // architecture with no separate merge step required.
    if (t === '2>&1' || t === '1>&2') { out.stderrToStdout = true; continue; }
    if (t === '&>' || t === '>&' || t === '&>>') { const f = tokens[++i]; if (f === undefined) throw new Error('syntax error: redirect without file'); out.stdout = f; out.stdoutAppend = t === '&>>'; continue; }
    if (/^&?[12]?>>?&?[12]?$/.test(t) && t !== '>' && t !== '>>') { throw new Error(`syntax error: unsupported redirect operator '${t}'`); }
    out.args.push(t);
  }
  return out;
}

export function parsePipes(line) {
  return splitTopLevel(line, ['|']).map(p => p.cmd);
}

export function globToRe(pattern) {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close < 0) { re += '\\['; i++; continue; }
      let cls = pattern.slice(i + 1, close);
      if (cls[0] === '!') cls = '^' + cls.slice(1);
      re += '[' + cls + ']';
      i = close + 1; continue;
    }
    if (c === '*') { re += pattern[i + 1] === '*' ? ((i += 2), '.*') : ((i++), '[^/]*'); continue; }
    if (c === '?') { re += '[^/]'; i++; continue; }
    if ('-{}()+.,\\^$|#'.includes(c)) { re += '\\' + c; i++; continue; }
    re += c; i++;
  }
  return new RegExp('^' + re + '$');
}

