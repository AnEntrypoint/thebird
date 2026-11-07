import * as fs from './fs.js';

function fail(code, path, cause) {
  return Object.assign(new Error(`${code}: ${cause}, '${path}'`), { code, path });
}

export function createHost() {
  return {
    read(path) {
      try {
        return fs.readFileSync(path);
      } catch (err) {
        throw fail(err.code ?? 'EIO', path, err.message);
      }
    },
    write(path, bytes) {
      fs.writeFileSync(path, bytes);
    },
    mkdir(path, recursive) {
      fs.mkdirSync(path, { recursive: Boolean(recursive) });
    },
    remove(path, recursive) {
      fs.rmSync(path, { recursive: Boolean(recursive) });
    },
    stat(path) {
      const info = fs.statSync(path);
      return { type: info.isDirectory() ? 'dir' : 'file', size: info.size, mtimeMs: info.mtimeMs };
    },
    readDir(path) {
      return fs.readdirSync(path, { withFileTypes: true }).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'dir' : 'file' }));
    },
    exists(path) {
      return fs.existsSync(path);
    },
  };
}
