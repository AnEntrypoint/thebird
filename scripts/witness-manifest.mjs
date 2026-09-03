#!/usr/bin/env node
// Tagged manifest + runner for scripts/witness-*.mjs.
//
// Each entry maps a witness script to the tag(s) describing what it exercises:
//   core     — shell boot / WM / camera / responsive chrome, no LLM or freddie
//   apps     — app-open / app-function / UI-interaction matrices
//   chat     — the OS chat panel/composer/config/transcript surface
//   freddie  — freddie dashboard / gm-skill / acptoapi bridge (slow: cold-loads
//              plugkit.wasm, needs a live acptoapi daemon for the roundtrip ones)
//   perf     — stress/churn/responsive sweeps and long-settle probes
//   demos    — headline/demo-flow scripts (bird-research, rename, launcher, index)
//
// A script commonly carries more than one tag; `--tag=` matching is OR across
// the requested tags (a script runs if ANY of its tags match ANY requested tag).
//
// Usage:
//   node scripts/witness-manifest.mjs                    # run everything
//   node scripts/witness-manifest.mjs --tag=core          # one tag
//   node scripts/witness-manifest.mjs --tag=core,apps      # comma-separated
//   node scripts/witness-manifest.mjs --tag=core --tag=apps # repeatable
//   node scripts/witness-manifest.mjs --url=http://localhost:3000/os.html
//   node scripts/witness-manifest.mjs --concurrency=2
//
// Every script targets the SAME dev server (default http://localhost:3000/os.html,
// matching witness-lib.mjs's DEFAULT_URL and docs/MANUAL-VALIDATION.md) — none of
// them parameterize a distinct server port per script. "Instance" in script
// comments means thebird's in-page multi-tab-like virtual instance concept, not
// a separate origin/port. Because every script drives its OWN isolated puppeteer
// browser context (bootBrowser() launches a fresh browser per script) but they
// all read/write the SAME origin's IndexedDB (shell/session state persists per
// browser profile, not per-origin-across-processes — puppeteer.launch() with no
// userDataDir gets an ephemeral temp profile per process) concurrent runs do NOT
// collide on shared storage. They DO compete for CPU/memory (many headless
// Chromium + the plugkit/bert wasm cold-loads per process), which is the known
// historical flakiness source that got validate.yml removed — so default
// concurrency is 1 (serial) and must be raised explicitly via --concurrency=N.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// name -> { tags, args? } — args default to [] (script uses its own default URL).
// Entries MUST mirror the real on-disk scripts/witness-*.mjs probe set (the
// drift guard in main() hard-fails on a manifest entry missing on disk and
// warns on an unlisted probe) — witness-lib.mjs (helper), witness-all.mjs and
// witness-manifest.mjs (runners) are deliberately not probes.
export const MANIFEST = {
  // both default to the LIVE anentrypoint.github.io/thebird/ deployed URL (not
  // localhost) — a deployed-site smoke check, not a local-dev-server regression
  // test, so 'demos' only (a --tag=core CI run must never depend on live network).
  'witness-index.mjs':          { tags: ['demos'] },
  'witness-live-probe.mjs':     { tags: ['demos'] },
  // waits up to ~150s for the full plugkit.wasm cold-load + freddie
  // auto-open (see the script's own comment) — freddie-tagged, not core, so
  // a plain --tag=core CI run never triggers a wasm cold-load.
  'witness-autoboot.mjs':       { tags: ['freddie'] },
  'witness-app-matrix.mjs':     { tags: ['core', 'apps'] },
  'witness-app-functions.mjs':  { tags: ['apps'] },
  'witness-edge-cases.mjs':     { tags: ['core', 'apps'] },
  'witness-ui-interactions.mjs':{ tags: ['apps', 'core'] },
  'witness-deep-churn.mjs':     { tags: ['apps', 'perf', 'freddie'] },
  'witness-wm-persist.mjs':     { tags: ['core'] },
  // defaults to the LIVE deployed URL like witness-index/live-probe above.
  'witness-launcher.mjs':       { tags: ['demos'] },
  'witness-rename.mjs':         { tags: ['core', 'demos'] },
  // polls up to 90s for freddie's autoboot window before sweeping viewports —
  // slow and freddie-adjacent, not a fast core check.
  'witness-responsive.mjs':     { tags: ['perf'] },
  // merged camera spec (t11-witness-merge): absorbs the former
  // witness-desktop-camera / witness-camera-gestures / witness-camera-input /
  // witness-camera-persist scripts as 4 isolated cases — all core.
  'witness-camera.mjs':         { tags: ['core'] },
  'witness-fsbrowse.mjs':       { tags: ['apps', 'core'] },
  'witness-opfs-fs.mjs':        { tags: ['core'] },
  'witness-browser-pane.mjs':   { tags: ['apps', 'demos'] },
  'witness-audit-log.mjs':      { tags: ['core'] },
  'witness-git-sync.mjs':       { tags: ['apps', 'perf'] },
  // polls window.__debug.gm.dispatch readiness (plugkit.wasm cold-load) before
  // running any assertion — freddie-only, not core.
  'witness-libsql-native.mjs':  { tags: ['freddie'] },
  // merged chat spec (t11-witness-merge): absorbs witness-chat-config /
  // witness-chat-roundtrip / witness-chat-scroll / witness-chat-seed-large /
  // witness-ws-chat as 5 isolated cases; the roundtrip/wsChat cases need a live
  // acptoapi daemon (freddie), seedLarge is the perf-flavoured one. The wsChat
  // case self-gates (excluded from the script's own exit code), so no
  // KNOWN_NON_BLOCKING entry is needed for it here.
  'witness-chat.mjs':           { tags: ['chat', 'freddie', 'perf'] },
  'witness-gm-dispatch.mjs':    { tags: ['freddie'] },
  // merged freddie spec (t11-witness-merge): absorbs witness-freddie-diag /
  // witness-freddie-gm-tool / witness-freddie-gui / witness-freddie-render as
  // 4 isolated cases.
  'witness-freddie.mjs':        { tags: ['freddie', 'demos', 'chat'] },
  'witness-interactive.mjs':    { tags: ['apps', 'freddie'] },
  'witness-bird-research.mjs':  { tags: ['freddie', 'demos', 'perf'] },
  // fast DOM-only ARIA assertions on windows/menubar/instance-switcher —
  // no wasm, no network: core.
  'witness-a11y.mjs':           { tags: ['core'] },
};

