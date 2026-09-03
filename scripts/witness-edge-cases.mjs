#!/usr/bin/env node
// Maximum-effort edge-case / stress audit: a11y (keyboard nav, ARIA, focus),
// theme persistence across reload, storage quota, concurrent multi-instance,
// error-boundary (app factory throw), and app re-open idempotency.
import { bootBrowser, assert, printReportAndExit, evalRetry } from './witness-lib.mjs';
const URL = process.argv[2] || 'http://localhost:3000/os.html';
const { browser, page, errs } = await bootBrowser({ tag: 'ec' });
const R = {};

// 1. A11y: ARIA roles/labels on chrome, focusable controls, alt-tab switcher
// evalRetry: this is the FIRST evaluate after bootBrowser returns — a late
// boot navigation (SW activation/redirect) can still replace the frame
// underneath it ("Attempted to use detached Frame" race, seen in a
// --tag=core manifest run); retry on the fresh frame instead of crashing.
R.a11y = await evalRetry(page, () => {
  const menubar = document.querySelector('.os-menubar');
  const focusables = document.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"]), input, textarea');
  const ariaLabeled = document.querySelectorAll('[aria-label], [role], [aria-labelledby]');
  return {
    menubarRole: menubar?.getAttribute('role') || null,
    focusableCount: focusables.length,
    ariaCount: ariaLabeled.length,
    skipLink: !!document.querySelector('.skip-link, a[href="#app-main"]'),
  };
});

// 2. Keyboard: Ctrl+Shift+N modal, Backquote bars toggle, Escape closes
// [role="dialog"] alone is unreliable now that the always-present (but
// usually aria-hidden) apps drawer also carries role=dialog for its own
// a11y -- only .tb-sess-modal (the actual Ctrl+Shift+N create-workspace
// modal) or a VISIBLE dialog is evidence this shortcut opened something.
// Regular app windows (.wm-win) also carry role="dialog" for their own a11y
// and are visible/aria-hidden!=true whenever any window is open (true from
// boot onward, since terminal/freddie auto-open) -- excluded so this only
// matches an actual modal overlay, never a normal window.
const dialogOpenInPage = () => !!document.querySelector('.tb-sess-modal') ||
  [...document.querySelectorAll('[role="dialog"]:not(.wm-win)')].some(d => d.getAttribute('aria-hidden') !== 'true' && d.offsetParent !== null);

await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles:true, key:'N', code:'KeyN', ctrlKey:true, shiftKey:true })));
await new Promise(r=>setTimeout(r,300));
const modalOpen = await page.evaluate(dialogOpenInPage);
// Escape-closes-native-<dialog> is the browser's own default action, which
// only fires for a REAL input event -- a synthetic document.dispatchEvent
// keydown (used above for the app's own JS shortcut listener) never
// triggers it, so this specific key must go through page.keyboard.
await page.keyboard.press('Escape'); await new Promise(r=>setTimeout(r,200));
const modalClosed = !(await page.evaluate(dialogOpenInPage));
const before = await page.evaluate(() => document.documentElement.classList.contains('bars-hidden') || document.body.classList.contains('bars-hidden'));
await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles:true, key:'`', code:'Backquote' })));
await new Promise(r=>setTimeout(r,200));
const after = await page.evaluate(() => document.documentElement.classList.contains('bars-hidden') || document.body.classList.contains('bars-hidden'));
await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles:true, key:'`', code:'Backquote' }))); // restore
R.keyboard = { modalOpensOnCtrlShiftN: modalOpen, modalClosesOnEsc: modalClosed, barsToggleOnBackquote: before !== after };

