import { preloadGit, makeGit } from './shell-node-git.js';
import { getGithubToken, getGithubUser, setGithubToken, clearGithubToken, githubDeviceFlow, pollGithubToken, makeIdbFs, parseRepoUrl, fetchRepoBlobsBatched, atomicPushViaGitDataApi } from './shell-git-auth.js';

// Chunked byte->base64 (mirrors shell-git-auth.js's idbFs bytesToB64) so a
// large binary file doesn't blow the call stack via String.fromCharCode.apply.
function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// A CORS-blocked fetch (the browser refuses the request before any HTTP
// response exists) surfaces through isomorphic-git's http-web transport as
// a bare TypeError with no attached response/status data -- distinguishable
// from isomorphic-git's own typed HttpError (real 4xx/5xx) which always
// carries `.data`. `Failed to fetch` / `NetworkError` are the standard
// browser messages for this failure mode (Chromium / Firefox respectively).
function isCorsBlockedError(e) {
  if (!e) return false;
  if (e.data || e.response || e.statusCode) return false; // real HTTP error, has response data
  if (e.name !== 'TypeError') return false;
  return /Failed to fetch|NetworkError|Load failed/i.test(e.message || '');
}

function makeOnAuth() {
  const t = getGithubToken();
  return t ? async () => { const cur = getGithubToken(); return cur ? { username: 'x-access-token', password: cur } : null; } : undefined;
}

// Minimal unified-diff: line-level LCS to emit real @@ hunks for `git diff`.
function unifiedDiff(oldLines, newLines, path, oldOid, newOid) {
  const n = oldLines.length, m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) { ops.push([' ', oldLines[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['-', oldLines[i]]); i++; }
    else { ops.push(['+', newLines[j]]); j++; }
  }
  while (i < n) { ops.push(['-', oldLines[i]]); i++; }
  while (j < m) { ops.push(['+', newLines[j]]); j++; }
  // Annotate each op with its 1-based old/new line numbers, then window into
  // hunks with up to 3 lines of context, merging clusters <=6 lines apart.
  let oldLn = 0, newLn = 0;
  const annotated = ops.map(([t, l]) => {
    if (t === ' ') { oldLn++; newLn++; return { t, l, oldLn, newLn }; }
    if (t === '-') { oldLn++; return { t, l, oldLn, newLn: newLn + 1 }; }
    newLn++; return { t, l, oldLn: oldLn + 1, newLn };
  });
  const changeIdx = annotated.reduce((acc, o, idx) => { if (o.t !== ' ') acc.push(idx); return acc; }, []);
  const hunks = [];
  const CONTEXT = 3, MERGE_GAP = 6;
  if (changeIdx.length) {
    let start = Math.max(0, changeIdx[0] - CONTEXT);
    let end = Math.min(annotated.length - 1, changeIdx[0] + CONTEXT);
    for (let k = 1; k < changeIdx.length; k++) {
      const idx = changeIdx[k];
      if (idx - end <= MERGE_GAP) { end = Math.min(annotated.length - 1, idx + CONTEXT); }
      else { hunks.push([start, end]); start = Math.max(0, idx - CONTEXT); end = Math.min(annotated.length - 1, idx + CONTEXT); }
    }
    hunks.push([start, end]);
  }
  const lines = [];
  lines.push('diff --git a/' + path + ' b/' + path);
  if (oldOid && newOid) lines.push('index ' + oldOid.slice(0, 7) + '..' + newOid.slice(0, 7) + ' 100644');
  lines.push('--- a/' + path);
  lines.push('+++ b/' + path);
  for (const [s, e] of hunks) {
    const slice = annotated.slice(s, e + 1);
    const oldStart = (slice.find(o => o.t !== '+') || slice[0]).oldLn;
    const newStart = (slice.find(o => o.t !== '-') || slice[0]).newLn;
    const oldLen = slice.filter(o => o.t !== '+').length;
    const newLen = slice.filter(o => o.t !== '-').length;
    const oldPart = oldLen === 1 ? String(oldStart) : oldStart + ',' + oldLen;
    const newPart = newLen === 1 ? String(newStart) : newStart + ',' + newLen;
    lines.push('@@ -' + oldPart + ' +' + newPart + ' @@');
    for (const o of slice) lines.push(o.t + o.l);
  }
  return lines.join('\n');
}

const USAGE = [
  'git <command> [options]',
  '  init [dir]              initialize repository',
  '  clone <url> [dir]       clone remote repository',
  '  status                  show working tree status',
  '  add <path>              stage file(s) (. for all)',
  '  commit -m "msg"         commit staged changes',
  '  push [remote] [branch]  push to remote',
  '  pull [remote] [branch]  pull from remote',
  '  log [--oneline] [-N]    show commit history',
  '  diff                    show unstaged changes',
  '  branch [-d] [name]      list or create/delete branches',
  '  checkout <branch>       switch branch',
  '  remote [-v]             list remotes',
  '  rev-parse <ref>         resolve a ref to its oid',
  '  auth login              github device flow login',
  '  auth logout             clear stored token',
  '  auth status             show auth status',
  '  config [--get] <key> [value]   get/set a repo config value (e.g. user.name)',
].join('\r\n');

