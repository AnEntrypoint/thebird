import { resolvePath } from './shell-builtins.js';
import { runSed } from './shell-sed.js';

const toKey = p => p.replace(/^\//, '');
const snap = () => window.__debug.idbSnapshot || {};
const persist = () => window.__debug.idbPersist?.();
const previewWrite = () => window.__debug.shell?.onPreviewWrite?.();

const readLines = text => text.split('\n').map(l => l.replace(/\r$/, '')).filter((l, i, a) => i < a.length - 1 || l !== '');

function readStdinFirst(positional) {
  const stdinFirst = positional.length > 0 && positional[0].includes('\n');
  return { stdin: stdinFirst ? positional[0] : null, rest: stdinFirst ? positional.slice(1) : positional };
}

export function makeTextBuiltins(ctx, readFile, writeFile) {
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  return {
    grep: args => {
      const flags = args.filter(a => a.startsWith('-')).join('');
      const positional = args.filter(a => !a.startsWith('-'));
      const { stdin, rest } = readStdinFirst(positional);
      const [pat, ...fileArgs] = rest;
      if (!pat) throw new Error('grep: missing pattern');
      const re = new RegExp(pat, flags.includes('i') ? 'gi' : 'g');
      const lineNos = flags.includes('n');
      const sources = fileArgs.length ? fileArgs.map(f => ({ name: f, text: readFile(f) })) : [{ name: '', text: stdin || '' }];
      const showFile = sources.length > 1 || flags.includes('H');
      let matched = 0;
      for (const { name, text } of sources) {
        text.split('\n').forEach((l, i) => {
          re.lastIndex = 0;
          if (re.test(l)) { wl((showFile && name ? name + ':' : '') + (lineNos ? (i + 1) + ':' : '') + l); matched++; }
        });
      }
      if (!matched) ctx.lastExitCode = 1;
    },
    sed: args => {
      const exprs = [];
      const files = [];
      let inplace = false;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-e') { exprs.push(args[++i]); continue; }
        if (args[i] === '-i') { inplace = true; continue; }
        if (args[i].startsWith('-')) continue;
        if (!exprs.length) exprs.push(args[i]); else files.push(args[i]);
      }
      const { stdin, rest } = readStdinFirst(files);
      const fileArgs = rest;
      if (!exprs.length) throw new Error('sed: missing expression');
      const pairs = fileArgs.length ? fileArgs.map(f => [f, readFile(f)]) : [['', stdin || '']];
      for (const [name, text] of pairs) {
        const out = runSed(exprs, text);
        if (name && inplace) writeFile(name, out);
        else if (name) w(out.replace(/\n/g, '\r\n') + '\r\n');
        else w(out.replace(/\n/g, '\r\n'));
      }
    },
    sort: args => {
      const flags = args.filter(a => a.startsWith('-')).join('');
      const positional = args.filter(a => !a.startsWith('-'));
      const stdinFirst = positional.length > 0 && positional[0].includes('\n');
      const stdin = stdinFirst ? positional[0] : null;
      const fileArgs = stdinFirst ? positional.slice(1) : positional;
      const targets = fileArgs.length ? fileArgs : [null];
      for (const f of targets) {
        let lines = readLines(f ? readFile(f) : stdin || '');
        if (flags.includes('r')) lines.sort().reverse(); else lines.sort();
        if (flags.includes('u')) lines = [...new Set(lines)];
        wl(lines.join('\r\n'));
      }
    },
    uniq: args => {
      const positional = args.filter(a => !a.startsWith('-'));
      const stdinFirst = positional.length > 0 && positional[0].includes('\n');
      const stdin = stdinFirst ? positional[0] : null;
      const fileArgs = stdinFirst ? positional.slice(1) : positional;
      const targets = fileArgs.length ? fileArgs : [null];
      for (const f of targets) {
        const lines = readLines(f ? readFile(f) : stdin || '');
        wl(lines.filter((l, i) => i === 0 || l !== lines[i - 1]).join('\r\n'));
      }
    },
    tr: args => {
      const positional = args.filter(a => !a.startsWith('-'));
      const stdin = positional.length > 0 ? positional[0] : '';
      const [from, to] = positional.slice(1);
      if (!from) throw new Error('tr: missing operand');
      const mapped = stdin.split('').map(c => {
        const i = from.indexOf(c);
        return to == null ? (from.includes(c) ? '' : c) : (i >= 0 ? (to[i] || to[to.length - 1]) : c);
      }).join('');
      wl(mapped.replace(/\n/g, '\r\n'));
    },
    env: () => wl(Object.entries(ctx.env).map(([k, v]) => k + '=' + v).join('\r\n')),
    export: args => { for (const kv of args) { const [k, ...v] = kv.split('='); ctx.env[k] = v.join('='); } },
    clear: () => ctx.term.clear(),
    history: () => ctx.history.forEach((l, i) => wl(String(i + 1).padStart(5) + '  ' + l)),
    which: (args, b) => { const cmd = args[0]; if (!cmd) throw new Error('which: missing operand'); if (b[cmd]) wl('(builtin) ' + cmd); else wl(cmd + ' not found'); },
    exit: (args, actor) => { if (actor.getSnapshot().value === 'node-repl') { actor.send({ type: 'EXIT_REPL' }); wl('[shell]'); } },
    true: () => {},
    false: () => { ctx.lastExitCode = 1; },
    printenv: args => {
      if (!args.length) wl(Object.entries(ctx.env).map(([k, v]) => k + '=' + v).join('\r\n'));
      else wl(ctx.env[args[0]] ?? '');
    },
  };
}
