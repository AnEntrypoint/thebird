import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const hostScript = join(root, 'bin', 'thebird-web-host.js');
const chrome = process.env.CHROME_BIN ?? '/data/cache/bin/chromium';
const host = '127.0.0.1';
const port = Number(process.env.THEBIRD_HOST_CHECK_PORT ?? 4173);
const siteRoot = join(root, '_site');
const base = `http://${host}:${port}`;
const pin = JSON.parse(readFileSync(join(root, 'scripts', 'txiki', 'pin.json'), 'utf8')).tjsWasmSha256;
let checks = 0;
let failures = 0;

const check = (name, ok, value) => {
  checks++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${value === undefined ? '' : `: ${value}`}`);
  if (!ok) failures++;
};

const command = (script, args) => new Promise((ok) => {
  const child = spawn(process.execPath, [join(root, script), ...args], { cwd: root, env: { ...process.env, CHROME_BIN: chrome }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  child.on('exit', (code) => ok({ code, output: output.trim() }));
});

const cli = (args) => command('bin/thebird-web-host.js', args);

const build = await command('scripts/build-pages.mjs', []);
check('site build exits 0', build.code === 0, build.code);
const featurePaths = ['features.js', 'features-bridge.js', 'features-in-txiki.js', 'features-program.js', 'features.json'].map((name) => join(siteRoot, 'web', name));
check('built site has feature modules and manifest', featurePaths.every((path) => existsSync(path)), featurePaths.filter((path) => !existsSync(path)).join(', ') || '5 files');
const bundle = readFileSync(join(siteRoot, 'web', 'terminal.bundle.js'), 'utf8');
check('built bundle wires the feature bridge', bundle.includes('THEBIRD_FEATURE_READY') && bundle.includes('runFeatureProgram'), 'bridge + txiki runner');
const wasmHash = createHash('sha256').update(readFileSync(join(siteRoot, 'web', 'vendor', 'txiki', 'tjs.wasm'))).digest('hex');
check('txiki wasm matches pinned sha256', wasmHash === pin, `${wasmHash.slice(0, 12)} / ${pin.slice(0, 12)}`);

const chromium = async (url) => {
  const result = await command('scripts/dump-dom-ready.mjs', [url]);
  return { code: result.code, stdout: result.output, stderr: result.output, attempts: 1 };
};

const started = await cli(['start', '--host', host, '--port', String(port), '--root', siteRoot]);
check('canonical host start exits 0', started.code === 0, started.code);
check('canonical host prints URL', started.output.includes(`${base}/`), started.output.split('\n').find((line) => line.includes('http')) ?? '');
check('canonical host prints isolation mode', started.output.includes('isolation: coop-coep'), 'coop-coep');
try {
  const status = await cli(['status', '--host', host, '--port', String(port), '--root', siteRoot]);
  check('canonical host status reports running', status.code === 0 && /pid \d+/.test(status.output), status.output);

  const http = async (path) => {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) });
    return { status: response.status, type: response.headers.get('content-type') ?? '', coop: response.headers.get('cross-origin-opener-policy') ?? '', coep: response.headers.get('cross-origin-embedder-policy') ?? '', body: await response.text() };
  };
  const rootPage = await http('/');
  check('GET / returns HTTP 200', rootPage.status === 200, rootPage.status);
  check('GET / content type is text/html', rootPage.type.startsWith('text/html'), rootPage.type);
  check('GET / sends COOP same-origin', rootPage.coop === 'same-origin', rootPage.coop);
  check('GET / sends COEP require-corp', rootPage.coep === 'require-corp', rootPage.coep);
  const wasm = await http('/web/vendor/txiki/tjs.wasm');
  check('GET tjs.wasm returns HTTP 200', wasm.status === 200, wasm.status);
  check('GET tjs.wasm content type is application/wasm', wasm.type === 'application/wasm', wasm.type);
  const manifest = await http('/web/features.json');
  check('GET features.json returns HTTP 200', manifest.status === 200, manifest.status);
  check('GET features.json content type is application/json', manifest.type.startsWith('application/json'), manifest.type);
  check('feature manifest names THEBIRD_FEATURES', manifest.body.includes('THEBIRD_FEATURES'), 'THEBIRD_FEATURES');

  const testId = 'check-site-' + process.pid;
  const wsCli = (args) => command('bin/thebird-webserver.js', args);
  const registered = await wsCli(['register', testId, '--title', 'Check Site']);
  check('CLI register exits 0', registered.code === 0, registered.code);
  try {
  const registryFile = JSON.parse(readFileSync(join(root, '.thebird', 'webservers.json'), 'utf8'));
  check('persistent registry contains test server', registryFile.servers.some((entry) => entry.id === testId), testId);
  const scaffold = await wsCli(['scaffold-check', testId]);
  check('registered server scaffold is complete', scaffold.output.includes('"ok":true'), scaffold.output);
  const sdkPaths = ['sdk/node/index.js', 'sdk/browser/index.js'].map((path) => join(root, path));
  check('shared SDK files exist', sdkPaths.every((path) => existsSync(path)), '2 SDK modules');
  const registryApi = await http('/__thebird/registry');
  check('GET live registry returns HTTP 200', registryApi.status === 200, registryApi.status);
  check('live registry names test server', registryApi.body.includes(testId), testId);
  check('live registry includes user-wide prompt', registryApi.body.includes('Use npm, bash and normal Node files'), 'user-wide prompt');
  const sitePage = await http('/sites/' + testId + '/');
  check('GET registered site page returns HTTP 200', sitePage.status === 200, sitePage.status);
  const siteIcon = await http('/sites/' + testId + '/favicon.ico');
  check('GET registered favicon returns HTTP 200', siteIcon.status === 200, siteIcon.status);
  const settings = await http('/sites/' + testId + '/settings');
  check('GET settings form returns HTTP 200', settings.status === 200, settings.status);
  check('settings form JSON has fields and submit API', settings.body.includes('"fields"') && settings.body.includes('/settings'), 'fields + POST /settings');
  const submitted = await (await fetch(base + '/sites/' + testId + '/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Live Title' }) })).json();
  check('POST settings saves live JSON', submitted.ok === true && submitted.settings.title === 'Live Title', submitted.settings?.title ?? 'missing');
  const descriptor = await http('/sites/' + testId + '/mcp');
  check('GET MCP descriptor returns HTTP 200', descriptor.status === 200, descriptor.status);
  check('MCP descriptor has tools/resources/prompts', ['"tools"','"resources"','"prompts"'].every((token) => descriptor.body.includes(token)), 'tools/resources/prompts');
  const mcpCall = await (await fetch(base + '/__thebird/mcp/' + testId, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'ping' }) })).json();
  check('MCP proxy calls method live', mcpCall.ok === true && mcpCall.result === 'pong', mcpCall.result ?? 'missing');
  const progress = await (await fetch(base + '/__thebird/progress', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: testId, text: 'Rolling out feature', status: 'working' }) })).json();
  check('progress API accepts live rollout status', progress.ok === true, progress.ok ?? 'missing');
  const afterRegistry = await http('/__thebird/registry');
  check('live registry updates without restart', afterRegistry.body.includes(testId), 'registered via API');
  const craftCli = (args) => command('bin/thebird-craft.js', args);
  const craftEnsure = await craftCli(['ensure']);
  check('craft CLI ensure exits 0', craftEnsure.code === 0, craftEnsure.code);
  const craftProcessesBoot = await http('/__thebird/craft/processes');
  check('lazy craft processes absent at boot', craftProcessesBoot.body.includes('"processes":[]') && craftProcessesBoot.body.includes('"lazy":true'), craftProcessesBoot.body.slice(0, 80));
  const craftRegistry = await http('/__thebird/craft');
  check('lazy craft registry is live', craftRegistry.status === 200 && ['gridcraft','wordcraft','pdfcraft'].every((id) => craftRegistry.body.includes(id)), 'gridcraft/wordcraft/pdfcraft');
  const samples = await (await fetch(base + '/__thebird/craft/samples', { method: 'POST' })).json();
  check('craft sample documents generated', samples.ok === true && Object.values(samples.samples).filter((value) => typeof value === 'string').length >= 3, 'sheet/doc/pdf samples');
  for (const [intent, app] of [['review sheet.xlsx','gridcraft'],['edit document.docx','wordcraft'],['render report.pdf','pdfcraft']]) {
    const routed = await (await fetch(base + '/__thebird/craft/intent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: intent }) })).json();
    check('MCP intent routes ' + intent, routed.app === app, routed.app ?? 'missing');
    const descriptor = await http('/__thebird/mcp/' + app);
    check(app + ' lazy MCP descriptor is live', descriptor.status === 200 && descriptor.body.includes('lazy') && descriptor.body.includes('tools'), descriptor.status);
    const call = await (await fetch(base + '/__thebird/mcp/' + app, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: app + '.info', params: {} }) })).json();
    check(app + ' MCP call activates native CLI lazily', call.ok === true && call.result?.pid > 0, 'pid ' + (call.result?.pid ?? 'missing'));
  }
  const craftAfter = await http('/__thebird/craft/processes');
  check('native craft processes exit after lazy calls', craftAfter.body.includes('"processes":[]'), craftAfter.body.slice(0, 80));
  const craftTask = await (await fetch(base + '/__thebird/craft/task', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'show sample.csv', file: 'sample.csv', method: 'gridcraft.cat' }) })).json();
  check('craft task returns document output', craftTask.ok === true && craftTask.result?.stdout?.includes('alpha'), (craftTask.result?.stdout ?? '').split('\n')[0] ?? 'missing');
  check('craft progress/HMR event is live', craftTask.ok === true, 'document SSE event');

  const dom = await chromium(`${base}/?featureProgram=1&hostCheck=${Date.now()}`);
  check('Chromium headless exits 0', dom.code === 0, dom.code);
  check('browser title is thebird terminal', dom.stdout.includes('<title>thebird</title>'), dom.stdout.match(/<title>[^<]*<\/title>/)?.[0] ?? 'missing');
  check('terminal engine is ready', dom.stdout.includes('data-engine="ready"'), 'data-engine="ready"');
  check('fx-programmed feature card is visible', dom.stdout.includes('data-feature-id="fx-visible-demo"') && dom.stdout.includes('fx-programmed feature'), 'fx-visible-demo');
  check('txiki-programmed feature card is visible', dom.stdout.includes('data-feature-id="txiki-visible-demo"') && dom.stdout.includes('txiki.js programmed card'), 'txiki-visible-demo');
  check('feature program reports ready', dom.stdout.includes('data-feature-program="ready"'), 'data-feature-program="ready"');
  check('feature mount has four cards', dom.stdout.includes('data-feature-count="4"'), 'data-feature-count="4"');
  check('user-wide webserver prompt is visible', dom.stdout.includes('data-feature-id="agent-webserver-prompt"'), 'agent-webserver-prompt');
  check('desktop shell is present', dom.stdout.includes('id="webserver-shell"') && dom.stdout.includes('data-shell="webservers"'), 'data-shell="webservers"');
  check('browser shell lists live registered server', dom.stdout.includes('data-webserver-id="' + testId + '"'), testId);
  check('phone shell layout marker is present', dom.stdout.includes('data-layout="phone"') || dom.stdout.includes('max-width: 700px'), 'responsive shell');
  check('document workspace is visible', dom.stdout.includes('data-workspace="documents"') && dom.stdout.includes('craft-workspace-prompt'), 'craft workspace');
  check('live HMR status is visible', dom.stdout.includes('data-hmr="live"') || dom.stdout.includes('data-webserver-hmr="ready"'), 'live HMR');
  if (dom.code !== 0) console.log(dom.stderr.slice(-1200));
  const unregistered = await wsCli(['unregister', testId]);
  check('CLI unregister exits 0', unregistered.code === 0, unregistered.code);
  const removedRegistry = await http('/__thebird/registry');
  check('live registry removes server without restart', !removedRegistry.body.includes(testId), 'removed ' + testId);
  } finally {
    await wsCli(['unregister', testId, '--remove-folder']);
  }
} finally {
  const stopped = await cli(['stop', '--host', host, '--port', String(port), '--root', siteRoot]);
  check('canonical host stop exits 0', stopped.code === 0, stopped.code);
  check('canonical host stop reports managed PID', /stopped web host pid \d+|no managed web host is running/.test(stopped.output), stopped.output);
  const after = await cli(['status', '--host', host, '--port', String(port), '--root', siteRoot]);
  check('canonical host status reports stopped', after.code === 1 && after.output === 'stopped', after.output);
}

console.log(`RESULT PASS=${checks - failures} FAIL=${failures}`);
process.exitCode = failures ? 1 : 0;
