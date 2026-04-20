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
      await postSw({ type: 'JOB_REGISTER', id, cmd, tabId: getTabId() });
    },
    async unregister(id) {
      registry.delete(id);
      await postSw({ type: 'JOB_UNREGISTER', id, tabId: getTabId() });
    },
    async list() {
      const r = await postSw({ type: 'JOB_LIST' });
      return r?.jobs || [...registry.entries()].map(([id, j]) => ({ id, ...j, tabId: getTabId() }));
    },
    local: () => [...registry.entries()].map(([id, j]) => ({ id, ...j })),
  };
}

let _tabId = null;
function getTabId() {
  if (_tabId) return _tabId;
  try { _tabId = sessionStorage.getItem('thebird_tab') || String(Date.now()) + Math.random().toString(36).slice(2, 6); sessionStorage.setItem('thebird_tab', _tabId); } catch { _tabId = 'main'; }
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
    const portArg = args[args.indexOf(host) + 1];
    if (!host || !portArg) throw new Error('nc: usage: nc HOST PORT');
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
    const url = args.find(a => !a.startsWith('-') && (a.includes('://') || a.startsWith('/dev/tcp/')));
    if (!url) throw new Error('curl: missing url');
    let fetchUrl = url;
    const tcpM = url.match(/^\/dev\/tcp\/([^/]+)\/(\d+)(\/.*)?$/);
    if (tcpM) fetchUrl = 'http://' + tcpM[1] + ':' + tcpM[2] + (tcpM[3] || '/');
    const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : (args.includes('-d') || stdin ? 'POST' : 'GET');
    const body = args.includes('-d') ? args[args.indexOf('-d') + 1] : stdin;
    try {
      const r = await fetch(fetchUrl, { method, body });
      ctx.term.write((await r.text()).replace(/\n/g, '\r\n'));
    } catch (e) { ctx.term.write('\x1b[31mcurl: ' + e.message + '\x1b[0m\r\n'); ctx.lastExitCode = 1; }
  };
}
