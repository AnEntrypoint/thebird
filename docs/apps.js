import { Terminal, FitAddon } from './vendor/xterm-bundle.js';
import { createShell } from './shell.js';
import {
    icons,
    renderAboutApp,
    renderTerminal,
} from './vendor/kits/os/index.js';
import { getActiveInstance, getInstances } from './lib/instance-registry.js';
import { el } from './lib/dom.js';
export { el } from './lib/dom.js';

// Resolve the active instance for an app factory called via the kit's openApp.
// shell.openApp builds ctx = {...activeContext, registry, openApp, wm}; when
// the harness fires openApp before setActiveInstance lands (boot race), ctx
// has no .instance and every factory that destructures {instance} throws on
// .id. Falls back to docs/lib/instance-registry.js's getActiveInstance() —
// os-shell.js is the single writer of that registry (registerInstanceSource);
// this is a read-only accessor, not window.__debug (kept only as a console/
// witness-script mirror, no longer read on this path).
export function resolveInstance(ctx) {
    // An instance is "live" if the registry's current instance set still
    // holds it (by id). A captured ctx.instance can outlive close (closures
    // keep references after os-shell deletes it from `instances`) — never
    // hand a zombie to an app factory.
    const isLive = inst => getInstances().some(i => i && i.id === inst.id);
    if (ctx && ctx.instance && ctx.instance.id && isLive(ctx.instance)) return ctx.instance;
    const active = getActiveInstance();
    if (active) return active;
    const dbg = {
        instancesLen: getInstances().length,
        instanceIds: getInstances().map(i => i.id),
    };
    throw new Error('app factory: no active instance + no fallback. ' + JSON.stringify(dbg));
}

// Lazy-loaded apps resolve their factory via a dynamic import() inside an
// async factory (files/snake/level-editor/game-player/notes/cli-app --
// Phase 8 lazy-loading pass). shell.js's openApp does
// `result.then(finish)` with no .catch: a rejected factory promise (network
// 404, syntax error in the lazy chunk, a dropped connection) becomes an
// unhandled promise rejection and openApp produces NO window at all --
// silent, dead, no feedback. Wrap every lazy async factory in this so a
// rejection instead resolves to a normal factory result (a visible
// error pane), matching the in-window "boot error: ..." convention already
// used by todoApp's async busybase-import boot path.
function withLazyLoadErrorBoundary(appLabel, factory) {
    return async (ctx) => {
        try {
            return await factory(ctx);
        } catch (e) {
            console.error('[' + appLabel + '] lazy load failed', e);
            const node = el('div', 'app-pane');
            node.dataset.component = 'lazy-load-error';
            node.append(
                el('div', null, appLabel + ' failed to load'),
                el('div', 'meta', String((e && e.message) || e)),
                el('div', 'meta', 'This app is loaded on demand; the load itself failed (network drop, 404, or a broken module). Close this window and try opening ' + appLabel + ' again.'),
            );
            return { node, dispose() {} };
        }
    };
}

function canvasApp(ctx) {
    const instance = resolveInstance(ctx);
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = 200;
    cv.className = 'app-canvas';
    const mounted = instance.worker.mount(cv).catch(e => console.error('canvas mount:', e));
    // The canvas buffer is transferred to the worker (transferControlToOffscreen)
    // at mount time, so this element's .width/.height are frozen at mount-time
    // values thereafter -- CSS (.app-canvas: width/height 100%) keeps the element
    // visually filling the window body on resize/maximize/restore, but the
    // OffscreenCanvas backing buffer resolution must be updated via postMessage
    // (mirrors examples/apps/boids-app.js's ResizeObserver pattern, adapted for
    // the worker-owned-canvas boundary) or the draw loop keeps rendering at the
    // stale 320x200 resolution while CSS stretches/squashes it.
    const ro = new ResizeObserver(entries => {
        const box = entries[0] && entries[0].contentBoxSize && entries[0].contentBoxSize[0];
        const w = Math.max(1, box ? box.inlineSize : cv.clientWidth || 320);
        const h = Math.max(1, box ? box.blockSize : cv.clientHeight || 200);
        mounted.then(() => instance.worker.resize(Math.floor(w), Math.floor(h)));
    });
    ro.observe(cv);
    return { node: cv, dispose: () => ro.disconnect() };
}

const chatApp = withLazyLoadErrorBoundary('chat', async (ctx) => {
    const instance = resolveInstance(ctx);
    // appRegistry threaded down so createFreddieChat's plugin host can
    // actually register plugin.tabs as real openable windows (docs/lib/plugin.js's
    // tabs -> appRegistry.reg() path was previously fed null since createFreddieChat
    // had no reachable registry reference at all). ctx.registry is the same
    // object monitorApp() (line ~270) already reads app-count off of.
    const { createFreddieChat } = await import('./freddie-chat.js');
    return createFreddieChat({ instance, appRegistry: ctx.registry || null });
});

