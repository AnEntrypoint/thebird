const NPM_VERSION = '0.2.0';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const NPX_CACHE = '/.thebird/npx';
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const { gunzipSync, sha512, semver } = thebirdNpmLibs;
const { name, argv, cwd } = globalThis.__npmInput;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

class NpmError extends Error {
  constructor(message) {
    super(message);
    this.name = name;
  }
}

let pendingOutput = '';
const flushOutput = () => {
  if (pendingOutput !== '') {
    console.log(pendingOutput);
    pendingOutput = '';
  }
};

globalThis.process = {
  argv: [name],
  env: {},
  platform: 'linux',
  arch: 'x64',
  version: `v${tjs.version}`,
  versions: { txiki: tjs.version },
  cwd: () => cwd,
  exitCode: 0,
  stdout: {
    write(text) {
      const lines = (pendingOutput + String(text)).split('\n');
      pendingOutput = lines.pop();
      for (const line of lines) console.log(line);
      return true;
    },
  },
  exit(code = 0) {
    flushOutput();
    tjs.exit(code);
  },
};

const normalize = (path) => {
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
};
const dirname = (path) => {
  const at = path.lastIndexOf('/');
  return at <= 0 ? '/' : path.slice(0, at);
};
const basename = (path) => path.split('/').pop();
const join = (...parts) => normalize(parts.join('/'));
const absolute = (path) => normalize(path.startsWith('/') ? path : `${cwd}/${path}`);

const isDir = (path) => {
  try {
    return Array.isArray(__thebirdFs.readdir(path));
  } catch {
    return false;
  }
};
const existsAny = (path) => {
  try {
    return __thebirdFs.lstat(path) != null;
  } catch {
    return false;
  }
};
const readBytes = (path) => __thebirdFs.readFile(path);
const readText = (path) => {
  const bytes = readBytes(path);
  return bytes === undefined ? undefined : decoder.decode(bytes);
};
const readJson = (path) => {
  const text = readText(path);
  return text === undefined ? undefined : JSON.parse(text);
};
const isFile = (path) => {
  try {
    return !isDir(path) && readBytes(path) !== undefined;
  } catch {
    return false;
  }
};
const mkdirp = (path) => {
  let current = '';
  for (const part of normalize(path).split('/').filter(Boolean)) {
    current += `/${part}`;
    if (__thebirdFs.stat(current) == null) __thebirdFs.mkdir(current);
  }
};
const writeBytes = (path, bytes) => {
  mkdirp(dirname(path));
  const copy = new Uint8Array(bytes);
  if (!__thebirdFs.writeFile(path, copy.buffer)) throw new NpmError(`EIO: cannot write ${path}`);
};
const writeText = (path, text) => writeBytes(path, encoder.encode(text));
const rmTree = (path) => {
  if (!existsAny(path)) return;
  const names = isDir(path) ? __thebirdFs.readdir(path) : null;
  if (names) {
    for (const entry of names) rmTree(`${path}/${entry}`);
    __thebirdFs.rmdir(path);
  } else {
    __thebirdFs.unlink(path);
  }
};

const base64 = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const integrityOf = (bytes) => `sha512-${base64(sha512(bytes))}`;

const field = (block, start, length) => decoder.decode(block.subarray(start, start + length)).replace(/\0[\s\S]*$/, '');
const octal = (block, start, length) => parseInt(field(block, start, length).trim() || '0', 8);
const paxPath = (body) => new RegExp('\\d+ path=([^\\n]*)\\n').exec(decoder.decode(body))?.[1] ?? null;

const extractTar = (bytes, dest) => {
  let offset = 0;
  let pending = null;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = octal(header, 124, 12);
    const body = bytes.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    const type = String.fromCharCode(header[156] || 48);
    if (type === 'x') {
      pending = paxPath(body);
      continue;
    }
    if (type === 'L') {
      pending = field(body, 0, body.length);
      continue;
    }
    if (type === 'g') continue;
    const prefix = field(header, 345, 155);
    const path = pending ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    pending = null;
    const relative = path.split('/').filter(Boolean).slice(1);
    if (relative.includes('..')) throw new NpmError(`unsafe path in tarball: ${path}`);
    if (relative.length === 0) continue;
    const target = join(dest, relative.join('/'));
    if (type === '5') mkdirp(target);
    else if (type === '0') writeBytes(target, body);
  }
};

