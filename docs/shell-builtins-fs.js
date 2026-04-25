import { resolvePath } from './shell-builtins.js';

const toKey = p => p.replace(/^\//, '');
const snap = () => window.__debug?.idbSnapshot || {};
const persist = () => window.__debug?.idbPersist?.();

export function makeFsBuiltins(ctx, readFile, writeFile) {
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');
  const rp = p => resolvePath(ctx.cwd, p);

  const aliases = ctx.aliases || (ctx.aliases = {});

  function gzipDeflate(str) {
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
      if (sym) { s[dstK] = s[srcK] ?? ''; persist(); }
      else { if (!(srcK in s)) throw new Error(src + ': No such file'); s[dstK] = s[srcK]; persist(); }
    },
    chmod: args => {
      const paths = args.filter(a => !a.startsWith('-') && !/^\d+$/.test(a));
      for (const p of paths) { const k = toKey(rp(p)); if (!(k in snap()) && !Object.keys(snap()).some(x => x.startsWith(k + '/'))) throw new Error(p + ': No such file'); }
    },
    stat: args => {
      const path = args.find(a => !a.startsWith('-'));
      if (!path) throw new Error('stat: missing operand');
      const k = toKey(rp(path));
      const s = snap();
      const isDir = !(k in s) && Object.keys(s).some(x => x.startsWith(k + '/'));
      if (!isDir && !(k in s)) throw new Error(path + ': No such file or directory');
      const size = isDir ? 0 : (s[k]?.length || 0);
      wl('  File: ' + path);
      wl('  Size: ' + size + '\t\tBlocks: ' + Math.ceil(size / 512) + '\t' + (isDir ? 'directory' : 'regular file'));
      wl('Access: -rwxr-xr-x  Uid: 1000  Gid: 1000');
    },
    alias: args => {
      if (!args.length) { for (const [k, v] of Object.entries(aliases)) wl('alias ' + k + '=\'' + v + '\''); return; }
      for (const a of args) { const eq = a.indexOf('='); if (eq < 0) { wl(aliases[a] ? 'alias ' + a + '=\'' + aliases[a] + '\'' : a + ': not found'); } else { aliases[a.slice(0, eq)] = a.slice(eq + 1).replace(/^['"]|['"]$/g, ''); } }
    },
    unalias: args => { for (const a of args.filter(x => x !== '-a')) delete aliases[a]; if (args.includes('-a')) Object.keys(aliases).forEach(k => delete aliases[k]); },
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
          s[out] = text; if (!keep) delete s[k]; persist(); wl(p + ' → /' + out);
        } else {
          const src = s[k]; if (src == null) throw new Error(p + ': No such file');
          const ab = await gzipDeflate(src);
          s[k + '.gz'] = 'data:application/gzip;base64,' + abToB64(ab);
          if (!keep) delete s[k]; persist(); wl(p + ' → /' + k + '.gz');
        }
      }
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
        s[out] = text; if (!keep) delete s[k]; persist(); wl(p + ' → /' + out);
      }
    },
    md5sum: args => {
      const stdinFirst = args.length > 0 && args[0].includes('\n');
      const stdin = stdinFirst ? args[0] : null;
      const files = stdinFirst ? args.slice(1) : args;
      const pairs = files.length ? files.map(f => [f, readFile(f)]) : [['', stdin || '']];
      for (const [name, c] of pairs) {
        let h = 0x811c9dc5;
        for (let i = 0; i < c.length; i++) { h ^= c.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
        wl(h.toString(16).padStart(8, '0').repeat(4) + '  ' + (name || '-'));
      }
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
    },
    du: args => {
      const human = args.includes('-h');
      const path = args.find(a => !a.startsWith('-')) || '.';
      const prefix = toKey(rp(path));
      let total = 0;
      for (const [k, v] of Object.entries(snap())) {
        if (k === prefix || k.startsWith(prefix + '/')) total += (typeof v === 'string' ? v.length : 0);
      }
      const fmt = human ? (total > 1048576 ? (total / 1048576).toFixed(1) + 'M' : total > 1024 ? (total / 1024).toFixed(1) + 'K' : total + 'B') : String(Math.ceil(total / 512));
      wl(fmt + '\t' + path);
    },
    df: args => {
      const human = args.includes('-h');
      const used = Object.values(snap()).reduce((s, v) => s + (typeof v === 'string' ? v.length : 0), 0);
      const total = 50 * 1024 * 1024;
      const fmt = n => human ? (n > 1048576 ? (n / 1048576).toFixed(0) + 'M' : (n / 1024).toFixed(0) + 'K') : String(Math.ceil(n / 1024));
      wl('Filesystem      Size  Used Avail Use% Mounted on');
      wl('idb             ' + fmt(total) + '  ' + fmt(used) + '  ' + fmt(total - used) + '   ' + Math.round(used / total * 100) + '%  /');
    },
  };
}
