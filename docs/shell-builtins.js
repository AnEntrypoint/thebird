import { HOME_DIR } from './shell-defaults.js';
import { GROUP_LOADERS, COMMAND_MANIFEST } from './builtins-manifest.js';

// Deliberately duplicated (not imported) from shell-builtins-text.js: a
// static `import` of that module here would defeat the whole point of
// lazy-loading it (see t4-builtins-manifest) -- the browser fetches+parses an
// ES module's full source the moment ANY static import statement names it,
// whether or not the importing code calls its exports. This file is the one
// always-eager entry point (shell.js imports it directly), so it must not
// statically name any of the lazy group modules. Core cat/head/tail/wc need
// this same stdin-vs-file-args split as the text group's builtins.
// No positional file args + a real stdin value (a pipe or `<` redirect)
// means "read stdin", matching standard cat/grep/etc. behavior with no file
// operand -- stdinParam is always passed as its own argument by shell.js,
// never prepended into positional args.
function readStdinFirst(positional, stdinParam) {
  if (positional.length === 0 && stdinParam != null) return { stdin: stdinParam, rest: [] };
  return { stdin: null, rest: positional };
}

export function resolvePath(cwd, p) {
  if (p == null || p === '') return cwd;
  if (p === '~') return HOME_DIR;
  if (p.startsWith('~/')) p = HOME_DIR + '/' + p.slice(2);
  if (!p.startsWith('/')) p = cwd.replace(/\/$/, '') + '/' + p;
  const parts = [];
  for (const s of p.split('/')) {
    if (s === '..') parts.pop();
    else if (s && s !== '.') parts.push(s);
  }
  return '/' + parts.join('/');
}

// head/tail -n line count. parseInt('abc') is NaN and slice(0,NaN) silently emits
// nothing — an invalid -n must not masquerade as a valid 0-line request. Throw so
// the command fails with exit 1 rather than silently producing wrong output.
function parseLineCount(rest0, name) {
  if (rest0[0] !== '-n') return 10;
  const n = parseInt(rest0[1], 10);
  if (!Number.isFinite(n)) { throw new Error(name + ": invalid number of lines: '" + rest0[1] + "'"); }
  // GNU head -n -N means "all but the last N lines"; tail has no such form.
  if (n < 0 && name !== 'head') { throw new Error(name + ": invalid number of lines: '" + rest0[1] + "'"); }
  return n;
}

import { toKey } from './shell-idb.js';

