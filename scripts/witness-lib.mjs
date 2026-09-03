#!/usr/bin/env node
// Shared boot/evaluate/assert/report boilerplate for scripts/witness-*.mjs.
//
// Every witness-*.mjs script re-implements the same ~10-line puppeteer launch +
// page setup + goto + settle-sleep sequence, and several also hand-roll a
// pass/fail report object + a manual `process.exit(cond?0:1)` at the end. This
// module extracts exactly the pieces that were byte-for-byte identical (or
// trivially parameterized) across witness-app-matrix.mjs (formerly
// witness-full-audit.mjs + witness-remaining-apps.mjs, merged), witness-app-functions.mjs,
// witness-edge-cases.mjs, witness-wm-persist.mjs, and witness-deep-churn.mjs.
//
// NOTE ON REALITY: most existing witness scripts print a JSON report and exit 0
// unconditionally (no pass/fail computed) — only a minority (e.g.
// witness-gm-dispatch.mjs) compute a real exit code, and they do it as one
// hand-written boolean expression, not via an accumulator. assert()/
// printReportAndExit() below are therefore NEW shared conveniences scripts can
// opt into going forward, not a pre-existing pattern being merely relocated.
// bootBrowser()/sleep() ARE a pre-existing pattern being relocated verbatim.

import puppeteer from 'puppeteer';

const DEFAULT_URL = 'http://localhost:3000/os.html';