const config = (() => {
  const entries = {};
  for (const path of [`${cwd}/.npmrc`, '/.npmrc']) {
    const text = readText(path);
    if (text === undefined) continue;
    for (const line of text.split('\n')) {
      const match = /^\s*([^=\s]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !(match[1] in entries)) entries[match[1]] = match[2];
    }
  }
  return entries;
})();

const registryFor = (pkg) => {
  const scope = pkg.startsWith('@') ? pkg.split('/')[0] : null;
  return (((scope && config[`${scope}:registry`]) || config.registry) ?? DEFAULT_REGISTRY).replace(/\/$/, '');
};
const headersFor = (url) => {
  const bare = url.replace(/^https?:/, '');
  for (const [key, value] of Object.entries(config)) {
    const match = /^(\/\/.*):_authToken$/.exec(key);
    if (match && bare.startsWith(match[1])) return { authorization: `Bearer ${value}` };
  }
  return {};
};

const request = async (url, accept) => {
  let response;
  try {
    response = await fetch(url, { headers: { accept, ...headersFor(url) } });
  } catch (err) {
    throw new NpmError(`request to ${url} failed: ${err.message}`);
  }
  if (!response.ok) {
    const reason = response.status === 404 ? 'Not Found' : response.statusText || 'request failed';
    throw new NpmError(`${response.status} ${reason} - GET ${url}`);
  }
  return response;
};

const packuments = new Map();
const packument = (pkg) => {
  const url = `${registryFor(pkg)}/${pkg.replace('/', '%2f')}`;
  if (!packuments.has(url)) {
    packuments.set(url, request(url, 'application/json').then((response) => response.text()).then((text) => JSON.parse(text)));
  }
  return packuments.get(url);
};

const parseSpec = (spec) => {
  const at = spec.indexOf('@', 1);
  return at === -1 ? { name: spec, range: '' } : { name: spec.slice(0, at), range: spec.slice(at + 1) };
};

const versionOf = async (pkg, range) => {
  const doc = await packument(pkg);
  const tag = range || 'latest';
  const picked = doc['dist-tags']?.[tag] ?? semver.maxSatisfying(Object.keys(doc.versions ?? {}), tag);
  const meta = picked && doc.versions[picked];
  if (!meta) throw new NpmError(`No matching version found for ${pkg}@${tag}`);
  return meta;
};

const satisfies = (version, range) => {
  if (!range || range === '*') return true;
  return semver.validRange(range) !== null && semver.satisfies(version, range);
};

const normalizeBin = (pkgName, bin) => {
  if (!bin) return undefined;
  if (typeof bin === 'string') return { [basename(`/${pkgName}`)]: bin };
  return bin;
};
const entryFrom = (meta) => ({
  name: meta.name,
  version: meta.version,
  resolved: meta.dist.tarball,
  integrity: meta.dist.integrity,
  dependencies: meta.dependencies,
  optionalDependencies: meta.optionalDependencies,
  peerDependencies: meta.peerDependencies,
  peerDependenciesMeta: meta.peerDependenciesMeta,
  bin: normalizeBin(meta.name, meta.bin),
  os: meta.os,
  cpu: meta.cpu,
  engines: meta.engines,
  license: meta.license,
});
const allowedBy = (list, value) => {
  if (!list || list.length === 0) return true;
  if (list.includes(`!${value}`)) return false;
  const positive = list.filter((item) => !item.startsWith('!'));
  return positive.length === 0 || positive.includes(value);
};
const platformOk = (meta) => allowedBy(meta.os, 'linux') && allowedBy(meta.cpu, 'x64');

const parentKey = (key) => {
  if (key === '') return null;
  const at = key.lastIndexOf('/node_modules/');
  return at === -1 ? '' : key.slice(0, at);
};
const ancestors = (key) => {
  const list = [key];
  for (let up = parentKey(key); up !== null; up = parentKey(up)) list.push(up);
  return list;
};
const childKey = (key, pkg) => (key === '' ? `node_modules/${pkg}` : `${key}/node_modules/${pkg}`);
const findPlaced = (packages, from, pkg, range) => {
  for (const key of ancestors(from)) {
    const candidate = childKey(key, pkg);
    const entry = packages[candidate];
    if (entry) return satisfies(entry.version, range) ? candidate : null;
  }
  return null;
};
const placementFor = (packages, from, pkg) => {
  const top = childKey('', pkg);
  if (!packages[top] || from === '') return top;
  return childKey(from, pkg);
};

