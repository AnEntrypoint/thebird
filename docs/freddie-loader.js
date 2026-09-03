// freddie-loader.js
//
// Mixed loader: thebird's `bootHost` stays local (host is thebird-specific,
// built on instance-fs + sw-client + IDB-backed surfaces), but `createAgentMachine`/
// `createActor`/`createMachine` and the xstate primitives come from the
// remote freddie browser bundle. This lets thebird retire the 3,280-line
// local `freddie-runtime.js` (an xstate bundle) and use upstream's published
// 157KB bundle instead.
//
// Strategy:
//   - bootHost, FREDDIE_DEFAULT_CONFIG, FREDDIE_ENV_KEYS, etc. -> re-export
//     from ./freddie-host.js (synchronous; thebird's actual host).
//   - createAgentMachine, createActor, createMachine, fromPromise, waitFor,
//     assign -> resolved from the remote bundle (with offline fallback).
//
// The remote bundle is loaded once; ESM module-evaluation caches it per
// process. Consumers that previously imported from './freddie-runtime.js'
// can swap to './freddie-loader.js' with zero call-site changes — the
// callable wrappers eagerly start the dynamic import at module-eval time so
// network roundtrip overlaps with consumer evaluation.

import { bootHost as bootHostV1 } from './freddie-host.js';
import { bootHostV2 } from './freddie-host-v2.js';

const REMOTE_URL = 'https://anentrypoint.github.io/freddie/browser/freddie.js';
const OFFLINE_URL = new URL('./vendor/freddie/freddie.js', import.meta.url).href;

let cached = null;
let inflight = null;
// Which of OFFLINE_URL/REMOTE_URL actually loaded, surfaced via
// __freddieLoaderInfo so a caller/witness script can detect drift (the two
// bundles can diverge: vendored carries thebird-specific patches the
// upstream remote build may not have yet) instead of it being invisible.
let loadedSource = null;

async function resolveBundle() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
        let mod = null;
        let offlineErr = null;
        // Prefer the vendored copy first — thebird carries browser-context
        // patches (isReachable timeout, callLLM loopback short-circuit,
        // buildModel strong-model default) that the upstream remote bundle
        // may not have yet. Fall back to the remote bundle only if the
        // vendored copy fails to load.
        try {
            mod = await import(/* @vite-ignore */ OFFLINE_URL);
            loadedSource = 'offline';
        } catch (err) {
            offlineErr = err;
            try {
                mod = await import(/* @vite-ignore */ REMOTE_URL);
                loadedSource = 'remote';
                console.warn('[freddie-loader] vendored offline bundle failed to load (' + (offlineErr && offlineErr.message) + '); falling back to remote bundle, which may lack thebird-specific browser-context patches.');
            } catch (err2) {
                const e = new Error('freddie-loader: failed to load both offline (' + OFFLINE_URL + ') and remote (' + REMOTE_URL + ') bundles. Offline: ' + (offlineErr && offlineErr.message) + '; Remote: ' + (err2 && err2.message));
                throw e;
            }
        }
        cached = mod;
        return mod;
    })();
    return inflight;
}

// No top-level await here on purpose: this module is statically imported by
// os-shell.js at the very start of index.html's boot chain, and a top-level
// await blocks the ENTIRE importing module graph (shell/menubar/window-manager
// chrome included) until the ~157KB freddie bundle fetch resolves — long
// before any consumer actually needs the xstate primitives below (the first
// real call happens deep inside a chat send handler / newInstance(), well
// after boot). Instead the bundle fetch is kicked off eagerly (still
// overlapping with module evaluation, see resolveBundle()'s inflight caching)
// and each export below is a synchronous wrapper that resolves the
// already-cached (or still-inflight, first call only) bundle just-in-time.
// Every real call site awaits or is itself inside an async function, so a
// synchronous accessor throwing "not ready yet" is not required — instead
// each wrapper returns the resolved function's result once the module is
// ready. To preserve the "createActor(...).start() must be sync" contract
// documented above, wrappers require the bundle to already be resolved by
// the time they are actually invoked; kick off the fetch immediately so it
// has the whole boot sequence to complete before first use.
let bundleMod = null;
resolveBundle().then((mod) => { bundleMod = mod; });

