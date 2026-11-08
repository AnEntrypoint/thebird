import { runTjs } from './txiki-in-page.js';
import * as fs from './shims/fs.js';
import { dirname, resolve } from './shims/path.js';

const USAGE = 'usage: node <script> | node -e <code> | node -v';
const VERSION_SOURCE = 'console.log(tjs.version);';

export async function nodeBuiltin(argv, dir, options) {
  let source;
  let base = dir;
  if (argv.length === 2 && argv[0] === '-e') source = argv[1];
  else if (argv.length === 1 && (argv[0] === '-v' || argv[0] === '--version')) source = VERSION_SOURCE;
  else if (argv.length >= 1 && !argv[0].startsWith('-')) {
    const path = resolve(dir, argv[0]);
    try {
      source = fs.readFileSync(path, 'utf8');
    } catch {
      throw new Error(`Cannot find module '${path}'`);
    }
    base = dirname(path);
  } else throw new Error(USAGE);
  const { output, status } = await runTjs(source, base, options);
  if (status !== 0) throw new Error([output.trimEnd(), `node exited with status ${status}`].filter(Boolean).join('\n'));
  return output.trimEnd();
}