const placeAll = async (lock, requests) => {
  const placed = [];
  const queue = [...requests];
  while (queue.length > 0) {
    const task = queue.shift();
    if (findPlaced(lock.packages, task.from, task.pkg, task.range) !== null) continue;
    let meta;
    try {
      meta = await versionOf(task.pkg, task.range);
    } catch (err) {
      if (task.optional || task.peer) continue;
      throw err;
    }
    if (task.optional && !platformOk(meta)) continue;
    const key = placementFor(lock.packages, task.from, task.pkg);
    lock.packages[key] = entryFrom(meta);
    placed.push({ name: task.pkg, version: meta.version });
    for (const [dep, range] of Object.entries(meta.dependencies ?? {})) queue.push({ from: key, pkg: dep, range });
    for (const [dep, range] of Object.entries(meta.optionalDependencies ?? {})) queue.push({ from: key, pkg: dep, range, optional: true });
    for (const [dep, range] of Object.entries(meta.peerDependencies ?? {})) {
      if (!meta.peerDependenciesMeta?.[dep]?.optional) queue.push({ from: key, pkg: dep, range, peer: true });
    }
  }
  return placed;
};

const rootSeeds = (lock, fields) => fields.flatMap((field) => Object.entries(lock.packages[''][field] ?? {}).map(([pkg, range]) => ({ from: '', pkg, range })));
const walk = (packages, seeds, fields) => {
  const seen = new Set();
  const queue = [...seeds];
  while (queue.length > 0) {
    const task = queue.shift();
    const key = findPlaced(packages, task.from, task.pkg, task.range);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    for (const fieldName of fields) {
      for (const [dep, range] of Object.entries(packages[key][fieldName] ?? {})) queue.push({ from: key, pkg: dep, range });
    }
  }
  return seen;
};
const markFlags = (lock) => {
  const required = walk(lock.packages, rootSeeds(lock, ['dependencies']), ['dependencies', 'peerDependencies']);
  const optional = walk(lock.packages, rootSeeds(lock, ['dependencies', 'optionalDependencies']), ['dependencies', 'peerDependencies', 'optionalDependencies']);
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '') continue;
    delete entry.dev;
    delete entry.optional;
    if (required.has(key)) continue;
    if (optional.has(key)) entry.optional = true;
    else entry.dev = true;
  }
};
const prune = (lock) => {
  const reachable = walk(lock.packages, rootSeeds(lock, DEP_FIELDS), ['dependencies', 'optionalDependencies', 'peerDependencies']);
  const removed = [];
  for (const key of Object.keys(lock.packages)) {
    if (key === '' || reachable.has(key)) continue;
    removed.push(key);
    delete lock.packages[key];
  }
  return removed;
};

const keyDir = (key, root = cwd) => (key === '' ? root : join(root, key));
const sortedKeys = (lock) => Object.keys(lock.packages).filter((key) => key !== '').sort((a, b) => a.length - b.length || (a < b ? -1 : 1));

const fetchTarball = async (entry) => {
  const response = await request(entry.resolved, '*/*');
  const compressed = new Uint8Array(await response.arrayBuffer());
  if (!entry.integrity || integrityOf(compressed) !== entry.integrity) {
    throw new NpmError(`integrity check failed for ${entry.name}@${entry.version} from ${entry.resolved}`);
  }
  return gunzipSync(compressed);
};

const materialise = async (lock, root = cwd) => {
  for (const key of sortedKeys(lock)) {
    const entry = lock.packages[key];
    const dir = keyDir(key, root);
    const current = readJson(`${dir}/package.json`);
    if (current?.version === entry.version && current?.name === entry.name) continue;
    rmTree(dir);
    extractTar(await fetchTarball(entry), dir);
  }
};

const linkBins = (lock, root = cwd) => {
  const bin = join(root, 'node_modules', '.bin');
  rmTree(bin);
  for (const key of sortedKeys(lock)) {
    if (parentKey(key) !== '') continue;
    for (const [binName, binPath] of Object.entries(lock.packages[key].bin ?? {})) {
      mkdirp(bin);
      __thebirdFs.symlink(`../${key.slice('node_modules/'.length)}/${binPath}`, `${bin}/${binName}`);
    }
  }
};

