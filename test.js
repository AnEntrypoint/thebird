import { tokenize, splitTopLevel, parsePipes, parseRedirects, expand, globToRe } from './docs/shell-parser.js';
import { resolvePath } from './docs/shell-builtins.js';
import { DEFAULT_CWD, HOME_DIR } from './docs/shell-defaults.js';
import { isControlStart, isBlockOpen } from './docs/shell-control.js';

let passed = 0, failed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log('  ok', label); }
  else { failed++; console.log('  FAIL', label, '\n    expected', JSON.stringify(expected), '\n    actual  ', JSON.stringify(actual)); }
};
const ok = (label, cond) => { if (cond) { passed++; console.log('  ok', label); } else { failed++; console.log('  FAIL', label); } };

console.log('# defaults');
eq('DEFAULT_CWD', DEFAULT_CWD, '/home');
eq('HOME_DIR', HOME_DIR, '/home');

console.log('# llm-1: ~ expansion (cd ~ from anywhere)');
eq('~ alone', resolvePath('/sys', '~'), HOME_DIR);
eq('~/foo', resolvePath('/sys', '~/foo'), '/home/foo');
eq('~/a/b', resolvePath('/anywhere', '~/a/b'), '/home/a/b');

console.log('# llm-2: empty arg returns cwd');
eq('empty', resolvePath('/home/proj', ''), '/home/proj');
eq('null', resolvePath('/home', null), '/home');

console.log('# llm-3: relative resolution');
eq('foo from /home', resolvePath('/home', 'foo'), '/home/foo');
eq('../sib', resolvePath('/home/proj', '../sib'), '/home/sib');
eq('. is cwd', resolvePath('/home', '.'), '/home');
eq('./foo', resolvePath('/home', './foo'), '/home/foo');

console.log('# llm-4: tokenize quoting');
eq('plain', tokenize('echo hello world'), ['echo', 'hello', 'world']);
eq('double-q', tokenize('echo "a b" c'), ['echo', 'a b', 'c']);
eq('single-q', tokenize("echo 'a b' c"), ['echo', 'a b', 'c']);
eq('mixed', tokenize('echo "she said" \'hi\''), ['echo', 'she said', 'hi']);
eq('escape-space', tokenize('echo a\\ b'), ['echo', 'a b']);
eq('backslash-n in dq preserved', tokenize('echo "a\\nb"'), ['echo', 'a\\nb']);

console.log('# llm-5: && and || short circuit splitting');
const c1 = splitTopLevel('a && b || c', ['&&', '||', ';']);
eq('chain shape', c1.map(x => x.cmd), ['a', 'b', 'c']);
eq('chain seps', c1.map(x => x.sep), [null, '&&', '||']);
const c2 = splitTopLevel('a; b', ['&&', '||', ';']);
eq('semi chain', c2.map(x => x.cmd + (x.sep || '')), ['a', 'b;']);

console.log('# llm-6: pipeline split');
eq('one pipe', parsePipes('a | b'), ['a', 'b']);
eq('three pipes', parsePipes('a | b | c'), ['a', 'b', 'c']);
eq('pipe in quotes ignored', parsePipes('echo "a | b" | cat'), ['echo "a | b"', 'cat']);

console.log('# llm-7: redirect parsing');
eq('> redir', parseRedirects(['echo', 'hi', '>', 'out']), { args: ['echo', 'hi'], stdout: 'out', stdoutAppend: false, stdin: null });
eq('>> append', parseRedirects(['echo', 'x', '>>', 'log']), { args: ['echo', 'x'], stdout: 'log', stdoutAppend: true, stdin: null });
eq('< stdin', parseRedirects(['cat', '<', 'in.txt']), { args: ['cat'], stdout: null, stdoutAppend: false, stdin: 'in.txt' });

console.log('# llm-8: env / argv expansion');
const env = { FOO: 'bar', EMPTY: '' };
eq('$FOO', expand('$FOO', env, 0, []), 'bar');
eq('${FOO}x', expand('${FOO}x', env, 0, []), 'barx');
eq('$? after success', expand('$?', env, 0, []), '0');
eq('$? after failure', expand('$?', env, 1, []), '1');
eq('$# argv count', expand('$#', env, 0, ['cmd', 'a', 'b']), '3');
eq('$1 first arg', expand('$1', env, 0, ['cmd', 'a', 'b']), 'a');
eq('$UNSET empty', expand('$UNSET', env, 0, []), '');
eq('$EMPTY empty', expand('$EMPTY', env, 0, []), '');

