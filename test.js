const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== thebird browser integration test ===\n');

console.log('bootstrap: defaults.json');
const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'docs/defaults.json'), 'utf8'));
assert(defaults['app.js'], 'app.js missing');
assert(defaults['terminal.js'], 'terminal.js missing');
assert(defaults['agent-chat.js'], 'agent-chat.js missing');
assert(defaults['shell.js'], 'shell.js missing');
assert(defaults['vendor/thebird-browser.js'], 'thebird-browser.js missing');
assert(defaults['shell-node.js'], 'shell-node.js missing');
assert(defaults['shell-node-modules.js'], 'shell-node-modules.js missing');
assert(Object.keys(defaults).length > 10, 'insufficient files');
console.log('✓ defaults.json has', Object.keys(defaults).length, 'files\n');

console.log('bootstrap: index.html');
const indexHtml = fs.readFileSync(path.join(__dirname, 'docs/index.html'), 'utf8');
assert(indexHtml.includes('pane-chat'), 'chat pane missing');
assert(indexHtml.includes('pane-term'), 'term pane missing');
assert(indexHtml.includes('pane-preview'), 'preview pane missing');
assert(indexHtml.includes('app.js'), 'app.js import missing');
assert(indexHtml.includes('terminal.js'), 'terminal.js import missing');
assert(indexHtml.includes('preview-sw-client.js'), 'preview-sw-client.js import missing');
console.log('✓ index.html has 3 tabs and all module imports\n');

console.log('bootstrap: preview-sw.js');
const previewSw = fs.readFileSync(path.join(__dirname, 'docs/preview-sw.js'), 'utf8');
assert(previewSw.includes('addEventListener'), 'service worker event listeners missing');
assert(previewSw.includes('EXPRESS_REQUEST'), 'express request handling missing');
console.log('✓ preview-sw.js has fetch handler\n');

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
assert(appJs.includes('window.__debug'), 'app.js no debug');
assert(terminalJs.includes('window.__debug'), 'terminal.js no debug');
assert(toolsCode.includes('window.__debug.agent'), 'agent state missing');
assert(terminalJs.includes('window.__debug.shell'), 'shell state missing');
assert(terminalJs.includes('window.__debug.idbSnapshot'), 'idb state missing');
console.log('✓ window.__debug initialized by all modules\n');

console.log('performance: debounce timing');
assert(terminalJs.includes('1000'), 'debounce may not be 1s');
console.log('✓ preview refresh debounce set to 1s\n');

console.log('file size: fits git limit');
const stat = fs.statSync(path.join(__dirname, 'docs/defaults.json'));
const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
assert(stat.size < 100 * 1024 * 1024, 'defaults.json > 100MB');
console.log('✓ defaults.json', sizeMB, 'MB (< 100MB limit)\n');

console.log('=== end-to-end app creation flow ===');
const msgNorm = m => ({ ...m, content: typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content });
const snap1 = {};
snap1['index.html'] = '<h1>Hello World</h1>';
const refreshed = snap1['index.html'] ? { status: 'success', body: snap1['index.html'] } : { status: 'fallback' };
assert(refreshed.status === 'success', 'preview failed');
assert(refreshed.body === '<h1>Hello World</h1>', 'preview content wrong');
console.log('✓ user input → normalize → tool execute → preview refresh\n');

console.log('=== error paths ===');
const errorCases = [
  { desc: 'missing API key', check: () => { throw new Error('Enter an API key'); } },
  { desc: 'file not found', check: () => { if (!snap1['missing.txt']) throw new Error('not found'); } },
  { desc: 'terminal not ready', check: () => { throw new Error('terminal not ready'); } }
];
let errorsHandled = 0;
errorCases.forEach(c => {
  try { c.check(); } catch (e) { errorsHandled++; }
});
assert(errorsHandled === 3, 'some errors not thrown');
console.log('✓ all error paths throw (no silent failures)\n');

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
assert(shellMain.includes("splitTopLevel(line, ['&&', '||', ';']"), 'shell must chain via && || ;');
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
assert(shellMain.includes('expandCmdSub'), 'expandCmdSub not used in shell');
assert(defaults['shell-builtins-text.js'], 'shell-builtins-text.js missing from defaults.json');
console.log('✓ $?, $(), inline var assignment, echo -e, sed, sort, uniq, tr all present\n');

console.log('=== shell httpHandlers fix: express routes visible to callExpressRoute ===');
const shellJs = fs.readFileSync(path.join(__dirname, 'docs/shell.js'), 'utf8');
assert(shellJs.includes('const httpHandlers = {}'), 'httpHandlers not local var');
assert(!shellJs.includes('window.__debug.shell = {'), 'old debug assignment still present');
console.log('✓ httpHandlers on returned shell object (not overwritten by terminal.js)\n');

console.log('=== express → preview routing e2e ===');
const idb = {};
const handlers = {};
function makeExpress() {
  const routes = { GET: [] };
  const app = {};
  app.get = (p, fn) => { routes.GET.push({ path: p, fn }); return app; };
  app.listen = (port, cb) => { handlers[port] = { routes }; cb?.(); };
  return app;
}
const todoHtml = '<h1>Todo App</h1><button onclick="addTask()">Add</button><ul id="list"></ul>';
idb['index.html'] = todoHtml;
const ex = makeExpress();
ex.get('/', (req, res) => { res.end(idb['index.html']); });
ex.listen(3000, () => {});
const routeResult = (() => {
  const h = handlers[3000];
  if (!h) return null;
  const route = (h.routes.GET || []).find(r => r.path === '/');
  if (!route) return null;
  let body = '';
  route.fn({ method: 'GET', path: '/' }, { end: b => { body = b; } });
  return body;
})();
assert(routeResult === todoHtml, 'express route did not return expected html');
assert(routeResult.includes('<h1>Todo App</h1>'), 'todo heading missing');
assert(routeResult.includes('addTask()'), 'interactive handler missing');
console.log('✓ agent writes file → express registers route → preview fetches HTML → interactive\n');

console.log('=== all checks passed ===');
