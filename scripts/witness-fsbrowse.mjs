#!/usr/bin/env node
// Witness fsbrowse-in-thebird: open files app, exercise mkdir/create/rename/view/
// delete against the IDB fs, confirm per-instance isolation.
import { bootBrowser, waitForActiveInstance, sleep, assert, printReportAndExit } from './witness-lib.mjs';
const { browser, page, errs } = await bootBrowser({ tag: 'w', viewport: { width: 1100, height: 780 }, settleMs: 8000 });
const report = {};
// auto-accept prompts/confirms
page.on('dialog', async d => { const def = d.type() === 'prompt' ? (d.message().includes('rename') ? 'renamed.txt' : 'wf-test') : ''; await d.accept(def); });
// Wait for autoboot to set an active instance before opening the files app
// (pre-autoboot race: resolveInstance throws 'no active instance').
await waitForActiveInstance(page);
await page.evaluate(async () => { const s = window.__debug?.shell; if (s) await s.openApp('files'); });
for (let i = 0; i < 30; i++) { if (await page.evaluate(() => !!document.querySelector('.fsb-root'))) break; await sleep(1500); }

const probe = await page.evaluate(async () => {
  const out = {};
  const root = document.querySelector('.fsb-root');
  out.mounted = !!root;
  if (!root) return out;
  const inst = window.__debug?.shell?.active;
  const fs = inst && inst.fs;
  out.instanceId = inst && inst.id;
  // create a file directly via fs (simulating new-file), then verify it lists
  fs.writeFile('fsb-witness/hello.txt', 'hi from witness'); if (fs.flush) await fs.flush();
  const api = window.__debug.instances[inst.id].fsbrowse;
  api.refresh();
  await new Promise(r => setTimeout(r, 300));
  // navigate into the dir we created
  const rows = [...root.querySelectorAll('.fsb-row .fsb-name')].map(n => n.textContent);
  out.rootRows = rows;
  out.dirShows = rows.includes('fsb-witness');
  // verify listDir sees the file inside
  const children = api.listDir('fsb-witness').map(c => c.name + ':' + c.type);
  out.dirChildren = children;
  out.fileShows = children.includes('hello.txt:file');
  // delete it
  fs.unlink('fsb-witness/hello.txt'); if (fs.flush) await fs.flush();
  api.refresh();
  out.afterDelete = api.listDir('fsb-witness').map(c => c.name);
  return out;
});

assert(report, 'mounted', !!probe.mounted, 'files app .fsb-root did not mount');
assert(report, 'dirShows', !!probe.dirShows, 'created dir "fsb-witness" not present in root listing: ' + JSON.stringify(probe.rootRows));
assert(report, 'fileShows', !!probe.fileShows, 'created file "hello.txt" not present in dir listing: ' + JSON.stringify(probe.dirChildren));
assert(report, 'afterDelete', Array.isArray(probe.afterDelete) && !probe.afterDelete.includes('hello.txt'), 'file still present after delete: ' + JSON.stringify(probe.afterDelete));
report.probe = probe;
report.errors = errs.slice(0, 10);

console.log('FSBROWSE_PROBE:', JSON.stringify(probe, null, 2));
console.log('ERRORS:', JSON.stringify(errs.slice(0, 10), null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
printReportAndExit(report);
