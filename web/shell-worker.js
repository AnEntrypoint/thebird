import { Buffer } from './shims/buffer.js';
import { existsSync, flushFs, hydrate, mkdirSync, readdirSync, writeFileSync } from './shims/fs.js';
import { posix } from './shims/path.js';
import { createShell } from './bash-shell.js';
import { onPythonPhase } from './python-in-page.js';
import { clearCancel, setCancelWord } from './txiki-in-page.js';
import { settleTakeover } from './takeover.js';
import { publishWebserver } from './publish-webserver.js';

const WORKSPACE = '/workspace';
const WORKSPACE_PACKAGE = { name: 'workspace', private: true, scripts: { host: 'node host.js' } };
const hostScript = (origin) => `const ORIGIN = ${JSON.stringify(origin)};
const NOT_REACHABLE = 'thebird host not reachable on this origin; the relay (npm start in the thebird repo) starts it';
fetch(ORIGIN + '/__thebird/registry', { method: 'GET' })
  .then((response) => {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  })
  .then((reply) => {
    console.log('thebird host up: ' + reply.servers.length + ' webservers');
  })
  .catch(() => {
    console.log(NOT_REACHABLE);
    tjs.exit(1);
  });
`;
const seedWorkspace = (origin) => {
  if (existsSync(`${WORKSPACE}/package.json`)) return;
  mkdirSync(WORKSPACE, { recursive: true });
  writeFileSync(`${WORKSPACE}/package.json`, `${JSON.stringify(WORKSPACE_PACKAGE, null, 2)}\n`);
  if (!existsSync(`${WORKSPACE}/host.js`)) writeFileSync(`${WORKSPACE}/host.js`, hostScript(origin));
};
const featureReplies = new Map();
let nextFeatureId = 1;
globalThis.THEBIRD_FEATURE_TRANSPORT = (payload) => new Promise((ok, fail) => {
  const id = nextFeatureId++;
  featureReplies.set(id, { ok, fail });
  postMessage({ feature: { id, payload } });
});
const windowFromUrl = (search) => {
  const ms = Number(new URLSearchParams(search).get('commandTimeoutMs'));
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
};
globalThis.Buffer = Buffer;
onPythonPhase((phase, detail) => postMessage({ phase, detail }));

function completions(prefix, cwd) {
  const slash = prefix.lastIndexOf('/');
  const dirPart = slash === -1 ? '' : prefix.slice(0, slash + 1);
  const base = prefix.slice(slash + 1);
  let entries;
  try {
    entries = readdirSync(posix.resolve(cwd, dirPart || '.'), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.name.startsWith(base) && (!entry.name.startsWith('.') || base.startsWith('.')))
    .map((entry) => dirPart + entry.name + (entry.isDirectory() ? '/' : ''))
    .sort();
}

try {
  await hydrate();
  mkdirSync(WORKSPACE, { recursive: true });
  seedWorkspace(self.location.origin);
  const shell = await createShell({ cwd: WORKSPACE, commandTimeoutMs: windowFromUrl(self.location.search) });
  await flushFs();
  postMessage({ ready: true });
  let queue = Promise.resolve();
  let toolShell = null;
  const toolAnswer = async (data) => {
    toolShell ??= await createShell({ cwd: WORKSPACE, commandTimeoutMs: windowFromUrl(self.location.search) });
    const result = await toolShell.run(data.toolRun);
    await flushFs();
    postMessage({ id: data.id, ok: true, result });
  };
  const publishAnswer = async (data) => {
    const result = await publishWebserver(data.publish);
    postMessage({ id: data.id, ok: true, result });
  };
  const answer = async (data) => {
    let reply;
    try {
      if (data.complete !== undefined) {
        const result = data.command ? shell.commands().filter((name) => name.startsWith(data.complete)) : completions(data.complete, shell.cwd());
        reply = { id: data.id, ok: true, result };
      } else if (data.query === 'cwd') {
        reply = { id: data.id, ok: true, result: shell.cwd() };
      } else {
        clearCancel();
        globalThis.THEBIRD_FX = data.fx;
        const result = await shell.run(data.run, { onOutput: (stdout, stderr) => postMessage({ output: stdout + stderr }) });
        reply = { id: data.id, ok: true, result };
      }
    } catch (err) {
      reply = { id: data.id, ok: false, error: err.message };
    }
    await flushFs();
    postMessage(reply);
  };
  self.onmessage = ({ data }) => {
    if (data.init) {
      setCancelWord(data.init.flag ? new Int32Array(data.init.flag) : null);
      return;
    }
    if (data.takeoverDone) {
      settleTakeover(data.takeoverDone);
      return;
    }
    if (data.featureDone) {
      const waiter = featureReplies.get(data.featureDone.id);
      featureReplies.delete(data.featureDone.id);
      if (data.featureDone.ok) waiter?.ok(data.featureDone.result);
      else waiter?.fail(new Error(data.featureDone.error));
      return;
    }
    if (data.cancel) {
      shell.cancel();
      return;
    }
    if (data.resize) {
      shell.resize(data.resize);
      return;
    }
    if (data.toolRun !== undefined) {
      toolAnswer(data).catch((err) => postMessage({ id: data.id, ok: false, error: err.message }));
      return;
    }
    if (data.publish !== undefined) {
      publishAnswer({ id: data.id, publish: data.publish }).catch((err) => postMessage({ id: data.id, ok: false, error: err.message }));
      return;
    }
    if (data.cancelTool) {
      toolShell?.cancel();
      return;
    }
    queue = queue.then(() => answer(data)).catch((err) => postMessage({ id: data.id, ok: false, error: err.message }));
  };
} catch (err) {
  postMessage({ ready: false, error: err.message });
}
