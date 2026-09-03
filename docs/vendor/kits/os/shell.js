// createDesktopShell — the desktop OS shell: assembles the menubar / apps
// menu / side rail / drawer / taskbar chrome (built by ./shell-chrome.js),
// owns the shared mutable state those surfaces read (active context, active
// instance, taskbar signature, drawer focus return), and drives window
// spawning through ./shell-geometry.js.

import {
    ensureCss, buildMenubar, buildAppsMenu, buildSideRail, buildDrawer,
    buildTaskbar, buildAppEntries, ic,
} from './shell-chrome.js';
import { icons } from './icons.js';
import { computeSpawnRect, reflowWindows } from './shell-geometry.js';

export function createDesktopShell({ root = document.body, wm, registry, brand = 'desktop', themeUrl, onNewInstance, autoBoot = false } = {}) {
    if (!wm) throw new Error('createDesktopShell: wm is required');
    if (!registry) throw new Error('createDesktopShell: registry is required');
    ensureCss(themeUrl);

    const osRoot = document.createElement('div');
    osRoot.className = 'os-root';
    root.appendChild(osRoot);

    const { menubar, homeBtn, appsBtn, newInstBtn, instSwitch, clock } =
        buildMenubar({ brand, withNewInstance: !!onNewInstance });
    const appsMenu = buildAppsMenu();
    const sideRail = buildSideRail();
    const { drawer, drawerClose, drawerGrid } = buildDrawer();
    const taskbar = buildTaskbar();

    // The registry is not frozen at shell creation — hosts can register and
    // unregister apps later (thebird's per-instance user-* apps come and go on
    // instance switch and fs edits). refreshApps() re-syncs the three launcher
    // surfaces (apps menu / side rail / drawer grid) surgically: entries for
    // newly registered apps are appended, entries whose app was unregistered
    // are removed, and already-rendered entries keep their nodes (listeners,
    // focus, and any host-side regrouping of the menu intact). The initial
    // render is the same call. Buttons are tagged data-app-id so removal can
    // find them again.
    const renderedAppIds = new Set();
    function refreshApps() {
        const apps = typeof registry.list === 'function' ? registry.list() : [...registry.values()];
        const live = new Set(apps.map(a => a.id));
        for (const id of renderedAppIds) {
            if (live.has(id)) continue;
            for (const container of [appsMenu, sideRail, drawerGrid]) {
                const stale = container.querySelector('[data-app-id="' + id + '"]');
                if (stale) stale.remove();
            }
            renderedAppIds.delete(id);
        }
        for (const app of apps) {
            if (renderedAppIds.has(app.id)) continue;
            const { menuBtn, railBtn, tile } = buildAppEntries(app, {
                onMenuClick: () => { closeMenu(); openApp(app.id); },
                onRailClick: () => openApp(app.id),
                onTileClick: () => { closeDrawer(); openApp(app.id); },
            });
            menuBtn.dataset.appId = app.id;
            railBtn.dataset.appId = app.id;
            tile.dataset.appId = app.id;
            appsMenu.appendChild(menuBtn);
            sideRail.appendChild(railBtn);
            drawerGrid.appendChild(tile);
            renderedAppIds.add(app.id);
        }
    }
    refreshApps();

    osRoot.append(menubar, appsMenu, taskbar);
    document.body.append(sideRail, drawer);

    // Apps menu keyboard operability (APG menu-button pattern), mirroring the
    // drawer's capture/restore-focus treatment below: opening moves focus onto
    // the first menuitem so Tab/arrow-keys start inside the now-visible menu
    // instead of on a hidden ancestor; closing restores focus to appsBtn (the
    // only trigger) so keyboard position isn't lost. Arrow keys roam the
    // role="menuitem" set (roving focus) per the declared role="menu".
    let menuReturnFocus = null;
    function menuItems() { return [...appsMenu.querySelectorAll('[role="menuitem"]')]; }
    function openMenu() {
        menuReturnFocus = document.activeElement;
        appsMenu.classList.add('open');
        appsBtn.setAttribute('aria-expanded', 'true');
        const items = menuItems();
        if (items.length) items[0].focus();
    }
    function closeMenu() {
        if (!appsMenu.classList.contains('open')) return;
        appsMenu.classList.remove('open');
        appsBtn.setAttribute('aria-expanded', 'false');
        if (menuReturnFocus && typeof menuReturnFocus.focus === 'function') menuReturnFocus.focus();
        menuReturnFocus = null;
    }
    appsMenu.addEventListener('keydown', e => {
        const items = menuItems();
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1 + items.length) % items.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
        else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    });
    // Focus management: opening the drawer moves keyboard focus onto its
    // close button (the first reachable control inside the now-visible
    // dialog) so Tab starts inside it, not lost on a now-hidden ancestor;
    // closing restores focus to whichever element opened it (homeBtn is the
    // only trigger today) so the user's keyboard position isn't lost.
    let drawerReturnFocus = null;
    function openDrawer() {
        drawerReturnFocus = document.activeElement;
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        drawerClose.focus();
    }
    function closeDrawer() {
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        if (drawerReturnFocus && typeof drawerReturnFocus.focus === 'function') drawerReturnFocus.focus();
        drawerReturnFocus = null;
    }

    appsBtn.addEventListener('click', e => { e.stopPropagation(); appsMenu.classList.contains('open') ? closeMenu() : openMenu(); });
    homeBtn.addEventListener('click', e => { e.stopPropagation(); drawer.classList.contains('open') ? closeDrawer() : openDrawer(); });
    drawerClose.addEventListener('click', closeDrawer);
    drawer.addEventListener('click', e => { if (e.target === drawer) closeDrawer(); });
    document.addEventListener('click', e => {
        if (!appsMenu.contains(e.target) && !appsBtn.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeMenu(); closeDrawer(); }
    });

    function tickClock() { clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    tickClock();
    const clockTimer = setInterval(tickClock, 30000);

    let activeContext = null;
    let activeInstanceId = null;
    function setContext(ctx) { activeContext = ctx; }

    function applyInstanceFilter() {
        if (!activeInstanceId) return;
        for (const wEl of document.querySelectorAll('.wm-win[data-instance-id]')) {
            const wInst = wEl.dataset.instanceId;
            wEl.classList.toggle('wm-inst-hidden', wInst !== activeInstanceId);
        }
    }

    let taskbarSig = null;
    function refreshTaskbar() {
        const items = [];
        for (const w of wm.list()) {
            const wEl = document.querySelector('.wm-win[data-id="' + w.id + '"]');
            const wInst = wEl && wEl.dataset.instanceId;
            if (activeInstanceId && wInst && wInst !== activeInstanceId) continue;
            items.push(w);
        }
        // Diff-aware rebuild: the 500ms poll must not reset the taskbar's
        // horizontal scroll (mobile scroll-snap) or button focus every tick.
        const sig = items.map(w => w.id + ' ' + w.title + ' ' + (w.focused ? 1 : 0)).join('');
        if (sig === taskbarSig) return;
        taskbarSig = sig;
        const sl = taskbar.scrollLeft;
        taskbar.innerHTML = '';
        if (!items.length) {
            const empty = document.createElement('span');
            empty.className = 'os-task-empty';
            empty.textContent = 'no windows';
            taskbar.appendChild(empty);
        }
        for (const w of items) {
            const t = document.createElement('button');
            t.className = 'os-task' + (w.focused ? ' focused' : '');
            t.type = 'button';
            t.dataset.winId = w.id;
            // Same icon-resolution order as buildAppEntries (menu/rail/drawer):
            // the registered app's own icon, falling back to the id-keyed
            // default set — so a taskbar entry always matches its apps-menu
            // counterpart instead of reading as unrelated text-only chrome.
            const app = w.appId && (typeof registry.get === 'function' ? registry.get(w.appId) : registry[w.appId]);
            const iconSvg = (app && app.icon) || icons[w.appId] || '';
            if (iconSvg) t.append(ic(iconSvg));
            t.append(Object.assign(document.createElement('span'), { className: 'os-task-label', textContent: w.title }));
            // aria-current announces which window is the active one; a
            // sighted user reads this from the .focused visual state alone.
            if (w.focused) t.setAttribute('aria-current', 'true');
            t.addEventListener('click', () => wm.focus(w.id));
            taskbar.appendChild(t);
        }
        taskbar.scrollLeft = sl;
    }

    function setActiveInstance(id) {
        activeInstanceId = id;
        for (const btn of instSwitch.querySelectorAll('.os-btn')) {
            btn.classList.toggle('active', btn.dataset.instanceId === id);
        }
        applyInstanceFilter();
        refreshTaskbar();
    }

    function makeLoadingNode() {
        const n = document.createElement('div');
        n.className = 'app-pane os-app-loading';
        n.setAttribute('role', 'status');
        n.setAttribute('aria-live', 'polite');
        n.setAttribute('aria-label', 'loading');
        const spinner = document.createElement('div');
        spinner.className = 'ds-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        spinner.appendChild(document.createElement('span'));
        spinner.appendChild(document.createElement('span'));
        spinner.appendChild(document.createElement('span'));
        const label = document.createElement('span');
        label.className = 'os-app-loading-label';
        label.textContent = 'loading…';
        n.appendChild(spinner);
        n.appendChild(label);
        return n;
    }

    function openApp(appId) {
        const app = (typeof registry.get === 'function') ? registry.get(appId) : registry[appId];
        if (!app) throw new Error('unknown app: ' + appId);
        const ctx = { ...(activeContext || {}), registry, openApp, wm };
        const result = app.factory(ctx);
        const isAsync = result && typeof result.then === 'function';
        const sz = app.defaultSize || { w: 520, h: 360 };
        const { w, h, x, y, maximized } = computeSpawnRect(sz, wm.count);
        const titlePrefix = (activeContext && activeContext.titlePrefix) ? activeContext.titlePrefix + ' · ' : '';
        // A slow async factory (network/worker-backed app) must not read as a
        // dead click: spawn the window immediately with a loading placeholder
        // body, then swap in the real content once the factory resolves.
        const win = wm.open({ title: titlePrefix + app.name, body: isAsync ? makeLoadingNode() : result.node, kind: appId, width: w, height: h, x, y, maximized });
        if (activeInstanceId && win.el) {
            win.el.dataset.instanceId = activeInstanceId;
            win.instanceId = activeInstanceId;
        }
        win.appId = appId;
        refreshTaskbar();
        const finish = (r) => {
            if (isAsync && typeof win.setBody === 'function') win.setBody(r.node);
            // Keep the FULL factory result on _app (only id is overridden with
            // the registry's appId): hosts persist/restore per-window view
            // state through getViewState/restoreViewState hooks on the factory
            // result — a lossy {id, dispose} wrap silently dropped them.
            win._app = { ...r, id: appId };
            refreshTaskbar();
            return win;
        };
        if (isAsync) return result.then(finish);
        return finish(result);
    }

    if (newInstBtn) newInstBtn.addEventListener('click', () => onNewInstance && onNewInstance({ instSwitch, setContext, openApp }));

    const taskTimer = setInterval(refreshTaskbar, 500);

    const onViewportResize = () => reflowWindows(wm);
    window.addEventListener('resize', onViewportResize);

    const api = {
        wm, registry, openApp, setContext, refreshTaskbar, setActiveInstance,
        openDrawer, closeDrawer, openMenu, closeMenu, refreshApps,
        get activeInstanceId() { return activeInstanceId; },
        elements: { osRoot, menubar, taskbar, appsMenu, sideRail, drawer, instSwitch, homeBtn, appsBtn },
        dispose() { clearInterval(clockTimer); clearInterval(taskTimer); window.removeEventListener('resize', onViewportResize); osRoot.remove(); sideRail.remove(); drawer.remove(); },
    };

    if (autoBoot && typeof autoBoot === 'string') openApp(autoBoot);
    return api;
}
