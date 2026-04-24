const GH_TOKEN_KEY = 'thebird_github_token';
const GH_USER_KEY = 'thebird_github_user';

export function getGithubToken() { return localStorage.getItem(GH_TOKEN_KEY); }
export function getGithubUser() { return localStorage.getItem(GH_USER_KEY); }
export function setGithubToken(token, user) { localStorage.setItem(GH_TOKEN_KEY, token); if (user) localStorage.setItem(GH_USER_KEY, user); }
export function clearGithubToken() { localStorage.removeItem(GH_TOKEN_KEY); localStorage.removeItem(GH_USER_KEY); }

export async function githubDeviceFlow(clientId, scope = 'repo') {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope }),
  });
  if (!res.ok) throw new Error('device code failed: ' + res.status);
  return res.json();
}

export async function pollGithubToken(clientId, device_code, interval = 5, maxWait = 300) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < maxWait) {
    await new Promise(r => setTimeout(r, interval * 1000));
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    const data = await res.json();
    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { interval = (data.interval || interval) + 5; continue; }
    throw new Error(data.error_description || data.error || 'token poll failed');
  }
  throw new Error('device flow timed out');
}

export function makeIdbFs() {
  const snap = () => window.__debug?.idbSnapshot || {};
  const persist = () => window.__debug?.idbPersist?.();
  const norm = p => p.replace(/^\//, '');
  return {
    readFileSync(p, opts) {
      const d = snap()[norm(p)];
      if (d == null) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
      if (typeof opts === 'string' ? opts : opts?.encoding) return typeof d === 'string' ? d : new TextDecoder().decode(d);
      return typeof d === 'string' ? new TextEncoder().encode(d) : d;
    },
    writeFileSync(p, data) { snap()[norm(p)] = data; persist(); },
    unlinkSync(p) { delete snap()[norm(p)]; persist(); },
    readdirSync(p) {
      const prefix = norm(p); const pSlash = prefix ? prefix + '/' : '';
      const entries = new Set();
      for (const k of Object.keys(snap())) { if (!k.startsWith(pSlash)) continue; const part = k.slice(pSlash.length).split('/')[0]; if (part) entries.add(part); }
      return [...entries];
    },
    mkdirSync() {},
    existsSync(p) { const k = norm(p); return k in snap() || Object.keys(snap()).some(x => x.startsWith(k + '/')); },
    statSync(p) {
      const k = norm(p); const d = snap()[k];
      if (d != null) return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: typeof d === 'string' ? d.length : (d.byteLength || d.length || 0), mtimeMs: Date.now(), mode: 0o100644 };
      if (Object.keys(snap()).some(x => x.startsWith(k + '/'))) return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, size: 0, mtimeMs: Date.now(), mode: 0o040755 };
      const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e;
    },
    lstatSync(p) { return this.statSync(p); },
    rmSync(p) { const k = norm(p); for (const key of Object.keys(snap())) { if (key === k || key.startsWith(k + '/')) delete snap()[key]; } persist(); },
    symlinkSync() {},
    readlinkSync(p) { return p; },
  };
}
