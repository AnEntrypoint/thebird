#!/usr/bin/env node
// thebird sync-upstream: refresh vendored anentrypoint-design + freddie skills to npm @latest.
// Usage: node scripts/sync-upstream.mjs [--dry-run]
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { npmViewVersion, resolveSiblingDefault, exists } from './refresh-common.mjs'
import { copyFileSync } from 'node:fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')

// Returns { version } on success, { notFound: true } for a genuinely
// absent package (npm registry 404), or { error } for a transient/infra
// failure (network, timeout, rate-limit). Callers must NOT treat a
// transient error as "skip update" — that masks degradation (fail-loud).
// Backed by a direct HTTPS registry fetch (scripts/refresh-common.mjs
// npmViewVersion) rather than shelling out to a local npm binary.
async function viewVersion(pkg) {
    try { const ver = await npmViewVersion(pkg, 'latest'); return { version: ver } }
    catch (e) {
        if (e.notFound) return { notFound: true }
        return { error: e }
    }
}

// Each target carries the source-of-truth dev path (used by its refresh
// script as default --local) so dev boxes pick up working-tree edits with
// no npm publish round-trip. CI passes --npm to force published-tarball.
// localTree here documents each script's own fallback default only —
// resolveSiblingDefault() checks vendor-src/<name> (the git submodule) first.
const targets = [
    { pkg: 'anentrypoint-design', stamp: 'docs/vendor/kits/os/.version', refresh: 'scripts/refresh-design.mjs',  localTree: 'vendor-src/design' },
    { pkg: 'freddie',             stamp: 'docs/vendor/freddie/.version', refresh: 'scripts/refresh-freddie.mjs', localTree: 'vendor-src/freddie' },
    { pkg: 'gm-plugkit',          stamp: 'docs/vendor/gm/.version',      refresh: 'scripts/refresh-gm.mjs',      localTree: 'vendor-src/gm' },
]

let dirty = false
let hadTransientError = false
for (const t of targets) {
    const view = await viewVersion(t.pkg)
    if (view.error) { console.error(`! ${t.pkg}: npm view failed (transient): ${view.error.message}`); hadTransientError = true; continue }
    if (view.notFound) { console.error(`! ${t.pkg}: not in registry — skipping`); continue }
    const latest = view.version
    const stampPath = resolve(ROOT, t.stamp)
    // .version stamps are JSON. Canonical schema (all three refresh scripts):
    // {package, version, refreshedAt, source}. gm-plugkit additionally records
    // pkgVersion (npm package version) because its `version` is the wasm CONTENT
    // version, which can differ from the npm tarball version; readers must key
    // on `version` and ignore unknown fields. Reading the raw JSON text and
    // comparing it to a bare version
    // string made every target report dirty on every run (false positive).
    let have = '(none)'
    if (existsSync(stampPath)) {
        try {
            const txt = readFileSync(stampPath, 'utf8').trim()
            try {
                const stamp = JSON.parse(txt)
                if (typeof stamp.source === 'string' && stamp.source.startsWith('local:')) {
                    console.warn(`! ${t.stamp}: local-sourced stamp — treating as stale (source: ${stamp.source})`)
                } else {
                    // gm-plugkit's `version` is the wasm CONTENT version (e.g.
                    // 0.1.1055), which never equals the npm package version
                    // (e.g. 2.0.2232) that `latest` resolves to — key the
                    // freshness comparison on pkgVersion when present, else gm
                    // re-vendors on every single run (perpetual false dirty).
                    have = stamp.pkgVersion || stamp.version || '(none)'
                }
            }
            catch { console.warn(`! ${t.stamp}: malformed JSON .version stamp — treating as stale`); have = '(none)' }
        } catch (e) { console.warn(`! ${t.stamp}: unreadable (${e.message}) — treating as stale`); have = '(none)' }
    }
    if (have === latest) { console.log(`= ${t.pkg} ${have}`); continue }
    console.log(`~ ${t.pkg}: ${have} -> ${latest}`)
    dirty = true
    if (dryRun) continue
    if (t.refresh && existsSync(resolve(ROOT, t.refresh))) {
        // Forward source-selection flags so `sync-upstream --npm` actually
        // reaches the refresh scripts — without this, the stamp-staleness
        // check above (local-sourced => stale) fights the refresh scripts'
        // local-by-default behavior and every run re-vendors from local,
        // re-stamps local:, and reports dirty forever.
        const forward = ['--npm', '--local'].filter(f => process.argv.includes(f))
        const r = spawnSync('node', [t.refresh, ...forward], { cwd: ROOT, stdio: 'inherit' })
        // Exit 3 is refresh-freddie.mjs's documented signal for a known,
        // structural gap (npm mode can't ship dist/browser/freddie.js — see
        // that script's own comment) rather than a genuine failure: warn and
        // keep going so the OTHER targets in this loop (design, gm-plugkit)
        // still refresh on a scheduled CI run that has no local freddie
        // checkout to fall back to. Every other non-zero status is a real
        // failure and still aborts the whole run.
        if (r.status === 3) {
            console.warn(`! ${t.refresh}: partial (exit 3) — known structural gap, continuing`)
        } else if (r.error || r.status !== 0) {
            const msg = r.error ? r.error.message : `exited with status ${r.status}`
            console.error(`! ${t.refresh} failed: ${msg}`)
            process.exit(1)
        }
    } else {
        console.log(`  (no refresh script for ${t.pkg}; manual vendor update required)`)
    }
}

