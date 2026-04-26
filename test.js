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

console.log(`\nresult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
