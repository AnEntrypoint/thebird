#!/usr/bin/env node
// Ratchet lint: every empty `catch` block (`catch {}`, `catch (e) {}`,
// `catch (_) {}`, or any blank-body catch) must say WHY it swallows. Accepted
// forms: a `// swallow: <why>` comment (inside the block, on the line
// immediately before the `catch`, or on the line immediately after the
// closing `}`), or any content-bearing comment inside the block (the
// `catch { /* why */ }` / `catch { // why }` convention used across these
// repos). This is a documentation gate, not a "never swallow errors" gate:
// swallowing is sometimes correct (best-effort persistence, teardown, etc.)
// but it must say why.
//
// Ratchet pattern (matches design's spacing lint): violations are recorded
// into an ALLOW file as a snapshot count. The gate only fails the build if
// the CURRENT violation count exceeds the snapshotted baseline — it does
// not require fixing pre-existing violations in one pass, just prevents
// new ones from being added silently.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ALLOW_FILE = join(__dirname, 'lint-swallow-comments.allow.json');

// Directories to scan for source files. This file is shared byte-for-byte
// across design/thebird/freddie (see AGENTS.md cross-repo tooling-dedup
// note) — per-repo scan scope is NOT baked into the file anymore; it is
// supplied via LINT_SWALLOW_SCAN_DIRS (comma-separated, relative to repo
// root). Defaults to design's historical ['src'] when unset so a bare
// `node scripts/lint-swallow-comments.mjs` in design is unchanged.
const SCAN_DIRS = (process.env.LINT_SWALLOW_SCAN_DIRS || 'src').split(',').map((d) => d.trim()).filter(Boolean);
const SCAN_EXT = /\.(js|mjs|cjs|ts|tsx)$/;
const SKIP_PATH_PARTS = ['node_modules', '/vendor/', '/dist/', '/.git/'];

