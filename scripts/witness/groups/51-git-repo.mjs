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

group('git-repo', async () => {
  const version = await terminal([['run', 'git --version']]);
  check('in-page git --version names the in-page library, not a host git', /^git version \S+ \(in-page, isomorphic-git\)$/m.test(version.out), version.out.split('\n').find((line) => line.startsWith('git')) ?? version.out.slice(0, 140));
  const repo = await terminal([
    ['run', 'mkdir -p notes'],
    ['run', 'git init'],
    ['run', 'echo one > notes/a.txt'],
    ['run', 'echo readme > README.md'],
    ['run', 'echo agents > AGENTS.md'],
    ['run', 'echo arch > ARCHITECTURE.md'],
    ['run', 'git add notes/a.txt README.md AGENTS.md ARCHITECTURE.md'],
    ['run', 'git commit -m first'],
    ['run', 'echo design > DESIGN.md'],
    ['run', 'git add DESIGN.md'],
    ['run', 'git commit -m first'],
    ['run', 'git log'],
  ]);
  check('in-page git commit without DESIGN.md is refused and names it', repo.out.includes('commit refused by the in-page gate') && repo.out.includes('DESIGN.md is not in the commit'), repo.out.split('\n').find((line) => line.includes('DESIGN.md is not in the commit'))?.slice(0, 160) ?? 'no refusal line');
  check('in-page git inits and stages over OPFS', repo.engine === 'ready' && repo.out.includes('Initialized empty Git repository') && repo.out.includes('staged 1 path'), repo.out.split('\n').slice(0, 3).join(' / ').slice(0, 140));
  const committedSha = repo.out.match(/committed ([0-9a-f]{7})/)?.[1];
  const headSha = repo.out.match(/^([0-9a-f]{7}) first$/m)?.[1];
  check('in-page git commit runs the gate and sets HEAD', repo.out.includes('gate smoke:') && repo.out.includes('gate syntax:') && committedSha !== undefined && committedSha === headSha, `committed ${committedSha} / log HEAD ${headSha}`);
  const branchOne = await terminal([
    ['run', 'git branch'],
    ['run', 'git branch feature-x'],
    ['run', 'git checkout feature-x'],
    ['run', 'git status'],
    ['run', 'echo branch-change > notes/a.txt'],
    ['run', 'git add notes/a.txt'],
    ['run', 'git commit -m branch-change'],
    ['run', 'git commit -m nothing-staged'],
    ['run', 'git branch'],
  ]);
  check('git commit with nothing staged is refused by the gate', branchOne.out.includes('commit refused by the in-page gate') && branchOne.out.includes('staged: nothing staged'), branchOne.out.split('\n').find((line) => line.includes('nothing staged'))?.slice(0, 160) ?? 'no refusal line');
  const original = branchOne.out.match(/^\* (\S+)$/m)?.[1];
  check('in-page git lists branches, creates one and switches to it', original !== undefined && branchOne.out.includes('created branch feature-x') && branchOne.out.includes('switched to feature-x') && /^## feature-x$/m.test(branchOne.out) && /^\* feature-x$/m.test(branchOne.out), `original ${original}`);
  const branchTwo = await terminal([
    ['run', `git checkout ${original ?? 'missing'}`],
    ['run', 'cat notes/a.txt'],
    ['run', 'git status'],
    ['run', 'git checkout no-such-branch'],
    ['run', 'git branch'],
  ]);
  check('in-page git checkout restores the working tree of the branch it returns to', original !== undefined && branchTwo.out.includes(`switched to ${original}`) && /^one$/m.test(branchTwo.out) && !/^branch-change$/m.test(branchTwo.out) && new RegExp(`^\\* ${original}$`, 'm').test(branchTwo.out), branchTwo.out.split('\n').slice(0, 4).join(' / ').slice(0, 160));
  check('in-page git checkout refuses an unknown branch and leaves HEAD where it was', /^git: Could not find .*no-such-branch/m.test(branchTwo.out) && !branchTwo.out.includes('switched to no-such-branch') && new RegExp(`^\\* ${original}$`, 'm').test(branchTwo.out), branchTwo.out.split('\n').find((line) => line.includes('no-such-branch') && !line.startsWith('thebird>'))?.slice(0, 160) ?? 'no refusal line');
  const remote = await terminal([['run', 'git clone https://example.com/thebird.git']]);
  check('in-page git clone is refused before any request is made', remote.out.includes('git clone: remote access is refused in the in-page shell before any request is made'), remote.out.split('\n').find((line) => line.startsWith('git')) ?? remote.out.slice(0, 140));
  const broken = await terminal([
    ['run', 'mkdir -p notes'],
    ['run', 'git init'],
    ['run', 'echo "const =" > notes/bad.js'],
    ['run', 'echo café > notes/u.txt'],
    ['run', 'git add notes/bad.js notes/u.txt'],
    ['run', 'git commit -m broken'],
  ]);
  check('in-page git commit refuses broken syntax and non-ASCII and names both', broken.out.includes('commit refused by the in-page gate') && broken.out.includes('syntax:') && broken.out.includes('ascii:'), broken.out.split('\n').find((line) => line.includes('refused by the in-page gate'))?.slice(0, 160) ?? 'no refusal line');
});
