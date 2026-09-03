// thebird's actual freddie host — bridges the OS shell (instance-fs + sw-client
// + IDB) to the vendored freddie agent dashboard. Implementation is split
// across docs/lib/freddie-host-*.js; this file wires those pieces together via
// `bootHost` and re-exports the public API consumed by docs/apps.js and
// docs/freddie-loader.js.
import {
    HookType,
    FREDDIE_TO_SDK_HOOK,
    FREDDIE_DEFAULT_CONFIG,
    FREDDIE_ENV_KEYS,
    FREDDIE_COMMAND_REGISTRY,
    FREDDIE_GATEWAY_PLATFORMS,
    definePlugin,
    allowResult,
    blockResult,
    modifyResult,
} from './lib/freddie-host-config.js';
import {
    makeConfigSurface,
    makeProjectsSurface,
    makeSessionsSurface,
    makeCronSurface,
    makeEnvSurface,
    makeGatewaySurface,
    makeProfilesSurface,
    makeBatchSurface,
} from './lib/freddie-host-surfaces.js';
import { makeBuiltinTools } from './lib/freddie-host-tools.js';
import { loadGmSkillPlugin } from './lib/freddie-host-plugkit.js';
import { probeGatewayChain } from './lib/freddie-host-gateway.js';
import { startCronScheduler } from './lib/cron-scheduler.js';

export {
    HookType,
    FREDDIE_DEFAULT_CONFIG,
    FREDDIE_ENV_KEYS,
    FREDDIE_COMMAND_REGISTRY,
    FREDDIE_GATEWAY_PLATFORMS,
    definePlugin,
    allowResult,
    blockResult,
    modifyResult,
    probeGatewayChain,
    makeConfigSurface,
    makeProjectsSurface,
    makeSessionsSurface,
    makeCronSurface,
    makeEnvSurface,
    makeGatewaySurface,
    makeProfilesSurface,
    makeBatchSurface,
    makeBuiltinTools,
    loadGmSkillPlugin,
};

// Fetches the skills manifest (remote-first, offline-vendored fallback) and
// populates the given `skills` Map with {name,category,shortName,description,
// path,body:null} entries. Returns {loadSkillBody(id)} — a lazy per-skill
// body fetcher that caches onto the same map entry once fetched. Shared by
// both bootHost (v1) and bootHostV2 (v2) so the fetch/fallback/cache logic
// lives in exactly one place.
export async function loadSkillManifest(skills) {
    const SKILLS_REMOTE = 'https://anentrypoint.github.io/freddie/skills/';
    const SKILLS_OFFLINE = new URL('./vendor/freddie/skills/', import.meta.url).href;
    async function fetchSkill(relPath) {
        try {
            const r = await fetch(SKILLS_REMOTE + relPath, { cache: 'force-cache' });
            if (r.ok) return r;
        } catch { /* remote unreachable; fall through to the offline copy */ }
        try { return await fetch(SKILLS_OFFLINE + relPath); } catch { /* offline copy missing too; caller treats null as skill-absent */ }
        return null;
    }
    try {
        const r = await fetchSkill('manifest.json');
        if (r && r.ok) {
            const manifest = await r.json();
            for (const s of manifest) skills.set(s.id, { name: s.id, category: s.category, shortName: s.name, description: s.description, path: s.path, body: null });
        }
    } catch { /* manifest absent or corrupt; skills simply stay unloaded */ }
    async function loadSkillBody(id) {
        const sk = skills.get(id);
        if (!sk) return null;
        if (sk.body) return sk.body;
        try {
            const r = await fetchSkill(sk.path);
            if (r && r.ok) { sk.body = await r.text(); return sk.body; }
        } catch { /* body fetch failed; skill stays body-less and the caller skips it */ }
        return null;
    }
    return { loadSkillBody };
}

