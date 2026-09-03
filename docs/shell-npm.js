import { NPM_VERSION, NODE_VERSION } from './shell-node-modules.js';

import { toKey, snap, persist } from './shell-idb.js';
import { untar } from './shell-node-tar.js';
import { getFflate } from './shell-node-stdlib.js';
import { lookupNativeDepStub, writeInertStub } from './lib/npm-stubs.js';

function resolvePkgJson(cwd, ctx) {
  const path = cwd.replace(/\/$/, '') + '/package.json';
  const raw = snap()[toKey(path)];
  if (!raw) throw new Error('npm: no package.json in ' + cwd);
  try { return { path, data: JSON.parse(raw) }; } catch (e) { throw new Error('npm: invalid package.json: ' + e.message); }
}

// Shared by cmdInstall and cmdExec: parses `pkg`, `pkg@version`, `@scope/pkg`,
// `@scope/pkg@version` into { name, version }. cmdExec previously used args[0]
// directly as both the install-check key and the bin-lookup key, so a scoped
// or version-pinned spec silently mis-resolved (e.g. `npx @scope/pkg` looked
// up node_modules/@scope/pkg literally, which happens to work for the
// node_modules path segment, but `npx pkg@1.2.3` looked up
// node_modules/.bin/pkg@1.2.3 instead of node_modules/.bin/pkg).
function parsePkgSpec(spec) {
  const m = spec.match(/^(@?[^@]+?)(?:@(.+))?$/);
  return { name: m[1], version: m[2] };
}

