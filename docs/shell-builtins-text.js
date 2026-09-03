import { resolvePath } from './shell-builtins.js';
import { runSed, posixClasses } from './shell-sed.js';
import { CORE_COMMANDS, COMMAND_MANIFEST } from './builtins-manifest.js';

import { toKey } from './shell-idb.js';

const readLines = text => text.split('\n').map(l => l.replace(/\r$/, '')).filter((l, i, a) => i < a.length - 1 || l !== '');

// Pipe stages prepend the upstream buffer to args AND pass it as the explicit
// stdin parameter (shell.js runPipeline/runSingleCommand passes it as its own
// argument, never prepended into positional args). No positional file args +
// a real stdin value (a pipe or `<` redirect) means "read stdin", matching
// standard `cat`/`grep`/etc. behavior with no file operand.
export function readStdinFirst(positional, stdinParam) {
  if (positional.length === 0 && stdinParam != null) return { stdin: stdinParam, rest: [] };
  return { stdin: null, rest: positional };
}

export function makeTextBuiltins(ctx, readFile, writeFile) {
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  // grep -r's recursive directory walk needs raw snapshot access (readFile only
  // covers a single known path); same instance-scoped-over-global contract as
  // shell-builtins.js/shell-builtins-extra.js.
  const snap = () => (ctx.fs ? ctx.fs.snapshot : window.__debug?.idbSnapshot) || {};
  return {
    grep: (args, actor, stdinBuf) => {
      // Only classify a leading dash-arg as a flag bundle if it matches the
      // known grep flag set (single-dash, letters only) or is the `--E`/etc
      // long form we support; `--` explicitly ends option parsing so a
      // pattern/file beginning with `-` after it is never misparsed as flags.
      const isFlag = a => /^-[a-zA-Z]+$/.test(a);
      let endOpts = false;
      const flagParts = [];
      const positional = [];
      for (const a of args) {
        if (endOpts) { positional.push(a); continue; }
        if (a === '--') { endOpts = true; continue; }
        if (isFlag(a)) flagParts.push(a);
        else positional.push(a);
      }
      const flags = flagParts.join('');
      const { stdin, rest } = readStdinFirst(positional, stdinBuf);
      const [pat, ...fileArgs] = rest;
      if (!pat) throw new Error('grep: missing pattern');
      // Without -E, grep uses BRE where ( ) { } | + ? are literal and their
      // backslash-escaped forms are the metacharacters; -E flips that (ERE,
      // which for these constructs coincides with JS regex syntax).
      const extended = flags.includes('E');
      const bre2js = s => s.replace(/\\?[(){}|+?]/g, m => m[0] === '\\' ? m[1] : '\\' + m);
      const jsPat = posixClasses(extended ? pat : bre2js(pat));
      // Reject nested-quantifier shapes ((a+)+, (a*)*, (a+)*, (.*)*, (a{1,}){1,} etc.)
      // that are the classic catastrophic-backtracking triggers -- a single re.test()
      // call on a matching engine can itself block the thread indefinitely, so this
      // must happen BEFORE compiling, not as a runtime budget around it (a per-line
      // deadline check can never fire mid-test()). Same guard as freddie-host-tools.js grep.
      if (/\([^)]*[+*]\)[^)]*[+*{]|\([^)]*\{\d*,\}[^)]*[+*{]/.test(jsPat)) {
        throw new Error('grep: pattern rejected: nested quantifiers (e.g. (a+)+, (.*)* ) can cause catastrophic backtracking and are not allowed');
      }
      const re = new RegExp(jsPat, flags.includes('i') ? 'gi' : 'g');
      const lineNos = flags.includes('n');
      const countOnly = flags.includes('c');
      const invertMatch = flags.includes('v');
      const recursive = flags.includes('r') || flags.includes('R');
      let sources = [];
      if (fileArgs.length) {
        for (const f of fileArgs) {
          if (recursive) {
            const prefix = toKey(resolvePath(ctx.cwd, f));
            for (const k of Object.keys(snap())) {
              if (k === prefix || k.startsWith(prefix + '/')) sources.push({ name: '/' + k, text: snap()[k] });
            }
          } else {
            sources.push({ name: f, text: readFile(f) });
          }
        }
      } else if (recursive) {
        const prefix = toKey(ctx.cwd);
        for (const k of Object.keys(snap())) {
          if (k === prefix || k.startsWith(prefix + '/')) sources.push({ name: '/' + k, text: snap()[k] });
        }
      } else {
        sources = [{ name: '', text: stdin || '' }];
      }
      const showFile = sources.length > 1 || flags.includes('H');
      let matched = 0;
      for (const { name, text } of sources) {
        let count = 0;
        (typeof text === 'string' ? text : '').split('\n').forEach((l, i) => {
          re.lastIndex = 0;
          const hit = re.test(l);
          if (hit !== invertMatch) { count++; matched++; if (!countOnly) wl((showFile && name ? name + ':' : '') + (lineNos ? (i + 1) + ':' : '') + l); }
        });
        if (countOnly) wl((showFile && name ? name + ':' : '') + count);
      }
      // grep exit code: 0 if any line matched, 1 if none. Set it BOTH ways — only
      // setting the failure case left a stale 1 from a prior failed grep on a later
      // successful one.
      ctx.lastExitCode = matched ? 0 : 1;
    },
    sed: (args, actor, stdinBuf) => {
      const exprs = [];
      const files = [];
      let inplace = false;
      let noAutoprint = false;
      let extended = false;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-e') { exprs.push(args[++i]); continue; }
        if (args[i] === '-i') { inplace = true; continue; }
        if (args[i] === '-n') { noAutoprint = true; continue; }
        if (args[i] === '-E' || args[i] === '-r' || args[i] === '--regexp-extended') { extended = true; continue; }
        if (args[i].startsWith('-')) continue;
        if (!exprs.length) exprs.push(args[i]); else files.push(args[i]);
      }
      const { stdin, rest } = readStdinFirst(files, stdinBuf);
      const fileArgs = rest;
      if (!exprs.length) throw new Error('sed: missing expression');
      let hadError = false;
      const pairs = [];
      if (fileArgs.length) {
        for (const f of fileArgs) {
          try { pairs.push([f, readFile(f)]); }
          catch { wl("sed: can't read " + f + ': No such file or directory'); hadError = true; }
        }
      } else {
        pairs.push(['', stdin || '']);
      }
      for (const [name, text] of pairs) {
        const out = runSed(exprs, text, { noAutoprint, extended });
        if (name && inplace) writeFile(name, out);
        else if (name) w(out.replace(/\n/g, '\r\n') + '\r\n');
        else w(out.replace(/\n/g, '\r\n'));
      }
      ctx.lastExitCode = hadError ? 2 : 0;
    },
    sort: (args, actor, stdinBuf) => {
      ctx.lastExitCode = 0;
      let keyField = null;
      let keyNumeric = null;
      let keyReverse = null;
      const parseKeySpec = spec => {
        const m = spec.match(/^(\d+)(?:,(\d+))?([a-zA-Z]*)$/);
        if (!m) return;
        keyField = parseInt(m[1], 10);
        if (m[3]) { keyNumeric = m[3].includes('n'); keyReverse = m[3].includes('r'); }
      };
      const positional = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-k') { parseKeySpec(args[++i]); continue; }
        const km = a.match(/^-k(\d.*)$/);
        if (km) { parseKeySpec(km[1]); continue; }
        if (!a.startsWith('-')) { positional.push(a); continue; }
      }
      const flags = args.filter(a => a.startsWith('-')).join('');
      const numeric = keyNumeric !== null ? keyNumeric : flags.includes('n');
      const { stdin, rest: fileArgs } = readStdinFirst(positional, stdinBuf);
      const targets = fileArgs.length ? fileArgs : [null];
      const keyOf = l => {
        const field = keyField ? (l.split(/\s+/).filter(Boolean)[keyField - 1] ?? '') : l;
        return numeric ? (parseFloat(field) || 0) : field;
      };
      for (const f of targets) {
        let lines = readLines(f ? readFile(f) : stdin || '');
        lines.sort((a, b) => { const ka = keyOf(a), kb = keyOf(b); if (ka < kb) return -1; if (ka > kb) return 1; return a < b ? -1 : a > b ? 1 : 0; });
        if (keyReverse !== null ? keyReverse : flags.includes('r')) lines.reverse();
        if (flags.includes('u')) {
          const seen = new Set();
          lines = lines.filter(l => { const k = keyOf(l); if (seen.has(k)) return false; seen.add(k); return true; });
        }
        wl(lines.join('\r\n'));
      }
    },
    uniq: (args, actor, stdinBuf) => {
      ctx.lastExitCode = 0;
      const flags = args.filter(a => a.startsWith('-')).join('');
      const positional = args.filter(a => !a.startsWith('-'));
      const { stdin, rest: fileArgs } = readStdinFirst(positional, stdinBuf);
      const targets = fileArgs.length ? fileArgs : [null];
      for (const f of targets) {
        const lines = readLines(f ? readFile(f) : stdin || '');
        const groups = [];
        for (const l of lines) {
          if (groups.length && groups[groups.length - 1].line === l) groups[groups.length - 1].count++;
          else groups.push({ line: l, count: 1 });
        }
        let out = groups;
        if (flags.includes('d')) out = out.filter(g => g.count > 1);
        else if (flags.includes('u')) out = out.filter(g => g.count === 1);
        wl(out.map(g => flags.includes('c') ? (String(g.count).padStart(7) + ' ' + g.line) : g.line).join('\r\n'));
      }
    },
    tr: (args, actor, stdinBuf) => {
      const flags = args.filter(a => a.startsWith('-')).join('');
      const deleteMode = flags.includes('d');
      const squeeze = flags.includes('s');
      const complement = flags.includes('c');
      const positional = args.filter(a => !a.startsWith('-'));
      const { stdin: stdinVal, rest } = readStdinFirst(positional, stdinBuf);
      const stdin = stdinVal || '';
      const [fromRaw, toRaw] = rest;
      if (!fromRaw) throw new Error('tr: missing operand');
      const expandRanges = s => {
        const cps = Array.from(s);
        const out = [];
        for (let i = 0; i < cps.length; i++) {
          if (cps[i + 1] === '-' && i + 2 < cps.length) {
            const start = cps[i].codePointAt(0), end = cps[i + 2].codePointAt(0);
            if (start <= end) {
              for (let c = start; c <= end; c++) out.push(String.fromCodePoint(c));
              i += 2;
              continue;
            }
          }
          out.push(cps[i]);
        }
        return out;
      };
      const from = expandRanges(fromRaw);
      const to = toRaw != null ? expandRanges(toRaw) : null;
      ctx.lastExitCode = 0;
      const inSet = c => complement ? !from.includes(c) : from.includes(c);
      let prevOut = null;
      const outChars = [];
      for (const c of stdin) {
        let outC;
        if (deleteMode || to == null || to.length === 0) {
          if (inSet(c)) continue;
          outC = c;
        } else {
          if (inSet(c)) {
            const i = from.indexOf(c);
            outC = complement ? to[to.length - 1] : (to[i] || to[to.length - 1]);
          } else outC = c;
        }
        if (squeeze && outC === prevOut && inSet(c)) continue;
        outChars.push(outC);
        prevOut = outC;
      }
      wl(outChars.join('').replace(/\n/g, '\r\n'));
    },
    env: () => wl(Object.entries(ctx.env).map(([k, v]) => k + '=' + v).join('\r\n')),
    export: args => { for (const kv of args) { const [k, ...v] = kv.split('='); ctx.env[k] = v.join('='); } },
    clear: () => ctx.term.clear(),
    history: () => ctx.history.forEach((l, i) => wl(String(i + 1).padStart(5) + '  ' + l)),
    which: (args, b) => {
      const cmd = args[0];
      if (!cmd) throw new Error('which: missing operand');
      const runners = ['node', 'npm', 'npx', 'bun', 'bunx', 'deno', 'python', 'python3', 'awk', 'sed', 'git'];
      // b[cmd] only reflects builtins whose lazy group has already loaded
      // (t4-builtins-manifest) -- also check the static manifest/core list so
      // `which` reports a real builtin correctly even before first use.
      if (b[cmd] || CORE_COMMANDS.includes(cmd) || cmd in COMMAND_MANIFEST) { wl('(builtin) ' + cmd); ctx.lastExitCode = 0; }
      else if (runners.includes(cmd)) { wl('(runtime) ' + cmd); ctx.lastExitCode = 0; }
      else { wl(cmd + ' not found'); ctx.lastExitCode = 1; }
    },
    exit: (args, actor) => { if (actor.getSnapshot().value === 'node-repl') { actor.send({ type: 'EXIT_REPL' }); wl('[shell]'); } },
    true: () => { ctx.lastExitCode = 0; },
    false: () => { ctx.lastExitCode = 1; },
    printenv: args => {
      if (!args.length) wl(Object.entries(ctx.env).map(([k, v]) => k + '=' + v).join('\r\n'));
      else wl(ctx.env[args[0]] ?? '');
    },
  };
}
