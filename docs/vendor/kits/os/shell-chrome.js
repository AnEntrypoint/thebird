// Pure DOM builders for the desktop shell: theme-stylesheet injection, the
// icon span and button factories, and the four static chrome structures
// (menubar, apps menu, side rail, apps drawer) the shell wires behaviour onto.
// Nothing here closes over shell state — every function returns fresh nodes.

import { icons } from './icons.js';

const THEME_CSS_URL = new URL('./theme.css', import.meta.url).href;

export function ensureCss(href) {
    if (document.querySelector('link[data-os-theme]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href || THEME_CSS_URL;
    l.dataset.osTheme = '1';
    document.head.appendChild(l);
}

export function ic(svg) {
    const s = document.createElement('span');
    s.className = 'ic';
    s.innerHTML = svg;
    return s;
}

export function makeBtn(svg, label, role) {
    const b = document.createElement('button');
    b.className = 'os-btn';
    b.type = 'button';
    if (role) b.dataset.role = role;
    if (svg) b.append(ic(svg));
    if (label) b.append(Object.assign(document.createElement('span'), { textContent: label }));
    // Icon-only buttons (no visible label text) need an accessible name from
    // somewhere; `role` ('home'/'add'/etc) is already a short human-readable
    // word, so reuse it as aria-label rather than leaving the button unnamed.
    if (!label && role) b.setAttribute('aria-label', role);
    return b;
}

// The top menubar: home/brand/apps, an optional new-instance button, the
// instance switcher, and the tray clock. Returns every node the shell needs
// to bind listeners to or update later.
export function buildMenubar({ brand, withNewInstance }) {
    const menubar = document.createElement('div');
    menubar.className = 'os-menubar';
    // toolbar, not menubar: role="menubar" requires every direct child to be
    // role="menuitem"/menuitemcheckbox/menuitemradio, but this bar mixes plain
    // buttons (home, add-instance), a brand label, an instance switcher, and a
    // clock -- only appsBtn actually opens a dropdown menu. toolbar has no such
    // children constraint and correctly describes "a row of controls".
    menubar.setAttribute('role', 'toolbar');
    menubar.setAttribute('aria-label', 'Desktop menu bar');

    const homeBtn = makeBtn(icons.home, '', 'home');
    homeBtn.title = 'apps';

    const brandEl = document.createElement('span');
    brandEl.className = 'os-brand';
    brandEl.textContent = brand;

    const appsBtn = makeBtn(icons.apps, 'apps', 'apps');
    appsBtn.setAttribute('aria-haspopup', 'menu');
    appsBtn.setAttribute('aria-expanded', 'false');
    const newInstBtn = withNewInstance ? makeBtn(icons.plus, 'instance', 'add') : null;

    const instSwitch = document.createElement('div');
    instSwitch.className = 'os-instances';

    const spacer = document.createElement('div');
    spacer.className = 'os-spacer';

    const tray = document.createElement('div');
    tray.className = 'os-tray';
    const clock = document.createElement('span');
    clock.className = 'os-clock';
    tray.appendChild(clock);

    menubar.append(homeBtn, brandEl, appsBtn);
    if (newInstBtn) menubar.append(newInstBtn);
    menubar.append(instSwitch, spacer, tray);

    return { menubar, homeBtn, appsBtn, newInstBtn, instSwitch, clock };
}

export function buildAppsMenu() {
    const appsMenu = document.createElement('div');
    appsMenu.className = 'os-menu';
    appsMenu.setAttribute('role', 'menu');
    appsMenu.setAttribute('aria-label', 'Apps');
    return appsMenu;
}

export function buildSideRail() {
    const sideRail = document.createElement('div');
    sideRail.className = 'os-side-rail';
    sideRail.setAttribute('role', 'navigation');
    sideRail.setAttribute('aria-label', 'App launcher rail');
    return sideRail;
}

// The full-screen apps drawer. Full-screen overlay that traps the user's
// attention while open — the dialog role + aria-modal + aria-labelledby give
// a screen reader the same "you are now in a dialog named X" announcement a
// sighted user gets from the visual takeover.
export function buildDrawer() {
    const drawer = document.createElement('div');
    drawer.className = 'os-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-labelledby', 'os-drawer-title');
    const drawerHeader = document.createElement('div');
    drawerHeader.className = 'os-drawer-head';
    const drawerTitle = document.createElement('span');
    drawerTitle.className = 'os-drawer-title';
    drawerTitle.id = 'os-drawer-title';
    drawerTitle.textContent = 'apps';
    const drawerClose = document.createElement('button');
    drawerClose.className = 'os-drawer-close';
    drawerClose.type = 'button';
    drawerClose.setAttribute('aria-label', 'Close apps drawer');
    drawerClose.append(ic(icons.close));
    drawerHeader.append(drawerTitle, drawerClose);
    const drawerGrid = document.createElement('div');
    drawerGrid.className = 'os-drawer-grid';
    drawer.append(drawerHeader, drawerGrid);
    return { drawer, drawerClose, drawerGrid };
}

// Taskbar contents are rebuilt on a 500ms poll whenever windows open/
// close/gain focus (refreshTaskbar in the shell); aria-live announces those
// additions/removals to a screen reader, which otherwise gets no signal
// that the running-window list changed. "polite" so it never interrupts.
export function buildTaskbar() {
    const taskbar = document.createElement('div');
    taskbar.className = 'os-taskbar';
    taskbar.setAttribute('role', 'toolbar');
    taskbar.setAttribute('aria-label', 'Open windows');
    taskbar.setAttribute('aria-live', 'polite');
    taskbar.setAttribute('aria-relevant', 'additions removals');
    return taskbar;
}

// Per-app launcher entries: a menu item, a rail button, and a drawer tile,
// each wired to the caller's own open/close handlers.
export function buildAppEntries(app, { onMenuClick, onRailClick, onTileClick }) {
    const iconSvg = app.icon || icons[app.id] || '';

    const menuBtn = makeBtn(iconSvg, app.name);
    menuBtn.setAttribute('role', 'menuitem');
    menuBtn.addEventListener('click', onMenuClick);

    const railBtn = document.createElement('button');
    railBtn.className = 'os-rail-btn';
    railBtn.type = 'button';
    railBtn.title = app.name;
    railBtn.setAttribute('aria-label', app.name);
    railBtn.append(ic(iconSvg));
    railBtn.addEventListener('click', onRailClick);

    const tile = document.createElement('button');
    tile.className = 'os-drawer-tile';
    tile.type = 'button';
    tile.append(ic(iconSvg), Object.assign(document.createElement('span'), { className: 'lbl', textContent: app.name }));
    tile.addEventListener('click', onTileClick);

    return { menuBtn, railBtn, tile };
}
