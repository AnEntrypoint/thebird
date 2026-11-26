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

group('hosting-pins', async () => {
const workflow = readFileSync(join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
const scopesIn = (text, indent) => Object.fromEntries([...text.matchAll(new RegExp(`^ {${indent}}([a-z-]+): (read|write)$`, 'gm'))].map((m) => [m[1], m[2]]));
const jobsSection = workflow.slice(workflow.indexOf('\njobs:') + 1);
const jobHeaders = [...jobsSection.matchAll(/^ {2}([a-z]+):\n/gm)];
const jobBlocks = Object.fromEntries(jobHeaders.map((m, i) => [m[1], jobsSection.slice(m.index + m[0].length, jobHeaders[i + 1]?.index ?? jobsSection.length)]));
const topScopes = scopesIn(workflow.slice(0, workflow.indexOf('\njobs:')), 2);
const buildScopes = scopesIn(jobBlocks.build ?? '', 6);
const deployScopes = scopesIn(jobBlocks.deploy ?? '', 6);
const sortedScopes = (scopes) => JSON.stringify(Object.entries(scopes).sort());
const usesRefs = [...workflow.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
check('every action in pages.yml is pinned to a full 40-hex commit SHA', usesRefs.length > 0 && usesRefs.every((ref) => /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(ref)), usesRefs.join(' '));
const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
const desyncFirstPin = (text) => text.replace(/(actions\/[\w.-]+ `)([0-9a-f])/, (match, head, first) => head + (first === '0' ? '1' : '0'));
const desyncFixture = process.env.THEBIRD_WITNESS_FIXTURE === 'desynced-mapping';
const mappingUnderTest = desyncFixture ? desyncFirstPin(agents) : agents;
const pinnedUses = (text) => [...text.matchAll(/uses: ([\w.-]+\/[\w.-]+)@([0-9a-f]{40})/g)].map((m) => ({ action: m[1], sha: m[2] }));
const recordedPins = (text) => [...text.matchAll(/(actions\/[\w.-]+) `([0-9a-f]{40})` \((v\d+)\)/g)].map((m) => ({ action: m[1], sha: m[2], version: m[3] }));
const pinMismatches = (workflowText, agentsText) => {
  const pins = pinnedUses(workflowText);
  const rows = recordedPins(agentsText);
  const found = [];
  for (const pin of pins) if (!rows.some((row) => row.action === pin.action && row.sha === pin.sha)) found.push(`${pin.action}@${pin.sha.slice(0, 7)} is not recorded in AGENTS.md`);
  for (const row of rows) if (!pins.some((pin) => pin.action === row.action && pin.sha === row.sha)) found.push(`${row.action} ${row.sha.slice(0, 7)} (${row.version}) is not used in pages.yml`);
  const distinctPins = [...new Map(pins.map((pin) => [`${pin.action}@${pin.sha}`, pin])).values()];
  if (rows.length !== distinctPins.length) found.push(`count pinned=${distinctPins.length} recorded=${rows.length}`);
  return found;
};
const localMismatches = pinMismatches(workflow, mappingUnderTest);
check('pages.yml SHAs match the AGENTS.md Hosting mapping (local, no network)', localMismatches.length === 0, localMismatches.length ? `mismatch: ${localMismatches.join('; ')}` : `${pinnedUses(workflow).length} pins match`);
const firstRow = recordedPins(agents)[0];
const flipped = (sha) => (sha[0] === '0' ? '1' : '0') + sha.slice(1);
const desyncedMapping = agents.replace(firstRow.sha, flipped(firstRow.sha));
const desyncedWorkflow = workflow.replace(firstRow.sha, flipped(firstRow.sha));
const caughtMapping = pinMismatches(workflow, desyncedMapping);
const caughtWorkflow = pinMismatches(desyncedWorkflow, agents);
check('negative witness: a desynced SHA in either the mapping or pages.yml is caught by the local check', desyncedMapping !== agents && desyncedWorkflow !== workflow && caughtMapping.length > 0 && caughtWorkflow.length > 0, `mapping caught: ${caughtMapping[0] ?? 'none'} | workflow caught: ${caughtWorkflow[0] ?? 'none'}`);
const lookupTag = (action, version) => {
  let reason = 'gh did not run';
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = spawnSync('gh', ['api', `repos/${action}/git/ref/tags/${version}`, '-q', '.object.sha'], { encoding: 'utf8', timeout: 30000 });
    if (out.status === 0) return { resolved: out.stdout.trim() };
    reason = (out.stderr || out.error?.message || 'gh failed').trim().split('\n')[0];
    if (/HTTP 404/.test(reason)) return { missing: reason };
  }
  return { unavailable: reason };
};
const driftVerdict = (workflowText, agentsText, lookup) => {
  const local = pinMismatches(workflowText, agentsText);
  if (local.length) return { status: 'FAIL', detail: `local mismatch: ${local.join('; ')}` };
  const remote = recordedPins(agentsText).map((row) => ({ ...row, ...lookup(row.action, row.version) }));
  const moved = remote.filter((row) => row.resolved && row.resolved !== row.sha);
  const missingTags = remote.filter((row) => row.missing);
  if (moved.length || missingTags.length) return { status: 'FAIL', detail: `drift: ${[...moved.map((row) => `${row.action}@${row.version} is ${row.resolved.slice(0, 7)}, pinned ${row.sha.slice(0, 7)}`), ...missingTags.map((row) => `${row.action}@${row.version} ${row.missing}`)].join('; ')}` };
  const unavailable = remote.filter((row) => row.unavailable);
  if (unavailable.length) return { status: 'UNVERIFIED', detail: `network-unavailable — ${unavailable[0].unavailable}` };
  return { status: 'PASS', detail: remote.map((row) => `${row.action}@${row.version}=${row.resolved.slice(0, 7)}`).join(' ') };
};
const offlineLookup = (action, version) => {
  const saved = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    return lookupTag(action, version);
  } finally {
    process.env.PATH = saved;
  }
};
const verdict = driftVerdict(workflow, mappingUnderTest, desyncFixture ? offlineLookup : lookupTag);
if (verdict.status === 'FAIL') check('every AGENTS.md tag still resolves on GitHub to the SHA pages.yml pins (gh)', false, verdict.detail);
else if (verdict.status === 'UNVERIFIED') console.log(`UNVERIFIED every AGENTS.md tag still resolves on GitHub to the SHA pages.yml pins (gh): ${verdict.detail}`);
else check('every AGENTS.md tag still resolves on GitHub to the SHA pages.yml pins (gh)', true, verdict.detail);
const offlineProbe = offlineLookup(firstRow.action, firstRow.version);
const maskedDrift = driftVerdict(workflow, desyncedMapping, offlineLookup);
check('network-unavailable cannot mask drift: with gh unavailable and a desynced mapping SHA, the verdict is FAIL', Boolean(offlineProbe.unavailable) && maskedDrift.status === 'FAIL', `gh=${offlineProbe.unavailable ?? 'available'} verdict=${maskedDrift.status} ${maskedDrift.detail}`);
const offlineMatch = driftVerdict(workflow, agents, offlineLookup);
check('gh unavailable with every pin matching gives UNVERIFIED and no FAIL', Boolean(offlineProbe.unavailable) && offlineMatch.status === 'UNVERIFIED', `verdict=${offlineMatch.status} ${offlineMatch.detail}`);
check('negative control: a tag that resolves to another SHA is a FAIL when gh is available', driftVerdict(workflow, agents, () => ({ resolved: flipped(firstRow.sha) })).status === 'FAIL', 'a moved tag is reported as drift');
check('negative control: a desynced mapping SHA is a FAIL when gh is available', driftVerdict(workflow, desyncedMapping, () => ({ resolved: firstRow.sha })).status === 'FAIL', 'the local mismatch is not hidden by a matching remote');
check('pages.yml gives the build job contents read only, and the deploy job only pages and id-token write', sortedScopes(topScopes) === sortedScopes({ contents: 'read' }) && sortedScopes(buildScopes) === sortedScopes({ contents: 'read' }) && sortedScopes(deployScopes) === sortedScopes({ pages: 'write', 'id-token': 'write' }), `top=${JSON.stringify(topScopes)} build=${JSON.stringify(buildScopes)} deploy=${JSON.stringify(deployScopes)}`);
check('the Pages artifact leaves out floosie while no page module imports it', (() => { const imports = readdirSync(join(root, 'web')).filter((f) => /\.js$/.test(f)).some((f) => readFileSync(join(root, 'web', f), 'utf8').includes('vendor/floosie')); const built = readFileSync(join(root, 'scripts', 'build-pages.mjs'), 'utf8').includes("join(root, 'web', 'vendor', 'floosie')"); return !imports && built; })(), 'no web/*.js imports vendor/floosie; build-pages filters it from the artifact');
check('pages.yml builds floosie browser bundle from latest floosie main before the page build', /repository: AnEntrypoint\/floosie/.test(workflow) && /path: floosie/.test(workflow) && /FLOOSIE_REPO: \$\{\{ github\.workspace \}\}\/floosie/.test(workflow) && workflow.indexOf('node scripts/vendor-floosie.mjs') < workflow.indexOf('node scripts/build-pages.mjs') && /test -s web\/vendor\/floosie\/browser\.js/.test(workflow), 'floosie checkout, FLOOSIE_REPO, vendor script, asset check and build order');
check('pages.yml rebuilds fx from gmfx only when GMFX_TOKEN is set, and always verifies the committed fx against its manifest', /if: env\.GMFX_TOKEN != ''/.test(workflow) && /token: \$\{\{ env\.GMFX_TOKEN \}\}/.test(workflow) && /FX_REPO: \$\{\{ github\.workspace \}\}\/gmfx/.test(workflow) && /node scripts\/vendor-fx\.mjs --verify/.test(workflow) && !/^\s*repository: AnEntrypoint\/gmfx\n\s*ref: main\n\s*path: gmfx\n\s*\n/m.test(workflow) && workflow.indexOf('--verify') < workflow.indexOf('node scripts/build-pages.mjs'), 'gated gmfx checkout and rebuild, verify step before the page build')
check('committed web/vendor/fx matches its manifest hashes (no checkout needed)', (() => { const r = spawnSync(process.execPath, [join(root, 'scripts', 'vendor-fx.mjs'), '--verify'], { encoding: 'utf8' }); return r.status === 0; })(), 'node scripts/vendor-fx.mjs --verify');
check('the desynced-mapping fixture is used only when THEBIRD_WITNESS_FIXTURE is set', desyncFixture ? mappingUnderTest !== agents : mappingUnderTest === agents, `fixture=${desyncFixture}`);
});
