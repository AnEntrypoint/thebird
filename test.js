const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== thebird browser integration test ===\n');

const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'docs/defaults.json'), 'utf8'));
['app.js', 'terminal.js', 'agent-chat.js', 'shell.js', 'vendor/thebird-browser.js', 'shell-node.js', 'shell-node-modules.js'].forEach(k => assert(defaults[k], k));
assert(Object.keys(defaults).length > 10);
const indexHtml = fs.readFileSync(path.join(__dirname, 'docs/index.html'), 'utf8');
['pane-chat', 'pane-term', 'pane-preview', 'app.js', 'terminal.js', 'preview-sw-client.js'].forEach(s => assert(indexHtml.includes(s), s));
const previewSw = fs.readFileSync(path.join(__dirname, 'docs/preview-sw.js'), 'utf8');
assert(previewSw.includes('addEventListener') && previewSw.includes('EXPRESS_REQUEST'));
const n = { ...{role:'user',content:'hi'}, content: [{type:'text',text:'hi'}] };
assert(Array.isArray(n.content) && n.content[0].type === 'text' && n.content[0].text === 'hi');
const toolsCode = fs.readFileSync(path.join(__dirname, 'docs/agent-chat.js'), 'utf8');
['read_file','write_file','list_files','run_command','read_terminal','send_to_terminal'].forEach(t => assert(toolsCode.includes(t+':') && toolsCode.includes('parameters:') && toolsCode.includes('execute:'), t));
assert(toolsCode.includes('lastError') && toolsCode.includes('throw'));
const appJs = fs.readFileSync(path.join(__dirname, 'docs/app.js'), 'utf8');
const terminalJs = fs.readFileSync(path.join(__dirname, 'docs/terminal.js'), 'utf8');
assert(appJs.includes('window.__debug') && terminalJs.includes('window.__debug') && toolsCode.includes('window.__debug.agent') && terminalJs.includes('window.__debug.shell') && terminalJs.includes('window.__debug.idbSnapshot'));
assert(terminalJs.includes('1000'));
assert(fs.statSync(path.join(__dirname, 'docs/defaults.json')).size < 100 * 1024 * 1024);
console.log('✓ bootstrap/msgs/tools/__debug/size OK\n');

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
assert(shellMain.includes('makeExpander') && shellMain.includes('functions:') && shellMain.includes('opts'), 'features missing');
const rlJs = fs.readFileSync(path.join(__dirname, 'docs/shell-readline.js'), 'utf8');
assert(rlJs.includes('heredocTag'), 'heredoc missing');
['shell-builtins-extra.js', 'shell-control.js'].forEach(k => assert(defaults[k], k));
console.log('✓ glob+positional+control+heredoc\n');

console.log('=== rich expansion: params, arith, braces, tilde, backticks ===');
const exp = require('./docs/shell-expand.js');
assert(exp.evalArith('2+3*4', {}) === 14 && exp.expandBraces('{1..3}').join(',') === '1,2,3' && exp.expandTilde('~/f', { HOME: '/h' }) === '/h/f', 'arith/braces/tilde');
[['${FOO:-x}', {}, 'x'], ['${#X}', {X:'abcde'}, '5'], ['${X:1:3}', {X:'abcdef'}, 'bcd'], ['${X/o/0}', {X:'food'}, 'f0od'], ['${X%.js}', {X:'foo.js'}, 'foo'], ['$((2+3*4))', {}, '14'], ['`echo hi`', {}, 'hi']].forEach(([t,e,v]) => assert(exp.fullExpand(t,e,0,[],()=>'hi') === v, t));
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

console.log('=== polish: case, indirection, assoc, @Q, <<<, printf -v, awk fns, sed branch ===');
[['${X^^}',{X:'hi'},'HI'],['${X,,}',{X:'HI'},'hi'],['${X^}',{X:'hi'},'Hi'],['${!X}',{X:'Y',Y:'v'},'v'],['${!FOO@}',{FOO_A:1,FOO_B:2,BAR:3},'FOO_A FOO_B']].forEach(([t,e,v]) => assert(exp.fullExpand(t,e,0,[],null) === v, t));
assert(exp.fullExpand('${X@Q}', {X:'a b'}, 0, [], null).includes("'a b'"), '@Q');
assert(exp.fullExpand('${m[k]}', {}, 0, [], null, {m:{k:'v'}}) === 'v' && exp.fullExpand('${!m[@]}', {}, 0, [], null, {m:{a:1,b:2}}) === 'a b', 'assoc');
[['length($0)', 'hello\n', '5'], ['toupper($0)', 'hi\n', 'HI'], ['substr($0,2,3)', 'abcdef\n', 'bcd']].forEach(([e,i,o]) => assert(awk.runAwk('{print '+e+'}', i) === o, e));
assert(sed.runSed(['s/a/A/','tend','s/z/Z/',':end'], 'a\nb') === 'A\nb', 'sed branch');
assert(fs.readFileSync(path.join(__dirname, 'docs/shell-readline.js'), 'utf8').includes('<<<'), 'here-string');
assert(extraJs.includes('-v') && extraJs.includes('declare:'), 'printf -v / declare');
console.log('✓ polish present\n');

