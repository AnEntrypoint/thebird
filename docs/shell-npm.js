import { NPM_VERSION } from './shell-node-modules.js';

const toKey = p => p.replace(/^\//, '');
const snap = () => window.__debug.idbSnapshot || {};
const persist = () => window.__debug.idbPersist?.();

function resolvePkgJson(cwd, ctx) {
  const path = cwd.replace(/\/$/, '') + '/package.json';
  const raw = snap()[toKey(path)];
  if (!raw) throw new Error('npm: no package.json in ' + cwd);
  try { return { path, data: JSON.parse(raw) }; } catch (e) { throw new Error('npm: invalid package.json: ' + e.message); }
}

async function installOne(pkg, version, term) {
  const spec = version && version !== 'latest' ? pkg + '@' + version.replace(/^[\^~]/, '') : pkg;
  const url = 'https://esm.sh/' + spec + '?bundle&target=es2022';
  term.write('  → ' + spec + '\r\n');
  await import(url);
  const stubPath = 'node_modules/' + pkg + '/index.js';
  snap()[stubPath] = '// esm.sh async stub\nawait import(' + JSON.stringify(url) + ');';
  const meta = { name: pkg, version: version || 'latest', _resolved: url, _from: 'esm.sh' };
  snap()['node_modules/' + pkg + '/package.json'] = JSON.stringify(meta, null, 2);
  persist();
}

function writePkgJson(pkgPath, data) {
  snap()[toKey(pkgPath)] = JSON.stringify(data, null, 2);
  persist();
}

function injectNpmEnv(ctx, data, scriptName) {
  const prev = {};
  const set = (k, v) => { prev[k] = ctx.env[k]; ctx.env[k] = v; };
  set('npm_lifecycle_event', scriptName);
  set('npm_package_name', data.name || '');
  set('npm_package_version', data.version || '');
  set('npm_config_user_agent', 'npm/' + NPM_VERSION + ' node/v23.10.0');
  set('NODE_ENV', ctx.env.NODE_ENV || 'development');
  for (const [k, v] of Object.entries(data.scripts || {})) set('npm_package_scripts_' + k.replace(/[^a-z0-9_]/gi, '_'), v);
  return () => { for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete ctx.env[k]; else ctx.env[k] = prev[k]; } };
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
      if (!entries.length) { wl('up to date, 0 packages'); return; }
      wl('installing ' + entries.length + ' packages from package.json');
      for (const [name, ver] of entries) await installOne(name, ver, ctx.term);
      wl('added ' + entries.length + ' package' + (entries.length === 1 ? '' : 's'));
      return;
    }
    for (const spec of pkgs) {
      const m = spec.match(/^(@?[^@]+?)(?:@(.+))?$/);
      const [, name, version] = m;
      await installOne(name, version, ctx.term);
    }
    if (!noSave) {
      const { path: pkgPath, data } = resolvePkgJson(ctx.cwd, ctx);
      const target = saveDev ? 'devDependencies' : 'dependencies';
      data[target] = data[target] || {};
      for (const spec of pkgs) {
        const m = spec.match(/^(@?[^@]+?)(?:@(.+))?$/);
        data[target][m[1]] = m[2] || 'latest';
      }
      writePkgJson(pkgPath, data);
    }
    wl('added ' + pkgs.length + ' package' + (pkgs.length === 1 ? '' : 's'));
  }

  function cmdUninstall(args) {
    const pkgs = args.filter(a => !a.startsWith('-'));
    if (!pkgs.length) throw new Error('npm uninstall <pkg>');
    for (const pkg of pkgs) {
      const s = snap();
      let n = 0;
      for (const k of Object.keys(s)) {
        if (k === 'node_modules/' + pkg + '/index.js' || k.startsWith('node_modules/' + pkg + '/')) { delete s[k]; n++; }
      }
      wl(n ? 'removed ' + pkg : pkg + ' not installed');
    }
    const { path: pkgPath, data } = resolvePkgJson(ctx.cwd, ctx);
    for (const pkg of pkgs) { delete data.dependencies?.[pkg]; delete data.devDependencies?.[pkg]; }
    writePkgJson(pkgPath, data);
    persist();
  }

  function cmdList(args) {
    const filter = args.find(a => !a.startsWith('-'));
    const s = snap();
    const installed = Object.keys(s).filter(k => k.match(/^node_modules\/[^/]+\/package\.json$/) || k.match(/^node_modules\/@[^/]+\/[^/]+\/package\.json$/));
    try {
      const { data } = resolvePkgJson(ctx.cwd, ctx);
      wl(data.name + '@' + (data.version || '1.0.0') + ' ' + ctx.cwd);
    } catch { wl('(no package.json)'); }
    for (const k of installed) {
      const name = k.replace(/^node_modules\//, '').replace(/\/package\.json$/, '');
      if (filter && !name.includes(filter)) continue;
      const pj = JSON.parse(s[k]);
      wl('├── ' + name + '@' + (pj.version || 'latest'));
    }
  }

  async function cmdRun(args) {
    const [scriptName, ...rest] = args;
    const { data } = resolvePkgJson(ctx.cwd, ctx);
    if (!scriptName) {
      wl('Lifecycle scripts included in ' + (data.name || 'package') + '@' + (data.version || '') + ':');
      for (const [n, s] of Object.entries(data.scripts || {})) wl('  ' + n + '\r\n    ' + s);
      return null;
    }
    const cmd = data.scripts?.[scriptName];
    if (!cmd) throw new Error('npm: Missing script: "' + scriptName + '"');
    const pre = data.scripts?.['pre' + scriptName];
    const post = data.scripts?.['post' + scriptName];
    const restore = injectNpmEnv(ctx, data, scriptName);
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
    const pj = { name: ctx.cwd.split('/').filter(Boolean).pop() || 'project', version: '1.0.0', main: 'index.js', scripts: { start: 'node index.js', test: 'echo "Error: no test specified" && exit 1' }, dependencies: {} };
    writePkgJson(ctx.cwd.replace(/\/$/, '') + '/package.json', pj);
    wl('Wrote to ' + ctx.cwd.replace(/\/$/, '') + '/package.json');
  }

  async function cmdExec(args) {
    const pkg = args[0];
    if (!pkg) throw new Error('npx: package required');
    const s = snap();
    if (!s['node_modules/' + pkg + '/index.js']) await installOne(pkg, null, ctx.term);
    const binPath = 'node_modules/.bin/' + pkg;
    if (s[binPath]) return { runInShell: 'node /' + binPath + (args.length > 1 ? ' ' + args.slice(1).join(' ') : '') };
    return { runInShell: 'node -e "require(\'' + pkg + '\')"' };
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
