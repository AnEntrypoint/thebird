// shell-sw-jobs.js and its siblings across the shell-* family are kept
// bespoke rather than replaced with a maintained library. Per-file reasoning
// (net-grow rejected for all): shell-sw-jobs (this file) wraps
// navigator.serviceWorker.controller.postMessage/MessageChannel directly --
// no library abstracts that browser-native primitive. shell-node-busnet,
// shell-node-ipc/cluster/procfs/inspector/profiler/observe/registry shim
// Node APIs that have no browser equivalent to delegate to; a library would
// have to reimplement the same shim, not replace it. shell-npm/pm/pm-layout/
// dlx implement thebird's own in-browser package-manager semantics (no
// existing library targets "npm install running entirely client-side over
// IndexedDB"). shell-parser/expand/control: mvdan-sh compiled to WASM is
// ~1MB, larger than the bespoke POSIX-subset parser it would replace --
// measured net-grow, rejected. shell-fd/shell-jobs/shell-signals/
// shell-procsub implement thebird's own virtual process-table/job-control
// model; no JS library targets an in-browser POSIX process abstraction.
import { shortUid } from './vendor/uid.js';

export function createSwJobs() {
  const registry = new Map();

  async function postSw(msg) {
    if (!navigator.serviceWorker?.controller) return null;
    const chan = new MessageChannel();
    const p = new Promise(res => { chan.port1.onmessage = e => res(e.data); setTimeout(() => res(null), 2000); });
    navigator.serviceWorker.controller.postMessage(msg, [chan.port2]);
    return p;
  }

  return {
    async register(id, cmd) {
      registry.set(id, { cmd, startedAt: Date.now() });
      await postSw({ op: 'job-register', args: { id, cmd, tabId: getTabId() } });
    },
    async unregister(id) {
      registry.delete(id);
      await postSw({ op: 'job-unregister', args: { id, tabId: getTabId() } });
    },
    async list() {
      const r = await postSw({ op: 'job-list' });
      return r?.jobs || [...registry.entries()].map(([id, j]) => ({ id, ...j, tabId: getTabId() }));
    },
    local: () => [...registry.entries()].map(([id, j]) => ({ id, ...j })),
  };
}

let _tabId = null;
function getTabId() {
  if (_tabId) return _tabId;
  try { _tabId = sessionStorage.getItem('thebird_tab') || String(Date.now()) + shortUid(4); sessionStorage.setItem('thebird_tab', _tabId); } catch { _tabId = 'main'; }
  return _tabId;
}

export function makeNohupBuiltin(ctx) {
  return async args => {
    if (!args.length) return;
    ctx.term.write('nohup: ignoring HUP\r\n');
    const cmd = args.join(' ');
    if (ctx.jobRegistry) ctx.jobRegistry.spawnJob(cmd, ctx.runPipeline);
  };
}

export function makeNetcatStub(ctx) {
  return async (args, _a, stdin) => {
    const host = args.find(a => !a.startsWith('-'));
    const idx = host != null ? args.indexOf(host) : -1;
    if (idx < 0 || idx + 1 >= args.length) throw new Error('nc: usage: nc HOST PORT');
    const portArg = args[idx + 1];
    const url = 'http://' + host + ':' + portArg;
    try {
      const r = await fetch(url, { method: stdin ? 'POST' : 'GET', body: stdin || undefined });
      const text = await r.text();
      ctx.term.write(text.replace(/\n/g, '\r\n') + '\r\n');
    } catch (e) {
      ctx.term.write('\x1b[31mnc: ' + e.message + '\x1b[0m\r\n');
      ctx.lastExitCode = 1;
    }
  };
}

export function makeCurlBuiltin(ctx) {
  return async (args, _a, stdin) => {
    // -H/--header flags are consumed (with their value tokens) BEFORE the url
    // is picked, so a header value containing '://' can never be mistaken for
    // the url. Multiple -H flags accumulate into one plain headers object,
    // which flows through ctx.fetchAudit's init untouched (docs/audit.js's
    // auditedFetch passes init through to native fetch, and maskHeaders reads
    // it for the net.request audit entry).
    const headers = {};
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      let line = null;
      if (a === '-H' || a === '--header') { line = args[++i]; if (line == null) throw new Error('curl: option ' + a + ': missing value'); }
      else if (a.startsWith('--header=')) line = a.slice('--header='.length);
      else { rest.push(a); continue; }
      const colon = line.indexOf(':');
      if (colon < 0) throw new Error('curl: invalid header line: ' + line);
      headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    const url = rest.find(a => !a.startsWith('-') && (a.includes('://') || a.startsWith('/dev/tcp/')));
    if (!url) throw new Error('curl: missing url');
    let fetchUrl = url;
    const tcpM = url.match(/^\/dev\/tcp\/([^/]+)\/(\d+)(\/.*)?$/);
    if (tcpM) fetchUrl = 'http://' + tcpM[1] + ':' + tcpM[2] + (tcpM[3] || '/');
    const method = rest.includes('-X') ? rest[rest.indexOf('-X') + 1] : (rest.includes('-d') || stdin ? 'POST' : 'GET');
    const body = rest.includes('-d') ? rest[rest.indexOf('-d') + 1] : stdin;
    // Proof-of-integration site for docs/audit.js's installFetchAudit: curl
    // is thebird's one real outbound-network shell builtin, so its fetch call
    // (and only its call, not a global window.fetch patch) is audited.
    // ctx.fetchAudit is set up once in shell.js's createShell when a real
    // auditLog exists; falls back to plain fetch otherwise (e.g. ad-hoc/test
    // shell instantiations with no fs/auditLog).
    const doFetch = ctx.fetchAudit || fetch;
    try {
      const init = { method, body };
      if (Object.keys(headers).length) init.headers = headers;
      const r = await doFetch(fetchUrl, init);
      ctx.term.write((await r.text()).replace(/\n/g, '\r\n'));
    } catch (e) { ctx.term.write('\x1b[31mcurl: ' + e.message + '\x1b[0m\r\n'); ctx.lastExitCode = 1; }
  };
}