// Minimal git config: a flat key=value store at <dir>/.git/config (real
// git's actual location, so this is at least discoverable/consistent with
// real tooling that might read it), parsed as plain 'key=value' lines
// (not full INI [section] syntax -- 'user.name'-style dotted keys are the
// common case scripts actually depend on, e.g. `git config user.email`).
function makeGitConfig(idbFs, dir) {
  const path = dir.replace(/\/$/, '') + '/.git/config';
  const load = () => {
    let text = '';
    try { text = idbFs.readFileSync(path, 'utf8'); } catch { return { kv: {}, raw: [] }; }
    const kv = {};
    const raw = [];
    for (const line of String(text).split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        kv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      } else if (line.trim() !== '') {
        // Unparseable line (section header, comment, malformed) -- preserve
        // verbatim so a load/save cycle never silently drops it.
        raw.push(line);
      }
    }
    return { kv, raw };
  };
  const save = ({ kv, raw }) => idbFs.writeFileSync(
    path,
    [...raw, ...Object.entries(kv).map(([k, v]) => k + '=' + v)].join('\n') + '\n'
  );
  return {
    get: (key) => load().kv[key],
    set: (key, value) => { const cfg = load(); cfg.kv[key] = value; save(cfg); },
    all: () => load().kv,
  };
}

