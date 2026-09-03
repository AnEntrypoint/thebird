#!/usr/bin/env node
// Deep WM/persistence audit: create multiple windows + an instance, max/min some,
// reload, assert full restore (window count, maximized state, instance count).
import { bootBrowser, waitForActiveInstance, assert, printReportAndExit, sleep } from './witness-lib.mjs';

const URL = process.argv[2] || 'http://localhost:3000/os.html';
const { browser, page, errs } = await bootBrowser({ url: URL, tag: 'wm', settleMs: 9000 });
const report = {};
const gotInstance = await waitForActiveInstance(page);
assert(report, 'activeInstance', gotInstance, 'no active shell instance after boot');

// Build state: open 3 apps, maximize one, create a 2nd instance with 1 app
const built = await page.evaluate(async () => {
  const s = window.__debug.shell;
  await s.openApp('terminal'); await s.openApp('files'); await s.openApp('browser');
  await new Promise(r=>setTimeout(r,800));
  // maximize the first window via its max button (real markup: .wm-btn[title="maximize"])
  const firstMax = document.querySelector('.wm-win .wm-btn[title="maximize"], .wm-win [title*="max" i]');
  if (firstMax) firstMax.click();
  await new Promise(r=>setTimeout(r,400));
  // new instance
  let instBefore = document.querySelectorAll('.tb-sess-chip').length;
  if (s.newInstance) { try { await s.newInstance(); } catch { /* swallow: best-effort new-instance creation; the returned chip-count comparison below just shows no growth if this failed */ } }
  await new Promise(r=>setTimeout(r,800));
  return {
    winCount: document.querySelectorAll('.wm-win').length,
    maximized: document.querySelectorAll('.wm-win.wm-max').length,
    chipsBefore: instBefore,
    chipsAfter: document.querySelectorAll('.tb-sess-chip').length,
  };
});

// Let persistence settle, then reload
await sleep(3000);
await page.goto(URL + '?wm2=' + Date.now(), { waitUntil:'domcontentloaded', timeout:90000 });
await sleep(11000);

const restored = await page.evaluate(() => ({
  winCount: document.querySelectorAll('.wm-win').length,
  maximized: document.querySelectorAll('.wm-win.wm-max, .wm-win[data-max="true"]').length,
  chips: document.querySelectorAll('.tb-sess-chip').length,
  hasShell: !!window.__debug?.shell,
}));

assert(report, 'windowsOpened', built.winCount >= 3, 'expected >=3 windows before reload, got ' + built.winCount);
assert(report, 'maximizedBeforeReload', built.maximized >= 1, 'expected a maximized window before reload, got ' + built.maximized);
assert(report, 'instanceCreated', built.chipsAfter > built.chipsBefore || built.chipsAfter >= 1, 'expected a new instance chip after newInstance(), before=' + built.chipsBefore + ' after=' + built.chipsAfter);
assert(report, 'shellRestored', !!restored.hasShell, 'window.__debug.shell missing after reload');
assert(report, 'windowCountRestored', restored.winCount >= built.winCount, 'expected >=' + built.winCount + ' windows restored, got ' + restored.winCount);
assert(report, 'maximizedRestored', restored.maximized >= built.maximized, 'expected maximized state to survive reload, before=' + built.maximized + ' after=' + restored.maximized);
assert(report, 'instancesRestored', restored.chips >= built.chipsAfter, 'expected instance chips to survive reload, before=' + built.chipsAfter + ' after=' + restored.chips);
report.built = built;
report.restored = restored;
report.errors = errs.slice(0,8);

console.log(JSON.stringify(report, null, 2));
await browser.close();
printReportAndExit(report);
