import { resolvePath } from './shell-builtins.js';
import { readStdinFirst } from './shell-builtins-text.js';

import { toKey, snap, persist } from './shell-idb.js';

export function makeFsBuiltins(ctx, readFile, writeFile) {
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  const rp = p => resolvePath(ctx.cwd, p);

  const aliases = ctx.aliases || (ctx.aliases = {});

  // Real RFC 1321 MD5 (operates on UTF-8 bytes of the string).
  function md5hex(str) {
    const bytes = new TextEncoder().encode(str);
    const add = (a, b) => (a + b) >>> 0;
    const rol = (x, c) => ((x << c) | (x >>> (32 - c))) >>> 0;
    const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
               5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
               4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
               6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    const K = [];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    const ml = bytes.length;
    const withOne = ml + 1;
    const padLen = ((withOne + 8 + 63) & ~63);
    const msg = new Uint8Array(padLen);
    msg.set(bytes);
    msg[ml] = 0x80;
    const bitLen = ml * 8;
    const dv = new DataView(msg.buffer);
    dv.setUint32(padLen - 8, bitLen >>> 0, true);
    dv.setUint32(padLen - 4, Math.floor(bitLen / 4294967296) >>> 0, true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const M = new Uint32Array(16);
    for (let off = 0; off < padLen; off += 64) {
      for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | (~D >>> 0)); g = (7 * i) % 16; }
        F = add(add(add(F, A), K[i]), M[g]);
        A = D; D = C; C = B;
        B = add(B, rol(F, S[i]));
      }
      a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
    }
    const toHexLE = x => {
      let s = '';
      for (let i = 0; i < 4; i++) s += ((x >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
      return s;
    };
    return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
  }

  async function gzipDeflate(str) {
    const enc = new TextEncoder().encode(str);
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(enc); writer.close();
    return new Response(cs.readable).arrayBuffer();
  }

  async function gzipInflate(buf) {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(buf); writer.close();
    const ab = await new Response(ds.readable).arrayBuffer();
    return new TextDecoder().decode(ab);
  }

  function b64ToAb(b64) {
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }

  function abToB64(ab) {
    const arr = new Uint8Array(ab); let bin = '';
    for (const b of arr) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  return {
    ln: args => {
      const sym = args.includes('-s') || args.includes('-sf');
      const paths = args.filter(a => !a.startsWith('-'));
      const [src, dst] = paths;
      if (!src || !dst) throw new Error('ln: missing operand');
      const srcK = toKey(rp(src)), dstK = toKey(rp(dst));
      const s = snap();
      const force = args.includes('-f') || args.includes('-sf');
      if (sym) {
        if (!force && dstK in s) throw new Error("ln: failed to create symbolic link '" + dst + "': File exists");
        s[dstK] = { __symlink: src, mode: 0o120777 }; persist();
      } else {
        const isDir = !(srcK in s) && Object.keys(s).some(x => x.startsWith(srcK + '/'));
        if (isDir) throw new Error("ln: " + src + ": hard link not allowed for directory");
        if (!(srcK in s)) throw new Error("ln: failed to access '" + src + "': No such file or directory");
        s[dstK] = s[srcK]; persist();
      }
      ctx.lastExitCode = 0;
    },
    chmod: args => {
      const modeArg = args.find(a => !a.startsWith('-') && /^[0-7]{3,4}$/.test(a));
      const symArg = args.find(a => /^([ugoa]*[+\-=][rwx]+)(,[ugoa]*[+\-=][rwx]+)*$/.test(a));
      const paths = args.filter(a => a !== modeArg && a !== symArg && !a.startsWith('-'));
      const s = snap();
      const modes = ctx.fsModes || (ctx.fsModes = {});
      const modeToRwx = m => (m & 4 ? 'r' : '-') + (m & 2 ? 'w' : '-') + (m & 1 ? 'x' : '-');
      for (const p of paths) {
        const k = toKey(rp(p));
        const isDir = !(k in s) && Object.keys(s).some(x => x.startsWith(k + '/'));
        if (!isDir && !(k in s)) throw new Error("chmod: cannot access '" + p + "': No such file or directory");
        let mode = null;
        if (modeArg) {
          const digits = modeArg.slice(-3).split('').map(Number);
          const chars = digits.map(modeToRwx).join('').split('');
          if (modeArg.length === 4) {
            const special = Number(modeArg[0]);
            if (special & 4) chars[2] = chars[2] === 'x' ? 's' : 'S';
            if (special & 2) chars[5] = chars[5] === 'x' ? 's' : 'S';
            if (special & 1) chars[8] = chars[8] === 'x' ? 't' : 'T';
          }
          mode = chars.join('');
        } else if (symArg) {
          const base = isDir ? 'rwxr-xr-x' : 'rw-r--r--';
          const chars = base.split('');
          for (const clause of symArg.split(',')) {
            const addX = /\+x/.test(clause) || /=.*x/.test(clause);
            const removeX = /-x/.test(clause);
            if (addX) { chars[2] = 'x'; chars[8] = 'x'; }
            if (removeX) { chars[2] = '-'; chars[8] = '-'; }
          }
          mode = chars.join('');
        }
        if (mode != null) modes[k] = mode;
      }
      ctx.lastExitCode = 0;
    },
    stat: args => {
      // -c/--format must be stripped (with its value token) BEFORE picking the
      // path via the first non-dash token, or the format string itself (e.g.
      // '%Y', which doesn't start with '-') gets mistaken for the path and the
      // real path argument is silently ignored -- producing a spurious
      // "No such file or directory" for a valid file whenever -c/--format is used.
      let format = null;
      const rest = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-c' || args[i] === '--format') { format = args[++i]; continue; }
        const eq = args[i].match(/^--format=(.*)$/);
        if (eq) { format = eq[1]; continue; }
        rest.push(args[i]);
      }
      const path = rest.find(a => !a.startsWith('-'));
      if (!path) throw new Error('stat: missing operand');
      const deref = rest.includes('-L') || rest.includes('--dereference');
      let k = toKey(rp(path));
      const s = snap();
      let raw = s[k];
      const isSymlink = raw && typeof raw === 'object' && !ArrayBuffer.isView(raw) && raw.__symlink;
      if (isSymlink && deref) {
        k = toKey(rp(raw.__symlink));
        raw = s[k];
      }
      const isDir = !(k in s) && Object.keys(s).some(x => x.startsWith(k + '/'));
      if (!isDir && !(k in s)) throw new Error(path + ': No such file or directory');
      const showSymlink = isSymlink && !deref;
      const modes = ctx.fsModes || {};
      const mode = showSymlink ? 'rwxrwxrwx' : (modes[k] || (isDir ? 'rwxr-xr-x' : 'rw-r--r--'));
      const size = showSymlink ? raw.__symlink.length : (isDir ? 0 : (s[k]?.length || 0));
      if (format != null) {
        // This fs has no stored mtime, so %Y/%X/%Z honestly report 0 (epoch)
        // rather than fabricating a real-looking timestamp for data that was
        // never tracked.
        const subs = { Y: '0', X: '0', Z: '0', s: String(size), n: path, F: showSymlink ? 'symbolic link' : (isDir ? 'directory' : 'regular file'), a: mode };
        wl(format.replace(/%([A-Za-z])/g, (m, c) => subs[c] ?? m));
        ctx.lastExitCode = 0;
        return;
      }
      const octal = mode.match(/.{3}/g).map(g => (g[0] === 'r' ? 4 : 0) + (g[1] === 'w' ? 2 : 0) + (g[2] === 'x' ? 1 : 0)).join('');
      const typeChar = showSymlink ? 'l' : (isDir ? 'd' : '-');
      if (showSymlink) {
        wl('  File: ' + path + ' -> ' + raw.__symlink);
      } else {
        wl('  File: ' + path);
      }
      wl('  Size: ' + size + '\t\tBlocks: ' + Math.ceil(size / 512) + '\t' + (showSymlink ? 'symbolic link' : (isDir ? 'directory' : 'regular file')));
      wl('Device: 0,0\tInode: ' + k.length + '\tLinks: 1');
      wl('Access: (0' + octal + '/' + typeChar + mode + ')  Uid: ( 1000/  user)   Gid: ( 1000/  user)');
      // This fs has no stored mtime, so timestamps honestly report epoch
      // (matching the %Y/%X/%Z format-string handling above) rather than
      // fabricating real-looking timestamps for data that was never tracked.
      wl('Access: ' + new Date(0).toISOString());
      wl('Modify: ' + new Date(0).toISOString());
      wl('Change: ' + new Date(0).toISOString());
      ctx.lastExitCode = 0;
    },
    alias: args => {
      ctx.lastExitCode = 0;
      if (!args.length) { for (const [k, v] of Object.entries(aliases)) wl('alias ' + k + '=\'' + v + '\''); return; }
      for (const a of args) { const eq = a.indexOf('='); if (eq < 0) { wl(aliases[a] ? 'alias ' + a + '=\'' + aliases[a] + '\'' : a + ': not found'); } else { aliases[a.slice(0, eq)] = a.slice(eq + 1).replace(/^['"]|['"]$/g, ''); } }
    },
    unalias: args => { for (const a of args.filter(x => x !== '-a')) delete aliases[a]; if (args.includes('-a')) Object.keys(aliases).forEach(k => delete aliases[k]); ctx.lastExitCode = 0; },
    gzip: async args => {
      const keep = args.includes('-k');
      const decomp = args.includes('-d');
      const paths = args.filter(a => !a.startsWith('-'));
      const s = snap();
      for (const p of paths) {
        const k = toKey(rp(p));
        if (decomp || p.endsWith('.gz')) {
          const src = s[k]; if (src == null) throw new Error(p + ': No such file');
          const raw = src.startsWith('data:application/gzip;base64,') ? src.slice(29) : src;
          const text = await gzipInflate(b64ToAb(raw));
          const out = k.replace(/\.gz$/, '') || k + '.out';
          s[out] = text; if (!keep) delete s[k]; persist(); wl(p + ' -> /' + out);
        } else {
          const src = s[k]; if (src == null) throw new Error(p + ': No such file');
          const ab = await gzipDeflate(src);
          s[k + '.gz'] = 'data:application/gzip;base64,' + abToB64(ab);
          if (!keep) delete s[k]; persist(); wl(p + ' -> /' + k + '.gz');
        }
      }
      ctx.lastExitCode = 0;
    },
    gunzip: async args => {
      const keep = args.includes('-k');
      const paths = args.filter(a => !a.startsWith('-'));
      const s = snap();
      for (const p of paths) {
        const k = toKey(rp(p));
        const src = s[k]; if (src == null) throw new Error(p + ': No such file');
        const raw = src.startsWith('data:application/gzip;base64,') ? src.slice(29) : src;
        const text = await gzipInflate(b64ToAb(raw));
        const out = k.replace(/\.gz$/, '');
        s[out] = text; if (!keep) delete s[k]; persist(); wl(p + ' -> /' + out);
      }
      ctx.lastExitCode = 0;
    },
    md5sum: (args, actor, stdinBuf) => {
      const positional = args.filter(a => !a.startsWith('-'));
      const { stdin, rest: files } = readStdinFirst(positional, stdinBuf);
      const pairs = files.length ? files.map(f => [f, readFile(f)]) : [['', stdin || '']];
      for (const [name, c] of pairs) {
        wl(md5hex(c) + '  ' + (name || '-'));
      }
      ctx.lastExitCode = 0;
    },
    file: args => {
      for (const p of args.filter(a => !a.startsWith('-'))) {
        const k = toKey(rp(p));
        const s = snap();
        if (!(k in s)) { wl(p + ': No such file'); continue; }
        const c = s[k] || '';
        const type = c.startsWith('data:image') ? 'image data' : c.startsWith('{') || c.startsWith('[') ? 'JSON data' : c.startsWith('#!') ? 'script' : 'ASCII text';
        wl(p + ': ' + type + ', ' + c.length + ' bytes');
      }
      ctx.lastExitCode = 0;
    },
    du: args => {
      const human = args.includes('-h');
      const summary = args.includes('-s');
      const path = args.find(a => !a.startsWith('-')) || '.';
      const prefix = toKey(rp(path));
      const fmt = n => human ? (n > 1048576 ? (n / 1048576).toFixed(1) + 'M' : n > 1024 ? (n / 1024).toFixed(1) + 'K' : n + 'B') : String(Math.ceil(n / 512));
      const s = snap();
      const exists = Object.keys(s).some(k => k === prefix || k.startsWith(prefix + '/'));
      if (!exists) throw new Error("du: cannot access '" + path + "': No such file or directory");
      let total = 0;
      if (!summary) {
        const subtotals = new Map();
        for (const [k, v] of Object.entries(s)) {
          if (k !== prefix && !k.startsWith(prefix + '/')) continue;
          const size = typeof v === 'string' ? v.length : 0;
          total += size;
          const rel = k === prefix ? '' : k.slice(prefix.length + 1);
          const slash = rel.indexOf('/');
          if (slash >= 0) {
            const sub = prefix + '/' + rel.slice(0, slash);
            subtotals.set(sub, (subtotals.get(sub) || 0) + size);
          }
        }
        for (const [sub, size] of [...subtotals.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          wl(fmt(size) + '\t' + sub);
        }
      } else {
        for (const [k, v] of Object.entries(s)) {
          if (k === prefix || k.startsWith(prefix + '/')) total += (typeof v === 'string' ? v.length : 0);
        }
      }
      wl(fmt(total) + '\t' + path);
      ctx.lastExitCode = 0;
    },
    df: async args => {
      const human = args.includes('-h');
      const pathArgs = args.filter(a => !a.startsWith('-'));
      const mounts = pathArgs.length ? pathArgs.map(a => rp(a)) : [ctx.cwd];
      const used = Object.values(snap()).reduce((s, v) => s + (typeof v === 'string' ? v.length : 0), 0);
      let total = 50 * 1024 * 1024;
      let usedFallback = true;
      if (navigator.storage && navigator.storage.estimate) {
        try {
          const { quota } = await navigator.storage.estimate();
          if (quota) { total = quota; usedFallback = false; }
        } catch (e) { ctx.lastDfEstimateError = e && e.message; }
      }
      const fmt = n => human ? (n > 1048576 ? (n / 1048576).toFixed(0) + 'M' : (n / 1024).toFixed(0) + 'K') : String(Math.ceil(n / 1024));
      const pct = Math.round(used / total * 100) + '%';
      wl('Filesystem      Size  Used Avail Use% Mounted on');
      for (const mount of mounts) {
        wl((usedFallback ? 'idb(est)' : 'idb').padEnd(16) + fmt(total).padStart(4) + '  ' + fmt(used).padStart(4) + '  ' + fmt(total - used).padStart(5) + '  ' + pct.padStart(4) + '  ' + mount);
      }
      ctx.lastExitCode = 0;
    },
  };
}