// Reads a package.json `bin` field, which npm allows as either a bare string
// (single bin, name = package name minus scope) or an object map of
// { binName: relativePath } (zerohop's package.json uses the object form:
// {"zerohop":"bin/zerohop.js"}). Returns a Map<binName, relPath>.
function normalizeBinField(pkgJson) {
  const bin = pkgJson.bin;
  const out = new Map();
  if (!bin) return out;
  if (typeof bin === 'string') {
    const short = (pkgJson.name || '').replace(/^@[^/]+\//, '');
    if (short) out.set(short, bin);
    return out;
  }
  if (typeof bin === 'object') {
    for (const [name, relPath] of Object.entries(bin)) if (typeof relPath === 'string') out.set(name, relPath);
  }
  return out;
}

// npx/cmdExec resolution path, distinct from installOne's esm.sh browser-bundle
// path used by `npm install` for library imports. A CLI package's real entry is
// a Node bin script (process.argv/fs/child_process, CJS or ESM source) — an
// esm.sh bundle-for-browser-import stub cannot serve that: cmdExec's fallback
// `node -e "require(pkg)"` would require() the stub through the CJS require()
// path, which throws ("ESM module requested via require()") because the stub
// body is `await import(...)`. installBin fetches the actual npm registry
// tarball, extracts package.json + every bin script named there (string or
// object form), writes the real source under node_modules/<pkg>/ and a real
// pointer at node_modules/.bin/<binName> for each bin entry.
async function installBin(name, version, term) {
  const registryVer = version && version !== 'latest' ? version.replace(/^[\^~]/, '') : 'latest';
  term.write('  -> ' + name + (registryVer !== 'latest' ? '@' + registryVer : '') + ' (fetching package source)\r\n');
  const metaUrl = 'https://esm.sh/' + name + (registryVer !== 'latest' ? '@' + registryVer : '') + '/package.json';
  const RETRIES = 3;
  const TIMEOUTS = [10000, 15000, 20000];
  let pkgJson, lastErr;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUTS[attempt]);
    try {
      const r = await fetch(metaUrl, { signal: ac.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      pkgJson = await r.json();
      lastErr = null;
      break;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < RETRIES - 1) term.write('  retrying (' + (attempt + 2) + '/' + RETRIES + ')...\r\n');
    }
  }
  if (lastErr) {
    const msg = (lastErr.name === 'AbortError' || /timed out/i.test(lastErr.message || '')) ? 'esm.sh slow, try again later' : (lastErr.message || String(lastErr));
    throw new Error('npx: could not resolve ' + name + ' — ' + msg);
  }
  const resolvedVersion = pkgJson.version || registryVer;
  term.write('npm warn exec The following package was not found and will be installed: ' + name + '@' + resolvedVersion + '\r\n');
  const scopelessName = name.split('/').pop();
  const tarballUrl = 'https://registry.npmjs.org/' + name + '/-/' + scopelessName + '-' + resolvedVersion + '.tgz';
  let tarBytes;
  {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    try {
      const r = await fetch(tarballUrl, { signal: ac.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      tarBytes = new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      clearTimeout(timer);
      throw new Error('npx: tarball fetch failed for ' + name + '@' + resolvedVersion + ' — ' + (e.message || e));
    }
  }
  const fflate = await getFflate().catch(() => null);
  let bytes = tarBytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (!fflate?.gunzipSync) throw new Error('npx: gzip decoder unavailable for ' + name);
    bytes = fflate.gunzipSync(bytes);
  }
  const entries = untar(bytes);
  const base = 'node_modules/' + name;
  let realPkgJson = null;
  const staged = Object.create(null);
  for (const e of entries) {
    if (e.truncated || !e.data || e.type === '5') continue;
    // npm tarballs wrap all entries under a single top-level dir (usually
    // "package/"), which must be stripped to land at node_modules/<pkg>/.
    const rel = e.name.replace(/^[^/]+\//, '').replace(/\\/g, '/');
    if (!rel) continue;
    const segs = rel.split('/');
    if (rel.startsWith('/') || segs.some(seg => seg === '..' || seg === '')) throw new Error('npx: path traversal rejected in tarball entry: ' + e.name);
    const key = base + '/' + rel;
    if (!key.startsWith(base + '/')) throw new Error('npx: path traversal rejected in tarball entry: ' + e.name);
    const text = new TextDecoder().decode(e.data);
    staged[key] = text;
    if (rel === 'package.json') { try { realPkgJson = JSON.parse(text); } catch { /* fall back to esm.sh metadata below */ } }
  }
  if (!Object.keys(staged).length) throw new Error('npx: tarball for ' + name + '@' + resolvedVersion + ' contained no files');
  if (realPkgJson && realPkgJson.version && realPkgJson.version !== resolvedVersion) {
    term.write('npm warn exec fetched tarball version ' + realPkgJson.version + ' differs from resolved version ' + resolvedVersion + ' (registry race or stale esm.sh cache)\r\n');
  }
  const finalPkgJson = realPkgJson || pkgJson;
  if (!realPkgJson) staged[base + '/package.json'] = JSON.stringify(finalPkgJson, null, 2);
  const binMap = normalizeBinField(finalPkgJson);
  for (const [binName, relPath] of binMap) {
    const scriptKey = base + '/' + relPath.replace(/^\.\//, '');
    if (!(scriptKey in staged)) continue; // bin field points at a file the tarball didn't ship — skip, don't fabricate
    staged['node_modules/.bin/' + binName] = staged[scriptKey];
  }
  // All validation passed and every entry is staged locally — only now touch
  // the live shared snapshot, so a mid-loop throw above never partially
  // writes/corrupts s.
  const s = snap();
  Object.assign(s, staged);
  persist();
  return { pkgJson: finalPkgJson, binMap };
}

// Native-dep resolution step: checks `pkg` against the built-in
// NATIVE_DEP_STUBS map merged with this instance's template-provided
// cfg.npmOverrides (docs/lib/templates.js `overrides` field) BEFORE any
// network fetch is attempted. Returns true if it fully handled the install
// (either writing an inert stub, or recursing into installOne with the
// replacement spec) so the caller can skip the real esm.sh fetch path.
// Never throws -- an override map read failure just falls through to the
// normal install, since this is a UX nicety, not a hard requirement.
async function tryInstallNativeDepStub(pkg, version, term, ctx) {
  let instanceOverrides;
  try { instanceOverrides = ctx?.fs?.getConfig?.()?.npmOverrides; } catch { instanceOverrides = undefined; }
  const stub = lookupNativeDepStub(pkg, instanceOverrides);
  if (stub === undefined) return false; // no override for this package: proceed normally
  if (stub === null) {
    term.write('  -> ' + pkg + ' (native dependency, installing inert browser stub)\r\n');
    const s = snap();
    writeInertStub(s, pkg, version);
    persist();
    return true;
  }
  // Replacement spec case: redirect the install to the substitute package,
  // then alias it back under the original name so `require(pkg)`/import
  // paths written by the rest of the tree still resolve.
  term.write('  -> ' + pkg + ' (native dependency, substituting ' + stub + ')\r\n');
  const { name: subName, version: subVersion } = parsePkgSpec(stub);
  await installOne(subName, subVersion, term, ctx);
  const s = snap();
  const subPkgPath = 'node_modules/' + subName;
  s['node_modules/' + pkg + '/index.js'] = '// npm native-dep override stub: re-exports substitute package ' + JSON.stringify(stub) + '\nexport * from ' + JSON.stringify('../' + subName + '/index.js') + ';\nexport { default } from ' + JSON.stringify('../' + subName + '/index.js') + ';';
  s['node_modules/' + pkg + '/package.json'] = JSON.stringify({ name: pkg, version: version || 'latest', _nativeDepOverride: stub }, null, 2);
  persist();
  return true;
}

async function installOne(pkg, version, term, ctx) {
  if (await tryInstallNativeDepStub(pkg, version, term, ctx)) return;
  const spec = version && version !== 'latest' ? pkg + '@' + version.replace(/^[\^~]/, '') : pkg;
  const url = 'https://esm.sh/' + spec + '?bundle&target=es2022';
  term.write('  -> ' + spec + '\r\n');
  const RETRIES = 3;
  const TIMEOUTS = [10000, 15000, 20000];
  let lastErr;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('install timed out: ' + spec)), TIMEOUTS[attempt]));
    try {
      await Promise.race([import(url), timeout]);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES - 1) term.write('  retrying (' + (attempt + 2) + '/' + RETRIES + ')...\r\n');
    }
  }
  if (lastErr) {
    const hint = (lastErr.message || '').includes('ENOTFOUND') || (lastErr.message || '').includes('Failed to fetch')
      ? 'network unreachable, check connectivity'
      : lastErr.message && lastErr.message.includes('timed out')
        ? 'esm.sh slow, try again later'
        : lastErr.message;
    throw new Error('npm: ' + hint);
  }
  const stubPath = 'node_modules/' + pkg + '/index.js';
  snap()[stubPath] = '// esm.sh async stub\nawait import(' + JSON.stringify(url) + ');';
  const meta = { name: pkg, version: version || 'latest' };
  snap()['node_modules/' + pkg + '/package.json'] = JSON.stringify(meta, null, 2);
  persist();
}

