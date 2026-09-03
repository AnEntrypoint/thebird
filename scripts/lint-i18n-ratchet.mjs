#!/usr/bin/env node
// Ratchet lint: in any docs/*.js file that has ALREADY adopted t() (i.e. it
// calls t(...) somewhere), flag bare string literals assigned to
// .textContent/.title/.placeholder, or passed as a text argument to the
// el() helper, that look like user-facing UI text and are NOT already
// wrapped in a t(...) call. This is inherently heuristic — there is no
// perfect static test for "user-facing" vs internal/technical string, so
// false positives/negatives are expected. The point is not perfection, it's
// a ratchet: don't let the count of un-t()'d strings in already-adopted
// files grow silently.
//
// Ratchet pattern (matches design's spacing lint / this repo's
// lint-swallow-comments.mjs): violations are recorded into an ALLOW file as
// a snapshot count. The gate only fails if the CURRENT count exceeds the
// snapshotted baseline — it does not require fixing pre-existing
// violations in one pass, just prevents new ones from being added
// silently to files that already know how to use t().
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ALLOW_FILE = join(__dirname, 'lint-i18n-ratchet.allow.json');

const SCAN_DIRS = ['docs'];
const SCAN_EXT = /\.(js|mjs)$/;
const SKIP_PATH_PARTS = ['node_modules', '/vendor/', '/dist/', '/.git/'];

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (SKIP_PATH_PARTS.some((p) => full.includes(p))) continue;
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && SCAN_EXT.test(e.name)) out.push(full);
  }
  return out;
}

// A literal "looks like UI text" if it's a quoted string containing at
// least one letter and at least one space (heuristic: single technical
// tokens like 'div', 'click', CSS class names, event names rarely have
// spaces; real UI copy usually does), or ends in typical punctuation
// (: . … ?) even without a space (e.g. 'Cancel:'). Pure identifiers,
// URLs, and CSS selectors are excluded via a few cheap exclusions.
function looksLikeUiText(str) {
  if (!str) return false;
  if (/^[a-z0-9_.\-/#]+$/i.test(str)) return false; // identifier/selector/path-ish, no spaces or punctuation
  if (/^https?:\/\//.test(str)) return false;
  if (/^[.#\[][\w.\-#\[\]="': ]*$/.test(str)) return false; // CSS selector-ish
  const hasSpace = /\s/.test(str);
  const hasSentencePunct = /[.:!?…]$/.test(str.trim());
  const hasLetters = /[a-zA-Z]/.test(str);
  return hasLetters && (hasSpace || hasSentencePunct) && str.trim().length >= 2;
}

// Matches a quoted string literal (single, double, or template with no
// ${} interpolation) as the RHS of `.textContent =`, `.title =`,
// `.placeholder =`, or as a direct string arg to `el(...)`.
const ASSIGN_RE = /\.(textContent|title|placeholder)\s*=\s*(['"`])((?:\\.|(?!\2).)*)\2/g;
// el('tag', {...}, 'Some Text') or el('tag', 'cls', 'Some Text') — capture
// trailing bare string args (not nested calls/vars). Simple heuristic: find
// `el(` calls and scan for quoted-string arguments in the tail.
const EL_CALL_RE = /\bel\(\s*(['"`])[\w-]+\1\s*,[^)]*?(['"`])((?:\\.|(?!\2).)*)\2\s*\)/g;

function findViolations(file) {
  const text = readFileSync(file, 'utf8');
  if (!/\bt\(/.test(text)) return []; // file hasn't adopted t() yet — not in scope for this ratchet
  const lines = text.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bt\(/.test(line)) continue; // this line already calls t() somewhere — assume it's the wrapped literal

    let m;
    ASSIGN_RE.lastIndex = 0;
    while ((m = ASSIGN_RE.exec(line))) {
      const str = m[3];
      if (looksLikeUiText(str)) {
        violations.push({ file, line: i + 1, text: line.trim().slice(0, 160), kind: `.${m[1]} = "${str}"` });
      }
    }
    EL_CALL_RE.lastIndex = 0;
    while ((m = EL_CALL_RE.exec(line))) {
      const str = m[3];
      if (looksLikeUiText(str)) {
        violations.push({ file, line: i + 1, text: line.trim().slice(0, 160), kind: `el(..., "${str}")` });
      }
    }
  }
  return violations;
}

function main() {
  const files = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);

  const allViolations = [];
  for (const f of files) allViolations.push(...findViolations(f));

  const count = allViolations.length;
  const reportOnly = process.argv.includes('--report');
  const writeBaseline = process.argv.includes('--write-baseline');

  console.log(`[lint-i18n-ratchet] scanned ${files.length} files, found ${count} un-t()'d UI string literal(s) in t()-adopted files`);
  for (const v of allViolations) {
    console.log(`  ${v.file.replace(ROOT + '/', '')}:${v.line}: ${v.kind} -- ${v.text}`);
  }

  if (writeBaseline) {
    writeFileSync(ALLOW_FILE, JSON.stringify({ count, updated: new Date().toISOString() }, null, 2) + '\n');
    console.log(`[lint-i18n-ratchet] wrote baseline count=${count} to ${ALLOW_FILE}`);
    return;
  }

  if (reportOnly) return;

  let baseline = { count: 0 };
  if (existsSync(ALLOW_FILE)) {
    baseline = JSON.parse(readFileSync(ALLOW_FILE, 'utf8'));
  } else {
    writeFileSync(ALLOW_FILE, JSON.stringify({ count, updated: new Date().toISOString() }, null, 2) + '\n');
    console.log(`[lint-i18n-ratchet] no baseline found, wrote initial baseline count=${count}`);
    return;
  }

  if (count > baseline.count) {
    console.error(`[lint-i18n-ratchet] FAIL: ${count} violations exceeds baseline ${baseline.count}. Wrap new UI text literals in t(key, fallback), or run with --write-baseline if this growth is reviewed/intentional.`);
    process.exit(1);
  }
  console.log(`[lint-i18n-ratchet] PASS: ${count} <= baseline ${baseline.count}`);
}

main();
