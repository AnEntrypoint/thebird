import { preloadGit, makeGit } from './shell-node-git.js';
import { getGithubToken, getGithubUser, setGithubToken, clearGithubToken, githubDeviceFlow, pollGithubToken, makeIdbFs } from './shell-git-auth.js';

function makeOnAuth() {
  const token = getGithubToken();
  return token ? () => ({ username: token, password: '' }) : undefined;
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
  '  auth login              github device flow login',
  '  auth logout             clear stored token',
  '  auth status             show auth status',
].join('\r\n');

export function makeGitBuiltin(ctx) {
  const term = ctx.term;
  const wl = s => term.write(s + '\r\n');
  const wr = s => term.write(s);
  const git = makeGit(makeIdbFs());
  const cwd = () => ctx.cwd;

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
      wl('\x1b[32m✓ logged in' + (me.login ? ' as ' + me.login : '') + '\x1b[0m');
      if (window.__debug) { window.__debug.githubUser = me.login; if (window.updateGhBadge) window.updateGhBadge(); }
    } catch(e) { wl('\x1b[31merror: ' + e.message + '\x1b[0m'); }
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
      await git.init({ dir: d }); wl('initialized empty git repository in ' + d); return;
    }
    if (sub === 'clone') {
      const url = args[1]; if (!url) { wl('git clone: url required'); return; }
      const name = args[2] || url.split('/').pop().replace(/\.git$/, '');
      const dest = name.startsWith('/') ? name : dir + '/' + name;
      wl('cloning into ' + dest + '...');
      await git.clone({ url, dir: dest, onProgress: p => { if (p.phase) wr('\r' + p.phase + ' ' + (p.loaded || '') + '/' + (p.total || '')); }, ...(onAuth ? { onAuth } : {}) });
      wl('\rdone.'); return;
    }
    if (sub === 'status') {
      const matrix = await git.statusMatrix({ dir });
      const labels = [null, 'unmodified', 'modified', 'deleted'];
      const rows = matrix.filter(([, h, w]) => h !== 1 || w !== 1);
      if (!rows.length) { wl('nothing to commit, working tree clean'); return; }
      for (const [fp,, work, stage] of rows) {
        const staged = stage > 0 ? '\x1b[32mS\x1b[0m' : ' ';
        wl(staged + ' ' + (work === 0 ? '\x1b[31m' : work === 2 ? '\x1b[33m' : '') + fp + '\x1b[0m' + '  [' + (labels[work] || '?') + ']');
      }
      return;
    }
    if (sub === 'add') {
      const p = args[1]; if (!p) { wl('git add: path required'); return; }
      if (p === '.') { const matrix = await git.statusMatrix({ dir }); for (const [fp,, work] of matrix) { if (work !== 1) await git.add({ dir, filepath: fp }); } wl('staged all changes'); }
      else { await git.add({ dir, filepath: p }); wl('staged ' + p); }
      return;
    }
    if (sub === 'commit') {
      const mi = args.indexOf('-m'); const msg = mi >= 0 ? args[mi + 1] : null;
      if (!msg) { wl('git commit: -m "message" required'); return; }
      const name = ctx.env.GIT_AUTHOR_NAME || getGithubUser() || 'thebird';
      const email = ctx.env.GIT_AUTHOR_EMAIL || (getGithubUser() ? getGithubUser() + '@users.noreply.github.com' : 'thebird@localhost');
      const sha = await git.commit({ dir, message: msg, author: { name, email } });
      wl('[' + sha.slice(0, 7) + '] ' + msg); return;
    }
    if (sub === 'push') {
      if (!onAuth) { wl('git push: not authenticated. run "git auth login" first'); return; }
      const remote = args[1] || 'origin'; const branch = args[2] || await git.currentBranch({ dir }) || 'main';
      wl('pushing to ' + remote + '/' + branch + '...');
      await git.push({ dir, remote, remoteRef: branch, onAuth, onAuthFailure: () => { throw new Error('auth failed'); } });
      wl('done.'); return;
    }
    if (sub === 'pull') {
      const remote = args[1] || 'origin'; const branch = args[2] || await git.currentBranch({ dir }) || 'main';
      wl('pulling from ' + remote + '/' + branch + '...');
      await git.pull({ dir, remote, remoteRef: branch, ...(onAuth ? { onAuth } : {}), author: { name: 'thebird', email: 'thebird@localhost' } });
      wl('done.'); return;
    }
    if (sub === 'log') {
      const oneline = args.includes('--oneline');
      const nFlag = args.find(a => /^-\d+$/.test(a));
      const commits = await git.log({ dir, depth: nFlag ? Math.abs(parseInt(nFlag, 10)) : 10 });
      for (const { oid, commit } of commits) {
        if (oneline) wl('\x1b[33m' + oid.slice(0, 7) + '\x1b[0m ' + commit.message.split('\n')[0]);
        else { wl('\x1b[33mcommit ' + oid + '\x1b[0m'); wl('Author: ' + commit.author.name + ' <' + commit.author.email + '>'); wl('Date:   ' + new Date(commit.author.timestamp * 1000).toUTCString()); wl(''); wl('    ' + commit.message.trim()); wl(''); }
      }
      return;
    }
    if (sub === 'diff') { const changed = await git.diff({ dir }); wl(changed.length ? 'modified: ' + changed.join(', ') : 'no changes'); return; }
    if (sub === 'branch') {
      const del = args.includes('-d') || args.includes('-D'); const name = args.find(a => !a.startsWith('-'));
      if (del && name) { await git.branch({ dir, ref: name, checkout: false }); wl('deleted branch ' + name); return; }
      if (name) { await git.branch({ dir, ref: name }); wl('created branch ' + name); return; }
      const branches = await git.listBranches({ dir }); const cur = await git.currentBranch({ dir });
      for (const b of branches) wl((b === cur ? '* \x1b[32m' : '  ') + b + '\x1b[0m');
      return;
    }
    if (sub === 'checkout') {
      const ref = args[1]; if (!ref) { wl('git checkout: branch name required'); return; }
      await git.checkout({ dir, ref }); wl('switched to branch ' + ref); return;
    }
    if (sub === 'remote') {
      const remotes = await git.listRemotes({ dir }); if (!remotes.length) { wl('no remotes'); return; }
      const verbose = args.includes('-v');
      for (const { remote, url } of remotes) wl(remote + (verbose ? '\t' + url : ''));
      return;
    }
    wl('git: unknown subcommand "' + sub + '". run "git --help"');
  };
}
