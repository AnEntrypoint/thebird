import { resolvePath } from './shell-builtins.js';

import { toKey } from './shell-idb.js';

export function makeExtraBuiltins(ctx, readFile, writeFile) {
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  // Same instance-scoped-over-global-fallback contract as shell-builtins.js:
  // prefer ctx.fs (set by createShell when an fs was injected).
  const snap = () => (ctx.fs ? ctx.fs.snapshot : window.__debug?.idbSnapshot) || {};
  return {
    test: args => { const r = evalTest(snap, args, ctx.env, ctx.fsModes); ctx.lastExitCode = (r === UNSUPPORTED || r instanceof NotANumber || r instanceof UnsupportedOp) ? 2 : (r ? 0 : 1); if (r === UNSUPPORTED) w('test: ' + args.join(' ') + ": not implemented in browser test-shim\r\n"); if (r instanceof UnsupportedOp) w('test: ' + r.op + ": unsupported operator\r\n"); if (r instanceof NotANumber) w('test: ' + r.arg + ": integer expression expected\r\n"); },
    '[': args => { const inner = args[args.length - 1] === ']' ? args.slice(0, -1) : args; const r = evalTest(snap, inner, ctx.env, ctx.fsModes); ctx.lastExitCode = (r === UNSUPPORTED || r instanceof NotANumber || r instanceof UnsupportedOp) ? 2 : (r ? 0 : 1); if (r === UNSUPPORTED) w('test: ' + inner.join(' ') + ": not implemented in browser test-shim\r\n"); if (r instanceof UnsupportedOp) w('test: ' + r.op + ": unsupported operator\r\n"); if (r instanceof NotANumber) w('test: ' + r.arg + ": integer expression expected\r\n"); },
    tee: (args, _a, stdin) => {
      const files = args.filter(a => !a.startsWith('-'));
      const append = args.some(a => a === '-a');
      const buf = stdin || '';
      for (const f of files) writeFile(f, append ? (snap()[toKey(resolvePath(ctx.cwd, f))] || '') + buf : buf);
      w(buf.replace(/\n/g, '\r\n'));
      ctx.lastExitCode = 0;
    },
    xargs: async (args, _a, stdin, invokeBuiltin) => {
      let n = null, repl = null, nFlagSeen = false;
      const rest = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-n') { n = parseInt(args[++i], 10); nFlagSeen = true; }
        else if (/^-n\d+$/.test(a)) { n = parseInt(a.slice(2), 10); nFlagSeen = true; }
        else if (a === '-I') { repl = args[++i]; }
        else if (/^-I./.test(a)) { repl = a.slice(2); }
        else rest.push(a);
      }
      if (nFlagSeen && !(n > 0)) {
        w("xargs: value " + (Number.isNaN(n) ? 'for' : n) + " for -n option should be >= 1\r\nTry 'xargs --help' for more information.\r\n");
        ctx.lastExitCode = 1;
        return;
      }
      if (!rest.length) { ctx.lastExitCode = 0; return; }
      const cmd = rest[0], cmdArgs = rest.slice(1);
      if (repl) {
        const lines = (stdin || '').split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.length);
        if (!lines.length) { ctx.lastExitCode = 0; return; }
        for (const line of lines) {
          await invokeBuiltin(cmd, cmdArgs.map(a => a.split(repl).join(line)), false);
        }
        return;
      }
      const parts = (stdin || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) { ctx.lastExitCode = 0; return; }
      if (n && n > 0) {
        for (let i = 0; i < parts.length; i += n) {
          await invokeBuiltin(cmd, [...cmdArgs, ...parts.slice(i, i + n)], false);
        }
        return;
      }
      await invokeBuiltin(cmd, [...cmdArgs, ...parts], false); // invokeBuiltin sets ctx.lastExitCode; propagated to caller
    },
    read: (args, _a, stdin) => {
      let promptText = null;
      const pIdx = args.indexOf('-p');
      let rest = args;
      if (pIdx >= 0) { promptText = args[pIdx + 1] ?? ''; rest = args.slice(0, pIdx).concat(args.slice(pIdx + 2)); }
      if (promptText != null) w(promptText);
      const flags = rest.filter(a => a.startsWith('-')).join('');
      const names = rest.filter(a => !a.startsWith('-'));
      if (!names.length) names.push('REPLY');
      let line = (stdin || '').split('\n')[0];
      if (!flags.includes('r')) line = line.replace(/\\(.)/g, '$1');
      line = line.replace(/\r$/, '');
      const nIdx = flags.indexOf('n');
      if (nIdx >= 0) { const n = parseInt(flags.slice(nIdx + 1), 10); if (!isNaN(n)) line = line.slice(0, n); }
      const parts = line.split(/\s+/);
      for (let i = 0; i < names.length; i++) ctx.env[names[i]] = i === names.length - 1 ? parts.slice(i).join(' ') : parts[i] || '';
      ctx.lastExitCode = 0;
    },
    printf: args => {
      if (!args.length) { ctx.lastExitCode = 1; return; }
      let dest = null;
      if (args[0] === '-v') { dest = args[1]; args = args.slice(2); }
      if (!args.length) { ctx.lastExitCode = 1; return; }
      const fmt = args[0].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
      let idx = 1;
      let hadError = false;
      // Numeric specifiers warn (like coreutils printf) when handed a non-number,
      // rather than silently coercing to 0 with no signal.
      const numArg = (v, parse, missing) => { if (missing) return 0; const n = parse(v); if (Number.isNaN(n)) { hadError = true; w("printf: " + v + ": invalid number\r\n"); return 0; } return n; };
      const toRadix = (n, base) => (n < 0 ? BigInt.asUintN(64, BigInt(Math.trunc(n))) : BigInt(Math.trunc(n))).toString(base);
      const pad = (s, width, left) => { if (!width) return s; return left ? s.padEnd(width) : s.padStart(width); };
      const PRINTF_RE = /%([-+0]*)(\d+)?(?:\.(\d+))?([sdxofc%])/g;
      const runPass = () => {
        let consumed = 0;
        const s = fmt.replace(PRINTF_RE, (_, flags, widthS, precS, spec) => {
          if (spec === '%') return '%';
          const width = widthS ? parseInt(widthS, 10) : 0;
          const prec = precS !== undefined ? parseInt(precS, 10) : undefined;
          const left = flags.includes('-');
          const zero = flags.includes('0') && !left;
          const sign = flags.includes('+');
          const argMissing = idx >= args.length;
          const v = args[idx++] ?? '';
          consumed++;
          if (spec === 'd') {
            const n = numArg(v, x => parseInt(x, 10), argMissing);
            let s = String(n);
            if (sign && n >= 0) s = '+' + s;
            if (zero && width) { const neg = s.startsWith('-') || s.startsWith('+'); const signCh = neg ? s[0] : ''; const digits = neg ? s.slice(1) : s; s = signCh + digits.padStart(width - (neg ? 1 : 0), '0'); return s; }
            return pad(s, width, left);
          }
          if (spec === 'x') return pad(toRadix(numArg(v, x => parseInt(x, 10), argMissing), 16), width, left);
          if (spec === 'o') return pad(toRadix(numArg(v, x => parseInt(x, 10), argMissing), 8), width, left);
          if (spec === 'f') { const n = numArg(v, x => parseFloat(x), argMissing); let s = n.toFixed(prec !== undefined ? prec : 6); if (sign && n >= 0) s = '+' + s; return pad(s, width, left); }
          if (spec === 'c') return pad(String(v).slice(0, 1), width, left);
          let ss = String(v);
          if (prec !== undefined) ss = ss.slice(0, prec);
          return pad(ss, width, left);
        });
        return { s, consumed };
      };
      const startArgc = args.length - idx;
      let out = '';
      const first = runPass();
      out += first.s;
      if (first.consumed > 0 && startArgc > 0) {
        while (idx < args.length) {
          const next = runPass();
          if (next.consumed === 0) break;
          out += next.s;
        }
      }
      if (dest) ctx.env[dest] = out; else w(out.replace(/\n/g, '\r\n'));
      ctx.lastExitCode = hadError ? 1 : 0;
    },
    declare: args => {
      const assoc = args.includes('-A');
      const arr = args.includes('-a');
      const names = args.filter(a => !a.startsWith('-'));
      const unquote = s => s.replace(/^(['"])([\s\S]*)\1$/, '$2');
      for (const n of names) {
        const eq = n.indexOf('=');
        const k = eq >= 0 ? n.slice(0, eq) : n;
        const rhs = eq >= 0 ? n.slice(eq + 1) : null;
        if (assoc) {
          ctx.arrays = ctx.arrays || {};
          const obj = {};
          const m = rhs && rhs.match(/^\(([\s\S]*)\)$/);
          if (m) for (const entry of m[1].match(/\[[^\]]+\]=\S*/g) || []) {
            const em = entry.match(/^\[([^\]]+)\]=(.*)$/);
            if (em) obj[unquote(em[1])] = unquote(em[2]);
          }
          ctx.arrays[k] = obj;
        } else if (arr) {
          ctx.arrays = ctx.arrays || {};
          const list = [];
          const m = rhs && rhs.match(/^\(([\s\S]*)\)$/);
          if (m) for (const tok of m[1].match(/"[^"]*"|'[^']*'|\S+/g) || []) list.push(unquote(tok));
          else if (rhs != null) list.push(unquote(rhs));
          ctx.arrays[k] = list;
        } else if (eq >= 0) ctx.env[k] = n.slice(eq + 1);
      }
      ctx.lastExitCode = 0;
    },
    shift: args => {
      const n = parseInt(args[0], 10) || 1;
      ctx.argv = (ctx.argv || []).slice(n);
      ctx.lastExitCode = 0;
    },
    local: args => {
      for (const kv of args) {
        const eq = kv.indexOf('=');
        const k = eq >= 0 ? kv.slice(0, eq) : kv;
        const v = eq >= 0 ? kv.slice(eq + 1) : '';
        (ctx.localStack && ctx.localStack[ctx.localStack.length - 1] || {})[k] = ctx.env[k];
        ctx.env[k] = v;
      }
      ctx.lastExitCode = 0;
    },
    set: args => {
      for (const a of args) {
        if (a === '-e') ctx.opts = { ...ctx.opts, errexit: true };
        else if (a === '+e') ctx.opts = { ...ctx.opts, errexit: false };
        else if (a === '-x') ctx.opts = { ...ctx.opts, xtrace: true };
        else if (a === '+x') ctx.opts = { ...ctx.opts, xtrace: false };
        else if (a === '-u') ctx.opts = { ...ctx.opts, nounset: true };
        else if (a === '+u') ctx.opts = { ...ctx.opts, nounset: false };
      }
      ctx.lastExitCode = 0;
    },
    break: args => { ctx.loopFlag = 'break'; ctx.loopDepth = parseInt(args[0], 10) || 1; ctx.lastExitCode = 0; },
    continue: args => { ctx.loopFlag = 'continue'; ctx.loopDepth = parseInt(args[0], 10) || 1; ctx.lastExitCode = 0; },
    source: async (args, _a, _s, invokeBuiltin, runLine) => {
      if (!args[0]) throw new Error('source: missing file');
      const content = snap()[toKey(resolvePath(ctx.cwd, args[0]))];
      if (content == null) throw new Error('source: ' + args[0] + ': No such file');
      const savedArgv = ctx.argv;
      ctx.argv = [args[0], ...args.slice(1)];
      try { if (ctx.runScript) await ctx.runScript(content); else for (const ln of content.split('\n')) if (ln.trim()) await runLine(ln); }
      finally { ctx.argv = savedArgv; }
    },
    '.': async (args, actor, stdin, invokeBuiltin, runLine) => {
      const src = (ctx.builtinsRef || {}).source;
      if (src) await src(args, actor, stdin, invokeBuiltin, runLine);
    },
  };
}