function listDir(snap, prefix) {
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

function removeRecursive(snap, prefix) {
  const s = snap();
  let count = 0;
  for (const k of Object.keys(s)) {
    if (k === prefix || k.startsWith(prefix + '/')) { delete s[k]; count++; }
  }
  return count;
}

export function makeBuiltins(ctx, actor, invokeBuiltin) {
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  // Instance-scoped fs accessors: prefer ctx.fs (set by createShell when an
  // fs was injected) over the shared window.__debug global, matching the same
  // opt-in-fallback contract as shell.js's own snap/persist closures. This is
  // what makes these builtins usable by a standalone shell package without a
  // page-global window.__debug being present.
  const snap = () => (ctx.fs ? ctx.fs.snapshot : window.__debug?.idbSnapshot) || {};
  const persist = () => (ctx.fs ? ctx.fs.flush?.() : window.__debug?.idbPersist?.());
  const previewWrite = () => ctx.onPreviewWrite ? ctx.onPreviewWrite() : window.__debug?.shell?.onPreviewWrite?.();
  const SYMLOOP_MAX = 40;
  const readFile = (p, _depth = 0) => {
    const k = toKey(resolvePath(ctx.cwd, p));
    const s = snap();
    const c = s[k];
    if (c == null) {
      const isDir = Object.keys(s).some(key => key === k + '/.keep' || key.startsWith(k + '/'));
      if (isDir) throw new Error(p + ': Is a directory');
      throw new Error(p + ': No such file or directory');
    }
    // Transparently follow ln -s targets (shell-builtins-fs.js writes
    // {__symlink, mode} object entries, not string content) -- matches
    // shell-posix.js's Node-fs-emulation resolveLink, which already does
    // this for require()/fs.readFileSync but was never wired into the
    // interactive shell's own readFile, so cat/head/tail/wc/md5sum/etc. on
    // a symlink rendered "[object Object]" instead of the target's content.
    if (c && typeof c === 'object' && c.__symlink) {
      if (_depth >= SYMLOOP_MAX) throw new Error(p + ': Too many levels of symbolic links');
      const dir = k.includes('/') ? '/' + k.slice(0, k.lastIndexOf('/')) : '/';
      return readFile(resolvePath(dir, c.__symlink), _depth + 1);
    }
    return c;
  };
  const writeFile = (p, content) => {
    const k = toKey(resolvePath(ctx.cwd, p));
    snap()[k] = content;
    persist();
    previewWrite();
  };
  // tail -f live follow, driven by the instance-fs change hooks
  // (fs.subscribe, instance-fs.js): stream appended content for each
  // followed file until interrupted or until every followed file is gone.
  // Semantics mirror GNU tail's defaults: a file deleted mid-follow prints a
  // notice and is dropped (no --retry) -- following stops entirely once none
  // remain; a truncated file prints a notice and is re-read from offset 0.
  const followTail = (files, multi) => new Promise(resolve => {
    const tracked = new Map(); // resolved abs path -> { arg, offset }
    for (const f of files) {
      const abs = resolvePath(ctx.cwd, f);
      tracked.set(abs, { arg: f, offset: readFile(abs).length });
    }
    let finished = false;
    let iv = null, unsub = null;
    const done = () => {
      if (finished) return;
      finished = true;
      if (iv !== null) clearInterval(iv);
      if (unsub) unsub();
      resolve();
    };
    // GNU semantics: with multiple files the initial dump ended with the LAST
    // file's content, so a later append to that same file streams headerless
    // and only a switch to a different file prints a (blank-line-separated)
    // '==> file <==' header.
    let lastHeader = multi ? resolvePath(ctx.cwd, files[files.length - 1]) : null;
    const stream = abs => {
      const t = tracked.get(abs);
      if (!t) return;
      let c;
      try { c = readFile(abs); }
      catch {
        // readFile only throws ENOENT / Is-a-directory here: the file was
        // deleted (or replaced by a directory) mid-follow. GNU tail without
        // --retry drops it after a notice; same here.
        wl("tail: '" + t.arg + "': No such file or directory");
        tracked.delete(abs);
        if (!tracked.size) done();
        return;
      }
      if (c.length < t.offset) { wl('tail: ' + t.arg + ': file truncated'); t.offset = 0; }
      if (c.length <= t.offset) return;
      if (multi && lastHeader !== abs) { if (lastHeader !== null) wl(''); wl('==> ' + t.arg + ' <=='); lastHeader = abs; }
      w(c.slice(t.offset).replace(/\n/g, '\r\n'));
      t.offset = c.length;
    };
    // Event paths are snapshot keys (no leading '/'); tracked keys are
    // resolved absolute paths -- normalize before matching.
    unsub = ctx.fs.subscribe(({ path }) => { const abs = '/' + path; if (tracked.has(abs)) stream(abs); });
    // Ctrl-C only flips ctx.currentJob.killed (shell.js's onData) -- nothing
    // wakes a pending builtin, so poll the flag. The element-detached check
    // covers a terminal-window close mid-follow (no Ctrl-C ever arrives);
    // either way the fs subscription is released so no listener leaks.
    iv = setInterval(() => {
      const detached = ctx.term.element && typeof document !== 'undefined' && !document.contains(ctx.term.element);
      if (ctx.currentJob?.killed || !tracked.size || detached) done();
    }, 250);
  });
  // Lazy group loading (t4-builtins-manifest): each of
  // text/extra/util/fs/system/py used to be instantiated here unconditionally
  // (6 dynamic-import-worthy modules pulled in on every shell boot whether or
  // not a single one of their ~55 commands was ever run). Now each group's
  // module is only dynamically import()ed -- and its maker only called -- the
  // first time a command belonging to it is actually dispatched, via
  // loadGroup() below. Results are cached per shell instance (this closure)
  // so a second command from an already-loaded group is a plain property
  // lookup, not a re-import.
  const groupArgsFor = {
    text: () => [ctx, readFile, writeFile],
    extra: () => [ctx, readFile, writeFile],
    util: () => [ctx, readFile, writeFile],
    fs: () => [ctx, readFile, writeFile],
    system: () => [ctx, readFile],
    py: () => [ctx],
  };
  const groupCache = {};
  function loadGroup(key) {
    if (groupCache[key]) return groupCache[key];
    const entry = GROUP_LOADERS[key];
    const promise = entry.loader().then(mod => {
      const fns = mod[entry.make](...groupArgsFor[key]());
      Object.assign(b, fns);
      return fns;
    });
    groupCache[key] = promise;
    return promise;
  }
  // resolveLazy(name) is attached to `b` below (after its own declaration) so
  // invokeBuiltin (shell.js) can, on a miss, resolve+await a command's group
  // and retry the lookup -- see shell.js's invokeBuiltin for the call site.
  const b = {
    ls: args => {
      const flags = args.filter(a => a.startsWith('-')).join('');
      const showHidden = flags.includes('a');
      const longFmt = flags.includes('l');
      const onePerLine = flags.includes('1');
      const targets = args.filter(a => !a.startsWith('-'));
      const target = targets[0] || '';
      const dirKey = toKey(resolvePath(ctx.cwd, target));
      // Root ('') always exists; otherwise the path must be a real file/dir
      // marker in the snapshot, or ls silently succeeded on garbage input
      // with empty output + exit 0 instead of erroring like every sibling
      // builtin (cd/mkdir/rm/cp/stat/du/chmod all throw 'cannot access').
      if (dirKey && !Object.keys(snap()).some(k => k === dirKey || k.startsWith(dirKey + '/'))) {
        throw new Error("ls: cannot access '" + target + "': No such file or directory");
      }
      const { files, dirs } = listDir(snap, dirKey);
      const entries = [...dirs.map(d => ({ name: d, dir: true })), ...files.map(f => ({ name: f, dir: false }))]
        .filter(e => showHidden || !e.name.startsWith('.'));
      if (!entries.length) { ctx.lastExitCode = 0; return; }
      if (longFmt) {
        // ctx.fsModes is populated by chmod (shell-builtins-fs.js) -- reading
        // it here (instead of the previous hardcoded 'rwxr-xr-x' literal) is
        // what makes `chmod +x f && ls -l` actually show the mode change,
        // matching stat's fsModes lookup already in shell-builtins-fs.js.
        const modes = ctx.fsModes || {};
        for (const e of entries) {
          const full = dirKey ? dirKey + '/' + e.name : e.name;
          const v = snap()[full];
          // ln -s writes {__symlink, mode} object entries (shell-builtins-fs.js),
          // not string content -- ls previously had zero symlink awareness:
          // wrong type char ('-' instead of 'l'), size read as v?.length on an
          // object (silently 0, not the real target-string length), and no
          // '-> target' suffix real ls always appends for a symlink entry.
          const isLink = v && typeof v === 'object' && !Array.isArray(v) && v.__symlink;
          const size = isLink ? v.__symlink.length : (e.dir ? 0 : (v?.length || 0));
          const mode = isLink ? 'rwxrwxrwx' : (modes[full] || (e.dir ? 'rwxr-xr-x' : 'rw-r--r--'));
          const typeChar = isLink ? 'l' : (e.dir ? 'd' : '-');
          const suffix = isLink ? ' -> ' + v.__symlink : (e.dir ? '/' : '');
          wl(`${typeChar}${mode}  ${String(size).padStart(8)} ${e.name}${suffix}`);
        }
      } else if (onePerLine) {
        for (const e of entries) wl(e.dir ? `\x1b[34m${e.name}/\x1b[0m` : e.name);
      } else {
        wl(entries.map(e => e.dir ? `\x1b[34m${e.name}/\x1b[0m` : e.name).join('  '));
      }
      ctx.lastExitCode = 0;
    },
    cat: (args, _a, stdinBuf) => {
      const { stdin, rest: files } = readStdinFirst(args, stdinBuf);
      if (stdin !== null) w(stdin);
      for (const f of files) w(readFile(f));
      ctx.lastExitCode = 0;
    },
    echo: args => {
      let escape = false, noNewline = false, argIdx = 0;
      while (argIdx < args.length && /^-[en]+$/.test(args[argIdx])) {
        if (args[argIdx].includes('e')) escape = true;
        if (args[argIdx].includes('n')) noNewline = true;
        argIdx++;
      }
      let txt = args.slice(argIdx).join(' ');
      if (escape) txt = txt.replace(/\\a/g, '\x07').replace(/\\b/g, '\b').replace(/\\e/g, '\x1b').replace(/\\f/g, '\f').replace(/\\v/g, '\x0b').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\0([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\x([0-9a-fA-F]{1,2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\\/g, '\\');
      w(txt.replace(/\n/g, '\r\n') + (noNewline ? '' : '\r\n'));
      ctx.lastExitCode = 0;
    },
    pwd: () => { wl(ctx.cwd); ctx.lastExitCode = 0; },
    cd: args => {
      const target = args[0];
      if (target === '-') { const prev = ctx.prevCwd || '/'; ctx.prevCwd = ctx.cwd; ctx.cwd = prev; wl(ctx.cwd); ctx.lastExitCode = 0; return; }
      const next = resolvePath(ctx.cwd, target || '~');
      if (next !== '/') {
        const k = toKey(next);
        const s = snap();
        const exists = Object.keys(s).some(key => key === k || key.startsWith(k + '/'));
        if (!exists) throw new Error('cd: ' + (target || '~') + ': No such file or directory');
      }
      ctx.prevCwd = ctx.cwd;
      ctx.cwd = next;
      ctx.lastExitCode = 0;
    },
    mkdir: args => {
      const makeParents = args.some(a => a === '-p' || a === '-pv' || a === '-vp');
      const dirs = args.filter(a => !a.startsWith('-'));
      if (!dirs.length) throw new Error('mkdir: missing operand');
      const s = snap();
      for (const p of dirs) {
        const abs = resolvePath(ctx.cwd, p);
        if (makeParents) {
          const segments = abs.split('/').filter(Boolean);
          for (let i = 1; i <= segments.length; i++) {
            const partial = toKey('/' + segments.slice(0, i).join('/'));
            if (!(partial + '/.keep' in s)) s[partial + '/.keep'] = '';
          }
        } else {
          const k = toKey(abs);
          const parent = k.substring(0, k.lastIndexOf('/'));
          if (parent && !Object.keys(s).some(key => key === parent + '/.keep' || key.startsWith(parent + '/'))) {
            throw new Error("mkdir: cannot create directory '" + p + "': No such file or directory");
          }
          if (k + '/.keep' in s || Object.keys(s).some(key => key.startsWith(k + '/'))) {
            throw new Error("mkdir: cannot create directory '" + p + "': File exists");
          }
          s[k + '/.keep'] = '';
        }
      }
      persist();
      ctx.lastExitCode = 0;
    },
    rm: args => {
      const flagChars = args.filter(a => a.startsWith('-')).map(a => a.replace(/^-+/, '')).join('');
      const recursive = /[rR]/.test(flagChars);
      const force = flagChars.includes('f');
      const s = snap();
      const files = args.filter(a => !a.startsWith('-'));
      if (!files.length) throw new Error('rm: missing operand');
      for (const f of files) {
        const k = toKey(resolvePath(ctx.cwd, f));
        if (k in s) { delete s[k]; continue; }
        if (recursive) { const n = removeRecursive(snap, k); if (n === 0 && !force) throw new Error(f + ': No such file or directory'); continue; }
        const isDir = Object.keys(s).some(key => key === k + '/.keep' || key.startsWith(k + '/'));
        if (isDir) throw new Error(f + ': Is a directory');
        if (!force) throw new Error(f + ': No such file or directory');
      }
      persist();
      ctx.lastExitCode = 0;
    },
    cp: args => {
      const recursive = args.some(a => a === '-r' || a === '-R');
      const fileArgs = args.filter(a => !a.startsWith('-'));
      if (fileArgs.length < 2) throw new Error('cp: missing operand');
      const dst = fileArgs[fileArgs.length - 1];
      // `cp a b c dest/` (3+ operands): every arg but the last is a source,
      // all copied into dest/ preserving basenames -- previously only
      // fileArgs[0] was ever copied (destructured as `[src, dst]`) and
      // fileArgs[1] was wrongly read as the destination even when a real
      // last-arg destination existed, silently dropping every extra source.
      const sources = fileArgs.length > 2 ? fileArgs.slice(0, -1) : [fileArgs[0]];
      if (fileArgs.length > 2) {
        const dstKey = toKey(resolvePath(ctx.cwd, dst));
        const isDir = Object.keys(snap()).some(k => k.startsWith(dstKey + '/'));
        if (!isDir) throw new Error("cp: target '" + dst + "' is not a directory");
      }
      for (const src of sources) {
        const srcK = toKey(resolvePath(ctx.cwd, src));
        let dstK = toKey(resolvePath(ctx.cwd, dst));
        const s = snap();
        if (dstK !== '/' && !(dstK in s) && Object.keys(s).some(k => k.startsWith(dstK + '/'))) dstK = dstK + '/' + srcK.split('/').pop();
        if (srcK in s) { s[dstK] = s[srcK]; persist(); continue; }
        const isSrcDir = Object.keys(s).some(k => k.startsWith(srcK + '/'));
        if (!recursive) { if (isSrcDir) throw new Error("cp: -r not specified; omitting directory '" + src + "'"); throw new Error(src + ': No such file or directory'); }
        if (dstK in s) throw new Error("cp: cannot overwrite non-directory '" + dst + "' with directory '" + src + "'");
        let n = 0;
        for (const k of Object.keys(s)) { if (k === srcK || k.startsWith(srcK + '/')) { s[dstK + k.slice(srcK.length)] = s[k]; n++; } }
        if (!n) throw new Error(src + ': No such file or directory');
        persist();
      }
      ctx.lastExitCode = 0;
    },
    mv: args => {
      const fileArgs = args.filter(a => !a.startsWith('-'));
      if (fileArgs.length < 2) throw new Error('mv: missing operand');
      const dst = fileArgs[fileArgs.length - 1];
      // Same multi-source-into-directory fix as cp above.
      const sources = fileArgs.length > 2 ? fileArgs.slice(0, -1) : [fileArgs[0]];
      if (fileArgs.length > 2) {
        const dstKey = toKey(resolvePath(ctx.cwd, dst));
        const isDir = Object.keys(snap()).some(k => k.startsWith(dstKey + '/'));
        if (!isDir) throw new Error("mv: target '" + dst + "' is not a directory");
      }
      for (const src of sources) {
        const srcK = toKey(resolvePath(ctx.cwd, src));
        let dstK = toKey(resolvePath(ctx.cwd, dst));
        const s = snap();
        if (dstK !== '/' && !(dstK in s) && Object.keys(s).some(k => k.startsWith(dstK + '/'))) dstK = dstK + '/' + srcK.split('/').pop();
        if (srcK in s) { s[dstK] = s[srcK]; delete s[srcK]; persist(); continue; }
        if (dstK in s) throw new Error("mv: cannot overwrite non-directory '" + dst + "' with directory '" + src + "'");
        let n = 0;
        for (const k of Object.keys(s)) { if (k === srcK || k.startsWith(srcK + '/')) { s[dstK + k.slice(srcK.length)] = s[k]; delete s[k]; n++; } }
        if (!n) throw new Error(src + ': No such file or directory');
        persist();
      }
      ctx.lastExitCode = 0;
    },
    touch: args => { const s = snap(); for (const f of args) { const k = toKey(resolvePath(ctx.cwd, f)); if (!(k in s)) s[k] = ''; } persist(); ctx.lastExitCode = 0; },
    imgcat: args => {
      if (!args.length) throw new Error('imgcat: missing file operand');
      const path = args[0];
      const content = readFile(path);
      const ext = path.split('.').pop().toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const src = content.startsWith('data:') ? content : 'data:' + mime + ';base64,' + btoa(unescape(encodeURIComponent(content)));
      document.dispatchEvent(new CustomEvent('term-image', { detail: { src, path } }));
      wl('\x1b[32m[image: ' + path + ']\x1b[0m');
      ctx.lastExitCode = 0;
    },
    head: (args, _a, stdinBuf) => {
      const { stdin, rest: rest0 } = readStdinFirst(args, stdinBuf);
      const n = parseLineCount(rest0, 'head');
      const files = rest0[0] === '-n' ? rest0.slice(2) : rest0;
      const targets = files.length ? files : [null];
      const multi = targets.length > 1;
      targets.forEach((f, i) => {
        if (!f && !stdin) return;
        if (multi) { if (i) wl(''); wl('==> ' + (f || 'standard input') + ' <=='); }
        const lines = (f ? readFile(f) : stdin || '').split('\n');
        const sliced = n < 0 ? lines.slice(0, Math.max(0, lines.length + n)) : lines.slice(0, n);
        wl(sliced.join('\r\n'));
      });
      ctx.lastExitCode = 0;
    },
    tail: async (args, _a, stdinBuf) => {
      const follow = args.includes('-f') || args.includes('--follow');
      const args2 = args.filter(a => a !== '-f' && a !== '--follow');
      const { stdin, rest: rest0 } = readStdinFirst(args2, stdinBuf);
      const n = parseLineCount(rest0, 'tail');
      const files = rest0[0] === '-n' ? rest0.slice(2) : rest0;
      const targets = files.length ? files : [null];
      const multi = targets.length > 1;
      targets.forEach((f, i) => {
        if (!f && !stdin) return;
        if (multi) { if (i) wl(''); wl('==> ' + (f || 'standard input') + ' <=='); }
        wl((f ? readFile(f) : stdin || '').split('\n').slice(-n).join('\r\n'));
      });
      ctx.lastExitCode = 0;
      if (!follow) return;
      // stdin is a static captured buffer -- there is nothing live to follow.
      const followTargets = targets.filter(f => f);
      if (!followTargets.length) return;
      if (!ctx.fs || typeof ctx.fs.subscribe !== 'function') {
        // Standalone shell with no instance fs injected: the change hooks
        // don't exist, so live follow cannot work -- say so instead of
        // silently returning to a static snapshot.
        wl('tail: cannot follow: no instance filesystem attached');
        ctx.lastExitCode = 1;
        return;
      }
      await followTail(followTargets, multi);
    },
    wc: (args, _a, stdinBuf) => {
      ctx.lastExitCode = 0;
      const flagArg = args.find(a => /^-[lwcmL]+$/.test(a));
      const showL = flagArg ? flagArg.includes('l') : true;
      const showW = flagArg ? flagArg.includes('w') : true;
      const showC = flagArg ? flagArg.includes('c') : true;
      const showM = flagArg ? flagArg.includes('m') : false;
      const showLmax = flagArg ? flagArg.includes('L') : false;
      const args2 = flagArg ? args.filter(a => a !== flagArg) : args;
      const { stdin, rest: files } = readStdinFirst(args2, stdinBuf);
      const pairs = files.length ? files.map(f => [f, readFile(f)]) : [['', stdin || '']];
      let totL = 0, totW = 0, totC = 0, totM = 0, totLmax = 0;
      const rows = [];
      for (const [name, c] of pairs) {
        const lines = c.split('\n').length - 1 + (c && !c.endsWith('\n') ? 1 : 0);
        const words = c.split(/\s+/).filter(Boolean).length;
        const chars = Array.from(c).length;
        const lmax = Math.max(0, ...c.split('\n').map(l => l.length));
        totL += lines; totW += words; totC += c.length; totM += chars; totLmax = Math.max(totLmax, lmax);
        rows.push({ name, lines, words, chars: c.length, m: chars, lmax });
      }
      const allVals = rows.flatMap(r => [r.lines, r.words, r.chars, r.m, r.lmax]);
      if (pairs.length > 1) allVals.push(totL, totW, totC, totM, totLmax);
      const width = Math.max(...allVals.map(v => String(v).length)) + 1;
      for (const r of rows) {
        let out = '';
        if (showL) out += String(r.lines).padStart(width);
        if (showW) out += String(r.words).padStart(width);
        if (showC) out += String(r.chars).padStart(width);
        if (showM) out += String(r.m).padStart(width);
        if (showLmax) out += String(r.lmax).padStart(width);
        wl(`${out}${r.name ? ' ' + r.name : ''}`);
      }
      if (pairs.length > 1) {
        let out = '';
        if (showL) out += String(totL).padStart(width);
        if (showW) out += String(totW).padStart(width);
        if (showC) out += String(totC).padStart(width);
        if (showM) out += String(totM).padStart(width);
        if (showLmax) out += String(totLmax).padStart(width);
        wl(`${out} total`);
      }
    },
    // which/exit both live in the 'text' group's own returned object, but need
    // to run with knowledge only available here (the full `b` dispatch table,
    // and the actor). Kept as always-resident overrides (exactly matching the
    // pre-manifest precedence, where these two were spread-then-reassigned
    // last) -- they lazily load 'text' themselves rather than requiring the
    // caller to have already dispatched some other text-group command first.
    which: async args => { const text = await loadGroup('text'); return text.which(args, b); },
    exit: async (args, ac) => { const text = await loadGroup('text'); return text.exit(args, ac || actor); },
  };
  // Resolves a command not yet present on `b` (i.e. not core, and its group
  // hasn't been loaded/merged yet) by looking up COMMAND_MANIFEST and awaiting
  // the (cached) dynamic import. Returns undefined for a genuinely unknown
  // name. invokeBuiltin (shell.js) calls this on a `BUILTINS[name]` miss.
  b.resolveLazy = async name => {
    const group = COMMAND_MANIFEST[name];
    if (!group) return undefined;
    const fns = await loadGroup(group);
    return fns[name];
  };
  return b;
}
