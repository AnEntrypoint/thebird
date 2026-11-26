import { spawn, spawnSync } from 'node:child_process';
import { connect, createServer as createNetServer } from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { startNpmMirror } from '../../npm-mirror.mjs';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRelay } from '../../../src/relay.js';
import { closeBrowserTree, closeBrowserTrees, runTerminal, startBrowser, withTimeout } from '../../browser-driver.mjs';
import { vendorBashkit } from '../../vendor-bashkit.mjs';
import { vendorFx } from '../../vendor-fx.mjs';
import { vendorFloosie } from '../../vendor-floosie.mjs';
import { buildPages } from '../../build-pages.mjs';
import { startFxStubGateway, FX_STUB_KEY } from '../../fx-stub-gateway.mjs';
import { PAGE_HOST_TOOL_NAMES } from '../../../web/fx-host-tools.js';
import { COLD_START_MS, DEFAULT_CONTEXT_GROUPS, FX_TUI_TOOLS, GRAPHEMES, GROUP_BUDGET_MS, JOBS, LIVE_UNAVAILABLE, OPENROUTER_MODELS_URL, OPENROUTER_URL, PAGE_TOOLS, SITE_TYPES, TUI_PALETTE_RESIZE_SETTLED, TUI_RESIZE_SETTLED, TUI_SCREEN, TUI_STATE, TUI_TITLE, alive, binRunner, browserFor, check, chrome, craftCli, current, disposeContext, dotenvValue, fetchWithFallback, freeModels, freePort, getMirror, getRelay, group, groups, haveChrome, heavyTail, listening, liveCheck, liveProvider, liveRun, liveVerdict, loadAverage, pollAnswer, profileDir, providerVerdict, reapBrowserTrees, registryNet, root, runAt, runGroup, runHeavy, scope, scratchDir, scratchDirs, servePages, serveThenStop, services, shared, sharedBrowserFor, sharedBrowserStart, sharedPages, sharedProfile, skip, skipLive, spawnedPids, startChatStub, startProviderStub, stopPid, terminal, trackPid, webhostCli, webserverCli, within } from '../shared.mjs';

