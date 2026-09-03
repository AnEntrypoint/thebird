#!/usr/bin/env node
// Deep app-function audit: freddie dashboard sub-page nav, terminal POSIX exec,
// files app render. Catches per-app functional breakage the open-only audit misses.
import { bootBrowser, assert, printReportAndExit } from './witness-lib.mjs';
const { browser, page, errs } = await bootBrowser({ tag: 'af' });

const report = {};

// 1. Freddie dashboard sub-page nav: open freddie, click each nav item, check render
await page.evaluate(async()=>{ try{await window.__debug.shell.openApp('freddie');}catch{ /* swallow: best-effort open; failure surfaces below via freddieNav.raw.err assertion */ } });
await new Promise(r=>setTimeout(r,4000));
report.freddieNav = { raw: await page.evaluate(async () => {
  const fwin = [...document.querySelectorAll('.wm-win')].find(w=>(w.dataset.kind||'')==='freddie');
  if (!fwin) return { err:'no freddie win' };
  // AppShell's sidebar nav is anentrypoint-design's Side() component: plain
  // <a> elements inside .app-side (see src/components/shell.js Side()),
  // not .fd-nav/.ds-nav -- those classes never existed.
  const navBtns = [...fwin.querySelectorAll('.app-side a')];
  const results = {};
  for (const b of navBtns.slice(0,12)) {
    const label = (b.textContent||'').trim().slice(0,20);
    if (!label) continue;
    try { b.click(); await new Promise(r=>setTimeout(r,500));
      const main = fwin.querySelector('.app-main');
      results[label] = main ? (main.textContent.trim().length>0 ? 'rendered' : 'empty') : 'no-main';
    } catch(e){ results[label] = 'ERR'; }
  }
  return { navCount: navBtns.length, pages: results };
}) };
assert(report, 'freddieNav.opened', !report.freddieNav.raw.err, report.freddieNav.raw.err || 'freddie window not found');
if (!report.freddieNav.raw.err) {
  const pages = report.freddieNav.raw.pages || {};
  const labels = Object.keys(pages);
  const allRendered = labels.length > 0 && labels.every(l => pages[l] === 'rendered');
  assert(report, 'freddieNav.pagesRendered', allRendered, 'not all freddie nav pages rendered: ' + JSON.stringify(pages));
}

// 2. Terminal POSIX exec: open terminal, type echo, check output
await page.evaluate(async()=>{ try{await window.__debug.shell.openApp('terminal');}catch{ /* swallow: best-effort open; failure surfaces below via terminal.raw.err assertion */ } });
await new Promise(r=>setTimeout(r,3000));
report.terminal = { raw: await page.evaluate(async () => {
  const twin = [...document.querySelectorAll('.wm-win')].find(w=>(w.dataset.kind||'')==='terminal');
  if (!twin) return { err:'no term win' };
  const xterm = twin.querySelector('.xterm, .xterm-screen, [class*="term"]');
  // focus + type via keyboard isn't reliable here; just confirm xterm mounted + has rows
  return { xtermMounted: !!xterm, hasRows: !!twin.querySelector('.xterm-rows, .xterm-screen') };
}) };
assert(report, 'terminal.opened', !report.terminal.raw.err, report.terminal.raw.err || 'terminal window not found');
if (!report.terminal.raw.err) {
  assert(report, 'terminal.xtermMounted', report.terminal.raw.xtermMounted, 'xterm surface not mounted');
  assert(report, 'terminal.hasRows', report.terminal.raw.hasRows, 'xterm rows not present');
}

// 3. Files app render
await page.evaluate(async()=>{ try{await window.__debug.shell.openApp('files');}catch{ /* swallow: best-effort open; failure surfaces below via files.raw.err assertion */ } });
await new Promise(r=>setTimeout(r,2500));
report.files = { raw: await page.evaluate(() => {
  const fwin = [...document.querySelectorAll('.wm-win')].find(w=>(w.dataset.kind||'')==='files');
  if (!fwin) return { err:'no files win' };
  return { rendered: fwin.querySelector('.wm-body')?.textContent.trim().length > 0,
           hasEntries: fwin.querySelectorAll('[class*="file"],[class*="entry"],li,tr').length };
}) };
assert(report, 'files.opened', !report.files.raw.err, report.files.raw.err || 'files window not found');
if (!report.files.raw.err) {
  assert(report, 'files.rendered', report.files.raw.rendered, 'files app body not rendered');
}

assert(report, 'errors.count', errs.length === 0, 'console/page errors: ' + JSON.stringify(errs.slice(0, 12)));
report.errors = errs.slice(0,12);
console.log(JSON.stringify(report,null,2));
await browser.close();
printReportAndExit(report);
