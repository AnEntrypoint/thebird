import { Buffer } from './buffer.js';
import { posix } from './path.js';

const MOUNT = 'thebird-workspace';
const LINKS_FILE = '/.thebird/links.json';
const ATTR_FILE = '/.thebird/attrs.json';
const MAX_LINKS = 40;
const files = new Map();
const dirs = new Set(['/']);
const links = new Map();
const attrs = new Map();
const meta = new Map();
const dirty = new Map();
const revisions = new Map();
let revision = 0;
const fds = new Map();
let nextFd = 3;
let root = null;

function fail(code, syscall, path, message) {
  const err = new Error(`${code}: ${message}, ${syscall} '${path}'`);
  err.code = code;
  err.syscall = syscall;
  err.path = path;
  return err;
}

function norm(path) {
  return posix.resolve('/', String(path));
}

function resolvePath(path, followLast = true, depth = 0) {
  const parts = norm(path).split('/').filter(Boolean);
  let current = '/';
  for (let i = 0; i < parts.length; i++) {
    const next = posix.join(current, parts[i]);
    const target = links.get(next);
    if (target !== undefined && (followLast || i < parts.length - 1)) {
      if (depth >= MAX_LINKS) throw fail('ELOOP', 'open', norm(path), 'too many levels of symbolic links');
      return resolvePath(posix.join(posix.resolve(current, target), ...parts.slice(i + 1)), followLast, depth + 1);
    }
    current = next;
  }
  return current;
}

function mark(path, op) {
  dirty.set(path, op);
  revisions.set(path, ++revision);
}

export function revisionOf(path) {
  return revisions.get(norm(path)) ?? 0;
}

export function currentRevision() {
  return revision;
}

export function changedSince(since) {
  const changed = [];
  for (const [path, rev] of revisions) if (rev > since) changed.push(path);
  return changed;
}

export function listFiles() {
  return [...files.keys()];
}

function markTree(path, op) {
  for (const file of files.keys()) if (file === path || file.startsWith(path + '/')) mark(file, op);
  for (const dir of dirs) if (dir === path || dir.startsWith(path + '/')) mark(dir, op);
}

function ensureParent(path, syscall) {
  const parent = resolvePath(posix.dirname(path));
  if (!dirs.has(parent)) throw fail('ENOENT', syscall, path, 'no such file or directory');
}

function saveLinks() {
  if (!dirs.has('/.thebird')) {
    dirs.add('/.thebird');
    mark('/.thebird', 'write');
  }
  files.set(LINKS_FILE, Buffer.from(JSON.stringify([...links])));
  touch(LINKS_FILE);
  mark(LINKS_FILE, 'write');
}

function removeLinks(path) {
  const prefix = path + '/';
  let removed = false;
  for (const link of [...links.keys()]) {
    if (link === path || link.startsWith(prefix)) {
      links.delete(link);
      meta.delete(link);
      removed = true;
    }
  }
  if (removed) saveLinks();
}

function saveAttrs() {
  if (!dirs.has('/.thebird')) {
    dirs.add('/.thebird');
    mark('/.thebird', 'write');
  }
  files.set(ATTR_FILE, Buffer.from(JSON.stringify([...attrs])));
  touch(ATTR_FILE);
  mark(ATTR_FILE, 'write');
}

function touch(path) {
  touch(path);
  const attr = attrs.get(path);
  if (attr?.mtimeMs !== undefined) {
    delete attr.mtimeMs;
    saveAttrs();
  }
}

function forgetAttrs(path) {
  const prefix = path + '/';
  let removed = false;
  for (const key of [...attrs.keys()]) {
    if (key === path || key.startsWith(prefix)) {
      attrs.delete(key);
      removed = true;
    }
  }
  if (removed) saveAttrs();
}

function replaceAttrs(source, target) {
  if (source === target) return;
  forgetAttrs(target);
  const prefix = source + '/';
  let moved = false;
  for (const key of [...attrs.keys()]) {
    if (key === source || key.startsWith(prefix)) {
      attrs.set(target + key.slice(source.length), attrs.get(key));
      attrs.delete(key);
      moved = true;
    }
  }
  if (moved) saveAttrs();
}

