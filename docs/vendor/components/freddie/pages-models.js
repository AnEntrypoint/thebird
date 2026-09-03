// Freddie capability-catalogue pages, each a thin state wrapper over its own
// dedicated config component: `models` (availability matrix + rebuild),
// `skills`, and `plugins`.

import { makePage, api } from './runtime.js';
import { PageHeader } from '../content.js';
import { ModelsConfig } from '../models-config.js';
import { SkillsConfig } from '../skills-config.js';
import { PluginsConfig } from '../plugins-config.js';

export const models = makePage((ctx) => {
    Object.assign(ctx.state, { rebuilding: false, selectedProviderId: null, selectedModel: null });
    // GET /api/models/availability — the real per-(provider x model x mode)
    // availability matrix (plugins/gui-models-discover), per freddie's AGENTS.md
    // "Model availability matrix" section. 404 with {error,hint} when the
    // matrix file hasn't been built yet — ModelsConfig itself renders that
    // as an empty state with a "build availability matrix" action.
    async function load() {
        try { ctx.set({ loading: false, data: await api('/api/models/availability'), error: null }); }
        catch (e) { ctx.set({ loading: false, data: null, error: (e && e.body) || e }); }
    }
    async function rebuild() {
        if (ctx.state.rebuilding) return;
        ctx.set({ rebuilding: true, rebuildError: null });
        try { await api('/api/models/availability/rebuild', { method: 'POST', body: {} }); await load(); }
        catch (e) { ctx.set({ rebuildError: e }); }
        ctx.set({ rebuilding: false });
    }
    load();
    return () => {
        const s = ctx.state;
        return [
            PageHeader({ title: 'models', lede: s.data ? (s.data.summary?.total_models ?? 0) + ' models across ' + (s.data.summary?.total_providers ?? 0) + ' providers' : 'model availability matrix' }),
            ModelsConfig({
                data: s.data, loading: s.loading, error: s.error,
                selectedProviderId: s.selectedProviderId, onSelectProvider: (id) => ctx.set({ selectedProviderId: id, selectedModel: null }),
                selectedModel: s.selectedModel, onSelectModel: (m) => ctx.set({ selectedModel: m }),
                onRefresh: load, onRebuild: rebuild, rebuilding: s.rebuilding, rebuildError: s.rebuildError,
            }),
        ];
    };
});

export const skills = makePage((ctx) => {
    Object.assign(ctx.state, { selected: null, query: '', busyName: null });
    async function load() { try { ctx.set({ loading: false, list: await api('/api/skills'), error: null }); } catch (e) { ctx.set({ loading: false, error: e }); } }
    load();
    return () => {
        const s = ctx.state;
        // GET /api/skills returns {home:[...], bundled:[...], skillState} —
        // two source lists (user ~/.freddie/skills vs bundled skills/ dirs)
        // plus a per-skill enabled/disabled state map, not a flat array.
        // Concat both sources (home overrides bundled on name collision,
        // matching src/skills/index.js's own findSkill() precedence) and
        // resolve enabled state from skillState (default true when absent).
        const raw = s.list && typeof s.list === 'object' ? s.list : {};
        const rawList = Array.isArray(raw) ? raw : [...(raw.bundled || []), ...(raw.home || [])];
        const skillState = raw.skillState || {};
        const mapped = rawList.map((sk) => ({
            file: sk.file || sk.path || sk.name,
            name: sk.name,
            description: sk.description || (sk.frontmatter && sk.frontmatter.description) || '',
            platforms: sk.platforms || (sk.frontmatter && sk.frontmatter.platforms),
            enabled: skillState[sk.name] !== false,
        }));
        return [
            PageHeader({ title: 'skills', lede: mapped.length + ' skills' }),
            SkillsConfig({
                skills: mapped, selected: s.selected, loading: s.loading, error: s.error,
                busyName: s.busyName, query: s.query, onQuery: (q) => ctx.set({ query: q }),
                onSelect: (name) => ctx.set({ selected: s.selected === name ? null : name }),
            }),
        ];
    };
});

export const plugins = makePage((ctx) => {
    Object.assign(ctx.state, { selected: null });
    // GET /api/plugins — flat {name,version,surfaces,requires,source,enabled}
    // list, per plugins/gui-plugins-list/plugin.js (distinct from
    // /api/plugin-graph's D3 {nodes,edges} shape built for the dependency
    // visualization, not a flat list UI).
    async function load() { try { ctx.set({ loading: false, list: await api('/api/plugins'), error: null }); } catch (e) { ctx.set({ loading: false, error: e }); } }
    load();
    return () => {
        const s = ctx.state;
        const list = Array.isArray(s.list) ? s.list : (s.list?.plugins || []);
        return [
            PageHeader({ title: 'plugins', lede: list.length + ' plugins loaded' }),
            PluginsConfig({
                plugins: list, selected: s.selected, loading: s.loading, error: s.error,
                onSelect: (name) => ctx.set({ selected: s.selected === name ? null : name }),
                onReload: load,
            }),
        ];
    };
});
