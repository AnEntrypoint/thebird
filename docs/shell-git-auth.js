const GH_TOKEN_KEY = 'thebird_github_token';
const GH_USER_KEY = 'thebird_github_user';

export function getGithubToken() { return sessionStorage.getItem(GH_TOKEN_KEY); }
export function getGithubUser() { return sessionStorage.getItem(GH_USER_KEY); }
export function setGithubToken(token, user) { sessionStorage.setItem(GH_TOKEN_KEY, token); if (user) sessionStorage.setItem(GH_USER_KEY, user); }
export function clearGithubToken() { sessionStorage.removeItem(GH_TOKEN_KEY); sessionStorage.removeItem(GH_USER_KEY); }

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

// Accepts a full https URL (with or without .git), a bare owner/repo
// shorthand, or a git@github.com:owner/repo.git SSH-style URL.
export function parseRepoUrl(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('parseRepoUrl: empty input');
  const stripGit = repo => repo.replace(/\.git$/, '');
  let m = s.match(/^git@[^:]+:([^/]+)\/(.+)$/);
  if (m) return { owner: m[1], repo: stripGit(m[2]) };
  m = s.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)\/?$/);
  if (m) return { owner: m[1], repo: stripGit(m[2]) };
  m = s.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (m) return { owner: m[1], repo: stripGit(m[2]) };
  throw new Error('parseRepoUrl: unparseable repo reference: ' + s);
}

// Calls the GitHub REST API to check whether {owner}/{repo} exists, is
// private, and whether the current token (if any) can push to it.
export async function checkRepoVisibility(owner, repo, token) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'thebird' };
  if (token) headers.Authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch('https://api.github.com/repos/' + owner + '/' + repo, { headers });
  } catch (e) {
    return { exists: false, private: null, canPush: false, error: 'network_error' };
  }
  if (res.status === 404) return { exists: false, private: null, canPush: false, error: 'not_found' };
  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    return { exists: false, private: null, canPush: false, error: remaining === '0' ? 'rate_limited' : 'forbidden' };
  }
  if (!res.ok) return { exists: false, private: null, canPush: false, error: 'http_' + res.status };
  const data = await res.json();
  return { exists: true, private: !!data.private, canPush: !!(data.permissions && data.permissions.push) };
}

// Atomic multi-file push via the GitHub Git Data API: blob(s) -> tree ->
// commit -> ref update. `files` is [{path, content}] with content as a
// string. Returns { sha: newCommitSha } on success.
export async function atomicPushViaGitDataApi(owner, repo, token, branch, files) {
  if (!token) throw new Error('atomicPushViaGitDataApi: token required');
  const base = 'https://api.github.com/repos/' + owner + '/' + repo;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'thebird',
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
  };
  const call = async (path, opts) => {
    const res = await fetch(base + path, { headers, ...opts });
    if (!res.ok) {
      let body = '';
      try { body = JSON.stringify(await res.json()); } catch { /* swallow: error response body may not be JSON; report the failure without the extra detail rather than throwing here */ }
      throw new Error('atomicPushViaGitDataApi: ' + (opts?.method || 'GET') + ' ' + path + ' failed: ' + res.status + ' ' + body);
    }
    return res.json();
  };

  // 1. Current branch ref -> commit -> tree sha (sequential, each depends on the prior).
  const refData = await call('/git/refs/heads/' + branch);
  const parentSha = refData.object.sha;
  const parentCommit = await call('/git/commits/' + parentSha);
  const baseTreeSha = parentCommit.tree.sha;

  // 2. Blob POSTs are independent -> parallel.
  const blobs = await Promise.all(files.map(f =>
    call('/git/blobs', { method: 'POST', body: JSON.stringify({ content: f.content, encoding: f.encoding || 'utf-8' }) })
      .then(b => ({ path: f.path, sha: b.sha }))
  ));

  // 3. Tree, commit, ref-update are strictly sequential.
  const tree = await call('/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: blobs.map(b => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
    }),
  });
  const commit = await call('/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message: 'atomic push via Git Data API', tree: tree.sha, parents: [parentSha] }),
  });
  await call('/git/refs/heads/' + branch, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });

  return { sha: commit.sha };
}

