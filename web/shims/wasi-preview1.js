const ERRNO = { SUCCESS: 0, BADF: 8, INVAL: 28, NOSYS: 52, SPIPE: 70 };
const FILETYPE_CHARACTER_DEVICE = 2;
const ALL_RIGHTS = 0xffffffffffffffffn;

export class WasiExit extends Error {
  constructor(code) {
    super(`quickjs exited with status ${code}`);
    this.code = code;
  }
}

export function createWasi({ args = ['qjs'], stdout = () => {}, stderr = () => {}, now = () => Date.now() } = {}) {
  let memory = null;
  const view = () => new DataView(memory.buffer);
  const bytes = () => new Uint8Array(memory.buffer);
  const encoder = new TextEncoder();
  const text = encoder.encode(args.join('\0') + '\0');
  const writeStdio = (fd, iovs, iovsLen, nwrittenPtr) => {
    if (fd !== 1 && fd !== 2) return ERRNO.BADF;
    const sink = fd === 1 ? stdout : stderr;
    const data = view();
    let written = 0;
    for (let i = 0; i < iovsLen; i++) {
      const ptr = data.getUint32(iovs + i * 8, true);
      const len = data.getUint32(iovs + i * 8 + 4, true);
      sink(bytes().slice(ptr, ptr + len));
      written += len;
    }
    data.setUint32(nwrittenPtr, written, true);
    return ERRNO.SUCCESS;
  };
  const implemented = {
    environ_sizes_get(countPtr, sizePtr) {
      view().setUint32(countPtr, 0, true);
      view().setUint32(sizePtr, 0, true);
      return ERRNO.SUCCESS;
    },
    environ_get() {
      return ERRNO.SUCCESS;
    },
    args_sizes_get(countPtr, sizePtr) {
      view().setUint32(countPtr, args.length, true);
      view().setUint32(sizePtr, text.length, true);
      return ERRNO.SUCCESS;
    },
    args_get(argvPtr, bufPtr) {
      const data = view();
      let offset = 0;
      args.forEach((arg, index) => {
        data.setUint32(argvPtr + index * 4, bufPtr + offset, true);
        const encoded = encoder.encode(arg + '\0');
        bytes().set(encoded, bufPtr + offset);
        offset += encoded.length;
      });
      return ERRNO.SUCCESS;
    },
    clock_time_get(_id, _precision, outPtr) {
      view().setBigUint64(outPtr, BigInt(now()) * 1000000n, true);
      return ERRNO.SUCCESS;
    },
    fd_write: writeStdio,
    fd_read(fd, _iovs, _iovsLen, nreadPtr) {
      if (fd !== 0) return ERRNO.BADF;
      view().setUint32(nreadPtr, 0, true);
      return ERRNO.SUCCESS;
    },
    fd_close() {
      return ERRNO.SUCCESS;
    },
    fd_seek() {
      return ERRNO.SPIPE;
    },
    fd_fdstat_get(fd, statPtr) {
      if (fd > 2) return ERRNO.BADF;
      const data = view();
      data.setUint8(statPtr, FILETYPE_CHARACTER_DEVICE);
      data.setUint16(statPtr + 2, 0, true);
      data.setBigUint64(statPtr + 8, ALL_RIGHTS, true);
      data.setBigUint64(statPtr + 16, ALL_RIGHTS, true);
      return ERRNO.SUCCESS;
    },
    fd_fdstat_set_flags() {
      return ERRNO.SUCCESS;
    },
    fd_prestat_get() {
      return ERRNO.BADF;
    },
    fd_prestat_dir_name() {
      return ERRNO.BADF;
    },
    proc_exit(code) {
      throw new WasiExit(code);
    },
  };
  const imports = new Proxy(implemented, {
    get(target, name) {
      if (name in target) return target[name];
      return () => ERRNO.NOSYS;
    },
  });
  return {
    imports: { wasi_snapshot_preview1: imports },
    bind(instance) {
      memory = instance.exports.memory;
    },
  };
}
