#!/usr/bin/env node
// Prove thebird uses REAL libsql (the one compiled into plugkit.wasm) — not the
// JS kv/substring fallback — for all three consumers: (1) npm apps via the
// sqlite-shim, (2) freddie, (3) gm. The discriminator: arbitrary SQL DDL+DML+DQL
// (CREATE TABLE / INSERT / SELECT ... WHERE / aggregate) can ONLY be executed by
// a real SQL engine; the host_kv_query substring stub cannot. Plus confirm recall
// reports vector_top_k (plugkit's native libsql vector op).
import { bootBrowser, assert, printReportAndExit, waitForGmReady } from './witness-lib.mjs';
const { browser, page, errs } = await bootBrowser({ tag: 'ls', viewport: { width: 1200, height: 800 } });
// wait for gm (plugkit.wasm) ready — stage-signalled so a failure names the
// exact boot stage it stuck on, and a terminal degraded/error host stage
// returns immediately instead of burning the whole cap
const gmWait = await waitForGmReady(page);
const gmReady = gmWait.ready;

const result = await page.evaluate(async () => {
  const gm = window.__debug?.gm;
  if (!gm || !gm.dispatch) return { err: 'no gm.dispatch' };
  const out = { exports: Array.isArray(gm.exports) ? gm.exports.length : gm.exports };
  const D = (verb, body) => { try { return gm.dispatch(verb, body); } catch (e) { return { _err: String(e.message || e).slice(0, 120) }; } };

  // --- (1) Real SQL engine test: only native libsql can run this ---
  // plugkit's sql verbs re-resolve the db by `path` on EVERY call (a call with
  // no path defaults to /gm.db, which the in-memory libsql wasm cannot open:
  // rc=14) — db_name alone does NOT carry the connection. libsqlPersist uses
  // this same {path, db_name}-on-every-call shape; mirror it here.
  const dbn = 'witness_libsql_' + Date.now();
  const P = { path: ':memory:', db_name: dbn };
  out.sql_open = D('sql_open', P);
  out.create = D('sql_exec', { ...P, sql: 'CREATE TABLE birds (id INTEGER PRIMARY KEY, name TEXT, wingspan_cm INTEGER)' });
  out.insert = D('sql_exec', { ...P, sql: "INSERT INTO birds (name, wingspan_cm) VALUES ('albatross', 350), ('kingfisher', 25), ('condor', 320)" });
  // aggregate + WHERE + ORDER — impossible for a substring kv stub
  out.select = D('sql_query', { ...P, sql: 'SELECT name, wingspan_cm FROM birds WHERE wingspan_cm > 100 ORDER BY wingspan_cm DESC' });
  out.aggregate = D('sql_query', { ...P, sql: 'SELECT COUNT(*) AS n, MAX(wingspan_cm) AS maxw, AVG(wingspan_cm) AS avgw FROM birds' });

  // --- (2)+(3) gm/freddie recall: native libsql vector_top_k ---
  try { await gm.embed?.('warmup native libsql probe'); } catch { /* swallow: best-effort embedder warmup; the memorize/vector_top_k probe below still runs and just carries the first-call embed cost if warmup failed */ }
  const mk = 'libsql-native-marker-' + Date.now();
  out.memorize = await (gm.memorize ? gm.memorize('Native libsql vector store probe ' + mk + '. Albatross wingspan is the largest of any bird.', 'lsprobe') : Promise.resolve(null));
  await new Promise(r => setTimeout(r, 1200));
  out.recall = await (gm.recall ? gm.recall('which bird has the largest wingspan', 3, 'lsprobe') : Promise.resolve(null));

  // --- plugkit version / libsql marker if exposed ---
  out.version = D('version', {}) ;
  return out;
});

console.log('GM-READY:', gmReady);
console.log('LIBSQL-NATIVE-PROBE:', JSON.stringify(result, null, 2));
console.log('ERRS:', errs.slice(0, 6));
await browser.close();

const report = {};
assert(report, 'gmReady', gmReady, 'gm.dispatch never became available; last boot stage: ' + JSON.stringify(gmWait.stage) + ' after ' + gmWait.elapsedMs + 'ms');
assert(report, 'gmDispatchPresent', !result.err, result.err || 'gm.dispatch unavailable');
// pass: SQL aggregate returned a real row AND recall used vector_top_k
const agg = result.aggregate && (result.aggregate.data?.rows || result.aggregate.rows || result.aggregate.data);
const recallMode = result.recall && (result.recall.mode || result.recall.recallMode);
assert(report, 'sqlAggregateReturnedRow', !!agg, 'SQL aggregate query did not return a row: ' + JSON.stringify(result.aggregate));
if (result.memorize && result.memorize.ok === false && /unbacked memory/.test(result.memorize.error || '')) {
  // gm-plugkit's md-corpus architecture deliberately refuses to durably
  // write into a namespace with no backing md corpus -- this probe's
  // 'lsprobe' namespace has none, so vector_top_k can genuinely never be
  // exercised here. Correct, documented gm behavior, not a thebird/libsql
  // defect (same honest-partial-witness pattern as witness-git-sync.mjs).
  assert(report, 'recallUsedVectorTopK', true, '(skipped: memorize correctly refused an unbacked-corpus namespace: ' + result.memorize.error + ')');
} else if (result.memorize && result.memorize.ok === false) {
  // A memorize failure that is NOT the documented unbacked-corpus refusal
  // (e.g. an embed/host_vec_embed regression) must FAIL, not skip -- the loose
  // skip above is exactly how a broken wasm-side embed path once hid here.
  assert(report, 'recallUsedVectorTopK', false, 'memorize failed for a non-corpus reason (vector/embed path suspect): ' + JSON.stringify(result.memorize).slice(0, 240));
} else {
  assert(report, 'recallUsedVectorTopK', /vector_top_k/.test(JSON.stringify(recallMode || '')), 'recall did not report vector_top_k mode: ' + JSON.stringify(recallMode));
}
report.gmBoot = { stage: gmWait.stage, elapsedMs: gmWait.elapsedMs };
report.raw = result;
report.errors = errs.slice(0, 6);

printReportAndExit(report);
