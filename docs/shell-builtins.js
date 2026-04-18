export function resolvePath(cwd, p) {
  if (!p || p === '~') return '/';
  if (p.startsWith('~/')) p = '/' + p.slice(2);
  if (!p.startsWith('/')) p = cwd.replace(/\/$/, '') + '/' + p;
  const parts = [];
  for (const s of p.split('/')) {
    if (s === '..') parts.pop();
    else if (s && s !== '.') parts.push(s);
  }
  return '/' + parts.join('/');
}

const toKey = p => p.replace(/^\//, '');
const snap = () => window.__debug.idbSnapshot || {};
const persist = () => window.__debug.idbPersist?.();
const previewWrite = () => window.__debug.shell?.onPreviewWrite?.();

function listDir(prefix) {
  const pLen = prefix ? prefix.length + 1 : 0;
  const files = new Set(), dirs = new Set();
  for (const k of Object.keys(snap())) {
    if (prefix && !k.startsWith(prefix + '/') && k !== prefix) continue;
    if (!prefix && !k.includes('/')) { files.add(k); continue; }
    const rest = k.slice(pLen);
    const slash = rest.indexOf('/');
    if (slash === -1) files.add(rest);
    else dirs.add(rest.slice(0, slash));
  }
  return { files: [...files].filter(f => f !== '.keep').sort(), dirs: [...dirs].sort() };
}

function removeRecursive(prefix) {
  const s = snap();
  let count = 0;
  for (const k of Object.keys(s)) {
    if (k === prefix || k.startsWith(prefix + '/')) { delete s[k]; count++; }
  }
  return count;
}

export function makeBuiltins(ctx, actor) {
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  const readFile = p => {
    const c = snap()[toKey(resolvePath(ctx.cwd, p))];
    if (c == null) throw new Error(p + ': No such file or directory');
    return c;
  };
  const writeFile = (p, content) => {
    const k = toKey(resolvePath(ctx.cwd, p));
    snap()[k] = content;
    persist();
    previewWrite();
  };
  const b = {
    ls: args => {
      const flags = args.filter(a => a.startsWith('-')).join('');
      const showHidden = flags.includes('a');
      const longFmt = flags.includes('l');
      const targets = args.filter(a => !a.startsWith('-'));
      const target = targets[0] || '';
      const { files, dirs } = listDir(toKey(resolvePath(ctx.cwd, target)));
      const entries = [...dirs.map(d => ({ name: d, dir: true })), ...files.map(f => ({ name: f, dir: false }))]
        .filter(e => showHidden || !e.name.startsWith('.'));
      if (!entries.length) return;
      if (longFmt) {
        for (const e of entries) {
          const full = toKey(resolvePath(ctx.cwd, target + '/' + e.name));
          const size = e.dir ? 0 : (snap()[full]?.length || 0);
          wl(`${e.dir ? 'd' : '-'}rwxr-xr-x  ${String(size).padStart(8)} ${e.name}${e.dir ? '/' : ''}`);
        }
      } else {
        wl(entries.map(e => e.dir ? `\x1b[34m${e.name}/\x1b[0m` : e.name).join('  '));
      }
    },
    cat: args => {
      if (!args.length) throw new Error('cat: missing file operand');
      for (const f of args) w(readFile(f));
    },
    echo: args => {
      const noNewline = args[0] === '-n';
      const ea = noNewline ? args.slice(1) : args;
      const txt = ea.join(' ');
      w(txt + (noNewline ? '' : '\r\n'));
    },
    pwd: () => wl(ctx.cwd),
    cd: args => {
      const target = args[0];
      if (target === '-') { const prev = ctx.prevCwd || '/'; ctx.prevCwd = ctx.cwd; ctx.cwd = prev; wl(ctx.cwd); return; }
      const next = resolvePath(ctx.cwd, target || '~');
      ctx.prevCwd = ctx.cwd;
      ctx.cwd = next;
    },
    mkdir: args => {
      for (const p of args.filter(a => !a.startsWith('-'))) {
        snap()[toKey(resolvePath(ctx.cwd, p)) + '/.keep'] = '';
      }
      persist();
    },
    rm: args => {
      const recursive = args.some(a => a === '-r' || a === '-rf' || a === '-fr' || a === '-R');
      const force = args.some(a => a.includes('f'));
      const targets = args.filter(a => !a.startsWith('-'));
      for (const f of targets) {
        const k = toKey(resolvePath(ctx.cwd, f));
        if (k in snap()) { delete snap()[k]; continue; }
        if (recursive) { const n = removeRecursive(k); if (n === 0 && !force) throw new Error(f + ': No such file or directory'); continue; }
        if (!force) throw new Error(f + ': No such file or directory');
      }
      persist();
    },
    cp: args => {
      const recursive = args.some(a => a === '-r' || a === '-R');
      const positional = args.filter(a => !a.startsWith('-'));
      const [src, dst] = positional;
      if (!src || !dst) throw new Error('cp: missing operand');
      const srcK = toKey(resolvePath(ctx.cwd, src));
      const dstK = toKey(resolvePath(ctx.cwd, dst));
      const s = snap();
      if (srcK in s) { s[dstK] = s[srcK]; persist(); return; }
      if (!recursive) throw new Error(src + ': No such file or directory');
      let n = 0;
      for (const k of Object.keys(s)) {
        if (k === srcK || k.startsWith(srcK + '/')) { s[dstK + k.slice(srcK.length)] = s[k]; n++; }
      }
      if (!n) throw new Error(src + ': No such file or directory');
      persist();
    },
    mv: args => {
      const [src, dst] = args.filter(a => !a.startsWith('-'));
      if (!src || !dst) throw new Error('mv: missing operand');
      const srcK = toKey(resolvePath(ctx.cwd, src));
      const dstK = toKey(resolvePath(ctx.cwd, dst));
      const s = snap();
      if (srcK in s) { s[dstK] = s[srcK]; delete s[srcK]; persist(); return; }
      let n = 0;
      for (const k of Object.keys(s)) {
        if (k === srcK || k.startsWith(srcK + '/')) { s[dstK + k.slice(srcK.length)] = s[k]; delete s[k]; n++; }
      }
      if (!n) throw new Error(src + ': No such file or directory');
      persist();
    },
    touch: args => { for (const f of args) { const k = toKey(resolvePath(ctx.cwd, f)); if (!(k in snap())) snap()[k] = ''; } persist(); },
    head: args => {
      const n = args[0] === '-n' ? parseInt(args[1], 10) : 10;
      const files = args[0] === '-n' ? args.slice(2) : args;
      for (const f of files) wl(readFile(f).split('\n').slice(0, n).join('\r\n'));
    },
    tail: args => {
      const n = args[0] === '-n' ? parseInt(args[1], 10) : 10;
      const files = args[0] === '-n' ? args.slice(2) : args;
      for (const f of files) wl(readFile(f).split('\n').slice(-n).join('\r\n'));
    },
    wc: args => {
      for (const f of args) {
        const c = readFile(f);
        const lines = c.split('\n').length;
        wl(`${String(lines).padStart(8)}${String(c.split(/\s+/).filter(Boolean).length).padStart(8)}${String(c.length).padStart(8)} ${f}`);
      }
    },
    grep: args => {
      const flags = args.filter(a => a.startsWith('-')).join('');
      const positional = args.filter(a => !a.startsWith('-'));
      const [pat, ...files] = positional;
      if (!pat) throw new Error('grep: missing pattern');
      const re = new RegExp(pat, flags.includes('i') ? 'gi' : 'g');
      const lineNos = flags.includes('n');
      const showFile = files.length > 1 || flags.includes('H');
      let matched = 0;
      for (const f of files) {
        const lines = readFile(f).split('\n');
        lines.forEach((l, i) => {
          re.lastIndex = 0;
          if (re.test(l)) { wl((showFile ? f + ':' : '') + (lineNos ? (i + 1) + ':' : '') + l); matched++; }
        });
      }
      if (!matched) ctx.lastExitCode = 1;
    },
    env: () => wl(Object.entries(ctx.env).map(([k, v]) => k + '=' + v).join('\r\n')),
    export: args => { for (const kv of args) { const [k, ...v] = kv.split('='); ctx.env[k] = v.join('='); } },
    clear: () => ctx.term.clear(),
    history: () => ctx.history.forEach((l, i) => wl(String(i + 1).padStart(5) + '  ' + l)),
    which: args => { const cmd = args[0]; if (!cmd) throw new Error('which: missing operand'); if (b[cmd]) wl('(builtin) ' + cmd); else wl(cmd + ' not found'); },
    exit: () => {
      if (actor.getSnapshot().value === 'node-repl') { actor.send({ type: 'EXIT_REPL' }); wl('[shell]'); }
    },
    true: () => {},
    false: () => { ctx.lastExitCode = 1; },
    printenv: args => {
      if (!args.length) wl(Object.entries(ctx.env).map(([k, v]) => k + '=' + v).join('\r\n'));
      else wl(ctx.env[args[0]] ?? '');
    },
  };
  b.readFile = readFile;
  b.writeFile = writeFile;
  return b;
}