console.log('# llm-9: glob pattern compile');
ok('* matches anything no slash', globToRe('*.js').test('foo.js'));
ok('* does not match slash', !globToRe('*.js').test('a/b.js'));
ok('? single char', globToRe('?.js').test('a.js'));
ok('?? two chars', !globToRe('?.js').test('ab.js'));
ok('** matches slashes', globToRe('**/x.js').test('a/b/x.js'));
ok('[ab] class', globToRe('[ab].txt').test('a.txt') && globToRe('[ab].txt').test('b.txt'));
ok('[!ab] negation', !globToRe('[!ab].txt').test('a.txt'));

console.log('# llm-10: control flow detection');
ok('if is control start', isControlStart('if true; then'));
ok('for is control start', isControlStart('for i in 1 2 3'));
ok('while is control start', isControlStart('while read l'));
ok('plain is not control', !isControlStart('echo hi'));
ok('block open after if', isBlockOpen(['if true; then', 'echo a']));
ok('block closed after fi', !isBlockOpen(['if true; then', 'echo a', 'fi']));

console.log('# acptoapi: vendored bundle surface');
const browser = await import('./docs/vendor/thebird-browser.js');
ok('streamGemini exported', typeof browser.streamGemini === 'function');
ok('streamOpenAI exported', typeof browser.streamOpenAI === 'function');
ok('generateGemini exported', typeof browser.generateGemini === 'function');

console.log('# acptoapi: provider registry');
const { PROVIDERS } = await import('./docs/chat-providers.js');
ok('acptoapi provider registered', !!PROVIDERS.acptoapi);
eq('acptoapi base url', PROVIDERS.acptoapi.baseUrl, 'http://localhost:4800/v1');
const acpModels = PROVIDERS.acptoapi.models;
ok('kilo lane present', acpModels.some(m => m.startsWith('kilo/')));
ok('opencode lane present', acpModels.some(m => m.startsWith('opencode/')));
ok('claude-code-compatible: openrouter+anthropic', PROVIDERS.openrouter.models.some(m => m.startsWith('anthropic/claude-')));

console.log('# pyodide: lazy import surface');
let fetchCalls = 0;
const origFetch = globalThis.fetch;
globalThis.fetch = (...a) => { fetchCalls++; return origFetch ? origFetch(...a) : Promise.reject(new Error('no fetch in node')); };
const pyMod = await import('./docs/shell-python-pyodide.js');
ok('shell-python-pyodide loads without fetch', fetchCalls === 0);
ok('loadPyodide is a function', typeof pyMod.loadPyodide === 'function');
ok('runPython is a function', typeof pyMod.runPython === 'function');
ok('micropipInstall is a function', typeof pyMod.micropipInstall === 'function');
ok('bridgeFs is a function', typeof pyMod.bridgeFs === 'function');
ok('isLoaded is a function returning false pre-load', pyMod.isLoaded() === false);
const shellPy = await import('./docs/shell-python.js');
ok('makePythonBuiltin exported', typeof shellPy.makePythonBuiltin === 'function');
ok('shell-python import did not fetch', fetchCalls === 0);
globalThis.fetch = origFetch;

console.log('# asgi-bridge: mount + round-trip');
const asgi = await import('./docs/asgi-bridge.js');
ok('mountAsgi exported', typeof asgi.mountAsgi === 'function');
ok('dispatchAsgi exported', typeof asgi.dispatchAsgi === 'function');
ok('findAsgiApp exported', typeof asgi.findAsgiApp === 'function');
ok('buildScope exported', typeof asgi.buildScope === 'function');

const stubApp = async (scope, receive, send) => {
  if (scope.type === 'lifespan') return;
  await receive();
  await send({ type: 'http.response.start', status: 200, headers: [[new TextEncoder().encode('content-type'), new TextEncoder().encode('text/plain')]] });
  await send({ type: 'http.response.body', body: 'ok ' + scope.method + ' ' + scope.path });
};
asgi.mountAsgi(stubApp, '/asgi');
const found = asgi.findAsgiApp('/asgi/hello');
ok('findAsgiApp resolves /asgi/hello', !!found && found.prefix === '/asgi');
const r = await asgi.dispatchAsgi('GET', '/asgi/hello?x=1', { 'host': 'thebird' }, null);
eq('status 200', r.status, 200);
eq('body matches', r.body, 'ok GET /asgi/hello');
eq('content-type', r.headers['content-type'], 'text/plain');

const scope = asgi.buildScope('POST', '/asgi/api?a=b', { 'X-Foo': 'bar' }, '{"k":1}', '/asgi');
eq('scope method', scope.method, 'POST');
eq('scope path', scope.path, '/asgi/api');
eq('scope query', new TextDecoder().decode(scope.query_string), 'a=b');
eq('scope root_path', scope.root_path, '/asgi');
ok('scope.headers is array of [Uint8Array, Uint8Array]', Array.isArray(scope.headers) && scope.headers[0][0] instanceof Uint8Array);