// Fallback path for when smart-HTTP clone (isomorphic-git over fetch) is
// CORS-blocked: enumerate the repo tree via the GitHub REST API and fetch
// each blob's content individually. Concurrency-capped at 10 simultaneous
// blob requests; any tree entry whose reported `size` exceeds 1MB is
// skipped without ever requesting its content.
const BLOB_FETCH_CONCURRENCY = 10;
const BLOB_MAX_SIZE = 1024 * 1024; // 1MB

export async function fetchRepoBlobsBatched(owner, repo, token, ref, opts = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'thebird' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const concurrency = opts.concurrency || BLOB_FETCH_CONCURRENCY;
  const maxSize = opts.maxSize || BLOB_MAX_SIZE;

  const treeRes = await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/git/trees/' + encodeURIComponent(ref) + '?recursive=1', { headers });
  if (!treeRes.ok) throw new Error('fetchRepoBlobsBatched: tree fetch failed: ' + treeRes.status);
  const treeData = await treeRes.json();
  if (treeData.truncated) console.warn('fetchRepoBlobsBatched: tree listing truncated by GitHub API; some files may be missing');
  const entries = (treeData.tree || []).filter(e => e.type === 'blob');

  const files = new Array(entries.length);
  let skippedCount = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < entries.length) {
      const idx = cursor++;
      const entry = entries[idx];
      if (typeof entry.size === 'number' && entry.size > maxSize) {
        files[idx] = { path: entry.path, skipped: true };
        skippedCount++;
        continue;
      }
      try {
        const blobRes = await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/git/blobs/' + entry.sha, { headers });
        if (!blobRes.ok) throw new Error('blob fetch failed: ' + blobRes.status);
        const blobData = await blobRes.json();
        const b64 = (blobData.content || '').replace(/\n/g, '');
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const content = new TextDecoder('utf-8').decode(bytes);
        files[idx] = { path: entry.path, content, skipped: false };
      } catch (e) {
        files[idx] = { path: entry.path, skipped: true };
        skippedCount++;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, () => worker());
  await Promise.all(workers);

  return { files, skippedCount };
}

