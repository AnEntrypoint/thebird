// agentplug-libsql wasm loader: the standalone in-memory SQLite/libsql wasm
// plugin from ../gm (AnEntrypoint/agentplug-libsql-bin releases). plugkit's
// sql_open/sql_close/sql_exec/sql_query/sql_serialize/sql_deserialize verbs
// (docs/lib/sqlite-shim.js's whole backing store) all route through
// call_plugin("libsql", <verb>, body) -- a SEPARATE host_plugin_call import
// from host_vec_embed, that plugkit-slim.wasm needs the host to implement for
// ANY libsql-backed verb to work at all, same requirement class as bert.wasm
// for embeddings. Missing this entirely (found live 2026-07-30: sql_open
// throwing SQLite3Error on GH Pages, workspace/session UI stuck on "No
// workspaces open" because its persisted state never loads) is what this file
// fixes. Shares its ABI/compile/instantiate machinery with every other
// agentplug "shared plugin" wasm (see freddie-host-wasm-plugin.js) -- see
// ../gm/agentplug-libsql/src/abi.rs + db.rs for the verb ABI this file's
// call() wraps (open/close/begin/commit/rollback/exec/exec_params/query/
// query_params/prepare_execute/execute_bound/serialize/deserialize/
// list_dbs/version).

import { loadWasmPlugin, standardEnvImports } from './freddie-host-wasm-plugin.js';

// Lazy singleton: loadLibsqlPlugin() is called once from freddie-host-plugkit.js
// after the main plugkit wasm is up; concurrent callers share the same promise.
let libsqlPromise = null;

export function loadLibsqlPlugin() {
    if (!libsqlPromise) libsqlPromise = doLoadLibsqlPlugin();
    return libsqlPromise;
}

async function doLoadLibsqlPlugin() {
    // ~1MB body — 30s is generous; bounded for the same boot-stall reason as
    // bert (see freddie-host-wasm-plugin.js's loadWasmPlugin header).
    const r = await loadWasmPlugin('libsql', 200_000, (getExp) => standardEnvImports('libsql', getExp), { fetchTimeoutMs: 30000 });
    if (!r.ok) return r;

    // call(verb, body) -> parsed JSON response {ok, ...} | {ok:false, error}.
    // Thin passthrough -- agentplug-libsql's db::handle() verb shapes already
    // match what host_plugin_call("libsql", verb, body) expects on the wasm
    // side (verbs.rs's sql_open/sql_serialize/etc just forward body verbatim),
    // so no per-verb argument massaging is needed here, unlike bert's embed().
    return { ok: true, call: r.call };
}
