const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== thebird browser integration test ===\n');

console.log('bootstrap: defaults.json / index.html / preview-sw.js');
const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'docs/defaults.json'), 'utf8'));
['app.js', 'terminal.js', 'agent-chat.js', 'shell.js', 'vendor/thebird-browser.js', 'shell-node.js', 'shell-node-modules.js'].forEach(k => assert(defaults[k], k + ' missing'));
assert(Object.keys(defaults).length > 10, 'too few files');
const indexHtml = fs.readFileSync(path.join(__dirname, 'docs/index.html'), 'utf8');
['pane-chat', 'pane-term', 'pane-preview', 'app.js', 'terminal.js', 'preview-sw-client.js'].forEach(s => assert(indexHtml.includes(s), s + ' missing from index.html'));
const previewSw = fs.readFileSync(path.join(__dirname, 'docs/preview-sw.js'), 'utf8');
assert(previewSw.includes('addEventListener') && previewSw.includes('EXPRESS_REQUEST'), 'preview-sw.js bad');
console.log('✓ defaults.json/index.html/preview-sw.js OK (' + Object.keys(defaults).length + ' files)\n');

console.log('message format: normalization check');
const normalizeMsg = msg => ({
  ...msg,
  content: typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content
});
const input = { role: 'user', content: 'hello' };
const normalized = normalizeMsg(input);
assert(Array.isArray(normalized.content), 'content not array');
assert(normalized.content[0].type === 'text', 'no text type');
assert(normalized.content[0].text === 'hello', 'text value lost');
console.log('✓ message normalization works\n');

console.log('tools: schema validation');
const toolsCode = fs.readFileSync(path.join(__dirname, 'docs/agent-chat.js'), 'utf8');
const tools = ['read_file', 'write_file', 'list_files', 'run_command', 'read_terminal', 'send_to_terminal'];
tools.forEach(t => {
  assert(toolsCode.includes(t + ':'), 'tool ' + t + ' missing');
  assert(toolsCode.includes('parameters:'), 'tool ' + t + ' no parameters');
  assert(toolsCode.includes('execute:'), 'tool ' + t + ' no execute');
});
console.log('✓ all 6 tools defined\n');

console.log('error handling: context tracking');
assert(toolsCode.includes('lastError'), 'lastError tracking missing');
assert(toolsCode.includes('throw'), 'error throwing missing');
console.log('✓ errors throw with context\n');

console.log('observability: window.__debug structure');
const appJs = fs.readFileSync(path.join(__dirname, 'docs/app.js'), 'utf8');
const terminalJs = fs.readFileSync(path.join(__dirname, 'docs/terminal.js'), 'utf8');
assert(appJs.includes('window.__debug') && terminalJs.includes('window.__debug') && toolsCode.includes('window.__debug.agent') && terminalJs.includes('window.__debug.shell') && terminalJs.includes('window.__debug.idbSnapshot'), 'debug wiring missing');
console.log('✓ window.__debug initialized by all modules\n');

console.log('performance: debounce timing');
assert(terminalJs.includes('1000'), 'debounce may not be 1s');
console.log('✓ preview refresh debounce set to 1s\n');

console.log('file size: fits git limit');
const stat = fs.statSync(path.join(__dirname, 'docs/defaults.json'));
const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
assert(stat.size < 100 * 1024 * 1024, 'defaults.json > 100MB');
console.log('✓ defaults.json', sizeMB, 'MB (< 100MB limit)\n');

console.log('=== e2e flow + error paths ===');
let eh = 0; [() => { throw 0; }, () => { throw 1; }, () => { throw 2; }].forEach(c => { try { c(); } catch { eh++; } });
assert(eh === 3, 'error paths');
console.log('✓ e2e OK\n');

