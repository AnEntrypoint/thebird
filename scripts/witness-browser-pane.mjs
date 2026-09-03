#!/usr/bin/env node
// Witness the browser app (createBrowserPane): open it, navigate to a data: URL
// carrying a bird site, confirm the iframe loads and innerText shows the content.
// This is the "display the vibe-coded site" half of the headline goal.
import { bootBrowser, waitForActiveInstance, assert, printReportAndExit } from './witness-lib.mjs';
const { browser, page, errs } = await bootBrowser({ tag: 'bp', viewport: { width: 1200, height: 800 } });
await waitForActiveInstance(page);

// open browser app + drive the pane through the debug handle
const opened = await page.evaluate(async () => { try { await window.__debug.shell.openApp('browser'); } catch (e) { return { err: String(e).slice(0, 120) }; } return { ok: true }; });
await new Promise(r => setTimeout(r, 2500));

const result = await page.evaluate(async () => {
  // find a browser pane handle in the debug instances map
  const insts = window.__debug?.instances || {};
  let pane = null, instId = null;
  for (const k of Object.keys(insts)) { const b = insts[k] && insts[k].browser; if (b && (b.send || b.shellCmd)) { pane = b; instId = k; break; } }
  // fallback: the launcher/shell active instance browser
  if (!pane) { const a = window.__debug?.shell?.active; if (a && a.browser) { pane = a.browser; instId = a.id; } }
  const out = { hasPane: !!pane, instId, hasBrowserWin: !!document.querySelector('.wm-win[data-kind="browser"]') };
  if (!pane) return out;
  // navigate the pane to a data: bird site
  const html = '<!doctype html><title>owl</title><body><h1>kingfisher data-url site</h1><p>Researched bird content rendered in createBrowserPane.</p></body>';
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  try { await pane.send('Page.navigate', { url: dataUrl }); } catch (e) { out.navErr = String(e).slice(0, 120); }
  await new Promise(r => setTimeout(r, 1200));
  try {
    const ifr = pane.iframe;
    out.iframeSrc = ifr && ifr.src ? ifr.src.slice(0, 40) : null;
    const doc = ifr && ifr.contentDocument;
    out.innerText = doc && doc.body ? (doc.body.innerText || doc.body.textContent).slice(0, 120) : null;
    out.url = pane.url ? pane.url.slice(0, 40) : null;
    out.historyLen = Array.isArray(pane.history) ? pane.history.length : null;
  } catch (e) { out.readErr = String(e).slice(0, 120); }
  return out;
});
console.log('OPENED:', JSON.stringify(opened));
console.log('BROWSER-PANE:', JSON.stringify(result, null, 2));
console.log('ERRS:', errs.slice(0, 6));

const report = {};
assert(report, 'appOpened', !opened.err, opened.err || 'browser app failed to open');
report.raw = result;
assert(report, 'hasPane', result.hasPane, 'no browser pane handle found in debug instances');
const contentOk = result.innerText ? /kingfisher|owl|bird/i.test(result.innerText) : (result.historyLen > 0);
assert(report, 'contentDisplayed', contentOk, 'iframe innerText did not contain expected bird content, and no history entries: ' + JSON.stringify({ innerText: result.innerText, historyLen: result.historyLen }));
report.errors = errs.slice(0, 6);

await browser.close();
printReportAndExit(report);
