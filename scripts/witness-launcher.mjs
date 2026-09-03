#!/usr/bin/env node
import { bootBrowser, assert, printReportAndExit } from './witness-lib.mjs';
const { browser, page } = await bootBrowser({ url: process.argv[2] || 'https://anentrypoint.github.io/thebird/', tag: 'w', viewport: null, settleMs: 8000 });
const out = await page.evaluate(() => {
  // Click apps button, see menu
  const appsBtn = document.querySelector('.os-menubar button[data-role="apps"], .os-menubar .os-apps, [data-role="apps"]');
  if (appsBtn) appsBtn.click();
  const menu = document.querySelector('.os-menu');
  const menuItems = menu ? [...menu.querySelectorAll('button.os-btn, .os-menu-item')].map(b=>(b.textContent||'').trim()).filter(Boolean) : [];
  const freddieInMenu = menuItems.some(t=>/freddie/i.test(t));
  // Also the side rail / dock
  const railTitles = [...document.querySelectorAll('.os-rail-btn')].map(b=>b.title);
  return {
    appsBtnFound: !!appsBtn,
    menuOpen: menu ? menu.classList.contains('open') : false,
    menuItems,
    freddieInMenu,
    railTitles,
    autoWins: [...document.querySelectorAll('.wm-win')].map(w=>w.dataset.kind),
  };
});
console.log(JSON.stringify(out,null,2));

const report = {};
assert(report, 'appsBtnFound', out.appsBtnFound, 'apps menu button not found');
assert(report, 'menuOpen', out.menuOpen, 'apps menu did not open after click');
assert(report, 'menuHasItems', out.menuItems.length > 0, 'apps menu had no items: ' + JSON.stringify(out.menuItems));
// freddie auto-opens at boot (see autoWins), so apps.js deliberately omits it
// from the launcher menu -- present via autoWins is the equivalent guarantee.
assert(report, 'freddieInMenu', out.freddieInMenu || out.autoWins.includes('freddie'), 'freddie not found in apps menu items nor autoWins: ' + JSON.stringify(out.menuItems) + ' / ' + JSON.stringify(out.autoWins));
assert(report, 'autoWinsPresent', out.autoWins.length > 0, 'no auto-opened windows found: ' + JSON.stringify(out.autoWins));
report.raw = out;

await browser.close();
printReportAndExit(report);
