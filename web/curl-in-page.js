import * as fs from './shims/fs.js';
import { posix } from './shims/path.js';
import { runTjs, bytesFromBase64 } from './txiki-in-page.js';

const CORS_NOTE = 'the in-page shell reaches hosts that send CORS headers to this page, and localhost ports through the /__thebird/port/ proxy of this page';
const MARKER = '@@thebird-fetch ';

const SEND_GET = 'the page shell sends GET only; read the body with curl -s <url> or wget -qO- <url>';
const NO_EXTRAS = 'the page shell sends no headers or body; use fetch in a node -e script for other requests';
const BODY_ONLY = 'the page shell prints the body only; check the result with curl -sf <url>';
const ADVICE = {
  I: SEND_GET,
  head: SEND_GET,
  X: NO_EXTRAS,
  request: NO_EXTRAS,
  H: NO_EXTRAS,
  header: NO_EXTRAS,
  d: NO_EXTRAS,
  data: NO_EXTRAS,
  'data-raw': NO_EXTRAS,
  F: NO_EXTRAS,
  form: NO_EXTRAS,
  u: NO_EXTRAS,
  user: NO_EXTRAS,
  v: BODY_ONLY,
  verbose: BODY_ONLY,
  i: BODY_ONLY,
  include: BODY_ONLY,
  w: BODY_ONLY,
  'write-out': BODY_ONLY,
  r: 'recursive download is not supported; fetch each URL with wget -O <file> <url>',
  recursive: 'recursive download is not supported; fetch each URL with wget -O <file> <url>',
  c: 'resume is not supported; fetch the whole file with wget -O <file> <url>',
  continue: 'resume is not supported; fetch the whole file with wget -O <file> <url>',
};

const SPEC = {
  curl: {
    usage: 'curl [-sSfLkO] [-o file|-] <http(s) URL>',
    shortFlags: { s: 'silent', S: 'showError', f: 'fail', L: 'location', k: 'insecure', O: 'remoteName' },
    shortValues: { o: 'output' },
    longFlags: { '--silent': 'silent', '--show-error': 'showError', '--fail': 'fail', '--location': 'location', '--insecure': 'insecure', '--compressed': 'compressed', '--remote-name': 'remoteName' },
    longValues: { '--output': 'output' },
  },
  wget: {
    usage: 'wget [-q] [-O file|-] <http(s) URL>',
    shortFlags: { q: 'quiet' },
    shortValues: { O: 'output' },
    longFlags: { '--quiet': 'quiet', '--no-verbose': 'quiet' },
    longValues: { '--output-document': 'output' },
  },
};

export function parseFetchArgs(name, argv) {
  const spec = SPEC[name];
  const opts = {};
  const refuse = (flag) => {
    const advice = ADVICE[flag.replace(/^-+/, '')] ?? `not supported in the in-page shell; usage: ${spec.usage}`;
    throw new Error(`${flag}: ${advice}`);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (/^https?:\/\//.test(arg)) {
      if (opts.url) throw new Error('one URL per call');
      opts.url = arg;
    } else if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      const long = equals === -1 ? arg : arg.slice(0, equals);
      if (Object.hasOwn(spec.longFlags, long)) opts[spec.longFlags[long]] = true;
      else if (Object.hasOwn(spec.longValues, long)) {
        const value = equals === -1 ? argv[++i] : arg.slice(equals + 1);
        if (value === undefined) throw new Error(`${long} needs a value`);
        opts[spec.longValues[long]] = value;
      } else refuse(long);
    } else if (arg.length > 1 && arg.startsWith('-')) {
      for (let j = 1; j < arg.length; j++) {
        const letter = arg[j];
        if (Object.hasOwn(spec.shortFlags, letter)) opts[spec.shortFlags[letter]] = true;
        else if (Object.hasOwn(spec.shortValues, letter)) {
          const value = j + 1 < arg.length ? arg.slice(j + 1) : argv[++i];
          if (value === undefined) throw new Error(`-${letter} needs a value`);
          opts[spec.shortValues[letter]] = value;
          break;
        } else refuse(`-${letter}`);
      }
    } else throw new Error(`${arg}: unexpected argument; usage: ${spec.usage}`);
  }
  if (!opts.url) throw new Error(`usage: ${spec.usage}`);
  const remoteName = posix.basename(new URL(opts.url).pathname) || 'index.html';
  if (name === 'wget') return { url: opts.url, output: opts.output ?? remoteName, fail: true };
  return { url: opts.url, output: opts.output ?? (opts.remoteName ? remoteName : undefined), fail: opts.fail === true };
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

const failure = (message, exitCode = 1) => Object.assign(new Error(message), { exitCode, stdout: `${message}\n` });

const httpFailure = (name, status, host) => (name === 'wget'
  ? failure(`ERROR ${status}: server returned an error response from ${host}`, 8)
  : failure(`HTTP ${status} from ${host}`, 22));

export async function curlBuiltin(name, argv, cwd, signal) {
  const opts = parseFetchArgs(name, argv);
  const host = new URL(opts.url).host;
  const { output, status } = await runTjs(fetchModule(opts.url), cwd, { signal });
  if (status !== 0) throw failure(output.trimEnd());
  const line = output.split('\n').find((text) => text.startsWith(MARKER));
  if (line === undefined) throw failure(output.trimEnd());
  const result = JSON.parse(line.slice(MARKER.length));
  if (result.error) {
    if (result.message.startsWith('Network request failed')) throw failure(`could not fetch from ${host}: ${CORS_NOTE}`);
    throw failure(result.message);
  }
  if (opts.fail && !result.ok) throw httpFailure(name, result.status, host);
  const bytes = bytesFromBase64(result.body);
  if (opts.output === undefined || opts.output === '-') return new TextDecoder().decode(bytes);
  if (opts.output === '/dev/null') return '';
  fs.writeFileSync(posix.resolve(cwd, opts.output), bytes);
  return '';
}
