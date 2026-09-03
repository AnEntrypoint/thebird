#!/usr/bin/env node
// Witness the OS boots with a live shell + gm engine present. This used to
// probe through a #osframe iframe wrapping the removed validate.html
// harness (see docs/MANUAL-VALIDATION.md) -- that harness no longer exists,
// so the page under test today (os.html/os) has no such iframe. Probe
// window.__debug directly instead, matching every other witness script.
import { bootBrowser, assert, printReportAndExit } from './witness-lib.mjs';
const URL_ARG = process.argv[2] || 'https://anentrypoint.github.io/thebird/os.html';
const { browser, page, errs } = await bootBrowser({ url: URL_ARG, tag: 'probe', viewport: null, settleMs: 12000 });
page.on('console', m => { if (m.type() === 'warning') errs.push(`[warning] ${m.text().slice(0, 400)}`); });
// gm's plugkit.wasm cold-load can take a while; poll instead of one fixed wait.
for (let i = 0; i < 60; i++) { const ready = await page.evaluate(() => !!(window.__debug?.gm?.exports)); if (ready) break; await new Promise(r => setTimeout(r, 2000)); }
const probe = await page.evaluate(() => ({
    hasShell: !!(window.__debug?.shell),
    shellCount: window.__debug?.shell?.count,
    shellActive: window.__debug?.shell?.active?.id,
    hasGm: !!(window.__debug?.gm?.exports),
    gmExportsLen: window.__debug?.gm?.exports?.length,
}));
console.log(JSON.stringify(probe, null, 2));
console.log('errors:', errs.slice(0, 12));
await browser.close();

const report = {};
assert(report, 'shellPresent', probe.hasShell, 'window.__debug.shell not present');
assert(report, 'gmPresent', probe.hasGm, 'window.__debug.gm.exports not present');
report.raw = probe;
report.errors = errs.slice(0, 12);

printReportAndExit(report);
