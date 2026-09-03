#!/usr/bin/env node
// Witness the landing page (/) loads freddie-loader without xstate error.
import { bootBrowser, assert, printReportAndExit } from './witness-lib.mjs';

const URL_ARG = process.argv[2] || 'https://anentrypoint.github.io/thebird/';
console.log('NAV', URL_ARG);
const { browser, page, errs: pageErrors } = await bootBrowser({ url: URL_ARG, tag: 'witness', viewport: null, settleMs: 10000 });
const report = {};
const consoleErrors = pageErrors.filter(e => e.startsWith('CE:')).map(e => e.slice(3));

const state = await page.evaluate(() => ({
    url: location.href,
    hasShell: !!(window.__debug && window.__debug.shell),
    shellCount: window.__debug?.shell?.count || 0,
    osRoot: !!document.querySelector('.os-root'),
    menubar: !!document.querySelector('.os-menubar'),
    chips: document.querySelectorAll('.tb-sess-chip').length,
}));
const xstateErrs = pageErrors.filter(e => /xstate|freddie-loader.*failed to load both/.test(e));
const otherErrs = pageErrors.filter(e => !/xstate|freddie-loader/.test(e));
console.log('STATE:', JSON.stringify(state, null, 2));
console.log('xstate errors:', xstateErrs.length, xstateErrs);
console.log('other page errors:', otherErrs.slice(0, 5));
console.log('console errors:', consoleErrors.slice(0, 8));

assert(report, 'noXstateErrors', xstateErrs.length === 0, 'xstate/freddie-loader errors found: ' + JSON.stringify(xstateErrs));
assert(report, 'shellLoaded', state.hasShell, 'window.__debug.shell not present: ' + JSON.stringify(state));
report.state = state;
report.otherErrors = otherErrs.slice(0, 5);
report.consoleErrors = consoleErrors.slice(0, 8);

console.log(JSON.stringify(report, null, 2));
await browser.close();
printReportAndExit(report);