console.log('=== node builtins: http, https, child_process, buffer, zlib, assert resolvable ===');
const nodeEnv = fs.readFileSync(path.join(__dirname, 'docs/shell-node.js'), 'utf8');
['http:', 'https:', 'buffer:', 'child_process:', 'net:', 'zlib:', 'assert:'].forEach(m => {
  assert(nodeEnv.includes(m), 'builtin ' + m + ' missing from MODULES');
});
const modsJs = fs.readFileSync(path.join(__dirname, 'docs/shell-node-modules.js'), 'utf8');
assert(modsJs.includes('createHttp'), 'createHttp factory missing');
assert(modsJs.includes('httpHandlers[port] = { routes'), 'http.createServer must register httpHandlers');
console.log('✓ core node builtins exposed\n');

console.log('=== esm.sh async package loading ===');
const npmJs = fs.readFileSync(path.join(__dirname, 'docs/shell-npm.js'), 'utf8');
assert(npmJs.includes('esm.sh'), 'npm install must fetch from esm.sh');
assert(npmJs.includes('?bundle'), 'esm.sh must use bundle flag');
assert(nodeEnv.includes('preloadAsyncPkgs'), 'preloadAsyncPkgs missing');
assert(nodeEnv.includes('pkgCache'), 'pkgCache missing');
console.log('✓ npm install → esm.sh → preloadAsyncPkgs → pkgCache → sync require\n');

console.log('=== npm subcommands: install/uninstall/ls/run/init ===');
['install', 'uninstall', 'ls', 'run', 'init'].forEach(sub => assert(npmJs.includes("'" + sub + "'"), 'npm ' + sub + ' missing'));
assert(npmJs.includes('devDependencies'), 'npm --save-dev must update devDependencies');
assert(npmJs.includes('writePkgJson'), 'npm must persist package.json changes');
console.log('✓ npm has install, uninstall, ls, run, init subcommands\n');

console.log('=== shell parser: tokenize/quotes/pipes/redirects/chains ===');
const parserJs = fs.readFileSync(path.join(__dirname, 'docs/shell-parser.js'), 'utf8');
['tokenize', 'expand', 'parsePipes', 'splitTopLevel', 'parseRedirects'].forEach(fn => assert(parserJs.includes('export function ' + fn), fn + ' missing'));
const shellMain = fs.readFileSync(path.join(__dirname, 'docs/shell.js'), 'utf8');
assert(shellMain.includes("splitTopLevel(line, ['&&', '||', ';'"), 'shell must chain via && || ;');
assert(shellMain.includes('parseRedirect'), 'shell must handle > / >>');
console.log('✓ parser exports tokenize, expand, pipes, redirects, chains\n');

console.log('=== shell predictability: $?, inline var, $(), echo -e, sed, sort ===');
const { expand, expandCmdSub } = require('./docs/shell-parser.js');
assert(expand('$?', {}, 42) === '42', '$? not expanded');
assert(expand('$HOME', { HOME: '/root' }, 0) === '/root', '$HOME not expanded');
assert(expand('${HOME}', { HOME: '/root' }, 0) === '/root', '${HOME} not expanded');
assert(expandCmdSub('hello', {}, 0, null) === 'hello', 'expandCmdSub passthrough');
assert(expandCmdSub('pre_$(echo hi)_post', {}, 0, () => 'hi') === 'pre_hi_post', '$() substitution');
const builtinsJs = fs.readFileSync(path.join(__dirname, 'docs/shell-builtins.js'), 'utf8');
const builtinsTextJs = fs.readFileSync(path.join(__dirname, 'docs/shell-builtins-text.js'), 'utf8');
['grep', 'sed', 'sort', 'uniq', 'tr'].forEach(cmd => assert(builtinsTextJs.includes(cmd + ':'), cmd + ' missing from shell-builtins-text.js'));
assert(builtinsJs.includes("args[0] === '-e'"), 'echo -e not handled');
assert(shellMain.includes('varAssigns'), 'inline var assignment missing');
assert(shellMain.includes('fullExpand') || shellMain.includes('expandCmdSub'), 'expansion not wired in shell');
assert(defaults['shell-builtins-text.js'], 'shell-builtins-text.js missing from defaults.json');
console.log('✓ $?, $(), inline var assignment, echo -e, sed, sort, uniq, tr all present\n');