const terminalAppLazy = withLazyLoadErrorBoundary('terminal', async (ctx) => {
    const { terminalApp } = await import('./terminal-app.js');
    return terminalApp(ctx);
});

const browserAppLazy = withLazyLoadErrorBoundary('browser', async (ctx) => {
    const { browserApp } = await import('./browser-pane-app.js');
    return browserApp(ctx);
});

const xdisplayAppLazy = withLazyLoadErrorBoundary('xdisplay', async (ctx) => {
    const { xdisplayApp } = await import('./xdisplay-app.js');
    return xdisplayApp(ctx);
});

const monitorAppLazy = withLazyLoadErrorBoundary('monitor', async (ctx) => {
    const { monitorApp } = await import('./monitor-app.js');
    return monitorApp(ctx);
});

const freddieAppLazy = withLazyLoadErrorBoundary('assistant', async (ctx) => {
    const { freddieApp } = await import('./freddie-app.js');
    return freddieApp(ctx);
});

const todoAppLazy = withLazyLoadErrorBoundary('todo', async (ctx) => {
    const { todoApp } = await import('./todo-app.js');
    return todoApp(ctx);
});

const gmAppLazy = withLazyLoadErrorBoundary('gm', async (ctx) => {
    const { gmApp } = await import('./gm-app.js');
    return gmApp(ctx);
});

const workspacesAppLazy = withLazyLoadErrorBoundary('workspaces', async (ctx) => {
    const { workspacesApp } = await import('./workspaces-app.js');
    return workspacesApp(ctx);
});

const fsbrowseApp = withLazyLoadErrorBoundary('files', async (ctx) => {
    const instance = resolveInstance(ctx);
    const { createFsbrowseApp } = await import('./fsbrowse-app.js');
    return createFsbrowseApp({ instance });
});

const configApp = withLazyLoadErrorBoundary('config', async (ctx) => {
    const instance = resolveInstance(ctx);
    const { createFreddieKeys } = await import('./freddie-keys.js');
    const k = createFreddieKeys({ instance });
    return { node: k.node, dispose: k.dispose, getViewState: k.getViewState, restoreViewState: k.restoreViewState };
});

// t7-toy-apps-extract: snake/level-editor/game-player/boids/counter are
// example/toy apps, not core OS surfaces -- moved to docs/examples/apps/
// (docs/ has no build step and IS the served root for both `bunx serve docs`
// and gh-pages, so a sibling repo-root examples/ dir would be unreachable --
// it has to stay inside docs/ to be servable at all) and dynamic-import()'d
// here on first open rather than statically imported at module-eval time.
// os-shell.js's openApp already tolerates an async factory (captures the
// active instance at invocation time precisely so a resolved-later factory
// still attaches to the right instance), so this costs nothing but a
// one-time import() on first open of each toy app.
const snakeApp = withLazyLoadErrorBoundary('snake', async (ctx) => {
    const instance = resolveInstance(ctx);
    const { createSnakeApp } = await import('./examples/apps/snake-app.js');
    return createSnakeApp({ instance });
});

const snakeEcsApp = withLazyLoadErrorBoundary('snake-ecs', async (ctx) => {
    const instance = resolveInstance(ctx);
    const { createSnakeEcsApp } = await import('./examples/apps/snake-ecs-app.js');
    return createSnakeEcsApp({ instance });
});

const levelEditorApp = withLazyLoadErrorBoundary('level-editor', async (ctx) => {
    const instance = resolveInstance(ctx);
    const { createLevelEditorApp } = await import('./examples/apps/level-editor-app.js');
    return createLevelEditorApp({ instance });
});

const gamePlayerApp = withLazyLoadErrorBoundary('game-player', async (ctx) => {
    const instance = resolveInstance(ctx);
    const { createGamePlayerApp } = await import('./examples/apps/game-player-app.js');
    return createGamePlayerApp({ instance, ctx });
});

const boidsApp = withLazyLoadErrorBoundary('boids', async (ctx) => {
    const { boidsApp: impl } = await import('./examples/apps/boids-app.js');
    return impl(ctx);
});

const reactCounterApp = withLazyLoadErrorBoundary('counter', async (ctx) => {
    const { reactCounterApp: impl } = await import('./examples/apps/react-counter-app.js');
    return impl(ctx);
});

