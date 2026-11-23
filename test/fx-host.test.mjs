import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { default: host } = await import(pathToFileURL(join(root, 'web', 'fx-host.js')).href);

test('the default export is a frozen object of the five fields, and the host names itself thebird', () => {
  assert.deepEqual(Object.keys(host).sort(), ['capabilities', 'modules', 'tools', 'verbs', 'version']);
  assert.ok(Object.isFrozen(host) && Object.isFrozen(host.version) && Object.isFrozen(host.capabilities));
  assert.deepEqual({ ...host.version }, { interface: 1, minor: 0, host: 'thebird' });
});

test('capabilities lists tools and exactly the modules the host provides', () => {
  assert.deepEqual([...host.capabilities], ['tools', ...Object.keys(host.modules)]);
  assert.deepEqual(Object.keys(host.modules).sort(), ['buffer', 'crypto', 'fs', 'fs/promises', 'path', 'timers/promises', 'url']);
});

test('each provided module carries the names the fx alias table gives it', () => {
  const expected = {
    path: ['basename', 'delimiter', 'dirname', 'extname', 'format', 'isAbsolute', 'join', 'normalize', 'parse', 'posix', 'relative', 'resolve', 'sep'],
    crypto: ['createHash', 'randomBytes', 'randomUUID'],
    fs: ['existsSync', 'lstatSync', 'mkdirSync', 'mkdtempSync', 'openSync', 'readFileSync', 'readSync', 'readdirSync', 'readlinkSync', 'realpathSync', 'renameSync', 'rmSync', 'statSync', 'symlinkSync', 'unlinkSync', 'writeFileSync'],
    'fs/promises': ['access', 'lstat', 'mkdir', 'mkdtemp', 'readFile', 'readdir', 'realpath', 'rename', 'rm', 'stat', 'unlink', 'writeFile'],
    'timers/promises': ['scheduler', 'setTimeout'],
    url: ['URL', 'URLSearchParams'],
  };
  for (const [name, names] of Object.entries(expected)) for (const member of names) assert.ok(member in host.modules[name], name + '.' + member);
});

test('the tools write and read a file in the workspace, and an absent tool names itself in its refusal', () => {
  host.modules.fs.mkdirSync('/workspace', { recursive: true });
  assert.equal(host.tools.write_file({ path: '/workspace/fx-host-test.txt', content: 'hi' }), 'wrote /workspace/fx-host-test.txt');
  assert.equal(host.tools.read_file({ path: '/workspace/fx-host-test.txt' }), 'hi');
  assert.throws(() => host.tools.Bash, (error) => error.code === 'ERR_FX_UNSUPPORTED' && error.name === 'FxUnsupported' && error.target === 'tools.Bash');
  assert.throws(() => host.verbs.anything, (error) => error.code === 'ERR_FX_UNSUPPORTED');
});

test('the timers module waits and the crypto module hashes, as in Node', async () => {
  assert.equal(await host.modules['timers/promises'].setTimeout(5, 'late'), 'late');
  assert.equal(host.modules.crypto.createHash('sha256').update('abc').digest('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(host.modules.path.join('/a', 'b', '../c'), '/a/c');
});

test('the url module parses a URL as Node does', () => {
  const parsed = new host.modules.url.URL('https://example.com/a?b=1');
  assert.equal(parsed.pathname, '/a');
  assert.equal(parsed.searchParams.get('b'), '1');
});