const readLock = () => {
  const lock = readJson(join(cwd, 'package-lock.json'));
  return lock?.packages ? lock : { packages: {} };
};
const syncRoot = (lock, manifest) => {
  const root = { name: manifest.name ?? basename(cwd), version: manifest.version ?? '1.0.0' };
  for (const fieldName of DEP_FIELDS) {
    if (manifest[fieldName]) root[fieldName] = manifest[fieldName];
  }
  lock.packages[''] = root;
};
const writeLock = (lock) => {
  const packages = { '': lock.packages[''] };
  for (const key of sortedKeys(lock)) packages[key] = lock.packages[key];
  const root = lock.packages[''];
  writeText(join(cwd, 'package-lock.json'), `${JSON.stringify({ name: root.name, version: root.version, lockfileVersion: 3, requires: true, packages }, null, 2)}\n`);
};

const readManifest = () => readJson(join(cwd, 'package.json')) ?? {};
const saveManifest = (manifest) => writeText(join(cwd, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const reportInstalled = (placed, removed) => {
  for (const { name: pkg, version } of placed) console.log(`+ ${pkg}@${version}`);
  if (placed.length === 0 && removed === 0) console.log('up to date');
  else if (placed.length > 0) console.log(`added ${placed.length} package${placed.length === 1 ? '' : 's'}`);
  if (removed > 0) console.log(`removed ${removed} package${removed === 1 ? '' : 's'}`);
};

const rejectFlags = (args) => {
  const flag = args.find((arg) => arg.startsWith('-'));
  if (flag) throw new NpmError(`unsupported option: ${flag}`);
};

const installCommand = async (args) => {
  const options = { specs: [], dev: false, save: true };
  for (const arg of args) {
    if (arg === '-D' || arg === '--save-dev') options.dev = true;
    else if (arg === '--no-save') options.save = false;
    else if (arg.startsWith('-')) throw new NpmError(`unsupported option: ${arg}`);
    else options.specs.push(arg);
  }
  const manifest = readManifest();
  const lock = readLock();
  const working = { ...manifest };
  const fieldName = options.dev ? 'devDependencies' : 'dependencies';
  const requests = options.specs.map((spec) => {
    const { name: pkg, range } = parseSpec(spec);
    return { from: '', pkg, range };
  });
  for (const { pkg, range } of requests) working[fieldName] = { ...working[fieldName], [pkg]: range || '*' };
  syncRoot(lock, working);
  const placed = await placeAll(lock, requests.length > 0 ? requests : rootSeeds(lock, DEP_FIELDS).map((seed) => ({ ...seed, optional: false })));
  if (options.save && requests.length > 0) {
    for (const { pkg } of requests) {
      manifest[fieldName] = { ...manifest[fieldName], [pkg]: `^${lock.packages[childKey('', pkg)].version}` };
    }
    working[fieldName] = manifest[fieldName];
  }
  syncRoot(lock, working);
  const removed = prune(lock);
  for (const key of removed) rmTree(keyDir(key));
  markFlags(lock);
  await materialise(lock);
  linkBins(lock);
  writeLock(lock);
  if (options.save && requests.length > 0) saveManifest(manifest);
  reportInstalled(placed, removed.length);
};

const ciCommand = async (args) => {
  rejectFlags(args);
  const lock = readLock();
  if (Object.keys(lock.packages).length === 0) throw new NpmError('npm ci can only install packages with an existing package-lock.json');
  const manifest = readManifest();
  for (const fieldName of DEP_FIELDS) {
    for (const [pkg, range] of Object.entries(manifest[fieldName] ?? {})) {
      const entry = lock.packages[childKey('', pkg)];
      if (!entry || !satisfies(entry.version, range)) {
        throw new NpmError(`npm ci can only install packages when your package.json and package-lock.json are in sync: ${pkg}@${range} is not satisfied`);
      }
    }
  }
  rmTree(join(cwd, 'node_modules'));
  await materialise(lock);
  linkBins(lock);
  const count = sortedKeys(lock).length;
  console.log(`added ${count} package${count === 1 ? '' : 's'}`);
};

const uninstallCommand = async (args) => {
  rejectFlags(args);
  if (args.length === 0) throw new NpmError('usage: npm uninstall <pkg>...');
  const manifest = readManifest();
  for (const pkg of args) {
    for (const fieldName of DEP_FIELDS) {
      if (manifest[fieldName]) delete manifest[fieldName][pkg];
    }
  }
  const lock = readLock();
  syncRoot(lock, manifest);
  const removed = prune(lock);
  for (const key of removed) rmTree(keyDir(key));
  markFlags(lock);
  await materialise(lock);
  linkBins(lock);
  writeLock(lock);
  saveManifest(manifest);
  reportInstalled([], removed.length);
};

const lsLines = (packages, from, fields, prefix, trail) => {
  const children = [];
  for (const fieldName of fields) {
    for (const [pkg, range] of Object.entries(packages[from]?.[fieldName] ?? {})) {
      const key = findPlaced(packages, from, pkg, range) ?? findPlaced(packages, from, pkg, '');
      if (key !== null && !trail.includes(key)) children.push({ pkg, key });
    }
  }
  const unique = children.filter((child, index) => children.findIndex((other) => other.pkg === child.pkg) === index);
  const lines = [];
  unique.forEach((child, index) => {
    const last = index === unique.length - 1;
    lines.push(`${prefix}${last ? '└── ' : '├── '}${child.pkg}@${packages[child.key].version}`);
    lines.push(...lsLines(packages, child.key, ['dependencies', 'optionalDependencies'], `${prefix}${last ? '    ' : '│   '}`, [...trail, child.key]));
  });
  return lines;
};
const lsCommand = () => {
  const lock = readLock();
  const root = lock.packages[''] ?? syncRootOnly();
  console.log(`${root.name}@${root.version} ${cwd}`);
  for (const line of lsLines(lock.packages, '', DEP_FIELDS, '', [])) console.log(line);
};
const syncRootOnly = () => {
  const manifest = readManifest();
  return { name: manifest.name ?? basename(cwd), version: manifest.version ?? '1.0.0' };
};

const tokenize = (text) => [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);
const binFromLock = (command) => {
  const lock = readLock();
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '') continue;
    const target = entry.bin?.[command];
    if (target) return normalize(`${keyDir(key)}/${target}`);
  }
  return null;
};

