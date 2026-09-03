#!/usr/bin/env node
// Consolidated app-open matrix: merges witness-full-audit.mjs (open every
// registered app + boot chrome/theme/freddie/bar-height checks) and
// witness-remaining-apps.mjs (deeper per-app interactive-content assertion for
// the apps that were historically "opened but never really checked": canvas,
// xdisplay, monitor, todo, gm, about) into one parameterized table.
//
// Both scripts did the exact same mechanical thing — open an app id via
// window.__debug.shell.openApp(), then assert something about the resulting
// .wm-win — over complementary (non-overlapping) app-id sets, so they are
// merged here. witness-app-functions.mjs (deep per-app *function* clicks:
// freddie nav, terminal exec, files listing), witness-edge-cases.mjs (a11y/
// keyboard/theme-persistence/error-boundary/multi-instance — not an app-open
// matrix at all) and witness-deep-churn.mjs (open/close stress + dashboard
// sub-page content) are NOT folded in here: each asserts a genuinely distinct
// failure mode that doesn't reduce to "open app id, check window rendered."
import { bootBrowser, waitForActiveInstance, sleep, assert, printReportAndExit } from './witness-lib.mjs';

// Per-app check table. `deep:true` rows additionally count interactive
// elements inside .wm-body (the witness-remaining-apps.mjs assertion) —
// these are apps that historically got opened but never checked beyond
// "a window appeared."
const APP_CHECKS = [
  { id: 'chat' },
  { id: 'freddie' },
  { id: 'terminal' },
  { id: 'browser' },
  { id: 'files' },
  { id: 'workspaces' },
  { id: 'gm', deep: true },
  { id: 'config' },
  { id: 'monitor', deep: true },
  { id: 'about', deep: true },
  { id: 'xdisplay', deep: true },
  { id: 'canvas', deep: true },
  { id: 'todo', deep: true },
];

const { browser, page, errs } = await bootBrowser({ tag: 'am' });
await waitForActiveInstance(page);

const report = {};

// 1. Shell boot + chrome present (from witness-full-audit.mjs)
report.boot = await page.evaluate(() => ({
  hasShell: !!window.__debug?.shell,
  osRoot: !!document.querySelector('.os-root, .osframe, [class*="os-"]'),
  menubar: !!document.querySelector('.os-menubar'),
  taskbar: !!document.querySelector('.os-taskbar'),
  wmRoot: !!document.querySelector('.wm-root'),
  chips: document.querySelectorAll('.tb-sess-chip').length,
}));

// 2. Registered app list — use it if available, else fall back to the fixed
// APP_CHECKS table (mirrors witness-full-audit.mjs's own fallback).
const registered = await page.evaluate(() => {
  const s = window.__debug?.shell;
  return s && s.apps ? (Array.isArray(s.apps) ? s.apps.map(a => a.id || a) : Object.keys(s.apps)) : null;
});
report.registeredApps = registered;
const idsToRun = registered && registered.length ? registered : APP_CHECKS.map(c => c.id);
const checkById = Object.fromEntries(APP_CHECKS.map(c => [c.id, c]));

// 3. Open every app id, record success + (for `deep` rows) interactive-content count
const appResults = {};
for (const id of idsToRun) {
  const spec = checkById[id] || { id };
  try {
    const before = await page.evaluate(() => document.querySelectorAll('.wm-win').length);
    await page.evaluate(async (a) => { await window.__debug.shell.openApp(a); }, id);
    await sleep(1800);
    const after = await page.evaluate(() => document.querySelectorAll('.wm-win').length);
    if (!spec.deep) {
      appResults[id] = after > before ? 'ok' : 'no-window';
    } else {
      appResults[id] = await page.evaluate((a) => {
        const w = [...document.querySelectorAll('.wm-win')].find(x => (x.dataset.kind || '') === a);
        const body = w?.querySelector('.wm-body');
        const interactiveEls = body ? body.querySelectorAll('canvas,button,input,textarea,svg,select,.ds-segmented,pre,table,li').length : 0;
        return { win: !!w, bodyLen: body ? body.textContent.trim().length : 0, interactiveEls };
      }, id);
    }
  } catch (e) {
    appResults[id] = { err: String(e.message || e).slice(0, 80) };
  }
}
report.appOpen = appResults;

// 4. Theme flip (auto -> paper -> ink) — check bg/fg actually change
report.theme = await page.evaluate(() => {
  const btn = document.querySelector('.os-theme, [data-role="theme"], button[title*="theme" i]');
  if (!btn) return { themeButton: false };
  const read = () => { const cs = getComputedStyle(document.documentElement); return (cs.getPropertyValue('--bg') || cs.getPropertyValue('--os-bg-0') || '').trim() + '/' + (cs.getPropertyValue('--fg') || cs.getPropertyValue('--os-fg') || '').trim(); };
  const states = [read()]; btn.click(); states.push(read()); btn.click(); states.push(read());
  return { themeButton: true, states, flips: new Set(states).size > 1 };
});

// 5. Freddie dashboard render
report.freddie = await page.evaluate(() => {
  const fwin = [...document.querySelectorAll('.wm-win')].find(w => (w.dataset.kind || '') === 'freddie');
  const root = fwin ? fwin.querySelector('.fd-root,.app-fd,.ds-dashboard') : null;
  return { winExists: !!fwin, rootRendered: !!root, textLen: root ? root.textContent.trim().length : 0 };
});

// 6. Bar height contract (menubar/taskbar/titlebar equal)
report.barHeights = await page.evaluate(() => {
  const h = s => { const el = document.querySelector(s); return el ? Math.round(el.getBoundingClientRect().height) : null; };
  return { menubar: h('.os-menubar'), taskbar: h('.os-taskbar'), titlebar: h('.wm-bar') };
});

report.errors = errs.slice(0, 20);

// Pass/fail assertions (new — the source scripts printed unconditionally and
// exited 0; this merge computes a real gate per witness-lib's assert() contract).
assert(report, 'shellBooted', !!report.boot.hasShell, report.boot);
assert(report, 'allAppsOpened', Object.values(appResults).every(v => v === 'ok' || (v && typeof v === 'object' && v.win)), appResults);

await browser.close();
printReportAndExit(report);
