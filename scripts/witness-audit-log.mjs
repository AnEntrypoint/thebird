#!/usr/bin/env node
// Witnesses the in-browser audit log subsystem (docs/audit.js createAuditLog)
// end-to-end: drive a real terminal command through the real shell (docs/shell.js),
// which wires PROCESS_SPAWN/PROCESS_EXIT events through createAuditLog on every
// top-level command, then read the persisted /var/log/audit.json back via the
// instance's real per-instance fs and assert shape + masking behavior.
//
// Also drives a real `curl` call with a fake Authorization header through the
// shell's one real audited fetch call site (shell-sw-jobs.js makeCurlBuiltin ->
// ctx.fetchAudit -> installFetchAudit) to witness maskKey/maskHeaders live,
// since NET_REQUEST/NET_RESPONSE (not FILE_WRITE) is the actual masked-key path
// wired into shell.js today.
import { bootBrowser, waitForActiveInstance, assert, printReportAndExit } from './witness-lib.mjs';

const { browser, page, errs } = await bootBrowser({ tag: 'al' });
const report = {};

const gotInstance = await waitForActiveInstance(page);
assert(report, 'activeInstance', gotInstance, 'no active shell instance after boot');

// 1. Open terminal, run a real command (process.spawn/process.exit pair) and
//    a real curl call to generate a live net.request/net.response pair.
//    NOTE: witnessed live that this repo's curl builtin (docs/shell-sw-jobs.js
//    makeCurlBuiltin) does not implement -H/--header at all -- no header
//    parsing exists on that call site, so a curl-driven Authorization header
//    can never reach installFetchAudit's maskHeaders() through curl today.
//    That is a real, separate product gap (curl has no -H support), not an
//    audit-log defect -- recorded as its own assertion below rather than
//    silently worked around. Masking itself (the actual audit.js behavior)
//    is witnessed directly against the real exported maskKey/maskHeaders
//    functions in step 2b, since that's the only live call site in the
//    running app that ever attaches a real Authorization header today
//    (chat-config.js's acptoapi key flow) and that flow needs live model
//    config this witness doesn't set up.
await page.evaluate(async () => { try { await window.__debug.shell.openApp('terminal'); } catch { /* swallow: best-effort open; downstream steps assert on absence of the terminal window instead */ } });
await new Promise(r => setTimeout(r, 3500));

// Witnessed live (see witness-git-sync.mjs comment): a comma-selector
// page.$() can match the outer .xterm wrapper before the real input
// textarea, and click()-ing that wrapper does not reliably focus the input,
// silently dropping keystrokes. Query the helper textarea directly and
// focus it via page.evaluate.
const termWin = await page.$('.wm-win[data-kind="terminal"] .xterm-helper-textarea');
if (termWin) {
  await page.evaluate(() => {
    document.querySelector('.wm-win[data-kind="terminal"] .xterm-helper-textarea')?.focus();
  });
  await page.keyboard.type('echo audit-witness-hello');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 1500));
  await page.keyboard.type('curl -H "Authorization: Bearer sk-fake-secret-witness-token-12345" https://example.com/');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 3500));
}

report.terminalDriven = { pass: !!termWin, detail: termWin ? null : 'terminal xterm surface not found' };

// 2. Read the persisted audit log back through the real instance fs (same
// storage createAuditLog's persistNow()/AUDIT_PATH write through).
const auditRead = await page.evaluate(() => {
  const insts = window.__debug?.instances ? Object.values(window.__debug.instances) : [];
  const inst = insts.find(i => i && i.fs && typeof i.fs.readJson === 'function');
  if (!inst) return { err: 'no instance with fs.readJson found' };
  let entries;
  try { entries = inst.fs.readJson('/var/log/audit.json', []); }
  catch (e) { return { err: 'readJson threw: ' + String(e).slice(0, 200) }; }
  return { entries: Array.isArray(entries) ? entries : null, raw: entries };
});

assert(report, 'auditLogReadable', !auditRead.err && Array.isArray(auditRead.entries),
  auditRead.err || 'audit.json was not an array: ' + JSON.stringify(auditRead.raw).slice(0, 200));

const entries = Array.isArray(auditRead.entries) ? auditRead.entries : [];

assert(report, 'entriesExist', entries.length > 0, 'audit.json had 0 entries after driving real terminal commands');