function bytesFrom(data, encoding) {
  if (typeof data === 'string') return Buffer.from(data, encoding);
  return Buffer.from(data);
}

function statOf(path) {
  if (files.has(path)) {
    const info = meta.get(path) ?? { mtimeMs: Date.now() };
    const attr = attrs.get(path) ?? {};
    return {
      size: files.get(path).byteLength,
      mode: 0o100000 | (attr.mode ?? 0o644),
      ino: 0,
      dev: 0,
      uid: attr.uid ?? 0,
      gid: attr.gid ?? 0,
      mtimeMs: info.mtimeMs,
      ctimeMs: info.mtimeMs,
      atimeMs: attr.atimeMs ?? info.mtimeMs,
      mtime: new Date(info.mtimeMs),
      ctime: new Date(info.mtimeMs),
      atime: new Date(attr.atimeMs ?? info.mtimeMs),
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    };
  }
  if (dirs.has(path)) {
    const attr = attrs.get(path) ?? {};
    const mtimeMs = attr.mtimeMs ?? 0;
    return {
      size: 0,
      mode: 0o40000 | (attr.mode ?? 0o755),
      ino: 0,
      dev: 0,
      uid: attr.uid ?? 0,
      gid: attr.gid ?? 0,
      mtimeMs,
      ctimeMs: mtimeMs,
      atimeMs: attr.atimeMs ?? mtimeMs,
      mtime: new Date(mtimeMs),
      ctime: new Date(mtimeMs),
      atime: new Date(attr.atimeMs ?? mtimeMs),
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    };
  }
  return null;
}

function linkStat(path) {
  const info = meta.get(path) ?? { mtimeMs: 0 };
  const attr = attrs.get(path) ?? {};
  return {
    size: links.get(path).length,
    mode: 0o120000 | (attr.mode ?? 0o777),
    ino: 0,
    dev: 0,
    uid: attr.uid ?? 0,
    gid: attr.gid ?? 0,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.mtimeMs,
    atimeMs: attr.atimeMs ?? info.mtimeMs,
    mtime: new Date(info.mtimeMs),
    ctime: new Date(info.mtimeMs),
    atime: new Date(attr.atimeMs ?? info.mtimeMs),
    isFile: () => false,
    isDirectory: () => false,
    isSymbolicLink: () => true,
  };
}

function childrenOf(path) {
  const prefix = path === '/' ? '/' : path + '/';
  const names = new Map();
  for (const file of files.keys()) if (file.startsWith(prefix)) names.set(file.slice(prefix.length).split('/')[0], 'file');
  for (const dir of dirs) if (dir !== path && dir.startsWith(prefix)) names.set(dir.slice(prefix.length).split('/')[0], 'dir');
  for (const link of links.keys()) if (link.startsWith(prefix)) {
    const rest = link.slice(prefix.length);
    if (rest && !rest.includes('/')) names.set(rest, 'link');
  }
  for (const [name, kind] of [...names]) {
    const full = prefix + name;
    if (links.has(full)) names.set(name, 'link');
    else if (files.has(full)) names.set(name, 'file');
    else if (dirs.has(full)) names.set(name, 'dir');
    else names.set(name, kind);
  }
  return [...names].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function existsSync(path) {
  const target = resolvePath(path);
  return files.has(target) || dirs.has(target);
}

export function readFileSync(path, options) {
  const target = resolvePath(path);
  const encoding = typeof options === 'string' ? options : options?.encoding;
  if (dirs.has(target)) throw fail('EISDIR', 'read', target, 'illegal operation on a directory');
  if (!files.has(target)) throw fail('ENOENT', 'open', target, 'no such file or directory');
  const bytes = Buffer.from(files.get(target));
  return encoding ? bytes.toString(encoding) : bytes;
}

export function writeFileSync(path, data, options) {
  const target = resolvePath(path);
  const flag = typeof options === 'object' ? options?.flag ?? 'w' : 'w';
  const encoding = typeof options === 'string' ? options : options?.encoding;
  if (dirs.has(target)) throw fail('EISDIR', 'open', target, 'illegal operation on a directory');
  if (flag.includes('x') && files.has(target)) throw fail('EEXIST', 'open', target, 'file already exists');
  ensureParent(target, 'open');
  files.set(target, bytesFrom(data, encoding));
  touch(target);
  mark(target, 'write');
}

export function appendFileSync(path, data, options) {
  const target = resolvePath(path);
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const previous = files.get(target) ?? Buffer.alloc(0);
  const next = Buffer.concat([previous, bytesFrom(data, encoding)]);
  ensureParent(target, 'open');
  files.set(target, next);
  touch(target);
  mark(target, 'write');
}

export function mkdirSync(path, options) {
  const target = options?.recursive ? resolvePath(path) : resolvePath(path, false);
  if (options?.recursive) {
    let first;
    const parts = target.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += '/' + part;
      if (files.has(current)) throw fail('ENOTDIR', 'mkdir', target, 'not a directory');
      if (!dirs.has(current)) {
        dirs.add(current);
        mark(current, 'write');
        first ??= current;
      }
    }
    return first;
  }
  if (dirs.has(target) || files.has(target) || links.has(target)) throw fail('EEXIST', 'mkdir', target, 'file already exists');
  ensureParent(target, 'mkdir');
  dirs.add(target);
  mark(target, 'write');
  return undefined;
}

