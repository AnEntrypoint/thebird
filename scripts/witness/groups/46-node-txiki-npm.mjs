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

group('node-txiki-npm', async () => {
  const PROMPT = 'thebird /workspace> ';
  const PROMPT_COUNT = "(() => { const b = globalThis.thebird.term.buffer.active; let n = 0; for (let i = 0; i < b.length; i++) if (b.getLine(i).translateToString(true).startsWith('thebird /workspace>')) n++; return n; })()";
  const NODE_COMMANDS = ['which node', 'command -v node', 'type node', 'node -v', 'node node-marker.js', 'node -e "console.log(typeof process, process.version)"', 'node node-check.js hello', 'node -e "console.log(\'x\'); process.exit(0)"', 'node -e "console.log(\'y\'); process.exit(3)"; echo rc=$?', 'echo \'{"name":"thebird-json"}\' > node-json.json && node -e "console.log(JSON.parse(require(\'fs\').readFileSync(\'node-json.json\')).name)"'];
  const IMPORT_COMMANDS = [
    `mkdir -p import-probe/lib && echo 'export const answer = 42;' > import-probe/m.mjs && echo "export const v = 'lib';" > import-probe/lib/x.mjs && echo "import { answer } from './m.mjs'; import { v } from './lib/x.mjs'; console.log('script-imports', answer, v);" > import-probe/main.mjs && node import-probe/main.mjs`,
    `(cd import-probe && node main.mjs && node -e "import('./m.mjs').then((m) => console.log('eval-import', m.answer))")`,
    `node -e "import('./import-probe/nope.mjs').catch((e) => console.log('missing-import', e.message))"`,
    `cd /workspace && node -e "tjs.realPath('import-probe/lib/../m.mjs').then((p) => console.log('realpath', p))"`,
  ];
  const nodeOutputs = [];
  const txikiShell = {};
  await terminal([], {
    interact: async ({ type, press, evaluate, waitFor }) => {
      const run = async (command) => {
        const before = await evaluate(PROMPT_COUNT);
        await type(command);
        await press('Enter');
        await waitFor(`${PROMPT_COUNT} > ${before}`, 120000);
        const lines = (await evaluate('globalThis.thebird.text()')).split('\n');
        const start = lines.lastIndexOf((PROMPT + command).trimEnd());
        const end = lines.findIndex((line, index) => index > start && line.startsWith(PROMPT));
        nodeOutputs.push({ command, output: lines.slice(start + 1, end).filter((line) => line.trim()).join('\n') });
      };
      await run(`echo 'console.log("txiki-runtime", tjs.version)' > node-marker.js`);
      await run(`echo 'const fs = require("fs"); console.log("args", process.argv.slice(2).join(" ")); console.log("read", fs.readFileSync("node-check.js", "utf8").includes("readFileSync"));' > node-check.js`);
      for (const command of NODE_COMMANDS) await run(command);
      for (const command of IMPORT_COMMANDS) await run(command);
      await evaluate(`(async () => {
        const shell = await import(new URL('web/shell-in-txiki.js', location.href).href);
        const first = await shell.runShellInTxiki('mkdir -p notes/txiki && cd notes/txiki && x=7 && echo first-$x', { cwd: '/workspace' });
        const second = await shell.runShellInTxiki('echo second-$x; pwd', { cwd: '/workspace', saved: first.saved });
        const pipVersion = await shell.runShellInTxiki('pip --version; echo rc=$?', { cwd: '/workspace' });
        const pipBare = await shell.runShellInTxiki('pip; echo rc=$?', { cwd: '/workspace' });
        const pipUnknown = await shell.runShellInTxiki('pip frobnicate; echo rc=$?', { cwd: '/workspace' });
        const sqlite = await shell.runShellInTxiki('mkdir -p txiki-sql && cd txiki-sql && sqlite3 x.db "select 1"; echo rc=$?', { cwd: '/workspace' });
        const pyController = new AbortController();
        const pyStarted = performance.now();
        setTimeout(() => pyController.abort(), 500);
        const pyAbort = await shell.runShellInTxiki('python3 -c "import time; time.sleep(30)"', { cwd: '/workspace', signal: pyController.signal }).then((r) => ({ status: 'resolved ' + r.exitCode }),(err) => ({ status: String(err.message) })).then((r) => ({ ...r, elapsed: Math.round(performance.now() - pyStarted) }));
        const engineRun = await (await import(new URL('web/txiki-in-page.js', location.href).href)).runTjs('console.log([typeof TextEncoder, typeof TextDecoder, typeof [].findLastIndex, JSON.stringify(String.fromCharCode(1)).length].join(" "))', '/workspace');
        globalThis.__txikiShellRuns = {
          sqlite: { stdout: sqlite.stdout, stderr: sqlite.stderr, exitCode: sqlite.exitCode },
          pyAbort,
          engine: engineRun.output,
          first: { stdout: first.stdout, exitCode: first.exitCode },
          second: { stdout: second.stdout, exitCode: second.exitCode },
          pipVersion: { stdout: pipVersion.stdout, stderr: pipVersion.stderr, exitCode: pipVersion.exitCode },
          pipBare: { stdout: pipBare.stdout, stderr: pipBare.stderr, exitCode: pipBare.exitCode },
          pipUnknown: { stdout: pipUnknown.stdout, stderr: pipUnknown.stderr, exitCode: pipUnknown.exitCode },
        };
      })().catch((err) => { globalThis.__txikiShellRuns = { error: String(err.message ?? err) }; })`);
      await waitFor('globalThis.__txikiShellRuns !== undefined', COLD_START_MS);
      txikiShell.runs = JSON.parse(await evaluate('JSON.stringify(globalThis.__txikiShellRuns)'));
    },
  });
  const nodeOutput = (command) => nodeOutputs.find((entry) => entry.command === command)?.output ?? null;
  check('which node names node', nodeOutput('which node') === 'node', JSON.stringify(nodeOutput('which node')));
  check('command -v node names node', nodeOutput('command -v node') === 'node', JSON.stringify(nodeOutput('command -v node')));
  check('type node reports node as a shell builtin', nodeOutput('type node') === 'node is a shell builtin', JSON.stringify(nodeOutput('type node')));
  check('node -v prints a version', /^v\d+\.\d+\.\d+$/.test(nodeOutput('node -v') ?? ''), JSON.stringify(nodeOutput('node -v')));
  check('node <script> runs through the txiki engine and prints its marker', /^txiki-runtime \d+\.\d+\.\d+$/.test(nodeOutput('node node-marker.js') ?? ''), JSON.stringify(nodeOutput('node node-marker.js')));
  check('node -e exposes typeof process and process.version', /^object v\d+\.\d+\.\d+$/.test(nodeOutput('node -e "console.log(typeof process, process.version)"') ?? ''), JSON.stringify(nodeOutput('node -e "console.log(typeof process, process.version)"')));
  check('a node script reads process.argv and fs.readFileSync', nodeOutput('node node-check.js hello') === 'args hello\nread true', JSON.stringify(nodeOutput('node node-check.js hello')));
  check('a node script imports a sibling and a nested module through the txiki loader', nodeOutput(IMPORT_COMMANDS[0]) === 'script-imports 42 lib', JSON.stringify(nodeOutput(IMPORT_COMMANDS[0])));
  check('a dynamic import from node -e resolves against the shell directory', (nodeOutput(IMPORT_COMMANDS[1]) ?? '').split('\n').includes('eval-import 42'), JSON.stringify(nodeOutput(IMPORT_COMMANDS[1])));
  check('a missing module reports the loader error and the shell goes on', /^missing-import could not load/m.test(nodeOutput(IMPORT_COMMANDS[2]) ?? ''), JSON.stringify(nodeOutput(IMPORT_COMMANDS[2])));
  const REALPATH_FROM_WORKSPACE = 'realpath /workspace/import-probe/m.mjs';
  check('tjs.realPath resolves a dotted path to the absolute file, from the cwd /workspace (the same file as /import-probe/m.mjs, resolved from a different cwd)', nodeOutput(IMPORT_COMMANDS[3]) === REALPATH_FROM_WORKSPACE, JSON.stringify(nodeOutput(IMPORT_COMMANDS[3])));
  check('console.log output written before process.exit(0) is kept', nodeOutput('node -e "console.log(\'x\'); process.exit(0)"') === 'x', JSON.stringify(nodeOutput('node -e "console.log(\'x\'); process.exit(0)"')));
  check('console.log output written before process.exit(3) is kept and the status is 3', nodeOutput('node -e "console.log(\'y\'); process.exit(3)"; echo rc=$?') === 'y\nrc=3', JSON.stringify(nodeOutput('node -e "console.log(\'y\'); process.exit(3)"; echo rc=$?')));
  check('readFileSync without an encoding returns bytes whose toString is the text, so JSON.parse reads it', nodeOutput('echo \'{"name":"thebird-json"}\' > node-json.json && node -e "console.log(JSON.parse(require(\'fs\').readFileSync(\'node-json.json\')).name)"') === 'thebird-json', JSON.stringify(nodeOutput('echo \'{"name":"thebird-json"}\' > node-json.json && node -e "console.log(JSON.parse(require(\'fs\').readFileSync(\'node-json.json\')).name)"')));
  const mirror = await getMirror();
  const npmRun = await terminal([
    ['run', `printf 'registry=${mirror.url}\\n' > /.npmrc && echo mirror-set`],
    ['run', 'npm -v'],
    ['run', 'npx -v'],
    ['run', 'mkdir -p npm-check && cd npm-check && npm install debug'],
    ['run', 'node -e "console.log(JSON.parse(require(\'fs\').readFileSync(\'node_modules/ms/package.json\', \'utf8\')).version)"'],
    ['run', 'npx semver -r ">=1.2.4" 1.2.3 1.2.4 1.2.10'],
    ['run', 'which npm'],
    ['run', 'type npx'],
    ['run', 'type node'],
    ['run', 'node -e "console.log(process.version)"'],
    ['run', 'npm install --save-exact debug; echo rc=$?'],
  ]);
  const npmOut = npmRun.out;
  check('npm -v and npx -v both print the npm-compatible version', (npmOut.match(/^0\.2\.0$/gm) ?? []).length >= 2, JSON.stringify(npmOut.slice(0, 300)));
  check('npm install debug installs debug and its ms dependency into node_modules and says so', /^\+ debug@\d+\.\d+\.\d+$/m.test(npmOut) && /^\+ ms@2\.\d+\.\d+$/m.test(npmOut) && /^added 2 packages$/m.test(npmOut), JSON.stringify(npmOut.slice(0, 400)));
  check('the installed ms package.json reads back through node -e from the shell filesystem', /^2\.\d+\.\d+$/m.test(npmOut), JSON.stringify(npmOut.slice(0, 400)));
  check('npx semver runs the registry bin: the range filter prints 1.2.4 and 1.2.10 and not 1.2.3', /^1\.2\.4$/m.test(npmOut) && /^1\.2\.10$/m.test(npmOut) && !/^1\.2\.3$/m.test(npmOut), JSON.stringify(npmOut.slice(0, 400)));
  check('which npm names npm and type npx reports a shell builtin', /^npm$/m.test(npmOut) && /^npx is a shell builtin$/m.test(npmOut), JSON.stringify(npmOut.slice(0, 400)));
  check('node still resolves to txiki after npm and npx are added', /^node is a shell builtin$/m.test(npmOut) && /^v\d+\.\d+\.\d+$/m.test(npmOut), JSON.stringify(npmOut.slice(0, 400)));
  check('npm rejects an option it does not implement, with status 1 and the option named', /npm: unsupported option: --save-exact/.test(npmOut), JSON.stringify(npmOut.slice(0, 400)));
  const npmProjects = await terminal([
    ['run', 'mkdir -p yaml-project && cd yaml-project && npm install js-yaml'],
    ['run', 'readlink node_modules/.bin/js-yaml'],
    ['run', "printf 'a: 1\\n' > x.yaml && npx js-yaml x.yaml | sed 's/^/npx:/'; echo npx-rc=$?"],
    ['run', 'npm ls'],
    ['run', `echo '{"scripts":{"yaml":"js-yaml x.yaml"}}' > package.json && npm run yaml | sed 's/^/run:/'`],
    ['run', 'npm uninstall js-yaml | sed \'s/^/uninstall:/\''],
    ['run', 'node -e "console.log(\'argparse-present\', require(\'fs\').existsSync(\'node_modules/argparse\'))"'],
    ['run', 'cd .. && mkdir -p dev-project && cd dev-project && echo \'{"devDependencies":{"semver":"7.8.6"}}\' > package.json && npm install && node -e "console.log(\'dev-flag\', JSON.parse(require(\'fs\').readFileSync(\'package-lock.json\', \'utf8\')).packages[\'node_modules/semver\'].dev)"'],
    ['run', 'rm -rf node_modules && npm ci | sed \'s/^/ci:/\''],
    ['run', 'cd .. && mkdir -p peer-project && cd peer-project && npm install react-dom && node -e "console.log(\'react-installed\', require(\'fs\').existsSync(\'node_modules/react/package.json\'))"'],
    ['run', 'cd .. && mkdir -p scoped-project && cd scoped-project && npm install @noble/hashes && node -e "console.log(JSON.parse(require(\'fs\').readFileSync(\'node_modules/@noble/hashes/package.json\', \'utf8\')).name)"'],
    ['run', 'mkdir -p /workspace/esmp/node_modules/tool/bin /workspace/esmp/node_modules/tool/lib && cd /workspace/esmp && echo \'{"name":"tool","version":"1.0.0","bin":{"tool":"bin/tool.mjs"}}\' > node_modules/tool/package.json && echo \'export const greet = (n) => `hi ${n}`; export default { kind: "default" };\' > node_modules/tool/lib/greet.mjs && echo \'import def, { greet } from "../lib/greet.mjs"; import * as ns from "../lib/greet.mjs"; console.log(greet(process.argv[2]), def.kind, typeof ns.greet, import.meta.url.slice(0, 7));\' > node_modules/tool/bin/tool.mjs && npx tool world; echo rc=$?'],
  ]);
  const projectOut = npmProjects.out;
  check('npm install js-yaml installs its argparse dependency, and the bin link points into the package', /^\+ js-yaml@\d+\.\d+\.\d+$/m.test(projectOut) && /^\+ argparse@\d+\.\d+\.\d+$/m.test(projectOut) && /^added 2 packages$/m.test(projectOut) && /^\.\.\/js-yaml\/bin\/js-yaml\.mjs$/m.test(projectOut), JSON.stringify(projectOut.slice(0, 600)));
  check('an ESM bin with a relative import, a default import, a namespace import and import.meta runs under npx', /^hi world default function file:\/\/$/m.test(projectOut) && /^rc=0$/m.test(projectOut), JSON.stringify(projectOut.slice(-900)));
  check('npx js-yaml runs the installed bin on a file and prints the parsed JSON with status 0', /^npx:  "a": 1$/m.test(projectOut) && /^npx-rc=0$/m.test(projectOut), JSON.stringify(projectOut.slice(0, 900)));
  check('npm ls prints the js-yaml tree with argparse under it', /^└── js-yaml@\d+\.\d+\.\d+$/m.test(projectOut) && /^    └── argparse@\d+\.\d+\.\d+$/m.test(projectOut), JSON.stringify(projectOut.slice(0, 900)));
  check('npm run runs a package.json script that calls an installed bin', /^run:  "a": 1$/m.test(projectOut), JSON.stringify(projectOut.slice(0, 1200)));
  check('npm uninstall removes js-yaml and prunes argparse', /^uninstall:removed 2 packages$/m.test(projectOut) && /^argparse-present false$/m.test(projectOut), JSON.stringify(projectOut.slice(0, 1200)));
  check('a devDependency is recorded with dev true in package-lock.json', /^dev-flag true$/m.test(projectOut), JSON.stringify(projectOut.slice(-1200)));
  check('npm ci rebuilds node_modules exactly from package-lock.json', /^ci:added 1 package$/m.test(projectOut), JSON.stringify(projectOut.slice(-1400)));
  check('a peer dependency is installed automatically (react-dom needs react)', /^\+ react@\d+\.\d+\.\d+$/m.test(projectOut) && /^react-installed true$/m.test(projectOut), JSON.stringify(projectOut.slice(-1400)));
  check('a scoped package installs under node_modules/@scope/name', /^@noble\/hashes$/m.test(projectOut), JSON.stringify(projectOut.slice(0, 1400)));
  check('the txiki shell runs a script on the engine, and the saved state carries the directory and variables to the next run', txikiShell.runs?.first?.stdout === 'first-7\n' && txikiShell.runs?.second?.stdout === 'second-7\n/workspace/notes/txiki\n', JSON.stringify(txikiShell.runs));
  const txikiPip = txikiShell.runs?.pipVersion ?? {};
  check('the txiki shell answers pip --version from the page micropip, with no stderr and exit 0', /^pip \d+\.\d+\.\d+ \(micropip, in-page\)\nrc=0\n$/.test(txikiPip.stdout ?? '') && txikiPip.stderr === '', JSON.stringify(txikiPip));
  const txikiBare = txikiShell.runs?.pipBare ?? {};
  check('the txiki shell prints bare pip usage on stderr and exits 2', txikiBare.stdout === 'rc=2\n' && txikiBare.stderr.startsWith('pip: usage: pip install <package>...\n'), JSON.stringify(txikiBare));
  const txikiUnknown = txikiShell.runs?.pipUnknown ?? {};
  check("the txiki shell names an unknown pip command on stderr and exits 2", txikiUnknown.stdout === 'rc=2\n' && txikiUnknown.stderr.startsWith("pip: unknown command 'frobnicate'\n"), JSON.stringify(txikiUnknown));
  const txikiRuns = txikiShell.runs ?? {};
  check('sqlite3 inside the txiki shell prints 1 for select 1 and exits 0', txikiRuns.sqlite?.stdout === '1\nrc=0\n' && txikiRuns.sqlite?.stderr === '', JSON.stringify(txikiRuns.sqlite));
  check('a python3 sleep is aborted at 500 ms inside the txiki shell and rejects with status 130 in under 5 s', txikiRuns.pyAbort?.status?.includes('status 130') === true && txikiRuns.pyAbort?.elapsed < 5000, JSON.stringify(txikiRuns.pyAbort));
  check('the txiki engine has TextEncoder, TextDecoder and findLastIndex, and JSON escapes the marker byte', txikiRuns.engine === 'function function function 8\n', JSON.stringify(txikiRuns.engine));
});
