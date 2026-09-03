// Plugin architecture with lifecycle hooks -- backs the "plugins" checkbox
// list already rendered by docs/chat-config.js and gives docs/sdk.js's
// `use` hook stub a real implementation to delegate to.
//
// Dependency-free factory-function style, matching docs/sdk.js /
// docs/audit.js / docs/policy.js: no classes (bar policy.js's one Error
// subclass, which does not apply here), plain closures over a Map.
//
// Plugin shape contract (documented, not class-enforced -- any object
// matching this shape is a valid plugin):
//
// @typedef {Object} ThebirdPlugin
// @property {string} name -- required, non-empty, unique key. Registering a
//   second plugin under an already-used name REPLACES the prior one (its
//   onDestroy fires first) rather than throwing.
// @property {Object<string,string>} [workspace] -- path -> file content,
//   merged across all registered plugins the same way
//   docs/lib/templates.js's mergeTemplateWithOptions merges `workspace`:
//   `{...a, ...b}`, later-registered plugin wins on key conflicts.
// @property {Object<string,string>} [env] -- key -> value, merged the same
//   way as `workspace` (later-registered plugin wins).
// @property {Array<{id:string, name:string, factory:function}>} [tabs] --
//   each tab is registered as a REAL openable thebird app window via
//   appRegistry.reg(id, name, factory) (see docs/apps.js createAppRegistry);
//   `factory` must match the app-registry contract:
//   (ctx) => ({node, dispose, getViewState?, restoreViewState?}).
// @property {function(sdk):void} [onInit] -- called synchronously inside
//   use(), once, at registration time.
// @property {function(sdk):void} [onReady] -- called the first time ANY of
//   this plugin's tabs is opened as a window (once per plugin per
//   registration, not once per window instance -- opening the same tab
//   twice, or opening two different tabs from the same plugin, fires
//   onReady at most once).
// @property {function(sdk):void} [onDestroy] -- called when the plugin is
//   replaced (same name re-registered) or explicitly unregistered.

// createPluginHost(sdk, appRegistry) -> { use, unregister, list,
//   mergedWorkspace, mergedEnv, mergedTabs }
//
// `sdk` is the per-instance SDK object from docs/sdk.js's createSdk() --
// passed through unchanged to onInit/onReady/onDestroy so plugins can read
// fs/exec/events like any other SDK consumer.
// `appRegistry` is the Map-like object returned by docs/apps.js's
// createAppRegistry() -- must expose `.reg(id, name, factory, opts)`.
export function createPluginHost(sdk, appRegistry) {
    const plugins = new Map(); // name -> plugin

    function destroyPlugin(plugin) {
        if (plugin && typeof plugin.onDestroy === 'function') {
            try { plugin.onDestroy(sdk); } catch (err) { console.error('[plugin] onDestroy for ' + plugin.name + ' threw:', err); }
        }
    }

    function use(plugin) {
        if (!plugin || typeof plugin.name !== 'string' || !plugin.name.trim()) {
            throw new Error('createPluginHost.use: plugin.name must be a non-empty string');
        }
        const prior = plugins.get(plugin.name);
        if (prior) destroyPlugin(prior);

        plugins.set(plugin.name, plugin);

        if (typeof plugin.onInit === 'function') {
            try { plugin.onInit(sdk); } catch (err) { console.error('[plugin] onInit for ' + plugin.name + ' threw:', err); }
        }

        if (Array.isArray(plugin.tabs) && appRegistry && typeof appRegistry.reg === 'function') {
            let readyFired = false;
            const fireReadyOnce = () => {
                if (readyFired) return;
                readyFired = true;
                if (typeof plugin.onReady === 'function') {
                    try { plugin.onReady(sdk); } catch (err) { console.error('[plugin] onReady for ' + plugin.name + ' threw:', err); }
                }
            };
            for (const tab of plugin.tabs) {
                if (!tab || typeof tab.id !== 'string' || typeof tab.factory !== 'function') continue;
                const wrappedFactory = (ctx) => {
                    fireReadyOnce();
                    return tab.factory(ctx);
                };
                appRegistry.reg(tab.id, tab.name || tab.id, wrappedFactory, tab.opts || {});
            }
        }

        return plugin;
    }

    function unregister(name) {
        const plugin = plugins.get(name);
        if (!plugin) return false;
        destroyPlugin(plugin);
        plugins.delete(name);
        return true;
    }

    function list() {
        return [...plugins.keys()].map(name => ({ name, active: true }));
    }

    // mergeRecord: later-registered plugin wins on key conflicts, matching
    // docs/lib/templates.js's mergeTemplateWithOptions `{...a, ...b}` style.
    function mergeRecords(pick) {
        let out = {};
        for (const plugin of plugins.values()) {
            const record = pick(plugin);
            if (record && typeof record === 'object') out = { ...out, ...record };
        }
        return out;
    }

    function mergedWorkspace() {
        return mergeRecords(p => p.workspace);
    }

    function mergedEnv() {
        return mergeRecords(p => p.env);
    }

    function mergedTabs() {
        const out = [];
        for (const plugin of plugins.values()) {
            if (!Array.isArray(plugin.tabs)) continue;
            for (const tab of plugin.tabs) out.push({ ...tab, pluginName: plugin.name });
        }
        return out;
    }

    return { use, unregister, list, mergedWorkspace, mergedEnv, mergedTabs };
}
