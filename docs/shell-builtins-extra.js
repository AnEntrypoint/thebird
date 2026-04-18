import { resolvePath } from './shell-builtins.js';

const toKey = p => p.replace(/^\//, '');
const snap = () => window.__debug.idbSnapshot || {};
const persist = () => window.__debug.idbPersist?.();

export function makeExtraBuiltins(ctx, readFile, writeFile) {
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  return {
    test: args => {
      const r = evalTest(args);
      ctx.lastExitCode = r ? 0 : 1;
    },
    '[': args => {
      const inner = args[args.length - 1] === ']' ? args.slice(0, -1) : args;
      const r = evalTest(inner);
      ctx.lastExitCode = r ? 0 : 1;
    },
    tee: (args, _actor, stdin) => {
      const files = args.filter(a => !a.startsWith('-'));
      const append = args.some(a => a === '-a');
      const buf = stdin || '';
      for (const f of files) writeFile(f, append ? (readFile(f).catch?.(() => '') || '') + buf : buf);
      w(buf.replace(/\n/g, '\r\n'));
    },
    xargs: async (args, _actor, stdin, invokeBuiltin) => {
      const parts = (stdin || '').trim().split(/\s+/).filter(Boolean);
      if (!args.length || !parts.length) return;
      await invokeBuiltin(args[0], [...args.slice(1), ...parts], false);
    },
    read: (args, _actor, stdin) => {
      const varName = args[0];
      if (!varName) return;
      const line = (stdin || '').split('\n')[0].replace(/\r$/, '');
      ctx.env[varName] = line;
    },
  };
}

function evalTest(args) {
  if (args.length === 1) return !!args[0];
  if (args.length === 2) {
    const [flag, val] = args;
    const OPS = {
      '-z': v => v === '',
      '-n': v => v !== '',
      '-f': v => v in (window.__debug.idbSnapshot || {}),
      '-d': v => Object.keys(window.__debug.idbSnapshot || {}).some(k => k.startsWith(v + '/')),
      '-e': v => v in (window.__debug.idbSnapshot || {}) || Object.keys(window.__debug.idbSnapshot || {}).some(k => k.startsWith(v + '/')),
      '!': v => !v,
    };
    return OPS[flag]?.(val) ?? false;
  }
  if (args.length === 3) {
    const [a, op, b] = args;
    const CMP = { '=': (x,y) => x===y, '==': (x,y) => x===y, '!=': (x,y) => x!==y,
      '-eq': (x,y) => +x===+y, '-ne': (x,y) => +x!==+y,
      '-lt': (x,y) => +x<+y, '-gt': (x,y) => +x>+y,
      '-le': (x,y) => +x<=+y, '-ge': (x,y) => +x>=+y };
    return CMP[op]?.(a, b) ?? false;
  }
  return false;
}