const ALL_TAGS = ['core', 'apps', 'chat', 'freddie', 'perf', 'demos'];

function parseArgs(argv) {
  const tags = [];
  let url;
  let concurrency = 1;
  let list = false;
  for (const a of argv) {
    if (a.startsWith('--tag=')) tags.push(...a.slice(6).split(',').map(s => s.trim()).filter(Boolean));
    else if (a.startsWith('--url=')) url = a.slice(6);
    else if (a.startsWith('--concurrency=')) concurrency = Math.max(1, parseInt(a.slice(14), 10) || 1);
    else if (a === '--list') list = true;
  }
  return { tags, url, concurrency, list };
}

function selectScripts(tags) {
  const names = Object.keys(MANIFEST);
  if (!tags.length) return names;
  return names.filter(n => MANIFEST[n].tags.some(t => tags.includes(t)));
}

// Drift guard: the MANIFEST must mirror the real on-disk probe set. A stale
// entry (deleted/renamed script) is a hard error; an on-disk probe with no
// manifest entry is a warning (it still runs under witness-all.mjs, just not
// via tags). Runner/helper modules are not probes and are exempt.
const NON_PROBE_SCRIPTS = new Set(['witness-lib.mjs', 'witness-all.mjs', 'witness-manifest.mjs']);
function checkManifestDrift() {
  const onDisk = fs.readdirSync(__dirname)
    .filter(f => f.startsWith('witness-') && f.endsWith('.mjs') && !NON_PROBE_SCRIPTS.has(f));
  const missing = Object.keys(MANIFEST).filter(n => !onDisk.includes(n));
  const unlisted = onDisk.filter(f => !MANIFEST[f]);
  for (const n of missing) console.error(`[witness-manifest] STALE ENTRY: ${n} is in MANIFEST but not on disk — update scripts/witness-manifest.mjs`);
  for (const f of unlisted) console.error(`[witness-manifest] WARNING: ${f} exists on disk but has no MANIFEST entry`);
  return missing.length === 0;
}

function runOne(name, url) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, name);
    const args = url ? [scriptPath, url] : [scriptPath];
    const startedAt = Date.now();
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => {
      resolve({
        name,
        code,
        pass: code === 0,
        durationMs: Date.now() - startedAt,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-2000),
      });
    });
    child.on('error', err => {
      resolve({ name, code: null, pass: false, durationMs: Date.now() - startedAt, stdout, stderr: String(err) });
    });
  });
}