const runBin = (file, args) => {
  process.argv = ['node', file, ...args];
  loadFile(file, new Map());
};

const runCommandLine = (line, extra) => {
  const segments = line.split('&&').map((segment) => segment.trim()).filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    const [command, ...args] = tokenize(segment);
    if (command === undefined) continue;
    const allArgs = index === segments.length - 1 ? [...args, ...extra] : args;
    if (command === 'node') {
      if (allArgs.length === 0 || allArgs[0].startsWith('-')) throw new NpmError(`unsupported node arguments in a script: ${allArgs.join(' ')}`);
      runBin(absolute(allArgs[0]), allArgs.slice(1));
      continue;
    }
    const bin = binFromLock(command);
    if (!bin) throw new NpmError(`unsupported command in a script: ${command}`);
    runBin(bin, allArgs);
  }
};

const runCommand = (args) => {
  const [script, ...rest] = args;
  const scripts = readManifest().scripts ?? {};
  if (script === undefined) throw new NpmError('usage: npm run <script> [args...]');
  if (scripts[script] === undefined) throw new NpmError(`Missing script: "${script}"`);
  for (const hook of [`pre${script}`, script, `post${script}`]) {
    if (scripts[hook] !== undefined) runCommandLine(scripts[hook], hook === script ? rest : []);
  }
};

const fileIn = (base) => [base, `${base}.js`, `${base}.json`, `${base}/index.js`].find(isFile) ?? null;
const resolvePackage = (dir) => {
  const main = readJson(`${dir}/package.json`)?.main;
  return (main ? fileIn(join(dir, main)) : null) ?? fileIn(join(dir, 'index'));
};
const resolveModule = (base) => fileIn(base) ?? (isDir(base) ? resolvePackage(base) : null);

const moduleNotFound = (request) => Object.assign(new Error(`Cannot find module '${request}'`), { code: 'MODULE_NOT_FOUND' });

const fsModule = {
  existsSync: (path) => isFile(absolute(path)) || isDir(absolute(path)),
  readFileSync(path, options) {
    const bytes = readBytes(absolute(path));
    if (bytes === undefined) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });
    const encoding = typeof options === 'string' ? options : options?.encoding;
    return encoding ? decoder.decode(bytes) : new Uint8Array(bytes);
  },
  writeFileSync: (path, data) => writeBytes(absolute(path), typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data)),
  readdirSync: (path) => __thebirdFs.readdir(absolute(path)),
};

const pathModule = {
  sep: '/',
  join,
  normalize,
  dirname,
  basename: (path, ext) => {
    const base = basename(path);
    return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
  },
  extname: (path) => {
    const base = basename(path);
    const at = base.lastIndexOf('.');
    return at <= 0 ? '' : base.slice(at);
  },
  resolve: (...parts) => normalize(parts.reduce((acc, part) => (part.startsWith('/') ? part : `${acc}/${part}`), cwd)),
};