function writePkgJson(pkgPath, data) {
  snap()[toKey(pkgPath)] = JSON.stringify(data, null, 2);
  persist();
}

function injectNpmEnv(ctx, data, scriptName, scriptCmd) {
  const prevEnv = { ...ctx.env };
  ctx.env['npm_command'] = 'run-script';
  ctx.env['npm_lifecycle_event'] = scriptName;
  ctx.env['npm_lifecycle_script'] = scriptCmd || '';
  ctx.env['npm_package_name'] = data.name || '';
  ctx.env['npm_package_version'] = data.version || '';
  ctx.env['npm_package_json'] = ctx.cwd.replace(/\/$/, '') + '/package.json';
  ctx.env['npm_execpath'] = '/usr/local/lib/node_modules/npm/bin/npm-cli.js';
  ctx.env['npm_node_execpath'] = '/usr/local/bin/node';
  if (!ctx.env['INIT_CWD']) ctx.env['INIT_CWD'] = ctx.cwd;
  ctx.env['npm_config_user_agent'] = 'npm/' + NPM_VERSION + ' node/' + NODE_VERSION + ' linux x64 workspaces/false';
  if (!ctx.env['NODE_ENV']) ctx.env['NODE_ENV'] = 'development';
  for (const [k, v] of Object.entries(data.scripts || {})) ctx.env['npm_package_scripts_' + k.replace(/[^a-z0-9_]/gi, '_')] = v;
  return () => { ctx.env = prevEnv; };
}