const miss = asgi.findAsgiApp('/other/x');
ok('findAsgiApp returns null for unmounted prefix', miss === null);
ok('unmount works', asgi.unmountAsgi('/asgi') === true);
ok('after unmount, findAsgiApp null', asgi.findAsgiApp('/asgi/hello') === null);

console.log('# python integration: createPyEnv eager + lazy + scan');
const shellPyMod = await import('./docs/shell-python.js');
ok('createPyEnv exported', typeof shellPyMod.createPyEnv === 'function');
let calls = [];
const fakeCtx = { term: { write: s => calls.push(s) }, env: {}, cwd: '/home' };
const pyEnv = shellPyMod.createPyEnv({ ctx: fakeCtx, term: fakeCtx.term });
ok('createPyEnv returns python', typeof pyEnv.python === 'function');
ok('createPyEnv returns pip', typeof pyEnv.pip === 'function');
ok('createPyEnv returns scanAndMount', typeof pyEnv.scanAndMount === 'function');
ok('createPyEnv returns isLoaded', typeof pyEnv.isLoaded === 'function');
ok('isLoaded false before any python call', pyEnv.isLoaded() === false);

const pyMod2 = await import('./docs/shell-python-pyodide.js');
ok('scanAndMount exported from pyodide module', typeof pyMod2.scanAndMount === 'function');
ok('getMountedPyApps exported', typeof pyMod2.getMountedPyApps === 'function');

const fakeApp = function(scope, receive, send) { return null; };
fakeApp.__class__ = { __name__: 'FastAPI' };
const fakeGlobals = new Map([['app', fakeApp], ['_private', 'skip'], ['x', 42]]);
const fakeInst = { globals: { keys: () => fakeGlobals.keys(), get: k => fakeGlobals.get(k) } };
const asgiMod2 = await import('./docs/asgi-bridge.js');
const beforeMounts = asgiMod2.findAsgiApp('/app');
ok('app prefix not mounted before scan', beforeMounts === null);
const detected = await pyMod2.scanAndMount(fakeInst, asgiMod2.mountAsgi);
eq('one app detected', detected.length, 1);
eq('detected name', detected[0].name, 'app');
eq('detected prefix', detected[0].prefix, '/app');
eq('detected class', detected[0].cls, 'FastAPI');
const afterMounts = asgiMod2.findAsgiApp('/app/anything');
ok('after scan, /app prefix resolves', !!afterMounts && afterMounts.prefix === '/app');

const detected2 = await pyMod2.scanAndMount(fakeInst, asgiMod2.mountAsgi);
eq('idempotent: re-scan finds zero new', detected2.length, 0);
const allMounted = pyMod2.getMountedPyApps();
ok('mounted registry has app', allMounted.has('app'));
asgiMod2.unmountAsgi('/app');

console.log('# smoke harness: shape');
const smokeMod = await import('./docs/smoke.js');
ok('runSmoke exported', typeof smokeMod.runSmoke === 'function');
ok('renderSmokePanel exported', typeof smokeMod.renderSmokePanel === 'function');
ok('autoRunIfRequested exported', typeof smokeMod.autoRunIfRequested === 'function');
const netMod = await import('./docs/smoke-network.js');
ok('runNetworkSmoke exported', typeof netMod.runNetworkSmoke === 'function');
const hermesSmoke = await import('./docs/smoke-hermes.js');
ok('runHermesPreflight exported', typeof hermesSmoke.runHermesPreflight === 'function');
ok('renderHermesPanel exported', typeof hermesSmoke.renderHermesPanel === 'function');
ok('hermes autoRunIfRequested exported', typeof hermesSmoke.autoRunIfRequested === 'function');

console.log('# vendor: pyodide URL points at vendor');
const fs2 = await import('node:fs');
const py = fs2.readFileSync('./docs/shell-python-pyodide.js', 'utf8');
ok('shell-python-pyodide refs vendor/pyodide', py.includes('./vendor/pyodide/'));
ok('shell-python-pyodide retains CDN fallback', py.includes('cdn.jsdelivr.net/pyodide'));
const sp = fs2.readFileSync('./docs/shell-python.js', 'utf8');
ok('shell-python refs vendor/micropython', sp.includes('./vendor/micropython/'));
ok('vendor-fetch script exists', fs2.existsSync('./scripts/vendor-fetch.mjs'));
const vf = fs2.readFileSync('./scripts/vendor-fetch.mjs', 'utf8');
ok('vendor-fetch is zero-dep (no require/import of npm)', !/from ['"][^./]/.test(vf.replace(/from ['"]node:/g, '')));

console.log(`\nresult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
