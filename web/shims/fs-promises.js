import * as sync from './fs.js';

const wrap = (fn) => async (...args) => fn(...args);

export const readFile = wrap(sync.readFileSync);
export const writeFile = wrap(sync.writeFileSync);
export const appendFile = wrap(sync.appendFileSync);
export const readdir = wrap(sync.readdirSync);
export const stat = wrap(sync.statSync);
export const lstat = wrap(sync.lstatSync);
export const mkdir = wrap(sync.mkdirSync);
export const rename = wrap(sync.renameSync);
export const rm = wrap(sync.rmSync);
export const unlink = wrap(sync.unlinkSync);
export const realpath = wrap(sync.realpathSync);
export const rmdir = wrap(sync.rmdirSync);
export const readlink = async (path) => {
  const err = new Error(`EINVAL: symbolic links are not supported in the browser filesystem, readlink '${path}'`);
  err.code = 'EINVAL';
  throw err;
};
export const symlink = async (target, path) => {
  const err = new Error(`ENOSYS: symbolic links are not supported in the browser filesystem, symlink '${path}'`);
  err.code = 'ENOSYS';
  throw err;
};
export const mkdtemp = wrap(sync.mkdtempSync);
export const access = async (path) => {
  if (!sync.existsSync(path)) {
    const err = new Error(`ENOENT: no such file or directory, access '${path}'`);
    err.code = 'ENOENT';
    throw err;
  }
};