export function readdirSync(path, options) {
  const target = resolvePath(path);
  if (files.has(target)) throw fail('ENOTDIR', 'scandir', target, 'not a directory');
  if (!dirs.has(target)) throw fail('ENOENT', 'scandir', target, 'no such file or directory');
  const entries = childrenOf(target);
  if (options?.withFileTypes) {
    return entries.map(([name, kind]) => ({ name, isFile: () => kind === 'file', isDirectory: () => kind === 'dir', isSymbolicLink: () => kind === 'link' }));
  }
  return entries.map(([name]) => name);
}

export function statSync(path, options) {
  const info = statOf(resolvePath(path));
  if (!info) {
    if (options?.throwIfNoEntry === false) return undefined;
    throw fail('ENOENT', 'stat', norm(path), 'no such file or directory');
  }
  return info;
}

export function lstatSync(path, options) {
  const target = resolvePath(path, false);
  if (links.has(target)) return linkStat(target);
  return statSync(target, options);
}

export function setAttrSync(path, follow, attr, value) {
  const target = resolvePath(path, follow);
  if (!files.has(target) && !dirs.has(target) && !links.has(target)) return -1;
  if (!['mode', 'uid', 'gid', 'atime', 'mtime'].includes(attr)) return -1;
  const next = { ...(attrs.get(target) ?? {}) };
  if (attr === 'mode') next.mode = value & 0o7777;
  if (attr === 'uid') next.uid = value;
  if (attr === 'gid') next.gid = value;
  if (attr === 'atime') next.atimeMs = value;
  if (attr === 'mtime') {
    next.mtimeMs = value;
    if (!dirs.has(target)) meta.set(target, { mtimeMs: value });
  }
  attrs.set(target, next);
  saveAttrs();
  return 0;
}

export function readlinkSync(path) {
  const target = resolvePath(path, false);
  if (links.has(target)) return links.get(target);
  if (!existsSync(target)) throw fail('ENOENT', 'readlink', target, 'no such file or directory');
  throw fail('EINVAL', 'readlink', target, 'invalid argument');
}

export function symlinkSync(target, path) {
  const link = resolvePath(path, false);
  if (files.has(link) || dirs.has(link) || links.has(link)) throw fail('EEXIST', 'symlink', link, 'file already exists');
  ensureParent(link, 'symlink');
  links.set(link, String(target));
  touch(link);
  saveLinks();
}

export function realpathSync(path) {
  const target = resolvePath(path);
  if (!existsSync(target)) throw fail('ENOENT', 'realpath', target, 'no such file or directory');
  return target;
}

