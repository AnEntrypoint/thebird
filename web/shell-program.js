const encoder = new TextEncoder();
const decoder = new TextDecoder();
const enoent = (path) => Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' });

const host = {
  read(path) {
    const bytes = __thebirdFs.readFile(path);
    if (bytes === undefined) throw enoent(path);
    return decoder.decode(bytes);
  },
  write(path, text) {
    const bytes = encoder.encode(text);
    if (!__thebirdFs.writeFile(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))) {
      throw Object.assign(new Error(`EIO: i/o error, '${path}'`), { code: 'EIO' });
    }
  },
  exists: (path) => __thebirdFs.stat(path) != null,
  stat(path) {
    const info = __thebirdFs.stat(path);
    return info == null ? null : { dir: info.kind === 2, size: info.size };
  },
  list: (path) => __thebirdFs.readdir(path) ?? [],
  lstat(path) {
    const info = __thebirdFs.lstat(path);
    return info == null ? null : { dir: info.kind === 2, link: info.kind === 3, size: info.size };
  },
  readlink(path) {
    const target = __thebirdFs.readlink(path);
    if (target === undefined) throw Object.assign(new Error(`EINVAL: invalid argument, readlink '${path}'`), { code: 'EINVAL' });
    return target;
  },
  symlink(target, path) {
    if (!__thebirdFs.symlink(target, path)) throw Object.assign(new Error(`EEXIST: file already exists, '${path}'`), { code: 'EEXIST' });
  },
  mkdir(path) {
    if (!__thebirdFs.mkdir(path)) throw Object.assign(new Error(`EEXIST: file already exists, '${path}'`), { code: 'EEXIST' });
  },
  remove(path, recursive) {
    const info = __thebirdFs.lstat(path);
    if (info == null) return;
    if (info.kind !== 2) {
      __thebirdFs.unlink(path);
      return;
    }
    if (recursive) {
      for (const name of __thebirdFs.readdir(path) ?? []) host.remove(`${path === '/' ? '' : path}/${name}`, true);
    }
    __thebirdFs.rmdir(path);
  },
};

const shell = createShell({ host, cwd: args.cwd, builtins: args.builtins, saved: args.saved });
const result = await shell.run(args.script, { timeoutMs: args.timeoutMs });
console.log('\u0001' + JSON.stringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, saved: shell.snapshot() }));