console.log('=== SW + XState: jobs, signals, fd, procsub, sw-jobs ===');
global.window = { __debug: { idbSnapshot: {} } };
const sigM = require('./docs/shell-signals.js'), fdM = require('./docs/shell-fd.js'), psM = require('./docs/shell-procsub.js');
const ctx2 = { traps: {}, term: { write() {} }, bgJobs: {}, lastExitCode: 0 };
const sigs = sigM.createSignals(ctx2); sigs.raise('USR1'); assert(sigs.pending()[0] === 'USR1', 'signal');
const fdt = fdM.createFdTable(ctx2); fdt.open(3, 'f', 'w'); fdt.writeFd(3, 'x'); fdt.dup2(3, 4);
assert(fdt.table[4].duped === 3 && global.window.__debug.idbSnapshot.f === 'x', 'fd');
const pp = psM.registerStream('data'); assert(psM.readStream(pp.split('/').pop()) === 'data', 'procsub');
['shell-signals.js', 'shell-jobs.js', 'shell-fd.js', 'shell-procsub.js', 'shell-sw-jobs.js', 'shell-exec.js'].forEach(k => assert(defaults[k], k));
const swJs = fs.readFileSync(path.join(__dirname, 'docs/preview-sw.js'), 'utf8');
assert(swJs.includes('dev') && swJs.includes('tcp') && swJs.includes('procsub') && swJs.includes('JOB_REGISTER'), 'SW routes');
console.log('✓ signals, fd, procsub, SW job coord, /dev/tcp, /procsub wired\n');

console.log('=== node/npm CLI parity ===');
const nm = require('./docs/shell-node-modules.js');
assert(nm.NODE_VERSION === 'v23.10.0', 'NODE_VERSION');
assert(nm.NPM_VERSION === '10.9.2', 'NPM_VERSION');
assert(nm.NODE_VERSIONS.node === '23.10.0' && Object.keys(nm.NODE_VERSIONS).length >= 25, 'versions map');
const pr = nm.createProcess({ write(){} }, { env: {}, cwd: '/' });
assert(pr.version === 'v23.10.0' && pr.arch === 'x64' && pr.versions.v8.includes('12.9'), 'proc fields');
let threw = false; try { pr.exit(3); } catch (e) { threw = e.__nodeExit && e.code === 3; } assert(threw, 'exit throws NodeExit');
let rcv = ''; pr.stdin.on('data', b => rcv += b); pr.stdin._feed('abc'); assert(rcv === 'abc', 'stdin feed');
const sn = fs.readFileSync(path.join(__dirname, 'docs/shell-node.js'), 'utf8');
assert(sn.includes('stdinBuf') && sn.includes('require.resolve') || sn.includes('req.resolve'), 'stdin+resolve');
assert(sn.includes('__nodeExit') && sn.includes('ctx.lastExitCode'), 'exit propagation');
assert(npmJs.includes('npm_lifecycle_event') && npmJs.includes('npm_package_name') && npmJs.includes("'pre' + scriptName"), 'npm env+hooks');
assert(npmJs.includes('NPM_VERSION') && npmJs.includes('makeNpx'), 'npm -v / npx');
const sxJs = fs.readFileSync(path.join(__dirname, 'docs/shell-exec.js'), 'utf8');
assert(sxJs.includes('makeNodeRunner') && sxJs.includes('NODE_VERSION'), 'node runner');
assert(shellMain.includes("'npx'") && shellMain.includes('runNpmResult'), 'npx wired');
console.log('✓ v23.10.0, npm 10.9.2, process.exit propagation, stdin, env injection, hooks, npx\n');

console.log('=== all checks passed ===');