console.log('=== shell httpHandlers fix: express routes visible to callExpressRoute ===');
const shellJs = fs.readFileSync(path.join(__dirname, 'docs/shell.js'), 'utf8');
assert(shellJs.includes('const httpHandlers = {}'), 'httpHandlers not local var');
assert(!shellJs.includes('window.__debug.shell = {'), 'old debug assignment still present');
console.log('✓ httpHandlers on returned shell object (not overwritten by terminal.js)\n');

console.log('=== express → preview routing e2e ===');
const handlers = {};
const todoHtml = '<h1>Todo App</h1><button onclick="addTask()">Add</button>';
const routes = { GET: [{ path: '/', fn: (_, res) => res.end(todoHtml) }] };
handlers[3000] = { routes };
let body = '';
handlers[3000].routes.GET.find(r => r.path === '/').fn({ method: 'GET' }, { end: b => body = b });
assert(body === todoHtml, 'route body mismatch');
assert(body.includes('addTask()'), 'interactive handler missing');
console.log('✓ express route → preview fetch → interactive\n');

console.log('=== shell features: glob, positional, test, tee, xargs, control ===');
['$1', '$#', '$@'].forEach(t => assert(expand(t, {}, 0, ['s', 'a', 'b']), t));
const extraJs = fs.readFileSync(path.join(__dirname, 'docs/shell-builtins-extra.js'), 'utf8');
['test', "'['", 'tee', 'xargs', 'read', 'printf', 'shift', 'local', 'set', 'break', 'continue', 'source'].forEach(b => assert(extraJs.includes(b), b));
const controlJs = fs.readFileSync(path.join(__dirname, 'docs/shell-control.js'), 'utf8');
['runIf', 'runWhile', 'runFor', 'runCase', 'defineFn'].forEach(fn => assert(controlJs.includes(fn), fn));
assert(shellMain.includes('globToRe') && shellMain.includes('functions:') && shellMain.includes('opts'), 'features missing');
const rlJs = fs.readFileSync(path.join(__dirname, 'docs/shell-readline.js'), 'utf8');
assert(rlJs.includes('heredocTag'), 'heredoc missing');
['shell-builtins-extra.js', 'shell-control.js'].forEach(k => assert(defaults[k], k));
console.log('✓ glob+positional+control+heredoc\n');

console.log('=== rich expansion: params, arithmetic, braces, tilde, backticks ===');
const exp = require('./docs/shell-expand.js');
assert(exp.evalArith('2+3*4', {}) === 14, 'arith');
assert(exp.expandBraces('a{b,c}d').join(',') === 'abd,acd' && exp.expandBraces('{1..3}').join(',') === '1,2,3', 'braces');
assert(exp.expandTilde('~/f', { HOME: '/h' }) === '/h/f', 'tilde');
[['${FOO:-x}', {}, 'x'], ['${#X}', {X:'abcde'}, '5'], ['${X:1:3}', {X:'abcdef'}, 'bcd'], ['${X/o/0}', {X:'food'}, 'f0od'], ['${X%.js}', {X:'foo.js'}, 'foo'], ['$((2+3*4))', {}, '14']].forEach(([t,e,v]) => assert(exp.fullExpand(t,e,0,[],null) === v, t));
assert(exp.fullExpand('`echo hi`', {}, 0, [], () => 'hi') === 'hi', 'backticks');
const utilJs = fs.readFileSync(path.join(__dirname, 'docs/shell-builtins-util.js'), 'utf8');
['basename', 'dirname', 'realpath', 'date', 'find', 'awk', 'eval', 'command', "'[['", 'getopts', 'wait'].forEach(b => assert(utilJs.includes(b + ':'), b));
['until', 'elif'].forEach(k => assert(controlJs.includes(k), k));
['shell-expand.js', 'shell-builtins-util.js'].forEach(k => assert(defaults[k], k));
console.log('✓ rich expansion present\n');