export function rmSync(path, options) {
  const node = resolvePath(path, false);
  if (links.has(node)) {
    links.delete(node);
    meta.delete(node);
    saveLinks();
    return;
  }
  const target = node;
  if (!existsSync(target)) {
    if (options?.force) return;
    throw fail('ENOENT', 'rm', target, 'no such file or directory');
  }
  if (files.has(target)) {
    files.delete(target);
    meta.delete(target);
    mark(target, 'delete');
    forgetAttrs(target);
    return;
  }
  const hasChildren = childrenOf(target).length > 0;
  if (hasChildren && !options?.recursive) throw fail('ENOTEMPTY', 'rm', target, 'directory not empty');
  markTree(target, 'delete');
  const prefix = target + '/';
  for (const file of [...files.keys()]) if (file.startsWith(prefix)) {
    files.delete(file);
    meta.delete(file);
  }
  for (const dir of [...dirs]) if (dir === target || dir.startsWith(prefix)) dirs.delete(dir);
  forgetAttrs(target);
  removeLinks(target);
}

export function unlinkSync(path) {
  const target = resolvePath(path, false);
  if (links.has(target)) {
    links.delete(target);
    meta.delete(target);
    forgetAttrs(target);
    saveLinks();
    return;
  }
  if (!files.has(target)) throw fail('ENOENT', 'unlink', target, 'no such file or directory');
  files.delete(target);
  meta.delete(target);
  forgetAttrs(target);
  mark(target, 'delete');
}

export function renameSync(from, to) {
  const source = resolvePath(from, false);
  const target = resolvePath(to, false);
  if (links.has(source)) {
    ensureParent(target, 'rename');
  replaceAttrs(source, target);
    const value = links.get(source);
    links.delete(source);
    meta.delete(source);
    links.set(target, value);
    touch(target);
    saveLinks();
    return;
  }
  if (!existsSync(source)) throw fail('ENOENT', 'rename', source, 'no such file or directory');
  ensureParent(target, 'rename');
  replaceAttrs(source, target);
  links.delete(target);
  if (files.has(source)) {
    files.set(target, files.get(source));
    touch(target);
    files.delete(source);
    meta.delete(source);
    mark(source, 'delete');
    mark(target, 'write');
    return;
  }
  const prefix = source + '/';
  const moved = [...files.keys()].filter((file) => file.startsWith(prefix));
  for (const file of moved) {
    const next = target + file.slice(source.length);
    files.set(next, files.get(file));
    touch(next);
    files.delete(file);
    meta.delete(file);
  }
  for (const dir of [...dirs]) if (dir === source || dir.startsWith(prefix)) {
    dirs.delete(dir);
    dirs.add(target + dir.slice(source.length));
  }
  let relinked = false;
  for (const link of [...links.keys()]) if (link.startsWith(prefix)) {
    const value = links.get(link);
    links.delete(link);
    links.set(target + link.slice(source.length), value);
    relinked = true;
  }
  if (relinked) saveLinks();
  dirs.add(target);
  markTree(source, 'delete');
  for (const file of files.keys()) if (file === target || file.startsWith(target + '/')) mark(file, 'write');
  for (const dir of dirs) if (dir === target || dir.startsWith(target + '/')) mark(dir, 'write');
}

export function openSync(path, flags = 'r') {
  const target = resolvePath(path);
  if (flags.startsWith('r') && !files.has(target)) throw fail('ENOENT', 'open', target, 'no such file or directory');
  if (!files.has(target)) {
    ensureParent(target, 'open');
    files.set(target, Buffer.alloc(0));
    touch(target);
    mark(target, 'write');
  }
  if (flags.startsWith('w')) {
    files.set(target, Buffer.alloc(0));
    mark(target, 'write');
  }
  const fd = nextFd++;
  fds.set(fd, { path: target, append: flags.startsWith('a'), position: 0 });
  return fd;
}

export function readSync(fd, buffer, offset = 0, length = buffer.byteLength - offset, position = null) {
  const handle = fds.get(fd);
  if (!handle) throw fail('EBADF', 'read', String(fd), 'bad file descriptor');
  const source = files.get(handle.path) ?? Buffer.alloc(0);
  const start = position ?? handle.position;
  const count = Math.max(0, Math.min(length, source.byteLength - start));
  buffer.set(source.subarray(start, start + count), offset);
  if (position === null) handle.position += count;
  return count;
}