export function makeNpm(ctx) {
  const w = s => ctx.term.write(s);
  const wl = s => w(s + '\r\n');

  async function cmdInstall(args) {
    const saveDev = args.includes('--save-dev') || args.includes('-D');
    const noSave = args.includes('--no-save');
    const pkgs = args.filter(a => !a.startsWith('-'));
    if (!pkgs.length) {
      const { data } = resolvePkgJson(ctx.cwd, ctx);
      const all = { ...(data.dependencies || {}), ...(data.devDependencies || {}), ...(data.peerDependencies || {}) };
      const entries = Object.entries(all);
      if (!entries.length) { wl('up to date, audited 1 package in ' + Math.floor(Math.random() * 200 + 50) + 'ms'); wl(''); wl('found 0 vulnerabilities'); return; }
      const failed = [];
      for (const [name, ver] of entries) {
        try { await installOne(name, ver, ctx.term, ctx); } catch (e) { failed.push(name + ': ' + e.message); }
      }
      wl('up to date, audited ' + (entries.length + 1) + ' packages in ' + Math.floor(Math.random() * 500 + 100) + 'ms');
      wl('');
      wl('found 0 vulnerabilities');
      for (const f of failed) wl('  failed: ' + f);
      return;
    }
    const failed = [];
    const installed = [];
    for (const spec of pkgs) {
      const { name, version } = parsePkgSpec(spec);
      try { await installOne(name, version, ctx.term, ctx); installed.push(spec); } catch (e) { failed.push(name + ': ' + e.message); }
    }
    if (!noSave && installed.length) {
      const { path: pkgPath, data } = resolvePkgJson(ctx.cwd, ctx);
      const target = saveDev ? 'devDependencies' : 'dependencies';
      data[target] = data[target] || {};
      for (const spec of installed) {
        const { name, version } = parsePkgSpec(spec);
        data[target][name] = version || 'latest';
      }
      writePkgJson(pkgPath, data);
      const lockKey = toKey(pkgPath).replace(/package\.json$/, 'package-lock.json');
      snap()[lockKey] = JSON.stringify({ name: data.name || 'app', version: data.version || '1.0.0', lockfileVersion: 3, dependencies: data.dependencies || {} }, null, 2);
      persist();
    }
    wl('added ' + installed.length + ' package' + (installed.length === 1 ? '' : 's') + ', and audited ' + (installed.length + 1) + ' packages in ' + Math.floor(Math.random() * 300 + 50) + 'ms');
    wl('');
    wl('found 0 vulnerabilities');
    for (const f of failed) wl('  failed: ' + f);
  }

  function cmdUninstall(args) {
    const pkgs = args.filter(a => !a.startsWith('-'));
    if (!pkgs.length) throw new Error('npm uninstall <pkg>');
    // collect keys to delete without mutating snap yet
    const toDelete = [];
    const removed = [];
    for (const pkg of pkgs) {
      const s = snap();
      let found = false;
      for (const k of Object.keys(s)) {
        if (k === 'node_modules/' + pkg + '/index.js' || k.startsWith('node_modules/' + pkg + '/')) { toDelete.push(k); found = true; }
      }
      if (found) removed.push(pkg);
    }
    // persist package.json first so a crash between the two writes leaves package.json updated
    const { path: pkgPath, data } = resolvePkgJson(ctx.cwd, ctx);
    for (const pkg of pkgs) { delete data.dependencies?.[pkg]; delete data.devDependencies?.[pkg]; }
    writePkgJson(pkgPath, data);
    // now remove stubs from snap
    const s = snap();
    for (const k of toDelete) delete s[k];
    persist();
    wl('removed ' + removed.length + ' package' + (removed.length === 1 ? '' : 's'));
  }

  function cmdList(args) {
    const filter = args.find(a => !a.startsWith('-'));
    const s = snap();
    // Matches package.json at any node_modules/<pkg>/ or node_modules/@scope/<pkg>/
    // depth, including nested node_modules/<pkg>/node_modules/<dep>/package.json
    // written verbatim by installBin's tarball-extraction loop for bin packages
    // that bundle their own dependencies (see installBin, ~line 120).
    const installed = Object.keys(s).filter(k => k.match(/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/));
    let directDeps = null;
    try {
      const { data } = resolvePkgJson(ctx.cwd, ctx);
      wl(data.name + '@' + (data.version || '1.0.0') + ' ' + ctx.cwd);
      directDeps = new Set(Object.keys({ ...(data.dependencies || {}), ...(data.devDependencies || {}) }));
    } catch { wl('(no package.json)'); }
    const rows = [];
    for (const k of installed) {
      const name = k.replace(/^node_modules\//, '').replace(/\/package\.json$/, '');
      if (filter && !name.includes(filter)) continue;
      if (directDeps && !directDeps.has(name)) continue;
      const pj = JSON.parse(s[k]);
      rows.push(name + '@' + (pj.version || 'latest'));
    }
    if (!rows.length) { wl('└── (empty)'); return; }
    rows.forEach((row, i) => wl((i === rows.length - 1 ? '└── ' : '├── ') + row));
  }

  async function cmdRun(args) {
    const [scriptName, ...rest] = args;
    const { data } = resolvePkgJson(ctx.cwd, ctx);
    if (!scriptName) {
      const LIFECYCLE_SCRIPTS = new Set(['preinstall', 'install', 'postinstall', 'prepublish', 'prepare', 'prepublishOnly', 'prepack', 'postpack', 'preversion', 'version', 'postversion', 'pretest', 'test', 'posttest', 'prestart', 'start', 'poststart', 'prestop', 'stop', 'poststop', 'prerestart', 'restart', 'postrestart']);
      const scripts = Object.entries(data.scripts || {});
      const lifecycle = scripts.filter(([n]) => LIFECYCLE_SCRIPTS.has(n));
      const other = scripts.filter(([n]) => !LIFECYCLE_SCRIPTS.has(n));
      if (lifecycle.length) {
        wl('Lifecycle scripts included in ' + (data.name || 'package') + '@' + (data.version || '') + ':');
        for (const [n, s] of lifecycle) wl('  ' + n + '\r\n    ' + s);
      }
      if (other.length) {
        wl(lifecycle.length
          ? 'available via `npm run-script`:'
          : 'Scripts available in ' + (data.name || 'package') + '@' + (data.version || '') + ' via `npm run-script`:');
        for (const [n, s] of other) wl('  ' + n + '\r\n    ' + s);
      }
      return null;
    }
    const cmd = data.scripts?.[scriptName];
    if (!cmd) throw new Error('npm error Missing script: "' + scriptName + '"\r\nnpm error\r\nnpm error To see a list of scripts, run:\r\nnpm error   npm run\r\nnpm error A complete log of this run can be found in:\r\nnpm error ' + ctx.cwd.replace(/\/$/, '') + '/.npm/_logs/' + Date.now() + '-debug-0.log');
    const pre = data.scripts?.['pre' + scriptName];
    const post = data.scripts?.['post' + scriptName];
    const restore = injectNpmEnv(ctx, data, scriptName, cmd);
    try {
      const chain = [];
      if (pre) chain.push({ name: 'pre' + scriptName, cmd: pre });
      chain.push({ name: scriptName, cmd: cmd + (rest.length ? ' ' + rest.join(' ') : '') });
      if (post) chain.push({ name: 'post' + scriptName, cmd: post });
      return { runInShell: null, npmChain: chain, pkgName: data.name || 'package', pkgVersion: data.version || '' };
    } finally { queueMicrotask(restore); }
  }

  function cmdInit(args) {
    const yes = args.includes('-y') || args.includes('--yes');
    if (!yes) { wl('npm init -y — use -y for non-interactive'); return; }
    const pj = { name: ctx.cwd.split('/').filter(Boolean).pop() || 'project', version: '1.0.0', description: '', main: 'index.js', scripts: { test: 'echo "Error: no test specified" && exit 1' }, keywords: [], author: '', license: 'ISC' };
    const path = ctx.cwd.replace(/\/$/, '') + '/package.json';
    writePkgJson(path, pj);
    wl('Wrote to ' + path + ':');
    wl('');
    wl(JSON.stringify(pj, null, 2));
    wl('');
  }

  async function cmdExec(args) {
    const spec = args[0];
    if (!spec) throw new Error('npx: package required');
    const { name, version } = parsePkgSpec(spec);
    const runArgs = args.slice(1);
    const base = 'node_modules/' + name;
    let s = snap();
    let binMap;
    const pjKey = base + '/package.json';
    if (s[pjKey]) {
      let installedPjData = null;
      try { installedPjData = JSON.parse(s[pjKey]); binMap = normalizeBinField(installedPjData); } catch { binMap = new Map(); }
      // Previously-installed via `npm install` (esm.sh stub, no real bin source)
      // rather than a prior npx run: no .bin entries land from that path, so
      // fall through to a real installBin fetch instead of trusting the stub.
      const hasBinFile = [...binMap.values()].some(relPath => (base + '/' + relPath.replace(/^\.\//, '')) in s);
      if (!hasBinFile) binMap = null;
      // Cached install may be a DIFFERENT version than this invocation asked
      // for (e.g. `npx foo@1.0.0` then later `npx foo@2.0.0` in the same live
      // snapshot): only trust the cache when the requested version is absent
      // or a floating tag ('latest'/'*'), or exactly matches the installed
      // package.json's own `version` field — otherwise refetch via installBin.
      if (binMap && version && version !== 'latest' && version !== '*') {
        const wanted = version.replace(/^[\^~]/, '');
        const installedVersion = installedPjData && installedPjData.version;
        if (installedVersion !== wanted) binMap = null;
      }
    }
    if (!binMap) {
      const installed = await installBin(name, version, ctx.term);
      binMap = installed.binMap;
      s = snap();
    }
    // Resolve which bin to run: `npx pkg` runs pkg's own single/first bin;
    // `npx pkg subcmd` where subcmd matches a named bin in a multi-bin
    // package runs that one instead (subcmd is then NOT passed as an arg).
    let binName = null;
    if (binMap.has(name.split('/').pop())) binName = name.split('/').pop();
    else if (binMap.size) binName = binMap.keys().next().value;
    if (binName && runArgs[0] === binName && binMap.has(runArgs[0])) runArgs.shift();
    // Run from the package's REAL path (node_modules/<pkg>/<binRelPath>), not
    // the node_modules/.bin/<binName> copy: on real npm, .bin entries are
    // SYMLINKS, so a script's __dirname resolves through the link to the
    // package's actual directory. A flat copy under .bin/ gives __dirname =
    // node_modules/.bin, one level shallower than the real target — any bin
    // script that locates sibling files via __dirname (e.g.
    // `readFileSync(join(__dirname,'..','readme.md'))`) then resolves to the
    // wrong path and throws ENOENT. The .bin/ entry installBin() writes stays
    // only as a discoverability marker; execution targets the real file.
    const realRelPath = binName && binMap.get(binName);
    const realBinPath = realRelPath ? base + '/' + realRelPath.replace(/^\.\//, '') : null;
    if (binName && realBinPath && s[realBinPath]) return { runInShell: 'node /' + realBinPath + (runArgs.length ? ' ' + runArgs.join(' ') : '') };
    // binName resolved (package.json declared a bin) but the tarball never
    // shipped that file (installBin's skip at the "bin field points at a
    // file the tarball didn't ship" guard, or a stale/partial package.json
    // left a dangling bin entry): this is a package-integrity problem, not
    // an "it's a library not a CLI" case, so surface it directly instead of
    // silently falling through to require() and producing an opaque runtime
    // error the user can't diagnose.
    if (binName && realRelPath) throw new Error('npx: ' + name + ' declares bin "' + binName + '" -> ' + realRelPath + ' but the fetched package did not include that file');
    // No bin field at all: fall back to requiring the package as a library
    // entry (its main/exports), now backed by the REAL fetched source (from
    // installBin) rather than an esm.sh import-stub, so this still executes
    // through the CJS-or-ESM-aware loader instead of throwing on
    // ESM-via-require().
    return { runInShell: 'node -e "require(\'' + name + '\')"' };
  }

  return async function npm(args) {
    const sub = args[0];
    const rest = args.slice(1);
    if (sub === 'install' || sub === 'i' || sub === 'add') return cmdInstall(rest);
    if (sub === 'uninstall' || sub === 'remove' || sub === 'rm') return cmdUninstall(rest);
    if (sub === 'ls' || sub === 'list') return cmdList(rest);
    if (sub === 'run' || sub === 'run-script') return cmdRun(rest);
    if (sub === 'start') return cmdRun(['start', ...rest]);
    if (sub === 'test' || sub === 't') return cmdRun(['test', ...rest]);
    if (sub === 'init' || sub === 'create') return cmdInit(rest);
    if (sub === 'exec' || sub === 'x') return cmdExec(rest);
    if (sub === '--version' || sub === '-v') { wl(NPM_VERSION); return; }
    if (sub === 'prefix') { wl(ctx.cwd); return; }
    if (sub === 'root') { wl(ctx.cwd.replace(/\/$/, '') + '/node_modules'); return; }
    if (sub === 'view' || sub === 'info' || sub === 'show') { const p = rest[0]; wl(p + ' — use esm.sh to inspect'); return; }
    throw new Error('npm: unknown command "' + sub + '"');
  };
}

export function makeNpx(npmCmd) {
  return args => npmCmd(['exec', ...args]);
}
