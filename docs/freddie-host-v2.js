// freddie-host-v2.js
//
// Real (no longer stub) v2 boot path for the freddie-host migration. Wires
// thebird's per-instance fs/sw into freddie's actual adapter-parameterized
// browser host boot (`bootHostBrowser(adapters)`, freddie src/browser/
// index.js, exposed here via freddie-loader.js's `vendoredBootHostBrowser`)
// instead of v1's approach (docs/freddie-host.js's `bootHost`, which forks
// freddie's ENTIRE host contract — config/projects/sessions/cron/env/
// gateway/profiles/batch surfaces, tool registration, plugin loading — into
// a wholesale from-scratch reimplementation).
//
// What moves into the adapter (freddie's job now):
//   - adapters.callLLM  -> the actual LLM-calling core (buildBrowserCallLLM,
//     freddie-chat.js), same implementation v1's `chat` tool already
//     delegates to via call-time dynamic import.
//   - adapters.storage  -> real getConfig/setConfig pass-through to thebird's
//     instance-fs (fs.getConfig/fs.setConfig).
//   - adapters.fs       -> instance-fs mapped onto the {readFile,writeFile,
//     exists,mkdir,readdir,stat} shape bootHostBrowser expects, for any
//     freddie-side plugin that wants raw file access via host.fsAdapter.
//   - adapters.plugins  -> thebird's builtin tools (read/write/edit/grep/
//     list/memory/chat/delegate/web_search) PLUS the `gm` tool (still backed
//     by freddie-host.js's loadGmSkillPlugin wasm glue, which stays exactly
//     where it is and is NOT duplicated here — see the file-top note in
//     freddie-host.js for why that ~1500-line block is thebird-specific and
//     does not belong in freddie).
//   - adapters.env      -> thebird's env surface (cfg.env), the same shape
//     v1's makeEnvSurface reads/writes.
//
// What stays thebird-side, layered ON TOP of the adapter-built host (freddie's
// bootHostBrowser has no first-class notion of sessions/cron/projects/
// profiles/batch as adapter-injectable surfaces — it only knows fs/storage/
// callLLM/plugins/env):
//   - sessions/cron/projects/profiles/batch surfaces: reused UNCHANGED from
//     freddie-host.js's make*Surface() builders (now exported from there),
//     which already carry their sqlite-shim/libsql-client-adapter storage
//     backing. No logic is duplicated — v2 imports the exact same builders
//     v1 uses.
//   - the CLI command registry (cli.run/tools/skills/exec/memory/skill/
//     config/sessions/cron/batch/projects) and the pi.* surface shape every
//     existing call site (apps.js, freddie-chat.js's bridgeAgentTools/
//     runAgentTurn, freddie-keys.js) already depends on — v2 must return an
//     object with the SAME shape as v1's `host` (host.fs, host.pi.tools as a
//     Map-like with .list(), host.pi.dispatchTool, host.hooks.invoke,
//     host.runTool, host.runCli, host.loadPlugin, host.loadSkillBody) so
//     nothing downstream needs to change to consume either version.
//
// The freddie-returned host (pi/gui/hooks/plugins()/get()/storage/fsAdapter/
// callLLM) is bound internally as `fh` (freddie host) and its `pi.tools`/
// `hooks`/`callLLM` are surfaced through thebird's shape, not exposed raw —
// existing consumers must not need to learn a second host shape.

import {
    FREDDIE_DEFAULT_CONFIG, FREDDIE_ENV_KEYS, FREDDIE_COMMAND_REGISTRY, FREDDIE_GATEWAY_PLATFORMS,
    HookType,
    makeConfigSurface, makeProjectsSurface, makeSessionsSurface, makeCronSurface,
    makeEnvSurface, makeGatewaySurface, makeProfilesSurface, makeBatchSurface,
    makeBuiltinTools, loadGmSkillPlugin, loadSkillManifest, buildCliRegistry,
} from './freddie-host.js';
import { startCronScheduler } from './lib/cron-scheduler.js';

const FREDDIE_TO_SDK_HOOK = {
    preToolUse: HookType.PRE_TOOL_USE,
    postToolUse: HookType.POST_TOOL_USE,
    userPromptSubmit: HookType.USER_PROMPT_SUBMIT,
    notification: HookType.NOTIFICATION,
    stop: HookType.STOP,
};

