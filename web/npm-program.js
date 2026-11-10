const NPM_VERSION = '0.1.0';
const REGISTRY = 'https://registry.npmjs.org';
const NPX_CACHE = '/.thebird/npx';
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

class ProcessExit extends Error {}

globalThis.process = {
  argv: [name],
  env: {},
  platform: 'linux',
  version: `v${tjs.version}`,
  versions: { txiki: tjs.version },
  cwd: () => cwd,
  exitCode: 0,
  exit(code = 0) {
    this.exitCode = code;
    throw new ProcessExit();
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
const join = (...parts) => normalize(parts.join('/'));
const absolute = (path) => normalize(path.startsWith('/') ? path : `${cwd}/${path}`);

const isDir = (path) => {
  try {
    return Array.isArray(__thebirdFs.readdir(path));
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

const packuments = new Map();
const fetchPackument = async (pkg) => {
  const url = `${REGISTRY}/${pkg.replace('/', '%2f')}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (response.status === 404) throw new NpmError(`404 Not Found - ${pkg}`);
  if (!response.ok) throw new NpmError(`registry answered ${response.status} for ${pkg}`);
  return JSON.parse(await response.text());
};
const packument = (pkg) => {
  if (!packuments.has(pkg)) packuments.set(pkg, fetchPackument(pkg));
  return packuments.get(pkg);
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

const fetchInto = async (meta, dest) => {
  const response = await fetch(meta.dist.tarball);
  if (!response.ok) throw new NpmError(`registry answered ${response.status} for ${meta.name}@${meta.version}`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  if (integrityOf(compressed) !== meta.dist.integrity) throw new NpmError(`integrity check failed for ${meta.name}@${meta.version}`);
  extractTar(gunzipSync(compressed), dest);
};

const installed = [];
const packageAt = (dir) => readJson(`${dir}/package.json`);
const satisfies = (version, range) => !range || (semver.validRange(range) !== null && semver.satisfies(version, range));

const resolveDependency = async (root, from, pkg, range) => {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', pkg);
    const existing = packageAt(candidate);
    if (existing && satisfies(existing.version, range)) return candidate;
    if (dir === '/') break;
  }
  const meta = await versionOf(pkg, range);
  const topLevel = join(root, 'node_modules', pkg);
  const dest = packageAt(topLevel) ? join(from, 'node_modules', pkg) : topLevel;
  await fetchInto(meta, dest);
  installed.push({ name: pkg, version: meta.version });
  for (const [dependency, dependencyRange] of Object.entries(meta.dependencies ?? {})) {
    await resolveDependency(root, dest, dependency, dependencyRange);
  }
  return dest;
};

const addSpec = async (root, spec) => {
  const { name: pkg, range } = parseSpec(spec);
  const dir = await resolveDependency(root, root, pkg, range);
  return packageAt(dir).version;
};

const saveDependency = (root, pkg, version) => {
  const path = join(root, 'package.json');
  const manifest = readJson(path) ?? {};
  manifest.dependencies = { ...manifest.dependencies, [pkg]: `^${version}` };
  writeText(path, `${JSON.stringify(manifest, null, 2)}\n`);
};

const installSpecs = async (root, specs, save) => {
  const before = installed.length;
  for (const spec of specs) {
    const version = await addSpec(root, spec);
    if (save) saveDependency(root, parseSpec(spec).name, version);
  }
  return installed.slice(before);
};

const reportInstalled = (added) => {
  if (added.length === 0) {
    console.log('up to date');
    return;
  }
  for (const { name: pkg, version } of added) console.log(`+ ${pkg}@${version}`);
  console.log(`added ${added.length} package${added.length === 1 ? '' : 's'}`);
};

const rejectFlags = (args) => {
  const flag = args.find((arg) => arg.startsWith('-'));
  if (flag) throw new NpmError(`unsupported option: ${flag}`);
};

const installCommand = async (args) => {
  rejectFlags(args);
  if (args.length > 0) {
    reportInstalled(await installSpecs(cwd, args, true));
    return;
  }
  const manifest = readJson(join(cwd, 'package.json')) ?? {};
  const specs = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).map(([pkg, range]) => `${pkg}@${range}`);
  reportInstalled(await installSpecs(cwd, specs, false));
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
        const meta = packageAt(pkgDir);
        const target = typeof meta?.bin === 'string' ? (entry === pkg ? meta.bin : undefined) : meta?.bin?.[binName];
        if (target) return normalize(`${pkgDir}/${target}`);
      }
    }
    if (dir === '/') return null;
  }
};

const moduleNotFound = (request) => Object.assign(new Error(`Cannot find module '${request}'`), { code: 'MODULE_NOT_FOUND' });

const fileIn = (base) => [base, `${base}.js`, `${base}.json`, `${base}/index.js`].find(isFile) ?? null;
const resolvePackage = (dir) => {
  const main = packageAt(dir)?.main;
  return (main ? fileIn(join(dir, main)) : null) ?? fileIn(join(dir, 'index'));
};
const resolveModule = (base) => fileIn(base) ?? (isDir(base) ? resolvePackage(base) : null);

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

const requireFrom = (dir, request, cache) => {
  if (request === 'fs' || request === 'node:fs') return fsModule;
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

const runBin = (file, args) => {
  process.argv = ['node', file, ...args];
  loadFile(file, new Map());
};

const runNpm = async ([command, ...args]) => {
  if (command === '-v' || command === '--version') {
    console.log(NPM_VERSION);
    return;
  }
  if (command === 'install' || command === 'i' || command === 'add') {
    await installCommand(args);
    return;
  }
  throw new NpmError(command === undefined ? 'usage: npm install [<pkg>[@<range>]...] | npm -v' : `unsupported command: ${command}`);
};

const runNpx = async ([command, ...args]) => {
  if (command === undefined) throw new NpmError('usage: npx <package[@range]> [args...] | npx -v');
  if (command === '-v' || command === '--version') {
    console.log(NPM_VERSION);
    return;
  }
  const { name: pkg } = parseSpec(command);
  const binName = pkg.split('/').pop();
  let file = findBin(cwd, pkg, binName);
  if (!file) {
    const cache = join(NPX_CACHE, command.replace(/[^A-Za-z0-9._@-]/g, '_'));
    await installSpecs(cache, [command], false);
    file = findBin(cache, pkg, binName);
  }
  if (!file) throw new NpmError(`could not find an executable named '${binName}' in ${pkg}`);
  runBin(file, args);
};

try {
  if (name === 'npx') await runNpx(argv);
  else await runNpm(argv);
} catch (err) {
  if (!(err instanceof ProcessExit)) throw new NpmError(err.message);
}
if (process.exitCode !== 0) throw new NpmError(`exited with status ${process.exitCode}`);
