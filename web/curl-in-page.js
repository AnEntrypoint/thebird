import * as fs from './shims/fs.js';
import { posix } from './shims/path.js';
import { runTjs, bytesFromBase64 } from './txiki-in-page.js';

const CORS_NOTE = 'the in-page shell reaches only hosts that send CORS headers to this page';
const MARKER = '@@thebird-fetch ';

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

const fetchModule = (url) => `const toBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};
try {
  const response = await fetch(${JSON.stringify(url)});
  const body = new Uint8Array(await response.arrayBuffer());
  console.log(${JSON.stringify(MARKER)} + JSON.stringify({ status: response.status, ok: response.ok, body: toBase64(body) }));
} catch (err) {
  console.log(${JSON.stringify(MARKER)} + JSON.stringify({ error: true, message: String(err?.message ?? err) }));
}
`;

export async function curlBuiltin(name, argv, cwd, signal) {
  const opts = parse(name, argv);
  const host = new URL(opts.url).host;
  const { output, status } = await runTjs(fetchModule(opts.url), cwd, { signal });
  if (status !== 0) throw new Error(output.trimEnd());
  const line = output.split('\n').find((text) => text.startsWith(MARKER));
  if (line === undefined) throw new Error(output.trimEnd());
  const result = JSON.parse(line.slice(MARKER.length));
  if (result.error) {
    if (result.message.startsWith('Network request failed')) throw new Error(`could not fetch from ${host}: ${CORS_NOTE}`);
    throw new Error(result.message);
  }
  if (opts.fail && !result.ok) throw new Error(`HTTP ${result.status} from ${host}`);
  const bytes = bytesFromBase64(result.body);
  if (opts.output === undefined) return new TextDecoder().decode(bytes);
  fs.writeFileSync(posix.resolve(cwd, opts.output), bytes);
  return '';
}
