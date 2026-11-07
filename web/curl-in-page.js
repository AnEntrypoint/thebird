import * as fs from './shims/fs.js';
import { posix } from './shims/path.js';

const CORS_NOTE = 'the in-page shell reaches only hosts that send CORS headers to this page';

function parse(name, argv) {
  const opts = { fail: false, output: undefined, url: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (/^https?:\/\//.test(arg)) {
      if (opts.url) throw new Error('one URL per call');
      opts.url = arg;
    } else if (name === 'curl' && arg === '-o') opts.output = argv[++i];
    else if (name === 'wget' && arg === '-O') opts.output = argv[++i];
    else if (/^-[sSfLq]+$/.test(arg)) opts.fail ||= arg.includes('f');
    else throw new Error(`${arg}: flag not supported in the in-page shell`);
  }
  if (!opts.url) throw new Error(`usage: ${name === 'curl' ? 'curl [-sf] [-o file]' : 'wget [-q] [-O file]'} <http(s) URL>`);
  if (opts.output === undefined && name === 'wget') opts.output = posix.basename(new URL(opts.url).pathname) || 'index.html';
  return opts;
}

async function get(url) {
  try {
    return await fetch(url);
  } catch {
    throw new Error(`could not fetch from ${new URL(url).host}: ${CORS_NOTE}`);
  }
}

export async function curlBuiltin(name, argv, cwd) {
  const opts = parse(name, argv);
  const response = await get(opts.url);
  if (opts.fail && !response.ok) throw new Error(`HTTP ${response.status} from ${new URL(opts.url).host}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (opts.output === undefined) return new TextDecoder().decode(bytes);
  fs.writeFileSync(posix.resolve(cwd, opts.output), bytes);
  return '';
}