function bindBundle(name) {
    return function bound(...args) {
        if (!bundleMod) {
            throw new Error('freddie-loader: bundle not yet resolved when ' + name + ' was called; await __freddieLoaderBundle() first');
        }
        const fn = bundleMod[name];
        if (typeof fn !== 'function') throw new Error('freddie-loader: ' + name + ' not exported by bundle');
        return fn(...args);
    };
}

// ---- Local host re-exports (synchronous) ----
// These come from thebird's actual host, which lives at ./freddie-host.js
// and is built on instance-fs + sw-client + IDB. Upstream freddie's `bootHost`
// has a different shape ((extraRoots = []) -> CLI-Node host) and CANNOT
// substitute here.
export {
    FREDDIE_DEFAULT_CONFIG,
    FREDDIE_ENV_KEYS,
    FREDDIE_COMMAND_REGISTRY,
    FREDDIE_GATEWAY_PLATFORMS,
    definePlugin,
    allowResult,
    blockResult,
    modifyResult,
    HookType,
} from './freddie-host.js';

// ---- v1/v2 boot-flag plumbing (Phase 2 cutover of the freddie-host migration
// de-risking plan) ----
//
// This gates between the legacy (v1) bootHost path in freddie-host.js and the
// real adapter-based v2 path (freddie-host-v2.js's bootHostV2, wired onto
// freddie's bootHostBrowser(adapters) contract). All 4 witness scripts
// (chat-roundtrip, freddie-gui, freddie-render, gm-dispatch) passed
// identically on both paths before this flip. Default is now ON (v2) — v1
// remains reachable only via the explicit `?freddieAdapter=v1` escape hatch
// for the soak period, before v1's bootHost() implementation itself is
// deleted in a later, separately-gated pass.
//
// Resolution order (mirrors the ?freddie=/localStorage pattern already used
// at freddie-host.js:481-483 and hermes-preview.js:244):
//   1. `?freddieAdapter=v1` or `?freddieAdapter=v2` in location.search (first
//      access only).
//   2. Persisted `cfg.experimental.freddieAdapterV2` (per-instance config,
//      via fs.getConfig()/setConfig() — survives reload without the query
//      param).
//   3. Default true (v2).
//
// A query param of `?freddieAdapter=v1` explicitly clears the persisted flag
// back off, so the mechanism is reversible without manual IDB surgery.
function resolveAdapterFlag(fs) {
    let queryValue = null;
    try {
        const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
        queryValue = q ? q.get('freddieAdapter') : null;
    } catch { /* location unavailable (non-browser eval) */ }

    let persisted = true;
    try {
        const cfg = fs && typeof fs.getConfig === 'function' ? fs.getConfig() : null;
        persisted = (cfg && cfg.experimental && typeof cfg.experimental.freddieAdapterV2 === 'boolean')
            ? cfg.experimental.freddieAdapterV2
            : true;
    } catch { /* fs.getConfig unavailable/corrupt — fall through to default */ }

    if (queryValue === 'v2' || queryValue === 'v1') {
        const wantV2 = queryValue === 'v2';
        if (wantV2 !== persisted) {
            try {
                const cfg = fs.getConfig() || {};
                cfg.experimental = { ...(cfg.experimental || {}), freddieAdapterV2: wantV2 };
                fs.setConfig(cfg);
            } catch { /* persistence is best-effort; the in-memory resolution below still applies for this session */ }
        }
        return wantV2;
    }

    return persisted;
}

