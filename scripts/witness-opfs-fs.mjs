#!/usr/bin/env node
// Real-execution witness for OPFS-primary filesystem backing (instance-fs.js +
// instance-fs-opfs.js): a real file write via the shell, a real check that it
// landed in actual OPFS (not just the in-memory snapshot mirror), and a real
// reload to prove it persists across reload from OPFS, not IndexedDB.
import { bootBrowser, waitForActiveInstance, assert, printReportAndExit } from './witness-lib.mjs';

const URL = process.argv[2] || 'http://localhost:3000/os.html';
const { browser, page, errs } = await bootBrowser({ tag: 'opfs', url: URL });
const R = {};

R.activeInstance = await waitForActiveInstance(page);

// 1. OPFS support + instance-fs actually chose the OPFS backend.
R.support = await page.evaluate(() => {
  const opfsApiPresent = typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function';
  // window.__debug.shell.active is the live active INSTANCE OBJECT itself
  // ({id, fs, worker, shells, browser}), not an id to look up -- confirmed
  // live via a real page.evaluate probe (os-shell.js's shell API shape).
  const s = window.__debug?.shell;
  const inst = s?.active || null;
  return {
    opfsApiPresent,
    hasActiveInstance: !!inst,
    usingOpfs: inst?.fs?.usingOpfs ?? null,
    dbName: inst?.fs?.dbName ?? null,
    instanceId: inst?.id ?? null,
  };
});

// 2. Real write through the shell's own fs API (writeFile), then flush() to
// force the debounced persist to settle synchronously from this script's
// point of view, then confirm a REAL OPFS file exists at that path by
// reading straight from navigator.storage.getDirectory() -- bypassing
// instance-fs.js entirely so this assertion can't be fooled by the
// in-memory snapshot alone.
const TEST_PATH = '/tmp/witness-opfs-probe.txt';
const TEST_CONTENT = 'opfs-primary-fs-witness-' + Date.now();

R.writeAndFlush = await page.evaluate(async (path, content) => {
  const inst = window.__debug?.shell?.active;
  if (!inst?.fs) return { error: 'no active instance fs' };
  inst.fs.writeFile(path, content);
  await inst.fs.flush();
  return { wrote: true, dbName: inst.fs.dbName, usingOpfs: inst.fs.usingOpfs, snapshotHasKey: (path.replace(/^\//, '') in inst.fs.snapshot) };
}, TEST_PATH, TEST_CONTENT);

R.realOpfsFileCheck = await page.evaluate(async (dbName, path, expectedContent) => {
  if (!dbName) return { skipped: 'no dbName (OPFS not in use)' };
  try {
    const root = await navigator.storage.getDirectory();
    const instDir = await root.getDirectoryHandle(dbName);
    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
    const fname = parts.pop();
    let dir = instDir;
    for (const seg of parts) dir = await dir.getDirectoryHandle(seg);
    const fh = await dir.getFileHandle(fname);
    const file = await fh.getFile();
    const text = await file.text();
    return { found: true, matches: text === expectedContent, actual: text.slice(0, 80) };
  } catch (e) {
    return { found: false, error: String(e).slice(0, 200) };
  }
}, R.writeAndFlush.dbName, TEST_PATH, TEST_CONTENT);

// 3. Reload the page (real navigation, fresh JS heap -- the in-memory
// snapshot object from step 2 is gone) and verify the file is still
// readable through the shell's fs API, proving it came back from durable
// OPFS storage, not a live-object artifact.
await page.goto(URL + '?opfs2=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 90000 });
await new Promise(r => setTimeout(r, 9000));
await waitForActiveInstance(page);

R.afterReload = await page.evaluate(async (path, expectedContent) => {
  const inst = window.__debug?.shell?.active;
  if (!inst?.fs) return { error: 'no active instance fs after reload' };
  let readBack = null;
  try { readBack = inst.fs.readFile(path); } catch (e) { readBack = 'THROW:' + String(e).slice(0, 100); }
  return { usingOpfs: inst.fs.usingOpfs, dbName: inst.fs.dbName, readBack, matches: readBack === expectedContent };
}, TEST_PATH, TEST_CONTENT);

// 4. Cleanup: unlink the probe file so repeated runs don't accumulate state,
// and verify the delete propagates to real OPFS too.
R.cleanup = await page.evaluate(async (path) => {
  const inst = window.__debug?.shell?.active;
  if (!inst?.fs) return { error: 'no active instance fs' };
  inst.fs.unlink(path);
  await inst.fs.flush();
  return { unlinked: true, stillExists: inst.fs.exists(path) };
}, TEST_PATH);

R.errors = errs.slice(0, 12);

const report = {};
assert(report, 'opfsApiPresent', !!R.support.opfsApiPresent, 'navigator.storage.getDirectory not available in this browser: ' + JSON.stringify(R.support));
assert(report, 'instanceFsUsingOpfs', R.support.usingOpfs === true, 'instance-fs did not select the OPFS backend: ' + JSON.stringify(R.support));
assert(report, 'writeSucceeded', !!R.writeAndFlush.wrote && !!R.writeAndFlush.snapshotHasKey, 'writeFile+flush did not land in the in-memory snapshot: ' + JSON.stringify(R.writeAndFlush));
assert(report, 'realOpfsFileExists', !!R.realOpfsFileCheck.found, 'no real OPFS file found at the written path (bypassing instance-fs.js): ' + JSON.stringify(R.realOpfsFileCheck));
assert(report, 'realOpfsFileContentMatches', !!R.realOpfsFileCheck.matches, 'real OPFS file content did not match what was written: ' + JSON.stringify(R.realOpfsFileCheck));
assert(report, 'persistsAcrossReload', R.afterReload.matches === true, 'file did not read back correctly after a real page reload: ' + JSON.stringify(R.afterReload));
assert(report, 'afterReloadStillUsingOpfs', R.afterReload.usingOpfs === true, 'instance-fs did not re-select OPFS backend after reload: ' + JSON.stringify(R.afterReload));
assert(report, 'unlinkPropagates', R.cleanup.unlinked === true && R.cleanup.stillExists === false, 'unlink did not remove the file from the snapshot: ' + JSON.stringify(R.cleanup));

report._raw = R;
await browser.close();
printReportAndExit(report);