// Registers the standard freddie CLI command set (run/tools/skills/exec/
// memory/skill/config/sessions/cron/batch/projects) onto `cli` (a Map).
// Shared by bootHost (v1) and bootHostV2 (v2) — the command SHAPE (name,
// description, action signature) is freddie-contract, not host-specific, so
// duplicating it per host version would be exactly the kind of drift this
// migration is meant to eliminate.
export function buildCliRegistry({ cli, tools, skills, config, projects, sessions, cron, batch, loadSkillBody, getChat }) {
    cli.set('run', { name: 'run', description: 'Send prompt to configured LLM, stream response', action: async (prompt) => await getChat().run({ prompt }) });
    cli.set('tools', { name: 'tools', description: 'List registered tools', action: () => [...tools.keys()].filter(k => k !== 'list').sort() });
    cli.set('skills', { name: 'skills', description: 'List registered skills', action: () => [...skills.keys()].sort() });
    cli.set('exec', { name: 'exec', description: 'Run a single prompt non-interactively', action: async (prompt) => await getChat().run({ prompt }) });
    cli.set('memory', { name: 'memory', description: 'Memory CRUD', action: async (action, key, value) => await tools.get('memory').run({ action, key, value }) });
    cli.set('skill', {
        name: 'skill', description: 'Run a freddie skill against a prompt: skill <id> <prompt>',
        action: async (id, ...rest) => {
            const body = await loadSkillBody(id);
            if (!body) return { error: 'unknown skill: ' + id };
            const promptText = rest.join(' ');
            return await getChat().run({ prompt: body + '\n\n---\n\nUser task: ' + promptText });
        },
    });
    cli.set('config', { name: 'config', description: 'Get/set freddie config values', action: (op, key, value) => op === 'get' ? config.getValue(key) : op === 'set' ? config.saveValue(key, value) : config.load() });
    cli.set('sessions', { name: 'sessions', description: 'List sessions', action: async () => await sessions.list() });
    cli.set('cron', { name: 'cron', description: 'Manage cron jobs', action: async (op, ...rest) => op === 'list' ? cron.list() : op === 'create' ? cron.create({ cron: rest[0], prompt: rest.slice(1).join(' ') }) : op === 'delete' ? cron.remove(rest[0]) : { error: 'unknown cron op' } });
    cli.set('batch', { name: 'batch', description: 'Run prompts in parallel', action: async (...prompts) => await batch.run({ prompts, concurrency: 4 }) });
    cli.set('projects', { name: 'projects', description: 'Switch project (instance)', action: (op, name) => op === 'list' ? projects.list() : op === 'active' ? projects.active() : op === 'switch' ? projects.setActive(name) : { error: 'unknown projects op' } });
    return cli;
}

