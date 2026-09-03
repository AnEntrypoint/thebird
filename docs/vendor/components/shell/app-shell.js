// The classic single-sidebar app frame: Topbar, Crumb, Side, Status and the
// AppShell that composes them, plus the pure-DOM sidebar-drawer toggle (the
// shell is stateless chrome, so drawer open/closed lives as a class on
// .app-body read by the @container(max-width:900px) query).

import * as webjsx from '../../../vendor/webjsx/index.js';
import { trapTab } from '../overlay-primitives.js';
import { Brand, Glyph } from './atoms.js';
import { Icon } from './icons.js';
import { ThemeToggle } from '../theme-toggle.js';
const h = webjsx.createElement;

// `themeToggle` defaults on: every Topbar consumer (homepage included) gets a
// real, working light/dark/auto control in the shell chrome instead of each
// call site having to remember to wire ThemeToggle() in by hand. Pass
// `themeToggle: false` to opt a shell out (e.g. a kit that renders its own).
export function Topbar({ brand = '247420', leaf = '', items = [], active = '', onNav, search, themeToggle = true } = {}) {
    // `search` is either a plain placeholder string (Topbar renders the
    // default uncontrolled input itself, and owns the icon below) or a
    // caller-built VElement (has .type/.props — e.g. SearchInput(), a
    // component that already renders its own icon + input + clear button).
    // A VElement renders as-is with NO extra wrapper: SearchInput's own
    // markup already covers the icon and the field, so wrapping it in
    // Topbar's own '.app-search' icon+label previously doubled the search
    // glyph (one from Topbar, one from inside SearchInput).
    const isElement = search && typeof search === 'object' && 'type' in search;
    return h('header', { class: 'app-topbar', role: 'banner' },
        Brand({ name: brand, leaf }),
        isElement ? search : (search ? h('label', { class: 'app-search' },
            // Line-icon, not the literal word "search" as a pseudo-glyph: the
            // text stand-in inherited .app-search .icon's 0.6 opacity, which
            // dropped --fg-3 to 3.74:1 on --bg-2 and failed AA as real text.
            // An SVG is decorative (aria-hidden) rather than text, so the
            // contrast rule no longer applies to it and the affordance stops
            // depending on a colour value at all.
            h('span', { class: 'icon', 'aria-hidden': 'true' }, Icon('search', { size: 15 })),
            h('input', { type: 'search', name: 'q', placeholder: search, 'aria-label': `search ${search}` })
        ) : null),
        h('nav', { 'aria-label': 'main navigation' }, ...items.map(([label, href]) => {
            const cleanLabel = String(label).replace(' ->', '');
            return h('a', {
                key: label,
                href,
                class: active === cleanLabel ? 'active' : '',
                'aria-current': active === cleanLabel ? 'page' : null,
                // The visible label keeps its ' ->' ASCII arrow (sanctioned
                // per AGENTS.md's icon policy), but a screen reader spelling
                // that out literally ("source dash greater-than") is noise --
                // aria-label gives the same cleaned text the active-state
                // comparison already computes, read once, without the arrow.
                'aria-label': cleanLabel !== String(label) ? cleanLabel : null,
                onclick: (e) => {
                    if (!String(href).startsWith('http') && onNav) {
                        e.preventDefault();
                        onNav(cleanLabel);
                        // preventDefault above blocks the browser's own
                        // anchor-jump, so a #-target must be scrolled to
                        // manually or the click looks purely decorative.
                        if (String(href).startsWith('#')) {
                            const target = document.getElementById(href.slice(1));
                            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    }
                }
            }, label);
        })),
        themeToggle ? h('div', { class: 'app-topbar-theme' }, ThemeToggle({ compact: true })) : null
    );
}

export function Crumb({ trail = [], leaf = '', right } = {}) {
    const parts = [];
    trail.forEach((t, i) => {
        parts.push(h('span', { key: 't' + i }, t));
        parts.push(h('span', { key: 's' + i, class: 'sep' }, '/'));
    });
    parts.push(h('span', { key: 'leaf', class: 'leaf' }, leaf));
    if (right) parts.push(h('span', { key: 'r', class: 'crumb-right' }, ...(Array.isArray(right) ? right : [right])));
    return h('div', { class: 'app-crumb' }, ...parts);
}

// ArrowUp/ArrowDown/Home/End move focus between sidebar links without
// altering tabindex -- every link stays naturally Tab-reachable (a plain
// link list, not a role=tablist), arrows are a same-list quick-nav shortcut
// layered on top, mirroring the roving-nav affordance Tabs already has
// (editor-primitives.js) but without roving-tabindex's activate-on-move
// semantics, since a nav link's "activation" is a real navigation the user
// should still choose deliberately with Enter/click.
function onSideLinkKeyDown(e) {
    let dir = 0;
    if (e.key === 'ArrowDown') dir = 1;
    else if (e.key === 'ArrowUp') dir = -1;
    else if (e.key === 'Home' || e.key === 'End') dir = e.key === 'Home' ? 'first' : 'last';
    else return;
    const side = e.currentTarget.closest('.app-side');
    if (!side) return;
    const links = Array.from(side.querySelectorAll('a'));
    const curIdx = links.indexOf(e.currentTarget);
    if (curIdx === -1) return;
    e.preventDefault();
    let nextIdx;
    if (dir === 'first') nextIdx = 0;
    else if (dir === 'last') nextIdx = links.length - 1;
    else nextIdx = (curIdx + dir + links.length) % links.length;
    const next = links[nextIdx];
    if (next) next.focus();
}

export function Side({ sections = [] } = {}) {
    return h('aside', { class: 'app-side', role: 'navigation', 'aria-label': 'sidebar navigation' }, ...sections.map(sec => {
        const groupId = 'side-group-' + String(sec.group).replace(/\W+/g, '-').toLowerCase();
        // Each section is a group labelled by its heading, so AT users hear the
        // heading as the group name instead of an orphan heading.
        return h('div', { class: 'app-side-group', key: sec.group, role: 'group', 'aria-labelledby': groupId },
            h('h2', { class: 'group', id: groupId }, sec.group),
            ...sec.items.map((item, i) => {
                const { glyph, label, href, active, count, color, onClick, ariaLabel } = item;
                const countLabel = (count != null && count !== 0 && count !== '0') ? ` (${count})` : '';
                // An item with neither href nor onClick is not a control, and
                // must not look like one. href used to default to '#', so a
                // forgotten destination silently produced a pointer-cursor,
                // tab-stoppable anchor that navigated nowhere — which is why
                // dead sidebar rows kept reappearing in new kits: the dead
                // affordance was the DEFAULT. Such an item keeps the <a> (every
                // .app-side row rule is anchor-scoped, so a different element
                // would lose the whole grid layout) but drops href entirely: an
                // anchor with no href is not a link, takes no tab stop, and is
                // styled inert by .app-side a:not([href]) in topbar.css.
                // An onClick with no href IS a real control and still gets
                // href='#' so it stays keyboard-activatable.
                const isControl = href != null || onClick != null;
                // href is spread in only when this row is a control. Setting it
                // to null instead would NOT omit the attribute — webjsx passes a
                // null straight to updatePropOrAttr, which stringifies it, and
                // the row renders href="null": still a link, still tab-stopped,
                // still pointer-cursored. The key has to be absent.
                return h('a', {
                    key: sec.group + i,
                    ...(isControl ? { href: href != null ? href : '#' } : {}),
                    class: active ? 'active' : '',
                    'aria-current': active ? 'page' : null,
                    // ariaLabel lets a caller pass the untruncated source string
                    // as the accessible name when `label` itself is a shortened
                    // display string (e.g. a preset prompt cut to fit the row) —
                    // otherwise screen-reader users lose the exact same
                    // distinguishing text sighted users lose to the ellipsis.
                    'aria-label': (ariaLabel != null ? ariaLabel : label) + countLabel,
                    onclick: onClick,
                    onkeydown: isControl ? onSideLinkKeyDown : null
                },
                    glyph != null ? Glyph({ children: glyph, color }) : h('span', { class: 'glyph', 'aria-hidden': 'true' }),
                    h('span', {}, label),
                    (count != null && count !== 0 && count !== '0') ? h('span', { class: 'count', 'aria-hidden': 'true' }, String(count)) : null
                );
            })
        );
    }));
}

// Collapse state persists per-origin so the choice survives navigation
// between kit pages (the status bar is chrome, not per-page content).
const STATUS_COLLAPSE_KEY = 'ds-status-collapsed';
function isStatusCollapsed() {
    try { return localStorage.getItem(STATUS_COLLAPSE_KEY) === '1'; } catch (_) { return false; }
}
function toggleStatusCollapsed(fromEl) {
    const app = fromEl && fromEl.closest && fromEl.closest('.app');
    const bar = app && app.querySelector('.app-status');
    if (!bar) return;
    const next = !bar.classList.contains('is-collapsed');
    bar.classList.toggle('is-collapsed', next);
    const btn = bar.querySelector('.app-status-toggle');
    if (btn) btn.setAttribute('aria-expanded', next ? 'false' : 'true');
    // .app-main's bottom padding mirrors the bar's real height via this var
    // (set on .app, read by .app-main's padding-bottom) so collapsing frees
    // the reserved clearance instead of leaving a dead gap.
    if (app) app.style.setProperty('--app-status-h-live', next ? 'var(--space-4)' : 'var(--app-status-h)');
    try { localStorage.setItem(STATUS_COLLAPSE_KEY, next ? '1' : '0'); } catch (_) { /* private mode: state just won't persist */ }
}

export function Status({ left = [], right = [] } = {}) {
    const collapsed = isStatusCollapsed();
    // Sync .app-main's reserved clearance to the persisted collapse state on
    // first render, matching what toggleStatusCollapsed sets on click -- the
    // ref runs on mount, before paint, so there's no expanded-then-collapse flash.
    const syncLiveVar = (el) => {
        if (!el) return;
        const app = el.closest('.app');
        if (app) app.style.setProperty('--app-status-h-live', collapsed ? 'var(--space-4)' : 'var(--app-status-h)');
    };
    return h('footer', { class: 'app-status' + (collapsed ? ' is-collapsed' : ''), role: 'contentinfo', ref: syncLiveVar },
        h('button', {
            class: 'app-status-toggle', type: 'button',
            'aria-label': 'toggle status bar', 'aria-expanded': collapsed ? 'false' : 'true',
            onclick: (e) => toggleStatusCollapsed(e.currentTarget),
        }, Icon(collapsed ? 'chevron-up' : 'chevron-down', { size: 12 })),
        ...left.map((t, i) => h('span', { key: 'l' + i, class: 'item' }, t)),
        h('span', { key: 'spread', class: 'spread', 'aria-hidden': 'true' }),
        ...right.map((t, i) => h('span', { key: 'r' + i, class: 'item' }, t))
    );
}

// Toggle the sidebar drawer. Pure-DOM because AppShell is stateless chrome; the
// class lives on .app-body and is read by the @container(max-width:900px) query.
// `fromEl` scopes the toggle to the shell that owns the clicked control — without
// it, document.querySelector grabs the FIRST .app-body on the page, so a second
// dashboard instance (multiple thebird WM windows) would toggle the wrong drawer.
function toggleSide(open, fromEl) {
    const shell = (fromEl && fromEl.closest && fromEl.closest('.app')) || document;
    const body = shell.querySelector('.app-body');
    if (!body) return;
    const next = open != null ? open : !body.classList.contains('side-open');
    body.classList.toggle('side-open', next);
    const btn = shell.querySelector('.app-side-toggle');
    if (btn) btn.setAttribute('aria-expanded', next ? 'true' : 'false');
    // Keyboard parity with toggleWsDrawer: Esc dismisses the drawer and Tab is
    // trapped inside it while it overlays the content behind the scrim.
    if (body._dsSideKey) { document.removeEventListener('keydown', body._dsSideKey); body._dsSideKey = null; }
    if (next) {
        const drawer = shell.querySelector('.app-side-shell');
        const focusable = drawer && drawer.querySelector('button, a, input, [tabindex]');
        if (focusable) try { focusable.focus(); } catch (_) { /* swallow: focus() can throw on a detached/hidden element, drawer still opens */ }
        const onKey = (e) => {
            if (e.key === 'Escape') { toggleSide(false, btn || body); if (btn) try { btn.focus(); } catch (_) { /* swallow: focus() can throw on a detached/hidden element */ } return; }
            if (drawer) trapTab(drawer, e);
        };
        body._dsSideKey = onKey;
        document.addEventListener('keydown', onKey);
    }
}

// Ref on the .app root: re-sync the toggle's aria-expanded from the live
// .side-open class (applyDiff re-renders reset the attribute to 'false'), and
// arm a ResizeObserver that closes a stuck-open drawer when the shell grows
// past the 900px container breakpoint (the drawer CSS stops applying there,
// but the class would otherwise persist and reappear on the next shrink).
function syncAppSide(el) {
    if (!el) return;
    const body = el.querySelector('.app-body');
    const btn = el.querySelector('.app-side-toggle');
    if (btn && body) btn.setAttribute('aria-expanded', body.classList.contains('side-open') ? 'true' : 'false');
    if (!el._dsSideRO && typeof ResizeObserver !== 'undefined') {
        el._dsSideRO = new ResizeObserver((entries) => {
            const w = entries[0] && entries[0].contentRect.width;
            const b = el.querySelector('.app-body');
            if (w > 900 && b && b.classList.contains('side-open')) toggleSide(false, el);
        });
        el._dsSideRO.observe(el);
    }
}

export function AppShell({ topbar, crumb, side, main, status, narrow } = {}) {
    const hasSide = Boolean(side);
    const sideNode = hasSide ? side : h('aside', { class: 'app-side', 'aria-hidden': 'true' });
    // Topbar and crumb used to stack as two separate chrome bars — a "double
    // title bar". When both are present, fold them into one sticky row:
    // brand + nav (topbar) and breadcrumb + right slot (crumb) share a single
    // band so the chrome reads as one bar, not two. Either prop alone still
    // renders on its own (consumers that pass only a topbar are unaffected).
    // Landmark wrapper: topbar/crumb are opaque children with no semantics of
    // their own, so screen-reader users landmark-navigating a page saw no
    // "banner"/"navigation" region at all above <main>. <header role="banner">
    // names the brand+nav band; the app-side-shell aside below already exists
    // as a real <aside>, so this closes the missing landmark for the top band.
    const chrome = (topbar && crumb)
        ? h('header', { class: 'app-chrome', role: 'banner' }, topbar, crumb)
        : (topbar || crumb) ? h('header', { class: 'app-chrome', role: 'banner' }, topbar || crumb) : null;
    return h('div', { class: 'app', ref: syncAppSide },
        h('a', { href: '#app-main', class: 'skip-link' }, 'skip to main content'),
        hasSide ? h('button', {
            class: 'app-side-toggle', type: 'button',
            'aria-label': 'toggle navigation', 'aria-expanded': 'false', 'aria-controls': 'app-side-shell',
            onclick: (e) => toggleSide(null, e.currentTarget),
        }, Icon('menu')) : null,
        chrome,
        h('div', { class: 'app-body' + (hasSide ? '' : ' no-side') },
            h('div', { class: 'app-side-scrim', 'aria-hidden': 'true', onclick: (e) => toggleSide(false, e.currentTarget) }),
            h('div', { class: 'app-side-shell', id: 'app-side-shell', onclick: (e) => { if (e.target.closest('a')) toggleSide(false, e.currentTarget); } }, sideNode),
            // tabindex=0 (not -1): .app-main is a scroll container
            // (overflow:auto), so it must be reachable by Tab for a
            // keyboard-only user to scroll it with the arrow keys at all —
            // tabindex=-1 made it focusable only programmatically, which
            // satisfied the skip-link but left the region unscrollable
            // without a pointer. 0 keeps the skip-link target working AND
            // puts the region in the tab order. <main> is a landmark, so it
            // is already named for assistive tech without an aria-label.
            h('main', { class: 'app-main' + (narrow ? ' narrow' : ''), id: 'app-main', tabindex: '0' }, ...(Array.isArray(main) ? main : [main]))
        ),
        status || null
    );
}
