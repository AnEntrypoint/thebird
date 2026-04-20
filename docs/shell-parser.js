export function tokenize(line) {
  const tokens = [];
  let cur = '';
  let quote = null;
  let escape = false;
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
    if (/\s/.test(c)) {
      if (cur) { tokens.push(cur); cur = ''; }
      continue;
    }
    cur += c;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

export function expand(token, env, lastExitCode, argv) {
  return token.replace(/\$\(([^)]+)\)|\$\{?(\?|#|@|[0-9]|[A-Za-z_][A-Za-z0-9_]*)\}?/g, (match, sub, name) => {
    if (sub) return match;
    if (name === '?') return String(lastExitCode ?? 0);
    if (name === '#') return String((argv || []).length);
    if (name === '@') return (argv || []).join(' ');
    if (name === '0') return (argv || [])[0] || '';
    if (/^[1-9]$/.test(name)) return (argv || [])[parseInt(name)] || '';
    return env[name] ?? '';
  });
}

export function expandCmdSub(token, env, lastExitCode, runCapture, argv) {
  if (!token.includes('$(')) return expand(token, env, lastExitCode, argv);
  return token.replace(/\$\(([^)]+)\)/g, (_, cmd) => runCapture ? runCapture(cmd) : '');
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
  if (cur.trim()) cmds.push(cur.trim());
  return cmds.map((cmd, i) => ({ cmd, sep: separators[i - 1] || null }));
}

export function parseRedirects(tokens) {
  const out = { args: [], stdout: null, stdoutAppend: false, stdin: null };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '>' || t === '>>') { out.stdout = tokens[++i]; out.stdoutAppend = t === '>>'; continue; }
    if (t === '<') { out.stdin = tokens[++i]; continue; }
    out.args.push(t);
  }
  return out;
}

export function parsePipes(line) {
  return splitTopLevel(line, ['|']).map(p => p.cmd);
}

export function globToRe(pattern) {
  const escaped = pattern.replace(/[-[\]{}()*+?.,\\^$|#]/g, (c) => (c === '*' || c === '?') ? c : '\\' + c);
  const re = escaped.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp('^' + re + '$');
}

export function parseCommand(line, env) {
  const raw = tokenize(line);
  const expanded = raw.map(t => expand(t, env));
  return parseRedirects(expanded);
}