async function runPool(names, url, concurrency) {
  const results = [];
  let idx = 0;
  // Puppeteer infrastructure-crash signature (renderer OOM on the bert.wasm
  // cold-load under serial Chromium churn, late SW/controllerchange
  // navigation replacing the frame mid-evaluate): the probe dies on a stale
  // handle having evaluated ZERO assertions. This is the documented
  // environmental flake class that got the witness CI workflows abandoned
  // (see AGENTS.md), NOT a real assertion failure — so a failed run whose
  // stderr carries this signature AND whose stdout records no real failing
  // assertion gets exactly ONE transparent retry. Real assertion failures
  // (exit 1 with '"pass": false' in the report) never retry.
  const INFRA_CRASH = /Attempted to use detached Frame|Target closed|Target crashed|Session closed|Connection closed/i;
  const isInfraCrash = r => {
    if (r.pass) return false;
    // every recorded failing assertion must itself be an infra-crash detail
    // (scripts like witness-camera.mjs catch the crash and record it as a
    // `<case>.crashed` entry); a single genuine assertion failure anywhere in
    // the report disqualifies the retry.
    const failures = [...r.stdout.matchAll(/"pass": false/g)];
    if (!failures.length) return INFRA_CRASH.test(r.stderr);
    return failures.every(m => INFRA_CRASH.test(r.stdout.slice(m.index, m.index + 1200)));
  };
  async function worker() {
    while (idx < names.length) {
      const i = idx++;
      const name = names[i];
      process.stderr.write(`[witness-manifest] running ${name}...\n`);
      let r = await runOne(name, url);
      if (isInfraCrash(r)) {
        process.stderr.write(`[witness-manifest] ${name} crashed on puppeteer infrastructure (detached frame / closed target), no assertions evaluated — retrying once...\n`);
        const retry = await runOne(name, url);
        retry.retried = true;
        r = retry;
      }
      process.stderr.write(`[witness-manifest] ${name} -> ${r.pass ? 'PASS' : 'FAIL'}${r.retried ? ' (after 1 infra-crash retry)' : ''} (${r.durationMs}ms)\n`);
      results.push(r);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, names.length) }, () => worker());
  await Promise.all(workers);
  // restore original order for a stable report regardless of completion order
  const order = new Map(names.map((n, i) => [n, i]));
  results.sort((a, b) => order.get(a.name) - order.get(b.name));
  return results;
}

async function main() {
  const { tags, url, concurrency, list } = parseArgs(process.argv.slice(2));
  const unknown = tags.filter(t => !ALL_TAGS.includes(t));
  if (unknown.length) {
    console.error(`Unknown tag(s): ${unknown.join(', ')} — valid tags: ${ALL_TAGS.join(', ')}`);
    process.exit(2);
  }
  if (!checkManifestDrift()) process.exit(2);
  const scripts = selectScripts(tags);

  if (list) {
    for (const n of scripts) console.log(`${n}\t${MANIFEST[n].tags.join(',')}`);
    return;
  }

  if (!scripts.length) {
    console.error('No witness scripts matched the requested tag(s).');
    process.exit(2);
  }

  console.error(`[witness-manifest] tags=${tags.length ? tags.join(',') : '(all)'} concurrency=${concurrency} scripts=${scripts.length}`);
  const results = await runPool(scripts, url, concurrency);

  // Mirrors witness-all.mjs's own KNOWN_NON_BLOCKING gate: a script that
  // deliberately reports a genuine failing assertion against a currently-
  // unimplemented upstream feature (rather than a defect in thebird's own
  // code) must not permanently gate CI red until that upstream feature
  // ships. Kept as a separate local set (not shared/imported from
  // witness-all.mjs) since witness-manifest.mjs is runnable standalone
  // against a subset of tags and must not depend on witness-all.mjs's
  // module surface.
  // Currently empty: the sole former member (witness-ws-chat.mjs, acptoapi
  // has no /v1/ws route yet) was merged into witness-chat.mjs's wsChat case
  // (t11-witness-merge), which self-gates — its wsChat.* keys are printed but
  // excluded from that script's own exit code.
  const KNOWN_NON_BLOCKING = new Set([
  ]);

  console.log('\n=== witness-manifest summary ===');
  for (const r of results) {
    const nonBlocking = !r.pass && KNOWN_NON_BLOCKING.has(r.name);
    const status = r.pass ? 'PASS' : (nonBlocking ? 'KNOWN' : 'FAIL');
    console.log(`${status}  ${r.name}  (exit ${r.code}, ${r.durationMs}ms${r.retried ? ', retried after infra crash' : ''})`);
  }
  const failed = results.filter(r => !r.pass && !KNOWN_NON_BLOCKING.has(r.name));
  const nonBlockingFailed = results.filter(r => !r.pass && KNOWN_NON_BLOCKING.has(r.name));
  console.log(`\n${results.length - failed.length - nonBlockingFailed.length}/${results.length} passed` + (nonBlockingFailed.length ? ` (${nonBlockingFailed.length} known-non-blocking excluded)` : '') + '.');
  if (failed.length || nonBlockingFailed.length) {
    console.log('\n--- failure detail ---');
    for (const r of [...failed, ...nonBlockingFailed]) {
      console.log(`\n# ${r.name} (exit ${r.code})`);
      if (r.stdout) console.log('stdout (tail):\n' + r.stdout);
      if (r.stderr) console.log('stderr (tail):\n' + r.stderr);
    }
  }
  process.exit(failed.length ? 1 : 0);
}

// Only auto-run when invoked directly (node scripts/witness-manifest.mjs),
// not when imported (e.g. by a cross-check script or a future test harness).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