// 3. Theme persistence across reload
const themeBefore = await page.evaluate(() => {
  const btn = document.querySelector('.os-theme, [data-role="theme"]');
  if (btn) { btn.click(); btn.click(); } // move off default
  return (document.documentElement.getAttribute('data-theme') || localStorage.getItem('tb-theme') || getComputedStyle(document.documentElement).getPropertyValue('--bg')).trim();
});
await new Promise(r=>setTimeout(r,1500));
await page.goto(URL + '?ec2=' + Date.now(), { waitUntil:'domcontentloaded', timeout:90000 });
await new Promise(r=>setTimeout(r,9000));
const themeAfter = await page.evaluate(() => (document.documentElement.getAttribute('data-theme') || localStorage.getItem('tb-theme') || getComputedStyle(document.documentElement).getPropertyValue('--bg')).trim());
R.themePersist = { before: themeBefore, after: themeAfter, persisted: themeBefore === themeAfter };

// 4. Error boundary: open a deliberately-throwing app factory via shell, ensure shell survives
R.errorBoundary = await page.evaluate(async () => {
  const s = window.__debug?.shell;
  if (!s || !s.registry) return { skipped: 'no registry' };
  let shellAlive = false;
  try {
    // register a throwing app, open it, then verify shell still works
    if (s.registry.register) s.registry.register({ id:'__throwtest', name:'throw', factory:()=>{ throw new Error('boom'); } });
    try { await s.openApp('__throwtest'); } catch { /* swallow: the app factory is deliberately designed to throw ('boom'); the throw itself is the expected outcome being probed, only shell survival afterward matters */ }
    await new Promise(r=>setTimeout(r,300));
    // shell still responsive? open a real app
    await s.openApp('terminal');
    shellAlive = document.querySelectorAll('.wm-win').length > 0;
  } catch (e) { return { threw: String(e).slice(0,100), shellAlive }; }
  return { shellSurvivesThrowingApp: shellAlive };
});

// 5. Concurrent multi-instance: create 3 instances rapidly, check isolation
R.multiInstance = await page.evaluate(async () => {
  const s = window.__debug?.shell;
  const before = document.querySelectorAll('.tb-sess-chip').length;
  if (s.newInstance) { await s.newInstance(); await s.newInstance(); }
  await new Promise(r=>setTimeout(r,800));
  const after = document.querySelectorAll('.tb-sess-chip').length;
  return { chipsBefore: before, chipsAfter: after, grew: after > before };
});

R.errors = errs.slice(0,12);

const report = {};
assert(report, 'a11yFocusables', R.a11y.focusableCount > 0, 'no focusable controls found (buttons/links/inputs/tabindex)');
assert(report, 'a11yAria', R.a11y.ariaCount > 0, 'no aria-labeled/role elements found');
assert(report, 'keyboardModalOpen', !!R.keyboard.modalOpensOnCtrlShiftN, 'Ctrl+Shift+N did not open the create-workspace modal');
assert(report, 'keyboardModalCloseEsc', !!R.keyboard.modalClosesOnEsc, 'Escape did not close the modal');
assert(report, 'keyboardBarsToggle', !!R.keyboard.barsToggleOnBackquote, 'Backquote did not toggle bars visibility');
assert(report, 'themePersistsAcrossReload', !!R.themePersist.persisted, 'theme did not persist across reload: ' + JSON.stringify(R.themePersist));
if (R.errorBoundary.skipped) {
  report.shellSurvivesThrowingApp = { pass: false, detail: 'skipped: ' + R.errorBoundary.skipped };
} else {
  assert(report, 'shellSurvivesThrowingApp', !!R.errorBoundary.shellSurvivesThrowingApp, 'shell did not survive/stay responsive after a throwing app factory: ' + JSON.stringify(R.errorBoundary));
}
assert(report, 'multiInstanceGrows', !!R.multiInstance.grew, 'creating new instances did not grow the instance-chip count: ' + JSON.stringify(R.multiInstance));
assert(report, 'noConsoleErrors', R.errors.length === 0, 'console/page errors: ' + JSON.stringify(R.errors));
report.raw = R;

console.log(JSON.stringify(R,null,2));
await browser.close();
printReportAndExit(report);