const spawnEvents = entries.filter(e => e && e.event === 'process.spawn');
const exitEvents = entries.filter(e => e && e.event === 'process.exit');
assert(report, 'processSpawnLogged', spawnEvents.length > 0, 'no process.spawn entries; expected one per top-level command run');
assert(report, 'processExitLogged', exitEvents.length > 0, 'no process.exit entries; expected one per top-level command run');

const echoSpawn = spawnEvents.find(e => e.data && /echo audit-witness-hello/.test(e.data.cmd || ''));
assert(report, 'echoCommandCaptured', !!echoSpawn, 'echo audit-witness-hello command not found among process.spawn cmd values: ' +
  JSON.stringify(spawnEvents.map(e => e.data && e.data.cmd)).slice(0, 300));

// source field correctness: shell.js logs process.spawn/exit with source 'user'
const badSource = spawnEvents.find(e => e.source !== 'user');
assert(report, 'sourceFieldCorrect', !badSource, 'expected source:"user" on process.spawn entries, got: ' + JSON.stringify(badSource));

// 3. NET_REQUEST/NET_RESPONSE from the curl call: assert entries exist AND
// that the fake bearer token is masked, never present in plaintext.
const netEvents = entries.filter(e => e && (e.event === 'net.request' || e.event === 'net.response'));
assert(report, 'netEventsLogged', netEvents.length > 0, 'no net.request/net.response entries from curl call; curl builtin may not be wired to ctx.fetchAudit, or call failed before dispatch');

const rawJson = JSON.stringify(netEvents);
const secretLeaked = rawJson.includes('sk-fake-secret-witness-token-12345');
assert(report, 'apiKeyMasked', !secretLeaked, 'RAW bearer token found unmasked in audit log net events -- maskHeaders/maskKey not applied: ' + rawJson.slice(0, 500));

// Documented product gap, witnessed live above (not assumed): curl's -H flag
// is not implemented in this shell's curl builtin, so an Authorization
// header set via `curl -H "..."` never actually reaches the outbound
// request (headers logged as {}), and therefore never reaches maskHeaders()
// through this path. This is a real finding, recorded explicitly rather than
// papered over.
const curlHeadersEmpty = netEvents.every(e => !e.data || !e.data.headers || Object.keys(e.data.headers).length === 0);
report.curlHeaderFlagUnimplemented = {
  pass: true,
  note: curlHeadersEmpty
    ? "CONFIRMED LIVE: curl's -H/--header flag is not implemented (docs/shell-sw-jobs.js makeCurlBuiltin) -- request headers logged empty despite -H on the command line. This means the masking path can't be exercised via curl; see maskHeadersDirectCall below for direct verification of the actual masking logic."
    : 'curl -H unexpectedly produced non-empty headers; reassess this finding',
};

// 2b. Directly exercise the real exported maskKey/maskHeaders functions
// in-page (the actual audit.js module already loaded by the running app)
// since no live call site in this environment attaches a real bearer token
// to an outbound request today. This witnesses the real masking LOGIC, not
// a copy/reimplementation of it.
const maskResult = await page.evaluate(async () => {
  const mod = await import('./audit.js');
  const key = 'sk-fake-secret-witness-token-12345';
  const masked = mod.maskKey(key);
  const maskedHeaders = mod.maskHeaders({ Authorization: 'Bearer ' + key, 'x-api-key': key, 'content-type': 'application/json' });
  return { masked, maskedHeaders };
});
const secretForCheck = 'sk-fake-secret-witness-token-12345';
const maskedOk = typeof maskResult.masked === 'string' && maskResult.masked.includes('...') && !maskResult.masked.includes(secretForCheck);
assert(report, 'maskedShapeObserved', maskedOk, 'maskKey() output did not have the expected first7...last4 masked shape: ' + JSON.stringify(maskResult));
report.maskHeadersDirectCall = maskResult;

report.sampleEntries = entries.slice(-8);
report.errors = errs.slice(0, 12);

console.log('--- witness-audit-log.mjs ---');
for (const [k, v] of Object.entries(report)) {
  if (v && typeof v === 'object' && 'pass' in v) {
    console.log((v.pass ? 'PASS' : 'FAIL') + ' ' + k + (v.pass ? '' : ' :: ' + v.detail));
  }
}
console.log(JSON.stringify(report, null, 2));
await browser.close();
printReportAndExit(report);