// ---- adapters.fs: map instance-fs onto bootHostBrowser's {readFile,
// writeFile,exists,mkdir,readdir,stat} contract. instance-fs (docs/
// instance-fs.js) has no real directories (flat key/value snapshot keyed by
// path), so mkdir is a no-op (paths are created implicitly by writeFile) and
// readdir/stat are derived from `fs.list()`.
function buildFsAdapter(fs) {
    return {
        readFile: (path) => fs.readFile(path),
        writeFile: (path, content) => { fs.writeFile(path, content); },
        exists: (path) => fs.exists(path),
        mkdir: () => { /* no-op: instance-fs has no real directories, only key prefixes */ },
        readdir: (path) => fs.list(path).map((k) => ({ name: k, isDirectory: false })),
        stat: (path) => {
            if (!fs.exists(path)) throw Object.assign(new Error('ENOENT: ' + path), { code: 'ENOENT' });
            return { isDirectory: false };
        },
    };
}

// ---- adapters.storage: real getConfig/setConfig pass-through.
function buildStorageAdapter(fs) {
    return {
        getConfig: () => fs.getConfig(),
        setConfig: (value) => fs.setConfig(value),
    };
}

// ---- adapters.callLLM: delegate to the SAME buildBrowserCallLLM
// implementation v1's `chat` builtin tool already uses (see freddie-host.js's
// makeBuiltinTools().chat). Call-time dynamic import for the same reason v1
// uses one: freddie-chat.js -> freddie-loader.js -> freddie-host-v2.js would
// otherwise close a module cycle at eval time.
async function buildCallLLMAdapter(fs, hostRef) {
    const { buildBrowserCallLLM } = await import('./freddie-chat.js');
    // Pass hostRef (not a throwaway object): it is the SAME live object
    // bootHostV2 later populates with agentKeysCache from SW-vaulted keys
    // (see the `sw.call('keys-get')` init + 'agent-keys-change' refresh
    // below) — buildBrowserCallLLM's closure reads host.agentKeysCache by
    // property access on every call, so mutating hostRef.agentKeysCache in
    // place is visible here without reconstructing callLLM.
    const callLLM = buildBrowserCallLLM(hostRef);
    return async ({ messages, tools, model }) => {
        const r = await callLLM({ messages, tools, model });
        // freddie's agent loop (createAgentMachine) expects {content, tool_calls}
        // — buildBrowserCallLLM already returns exactly that shape (plus `raw`
        // for diagnostics), so this is a direct pass-through.
        return r;
    };
}

// ---- adapters.plugins: builtin tools (read/write/edit/grep/list/memory/
// chat/delegate/web_search) as one plugin, plus the gm-wasm glue as a second,
// lazily-loaded plugin (loadGmSkillPlugin stays in freddie-host.js — it is
// confirmed thebird-specific gm-wasm glue, not freddie-contract logic, and is
// reused here rather than duplicated).
function buildBuiltinToolsPlugin(fs) {
    const tools = makeBuiltinTools(fs);
    return {
        name: 'thebird-builtin-tools',
        surfaces: 'pi',
        register(ctx) {
            for (const [name, spec] of Object.entries(tools)) {
                ctx.pi.tools.register({
                    name,
                    schema: {
                        type: 'function',
                        function: { name, description: spec.description || '', parameters: spec.inputSchema || { type: 'object', properties: {} } },
                    },
                    handler: (args) => spec.run(args),
                });
            }
        },
    };
}

// gm loader — deliberately NOT one of adapters.plugins: bootHostBrowser's
// host.load(plugins) AWAITS every entry before returning, and gm's payload is
// a ~149MB wasm download (see freddie-host.js's loadGmSkillPlugin comments on
// retry/backoff/integrity-check taking real wall-clock time). Putting it in
// adapters.plugins would make bootHostV2 block on that download before the
// chat/dashboard can render — a regression vs v1, which fires this off in the
// background (Promise.resolve().then(...)) so the rest of the host is usable
// immediately and gm becomes available later via the freddie:gm-ready event.
// Called once, fire-and-forget, after the full thebird-shaped host is built
// (see the bottom of bootHostV2) — ctx.registerTool/registerHook write
// directly into the SAME toolsMap/hooksMap the rest of the host reads, so gm
// tools show up in dispatchTool/pi.tools.list() the moment loading finishes.
async function runGmPluginLoader({ fs, sw, toolsMap, hooksMap, hostRef }) {
    const ctx = {
        registerTool(spec) { toolsMap.set(spec.name, spec); },
        registerHook(name, fn) { const k = FREDDIE_TO_SDK_HOOK[name] || name; if (hooksMap[k]) hooksMap[k].push(fn); },
        get fs() { return fs; },
    };
    try {
        const gmRes = await loadGmSkillPlugin({ ctx, host: hostRef, sw });
        if (gmRes && gmRes.error) {
            const evt = gmRes.degraded ? 'freddie:gm-degraded' : 'freddie:gm-error';
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(evt, { detail: { error: gmRes.error, degraded: !!gmRes.degraded } }));
        } else if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('freddie:gm-ready', { detail: gmRes }));
        }
    } catch (e) {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('freddie:gm-error', { detail: { error: (e && e.message) || String(e) } }));
    }
}

