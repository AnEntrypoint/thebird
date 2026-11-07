import { Buffer } from './buffer.js';
import { posix } from './path.js';

const MOUNT = 'thebird-workspace';
const files = new Map();
const dirs = new Set(['/']);
const meta = new Map();
const dirty = new Map();
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

function mark(path, op) {
  dirty.set(path, op);
}

function markTree(path, op) {
  for (const file of files.keys()) if (file === path || file.startsWith(path + '/')) mark(file, op);
  for (const dir of dirs) if (dir === path || dir.startsWith(path + '/')) mark(dir, op);
}

function ensureParent(path, syscall) {
  const parent = posix.dirname(path);
  if (!dirs.has(parent)) throw fail('ENOENT', syscall, path, 'no such file or directory');
}

function bytesFrom(data, encoding) {
  if (typeof data === 'string') return Buffer.from(data, encoding);
  return Buffer.from(data);
}

function statOf(path) {
  if (files.has(path)) {
    const info = meta.get(path) ?? { mtimeMs: Date.now() };
    return {
      size: files.get(path).byteLength,
      mode: 0o100644,
      ino: 0,
      dev: 0,
      uid: 0,
      gid: 0,
      mtimeMs: info.mtimeMs,
      ctimeMs: info.mtimeMs,
      mtime: new Date(info.mtimeMs),
      ctime: new Date(info.mtimeMs),
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    };
  }
  if (dirs.has(path)) {
    return {
      size: 0,
      mode: 0o40755,
      ino: 0,
      dev: 0,
      uid: 0,
      gid: 0,
      mtimeMs: 0,
      ctimeMs: 0,
      mtime: new Date(0),
      ctime: new Date(0),
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    };
  }
  return null;
}

function childrenOf(path) {
  const prefix = path === '/' ? '/' : path + '/';
  const names = new Map();
  for (const file of files.keys()) if (file.startsWith(prefix)) names.set(file.slice(prefix.length).split('/')[0], 'file');
  for (const dir of dirs) if (dir !== path && dir.startsWith(prefix)) names.set(dir.slice(prefix.length).split('/')[0], 'dir');
  for (const [name, kind] of [...names]) {
    const full = prefix + name;
    if (files.has(full)) names.set(name, 'file');
    else if (dirs.has(full)) names.set(name, 'dir');
    else names.set(name, kind);
  }
  return [...names].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function existsSync(path) {
  const target = norm(path);
  return files.has(target) || dirs.has(target);
}

export function readFileSync(path, options) {
  const target = norm(path);
  const encoding = typeof options === 'string' ? options : options?.encoding;
  if (dirs.has(target)) throw fail('EISDIR', 'read', target, 'illegal operation on a directory');
  if (!files.has(target)) throw fail('ENOENT', 'open', target, 'no such file or directory');
  const bytes = Buffer.from(files.get(target));
  return encoding ? bytes.toString(encoding) : bytes;
}

export function writeFileSync(path, data, options) {
  const target = norm(path);
  const flag = typeof options === 'object' ? options?.flag ?? 'w' : 'w';
  const encoding = typeof options === 'string' ? options : options?.encoding;
  if (dirs.has(target)) throw fail('EISDIR', 'open', target, 'illegal operation on a directory');
  if (flag.includes('x') && files.has(target)) throw fail('EEXIST', 'open', target, 'file already exists');
  ensureParent(target, 'open');
  files.set(target, bytesFrom(data, encoding));
  meta.set(target, { mtimeMs: Date.now() });
  mark(target, 'write');
}

export function appendFileSync(path, data, options) {
  const target = norm(path);
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const previous = files.get(target) ?? Buffer.alloc(0);
  const next = Buffer.concat([previous, bytesFrom(data, encoding)]);
  ensureParent(target, 'open');
  files.set(target, next);
  meta.set(target, { mtimeMs: Date.now() });
  mark(target, 'write');
}

export function mkdirSync(path, options) {
  const target = norm(path);
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
  if (dirs.has(target) || files.has(target)) throw fail('EEXIST', 'mkdir', target, 'file already exists');
  ensureParent(target, 'mkdir');
  dirs.add(target);
  mark(target, 'write');
  return undefined;
}

export function readdirSync(path, options) {
  const target = norm(path);
  if (files.has(target)) throw fail('ENOTDIR', 'scandir', target, 'not a directory');
  if (!dirs.has(target)) throw fail('ENOENT', 'scandir', target, 'no such file or directory');
  const entries = childrenOf(target);
  if (options?.withFileTypes) {
    return entries.map(([name, kind]) => ({ name, isFile: () => kind === 'file', isDirectory: () => kind === 'dir', isSymbolicLink: () => false }));
  }
  return entries.map(([name]) => name);
}

export function statSync(path, options) {
  const info = statOf(norm(path));
  if (!info) {
    if (options?.throwIfNoEntry === false) return undefined;
    throw fail('ENOENT', 'stat', norm(path), 'no such file or directory');
  }
  return info;
}

export function lstatSync(path, options) {
  return statSync(path, options);
}

export function realpathSync(path) {
  const target = norm(path);
  if (!existsSync(target)) throw fail('ENOENT', 'realpath', target, 'no such file or directory');
  return target;
}

export function rmSync(path, options) {
  const target = norm(path);
  if (!existsSync(target)) {
    if (options?.force) return;
    throw fail('ENOENT', 'rm', target, 'no such file or directory');
  }
  if (files.has(target)) {
    files.delete(target);
    meta.delete(target);
    mark(target, 'delete');
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
}

export function unlinkSync(path) {
  const target = norm(path);
  if (!files.has(target)) throw fail('ENOENT', 'unlink', target, 'no such file or directory');
  files.delete(target);
  meta.delete(target);
  mark(target, 'delete');
}

export function renameSync(from, to) {
  const source = norm(from);
  const target = norm(to);
  if (!existsSync(source)) throw fail('ENOENT', 'rename', source, 'no such file or directory');
  ensureParent(target, 'rename');
  if (files.has(source)) {
    files.set(target, files.get(source));
    meta.set(target, { mtimeMs: Date.now() });
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
    meta.set(next, { mtimeMs: Date.now() });
    files.delete(file);
    meta.delete(file);
  }
  for (const dir of [...dirs]) if (dir === source || dir.startsWith(prefix)) {
    dirs.delete(dir);
    dirs.add(target + dir.slice(source.length));
  }
  dirs.add(target);
  markTree(source, 'delete');
  for (const file of files.keys()) if (file === target || file.startsWith(target + '/')) mark(file, 'write');
  for (const dir of dirs) if (dir === target || dir.startsWith(target + '/')) mark(dir, 'write');
}

export function openSync(path, flags = 'r') {
  const target = norm(path);
  if (flags.startsWith('r') && !files.has(target)) throw fail('ENOENT', 'open', target, 'no such file or directory');
  if (!files.has(target)) {
    ensureParent(target, 'open');
    files.set(target, Buffer.alloc(0));
    meta.set(target, { mtimeMs: Date.now() });
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
  meta.set(handle.path, { mtimeMs: Date.now() });
  mark(handle.path, 'write');
  if (!handle.append) handle.position = at + bytes.byteLength;
  return bytes.byteLength;
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

export async function hydrate() {
  const opfs = await globalThis.navigator.storage.getDirectory();
  root = await opfs.getDirectoryHandle(MOUNT, { create: true });
  files.clear();
  dirs.clear();
  dirs.add('/');
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
      }
    }
  }
  await walk(root, '');
}

export async function flushFs() {
  const pending = [...dirty];
  dirty.clear();
  for (const [path, op] of pending) await writeOne(path, op);
}
