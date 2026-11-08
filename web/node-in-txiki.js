import { runTjs } from './txiki-in-page.js';
import * as fs from './shims/fs.js';
import { resolve } from './shims/path.js';

const USAGE = 'usage: node <script> [args] | node -e <code> | node -v';

function installNodeGlobals(cwd, argv) {
  const absolute = (path) => (path.startsWith('/') ? path : `${cwd}/${path}`);
  const enoent = (path) => Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });
  const fsModule = {
    readFileSync(path, options) {
      const bytes = __thebirdFs.readFile(absolute(path));
      if (bytes === undefined) throw enoent(path);
      const encoding = typeof options === 'string' ? options : options?.encoding;
      return encoding ? new TextDecoder().decode(bytes) : new Uint8Array(bytes);
    },
    writeFileSync(path, data) {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
      if (!__thebirdFs.writeFile(absolute(path), bytes.buffer)) throw Object.assign(new Error(`EIO: i/o error, open '${path}'`), { code: 'EIO' });
    },
    existsSync: (path) => __thebirdFs.stat(absolute(path)) !== undefined,
    readdirSync(path) {
      const names = __thebirdFs.readdir(absolute(path));
      if (names === undefined) throw enoent(path);
      return names;
    },
    mkdirSync(path) {
      if (!__thebirdFs.mkdir(absolute(path))) throw Object.assign(new Error(`EEXIST: file already exists, mkdir '${path}'`), { code: 'EEXIST' });
    },
  };
  globalThis.process = {
    argv,
    env: {},
    platform: 'linux',
    version: 'v' + tjs.version,
    versions: { txiki: tjs.version },
    cwd: () => cwd,
    exit: (code = 0) => tjs.exit(code),
  };
  globalThis.require = (name) => {
    if (name === 'fs' || name === 'node:fs') return fsModule;
    throw Object.assign(new Error(`Cannot find module '${name}'`), { code: 'MODULE_NOT_FOUND' });
  };
}

export async function nodeBuiltin(argv, dir, options) {
  let source;
  let scriptArgv = ['node'];
  if (argv.length === 2 && argv[0] === '-e') source = argv[1];
  else if (argv.length === 1 && (argv[0] === '-v' || argv[0] === '--version')) source = 'console.log(process.version);';
  else if (argv.length >= 1 && !argv[0].startsWith('-')) {
    const path = resolve(dir, argv[0]);
    try {
      source = fs.readFileSync(path, 'utf8');
    } catch {
      throw new Error(`Cannot find module '${path}'`);
    }
    scriptArgv = ['node', path, ...argv.slice(1)];
  } else throw new Error(USAGE);
  const prelude = `(${installNodeGlobals.toString()})(${JSON.stringify(dir)}, ${JSON.stringify(scriptArgv)});\n`;
  const { output, status } = await runTjs(prelude + source, dir, options);
  if (status !== 0) throw new Error([output.trimEnd(), `node exited with status ${status}`].filter(Boolean).join('\n'));
  return output.trimEnd();
}
