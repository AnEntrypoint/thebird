import { resolvePath } from './shell-builtins.js';

const toKey = p => p.replace(/^\//, '');
const snap = () => window.__debug.idbSnapshot || {};

export function makeExtraBuiltins(ctx, readFile, writeFile) {
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  return {
    test: args => { ctx.lastExitCode = evalTest(args) ? 0 : 1; },
    '[': args => { const inner = args[args.length - 1] === ']' ? args.slice(0, -1) : args; ctx.lastExitCode = evalTest(inner) ? 0 : 1; },
    tee: (args, _a, stdin) => {
      const files = args.filter(a => !a.startsWith('-'));
      const append = args.some(a => a === '-a');
      const buf = stdin || '';
      for (const f of files) writeFile(f, append ? (snap()[toKey(resolvePath(ctx.cwd, f))] || '') + buf : buf);
      w(buf.replace(/\n/g, '\r\n'));
    },
    xargs: async (args, _a, stdin, invokeBuiltin) => {
      const parts = (stdin || '').trim().split(/\s+/).filter(Boolean);
      if (!args.length || !parts.length) return;
      await invokeBuiltin(args[0], [...args.slice(1), ...parts], false);
    },
    read: (args, _a, stdin) => {
      if (!args[0]) return;
      ctx.env[args[0]] = (stdin || '').split('\n')[0].replace(/\r$/, '');
    },
    printf: args => {
      if (!args.length) return;
      const fmt = args[0].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
      let idx = 1;
      const out = fmt.replace(/%([sdxof])/g, (_, spec) => {
        const v = args[idx++] ?? '';
        if (spec === 'd') return String(parseInt(v, 10) || 0);
        if (spec === 'x') return (parseInt(v, 10) || 0).toString(16);
        if (spec === 'o') return (parseInt(v, 10) || 0).toString(8);
        if (spec === 'f') return String(parseFloat(v) || 0);
        return String(v);
      });
      w(out.replace(/\n/g, '\r\n'));
    },
    shift: args => {
      const n = parseInt(args[0], 10) || 1;
      ctx.argv = (ctx.argv || []).slice(n);
    },
    local: args => {
      for (const kv of args) {
        const eq = kv.indexOf('=');
        const k = eq >= 0 ? kv.slice(0, eq) : kv;
        const v = eq >= 0 ? kv.slice(eq + 1) : '';
        (ctx.localStack && ctx.localStack[ctx.localStack.length - 1] || {})[k] = ctx.env[k];
        ctx.env[k] = v;
      }
    },
    set: args => {
      for (const a of args) {
        if (a === '-e') ctx.opts = { ...ctx.opts, errexit: true };
        else if (a === '+e') ctx.opts = { ...ctx.opts, errexit: false };
        else if (a === '-x') ctx.opts = { ...ctx.opts, xtrace: true };
        else if (a === '+x') ctx.opts = { ...ctx.opts, xtrace: false };
        else if (a === '-u') ctx.opts = { ...ctx.opts, nounset: true };
      }
    },
    break: args => { ctx.loopFlag = 'break'; ctx.loopDepth = parseInt(args[0], 10) || 1; },
    continue: args => { ctx.loopFlag = 'continue'; ctx.loopDepth = parseInt(args[0], 10) || 1; },
    source: async (args, _a, _s, invokeBuiltin, runLine) => {
      if (!args[0]) throw new Error('source: missing file');
      const content = snap()[toKey(resolvePath(ctx.cwd, args[0]))];
      if (content == null) throw new Error('source: ' + args[0] + ': No such file');
      const savedArgv = ctx.argv;
      ctx.argv = [args[0], ...args.slice(1)];
      try { for (const ln of content.split('\n')) if (ln.trim()) await runLine(ln); }
      finally { ctx.argv = savedArgv; }
    },
    '.': async (args, actor, stdin, invokeBuiltin, runLine) => {
      const src = (ctx.builtinsRef || {}).source;
      if (src) await src(args, actor, stdin, invokeBuiltin, runLine);
    },
  };
}

function evalTest(args) {
  if (args.length === 1) return !!args[0];
  if (args.length === 2) {
    const [flag, val] = args;
    const s = () => window.__debug.idbSnapshot || {};
    const OPS = {
      '-z': v => v === '', '-n': v => v !== '',
      '-f': v => v in s(),
      '-d': v => Object.keys(s()).some(k => k.startsWith(v + '/')),
      '-e': v => v in s() || Object.keys(s()).some(k => k.startsWith(v + '/')),
      '!': v => !v,
    };
    return OPS[flag]?.(val) ?? false;
  }
  if (args.length === 3) {
    const [a, op, b] = args;
    const CMP = { '=':(x,y)=>x===y,'==':(x,y)=>x===y,'!=':(x,y)=>x!==y,
      '-eq':(x,y)=>+x===+y,'-ne':(x,y)=>+x!==+y,
      '-lt':(x,y)=>+x<+y,'-gt':(x,y)=>+x>+y,'-le':(x,y)=>+x<=+y,'-ge':(x,y)=>+x>=+y };
    return CMP[op]?.(a, b) ?? false;
  }
  return false;
}