// Wraps v1/v2 dispatch behind the same `bootHost({fs, sw})` call shape every
// existing consumer (apps.js, freddie-chat.js, freddie-keys.js, os-shell.js)
// already uses — zero call-site changes.
export async function bootHost({ fs, sw } = {}) {
    const useV2 = resolveAdapterFlag(fs);
    if (typeof window !== 'undefined') {
        window.__debug = window.__debug || {};
        window.__debug.freddieAdapterVersion = useV2 ? 'v2' : 'v1';
    }
    return useV2 ? bootHostV2({ fs, sw }) : bootHostV1({ fs, sw });
}

// ---- Remote bundle re-exports (async) ----
// xstate primitives + agent machine come from the published upstream bundle.
// This is the polymorphic piece — same code is shipped to Node CLI and to
// thebird (browser) via the vite ESM build at https://anentrypoint.github.io/
// freddie/browser/freddie.js.
export const createAgentMachine = bindBundle('createAgentMachine');
export const createActor = bindBundle('createActor');
export const createMachine = bindBundle('createMachine');
// Text-format tool-call recovery, now provided by the bundle (upstreamed into
// freddie src/agent/tool_call_text.js). Falls back to a no-op-returning-[] if an
// older bundle lacks it, so thebird's gateway callLLM never crashes on refresh.
export function parseTextToolCalls(...args) {
    if (bundleMod && typeof bundleMod.parseTextToolCalls === 'function') return bundleMod.parseTextToolCalls(...args);
    return [];
}
export const fromPromise = bindBundle('fromPromise');
export const waitFor = bindBundle('waitFor');
export const assign = bindBundle('assign');

// The vendored bundle's OWN bootHost/host. The agent machine
// (createAgentMachine) resolves tool schemas + dispatches tool calls against
// THIS host internally, NOT thebird's freddie-host.js host. thebird registers
// its tools (gm/read/write/...) into its own host, so without a bridge the
// agent loop sees "unknown tool". freddie-chat.js calls bridgeAgentTools() to
// delegate the vendored host's dispatchTool + tool-schema list to thebird's.
// These are getters (not eagerly-read consts) because the bundle may still be
// inflight at module-eval time now that the top-level await is gone — callers
// must go through __freddieLoaderBundle() first, same contract as bindBundle().
export function getVendoredBootHost() { return (bundleMod && bundleMod.bootHost) || null; }
export function getVendoredHostRef() { return (bundleMod && bundleMod.host) || null; }

// The real, adapter-parameterized browser host boot (freddie src/browser/index.js
// bootHostBrowser(adapters)) — the seam docs/freddie-host-v2.js's bootHostV2 uses
// to build a genuine freddie-contract host instead of forking freddie's host logic
// wholesale the way v1 (docs/freddie-host.js) does. null on a bundle old enough to
// predate this export, so bootHostV2 can detect and fail loudly rather than silently
// misbehave against an undefined function.
export function getVendoredBootHostBrowser() { return (bundleMod && bundleMod.bootHostBrowser) || null; }
export function getFreddieAdapterError() { return (bundleMod && bundleMod.FreddieAdapterError) || Error; }

// Persistence-resumability seam (freddie src/machines/persistent-actor.js).
// createPersistentActor accepts an optional `store` param and does NOT call
// the Node-only bare bootHost() singleton itself (only snapshot load/persist/
// clear) — unlike runTurn/resumeTurn, whose executing_tools step still calls
// that bare bootHost() internally with no adapter seam (see freddie
// src/agent/machine.js lines 2/109/298/340). So thebird drives resumable
// agent turns through createPersistentActor + its OWN createAgentMachine call
// (already correctly wired to thebird's bridged tool host + browser callLLM),
// not through runTurn/resumeTurn directly — those would bypass thebird's tool
// bridge entirely. null on a bundle old enough to predate this export.
export function getVendoredCreatePersistentActor() { return (bundleMod && bundleMod.createPersistentActor) || null; }

// Diagnostics
export async function __freddieLoaderBundle() {
    return resolveBundle();
}
export const __freddieLoaderInfo = { remote: REMOTE_URL, offline: OFFLINE_URL, get loadedSource() { return loadedSource; } };
