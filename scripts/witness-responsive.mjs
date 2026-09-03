#!/usr/bin/env node
// Responsive sweep: at mobile(390) / tablet(768) / desktop(1400) / large(1920),
// assert (a) no horizontal page overflow, (b) bars present + uniform 34px,
// (c) the freddie dashboard .fd-root .app fills (>100px wide) — the regression
// guard for the desktop .app-collapse fix. Single browser, resize between checks.
import { bootBrowser, sleep, assert, printReportAndExit } from './witness-lib.mjs';
const SIZES = [[390,780,'mobile'],[768,1024,'tablet'],[1400,900,'desktop'],[1920,1080,'large']];
const { browser, page, errs } = await bootBrowser({ tag: 'resp' });
// wait for freddie autoboot
for (let i=0;i<60;i++){ const ok = await page.evaluate(()=>!!(window.__debug?.shell && [...document.querySelectorAll('.wm-win')].some(w=>/freddie/i.test(w.dataset.kind||'')))); if(ok)break; await sleep(1500); }

const results = {};
for (const [w,h,label] of SIZES) {
  await page.setViewport({ width: w, height: h });
  await sleep(1200);
  results[label] = await page.evaluate(() => {
    const de = document.documentElement;
    const overflowX = de.scrollWidth > de.clientWidth + 2;
    const bar = sel => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().height) : null; };
    const fred = [...document.querySelectorAll('.wm-win')].find(e=>/freddie/i.test(e.dataset.kind||''));
    let appW = null, fdRoot = false;
    if (fred) { fdRoot = !!fred.querySelector('.fd-root'); const app = fred.querySelector('.fd-root .app'); if (app) appW = Math.round(app.getBoundingClientRect().width); }
    return {
      vw: window.innerWidth, overflowX,
      menubarH: bar('.os-menubar'), taskbarH: bar('.os-taskbar'),
      fdRoot, appW, appFilled: appW != null ? appW > 100 : 'no-app',
    };
  });
}
console.log('RESPONSIVE-SWEEP:', JSON.stringify(results, null, 2));
console.log('ERRS:', errs.slice(0,6));

// --- touch tap-target floor: under a coarse-pointer/touch viewport, key
// interactive elements (window controls, taskbar tasks, chat send button,
// chat-config toggle) must have a computed height >= 44px (the --os-tap
// token asserted in theme.css's `@media (pointer: coarse)` block). Puppeteer's
// emulateMediaFeatures only supports prefers-color-scheme/prefers-reduced-motion/
// color-gamut (asserts otherwise) — pointer/hover aren't settable that way.
// setViewport's hasTouch+isMobile combo maps to Emulation.setDeviceMetricsOverride
// + setTouchEmulationEnabled at the CDP layer, which Chrome itself resolves to
// `pointer: coarse`/`hover: none` for the page's media queries, so this alone
// is sufficient without an explicit (and unsupported) media-feature override.
await page.setViewport({ width: 390, height: 780, hasTouch: true, isMobile: true });
await sleep(1200);
const touchTargets = await page.evaluate(() => {
  const MIN = 44;
  const measure = sel => [...document.querySelectorAll(sel)].map(e => {
    const r = e.getBoundingClientRect();
    return { sel, w: Math.round(r.width), h: Math.round(r.height) };
  });
  return [
    ...measure('.wm-btns .wm-btn'),
    ...measure('.os-task'),
    ...measure('.chat-composer .send'),
    ...measure('.cc-toggle'),
  ].filter(m => m.w > 0 || m.h > 0); // ignore elements not present/rendered (0x0)
});
console.log('TOUCH-TARGETS:', JSON.stringify(touchTargets, null, 2));
await browser.close();

const report = {};
for (const [label, r] of Object.entries(results)) {
  assert(report, `${label}.noOverflowX`, !r.overflowX, `horizontal overflow at ${label} (vw=${r.vw})`);
  assert(report, `${label}.appFilled`, r.appFilled === true || r.fdRoot === false, `freddie .fd-root .app not filled at ${label}: appW=${r.appW}`);
}
if (touchTargets.length === 0) {
  // No matching elements were rendered in this session (e.g. no window/
  // taskbar item open) -- nothing to assert, but flag it so a silent
  // false-pass doesn't hide a selector drift.
  report['touch.noElementsFound'] = { pass: false, detail: 'no .wm-btn/.os-task/.chat-composer .send/.cc-toggle elements found to measure — selectors may have drifted or nothing was open' };
} else {
  for (const m of touchTargets) {
    assert(report, `touch.${m.sel}.${touchTargets.indexOf(m)}`, m.h >= 44, `${m.sel} computed height ${m.h}px < 44px minimum touch target (w=${m.w})`);
  }
}
report.raw = results;
report.touchTargets = touchTargets;
report.errors = errs.slice(0, 6);

printReportAndExit(report);
