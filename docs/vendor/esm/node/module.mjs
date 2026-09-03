// Browser shim for node:module.
//
// The vendored freddie browser bundle (docs/vendor/freddie/freddie.js) has a
// transitive dependency chain — src/browser/index.js exports createAgentMachine
// (src/agent/machine.js), which statically imports src/agent/llm_resolver.js,
// which calls `const _req = createRequire(import.meta.url)` at MODULE-EVAL
// TIME (not lazily) to later `_req('acptoapi/lib/extra-providers')` inside its
// own Node-side extra-providers CJS require. Without this shim the bare
// `node:module` specifier 404s in-browser and the whole freddie-loader.js
// bundle resolution throws (both offline vendored AND remote bundle fail the
// same way — it's a spec-completeness gap, not a hosting problem), breaking
// EVERY consumer of freddie-loader.js (v1 bootHost too, not just v2).
//
// thebird's own callLLM (buildBrowserCallLLM, freddie-chat.js) never calls
// into resolveCallLLM/_req at all — createAgentMachine is always invoked with
// an explicit `callLLM` override (see docs/freddie-chat.js's runAgentTurn and
// docs/freddie-host-v2.js's adapters.callLLM), so `_req('acptoapi/lib/extra-providers')`
// is unreachable code in the browser. This shim only needs to satisfy the
// top-level `createRequire(import.meta.url)` call without throwing; the
// returned function throws a descriptive error if some future code path
// actually invokes it, rather than silently returning undefined.
export function createRequire() {
    return function shimmedRequire(specifier) {
        throw new Error('node:module createRequire shim: require(' + JSON.stringify(specifier) + ') has no browser implementation (thebird never exercises this Node-only code path — see docs/vendor/esm/node/module.mjs)');
    };
}
export default { createRequire };