// Cross-repo DEV-TOOLING sync (distinct from the npm-package vendor loop
// above): scripts/lint-swallow-comments.mjs is a dev-tooling script, not
// runtime UI code, so it does NOT go through the refresh-*.mjs runtime-vendor
// pipeline (that pipeline exists for docs/vendor/ RUNTIME surfaces pulled
// from a published npm package + version-stamped). It has no npm package of
// its own to version-stamp. The lightweight-but-real distribution for this
// class of file is a straight local-checkout copy, gated the same way
// --local vendor refreshes are (sibling-directory discovery), run only when
// a local anentrypoint-design checkout is actually present next to this
// repo — CI has no such checkout, so this step is a no-op there by design.
// design is canonical for this file (see AGENTS.md cross-repo tooling-dedup
// note); thebird and freddie both consume it byte-identical, with per-repo
// scan scope supplied at call time via the LINT_SWALLOW_SCAN_DIRS env var
// rather than baked into the file.
async function syncToolingScripts() {
    const designDir = await resolveSiblingDefault(ROOT, ['anentrypoint-design', 'design'], null)
    if (!designDir) { console.log('(tooling sync) no local anentrypoint-design/design checkout found next to thebird — skipping'); return }
    const src = resolve(designDir, 'scripts/lint-swallow-comments.mjs')
    if (!(await exists(src))) { console.log(`(tooling sync) ${src} missing upstream — skipping`); return }
    const dst = resolve(ROOT, 'scripts/lint-swallow-comments.mjs')
    const before = existsSync(dst) ? readFileSync(dst, 'utf8') : null
    const after = readFileSync(src, 'utf8')
    if (before === after) { console.log('= lint-swallow-comments.mjs (already in sync with local design checkout)'); return }
    console.log(`~ lint-swallow-comments.mjs: local design checkout differs${before === null ? ' (currently missing)' : ''}`)
    dirty = true
    if (dryRun) return
    copyFileSync(src, dst)
    console.log('  copied lint-swallow-comments.mjs from', designDir)
}
await syncToolingScripts()

// @spoint/ecs sync (distinct from the npm-package vendor loop above): it is
// NOT published to npm (git-only subpackage of AnEntrypoint/spoint, see
// scripts/refresh-spoint-ecs.mjs's own header) so there is no npm-view
// staleness check or --npm fallback possible — the only source of truth is
// a sibling spoint checkout, gated the same sibling-directory-discovery way
// syncToolingScripts() above handles lint-swallow-comments.mjs. CI has no
// such checkout, so this step is a no-op there by design (spoint-ecs drift
// is caught by scripts/doctor.mjs's vendor:spoint-ecs check on a dev box
// that DOES have the sibling, same as the other three vendor targets).
async function syncSpointEcs() {
    const spointEcsDir = await resolveSiblingDefault(ROOT, ['spoint/packages/ecs'], null)
    if (!spointEcsDir) { console.log('(spoint-ecs sync) no local spoint/packages/ecs checkout found next to thebird — skipping'); return }
    const refresh = resolve(ROOT, 'scripts/refresh-spoint-ecs.mjs')
    if (!existsSync(refresh)) { console.log('(spoint-ecs sync) scripts/refresh-spoint-ecs.mjs missing — skipping'); return }
    const r = spawnSync('node', [refresh], { cwd: ROOT, stdio: 'inherit' })
    if (r.error || r.status !== 0) {
        const msg = r.error ? r.error.message : `exited with status ${r.status}`
        console.error(`! ${refresh} failed: ${msg}`)
        process.exit(1)
    }
}
if (!dryRun) await syncSpointEcs()
else console.log('(spoint-ecs sync) --dry-run: skipping (refresh-spoint-ecs.mjs has no dry-run mode of its own)')

if (!dirty) console.log('nothing to update')
process.exit(hadTransientError ? 1 : 0)
