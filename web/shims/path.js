export const sep = '/';
export const delimiter = ':';

export function normalize(path) {
  if (path === '') return '.';
  const absolute = path.startsWith('/');
  const trailing = path.endsWith('/');
  const out = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length && out.at(-1) !== '..') out.pop();
      else if (!absolute) out.push('..');
    } else {
      out.push(part);
    }
  }
  let body = out.join('/');
  if (!absolute && body === '') body = '.';
  if (trailing && body !== '' && body !== '.') body += '/';
  return (absolute ? '/' : '') + body;
}

export function isAbsolute(path) {
  return path.startsWith('/');
}

export function resolve(...parts) {
  let resolved = '';
  for (let i = parts.length - 1; i >= -1 && !isAbsolute(resolved); i--) {
    const part = i >= 0 ? String(parts[i]) : '/';
    if (part === '') continue;
    resolved = resolved === '' ? part : part + '/' + resolved;
  }
  const normalized = normalize(resolved);
  if (normalized.length > 1 && normalized.endsWith('/')) return normalized.slice(0, -1);
  return normalized;
}

export function join(...parts) {
  const joined = parts.filter((part) => part !== '').join('/');
  return joined === '' ? '.' : normalize(joined);
}

export function dirname(path) {
  if (path === '') return '.';
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const index = trimmed.lastIndexOf('/');
  if (index === -1) return '.';
  if (index === 0) return '/';
  return trimmed.slice(0, index);
}

export function basename(path, ext) {
  const trimmed = path.replace(/\/+$/, '');
  let base = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  if (ext && base.endsWith(ext) && base !== ext) base = base.slice(0, -ext.length);
  return base;
}

export function extname(path) {
  const base = basename(path);
  const index = base.lastIndexOf('.');
  if (index <= 0) return '';
  return base.slice(index);
}

export function relative(from, to) {
  const a = resolve(from).split('/').filter(Boolean);
  const b = resolve(to).split('/').filter(Boolean);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  return [...Array(a.length - common).fill('..'), ...b.slice(common)].join('/');
}

export function parse(path) {
  const dir = dirname(path);
  const base = basename(path);
  const ext = extname(path);
  return { root: isAbsolute(path) ? '/' : '', dir: dir === '.' && !path.includes('/') ? '' : dir, base, ext, name: ext ? base.slice(0, -ext.length) : base };
}

export function format({ dir, root, base, name, ext } = {}) {
  const file = base ?? (name ?? '') + (ext ?? '');
  const location = dir ?? root ?? '';
  if (!location) return file;
  return location === root ? location + file : location + '/' + file;
}

export const posix = { sep, delimiter, normalize, isAbsolute, resolve, join, dirname, basename, extname, relative, parse, format };
posix.posix = posix;

export default posix;
