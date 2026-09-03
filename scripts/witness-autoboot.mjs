#!/usr/bin/env node
import { sleep, assert, printReportAndExit } from './witness-lib.mjs';
import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://localhost:3000/';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PE: ' + String(e).slice(0,300)));
page.on('console', m => { if (m.type()==='error') errs.push('CE: ' + m.text().slice(0,300)); });
// First load to get origin, then nuke all storage + SW for a clean fresh boot
await page.goto(URL + '?clean=' + Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
await page.evaluate(async () => {
  try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister())); } catch { /* swallow: best-effort SW teardown; no prior registration on a truly fresh origin is expected, not fatal */ }
  try { const ks = await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); } catch { /* swallow: best-effort cache teardown; Cache API access may be restricted or empty on a fresh origin */ }
  try { localStorage.clear(); } catch { /* swallow: best-effort storage teardown; localStorage may be unavailable/already empty */ }
  try { const dbs = await indexedDB.databases?.() || []; for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name); } catch { /* swallow: best-effort IDB teardown; databases() is not universally supported and absence/failure just means nothing to delete */ }
});
// Reload into the now-clean origin → fresh autoBoot. A genuinely-cold boot does
// the full 61MB plugkit.wasm load + per-instance SW registration before the
// autobooted windows appear, so poll (up to ~150s) instead of a flat sleep.
await page.goto(URL + '?fresh=' + Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
await sleep(5000);
for (let i=0;i<75;i++){
  const ok = await page.evaluate(() => [...document.querySelectorAll('.wm-win')].some(w=>(w.dataset.kind||'')==='freddie'));
  if (ok) break;
  await sleep(2000);
}
const out = await page.evaluate(() => {
  const wins = [...document.querySelectorAll('.wm-win')].map(w=>w.dataset.kind||w.getAttribute('data-kind'));
  const fwin = [...document.querySelectorAll('.wm-win')].find(w => (w.dataset.kind||'')==='freddie');
  const fdroot = fwin ? fwin.querySelector('.fd-root,.app-fd') : null;
  return {
    autoWins: wins,
    freddieAutoOpened: wins.includes('freddie'),
    fdRootRendered: !!fdroot,
    fdHeader: fdroot ? (fdroot.querySelector('.brand')?.textContent||'').trim() : null,
  };
});
console.log(JSON.stringify(out,null,2));
console.log('ERRORS:', errs.slice(0,10));

const report = {};
report.raw = out;
assert(report, 'freddieAutoOpened', out.freddieAutoOpened, 'freddie window did not autoboot; wins: ' + JSON.stringify(out.autoWins));
assert(report, 'fdRootRendered', out.fdRootRendered, 'freddie dashboard root did not render');
report.errors = errs.slice(0, 10);

await browser.close();
printReportAndExit(report);
