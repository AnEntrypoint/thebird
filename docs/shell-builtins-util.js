import { resolvePath } from './shell-builtins.js';
import { runAwk } from './shell-awk.js';

const toKey = p => p.replace(/^\//, '');
const snap = () => window.__debug.idbSnapshot || {};

export function makeUtilBuiltins(ctx, readFile, writeFile) {
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  return {
    basename: args => { if (!args[0]) return; const p = args[0].replace(/\/+$/, '').split('/').pop(); wl(args[1] ? p.replace(new RegExp(args[1] + '$'), '') : p); },
    dirname: args => { if (!args[0]) return; const idx = args[0].replace(/\/+$/, '').lastIndexOf('/'); wl(idx <= 0 ? (idx === 0 ? '/' : '.') : args[0].slice(0, idx)); },
    realpath: args => { if (!args[0]) return; wl(resolvePath(ctx.cwd, args[0])); },
    date: args => {
      const fmt = args.find(a => a.startsWith('+'));
      const d = new Date();
      if (!fmt) { wl(d.toUTCString()); return; }
      const pad = (n, z = 2) => String(n).padStart(z, '0');
      const MAP = { Y: d.getFullYear(), m: pad(d.getMonth() + 1), d: pad(d.getDate()), H: pad(d.getHours()), M: pad(d.getMinutes()), S: pad(d.getSeconds()), s: Math.floor(d.getTime() / 1000), N: pad(d.getMilliseconds(), 3) + '000000' };
      wl(fmt.slice(1).replace(/%(.)/g, (_, k) => String(MAP[k] ?? '%' + k)));
    },
    find: args => {
      const start = args.find(a => !a.startsWith('-')) || '.';
      const nameArg = args[args.indexOf('-name') + 1];
      const typeArg = args[args.indexOf('-type') + 1];
      const prefix = toKey(resolvePath(ctx.cwd, start));
      const keys = Object.keys(snap());
      const dirs = new Set();
      for (const k of keys) { const parts = k.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
      const all = [...keys.map(k => ({ path: k, type: 'f' })), ...[...dirs].map(d => ({ path: d, type: 'd' }))];
      const patToRe = p => new RegExp('^' + p.replace(/[-[\]{}()+.,\\^$|#]/g, c => (c === '*' || c === '?') ? c : '\\' + c).replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      const matches = all.filter(e => (!prefix || e.path === prefix || e.path.startsWith(prefix + '/')) && (!nameArg || patToRe(nameArg).test(e.path.split('/').pop())) && (!typeArg || typeArg === e.type));
      for (const m of matches.sort((a, b) => a.path.localeCompare(b.path))) wl('/' + m.path);
    },
    awk: (args, _a, stdin) => {
      let fs = null;
      const rest = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-F') { fs = args[++i]; continue; }
        rest.push(args[i]);
      }
      const prog = rest.find(a => !a.startsWith('-')) || '';
      if (!prog) { ctx.lastExitCode = 1; return; }
      const out = runAwk(prog, stdin || '', fs);
      if (out) w(out.replace(/\n/g, '\r\n') + '\r\n');
    },
    eval: async (args, _a, _s, invokeBuiltin, runLine) => {
      const line = args.join(' ');
      if (runLine) await runLine(line);
    },
    command: (args, _a, _s, invokeBuiltin) => {
      if (args[0] === '-v') { const name = args[1]; if (!name) return; if (ctx.builtinsRef?.[name] || ctx.functions?.[name]) wl(name); else ctx.lastExitCode = 1; return; }
      if (args[0]) invokeBuiltin?.(args[0], args.slice(1), false);
    },
    '[[': args => {
      const inner = args[args.length - 1] === ']]' ? args.slice(0, -1) : args;
      ctx.lastExitCode = evalCompound(inner) ? 0 : 1;
    },
    getopts: (args, _a, _s, _ib) => {
      const spec = args[0] || '';
      const varName = args[1] || 'OPTARG';
      const idx = (ctx.optind || 1);
      const argv = (ctx.argv || []).slice(1);
      const tok = argv[idx - 1];
      if (!tok || !tok.startsWith('-') || tok === '--') { ctx.lastExitCode = 1; ctx.optind = 1; return; }
      const flag = tok[1];
      const needsArg = spec.includes(flag + ':');
      ctx.env[varName] = flag;
      if (needsArg) { ctx.env.OPTARG = argv[idx] || ''; ctx.optind = idx + 2; } else { ctx.optind = idx + 1; }
      ctx.lastExitCode = spec.includes(flag) ? 0 : 1;
    },
    wait: async args => {
      const id = args[0];
      const job = (ctx.bgJobs || {})[id];
      if (job) await job.promise;
    },
    trap: args => {
      if (!args.length) { wl(Object.entries(ctx.traps || {}).map(([k, v]) => 'trap -- "' + v + '" ' + k).join('\r\n')); return; }
      ctx.traps = ctx.traps || {};
      const [cmd, ...sigs] = args;
      for (const s of sigs) ctx.traps[s] = cmd;
    },
    jobs: () => wl(Object.entries(ctx.bgJobs || {}).map(([k, v]) => '[' + k + ']  ' + (v.done ? 'Done' : 'Running') + '  ' + v.cmd).join('\r\n')),
  };
}

function evalCompound(args) {
  const groups = []; let cur = []; const ops = [];
  for (const a of args) { if (a === '&&' || a === '||') { groups.push(cur); ops.push(a); cur = []; } else cur.push(a); }
  groups.push(cur);
  let result = evalSimple(groups[0]);
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === '&&') result = result && evalSimple(groups[i + 1]);
    else result = result || evalSimple(groups[i + 1]);
  }
  return result;
}

function evalSimple(args) {
  if (!args.length) return false;
  if (args[0] === '!') return !evalSimple(args.slice(1));
  if (args.length === 3 && args[1] === '=~') { try { return new RegExp(args[2]).test(args[0]); } catch { return false; } }
  const OPS = { '-z': v => !v, '-n': v => !!v, '-f': v => v in (window.__debug.idbSnapshot || {}), '-d': v => Object.keys(window.__debug.idbSnapshot || {}).some(k => k.startsWith(v + '/')), '-e': v => v in (window.__debug.idbSnapshot || {}) };
  if (args.length === 2) return OPS[args[0]]?.(args[1]) ?? false;
  if (args.length === 3) {
    const [a, op, b] = args;
    const CMP = { '=': (x, y) => x === y, '==': (x, y) => x === y, '!=': (x, y) => x !== y, '<': (x, y) => x < y, '>': (x, y) => x > y, '-eq': (x, y) => +x === +y, '-ne': (x, y) => +x !== +y, '-lt': (x, y) => +x < +y, '-gt': (x, y) => +x > +y };
    return CMP[op]?.(a, b) ?? false;
  }
  return !!args[0];
}