group('uv-fs', async () => {
  const uvSeed = "printf 'abcdefghijklmnop' > /workspace/uvfs-c0";
  const uvDoubling = Array.from({ length: 13 }, (_, i) => `cat /workspace/uvfs-c${i} /workspace/uvfs-c${i} > /workspace/uvfs-c${i + 1}`).join(' && ');
  const uvFs = await terminal([
    ['run', `${uvSeed} && ${uvDoubling} && printf 'short' > /workspace/uvfs-src.txt && printf 'long-content-to-truncate' > /workspace/uvfs-dst.txt && echo seeded`],
    ['run', `tjs -e "tjs.makeTempDir('/workspace/uvfs-XXXXXX').then((d) => tjs.makeTempDir('/workspace/uvfs-XXXXXX').then((e) => tjs.stat(d).then((s) => console.log('uvfs-mkdtemp', d.startsWith('/workspace/uvfs-'), d.length, s.isDirectory, d !== e))))"`],
    ['run', `tjs -e "tjs.makeTempFile('/workspace/uvfs-XXXXXX').then((f) => tjs.stat(f.path).then((s) => console.log('uvfs-mkstemp', f.path.startsWith('/workspace/uvfs-'), f.path.length, s.isFile)))"`],
    ['run', `tjs -e "tjs.makeTempDir('/workspace/uvfs-nope').then(() => console.log('uvfs-bad-template ok'), () => console.log('uvfs-bad-template rejected'))"`],
    ['run', `tjs -e "tjs.copyFile('/workspace/uvfs-src.txt', '/workspace/uvfs-dst.txt').then(() => tjs.readFile('/workspace/uvfs-dst.txt')).then((b) => console.log('uvfs-copy-truncate', new TextDecoder().decode(b)))"`],
    ['run', `tjs -e "tjs.copyFile('/workspace/uvfs-c13', '/workspace/uvfs-big-copy.bin').then(() => tjs.stat('/workspace/uvfs-big-copy.bin')).then((s) => console.log('uvfs-copy-big', s.size))"`],
    ['run', `tjs -e "tjs.copyFile('/workspace/uvfs-none.txt', '/workspace/uvfs-x.txt').then(() => console.log('uvfs-copy-missing ok'), () => console.log('uvfs-copy-missing rejected'))"`],
    ['run', "printf 'attr' > /workspace/uvfs-attr.txt && echo attr-seeded"],
    ['run', `tjs -e "tjs.chmod('/workspace/uvfs-attr.txt', 0o600).then(() => tjs.stat('/workspace/uvfs-attr.txt')).then((s) => console.log('uvfs-chmod', s.mode & 0o777))"`],
    ['run', `tjs -e "tjs.open('/workspace/uvfs-attr.txt', 'r+').then((f) => f.chmod(0o640).then(() => f.close()).then(() => tjs.stat('/workspace/uvfs-attr.txt'))).then((s) => console.log('uvfs-fchmod', s.mode & 0o777))"`],
    ['run', `tjs -e "tjs.open('/workspace/uvfs-attr.txt', 'r+').then((f) => f.chown(1234, 5678).then(() => f.close()).then(() => tjs.stat('/workspace/uvfs-attr.txt'))).then((s) => console.log('uvfs-fchown', s.uid, s.gid))"`],
    ['run', `tjs -e "tjs.open('/workspace/uvfs-attr.txt', 'r+').then((f) => f.utime(1700000000000, 1600000000000).then(() => f.close()).then(() => tjs.stat('/workspace/uvfs-attr.txt'))).then((s) => console.log('uvfs-futime', s.atim.getTime(), s.mtim.getTime()))"`],
    ['run', "printf 'linksrc' > /workspace/uvfs-link-src.txt && echo link-seeded"],
    ['run', `tjs -e "tjs.link('/workspace/uvfs-link-src.txt', '/workspace/uvfs-link-dst.txt').then(() => tjs.readFile('/workspace/uvfs-link-dst.txt')).then((b) => console.log('uvfs-link', new TextDecoder().decode(b)), (e) => console.log('uvfs-link-err', String(e)))"`],
    ['run', "printf 'written-via-dst' > /workspace/uvfs-link-dst.txt && cat /workspace/uvfs-link-src.txt && echo link-write-done"],
    ['run', `tjs -e "tjs.statFs('/workspace').then((s) => console.log('uvfs-statfs', s.bsize, s.blocks > 0, s.bfree <= s.blocks, s.bavail <= s.bfree), (e) => console.log('uvfs-statfs-err', String(e)))"`],
    ['run', `tjs -e "tjs.open('/workspace/uvfs-attr.txt', 'r+').then((f) => f.sync().then(() => console.log('uvfs-fsync ok')).then(() => f.datasync()).then(() => console.log('uvfs-fdatasync ok')).then(() => f.close()), (e) => console.log('uvfs-sync-err', String(e)))"`],
    ['run', `tjs -e "tjs.link('/workspace/uvfs-link-src.txt', '/workspace/uvfs-nlink-x.txt').then(() => tjs.stat('/workspace/uvfs-link-src.txt')).then((s) => console.log('uvfs-nlink', s.nlink), (e) => console.log('uvfs-nlink-err', String(e)))"`],
    ['run', `tjs -e "console.log('uvos-env', tjs.env.PATH === undefined, Object.keys(tjs.env).length, tjs.tmpDir, tjs.system.loadAvg.join(','))"`],
    ['run', `tjs -e "tjs.env.UVOS_A = '1'; const a = tjs.env.UVOS_A; delete tjs.env.UVOS_A; console.log('uvos-set', a, tjs.env.UVOS_A === undefined)"`],
    ['run', `tjs -e "const b = new Uint8Array(32); crypto.getRandomValues(b); const c = new Uint8Array(32); crypto.getRandomValues(c); console.log('uvos-rand', b.some((x) => x !== 0), b.join(',') !== c.join(','), tjs.cwd, tjs.env.HOME === undefined)"`],
    ['run', `tjs -e "let r = 'ok'; try { tjs.chdir('/nope-missing'); } catch (e) { r = 'rejected'; } tjs.chdir('/workspace'); console.log('uvos-info', tjs.pid, tjs.ppid, tjs.system.userInfo.userName, tjs.system.userInfo.homeDir, tjs.system.cpus.length >= 1, tjs.system.networkInterfaces.length, tjs.system.uptime >= 0, r, tjs.exePath, tjs.cwd)"`],
  ]);
  const uvFsLines = uvFs.out.split('\n');
  const uvFsSeen = JSON.stringify(uvFsLines.filter((line) => line.startsWith('uvfs-')).slice(0, 6));
  check('uv_fs_mkdtemp makes a unique directory under a 6-character suffix, and the path is reported to JavaScript', uvFsLines.includes('uvfs-mkdtemp true 22 true true'), uvFsSeen);
  check('uv_fs_mkstemp creates a regular file under a 6-character suffix', uvFsLines.includes('uvfs-mkstemp true 22 true'), uvFsSeen);
  check('uv_fs_mkdtemp rejects a template without XXXXXX', uvFsLines.includes('uvfs-bad-template rejected'), uvFsSeen);
  check('uv_fs_copyfile replaces the destination: a shorter source leaves exactly the source bytes', uvFsLines.includes('uvfs-copy-truncate short'), uvFsSeen);
  check('uv_fs_copyfile copies a 131072-byte file across more than one 64 KiB chunk', uvFsLines.includes('uvfs-copy-big 131072'), uvFsSeen);
  check('uv_fs_copyfile rejects a missing source', uvFsLines.includes('uvfs-copy-missing rejected'), uvFsSeen);
  check('uv_fs_chmod (tjs.chmod) sets the mode bits that stat reports', uvFsLines.includes('uvfs-chmod 384'), uvFsSeen);
  check('uv_fs_fchmod (File.chmod) sets the mode bits that stat reports', uvFsLines.includes('uvfs-fchmod 416'), uvFsSeen);
  check('uv_fs_fchown (File.chown) sets the owner and group that stat reports', uvFsLines.includes('uvfs-fchown 1234 5678'), uvFsSeen);
  check('uv_fs_futime (File.utime) sets the access and modification times that stat reports', uvFsLines.includes('uvfs-futime 1700000000000 1600000000000'), uvFsSeen);
  check('uv_fs_link (tjs.link) makes a second name that reads the same bytes', uvFsLines.includes('uvfs-link linksrc'), uvFsSeen);
  check('uv_fs_link: a write through the new name is seen through the old name', uvFsLines.some((line) => line.includes('written-via-dst')), uvFsSeen);
  check('uv_fs_statfs (tjs.statFs) reports a 4096-byte block size and block counts from the storage quota', uvFsLines.includes('uvfs-statfs 4096 true true true'), uvFsSeen);
  check('uv_fs_fsync (File.sync) completes after the OPFS flush', uvFsLines.includes('uvfs-fsync ok'), uvFsSeen);
  check('uv_fs_fdatasync (File.datasync) completes after the OPFS flush', uvFsLines.includes('uvfs-fdatasync ok'), uvFsSeen);
  check('uv_fs stat reports a hard link\'s real link count (three names after a third link)', uvFsLines.includes('uvfs-nlink 3'), uvFsSeen);
  check('uv_os_getenv and uv_os_environ report an empty environment, and uv_os_tmpdir reports /.thebird', uvFsLines.includes('uvos-env true 0 /.thebird 0,0,0'), uvFsSeen);
  check('uv_os_setenv and uv_os_unsetenv store and remove a variable that uv_os_getenv reads back', uvFsLines.includes('uvos-set 1 true'), uvFsSeen);
  check('uv_random fills bytes from the browser entropy source (non-zero, differs between calls); uv_cwd reports the shell directory', uvFsLines.includes('uvos-rand true true /workspace true'), uvFsSeen);
  check('uv_os_getpid, uv_os_getppid, uv_os_get_passwd, uv_cpu_info, uv_interface_addresses, uv_uptime, uv_chdir and uv_exepath read the browser record; chdir to a missing path is rejected', uvFsLines.includes('uvos-info 1 0 thebird /.thebird true 0 true rejected /.thebird/tjs /workspace'), uvFsSeen);
});