function walk(dir, out) {
  let entries;
  try {
    entries = readdirWithTypes(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    // Normalize separators before the skip check: join() yields backslashes on
    // Windows, where '/vendor/' etc. would never match and vendored trees got
    // scanned (and flagged) despite being listed in SKIP_PATH_PARTS.
    const norm = full.replace(/\\/g, '/');
    if (SKIP_PATH_PARTS.some((p) => norm.includes(p))) continue;
    if (e.isDirectory()) {
      walk(full, out);
    } else if (e.isFile() && SCAN_EXT.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function readdirWithTypes(dir) {
  return readdirSync(dir, { withFileTypes: true });
}

// Matches `catch` (optionally `catch (e)` / `catch(_)`) followed by an
// empty block `{}` or a block containing only whitespace/comments-free
// content up to the closing brace on the same or a nearby line. We scan
// line-by-line for a simple, auditable heuristic rather than a full parser.
const CATCH_EMPTY_RE = /catch\s*(\([^)]*\))?\s*\{\s*\}/;
// A catch that opens a block but the block's *entire* content (once found)
// is blank/whitespace-only — handled by a small brace-matching scan below
// for the common multi-line empty-catch case.
const CATCH_OPEN_RE = /catch\s*(\([^)]*\))?\s*\{/;

function findViolations(file) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let matchIdx = -1;
    let inlineEmpty = false;

    if (CATCH_EMPTY_RE.test(line)) {
      matchIdx = i;
      inlineEmpty = true;
    } else if (CATCH_OPEN_RE.test(line) && !line.includes('swallow:')) {
      // Multi-line catch: find the matching close brace and check if the
      // body between them is blank (whitespace/comments only don't count
      // as "documented" unless they contain `swallow:`, checked separately).
      const openIdx = line.search(CATCH_OPEN_RE);
      const rel = line.slice(openIdx);
      const openPos = rel.indexOf('{');
      let depth = 1;
      let body = '';
      let li = i;
      let ci = openIdx + openPos + 1;
      let cur = line;
      while (depth > 0) {
        if (ci >= cur.length) {
          li++;
          if (li >= lines.length) break;
          cur = lines[li];
          ci = 0;
          body += '\n';
          continue;
        }
        const ch = cur[ci];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) break;
        }
        body += ch;
        ci++;
      }
      if (depth === 0 && body.replace(/\s/g, '').replace(/\/\*.*?\*\//gs, '') === '' ) {
        // Body is blank or comment-only. A comment-only body that actually
        // says WHY (the repo's `catch { /* why */ }` convention, or a
        // `// why` line comment) IS documented — only a truly blank body is
        // a violation here (the `swallow:` window check below remains an
        // additional accepted form for comments placed around the catch).
        const saysWhy = (body.match(/\/\*[\s\S]*?\*\//g) || []).concat(body.match(/\/\/[^\n]*/g) || []).some((c) => /[A-Za-z0-9]/.test(c));
        if (!saysWhy) matchIdx = i;
      } else if (depth === 0) {
        // Body is non-blank but may be ONLY a comment (still "empty" in
        // effect since no statements execute) — check for statement chars.
        const stripped = body
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/[^\n]*/g, '')
          .replace(/\s/g, '');
        if (stripped === '') {
          const saysWhy = (body.match(/\/\*[\s\S]*?\*\//g) || []).concat(body.match(/\/\/[^\n]*/g) || []).some((c) => /[A-Za-z0-9]/.test(c));
          if (!saysWhy) matchIdx = i;
        }
      }
    }

    if (matchIdx === -1) continue;

    // Check for a swallow comment: inline on the match line, inside the
    // body (already captured for multiline via CATCH_OPEN_RE branch — but
    // we re-check by scanning a small window), on the preceding line, or
    // on the following line.
    const windowStart = Math.max(0, i - 1);
    const windowEnd = Math.min(lines.length - 1, i + 3);
    let documented = false;
    for (let w = windowStart; w <= windowEnd; w++) {
      if (lines[w].includes('swallow:')) {
        documented = true;
        break;
      }
    }
    if (!documented) {
      violations.push({ file, line: i + 1, text: line.trim().slice(0, 160) });
    }
  }
  return violations;
}

// lint-all.mjs entry point: same ratchet check as `main()`, but as a
// throwing function so it composes with the other OrThrow gates.
export function lintSwallowCommentsOrThrow() {
  const files = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
  const allViolations = [];
  for (const f of files) allViolations.push(...findViolations(f));
  const count = allViolations.length;

  let baseline = { count: 0 };
  if (existsSync(ALLOW_FILE)) {
    baseline = JSON.parse(readFileSync(ALLOW_FILE, 'utf8'));
  } else {
    writeFileSync(ALLOW_FILE, JSON.stringify({ count, updated: new Date().toISOString() }, null, 2) + '\n');
    return;
  }
  if (count > baseline.count) {
    throw new Error(`[lint-swallow-comments] ${count} undocumented empty catch block(s) exceeds baseline ${baseline.count}. Add // swallow: <why>.`);
  }
}

function main() {
  const files = [];
  for (const d of SCAN_DIRS) {
    walk(join(ROOT, d), files);
  }

  const allViolations = [];
  for (const f of files) {
    allViolations.push(...findViolations(f));
  }

  const count = allViolations.length;
  const reportOnly = process.argv.includes('--report');
  const writeBaseline = process.argv.includes('--write-baseline');

  console.log(`[lint-swallow-comments] scanned ${files.length} files, found ${count} undocumented empty catch block(s)`);
  for (const v of allViolations) {
    console.log(`  ${v.file.replace(ROOT + '/', '')}:${v.line}: ${v.text}`);
  }

  if (writeBaseline) {
    writeFileSync(ALLOW_FILE, JSON.stringify({ count, updated: new Date().toISOString() }, null, 2) + '\n');
    console.log(`[lint-swallow-comments] wrote baseline count=${count} to ${ALLOW_FILE}`);
    return;
  }

  if (reportOnly) return;

  let baseline = { count: 0 };
  if (existsSync(ALLOW_FILE)) {
    baseline = JSON.parse(readFileSync(ALLOW_FILE, 'utf8'));
  } else {
    writeFileSync(ALLOW_FILE, JSON.stringify({ count, updated: new Date().toISOString() }, null, 2) + '\n');
    console.log(`[lint-swallow-comments] no baseline found, wrote initial baseline count=${count}`);
    return;
  }

  if (count > baseline.count) {
    console.error(`[lint-swallow-comments] FAIL: ${count} violations exceeds baseline ${baseline.count}. Add // swallow: <why> to new empty catch blocks, or run with --write-baseline if this growth is reviewed/intentional.`);
    process.exit(1);
  }
  console.log(`[lint-swallow-comments] PASS: ${count} <= baseline ${baseline.count}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