export async function bootHostV2({ fs, sw }) {
    if (!fs) throw new Error('bootHostV2: fs required (instance-fs)');

    const { getVendoredBootHostBrowser, __freddieLoaderBundle } = await import('./freddie-loader.js');
    await __freddieLoaderBundle();
    const vendoredBootHostBrowser = getVendoredBootHostBrowser();
    if (typeof vendoredBootHostBrowser !== 'function') {
        throw new Error('bootHostV2: vendored freddie bundle has no bootHostBrowser export (stale ./vendor/freddie/freddie.js — refresh via scripts/refresh-freddie.mjs)');
    }

    // These maps ARE the thin thebird-shaped host's tool/hook registries.
    // The gm plugin loader (built below) registers directly into them via its
    // own ctx, so gm's `gm` tool ends up in the exact same place builtin
    // tools do — no separate registry to keep in sync.
    const toolsMap = new Map();
    const hooksMap = { [HookType.PRE_TOOL_USE]: [], [HookType.POST_TOOL_USE]: [], [HookType.USER_PROMPT_SUBMIT]: [], [HookType.NOTIFICATION]: [], [HookType.STOP]: [] };

    // hostRef is a forward-reference cell: loadGmSkillPlugin wants `host.fs`
    // (for holder.fs) and reads it at call time, well after this function
    // finishes constructing `host` below — a plain object with a getter that
    // is filled in once `host` exists avoids a temporal-dead-zone reference.
    const hostRef = { fs, sw, agentKeysCache: {} };

    const callLLMAdapter = await buildCallLLMAdapter(fs, hostRef);

    const adapters = {
        fs: buildFsAdapter(fs),
        storage: buildStorageAdapter(fs),
        callLLM: callLLMAdapter,
        plugins: [
            buildBuiltinToolsPlugin(fs),
        ],
        env: (fs.getConfig() && fs.getConfig().env) || {},
    };

    const fh = await vendoredBootHostBrowser(adapters);

    // fh.pi.tools.register(spec) (plugsdk contract) is how buildBuiltinToolsPlugin
    // populated tools — but bootHostBrowser's own `fh.pi` is a SEPARATE registry
    // from thebird's toolsMap/hooksMap above (the gm plugin loader writes to
    // toolsMap directly, bypassing fh.pi entirely, since loadGmSkillPlugin's ctx
    // shape predates the plugsdk contract). Merge fh's registered tools into
    // toolsMap so dispatchTool below has ONE source of truth covering both the
    // plugsdk-registered builtins and the directly-registered gm tool.
    try {
        const fhTools = typeof fh.pi.tools.list === 'function' ? fh.pi.tools.list() : [];
        for (const entry of fhTools) {
            if (!entry || !entry.name) continue;
            const schema = entry.schema || {};
            const fn = schema.function || {};
            toolsMap.set(entry.name, {
                name: entry.name,
                description: fn.description || '',
                inputSchema: fn.parameters || { type: 'object', properties: {} },
                handler: entry.handler,
                run: entry.handler,
            });
        }
    } catch (e) {
        console.warn('[freddie-host-v2] tool merge from adapter host failed:', e && e.message || e);
    }

    // Also alias each tool's .run to .handler (and vice versa) so both
    // dispatchTool (below) and any direct t.run(args) caller work regardless
    // of which side registered the tool.
    for (const [, tspec] of toolsMap) {
        if (tspec.run && !tspec.handler) tspec.handler = tspec.run;
        if (tspec.handler && !tspec.run) tspec.run = tspec.handler;
    }
    toolsMap.list = () => [...toolsMap.entries()].filter(([k]) => k !== 'list').map(([name, tspec]) => ({
        name,
        toolset: tspec.toolset || 'core',
        checkFn: tspec.checkFn,
        handler: tspec.handler || tspec.run,
        schema: tspec.schema || {
            type: 'function',
            function: { name, description: tspec.description || '', parameters: tspec.inputSchema || { type: 'object', properties: {} } },
        },
    }));

    // ---- thebird-side surfaces bootHostBrowser has no first-class support
    // for (sessions/cron/projects/env/gateway/profiles/batch/config) — built
    // directly on `fs`, reusing v1's exact builders. Not a reimplementation:
    // these are the SAME functions freddie-host.js's bootHost calls, imported
    // and re-invoked here so the storage-backing logic (sqlite-shim/libsql)
    // is not duplicated.
    const config = makeConfigSurface(fs);
    const projects = makeProjectsSurface(fs);
    const sessions = makeSessionsSurface(fs);
    const cron = makeCronSurface(fs);
    const env = makeEnvSurface(fs);
    const gateway = makeGatewaySurface();
    const profiles = makeProfilesSurface(fs);
    const batch = makeBatchSurface(() => toolsMap.get('chat'));

    const bootCfg = config.load();
    projects.list();

    const cli = new Map();
    const skills = new Map();
    const { loadSkillBody } = await loadSkillManifest(skills);
    buildCliRegistry({ cli, tools: toolsMap, skills, config, projects, sessions, cron, batch, loadSkillBody, getChat: () => toolsMap.get('chat') });

    Promise.resolve().then(() => {
        const primary = (bootCfg.providers && bootCfg.providers.openai && bootCfg.providers.openai.baseUrl) || 'http://localhost:4800';
        const chain = Array.isArray(bootCfg.gatewayChain) && bootCfg.gatewayChain.length ? bootCfg.gatewayChain : [primary];
        return import('./freddie-host.js').then((m) => m.probeGatewayChain(chain));
    }).catch(() => {});

    const ctx = {
        registerTool(spec) { toolsMap.set(spec.name, spec); },
        registerSkill(spec) { skills.set(spec.name, spec); },
        registerCli(spec) { cli.set(spec.name, spec); },
        registerHook(name, fn) { const k = FREDDIE_TO_SDK_HOOK[name] || name; if (hooksMap[k]) hooksMap[k].push(fn); },
        get fs() { return fs; },
    };

    function loadPlugin(plugin) {
        if (!plugin) return;
        if (plugin.kind === 'plugsdk') {
            for (const t of plugin.tools || []) ctx.registerTool(t);
            for (const h of plugin.hooks || []) ctx.registerHook(h.type, h.handler);
            return;
        }
        if (typeof plugin.register === 'function') plugin.register(ctx);
        if (Array.isArray(plugin.surfaces)) for (const s of plugin.surfaces) ctx.registerSkill(s);
    }

    const host = {
        kind: 'freddie-host-v2',
        version: '0.3.0-browser-adapter',
        fs,
        sw,
        agentKeysCache: {},
        // adapter host (fh) kept for diagnostics / future direct use — not
        // exposed as the primary shape, matching the file-top design note.
        _adapterHost: fh,
        async getAgentKey(provider) {
            const short = String(provider || '').toLowerCase().replace(/_api_key$/, '');
            if (this.agentKeysCache && this.agentKeysCache[short]) return this.agentKeysCache[short];
            if (sw && sw.call) {
                try { this.agentKeysCache = hostRef.agentKeysCache = (await sw.call('keys-get')) || {}; return this.agentKeysCache[short] || null; } catch (e) { if (e && e.message && e.message.includes('non-owner')) throw new Error('SW isolation boundary: claim-client failed'); }
            }
            return null;
        },
        hooks: {
            invoke: async (name, payload) => {
                const k = FREDDIE_TO_SDK_HOOK[name] || name;
                const arr = hooksMap[k] || [];
                for (const fn of arr) {
                    try { const r = await fn(payload); if (r && typeof r === 'object') return r; } catch { /* a throwing hook must not veto the chain; fall through to the next hook */ }
                }
                return null;
            },
        },
        pi: {
            get cli() { return cli; },
            get skills() { return skills; },
            get tools() { return toolsMap; },
            get hooks() { return hooksMap; },
            config, projects, sessions, cron, env, gateway, profiles, batch,
            dispatchTool: async (name, args = {}, dctx = {}) => {
                const tspec = toolsMap.get(name);
                if (!tspec) return JSON.stringify({ error: 'unknown tool: ' + name });
                if (tspec.checkFn && tspec.checkFn(tspec) === false) return JSON.stringify({ error: 'tool unavailable: ' + name, requires: tspec.requiresEnv || [] });
                try {
                    const h = tspec.handler || tspec.run;
                    if (typeof h !== 'function') return JSON.stringify({ error: 'tool ' + name + ' has no handler' });
                    const r = await h(args, dctx);
                    return typeof r === 'string' ? r : JSON.stringify(r);
                } catch (e) {
                    return JSON.stringify({ error: String(e?.message || e), tool: name });
                }
            },
            commands: { list: () => FREDDIE_COMMAND_REGISTRY.slice() },
            health: () => ({ ok: true, ts: Date.now(), instance: fs.instanceId, version: '0.3.0-browser-adapter', tools: toolsMap.size, skills: skills.size, cli: cli.size }),
            agents: async () => {
                const list = await sessions.list();
                const now = Date.now();
                const active = list.filter(s => (now - (s.updated_at || 0)) < 300000);
                return { count: active.length, active: active[0] ? active[0].id : null, turns: list.reduce((a, s) => a + (s.turn_count || 0), 0), last_activity: active[0] ? active[0].updated_at : null };
            },
            debug: () => ({
                instance: fs.instanceId,
                tools: [...toolsMap.keys()].filter(k => k !== 'list'),
                skills: [...skills.keys()],
                cli: [...cli.keys()],
                hookCounts: Object.fromEntries(Object.entries(hooksMap).map(([k, v]) => [k, v.length])),
                config: config.load(),
                projects: projects.list(),
            }),
        },
        loadPlugin,
        loadSkillBody,
        async runCli(name, ...args) {
            const c = cli.get(name);
            if (!c) return { error: 'unknown cli command: ' + name };
            return await c.action(...args);
        },
        async runTool(name, args) {
            const tspec = toolsMap.get(name);
            if (!tspec) return { error: 'unknown tool: ' + name };
            for (const h of hooksMap[HookType.PRE_TOOL_USE]) await h({ name, args });
            const out = await (tspec.run || tspec.handler)(args);
            for (const h of hooksMap[HookType.POST_TOOL_USE]) await h({ name, args, out });
            return out;
        },
    };
    hostRef.fs = fs;
    hostRef.sw = sw;
    Object.assign(hostRef, host);

    if (sw && typeof sw.call === 'function') {
        // Mutate hostRef.agentKeysCache (not just host.agentKeysCache): the
        // callLLM closure built above by buildCallLLMAdapter(fs, hostRef)
        // captured `hostRef`, a DIFFERENT object from `host` post-Object.assign
        // (Object.assign only copies keys present AT THAT MOMENT — it does not
        // link the two objects going forward). Both must be kept in sync so
        // SW-vaulted provider keys are visible to both the chat/dashboard host
        // and the LLM-call closure.
        try { host.agentKeysCache = hostRef.agentKeysCache = (await sw.call('keys-get')) || {}; } catch { /* keys service optional; empty cache is the correct default */ }
        const refresh = async () => { try { host.agentKeysCache = hostRef.agentKeysCache = (await sw.call('keys-get')) || {}; } catch { /* keys service optional; keep last-known cache on refresh failure */ } };
        if (typeof window !== 'undefined') window.addEventListener('agent-keys-change', refresh);
    }

    // Run the gm loader now that `host` (assigned into hostRef above) is
    // fully built — mirrors v1's fire-and-forget timing (Promise.resolve().then)
    // so gm loads in the background without blocking bootHostV2's return.
    Promise.resolve().then(() => runGmPluginLoader({ fs, sw, toolsMap, hooksMap, hostRef }));

    startCronScheduler({ cron, getChatTool: () => toolsMap.get('chat') });

    if (typeof window !== 'undefined') {
        if (!window.__debug) window.__debug = {};
        window.__debug.instances = window.__debug.instances || {};
        window.__debug.instances[fs.instanceId] = window.__debug.instances[fs.instanceId] || {};
        window.__debug.instances[fs.instanceId].host = host;
        globalThis.__thebirdHost = host;
    }
    return host;
}

export { FREDDIE_DEFAULT_CONFIG, FREDDIE_ENV_KEYS, FREDDIE_COMMAND_REGISTRY, FREDDIE_GATEWAY_PLATFORMS };