export function makeGitBuiltin(ctx) {
  const term = ctx.term;
  const wl = s => term.write(s + '\r\n');
  const wr = s => term.write(s);
  const idbFs = makeIdbFs();
  const git = makeGit(idbFs);
  const cwd = () => ctx.cwd;

  function gitConfig(args) {
    const cfg = makeGitConfig(idbFs, cwd());
    const getOnly = args[0] === '--get';
    const rest = getOnly ? args.slice(1) : args;
    if (!rest.length) { const all = cfg.all(); for (const [k, v] of Object.entries(all)) wl(k + '=' + v); return; }
    const [key, value] = rest;
    if (value === undefined) {
      const v = cfg.get(key);
      if (v === undefined) { ctx.lastExitCode = 1; return; }
      wl(v);
      return;
    }
    cfg.set(key, value);
  }

  async function handleAuth(args) {
    const ac = args[1];
    if (ac === 'logout') { clearGithubToken(); wl('github token cleared'); return; }
    if (ac === 'status') {
      const u = getGithubUser(); const t = getGithubToken();
      wl(t ? 'logged in' + (u ? ' as ' + u : '') + ' · "git auth logout" to clear' : 'not logged in · "git auth login" to authenticate');
      return;
    }
    if (ac !== 'login') { wl('git auth: use login | logout | status'); return; }
    const clientId = ctx.env.GITHUB_CLIENT_ID || window.__debug?.githubClientId;
    if (!clientId) { wl('error: set GITHUB_CLIENT_ID env var or window.__debug.githubClientId'); return; }
    try {
      const { user_code, verification_uri, device_code, interval } = await githubDeviceFlow(clientId);
      wl('1. open: \x1b[36m' + verification_uri + '\x1b[0m');
      wl('2. enter code: \x1b[1;33m' + user_code + '\x1b[0m');
      wl('waiting for authorization...');
      const token = await pollGithubToken(clientId, device_code, interval);
      const meRes = await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'thebird' } });
      const me = meRes.ok ? await meRes.json() : {};
      setGithubToken(token, me.login);
      wl('\x1b[32m[x] logged in' + (me.login ? ' as ' + me.login : '') + '\x1b[0m');
      if (window.__debug) { window.__debug.githubUser = me.login; if (window.updateGhBadge) window.updateGhBadge(); }
    } catch(e) {
      const knownErrors = { 'authorization_pending': 'waiting for authorization', 'expired_token': 'code expired, run "git auth login" again', 'device_flow_disabled': 'device flow not enabled for this app', 'access_denied': 'authorization denied by user' };
      const msg = knownErrors[e.message] || (e.message && e.message.length < 200 ? e.message : 'authorization failed, please try again');
      wl('\x1b[31merror: ' + msg + '\x1b[0m');
    }
  }

  return async function gitCmd(args) {
    const sub = args[0];
    if (!sub || sub === '--help' || sub === '-h') { wl(USAGE); return; }
    if (sub === 'auth') { await handleAuth(args); return; }

    await preloadGit();
    const onAuth = makeOnAuth();
    const dir = cwd();

    if (sub === 'init') {
      const d = args[1] ? (args[1].startsWith('/') ? args[1] : dir + '/' + args[1]) : dir;
      await git.init({ dir: d }); wl('Initialized empty Git repository in ' + d.replace(/\/$/, '') + '/.git/'); return;
    }
    if (sub === 'clone') {
      if (!args[1]) { ctx.lastExitCode = 128; wl('git clone: url required'); return; }
      let parsedUrl;
      try { parsedUrl = new URL(args[1]); } catch { ctx.lastExitCode = 128; wl('git clone: invalid url'); return; }
      if (parsedUrl.protocol === 'ssh:') { ctx.lastExitCode = 128; wl('git clone: ssh:// is not supported in the browser, use https://'); return; }
      if (parsedUrl.protocol !== 'https:') { ctx.lastExitCode = 128; wl('git clone: only https:// is allowed'); return; }
      const url = args[1];
      const rawName = args[2] || parsedUrl.pathname.split('/').pop().replace(/\.git$/, '');
      const name = rawName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'repo';
      const dest = name.startsWith('/') ? name : dir + '/' + name;
      // git auth login only supports github.com; cloning from other hosts proceeds unauthenticated
      const authForUrl = parsedUrl.hostname === 'github.com' ? onAuth : undefined;
      wl('cloning into ' + dest + '...');
      try {
        await git.clone({ url, dir: dest, onProgress: p => { if (p.phase) wr('\r' + p.phase + ' ' + (p.loaded || '') + '/' + (p.total || '')); }, ...(authForUrl ? { onAuth: authForUrl } : {}) });
        wl('\rdone.');
      } catch(e) {
        if (parsedUrl.hostname === 'github.com' && isCorsBlockedError(e)) {
          wl('\rsmart-HTTP clone blocked (CORS); falling back to GitHub API batched blob fetch...');
          try {
            const { owner, repo } = parseRepoUrl(url);
            const token = getGithubToken();
            const ref = 'HEAD';
            const { files, skippedCount } = await fetchRepoBlobsBatched(owner, repo, token, ref);
            for (const f of files) {
              if (f.skipped) continue;
              const filePath = dest + '/' + f.path;
              const parts = filePath.split('/');
              for (let i = 1; i < parts.length; i++) {
                const d = parts.slice(0, i).join('/');
                if (d && !idbFs.existsSync(d)) idbFs.mkdirSync(d, { recursive: true });
              }
              idbFs.writeFileSync(filePath, f.content);
            }
            // The batched-blob fallback has no git history to transplant, but
            // dest must still be a real repo (`.git` present) so every later
            // git command run inside it (status/add/commit/push) works instead
            // of hitting the "not a git repository" fatal despite the CLI
            // having just reported success.
            await git.init({ dir: dest });
            try { await git.addRemote({ dir: dest, remote: 'origin', url }); } catch { /* best-effort; absence of a remote is non-fatal */ }
            for (const f of files) {
              if (f.skipped) continue;
              await git.add({ dir: dest, filepath: f.path });
            }
            const fallbackAuthorName = (ctx.env.GIT_AUTHOR_NAME || getGithubUser() || 'thebird').replace(/[\r\n\x00]/g, '').trim() || 'thebird';
            const fallbackAuthorEmail = ctx.env.GIT_AUTHOR_EMAIL || (getGithubUser() ? getGithubUser() + '@users.noreply.github.com' : 'thebird@localhost');
            await git.commit({ dir: dest, message: 'Fallback clone via GitHub API (no git history available)', author: { name: fallbackAuthorName, email: fallbackAuthorEmail } });
            wl('done (fallback: ' + (files.length - skippedCount) + ' files' + (skippedCount ? ', ' + skippedCount + ' skipped (>1MB)' : '') + '; initialized as a new repo with a single commit, original history not available).');
          } catch (fallbackErr) {
            let cleaned = false;
            try { idbFs.rmSync(dest); await idbFs.flushPersist?.(); cleaned = true; } catch { /* swallow: dest may be partially written or already removed; cleaned stays false and the message notes manual cleanup may be needed */ }
            ctx.lastExitCode = 1;
            wl('error: fallback fetch failed: ' + fallbackErr.message + (cleaned ? ' (cleaned ' + dest + ')' : ''));
          }
          return;
        }
        let cleaned = false;
        try { idbFs.rmSync(dest); await idbFs.flushPersist?.(); cleaned = true; } catch { /* swallow: dest may be partially written or already removed; cleaned stays false and the message notes manual cleanup may be needed */ }
        ctx.lastExitCode = 1;
        wl('\rerror: ' + e.message + (cleaned ? ' (cleaned ' + dest + ')' : ' (manual cleanup may be needed: git rm -rf ' + dest + ')'));
      }
      return;
    }
    if (sub === 'status') {
      const porcelainV2 = args.some(a => a === '--porcelain=2' || a === '--porcelain=v2');
      if (porcelainV2) { ctx.lastExitCode = 1; wl('error: --porcelain=v2 is not supported; use --porcelain (v1) instead'); return; }
      const porcelain = args.includes('--porcelain') || args.some(a => a.startsWith('--porcelain=')) || args.includes('-s') || args.includes('--short');
      const showBranch = args.includes('--branch') || args.includes('-b');
      // A directory with no .git at all does NOT make statusMatrix/
      // currentBranch throw ENOENT -- isomorphic-git's HEAD resolution
      // falls back to the well-known empty-tree oid and statusMatrix
      // resolves fine with an empty result, so the only reliable "is this
      // even a repo" signal is checking for .git's own presence up front,
      // matching real git's actual "fatal: not a git repository" behavior
      // for a plain, never-initialized directory.
      if (!idbFs.existsSync(dir.replace(/\/$/, '') + '/.git')) {
        ctx.lastExitCode = 128; wl('fatal: not a git repository (or any of the parent directories): .git'); return;
      }
      let matrix;
      try { matrix = await git.statusMatrix({ dir }); }
      catch (e) {
        if (e.code === 'ENOENT' || e.code === 'NotFoundError' || /ENOENT/.test(e.message)) { ctx.lastExitCode = 128; wl('fatal: not a git repository (or any of the parent directories): .git'); return; }
        ctx.lastExitCode = 1; wl('error: ' + e.message); return;
      }
      const rows = matrix.filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1));
      // statusMatrix succeeding (even with 0 rows) does NOT mean HEAD
      // resolves -- a just-`git init`'d repo with zero commits yet (or,
      // pre-fix, any .git-less directory: statusMatrix used to crash first
      // and mask this entirely) has a statusMatrix that resolves fine but a
      // currentBranch() that throws NotFoundError("Could not find HEAD."),
      // same as resolveRef would for a HEAD that points at an unborn branch.
      // Real git prints "No commits yet" for this state instead of raising
      // an error, so treat NotFoundError/ENOENT here as "no commits yet",
      // never let it escape uncaught to the shell's generic red-text
      // top-level error handler (which is what previously rendered the bare
      // "Could not find HEAD." with no "On branch"/"error:" framing at all).
      const safeCurrentBranch = async () => {
        try { return await git.currentBranch({ dir }); }
        catch (e) { if (e.code === 'NotFoundError' || e.code === 'ENOENT' || /ENOENT/.test(e.message)) return null; throw e; }
      };
      if (porcelain) {
        if (showBranch) { const cur = await safeCurrentBranch(); wl('## ' + (cur || 'HEAD (no branch)')); }
        for (const [fp, head, work, stage] of rows) {
          let x = ' ', y = ' ';
          if (head === 0 && stage === 0) { x = '?'; y = '?'; }
          else {
            if (head === 0 && stage > 0) x = 'A';
            else if (stage === 0 && head === 1) x = 'D';
            else if (stage === 3 || stage === 2) x = 'M';
            y = work === 0 ? 'D' : work === 2 ? 'M' : ' ';
          }
          wl(x + y + ' ' + fp);
        }
        return;
      }
      const branch = await safeCurrentBranch();
      // currentBranch() resolves to a real branch NAME as soon as `git init`
      // writes .git/HEAD (a symbolic ref pointing at refs/heads/<branch>) --
      // it does NOT require that branch's ref to already exist, so it
      // reports e.g. "master" even before the first commit. Whether there
      // ARE any commits yet is a separate question (real git's "No commits
      // yet" banner + different nothing-to-commit wording), answered by
      // whether HEAD resolves all the way to a commit oid.
      let hasCommits = true;
      if (branch !== null) { try { await git.resolveRef({ dir, ref: 'HEAD' }); } catch { hasCommits = false; } }
      if (branch === null) { wl('On branch master'); wl(''); wl('No commits yet'); wl(''); }
      else if (!hasCommits) { wl('On branch ' + branch); wl(''); wl('No commits yet'); wl(''); }
      else wl('On branch ' + branch);
      if (!rows.length) { wl((branch === null || !hasCommits) ? 'nothing to commit (create/copy files and use "git add" to track)' : 'nothing to commit, working tree clean'); return; }
      const staged = rows.filter(([, , , stage]) => stage > 0 && stage !== 1);
      const unstaged = rows.filter(([, head, work]) => head === 1 && work !== 1);
      const untracked = rows.filter(([, head]) => head === 0);
      if (staged.length) {
        wl('Changes to be committed:');
        wl('  (use "git restore --staged <file>..." to unstage)');
        for (const [fp, head] of staged) wl('\tmodified:   ' + fp);
        wl('');
      }
      if (unstaged.length) {
        wl('Changes not staged for commit:');
        wl('  (use "git add <file>..." to update what will be committed)');
        wl('  (use "git restore <file>..." to discard changes in working directory)');
        for (const [fp, , work] of unstaged) wl('\t' + (work === 0 ? 'deleted:    ' : 'modified:   ') + fp);
        wl('');
      }
      if (untracked.length) {
        wl('Untracked files:');
        wl('  (use "git add <file>..." to include in what will be committed)');
        for (const [fp] of untracked) wl('\t' + fp);
        wl('');
      }
      if (!staged.length && (unstaged.length || untracked.length)) {
        wl('no changes added to commit (use "git add" and/or "git commit -a")');
      }
      return;
    }
    if (sub === 'add') {
      const rest = args.slice(1);
      const verbose = rest.includes('-v') || rest.includes('--verbose');
      // gm's host_git drives this builtin with real git's argv shapes (`add -A`,
      // `add <p1> <p2>`); -A/--all/. all mean "stage every changed path".
      const stageAll = rest.includes('-A') || rest.includes('--all') || rest.includes('.');
      const ps = rest.filter(a => !a.startsWith('-') && a !== '.');
      if (stageAll) { const matrix = await git.statusMatrix({ dir }); for (const [fp,, work] of matrix) { if (work !== 1) await git.add({ dir, filepath: fp }); } if (verbose) wl('staged all changes'); }
      else { if (!ps.length) { wl('git add: path required'); return; } for (const p of ps) { await git.add({ dir, filepath: p }); if (verbose) wl('staged ' + p); } }
      return;
    }
    if (sub === 'commit') {
      const mi = args.indexOf('-m'); const msg = mi >= 0 ? args[mi + 1] : null;
      if (!msg) { ctx.lastExitCode = 128; wl('git commit: -m "message" required'); return; }
      const name = (ctx.env.GIT_AUTHOR_NAME || getGithubUser() || '').replace(/[\r\n\x00]/g, '').trim() || null;
      const email = ctx.env.GIT_AUTHOR_EMAIL || (getGithubUser() ? getGithubUser() + '@users.noreply.github.com' : null);
      if (!name || !email) { ctx.lastExitCode = 128; wl('git commit: set GIT_AUTHOR_NAME + GIT_AUTHOR_EMAIL env vars, or authenticate with "git auth login"'); return; }
      if (args.includes('-a') || args.includes('--all')) {
        const preMatrix = await git.statusMatrix({ dir });
        for (const [fp, head, work, stage] of preMatrix) {
          if (head === 0) continue; // never stage untracked, matches real git -a
          if (work === 0 && stage !== 0) await git.remove({ dir, filepath: fp });
          else if (work === 2 && work !== stage) await git.add({ dir, filepath: fp });
        }
      }
      const sha = await git.commit({ dir, message: msg, author: { name, email } });
      const branch = await git.currentBranch({ dir }) || 'detached HEAD';
      wl('[' + branch + ' ' + sha.slice(0, 7) + '] ' + msg);
      try {
        const matrix = await git.statusMatrix({ dir });
        const changed = matrix.filter(([, head, work, stage]) => stage > 0 && !(head === 1 && work === 1 && stage === 1));
        if (changed.length) {
          let insertions = 0, deletions = 0;
          for (const [fp, head] of changed) {
            let oldText = '';
            if (head === 1) {
              try {
                const prevHead = await git.resolveRef({ dir, ref: 'HEAD~1' });
                const { blob } = await git.readBlob({ dir, oid: prevHead, filepath: fp });
                oldText = new TextDecoder().decode(blob);
              } catch { /* swallow: first commit has no HEAD~1 (or the file is new); treat as empty "before" text so the diffstat still counts it as all-insertions */ }
            }
            let newText = '';
            try {
              const { blob } = await git.readBlob({ dir, oid: sha, filepath: fp });
              newText = new TextDecoder().decode(blob);
            } catch { /* swallow: blob may be missing (e.g. deleted file in this commit); diffstat treats it as empty "after" text */ }
            const oldLines = oldText ? oldText.split('\n') : [];
            const newLines = newText ? newText.split('\n') : [];
            const diffLines = unifiedDiff(oldLines, newLines, fp).split('\n');
            for (const l of diffLines) { if (l[0] === '+' && !l.startsWith('+++')) insertions++; else if (l[0] === '-' && !l.startsWith('---')) deletions++; }
          }
          wl(' ' + changed.length + ' file' + (changed.length === 1 ? '' : 's') + ' changed'
            + (insertions ? ', ' + insertions + ' insertion' + (insertions === 1 ? '' : 's') + '(+)' : '')
            + (deletions ? ', ' + deletions + ' deletion' + (deletions === 1 ? '' : 's') + '(-)' : ''));
        }
      } catch { /* swallow: diffstat is a cosmetic post-commit summary; the commit itself already succeeded above, so any failure computing insertions/deletions is non-fatal */ }
      return;
    }
    if (sub === 'push') {
      const atomic = args.includes('--atomic');
      const positional = args.slice(1).filter(a => a !== '--atomic');
      const remote = positional[0] || 'origin';
      if (!/^[a-zA-Z0-9._\/-]+$/.test(remote)) { ctx.lastExitCode = 1; wl('git push: invalid remote name'); return; }
      let branch = positional[1];
      if (!branch) { branch = await git.currentBranch({ dir }); if (!branch) { ctx.lastExitCode = 1; wl('git push: not on a branch (detached HEAD); specify branch explicitly: git push ' + remote + ' <branch>'); return; } }
      if (!/^[a-zA-Z0-9._\/-]+$/.test(branch)) { ctx.lastExitCode = 1; wl('git push: invalid branch name'); return; }
      // Resolve remote URL to determine if GitHub auth is needed (matches clone behavior at line 83)
      let pushAuthForUrl;
      let remoteEntry;
      try {
        const remotes = await git.listRemotes({ dir });
        remoteEntry = remotes.find(r => r.remote === remote);
        if (remoteEntry) {
          let parsedRemoteUrl;
          try { parsedRemoteUrl = new URL(remoteEntry.url); } catch { /* swallow: malformed remote URL; isGithub below stays false and the push/pull proceeds unauthenticated (or fails downstream with a clearer error) */ }
          const isGithub = parsedRemoteUrl && parsedRemoteUrl.hostname === 'github.com';
          if (isGithub && !getGithubToken()) { ctx.lastExitCode = 1; wl('git push: not authenticated with GitHub. run "git auth login" first'); return; }
          pushAuthForUrl = isGithub ? onAuth : undefined;
        } else {
          // Remote name not found in list; allow unauthenticated attempt
          pushAuthForUrl = undefined;
        }
      } catch (e) { ctx.lastExitCode = 1; wl('git push: could not resolve remote: ' + e.message); return; }
      // Atomic path: single-commit whole-tree sync via the GitHub Data API
      // (blobs -> tree w/ base_tree -> commit -> ref PATCH), bypassing
      // isomorphic-git's smart-HTTP protocol entirely. Preferred when the
      // caller wants one atomic remote commit instead of a fast-forward push
      // of the local commit chain.
      if (atomic) {
        if (!remoteEntry) { ctx.lastExitCode = 1; wl('git push --atomic: remote "' + remote + '" not found'); return; }
        let owner, repo;
        try { ({ owner, repo } = parseRepoUrl(remoteEntry.url)); }
        catch (e) { ctx.lastExitCode = 1; wl('git push --atomic: ' + e.message); return; }
        const token = getGithubToken();
        if (!token) { ctx.lastExitCode = 1; wl('git push --atomic: not authenticated with GitHub. run "git auth login" first'); return; }
        wl('pushing to ' + remote + '/' + branch + ' (atomic, Git Data API)...');
        try {
          const matrix = await git.statusMatrix({ dir });
          const changed = matrix.filter(([, head, work, stage]) => !(head === 1 && work === 1 && stage === 1));
          if (!changed.length) { wl('nothing to push: working tree matches HEAD'); return; }
          const files = [];
          for (const [fp, , work] of changed) {
            if (work === 0) continue; // deleted locally -> omit from tree entries (Data API tree is additive/overwrite only here)
            // Read working-tree content directly (not the HEAD blob) so uncommitted edits push too.
            // Read raw (no 'utf8' opt) so a binary file's stored B64 envelope decodes to real
            // bytes rather than being force-decoded through TextDecoder('utf-8'), which mangles
            // any byte sequence that isn't valid UTF-8 (images, wasm, other compiled assets).
            let content, encoding;
            try {
              const raw = idbFs.readFileSync(dir + '/' + fp);
              if (typeof raw === 'string') {
                content = raw; encoding = 'utf-8';
              } else {
                content = bytesToBase64(raw); encoding = 'base64';
              }
            } catch (e) { continue; }
            files.push({ path: fp, content, encoding });
          }
          if (!files.length) { wl('nothing to push: only deletions detected (unsupported by --atomic)'); ctx.lastExitCode = 1; return; }
          const { sha } = await atomicPushViaGitDataApi(owner, repo, token, branch, files);
          wl('done. new commit ' + sha.slice(0, 7));
        } catch (e) { ctx.lastExitCode = 1; wl('error: ' + e.message); }
        return;
      }
      wl('pushing to ' + remote + '/' + branch + '...');
      try {
        await git.push({ dir, remote, remoteRef: branch, ...(pushAuthForUrl ? { onAuth: pushAuthForUrl, onAuthFailure: () => { throw new Error('auth failed: token may be invalid or expired. run "git auth login" to re-authenticate'); } } : {}) });
        wl('done.');
      } catch(e) { ctx.lastExitCode = 1; wl('error: ' + e.message); }
      return;
    }
    if (sub === 'pull') {
      const remote = args[1] || 'origin';
      if (!/^[a-zA-Z0-9._\/-]+$/.test(remote)) { ctx.lastExitCode = 1; wl('git pull: invalid remote name'); return; }
      let branch = args[2];
      if (!branch) { branch = await git.currentBranch({ dir }); if (!branch) { ctx.lastExitCode = 1; wl('git pull: not on a branch (detached HEAD); specify branch explicitly: git pull ' + remote + ' <branch>'); return; } }
      if (!/^[a-zA-Z0-9._\/-]+$/.test(branch)) { ctx.lastExitCode = 1; wl('git pull: invalid branch name'); return; }
      // Resolve remote URL to determine if GitHub auth is needed (matches clone behavior at line 83)
      let pullAuthForUrl;
      try {
        const remotes = await git.listRemotes({ dir });
        const remoteEntry = remotes.find(r => r.remote === remote);
        if (remoteEntry) {
          let parsedRemoteUrl;
          try { parsedRemoteUrl = new URL(remoteEntry.url); } catch { /* swallow: malformed remote URL; isGithub below stays false and the push/pull proceeds unauthenticated (or fails downstream with a clearer error) */ }
          const isGithub = parsedRemoteUrl && parsedRemoteUrl.hostname === 'github.com';
          if (isGithub && !getGithubToken()) { ctx.lastExitCode = 1; wl('git pull: not authenticated with GitHub. run "git auth login" first'); return; }
          pullAuthForUrl = isGithub ? onAuth : undefined;
        } else {
          pullAuthForUrl = undefined;
        }
      } catch (e) { ctx.lastExitCode = 1; wl('git pull: could not resolve remote: ' + e.message); return; }
      wl('pulling from ' + remote + '/' + branch + '...');
      const pullName = (ctx.env.GIT_AUTHOR_NAME || getGithubUser() || 'thebird').replace(/[\r\n\x00]/g, '').trim() || 'thebird';
      const pullEmail = ctx.env.GIT_AUTHOR_EMAIL || (getGithubUser() ? getGithubUser() + '@users.noreply.github.com' : 'thebird@localhost');
      try {
        await git.pull({ dir, remote, remoteRef: branch, ...(pullAuthForUrl ? { onAuth: pullAuthForUrl } : {}), author: { name: pullName, email: pullEmail } });
        wl('done.');
      } catch(e) { ctx.lastExitCode = 1; wl('error: ' + e.message); }
      return;
    }
    if (sub === 'log') {
      const oneline = args.includes('--oneline');
      const nFlag = args.find(a => /^-\d+$/.test(a));
      const commits = await git.log({ dir, depth: nFlag ? Math.abs(parseInt(nFlag, 10)) : 10 });
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const pad = n => String(n).padStart(2, '0');
      for (const { oid, commit } of commits) {
        if (oneline) wl(oid.slice(0, 7) + ' ' + commit.message.split('\n')[0]);
        else {
          const tzOffsetMin = -(commit.author.timezoneOffset || 0);
          const d = new Date(commit.author.timestamp * 1000 + tzOffsetMin * 60000);
          const sign = tzOffsetMin >= 0 ? '+' : '-';
          const tzStr = sign + pad(Math.floor(Math.abs(tzOffsetMin) / 60)) + pad(Math.abs(tzOffsetMin) % 60);
          const dateStr = days[d.getUTCDay()] + ' ' + months[d.getUTCMonth()] + ' ' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' ' + d.getUTCFullYear() + ' ' + tzStr;
          wl('commit ' + oid); wl('Author: ' + commit.author.name + ' <' + commit.author.email + '>'); wl('Date:   ' + dateStr); wl(''); wl('    ' + commit.message.trim()); wl('');
        }
      }
      return;
    }
    if (sub === 'diff') {
      const changed = await git.diff({ dir });
      if (!changed.length) return;
      for (const fp of changed) {
        let oldText = '', oldOid;
        try {
          const head = await git.resolveRef({ dir, ref: 'HEAD' });
          const res = await git.readBlob({ dir, oid: head, filepath: fp });
          oldOid = res.oid;
          oldText = new TextDecoder().decode(res.blob);
        } catch { /* swallow: file may be new (no HEAD blob yet); diff treats it as empty "before" text so it shows as all-insertions */ }
        let newText = '';
        try { const d = idbFs.readFileSync(dir + '/' + fp, 'utf8'); newText = typeof d === 'string' ? d : new TextDecoder().decode(d); } catch { /* swallow: file may have been deleted from the working tree; diff treats it as empty "after" text so it shows as all-deletions */ }
        // newOid was previously always undefined, so unifiedDiff's `if
        // (oldOid && newOid)` guard silently skipped the real git diff
        // output's "index <oldoid>..<newoid> <mode>" line entirely --
        // hashBlob computes the real content-addressed oid of the current
        // working-tree text the same way `git hash-object` would.
        let newOid;
        try { newOid = (await git.hashBlob({ object: newText })).oid; } catch { /* swallow: hashBlob failure just drops the "index <oldoid>..<newoid>" line from diff output; the actual diff content is unaffected */ }
        wl(unifiedDiff(oldText.split('\n'), newText.split('\n'), fp, oldOid, newOid));
      }
      return;
    }
    if (sub === 'branch') {
      const forceDel = args.includes('-D'); const safeDel = args.includes('-d'); const del = safeDel || forceDel; const name = args.find(a => !a.startsWith('-'));
      if (name && !/^[a-zA-Z0-9._\/-]+$/.test(name)) { ctx.lastExitCode = 128; wl('git branch: invalid branch name'); return; }
      if (del && name) {
        let oid; try { oid = await git.resolveRef({ dir, ref: name }); } catch { /* swallow: ref may not resolve (dangling/unusual state); oid stays undefined and deleteBranch below reports "(was ...)" only when it has a value */ }
        if (safeDel && !forceDel && oid) {
          const cur = await git.currentBranch({ dir });
          let merged = false;
          try {
            const log = await git.log({ dir, ref: cur || 'HEAD' });
            merged = log.some(c => c.oid === oid);
          } catch { /* swallow: log walk may fail (e.g. shallow/corrupt history); merged stays false, which is the conservative choice — it blocks the safe delete rather than risking data loss */ }
          if (!merged) {
            ctx.lastExitCode = 1;
            wl("error: The branch '" + name + "' is not fully merged.");
            wl("(If you are sure you want to delete it, run 'git branch -D " + name + "'.)");
            return;
          }
        }
        await git.deleteBranch({ dir, ref: name });
        wl('Deleted branch ' + name + (oid ? ' (was ' + oid.slice(0, 7) + ')' : '') + '.');
        return;
      }
      if (name) { await git.branch({ dir, ref: name }); return; }
      const branches = await git.listBranches({ dir }); const cur = await git.currentBranch({ dir });
      for (const b of branches) wl((b === cur ? '* ' : '  ') + b);
      return;
    }
    if (sub === 'checkout') {
      const createFlag = args[1] === '-b' || args[1] === '-B';
      const ref = createFlag ? args[2] : args[1];
      if (!ref) { ctx.lastExitCode = 1; wl('git checkout: branch name required'); return; }
      if (!ref.match(/^[a-zA-Z0-9._\/-]+$/)) { ctx.lastExitCode = 1; wl('git checkout: invalid branch name'); return; }
      try {
        if (createFlag) {
          await git.branch({ dir, ref, checkout: false });
          await git.checkout({ dir, ref });
          wl("Switched to a new branch '" + ref + "'");
        } else {
          let carried = [];
          try {
            const rows = await git.statusMatrix({ dir });
            carried = rows.filter(([, head, work, stage]) => work !== head || stage !== head)
              .map(([path, head]) => (head === 0 ? 'A\t' + path : 'M\t' + path))
              .sort();
          } catch { /* swallow: computing the "carried over" status list is cosmetic (mimics real git's post-checkout summary); failure just means checkout proceeds without printing it */ }
          await git.checkout({ dir, ref });
          for (const line of carried) wl(line);
          wl("Switched to branch '" + ref + "'");
        }
      } catch (e) {
        ctx.lastExitCode = 1;
        if (e.code === 'CheckoutConflictError' && e.data && e.data.filepaths) {
          wl('error: Your local changes to the following files would be overwritten by checkout:');
          for (const fp of e.data.filepaths) wl('\t' + fp);
          wl('Please commit your changes or stash them before you switch branches.');
          wl('Aborting');
        } else {
          wl("error: pathspec '" + ref + "' did not match any file(s) known to git");
        }
      }
      return;
    }
    if (sub === 'remote') {
      const remotes = await git.listRemotes({ dir }); if (!remotes.length) { wl('no remotes'); return; }
      const verbose = args.includes('-v');
      for (const { remote, url } of remotes) {
        if (verbose) { wl(remote + '\t' + url + ' (fetch)'); wl(remote + '\t' + url + ' (push)'); }
        else wl(remote);
      }
      return;
    }
    if (sub === 'rev-parse') {
      // gm's git_commit flow resolves HEAD before/after a commit through this
      // subcommand; only plain ref resolution is supported (no --abbrev-ref /
      // --show-toplevel sugar -- those callers get real git's failure shape).
      const ref = args[1] || 'HEAD';
      try { wl(await git.resolveRef({ dir, ref })); }
      catch { ctx.lastExitCode = 128; wl("fatal: ambiguous argument '" + ref + "': unknown revision or path not in the working tree."); }
      return;
    }
    if (sub === 'config') { gitConfig(args.slice(1)); return; }
    wl('git: unknown subcommand "' + sub + '". run "git --help"');
  };
}
