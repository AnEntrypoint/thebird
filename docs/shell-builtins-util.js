import { resolvePath } from './shell-builtins.js';
import { runAwk } from './shell-awk.js';
import { CORE_COMMANDS, COMMAND_MANIFEST } from './builtins-manifest.js';

import { toKey } from './shell-idb.js';

export function makeUtilBuiltins(ctx, readFile, writeFile) {
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  // realpath/find/[[ need raw snapshot access (readFile only covers a single
  // known path); same instance-scoped-over-global contract as the other
  // shell-builtins-*.js modules.
  const snap = () => (ctx.fs ? ctx.fs.snapshot : window.__debug?.idbSnapshot) || {};
  return {
    basename: args => {
      if (!args[0]) { ctx.lastExitCode = 1; throw new Error("basename: missing operand\r\nTry 'basename --help' for more information."); }
      ctx.lastExitCode = 0;
      const p = args[0] === '//' ? '//' : args[0].replace(/\/+$/, '').split('/').pop();
      if (!args[1]) { wl(p); return; }
      // GNU basename matches the suffix argument LITERALLY, never as a
      // regex -- a raw `new RegExp(args[1] + '$')` treated '.' in '.txt' as
      // an unescaped any-char wildcard, so `basename fooZtxt .txt` wrongly
      // matched+stripped the trailing 'Ztxt' (any char + 'txt') instead of
      // leaving the name unchanged (real basename requires an exact '.txt').
      const escaped = args[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stripped = p.replace(new RegExp(escaped + '$'), '');
      // GNU basename also refuses to strip the suffix down to an empty
      // string (the whole basename IS the suffix, e.g. `basename .txt .txt`)
      // -- it leaves the name as-is rather than printing nothing.
      wl(stripped || p);
    },
    dirname: args => { if (!args[0]) { ctx.lastExitCode = 1; throw new Error("dirname: missing operand\r\nTry 'dirname --help' for more information."); } ctx.lastExitCode = 0; const idx = args[0].replace(/\/+$/, '').lastIndexOf('/'); wl(idx <= 0 ? (idx === 0 ? '/' : '.') : args[0].slice(0, idx)); },
    realpath: args => {
      const flags = args.filter(a => a.startsWith('-'));
      const pathArg = args.find(a => !a.startsWith('-'));
      if (!pathArg) { ctx.lastExitCode = 1; throw new Error("realpath: missing operand\r\nTry 'realpath --help' for more information."); }
      const resolved = resolvePath(ctx.cwd, pathArg);
      if (!flags.includes('-m') && !flags.includes('--canonicalize-missing')) {
        const k = toKey(resolved);
        const exists = k in snap() || Object.keys(snap()).some(kk => kk.startsWith(k + '/'));
        if (!exists) { ctx.lastExitCode = 1; throw new Error('realpath: ' + pathArg + ': No such file or directory'); }
      }
      ctx.lastExitCode = 0;
      wl(resolved);
    },
    date: args => {
      ctx.lastExitCode = 0;
      const fmt = args.find(a => a.startsWith('+'));
      const d = new Date();
      const pad = (n, z = 2) => String(n).padStart(z, '0');
      const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const MO_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const MO_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const tzOffset = () => { const o = -d.getTimezoneOffset(); const sign = o >= 0 ? '+' : '-'; const abs = Math.abs(o); return sign + pad(Math.floor(abs / 60)) + pad(abs % 60); };
      const dayOfYear = () => Math.ceil((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
      if (!fmt) { wl(WD_SHORT[d.getDay()] + ' ' + MO_SHORT[d.getMonth()] + ' ' + pad(d.getDate(), 2) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' UTC ' + d.getFullYear()); return; }
      const MAP = { Y: d.getFullYear(), m: pad(d.getMonth() + 1), d: pad(d.getDate()), H: pad(d.getHours()), M: pad(d.getMinutes()), S: pad(d.getSeconds()), s: Math.floor(d.getTime() / 1000), N: pad(d.getMilliseconds(), 3) + '000000', a: WD_SHORT[d.getDay()], A: WD_LONG[d.getDay()], b: MO_SHORT[d.getMonth()], B: MO_LONG[d.getMonth()], j: pad(dayOfYear(), 3), e: String(d.getDate()).padStart(2, ' '), z: tzOffset(), Z: 'UTC', n: '\n', '%': '%' };
      wl(fmt.slice(1).replace(/%(.)/g, (_, k) => String(MAP[k] ?? '%' + k)));
    },
    find: async (args, _a, _s, _ib, runLine) => {
      ctx.lastExitCode = 0;
      const execIdx = args.indexOf('-exec');
      const findArgs = execIdx === -1 ? args : args.slice(0, execIdx);
      const start = findArgs.find(a => !a.startsWith('-')) || '.';
      const nameArg = findArgs[findArgs.indexOf('-name') + 1];
      const typeArg = findArgs[findArgs.indexOf('-type') + 1];
      const maxDepthArg = findArgs[findArgs.indexOf('-maxdepth') + 1];
      const maxDepth = maxDepthArg != null ? parseInt(maxDepthArg, 10) : null;
      const consumed = new Set(['-name', nameArg, '-type', typeArg, '-maxdepth', maxDepthArg, start].filter(v => v != null));
      const unknown = findArgs.find(a => a.startsWith('-') && !consumed.has(a));
      if (unknown) { ctx.lastExitCode = 1; throw new Error("find: unknown predicate `" + unknown + "'"); }
      if (typeArg && !['f', 'd'].includes(typeArg)) { ctx.lastExitCode = 1; throw new Error("find: Unknown argument to -type: `" + typeArg + "'"); }
      const prefix = toKey(resolvePath(ctx.cwd, start));
      const keys = Object.keys(snap());
      const dirs = new Set();
      for (const k of keys) { const parts = k.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
      const all = [...keys.map(k => ({ path: k, type: 'f' })), ...[...dirs].map(d => ({ path: d, type: 'd' }))];
      const patToRe = p => new RegExp('^' + p.replace(/[-[\]{}()+.,\\^$|#]/g, c => (c === '*' || c === '?') ? c : '\\' + c).replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      const matches = all.filter(e => (!prefix || e.path === prefix || e.path.startsWith(prefix + '/')) && (!nameArg || patToRe(nameArg).test(e.path.split('/').pop())) && (!typeArg || typeArg === e.type) && (maxDepth == null || (e.path === prefix ? 0 : e.path.slice(prefix.length + 1).split('/').length) <= maxDepth));
      const sorted = matches.sort((a, b) => a.path.localeCompare(b.path));
      if (execIdx === -1) {
        for (const m of sorted) wl('/' + m.path);
        return;
      }
      const termIdx = args.indexOf(';', execIdx);
      if (termIdx === -1 && args[args.length - 1] !== '+') { ctx.lastExitCode = 1; throw new Error('find: -exec requires \\; or +'); }
      const plusMode = termIdx === -1 && args[args.length - 1] === '+';
      const cmdTokens = args.slice(execIdx + 1, plusMode ? args.length - 1 : (termIdx === -1 ? undefined : termIdx));
      if (plusMode) {
        const paths = sorted.map(m => '/' + m.path).join(' ');
        const cmdLine = cmdTokens.map(t => t.split('{}').join(paths)).join(' ');
        if (runLine) await runLine(cmdLine);
        return;
      }
      for (const m of sorted) {
        const cmdLine = cmdTokens.map(t => t.split('{}').join('/' + m.path)).join(' ');
        if (runLine) await runLine(cmdLine);
      }
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
      const fsCompiled = fs && fs.length > 1 ? new RegExp(fs) : fs;
      const out = runAwk(prog, stdin || '', fsCompiled);
      if (out) w(out.replace(/\n/g, '\r\n') + '\r\n');
      ctx.lastExitCode = 0;
    },
    eval: async (args, _a, _s, invokeBuiltin, runLine) => {
      const line = args.join(' ');
      ctx.lastExitCode = 0;
      if (runLine) await runLine(line);
    },
    command: async (args, _a, _s, invokeBuiltin) => {
      if (args[0] === '-v') {
        const name = args[1];
        if (!name) { ctx.lastExitCode = 2; return; }
        // ctx.builtinsRef only has KEYS for commands whose lazy group has
        // already been dynamically imported (t4-builtins-manifest) -- fall
        // back to the static manifest/core list so `command -v` reports a
        // real builtin as found even before its group has ever loaded.
        const known = ctx.builtinsRef?.[name] || ctx.functions?.[name] || CORE_COMMANDS.includes(name) || name in COMMAND_MANIFEST;
        if (known) { ctx.lastExitCode = 0; wl(name); } else ctx.lastExitCode = 1;
        return;
      }
      if (args[0]) { await invokeBuiltin?.(args[0], args.slice(1), false); ctx.lastExitCode = ctx.lastExitCode ?? 0; }
    },
    '[[': args => {
      const inner = args[args.length - 1] === ']]' ? args.slice(0, -1) : args;
      ctx.lastExitCode = evalCompound(snap, inner) ? 0 : 1;
    },
    getopts: (args, _a, _s, _ib) => {
      const spec = args[0] || '';
      const varName = args[1] || 'OPTARG';
      const idx = (ctx.optind || 1);
      const optchar = (ctx.optchar || 0);
      const argv = (ctx.argv || []).slice(1);
      const tok = argv[idx - 1];
      if (!tok || !tok.startsWith('-') || tok === '--') { ctx.lastExitCode = 1; ctx.optind = 1; ctx.optchar = 0; ctx.env.OPTIND = String(ctx.optind); return; }
      const pos = optchar || 1;
      const flag = tok[pos];
      const needsArg = spec.includes(flag + ':');
      const known = spec.includes(flag);
      ctx.env[varName] = known ? flag : '?';
      if (needsArg) {
        const inline = tok.slice(pos + 1);
        const missing = !inline && argv[idx] === undefined;
        if (missing) {
          if (spec[0] === ':') { ctx.env[varName] = ':'; ctx.env.OPTARG = flag; }
          else { wl('option requires an argument -- ' + flag); ctx.env[varName] = '?'; ctx.env.OPTARG = ''; }
          ctx.optind = idx + 1;
        } else {
          ctx.env.OPTARG = inline || argv[idx] || '';
          ctx.optind = inline ? idx + 1 : idx + 2;
        }
        ctx.optchar = 0;
      } else if (!known) {
        if (spec[0] !== ':') { wl('illegal option -- ' + flag); ctx.env.OPTARG = ''; }
        else { ctx.env.OPTARG = flag; }
        ctx.optind = idx + 1;
        ctx.optchar = 0;
      } else if (pos + 1 < tok.length) {
        ctx.optchar = pos + 1;
      } else {
        ctx.optind = idx + 1;
        ctx.optchar = 0;
      }
      ctx.env.OPTIND = String(ctx.optind);
      ctx.lastExitCode = 0;
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
    netstat: async args => { const bn = globalThis.__busnet; if (!bn) { wl('netstat: busnet not initialized'); ctx.lastExitCode = 1; return; } const all = args.includes('-a'); wl('Proto  Local Address           State       Service'); for (const port of bn.getListeners()) wl(('tcp    0.0.0.0:' + port).padEnd(40) + 'LISTEN      bus'); if (all || args.includes('-p')) { const peers = await bn.discover(); for (const p of peers) wl(('tcp    peer://' + p.origin + ':' + p.port).padEnd(40) + 'PEER        ' + p.service); } ctx.lastExitCode = 0; },
  };
}

function evalCompound(snap, args) {
  const groups = []; let cur = []; const ops = [];
  for (const a of args) { if (a === '&&' || a === '||') { groups.push(cur); ops.push(a); cur = []; } else cur.push(a); }
  groups.push(cur);
  let result = evalSimple(snap, groups[0]);
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === '&&') result = result && evalSimple(snap, groups[i + 1]);
    else result = result || evalSimple(snap, groups[i + 1]);
  }
  return result;
}

function evalSimple(snap, args) {
  if (!args.length) return false;
  if (args[0] === '!') return !evalSimple(snap, args.slice(1));
  if (args.length === 3 && args[1] === '=~') { try { return new RegExp(args[2]).test(args[0]); } catch { return false; } }
  const OPS = { '-z': v => !v, '-n': v => !!v, '-f': v => v in (snap() || {}), '-d': v => Object.keys(snap() || {}).some(k => k.startsWith(v + '/')), '-e': v => v in (snap() || {}) || Object.keys(snap() || {}).some(k => k.startsWith(v + '/')) };
  if (args.length === 2) return OPS[args[0]]?.(args[1]) ?? false;
  if (args.length === 3) {
    const [a, op, b] = args;
    const CMP = { '=': (x, y) => x === y, '==': (x, y) => x === y, '!=': (x, y) => x !== y, '<': (x, y) => x < y, '>': (x, y) => x > y, '-eq': (x, y) => +x === +y, '-ne': (x, y) => +x !== +y, '-lt': (x, y) => +x < +y, '-gt': (x, y) => +x > +y, '-le': (x, y) => +x <= +y, '-ge': (x, y) => +x >= +y };
    return CMP[op]?.(a, b) ?? false;
  }
  return !!args[0];
}