export function makeIdbFs() {
  const _fallback = {};
  const store = window.__debug?.idbSnapshot || _fallback;
  // Every write (writeFileSync/unlinkSync/rmSync) stays synchronous per the
  // isomorphic-git FileSystem contract and fires persist() without awaiting
  // it -- but each persist() is chained after whatever the PREVIOUS persist()
  // call returned, so persists resolve in the same order they were issued
  // instead of racing (a slow early write's persist landing after a later
  // rmSync's persist would otherwise resurrect deleted files on next boot --
  // real persist() writes a full snapshot, so whichever one lands LAST wins
  // regardless of issue order without this chain). `flushPersist()` (below)
  // awaits this chain so a caller doing failure cleanup can be sure its
  // deletion is durable before reporting done or letting the page reload.
  let lastPersist = Promise.resolve();
  const persist = () => {
    lastPersist = lastPersist.then(() => {
      const p = window.__debug?.idbPersist?.();
      return p && typeof p.catch === 'function' ? p.catch(err => console.error('git: persist failed:', err)) : undefined;
    });
    return lastPersist;
  };
  // Strip the leading slash, then collapse a trailing "/." (isomorphic-git's
  // workdir walker lstats the repo root itself as `${dir}/.`) and any
  // trailing slash, so root-directory lookups land on the same '' / dir-root
  // key that readdirSync/existsSync already treat as "exists" instead of
  // missing every prefix match and throwing ENOENT on a directory that
  // plainly exists (it's the working directory the git command is running
  // in). Without this, isomorphic-git's own workdir-tree walker (`Ti` in
  // vendor/esm/isomorphic-git.mjs) lstats `<dir>/.` on its very first step
  // and gets ENOENT for a perfectly real, existing directory.
  const norm = p => p.replace(/^\/+/, '').replace(/\/\.$/, '').replace(/\/+$/, '');
  const mtimes = {};
  // Binary-envelope contract: the snapshot is string-valued end to end (OPFS
  // saveAll writes String(value), the IDB fallback JSON.stringifies it), so a
  // raw Buffer/Uint8Array stored here (isomorphic-git's .git/index,
  // .git/objects/*) silently mangled on persist -- String(uint8) becomes the
  // decimal CSV '68,73,82,67,...' and the next page load hands it back to
  // isomorphic-git as garbage ('Invalid dircache magic file number').
  // Non-string writes are therefore stored as a NUL-sentinelled base64
  // envelope string and decoded on read; plain-text writes (HEAD, refs,
  // config -- isomorphic-git writes those as strings already) pass through
  // untouched, and no real text file can start with \u0000.
  const B64_PREFIX = '\u0000B64:';
  const bytesToB64 = (bytes) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const b64ToBytes = (b64) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  return {
    readFileSync(p, opts) {
      let d = store[norm(p)];
      if (d == null) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
      if (typeof d === 'string' && d.startsWith(B64_PREFIX)) d = b64ToBytes(d.slice(B64_PREFIX.length));
      if (typeof opts === 'string' ? opts : opts?.encoding) return typeof d === 'string' ? d : new TextDecoder().decode(d);
      return typeof d === 'string' ? new TextEncoder().encode(d) : d;
    },
    writeFileSync(p, data) { const k = norm(p); store[k] = typeof data === 'string' ? data : B64_PREFIX + bytesToB64(data instanceof Uint8Array ? data : new Uint8Array(data)); mtimes[k] = Date.now(); persist(); },
    unlinkSync(p) { const k = norm(p); delete store[k]; delete mtimes[k]; persist(); },
    readdirSync(p) {
      const prefix = norm(p); const pSlash = prefix ? prefix + '/' : '';
      const entries = new Set();
      for (const k of Object.keys(store)) { if (!k.startsWith(pSlash)) continue; const part = k.slice(pSlash.length).split('/')[0]; if (part) entries.add(part); }
      // A real fs.readdirSync throws when the directory itself does not
      // exist (as opposed to existing-but-empty). This flat key-prefix store
      // has no directory registry (mkdirSync is a no-op; a "directory" is
      // purely inferred from stored file-key prefixes), so it genuinely
      // cannot tell "no keys because empty dir" from "no keys because the
      // dir/tree was never created" for an ARBITRARY path -- the repo's own
      // working-tree root (`dir` in every git.* call, e.g. cwd()'s '/home')
      // is a legitimate always-exists directory despite having zero stored
      // keys of its own, and must keep returning [] for it exactly as
      // before, or every git command on a freshly-cd'd-but-otherwise-normal
      // directory would wrongly fail as if the directory didn't exist.
      //
      // The one place this ambiguity is NOT ambiguous is any path with a
      // '.git' path segment: isomorphic-git only ever probes .git-relative
      // paths (.git/refs, .git/objects, .git/logs, ...) to find out whether
      // a *repository* exists there, so a missing .git subtree can safely
      // and unambiguously report "does not exist" without touching the
      // working-tree-directory case above. Scoping the throw to '.git'
      // paths is what preserves prior (correct) behavior for every normal
      // directory read while fixing the git-specific case.
      //
      // The thrown error MUST carry code 'ENOTDIR', not 'ENOENT':
      // isomorphic-git's own FileSystem wrapper (class `P` in
      // vendor/esm/isomorphic-git.mjs) catches every rejection from the fs
      // adapter's readdir and converts code==='ENOTDIR' to `null` (its real
      // "no such tree" sentinel) but silently swallows ANY OTHER error --
      // including a plain ENOENT -- back into `[]` (an empty-but-present
      // directory). That swallow is what let a missing .git ever look like
      // an existing empty .git to begin with: isomorphic-git's ref/object
      // walker then proceeded to read .git/HEAD, .git/refs/*, etc., which
      // also don't exist, and crashed deep in its own binary sha-parsing
      // code ("Length mismatch: expected 48 bytes but got 0 instead.")
      // instead of surfacing a clean "not a git repository". This is the
      // git-status app's root-cause bug.
      if (!entries.size && /(^|\/)\.git(\/|$)/.test(prefix)) {
        const exists = prefix in store || Object.keys(store).some(x => x.startsWith(prefix + '/'));
        if (!exists) { const e = new Error('ENOTDIR: ' + p); e.code = 'ENOTDIR'; throw e; }
      }
      return [...entries];
    },
    mkdirSync() {},
    existsSync(p) { const k = norm(p); if (!k) return Object.keys(store).length > 0; return k in store || Object.keys(store).some(x => x.startsWith(k + '/')); },
    statSync(p) {
      const k = norm(p); const d = store[k];
      // isomorphic-git's internal stat normalizer (Gt/bl in the vendored
      // bundle) reads ctimeSeconds/ctimeNanoseconds/ctimeMs/ctime and
      // dev/ino/uid/gid off every stat result; when all four ctime fields
      // are undefined it falls back to calling `.valueOf()` on `ctime`
      // itself, which throws "Cannot read properties of undefined (reading
      // 'valueOf')" the moment a real (non-ENOENT) stat succeeds. Providing
      // ctimeMs (mirroring mtimeMs) plus placeholder dev/ino/uid/gid keeps
      // every stat result real-git-shaped instead of merely fs.Stats-shaped.
      const common = { dev: 1, ino: 1, uid: 0, gid: 0 };
      if (d != null) return { ...common, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: typeof d === 'string' ? d.length : (d.byteLength || d.length || 0), mtimeMs: mtimes[k] || Date.now(), ctimeMs: mtimes[k] || Date.now(), mode: 0o100644 };
      // No file at this exact key: this flat store has no directory
      // registry (mkdirSync is a no-op), so an arbitrary path with no
      // stored file and no stored descendant is indistinguishable from "an
      // empty-but-real directory" -- e.g. the repo working-tree root itself
      // ('' after norm(), or any un-populated cwd) always needs to read as
      // an existing directory, matching this file's pre-existing behavior
      // and existsSync's own root special-case. The ONE place that
      // ambiguity is resolvable is a '.git' path segment (see readdirSync's
      // comment above for why): isomorphic-git only probes .git-relative
      // paths to detect whether a *repository* exists there, so those alone
      // may legitimately report ENOENT when absent.
      if (Object.keys(store).some(x => x.startsWith(k + '/'))) return { ...common, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, size: 0, mtimeMs: Date.now(), ctimeMs: Date.now(), mode: 0o040755 };
      if (!k || !/(^|\/)\.git(\/|$)/.test(k)) return { ...common, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, size: 0, mtimeMs: Date.now(), ctimeMs: Date.now(), mode: 0o040755 };
      const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e;
    },
    lstatSync(p) { return this.statSync(p); },
    rmSync(p) { const k = norm(p); for (const key of Object.keys(store)) { if (key === k || key.startsWith(k + '/')) { delete store[key]; delete mtimes[key]; } } persist(); },
    symlinkSync() {},
    readlinkSync(p) { return p; },
    // Not part of the isomorphic-git FileSystem contract (all its other
    // methods must stay synchronous). Callers doing cleanup after a failed
    // operation -- e.g. shell-git.js's clone-failure handlers, which rmSync a
    // partially-written dest -- await this afterward so the deletion's
    // persist() is guaranteed to be the LAST write to land in OPFS/IndexedDB,
    // instead of racing an earlier partial-clone write's still-in-flight
    // unawaited persist() and possibly losing to it on reload.
    flushPersist() { return persist(); },
  };
}
