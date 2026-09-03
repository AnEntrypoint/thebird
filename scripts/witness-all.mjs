#!/usr/bin/env node
// Serial runner for every scripts/witness-*.mjs probe. Runs each one as a
// child process (so a crash/hang in one script can't take the runner down),
// captures its exit code + stdout, tries to parse the trailing JSON report
// each script prints, and tallies assert()-recorded pass/fail counts from
// witness-lib.mjs's `{ pass: true|false, detail }` shape. Prints a summary
// table at the end and exits non-zero if any script failed.
//
// Requires a live target (bunx serve docs, + bunx acptoapi for chat-*
// scripts) — this runner does not boot anything itself, it just fans out to
// the existing scripts, same as running them individually.
//
// Usage: node scripts/witness-all.mjs [url]
//   url defaults per-script (each witness-*.mjs falls back to
//   http://localhost:3000/os.html on its own if no argv[2] is given).

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.basename(fileURLToPath(import.meta.url));
const url = process.argv[2]; // optional; forwarded to every script if given

// Runner/orchestrator modules that match the witness-*.mjs glob but are not
// themselves leaf probes -- witness-manifest.mjs is witness-all.mjs's own
// sibling tagged-runner (re-fans-out a big chunk of the SAME scripts this
// loop already runs); including it here means this loop shells out to a
// second, redundant full sub-run and then treats ITS aggregate exit code as
// a single script's result, permanently red regardless of KNOWN_NON_BLOCKING
// below since witness-manifest.mjs has no such concept of its own.
const NON_PROBE_SCRIPTS = new Set(['witness-lib.mjs', 'witness-manifest.mjs']);

function listWitnessScripts() {
  return readdirSync(__dirname)
    .filter(f => f.startsWith('witness-') && f.endsWith('.mjs'))
    .filter(f => f !== SELF)
    .filter(f => !NON_PROBE_SCRIPTS.has(f))
    .sort();
}

/** Extract the last top-level JSON object printed to stdout, if any. */
function extractTrailingJson(stdout) {
  // Scripts print `console.log(JSON.stringify(report, null, 2))` near the
  // end (possibly followed by nothing else). Find the last '{' that starts
  // a balanced JSON object spanning to the end of trimmed output.
  const trimmed = stdout.trimEnd();
  const lastBrace = trimmed.lastIndexOf('\n{');
  const start = lastBrace === -1 ? (trimmed.startsWith('{') ? 0 : -1) : lastBrace + 1;
  if (start === -1) return null;
  const candidate = trimmed.slice(start);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/** Count assert()-recorded pass/fail entries in a parsed report object. */
function tallyReport(report) {
  if (!report || typeof report !== 'object') return { passed: 0, failed: 0, total: 0 };
  let passed = 0, failed = 0;
  for (const v of Object.values(report)) {
    if (v && typeof v === 'object' && 'pass' in v && typeof v.pass === 'boolean') {
      if (v.pass) passed++; else failed++;
    }
  }
  return { passed, failed, total: passed + failed };
}

const scripts = listWitnessScripts();
const results = [];

console.log(`witness-all: running ${scripts.length} witness scripts serially...\n`);

for (const script of scripts) {
  const scriptPath = path.join(__dirname, script);
  const args = url ? [scriptPath, url] : [scriptPath];
  process.stdout.write(`--- ${script} ---\n`);
  const start = Date.now();
  const res = spawnSync('node', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const durationMs = Date.now() - start;
  const exitCode = res.status === null ? (res.signal ? 1 : -1) : res.status;
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const report = extractTrailingJson(stdout);
  const { passed, failed, total } = tallyReport(report);

  const ok = exitCode === 0;
  results.push({ script, ok, exitCode, durationMs, passed, failed, total, signal: res.signal || null });

  if (!ok) {
    console.log(`FAIL exit=${exitCode}${res.signal ? ' signal=' + res.signal : ''} asserts=${passed}/${total} (${durationMs}ms)`);
    if (report) {
      const failing = Object.entries(report).filter(([, v]) => v && typeof v === 'object' && v.pass === false);
      if (failing.length) {
        const describe = v => (typeof v.detail === 'object' ? JSON.stringify(v.detail) : String(v.detail ?? '(no detail)'));
        console.log('failing asserts:\n' + failing.map(([k, v]) => `  ${k}: ${describe(v)}`).join('\n'));
      }
    }
    if (stderr.trim()) console.log('stderr tail:\n' + stderr.trim().slice(-1500));
  } else {
    console.log(`PASS asserts=${passed}/${total} (${durationMs}ms)`);
  }
  console.log('');
}

// Summary table
const nameW = Math.max(6, ...results.map(r => r.script.length));
// Scripts that are honest-by-construction about documenting a real,
// currently-unimplemented upstream feature (see each script's own header
// comment) rather than testing thebird's own code: they deliberately
// report a genuine failing assertion instead of ever fabricating a pass,
// so their own exit code correctly stays non-zero even when everything
// they DO control is fine. Gating overall CI red on that would mean CI can
// never go green until the upstream feature ships, which defeats the
// purpose of running them for visibility. Their result is still printed
// and NOT silently hidden -- only excluded from the pass/fail gate itself.
// witness-ws-chat.mjs's non-blocking upstream-gap exemption (acptoapi has no
// /v1/ws route yet) moved with it into witness-chat.mjs's own wsChat case --
// that merged script now excludes wsChat.* keys from ITS OWN exit-code gate
// internally (see witness-chat.mjs), so there is nothing to key off of here
// at the filename level anymore. Keep this set for any FUTURE script-level
// (not case-level) honest-non-blocking finding.
const KNOWN_NON_BLOCKING = new Set([]);

console.log('='.repeat(nameW + 40));
console.log('SUMMARY');
console.log('='.repeat(nameW + 40));
console.log(
  'script'.padEnd(nameW) + '  status  asserts   exit  time'
);
let anyFailed = false;
for (const r of results) {
  if (!r.ok && !KNOWN_NON_BLOCKING.has(r.script)) anyFailed = true;
  const nonBlocking = !r.ok && KNOWN_NON_BLOCKING.has(r.script);
  const status = r.ok ? 'PASS' : (nonBlocking ? 'KNOWN' : 'FAIL');
  const asserts = r.total > 0 ? `${r.passed}/${r.total}` : '-';
  console.log(
    r.script.padEnd(nameW) + '  ' + status.padEnd(6) + '  ' + asserts.padEnd(8) + '  ' + String(r.exitCode).padEnd(4) + '  ' + r.durationMs + 'ms'
  );
}
console.log('='.repeat(nameW + 40));
const totalScripts = results.length;
const failedScripts = results.filter(r => !r.ok && !KNOWN_NON_BLOCKING.has(r.script)).length;
console.log(`${totalScripts - failedScripts}/${totalScripts} scripts passed (excluding known-non-blocking upstream gaps)`);

process.exit(anyFailed ? 1 : 0);