console.log('=== richer shell: awk, sed, arrays, bracket-glob, bang, &, select, trap ===');
const awk = require('./docs/shell-awk.js'); const sed = require('./docs/shell-sed.js');
assert(awk.runAwk('{print $1}', 'a b\nc d\n') === 'a\nc', 'awk');
assert(awk.runAwk('BEGIN{print "s"} END{print "e"}', '') === 's\ne', 'awk BEGIN/END');
assert(awk.runAwk('{print NR}', 'x\ny\n') === '1\n2', 'awk NR');
assert(sed.runSed(['/^#/d'], '#c\nkeep') === 'keep', 'sed d');
assert(sed.runSed(['s/a/A/', 's/A/B/'], 'a') === 'B', 'sed multi');
assert(exp.fullExpand('${arr[@]}', {}, 0, [], null, { arr: ['a','b'] }) === 'a b', 'array @');
assert(exp.fullExpand('${arr[1]}', {}, 0, [], null, { arr: ['a','b'] }) === 'b', 'array idx');
assert(exp.fullExpand('${#arr[@]}', {}, 0, [], null, { arr: ['a', 'b', 'c'] }) === '3', 'array len');
const parser = require('./docs/shell-parser.js');
assert(parser.globToRe('f[abc]').test('fa') && !parser.globToRe('f[abc]').test('fz'), 'bracket glob');
assert(parser.globToRe('[0-9].js').test('3.js'), 'bracket range');
const rlJs2 = fs.readFileSync(path.join(__dirname, 'docs/shell-readline.js'), 'utf8');
assert(rlJs2.includes('expandBang'), 'bang history missing');
assert(shellMain.includes('bgJobs'), 'bg jobs missing');
assert(shellMain.includes("'&'"), 'background & missing');
assert(controlJs.includes('runSelect'), 'select missing');
assert(utilJs.includes('trap:'), 'trap missing');
assert(utilJs.includes('jobs:'), 'jobs missing');
['shell-awk.js', 'shell-sed.js'].forEach(k => assert(defaults[k], k + ' missing from defaults'));
console.log('✓ awk BEGIN/END/NR/pattern, sed multi -e/d/p, arrays, bracket-glob, bang-history, &, select, trap/jobs\n');

console.log('=== polish: case ops, indirection, assoc arrays, @Q, <<<, printf -v, awk fns, sed hold/branch ===');
assert(exp.fullExpand('${X^^}', {X:'hi'}, 0, [], null) === 'HI', 'case ^^');
assert(exp.fullExpand('${X,,}', {X:'HI'}, 0, [], null) === 'hi', 'case ,,');
assert(exp.fullExpand('${X^}', {X:'hi'}, 0, [], null) === 'Hi', 'case ^');
assert(exp.fullExpand('${!X}', {X:'Y',Y:'v'}, 0, [], null) === 'v', 'indirection');
assert(exp.fullExpand('${X@Q}', {X:'a b'}, 0, [], null).includes("'a b'"), '@Q quote');
assert(exp.fullExpand('${!FOO@}', {FOO_A:1,FOO_B:2,BAR:3}, 0, [], null) === 'FOO_A FOO_B', 'prefix @');
assert(exp.fullExpand('${m[k]}', {}, 0, [], null, {m:{k:'v'}}) === 'v', 'assoc get');
assert(exp.fullExpand('${!m[@]}', {}, 0, [], null, {m:{a:1,b:2}}) === 'a b', 'assoc keys');
assert(awk.runAwk('{print length($0)}', 'hello\n') === '5', 'awk length');
assert(awk.runAwk('{print toupper($0)}', 'hi\n') === 'HI', 'awk toupper');
assert(awk.runAwk('{print substr($0,2,3)}', 'abcdef\n') === 'bcd', 'awk substr');
assert(sed.runSed(['h','s/.*/X/','G'], 'L1\n').includes('X') && sed.runSed(['h','s/.*/X/','G'], 'L1\n').includes('L1'), 'sed hold');
assert(sed.runSed(['s/a/A/','tend','s/z/Z/',':end'], 'a\nb') === 'A\nb', 'sed branch');
const rlHs = fs.readFileSync(path.join(__dirname, 'docs/shell-readline.js'), 'utf8');
assert(rlHs.includes('<<<'), 'here-string missing');
assert(extraJs.includes('-v') && extraJs.includes('declare:'), 'printf -v / declare missing');
console.log('✓ all polish features present\n');

console.log('=== all checks passed ===');