function aboutApp() {
    // Upstream about-app default (anentrypoint-design ≥0.0.140) ships clean
    // links/footer with no dead validate.html ref — no thebird override needed.
    return renderAboutApp({});
}

const notesApp = withLazyLoadErrorBoundary('notes', async (ctx) => {
    const instance = resolveInstance(ctx);
    const { createNotesApp } = await import('./notes-app.js');
    return createNotesApp({ instance });
});

export function createAppRegistry() {
    const apps = new Map();
    const reg = (id, name, factory, opts = {}) => {
        if (apps.has(id)) console.warn('[apps] duplicate app id overwritten: ' + id);
        apps.set(id, { id, name, icon: icons[id] || '', factory, defaultSize: opts.size || { w: 520, h: 360 }, system: !!opts.system });
    };

    // regCli: register a proper "CLI app" from a shell-command spec instead of
    // a hand-written DOM factory -- point at a command, get a real terminal
    // pane (xterm + docs/shell.js's POSIX shell) that runs it on open. Reuses
    // the exact substrate terminalApp already ships (renderTerminal kit
    // component, Terminal/FitAddon, createShell), so a new CLI app is a
    // one-line reg() call, not a new factory function.
    const regCli = (id, name, spec, opts = {}) => reg(id, name, withLazyLoadErrorBoundary(name, async (ctx) => {
        const instance = resolveInstance(ctx);
        const { createCliApp } = await import('./cli-app.js');
        return createCliApp({ instance, spec, Terminal, FitAddon, createShell, renderTerminal });
    }), opts);

    reg('chat', 'chat', chatApp, { size: { w: 560, h: 480 } });
    reg('freddie', 'assistant', freddieAppLazy, { size: { w: 960, h: 680 } });
    reg('terminal', 'terminal', terminalAppLazy, { size: { w: 560, h: 340 } });
    reg('browser', 'browser', browserAppLazy, { size: { w: 640, h: 400 } });
    reg('files', 'files', fsbrowseApp, { size: { w: 560, h: 440 } });
    reg('workspaces', 'workspaces', workspacesAppLazy, { size: { w: 720, h: 480 } });
    reg('canvas', 'canvas', canvasApp, { size: { w: 380, h: 260 }, system: true });
    reg('xdisplay', 'x display', xdisplayAppLazy, { size: { w: 680, h: 440 }, system: true });
    reg('monitor', 'system monitor', monitorAppLazy, { size: { w: 420, h: 240 }, system: true });
    reg('gm', 'memory', gmAppLazy, { size: { w: 520, h: 420 }, system: true });
    reg('todo', 'todo', todoAppLazy, { size: { w: 480, h: 480 }, system: true });
    reg('snake', 'snake', snakeApp, { size: { w: 360, h: 420 } });
    reg('snake-ecs', 'snake (ECS)', snakeEcsApp, { size: { w: 360, h: 420 } });
    reg('notes', 'notes', notesApp, { size: { w: 640, h: 480 } });
    reg('boids', 'boids', boidsApp, { size: { w: 480, h: 360 } });
    // No-code game/level editor: place objects on a canvas, edit properties
    // live in the inspector, save/load a versioned scene-graph JSON via the
    // per-instance fs, export a portable .json. First real authoring tool —
    // every prior game-like app (snake, boids) was 100% hand-coded JS.
    reg('level-editor', 'level editor', levelEditorApp, { size: { w: 680, h: 460 } });
    // Generic runtime shell for ANY saved level-editor scene JSON: the LAST
    // one-time source edit this closure needs — after this reg() call, a
    // user-authored scene loads into game-player with zero further apps.js
    // changes (picks the scene from the per-instance fs at open time via a
    // <select>, runs it with level-editor-app.js's extracted
    // runScenePlaytest() runner).
    reg('game-player', 'game player', gamePlayerApp, { size: { w: 680, h: 460 } });
    // CLI-app example: proves regCli works with a real command (git status
    // inside the sandboxed shell's cwd, same shell every terminal uses).
    regCli('git-status', 'git status', { cmd: 'git status', title: 'git-status', statusText: 'ready' }, { size: { w: 560, h: 340 } });
    // webjsx counter example: proves the closure-based render()/applyDiff
    // pattern mounts and unmounts cleanly inside a WM window.
    reg('counter', 'counter', reactCounterApp, { size: { w: 360, h: 220 } });
    reg('about', 'about', aboutApp, { size: { w: 480, h: 380 }, system: true });
    reg('config', 'config', configApp, { size: { w: 640, h: 520 }, system: true });
    apps.list = () => [...apps.values()];
    return apps;
}