export async function bootHost({ fs, sw }) {
    if (!fs) throw new Error('bootHost: fs required (instance-fs)');
    const builtinTools = makeBuiltinTools(fs);
    const cli = new Map();
    const skills = new Map();
    const tools = new Map();
    const hooks = { [HookType.PRE_TOOL_USE]: [], [HookType.POST_TOOL_USE]: [], [HookType.USER_PROMPT_SUBMIT]: [], [HookType.NOTIFICATION]: [], [HookType.STOP]: [] };

    for (const [name, t] of Object.entries(builtinTools)) tools.set(name, t);
    // Bundle's getEnabledToolSchemas (freddie src/toolsets.js) calls
    // host.pi.tools.list() and expects each entry to have {name, schema, toolset?, checkFn?}.
    // Provide both .list() and a normalized schema for every builtin so the agent
    // loop actually receives tool definitions and can call web_search/write/etc.
    tools.list = () => [...tools.entries()].map(([name, t]) => ({
        name,
        toolset: t.toolset || 'core',
        checkFn: t.checkFn,
        handler: t.handler || t.run,
        schema: t.schema || {
            type: 'function',
            function: {
                name,
                description: t.description || '',
                parameters: t.inputSchema || { type: 'object', properties: {} },
            },
        },
    }));
    // Also alias each tool's .run to .handler so dispatchTool's t.handler works.
    for (const [, t] of tools) { if (t.run && !t.handler) t.handler = t.run; }

    const config = makeConfigSurface(fs);
    const projects = makeProjectsSurface(fs);
    const sessions = makeSessionsSurface(fs);
    const cron = makeCronSurface(fs);
    const env = makeEnvSurface(fs);
    const gateway = makeGatewaySurface();
    const profiles = makeProfilesSurface(fs);
    const batch = makeBatchSurface(() => builtinTools.chat);

    const bootCfg = config.load();
    projects.list();

    // Fire-and-forget probe of the gateway chain so devs can see in console which endpoint
    // will answer chat calls. Localhost endpoints are auto-skipped when running on github.io.
    Promise.resolve().then(() => {
        const primary = (bootCfg.providers && bootCfg.providers.openai && bootCfg.providers.openai.baseUrl) || 'http://localhost:4800';
        const chain = Array.isArray(bootCfg.gatewayChain) && bootCfg.gatewayChain.length ? bootCfg.gatewayChain : [primary];
        return probeGatewayChain(chain);
    }).catch(() => {});

    const { loadSkillBody } = await loadSkillManifest(skills);
    buildCliRegistry({ cli, tools, skills, config, projects, sessions, cron, batch, loadSkillBody, getChat: () => builtinTools.chat });

    const ctx = {
        registerTool(spec) { tools.set(spec.name, spec); },
        registerSkill(spec) { skills.set(spec.name, spec); },
        registerCli(spec) { cli.set(spec.name, spec); },
        registerHook(name, fn) { const k = FREDDIE_TO_SDK_HOOK[name] || name; if (hooks[k]) hooks[k].push(fn); },
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
        kind: 'freddie-host',
        version: '0.2.0-browser',
        fs,
        sw,
        agentKeysCache: {},
        async getAgentKey(provider) {
            const short = String(provider || '').toLowerCase().replace(/_api_key$/, '');
            if (this.agentKeysCache && this.agentKeysCache[short]) return this.agentKeysCache[short];
            if (sw && sw.call) {
                try { this.agentKeysCache = (await sw.call('keys-get')) || {}; return this.agentKeysCache[short] || null; } catch(e) { if (e && e.message && e.message.includes('non-owner')) throw new Error('SW isolation boundary: claim-client failed'); }
            }
            return null;
        },
        // Bundle agent loop calls h.hooks.invoke(name, payload). Map to our hooks object
        // shape; return null when no hook is registered so callers .systemMessage probes are safe.
        hooks: {
            invoke: async (name, payload) => {
                const k = FREDDIE_TO_SDK_HOOK[name] || name;
                const arr = hooks[k] || [];
                for (const fn of arr) {
                    try { const r = await fn(payload); if (r && typeof r === 'object') return r; } catch {
                        // swallow: one hook handler threw — try the remaining registered handlers for this hook
                    }
                }
                return null;
            },
        },
        pi: {
            get cli() { return cli; },
            get skills() { return skills; },
            get tools() { return tools; },
            get hooks() { return hooks; },
            config, projects, sessions, cron, env, gateway, profiles, batch,
            // Bundle's agent tool-call loop calls h.pi.dispatchTool(name, args).
            // Each tool exposes .handler (aliased above from .run); execute and JSON-stringify result.
            dispatchTool: async (name, args = {}, ctx = {}) => {
                const t = tools.get(name);
                if (!t) return JSON.stringify({ error: 'unknown tool: ' + name });
                if (t.checkFn && t.checkFn(t) === false) return JSON.stringify({ error: 'tool unavailable: ' + name, requires: t.requiresEnv || [] });
                try {
                    const h = t.handler || t.run;
                    if (typeof h !== 'function') return JSON.stringify({ error: 'tool ' + name + ' has no handler' });
                    const r = await h(args, ctx);
                    return typeof r === 'string' ? r : JSON.stringify(r);
                } catch (e) {
                    return JSON.stringify({ error: String(e?.message || e), tool: name });
                }
            },
            commands: { list: () => FREDDIE_COMMAND_REGISTRY.slice() },
            health: () => ({ ok: true, ts: Date.now(), instance: fs.instanceId, version: '0.2.0-browser', tools: tools.size, skills: skills.size, cli: cli.size }),
            agents: async () => {
                const list = await sessions.list();
                const now = Date.now();
                const active = list.filter(s => (now - (s.updated_at || 0)) < 300000);
                return { count: active.length, active: active[0] ? active[0].id : null, turns: list.reduce((a, s) => a + (s.turn_count || 0), 0), last_activity: active[0] ? active[0].updated_at : null };
            },
            debug: () => ({
                instance: fs.instanceId,
                tools: [...tools.keys()],
                skills: [...skills.keys()],
                cli: [...cli.keys()],
                hookCounts: Object.fromEntries(Object.entries(hooks).map(([k, v]) => [k, v.length])),
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
            const t = tools.get(name);
            if (!t) return { error: 'unknown tool: ' + name };
            for (const h of hooks[HookType.PRE_TOOL_USE]) await h({ name, args });
            const out = await t.run(args);
            for (const h of hooks[HookType.POST_TOOL_USE]) await h({ name, args, out });
            return out;
        },
    };

    if (sw && typeof sw.call === 'function') {
        try { host.agentKeysCache = (await sw.call('keys-get')) || {}; } catch {
            // swallow: SW keys-get unavailable this early in boot — agentKeysCache stays {}
        }
        const refresh = async () => { try { host.agentKeysCache = (await sw.call('keys-get')) || {}; } catch {
            // swallow: SW call failed on agent-keys-change refresh — cache keeps its last value
        } };
        if (typeof window !== 'undefined') window.addEventListener('agent-keys-change', refresh);
    }

    Promise.resolve().then(async () => {
        try {
            const gmRes = await loadGmSkillPlugin({ ctx, host, sw });
            if (gmRes && gmRes.error) {
                console.warn('[freddie-host] gm-skill:', gmRes.error);
                // Surface the load failure so the chat/dashboard can drop the
                // "Loading freddie runtime…" booting state. Distinguish graceful
                // degradation (gm verbs unavailable, but read/write/edit/grep/list/
                // chat still work) from a total runtime failure: a degraded result
                // emits freddie:gm-degraded so the surface can say "gm unavailable;
                // other tools work" instead of "engine failed; tools unavailable".
                const evt = gmRes.degraded ? 'freddie:gm-degraded' : 'freddie:gm-error';
                if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(evt, { detail: { error: gmRes.error, degraded: !!gmRes.degraded } }));
            }
            else if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('freddie:gm-ready', { detail: gmRes }));
        } catch (e) {
            console.warn('[freddie-host] gm-skill load failed:', e && e.message || e);
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('freddie:gm-error', { detail: { error: (e && e.message) || String(e) } }));
        }
    });

    if (typeof window !== 'undefined') {
        if (!window.__debug) window.__debug = {};
        window.__debug.instances = window.__debug.instances || {};
        window.__debug.instances[fs.instanceId] = window.__debug.instances[fs.instanceId] || {};
        window.__debug.instances[fs.instanceId].host = host;
        // Expose the latest thebird host on globalThis so the vendored freddie's
        // upstream bootHost() (which knows nothing about thebird's instance-fs
        // host) defers to it inside getEnabledToolSchemas + agent loop. Without
        // this, the upstream stub host returns no tools and the model never
        // sees web_search/write/etc — it just narrates tool use in prose.
        globalThis.__thebirdHost = host;
    }

    // bootHost is called from many independent call sites for the SAME
    // instance fs (freddie-keys.js mount/remount, freddie-chat.js, os-shell.js,
    // terminal-app.js, ...). Each call previously started its own
    // setInterval poller against the same jobs table with zero teardown --
    // an accumulating timer leak, and independent in-memory dedup Maps that
    // could race and double-fire the same due job. Key a single live
    // scheduler per instance id on globalThis, stopping any prior one for
    // that instance before starting a fresh one, so at most one scheduler
    // (and one dedup-Map set) is ever live per instance regardless of how
    // many times bootHost is called for it.
    if (typeof globalThis !== 'undefined') {
        if (!globalThis.__thebirdCronSchedulers) globalThis.__thebirdCronSchedulers = {};
        const prior = globalThis.__thebirdCronSchedulers[fs.instanceId];
        if (prior && typeof prior.stop === 'function') { try { prior.stop(); } catch {
            // swallow: stopping a stale/already-stopped scheduler must never block a fresh boot
        } }
        globalThis.__thebirdCronSchedulers[fs.instanceId] = startCronScheduler({ cron, getChatTool: () => builtinTools.chat });
    } else {
        startCronScheduler({ cron, getChatTool: () => builtinTools.chat });
    }
    return host;
}