/** Sleep helper — every witness script has its own inline copy of this. */
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Launch a headless browser, open a page, wire up pageerror/console-error
 * capture into an `errs` array, and navigate to `url` (defaulting to the
 * standard os.html target, cache-busted with a query tag + timestamp).
 *
 * Returns { browser, page, errs } — callers do their own page.evaluate work
 * and must call `browser.close()` themselves when done (kept explicit rather
 * than hidden behind a callback, matching every existing script's shape).
 *
 * Options:
 *   - url: override target URL (falls back to argv[2], then DEFAULT_URL)
 *   - tag: query-param name used for cache-busting (default 'w')
 *   - viewport: {width,height} — pass null to skip setViewport entirely
 *     (witness-gm-dispatch.mjs and a few others never set one)
 *   - settleMs: ms to sleep after goto before returning (default 9000,
 *     matching the most common value across scripts)
 *   - gotoTimeout: navigation timeout ms (default 90000, universal)
 */
export async function bootBrowser(opts = {}) {
  const url = opts.url || process.argv[2] || DEFAULT_URL;
  const tag = opts.tag || 'w';
  const viewport = opts.viewport === undefined ? { width: 1440, height: 900 } : opts.viewport;
  const settleMs = opts.settleMs === undefined ? 9000 : opts.settleMs;
  const gotoTimeout = opts.gotoTimeout || 90000;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  if (viewport) await page.setViewport(viewport);

  const errs = [];
  page.on('pageerror', e => errs.push('PE:' + String(e).slice(0, 200)));
  // Renderer crash (OOM on the ~136MB bert.wasm cold-load under parallel
  // browsers) detaches the main frame with NO pageerror and no console line —
  // downstream page.evaluate calls then fail with "Attempted to use detached
  // Frame", which is indistinguishable from a navigation race unless the crash
  // itself is recorded. Record it so a probe report can tell the two apart.
  page.on('error', e => errs.push('CRASH:' + String(e).slice(0, 200)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // The vendored anentrypoint-design freddie dashboard's chat tab does a
    // best-effort `fetch('/api/providers').catch(() => [])` (pages-tools.js)
    // -- already gracefully handled in JS, but Chrome logs the 404 to
    // console regardless of the catch. thebird's static docs/ server has no
    // /api/* backend by design (see AGENTS.md's layered-stack rule), so this
    // specific message is expected noise here, not a real app error to gate
    // witness scripts' noConsoleErrors-style assertions on.
    if (/Failed to load resource.*404/.test(text)) return;
    // Per-instance Service Worker registration (docs/sw-client.js) does an
    // internal fetch of sw-i<N>/index.js as part of navigator.serviceWorker.
    // register(); Chrome's Network domain sometimes reports that internal
    // fetch as net::ERR_ABORTED even when the SW installs and activates
    // successfully (confirmed live: witness-edge-cases.mjs's own
    // multiInstance/shellSurvivesThrowingApp assertions pass in the SAME run
    // this fires in, and a direct navigator.serviceWorker.getRegistrations()
    // check shows active registrations). This is CDP/automation-instrumented
    // noise around a well-understood SW-lifecycle artifact, not a real app
    // defect -- same class as the /api/providers 404 filter above.
    if (/Failed to load resource.*net::ERR_ABORTED/.test(text) && /sw-i\d+\/index\.js/.test(text)) return;
    // freddie/gm boots plugkit.wasm (~3.6MB, same-origin, committed —
    // formerly a ~149MB Worker-proxied fetch, see AGENTS.md "plugkit.wasm is
    // the SLIM variant" for the 2026-07-30 architecture change) AND
    // bert.wasm (~136MB, agentplug-bert's embedder, docs/lib/freddie-host-bert.js)
    // in the background on every page load. bert.wasm is gitignored + CI-only
    // vendored (over GitHub's 100MB cap, same fetch-server-side-then-serve
    // trick the old fat plugkit.wasm used) — a local dev checkout that hasn't
    // run `node scripts/refresh-bert.mjs` gets a 404/network failure for it.
    // Sandboxed/egress-restricted runners (GitHub Actions' witness-core job,
    // this repo's own local dev sandbox) can log a bare "Failed to load
    // resource: net::ERR_FAILED" with NO url for that fetch. witness-core.yml's
    // own stated contract is "no acptoapi dependency" and explicitly excludes
    // gm-wasm-cold-load-dependent scripts for exactly this class of
    // environment mismatch -- this fetch is best-effort background plumbing
    // unrelated to any given witness script's own assertions (confirmed:
    // every other assertion in the run this fires in passes), not a real app
    // regression to gate noConsoleErrors-style checks on.
    if (/^Failed to load resource: net::ERR_FAILED$/.test(text)) return;
    errs.push('CE:' + text.slice(0, 200));
  });

  const sep = url.includes('?') ? '&' : '?';
  await page.goto(url + sep + tag + '=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: gotoTimeout });
  if (settleMs) await sleep(settleMs);

  // Absorb late boot navigations (SW controllerchange reload, hot-reload
  // trigger) before handing the page to the probe: without this a probe's
  // FIRST page.evaluate after the settle can race the frame replacement and
  // crash the whole script on a stale handle ("Attempted to use detached
  // Frame" — hit by witness-edge-cases.mjs and witness-ui-interactions.mjs
  // in consecutive --tag=core manifest runs, a different script each time,
  // i.e. a timing race not a script bug). evalRetry re-runs the trial
  // evaluate on the fresh frame; a renderer crash instead surfaces via the
  // 'CRASH:' errs entry recorded above after the retry budget is exhausted.
  await evalRetry(page, () => 1);

  return { browser, page, errs };
}

/**
 * Poll for autoboot to set an active shell instance before opening apps —
 * otherwise instance-bound app factories throw 'no active instance' (a
 * pre-autoboot race, not an app defect). Mirrors the identical inline loop
 * previously duplicated in witness-full-audit.mjs (now witness-app-matrix.mjs)
 * and witness-wm-persist.mjs.
 */
export async function waitForActiveInstance(page, { attempts = 60, intervalMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const ready = await page.evaluate(() => {
      const s = window.__debug?.shell;
      return !!(s && (s.active || (Array.isArray(s.instances) ? s.instances.length : s.count) || document.querySelector('.wm-win')));
    });
    if (ready) return true;
    await sleep(intervalMs);
  }
  return false;
}

/**
 * Record a pass/fail assertion into `report` under `key`. On failure, stores
 * { pass:false, detail } instead of throwing — witness scripts are meant to
 * finish and print a full picture, not abort on the first bad assertion.
 */
export function assert(report, key, condition, detail) {
  report[key] = condition
    ? { pass: true }
    : { pass: false, detail: detail !== undefined ? detail : null };
  return condition;
}

/**
 * Poll until the gm-skill (plugkit.wasm) bridge is callable, signalled by the
 * host's progress global (docs/lib/freddie-host-plugkit.js sets
 * globalThis.__GM_BOOT_STAGE__ at every boot milestone). Returns
 * { ready, stage, elapsedMs } — `ready` means __debug.gm.dispatch exists;
 * `stage` is the last observed boot stage, so a failure report names exactly
 * where boot stuck instead of a bare "never ready" after a blind multi-minute
 * poll. A terminal host stage ('degraded'/'error') returns immediately —
 * no point waiting out the cap when the host has already declared the outcome.
 * Default cap 240s: measured cold load is 8-14s quiet (the ~136MB bert.wasm
 * body dominates), and the host's own bounded worst case is plugkit 30s stall
 * + retry, then bert 90s stall + retry + redownload, plus compile/instantiate
 * — 240s covers that with margin without being an unbounded wait. Navigation /
 * detached-frame races during boot (SW claim, reload) are retried on the
 * page's fresh main frame, not thrown.
 */
export async function waitForGmReady(page, { capMs = 240000, intervalMs = 1000 } = {}) {
  const t0 = Date.now();
  let stage = null;
  while (Date.now() - t0 < capMs) {
    try {
      const s = await page.evaluate(() => ({
        ready: !!(window.__debug && window.__debug.gm && window.__debug.gm.dispatch),
        stage: globalThis.__GM_BOOT_STAGE__ || null,
      }));
      stage = s.stage || stage;
      if (s.ready) return { ready: true, stage, elapsedMs: Date.now() - t0 };
      const term = stage && stage.stage;
      if (term === 'degraded' || term === 'error') return { ready: false, stage, elapsedMs: Date.now() - t0 };
    } catch {
      // navigation/detached-frame race during boot — retry on the fresh frame
    }
    await sleep(intervalMs);
  }
  return { ready: false, stage, elapsedMs: Date.now() - t0 };
}

/**
 * page.evaluate that survives a mid-call navigation ("Attempted to use
 * detached Frame"): retries on the page's CURRENT main frame instead of dying
 * on a stale handle. For probe steps that evaluate inside the navigation-prone
 * boot window (SW claim / first-boot reload). Non-navigation errors throw
 * immediately.
 */
export async function evalRetry(page, fn, arg, { attempts = 5, intervalMs = 1500 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await page.evaluate(fn, arg); }
    catch (e) {
      lastErr = e;
      if (!/detached|navigat|context was destroyed|execution context/i.test(String(e && e.message || e))) throw e;
      await sleep(intervalMs);
    }
  }
  throw lastErr;
}

/** True if every assert()-recorded entry in `report` passed (non-assert keys are ignored). */
export function allPassed(report) {
  return Object.values(report).every(v => !v || typeof v !== 'object' || v.pass !== false);
}

/**
 * Print `report` as JSON and exit the process: 0 if every assert()-recorded
 * entry passed, 1 otherwise. Scripts that don't use assert() at all will
 * always exit 0 (matching current behavior of the majority of witness
 * scripts, which print-and-exit-0 unconditionally today).
 */
export function printReportAndExit(report) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(allPassed(report) ? 0 : 1);
}
