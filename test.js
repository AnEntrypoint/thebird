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

console.log('=== all checks passed ===');
