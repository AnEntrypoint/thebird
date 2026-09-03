// Freddie pages for sidebar routes that don't yet have dedicated page modules.
// Each page is a minimal but functional renderer over the existing /api/* endpoints.
// These fill the gap between sidebar links and the FREDDIE_PAGES registry.

import { makePage, api, loadingState, errorState, emptyState } from './runtime.js';
import { Table, PageHeader, Kpi } from '../content.js';
import { section, truncSpan, TRUNC_TITLE } from './shared.js';

// ---- terminal ---------------------------------------------------------------
// Backend: GET /api/terminal (if available) — shows terminal sessions list

export const terminal = makePage((ctx) => {
    async function load() { try { ctx.set({ loading: false, data: await api('/api/terminal').catch(() => null), error: null }); } catch (e) { ctx.set({ loading: false, error: e }); } }
    load();
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading terminal…');
        if (s.error && !s.data) return errorState(s.error, load);
        return [
            PageHeader({ title: 'terminal', lede: 'terminal sessions' }),
            s.data ? section('sessions', Table({ headers: ['id', 'status'], rows: (Array.isArray(s.data) ? s.data : []).map(t => [t.id || '—', t.status || '—']) }))
                : emptyState('terminal endpoint not available'),
        ];
    };
});

// ---- files ----------------------------------------------------------------
// Backend: GET /api/files?path=... — file browser

export const files = makePage((ctx) => {
    async function load() { try { ctx.set({ loading: false, data: await api('/api/files').catch(() => null), error: null }); } catch (e) { ctx.set({ loading: false, error: e }); } }
    load();
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading files…');
        if (s.error && !s.data) return errorState(s.error, load);
        return [
            PageHeader({ title: 'files', lede: 'file browser' }),
            s.data ? section('files', Table({ headers: ['path', 'size', 'type'], rows: (Array.isArray(s.data) ? s.data : []).map(f => [f.path || '—', f.size ?? '—', f.type || '—']) }))
                : emptyState('files endpoint not available'),
        ];
    };
});

// ---- auth -----------------------------------------------------------------
// Backend: GET /api/auth — per-provider key status

export const auth = makePage((ctx) => {
    async function load() { try { ctx.set({ loading: false, data: await api('/api/auth').catch(() => null), error: null }); } catch (e) { ctx.set({ loading: false, error: e }); } }
    load();
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading auth…');
        if (s.error && !s.data) return errorState(s.error, load);
        const providers = s.data || [];
        return [
            PageHeader({ title: 'auth', lede: 'API keys & credentials' }),
            providers.length
                ? section('providers', Table({ headers: ['provider', 'status'], rows: providers.map(p => [p.provider || p.key || '—', p.set ? 'configured' : 'not set']) }))
                : emptyState('no providers configured'),
        ];
    };
});

// ---- settings --------------------------------------------------------------
// Backend: GET /api/config — configuration values

export const settings = makePage((ctx) => {
    async function load() { try { ctx.set({ loading: false, data: await api('/api/config').catch(() => null), error: null }); } catch (e) { ctx.set({ loading: false, error: e }); } }
    load();
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading settings…');
        if (s.error && !s.data) return errorState(s.error, load);
        const entries = s.data ? Object.entries(s.data) : [];
        return [
            PageHeader({ title: 'settings', lede: 'configuration' }),
            entries.length
                ? section('config', Table({ headers: ['key', 'value'], rows: entries.map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]) }))
                : emptyState('no config values'),
        ];
    };
});

// ---- theme ----------------------------------------------------------------
// Client-side only: theme preference selector

export const themePage = makePage((ctx) => {
    return () => {
        return [
            PageHeader({ title: 'theme', lede: 'theme preference' }),
            section('current', Table({ headers: ['setting', 'value'], rows: [
                ['theme', (typeof window !== 'undefined' && document.documentElement.getAttribute('data-theme')) || 'github-dark'],
                ['density', (typeof window !== 'undefined' && document.documentElement.getAttribute('data-density')) || 'compact'],
                ['accent', (typeof window !== 'undefined' && document.documentElement.getAttribute('data-accent')) || 'default'],
            ] })),
        ];
    };
});

// ---- worktree --------------------------------------------------------------
// Backend: GET /api/worktree — git worktrees

export const worktree = makePage((ctx) => {
    async function load() { try { ctx.set({ loading: false, data: await api('/api/worktree').catch(() => null), error: null }); } catch (e) { ctx.set({ loading: false, error: e }); } }
    load();
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading worktrees…');
        if (s.error && !s.data) return errorState(s.error, load);
        const trees = Array.isArray(s.data) ? s.data : [];
        return [
            PageHeader({ title: 'worktrees', lede: 'git worktrees' }),
            trees.length
                ? section('worktrees', Table({ headers: ['path', 'branch', 'hash'], rows: trees.map(t => [t.path || '—', t.branch || '—', t.hash || '—']) }))
                : emptyState('no worktrees'),
        ];
    };
});

// ---- session-tree ----------------------------------------------------------
// Backend: GET /api/sessions?tree=1 — session tree

export const sessionTree = makePage((ctx) => {
    async function load() { try { ctx.set({ loading: false, data: await api('/api/sessions?tree=1').catch(() => null), error: null }); } catch (e) { ctx.set({ loading: false, error: e }); } }
    load();
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading session tree…');
        if (s.error && !s.data) return errorState(s.error, load);
        const sessions = Array.isArray(s.data) ? s.data : [];
        return [
            PageHeader({ title: 'session tree', lede: 'session hierarchy' }),
            sessions.length
                ? section('sessions', Table({ headers: ['id', 'title', 'parent'], rows: sessions.slice(0, 20).map(x => [x.id || '—', truncSpan(x.title || x.id, TRUNC_TITLE), x.parent_id || '—']) }))
                : emptyState('no sessions'),
        ];
    };
});

// ---- notifications ---------------------------------------------------------
// Backend: GET /api/notifications — notification list

export const notifications = makePage((ctx) => {
    async function load() { try { ctx.set({ loading: false, data: await api('/api/notifications').catch(() => null), error: null }); } catch (e) { ctx.set({ loading: false, error: e }); } }
    load();
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading notifications…');
        if (s.error && !s.data) return errorState(s.error, load);
        const items = Array.isArray(s.data) ? s.data : [];
        return [
            PageHeader({ title: 'notifications', lede: 'alerts & notices' }),
            items.length
                ? section('notifications', Table({ headers: ['type', 'message', 'time'], rows: items.map(n => [n.type || '—', truncSpan(n.message || '', 100), n.time || '—']) }))
                : emptyState('no notifications'),
        ];
    };
});