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
      try {
        const { path: pkgPath, data } = resolvePkgJson(ctx.cwd, ctx);
        const target = saveDev ? 'devDependencies' : 'dependencies';
        data[target] = data[target] || {};
        for (const spec of pkgs) {
          const m = spec.match(/^(@?[^@]+?)(?:@(.+))?$/);
          data[target][m[1]] = m[2] || 'latest';
        }
        writePkgJson(pkgPath, data);
      } catch {}
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
    try {
      const { path: pkgPath, data } = resolvePkgJson(ctx.cwd, ctx);
      for (const pkg of pkgs) { delete data.dependencies?.[pkg]; delete data.devDependencies?.[pkg]; }
      writePkgJson(pkgPath, data);
    } catch {}
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
    if (!scriptName) {
      try {
        const { data } = resolvePkgJson(ctx.cwd, ctx);
        wl('Scripts:');
        for (const [n, s] of Object.entries(data.scripts || {})) wl('  ' + n + '\r\n    ' + s);
      } catch (e) { wl(e.message); }
      return null;
    }
    const { data } = resolvePkgJson(ctx.cwd, ctx);
    const cmd = data.scripts?.[scriptName];
    if (!cmd) throw new Error('npm: script "' + scriptName + '" not found in package.json');
    wl('> ' + (data.name || 'package') + '@' + (data.version || '') + ' ' + scriptName);
    wl('> ' + cmd + '\r\n');
    return { runInShell: cmd + (rest.length ? ' ' + rest.join(' ') : '') };
  }

  function cmdInit(args) {
    const yes = args.includes('-y') || args.includes('--yes');
    if (!yes) { wl('npm init -y — use -y for non-interactive'); return; }
    const pj = { name: ctx.cwd.split('/').filter(Boolean).pop() || 'project', version: '1.0.0', main: 'index.js', scripts: { start: 'node index.js' }, dependencies: {} };
    writePkgJson(ctx.cwd.replace(/\/$/, '') + '/package.json', pj);
    wl('wrote package.json');
  }

  return async function npm(args) {
    const sub = args[0];
    const rest = args.slice(1);
    if (sub === 'install' || sub === 'i' || sub === 'add') return cmdInstall(rest);
    if (sub === 'uninstall' || sub === 'remove' || sub === 'rm') return cmdUninstall(rest);
    if (sub === 'ls' || sub === 'list') return cmdList(rest);
    if (sub === 'run' || sub === 'run-script') return cmdRun(rest);
    if (sub === 'start') return cmdRun(['start', ...rest]);
    if (sub === 'test') return cmdRun(['test', ...rest]);
    if (sub === 'init') return cmdInit(rest);
    if (sub === '--version' || sub === '-v') { wl('10.0.0 (thebird browser jsh)'); return; }
    throw new Error('npm: unknown command "' + sub + '" — try: install, uninstall, ls, run, init');
  };
}