const UNSUPPORTED = Symbol('test-unsupported');
class NotANumber { constructor(arg) { this.arg = arg; } }
// Returned for a syntactically valid expression whose OPERATOR this shim
// cannot answer, so the error message can name the operator itself.
class UnsupportedOp { constructor(op) { this.op = op; } }

function evalTest(snap, args, env = {}, modes = {}) {
  if (args.length === 0) return false;
  // Leading '!' negates any following expression (POSIX): recurse on the rest
  // and flip the boolean, propagating UNSUPPORTED/NotANumber/UnsupportedOp
  // sentinels untouched.
  if (args[0] === '!' && args.length > 1) {
    const r = evalTest(snap, args.slice(1), env, modes);
    return typeof r === 'boolean' ? !r : r;
  }
  if (args.length === 1) return !!args[0];
  if (args.length === 2) {
    const [flag, val] = args;
    const s = snap;
    const isDir = v => Object.keys(s()).some(k => k.startsWith(v + '/'));
    const exists = v => v in s() || isDir(v);
    // Symlinks are stored as { __symlink, mode } objects (ln -s in
    // shell-builtins-fs.js); regular files are plain content strings.
    const isSymlink = v => { const e = s()[v]; return e != null && typeof e === 'object' && !ArrayBuffer.isView(e) && !!e.__symlink; };
    // Permission bits come from the same model ls -l/stat/chmod share
    // (ctx.fsModes overrides, rwxr-xr-x dir / rw-r--r-- file defaults,
    // rwxrwxrwx symlink) -- see shell-builtins-fs.js's stat builtin.
    const modeOf = v => isSymlink(v) ? 'rwxrwxrwx' : (modes[v] || (isDir(v) ? 'rwxr-xr-x' : 'rw-r--r--'));
    const OPS = {
      '-z': v => v === '', '-n': v => v !== '',
      '-f': v => v in s(),
      '-d': isDir,
      '-e': exists,
      '-s': v => typeof s()[v] === 'string' && s()[v].length > 0,
      '-h': isSymlink, '-L': isSymlink,
      '-r': v => exists(v) && modeOf(v)[0] === 'r',
      '-w': v => exists(v) && modeOf(v)[1] === 'w',
      '-x': v => exists(v) && modeOf(v)[2] === 'x',
      '-v': v => v in env,
    };
    if (!(flag in OPS)) return new UnsupportedOp(flag);
    return OPS[flag](val);
  }
  if (args.length === 3) {
    const [a, op, b] = args;
    if (op === '-a') return !!a && !!b;
    if (op === '-o') return !!a || !!b;
    const s = snap;
    const CMP = { '=':(x,y)=>x===y,'==':(x,y)=>x===y,'!=':(x,y)=>x!==y,
      '<':(x,y)=>x<y,'>':(x,y)=>x>y,
      '-eq':(x,y)=>+x===+y,'-ne':(x,y)=>+x!==+y,
      '-lt':(x,y)=>+x<+y,'-gt':(x,y)=>+x>+y,'-le':(x,y)=>+x<=+y,'-ge':(x,y)=>+x>=+y,
      '-ef':(x,y)=>toKey(resolvePath('', x)) === toKey(resolvePath('', y)) };
    // -nt/-ot stay unsupported on purpose: this fs stores no mtimes at all
    // (shell-builtins-fs.js's stat honestly reports epoch for %Y/%X/%Z rather
    // than fabricating timestamps), so there is no mtime data to compare --
    // the operator is named via UnsupportedOp like any other unanswered one.
    if (!(op in CMP)) return new UnsupportedOp(op);
    const NUMERIC_OPS = new Set(['-eq','-ne','-lt','-gt','-le','-ge']);
    if (NUMERIC_OPS.has(op)) {
      if (Number.isNaN(+a)) return new NotANumber(a);
      if (Number.isNaN(+b)) return new NotANumber(b);
    }
    return CMP[op](a, b);
  }
  return UNSUPPORTED;
}
