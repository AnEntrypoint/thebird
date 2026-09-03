// oxibrowser wasm loader: a pure-Rust headless browser (crates/oxibrowser-core
// from AnEntrypoint/oxibrowser, wasm32-wasip1 build) exposing navigate/
// evaluate/dom-query/extract-markdown/capabilities verbs through the SAME
// plugkit_alloc/plugkit_free/plugin_call ABI every agentplug shared plugin
// uses (see freddie-host-wasm-plugin.js's loadWasmPlugin header) -- verified
// live against gm's agentplug daemon before this browser-side wiring existed.
//
// Unlike bert/libsql/treesitter, oxibrowser's `env` imports need a real
// host_fetch (crates/oxibrowser-core/src/network/host_abi.rs's WASI import):
// the guest has no native TLS/socket stack, so every navigate/fetch call is
// proxied here to the browser's own fetch(). standardEnvImports() alone
// (host_log/host_random_fill/host_now_ms) is not enough for this plugin.

import { loadWasmPlugin, standardEnvImports } from './freddie-host-wasm-plugin.js';

// Per-call budget for host_fetch's synchronous XHR. The XHR spec forbids a
// nonzero `timeout` on a synchronous (main-thread) request -- setting one
// throws InvalidAccessError -- so it cannot self-abort mid-flight. Instead,
// any endpoint that already blocked the tab past this budget once trips a
// cooldown (below) so a hung/slow endpoint can't refreeze the tab on every
// subsequent oxi_navigate/oxi_evaluate call.
const HOST_FETCH_TIMEOUT_MS = 15000;
const HOST_FETCH_COOLDOWN_MS = 60000;
let hostFetchCooldownUntil = 0;

let oxibrowserPromise = null;

export function loadOxibrowserPlugin() {
    if (!oxibrowserPromise) oxibrowserPromise = doLoadOxibrowserPlugin();
    return oxibrowserPromise;
}

// host_fetch(url_ptr,url_len,opts_ptr,opts_len) -> packed(ptr,len) of JSON
// {"status":u16,"headers":[[k,v],...],"body":"<base64>"} | {"error":"..."}.
// opts is {"method","headers","body":"<base64>"|null} -- see host_abi.rs's
// host_fetch_call() for the exact shape this must match on both sides.
function oxibrowserEnvImports(getExp) {
    const dec = new TextDecoder();
    const enc = new TextEncoder();

    function bytesToBase64(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }
    function base64ToBytes(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    return {
        ...standardEnvImports('oxibrowser', getExp),
        host_fetch: (urlPtr, urlLen, optsPtr, optsLen) => {
            const exp = getExp();
            const url = dec.decode(new Uint8Array(exp.memory.buffer, urlPtr, urlLen));
            const optsRaw = dec.decode(new Uint8Array(exp.memory.buffer, optsPtr, optsLen));
            let opts = {};
            try { opts = JSON.parse(optsRaw); } catch { /* malformed opts -> treat as empty */ }

            // The guest's host_fetch_call() is async-shaped in Rust (it awaits
            // this import), but wasm32-wasip1's env-import calling convention
            // here is synchronous -- there is no async host import in this
            // ABI generation. Use a synchronous XHR as the one browser API
            // that blocks the calling thread for a real network round-trip;
            // async fetch() cannot be awaited from a non-async import.
            let status = 0, headers = [], bodyB64 = '', errorMsg = null;
            try {
                const now = Date.now();
                if (now < hostFetchCooldownUntil) {
                    throw new Error(
                        'host_fetch: refusing request, a prior call blocked the main thread ' +
                        'past its ' + HOST_FETCH_TIMEOUT_MS + 'ms budget; cooldown active for another ' +
                        (hostFetchCooldownUntil - now) + 'ms to avoid repeatedly freezing the tab'
                    );
                }
                const xhr = new XMLHttpRequest();
                xhr.open(opts.method || 'GET', url, false); // false = synchronous
                for (const [k, v] of Object.entries(opts.headers || {})) {
                    try { xhr.setRequestHeader(k, v); } catch { /* forbidden header name, browser-blocked */ }
                }
                const bodyBytes = opts.body ? base64ToBytes(opts.body) : null;
                const callStart = Date.now();
                xhr.send(bodyBytes);
                const elapsed = Date.now() - callStart;
                if (elapsed > HOST_FETCH_TIMEOUT_MS) {
                    // Sync XHR cannot be interrupted mid-flight or preflight-bound
                    // (setting .timeout on a sync request throws), so the freeze
                    // already happened by the time we can observe it here -- but
                    // record a cooldown so a hung/slow endpoint doesn't refreeze
                    // the tab on every subsequent call in the same session, and
                    // surface the slowness as an explicit guest-visible error
                    // instead of silently returning the (already-late) response.
                    hostFetchCooldownUntil = Date.now() + HOST_FETCH_COOLDOWN_MS;
                    throw new Error(
                        'host_fetch: request to ' + url + ' took ' + elapsed + 'ms (> ' +
                        HOST_FETCH_TIMEOUT_MS + 'ms budget), blocking the main thread for its duration; ' +
                        'further host_fetch calls are suspended for ' + HOST_FETCH_COOLDOWN_MS + 'ms'
                    );
                }
                status = xhr.status;
                const raw = xhr.getAllResponseHeaders() || '';
                headers = raw.split('\r\n').filter(Boolean).map(line => {
                    const idx = line.indexOf(':');
                    return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
                });
                const respBytes = enc.encode(xhr.responseText || '');
                bodyB64 = bytesToBase64(respBytes);
            } catch (e) {
                errorMsg = String((e && e.message) || e);
            }

            const json = errorMsg
                ? JSON.stringify({ error: errorMsg })
                : JSON.stringify({ status, headers, body: bodyB64 });
            const buf = enc.encode(json);
            const ptr = Number(exp.plugkit_alloc(buf.length));
            new Uint8Array(exp.memory.buffer, ptr, buf.length).set(buf);
            return (BigInt(ptr) & 0xffffffffn) | (BigInt(buf.length) << 32n);
        },
    };
}

async function doLoadOxibrowserPlugin() {
    // The Blitz-free wasm build (~8MB, includes boa_engine's JS interpreter)
    // is much smaller than bert's model weights but still real work to
    // compile; bounded the same way every other shared plugin's loader is.
    const r = await loadWasmPlugin('oxibrowser', 1_000_000, oxibrowserEnvImports, { fetchTimeoutMs: 30000 });
    if (!r.ok) return r;
    return { ok: true, call: r.call };
}