export function writeSync(fd, data, ...rest) {
  const handle = fds.get(fd);
  if (!handle) throw fail('EBADF', 'write', String(fd), 'bad file descriptor');
  const bytes = bytesFrom(data, typeof rest[0] === 'string' ? rest[0] : undefined);
  const previous = files.get(handle.path) ?? Buffer.alloc(0);
  const at = handle.append ? previous.byteLength : handle.position;
  const next = Buffer.alloc(Math.max(previous.byteLength, at + bytes.byteLength));
  next.set(previous);
  next.set(bytes, at);
  files.set(handle.path, next);
  touch(handle.path);
  mark(handle.path, 'write');
  if (!handle.append) handle.position = at + bytes.byteLength;
  return bytes.byteLength;
}

export function writeAtSync(fd, data, position) {
  const handle = fds.get(fd);
  if (!handle) throw fail('EBADF', 'write', String(fd), 'bad file descriptor');
  const bytes = bytesFrom(data);
  const previous = files.get(handle.path) ?? Buffer.alloc(0);
  const end = position + bytes.byteLength;
  const next = end > previous.byteLength ? Buffer.alloc(end) : previous;
  if (next !== previous) next.set(previous);
  next.set(bytes, position);
  files.set(handle.path, next);
  touch(handle.path);
  mark(handle.path, 'write');
  return bytes.byteLength;
}

export function truncateSync(fd, size) {
  const handle = fds.get(fd);
  if (!handle) throw fail('EBADF', 'ftruncate', String(fd), 'bad file descriptor');
  const previous = files.get(handle.path) ?? Buffer.alloc(0);
  const next = Buffer.alloc(size);
  next.set(previous.subarray(0, size));
  files.set(handle.path, next);
  touch(handle.path);
  mark(handle.path, 'write');
}

export function rmdirSync(path) {
  rmSync(path);
}

export function closeSync(fd) {
  fds.delete(fd);
}

export function mkdtempSync(prefix) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const target = norm(prefix + suffix);
  mkdirSync(target, { recursive: true });
  return target;
}

export function watch() {
  return { close() {}, on() { return this; }, once() { return this; } };
}

export function fileIsDirty(path) {
  return dirty.has(norm(path));
}

async function writeOne(path, op) {
  const parts = path.split('/').filter(Boolean);
  if (op === 'delete') {
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part).catch(() => null);
    if (dir) await dir.removeEntry(parts.at(-1), { recursive: true }).catch(() => {});
    return;
  }
  if (dirs.has(path)) {
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    return;
  }
  if (!files.has(path)) return;
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
  const handle = await dir.getFileHandle(parts.at(-1), { create: true });
  const writable = await handle.createWritable();
  await writable.write(files.get(path));
  await writable.close();
}

let hydration = null;

export function hydrate() {
  hydration ??= loadTree();
  return hydration;
}

async function loadTree() {
  const opfs = await globalThis.navigator.storage.getDirectory();
  root = await opfs.getDirectoryHandle(MOUNT, { create: true });
  files.clear();
  dirs.clear();
  dirs.add('/');
  links.clear();
  attrs.clear();
  meta.clear();
  dirty.clear();
  async function walk(handle, prefix) {
    for await (const [name, entry] of handle.entries()) {
      const full = prefix + '/' + name;
      if (entry.kind === 'directory') {
        dirs.add(full);
        await walk(entry, full);
      } else {
        const file = await entry.getFile();
        files.set(full, Buffer.from(await file.arrayBuffer()));
        meta.set(full, { mtimeMs: file.lastModified });
        revisions.set(full, ++revision);
      }
    }
  }
  await walk(root, '');
  const storedAttrs = files.get(ATTR_FILE);
  if (storedAttrs) {
    for (const [path, value] of JSON.parse(Buffer.from(storedAttrs).toString('utf8'))) {
      attrs.set(path, value);
      if (value.mtimeMs !== undefined && meta.has(path)) meta.set(path, { mtimeMs: value.mtimeMs });
    }
  }
  const stored = files.get(LINKS_FILE);
  if (stored) {
    for (const [link, target] of JSON.parse(Buffer.from(stored).toString('utf8'))) {
      links.set(link, target);
      meta.set(link, meta.get(LINKS_FILE) ?? { mtimeMs: 0 });
    }
  }
}

export async function flushFs() {
  const pending = [...dirty];
  dirty.clear();
  for (const [path, op] of pending) await writeOne(path, op);
}