const requireFrom = (dir, request, cache) => {
  if (request === 'fs' || request === 'node:fs') return fsModule;
  if (request === 'path' || request === 'node:path') return pathModule;
  if (request === 'process' || request === 'node:process') return globalThis.process;
  if (request.startsWith('.') || request.startsWith('/')) {
    const file = resolveModule(normalize(request.startsWith('/') ? request : `${dir}/${request}`));
    if (!file) throw moduleNotFound(request);
    return loadFile(file, cache);
  }
  for (let at = dir; ; at = dirname(at)) {
    const pkgDir = join(at, 'node_modules', request);
    const file = isDir(pkgDir) ? resolvePackage(pkgDir) : null;
    if (file) return loadFile(file, cache);
    if (at === '/') break;
  }
  throw moduleNotFound(request);
};

const loadFile = (file, cache) => {
  if (file.endsWith('.json')) return JSON.parse(readText(file));
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {}, filename: file, id: file };
  cache.set(file, module);
  const dir = dirname(file);
  const source = readText(file).replace(/^#!.*/, '');
  const wrapper = new Function('module', 'exports', 'require', '__filename', '__dirname', source);
  wrapper(module, module.exports, (request) => requireFrom(dir, request, cache), file, dir);
  return module.exports;
};

const packageDirs = (nodeModules) => {
  const names = [];
  for (const entry of __thebirdFs.readdir(nodeModules)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@') && isDir(`${nodeModules}/${entry}`)) {
      for (const sub of __thebirdFs.readdir(`${nodeModules}/${entry}`)) names.push(`${entry}/${sub}`);
    } else names.push(entry);
  }
  return names;
};
const findBin = (startDir, pkg, binName) => {
  for (let dir = startDir; ; dir = dirname(dir)) {
    const nodeModules = join(dir, 'node_modules');
    if (isDir(nodeModules)) {
      for (const entry of packageDirs(nodeModules)) {
        const pkgDir = `${nodeModules}/${entry}`;
        const meta = readJson(`${pkgDir}/package.json`);
        const target = typeof meta?.bin === 'string' ? (entry === pkg ? meta.bin : undefined) : meta?.bin?.[binName];
        if (target) return normalize(`${pkgDir}/${target}`);
      }
    }
    if (dir === '/') return null;
  }
};

const runNpm = async ([command, ...args]) => {
  if (command === '-v' || command === '--version') {
    console.log(NPM_VERSION);
    return;
  }
  if (['install', 'i', 'add'].includes(command)) return installCommand(args);
  if (['ci', 'clean-install'].includes(command)) return ciCommand(args);
  if (['uninstall', 'remove', 'rm', 'un'].includes(command)) return uninstallCommand(args);
  if (['ls', 'list'].includes(command)) return lsCommand();
  if (['run', 'run-script'].includes(command)) return runCommand(args);
  throw new NpmError(command === undefined ? 'usage: npm install | ci | uninstall | ls | run | -v' : `unsupported command: ${command}`);
};

const runNpx = async ([command, ...args]) => {
  if (command === undefined) throw new NpmError('usage: npx <package[@range]> [args...] | npx -v');
  if (command === '-v' || command === '--version') {
    console.log(NPM_VERSION);
    return;
  }
  const { name: pkg } = parseSpec(command);
  const binName = basename(pkg);
  let file = findBin(cwd, pkg, binName);
  if (!file) {
    const cache = join(NPX_CACHE, command.replace(/[^A-Za-z0-9._@-]/g, '_'));
    const { range } = parseSpec(command);
    const lock = { packages: {} };
    syncRoot(lock, { dependencies: { [pkg]: range || '*' } });
    await placeAll(lock, [{ from: '', pkg, range }]);
    markFlags(lock);
    await materialise(lock, cache);
    linkBins(lock, cache);
    file = findBin(cache, pkg, binName);
  }
  if (!file) throw new NpmError(`could not find an executable named '${binName}' in ${pkg}`);
  runBin(file, args);
};

let status = 0;
try {
  if (name === 'npx') await runNpx(argv);
  else await runNpm(argv);
} catch (err) {
  flushOutput();
  console.error(`${name}: ${err.message}`);
  status = 1;
}
flushOutput();
tjs.exit(status || process.exitCode);
