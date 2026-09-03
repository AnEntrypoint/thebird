#!/usr/bin/env node
// a11y probe: open a window and assert the ARIA additions from the
// windows/menubar/instance-switcher/resize a11y pass are actually present
// in the live DOM. Mirrors witness-wm-persist.mjs's shape: bootBrowser ->
// page.evaluate to gather facts -> assert() each expectation ->
// printReportAndExit().
import { bootBrowser, waitForActiveInstance, assert, printReportAndExit } from './witness-lib.mjs';

const { browser, page, errs } = await bootBrowser({ tag: 'a11y', settleMs: 9000 });
const report = {};
const gotInstance = await waitForActiveInstance(page);
assert(report, 'activeInstance', gotInstance, 'no active shell instance after boot');

// Open a window so we have something to inspect.
await page.evaluate(async () => {
  const s = window.__debug.shell;
  await s.openApp('terminal');
  await new Promise(r => setTimeout(r, 800));
});

const facts = await page.evaluate(() => {
  // Query the FOCUSED window, not the first in DOM order — boot may have
  // opened multiple windows (autoboot/restore) and DOM insertion order
  // does not track focus/z-order.
  const win = document.querySelector('.wm-win.wm-focused') || document.querySelector('.wm-win');
  const menubar = document.querySelector('.os-menubar, [role="menubar"]');
  const appsMenu = document.querySelector('.os-menu, [role="menu"]');
  const chip = document.querySelector('.tb-sess-chip');
  return {
    windowRole: win ? win.getAttribute('role') : null,
    windowAriaLabel: win ? win.getAttribute('aria-label') : null,
    windowFocused: win === document.activeElement || (win && win.contains(document.activeElement)),
    menubarRole: menubar ? menubar.getAttribute('role') : null,
    appsMenuRole: appsMenu ? appsMenu.getAttribute('role') : null,
    menuItemRoles: [...document.querySelectorAll('[role="menuitem"]')].length,
    chipAriaLabel: chip ? chip.getAttribute('aria-label') : null,
  };
});

assert(report, 'windowRoleDialog', facts.windowRole === 'dialog', 'expected window root role="dialog", got ' + facts.windowRole);
assert(report, 'windowAriaLabelPresent', !!facts.windowAriaLabel && facts.windowAriaLabel.trim().length > 0, 'expected non-empty window aria-label, got ' + JSON.stringify(facts.windowAriaLabel));
assert(report, 'windowFocusedOnOpen', !!facts.windowFocused, 'expected DOM focus to land inside the newly-opened window');
assert(report, 'menubarRole', facts.menubarRole === 'menubar', 'expected menubar role="menubar", got ' + facts.menubarRole);
assert(report, 'appsMenuRole', facts.appsMenuRole === 'menu', 'expected apps menu role="menu", got ' + facts.appsMenuRole);
assert(report, 'menuItemsPresent', facts.menuItemRoles > 0, 'expected at least one role="menuitem", got ' + facts.menuItemRoles);
assert(report, 'chipAriaLabelPresent', !!facts.chipAriaLabel && facts.chipAriaLabel.trim().length > 0, 'expected non-empty instance-switcher chip aria-label, got ' + JSON.stringify(facts.chipAriaLabel));

report.facts = facts;
report.errors = errs.slice(0, 8);

console.log(JSON.stringify(report, null, 2));
await browser.close();
printReportAndExit(report);
