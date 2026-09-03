import * as webjsx from '../../../vendor/webjsx/index.js';
import * as components from '../../components.js';
import { ROUTES, OS_ROUTE_DEFS } from './freddie/routes.js';
import { makeCorePages } from './freddie/pages-core.js';
import { makeChatPage } from './freddie/pages-chat.js';
import { makeToolsPages } from './freddie/pages-tools.js';
import { makeOsPages } from './freddie/pages-os.js';

const { AppShell, Topbar, Side, Crumb, Status, Panel, Chip, EmptyState, Icon } = components;

function pre(obj) {
    return webjsx.createElement('pre', { class: 'fd-pre' }, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

export function createFreddieDashboard({ instance, bootHost, osSurfaces, loadingText }) {
    const root = document.createElement('div');
    root.className = 'app-fd ds-247420 fd-root';

    const state = { active: 'home', ts: new Date().toLocaleTimeString(), body: null, error: null };
    let host = instance.host || null;
    const allRoutes = osSurfaces ? [...ROUTES, ...OS_ROUTE_DEFS] : ROUTES;
    // Bumped on every setActive() and captured by loadActive() before its
    // first await; a resolving page whose generation no longer matches the
    // live one is a stale in-flight nav (user clicked a second page before
    // the first's async page() resolved) and must not overwrite state.body —
    // otherwise the crumb/side (synchronous) shows the new page while the
    // main content silently keeps whichever page happened to resolve last.
    let navGeneration = 0;

    async function ensureHost() {
        if (host) return host;
        if (typeof bootHost !== 'function') throw new Error('createFreddieDashboard: instance.host or bootHost required');
        host = instance.host = await bootHost({ fs: instance.fs });
        return host;
    }

    function setActive(p) { state.active = p; navGeneration++; rerender(); }
    if (typeof window !== 'undefined') window.__fd_nav = setActive;

    function rerender() { webjsx.applyDiff(root, view()); loadActive(); }

    const ctx = { instance, osSurfaces, root, state, rerender, get host() { return host; } };
    const PAGES = {
        ...makeCorePages(ctx),
        chat: makeChatPage(ctx),
        ...makeToolsPages(ctx),
        ...(osSurfaces ? makeOsPages(ctx) : {}),
    };

    function buildSide() {
        const sections = [{
            group: 'ASSISTANT',
            items: ROUTES.map(r => ({
                glyph: r.glyph, label: r.label, href: '#fd-' + r.path,
                active: state.active === r.path,
                onClick: (ev) => { ev.preventDefault(); setActive(r.path); },
            })),
        }];
        if (osSurfaces) sections.push({
            group: 'OS',
            items: OS_ROUTE_DEFS.map(r => ({
                glyph: r.glyph, label: r.label, href: '#fd-' + r.path,
                active: state.active === r.path,
                onClick: (ev) => { ev.preventDefault(); setActive(r.path); },
            })),
        });
        return Side({ sections });
    }

    function view() {
        const route = allRoutes.find(r => r.path === state.active) || ROUTES[1];
        return AppShell({
            topbar: Topbar({ brand: 'assistant', leaf: 'dashboard', items: [], active: '' }),
            crumb: Crumb({ trail: ['assistant', instance.id], leaf: route.path, right: state.error ? Chip({ tone: 'miss', children: 'error' }) : Chip({ tone: 'live', children: 'live' }) }),
            side: buildSide(),
            main: state.body || EmptyState({ text: loadingText || 'loading…', glyph: Icon('circle') }),
            status: Status({ left: ['ds-247420 · webjsx · ' + allRoutes.length + ' routes', 'instance=' + instance.id], right: [state.ts] }),
        });
    }

    async function loadActive() {
        const myGeneration = navGeneration;
        let body, error = null;
        try {
            const h0 = await ensureHost();
            const page = PAGES[state.active] || PAGES.home;
            body = await page(h0, instance);
        } catch (e) {
            error = String(e && e.stack || e);
            body = Panel({ title: 'error', children: pre(error) });
        }
        if (myGeneration !== navGeneration) return; // superseded by a later nav click
        state.body = body;
        state.error = error;
        state.ts = new Date().toLocaleTimeString();
        webjsx.applyDiff(root, view());
    }

    rerender();

    if (typeof window !== 'undefined') {
        window.__debug = window.__debug || {};
        window.__debug.instances = window.__debug.instances || {};
        window.__debug.instances[instance.id] = window.__debug.instances[instance.id] || {};
        window.__debug.instances[instance.id].dashboard = {
            root, routes: allRoutes.map(r => r.path), setActive,
            get active() { return state.active; },
        };
    }

    return { node: root, dispose() {} };
}
