// Keyboard shortcuts: combo parsing/matching (platform-aware Mod = Cmd on mac,
// Ctrl elsewhere), the binding registrar that also feeds a global registry, and
// the three display surfaces — ShortcutHint, ShortcutList, ShortcutHelpDialog.

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

const IS_MAC = (typeof navigator !== 'undefined') && /Mac|iPhone|iPad/.test(navigator.platform || '');
const SHORTCUT_REGISTRY = new Set();

function parseCombo(combo) {
    const parts = combo.split('+').map(s => s.trim());
    const key = parts.pop();
    const mods = new Set(parts.map(s => s.toLowerCase()));
    return { key: key.length === 1 ? key.toLowerCase() : key, mod: mods.has('mod'), shift: mods.has('shift'), alt: mods.has('alt'), ctrl: mods.has('ctrl') };
}
function matchEvent(e, spec) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k !== spec.key) return false;
    const modOk = spec.mod ? (IS_MAC ? e.metaKey : e.ctrlKey) : true;
    if (!modOk) return false;
    if (spec.shift !== !!e.shiftKey) return false;
    if (spec.alt !== !!e.altKey) return false;
    if (spec.ctrl && !e.ctrlKey) return false;
    return true;
}

export function formatShortcut(combo) {
    const s = parseCombo(combo);
    const mod = s.mod ? (IS_MAC ? 'Cmd+' : 'Ctrl+') : '';
    const shift = s.shift ? 'Shift+' : '';
    const alt = s.alt ? 'Alt+' : '';
    const key = s.key.length === 1 ? s.key.toUpperCase() : s.key;
    return mod + alt + shift + key;
}

export function useKeyboardShortcut(map = {}, { scope = 'global', enabled = true } = {}) {
    if (!enabled) return { destroy() {}, trigger() {} };
    const target = scope === 'global' ? (typeof document !== 'undefined' ? document : null) : scope;
    if (!target) return { destroy() {}, trigger() {} };
    const specs = Object.entries(map).map(([combo, fn]) => ({ combo, spec: parseCombo(combo), fn }));
    specs.forEach(s => SHORTCUT_REGISTRY.add({ combo: s.combo, scope: scope === 'global' ? 'global' : 'local' }));
    const onKey = (e) => {
        for (const s of specs) if (matchEvent(e, s.spec)) { e.preventDefault(); s.fn(e); return; }
    };
    target.addEventListener('keydown', onKey);
    return {
        destroy() { target.removeEventListener('keydown', onKey); },
        trigger(combo) { const s = specs.find(x => x.combo === combo); if (s) s.fn(); },
    };
}

export function ShortcutHint({ combo, kind = 'kbd' } = {}) { return h('kbd', { class: 'ds-kbd ds-kbd-' + kind }, formatShortcut(combo || '')); }

function shortcutCaps(keys) {
    const caps = [];
    let n = 0;
    const alts = String(keys || '').split(' / ');
    alts.forEach((alt, ai) => {
        if (ai > 0) caps.push(h('span', { key: 'sep-alt-' + (n++), class: 'ds-kbd-sep' }, ' / '));
        const steps = alt.split(' then ');
        steps.forEach((step, si) => {
            if (si > 0) caps.push(h('span', { key: 'sep-then-' + (n++), class: 'ds-kbd-sep' }, ' then '));
            caps.push(h('kbd', { key: 'cap-' + (n++), class: 'ds-kbd' }, step));
        });
    });
    return caps;
}

export function ShortcutList({ shortcuts = [] } = {}) {
    return h('div', { class: 'ds-shortcuts-hint' },
        ...shortcuts.map(s => h('div', { class: 'ds-shortcut-row' },
            h('span', { class: 'ds-kbd-caps' }, ...shortcutCaps(s.keys || s.combo || '')),
            h('span', { class: 'ds-kbd-label' }, s.desc || s.description || s.label || ''))));
}

export function useKeyboardShortcutHelp() { return { registry: Array.from(SHORTCUT_REGISTRY) }; }
export function ShortcutHelpDialog({ open = false, onClose, registry } = {}) {
    if (!open) return null;
    const list = registry || Array.from(SHORTCUT_REGISTRY);
    const groups = {};
    list.forEach(r => { (groups[r.scope] = groups[r.scope] || []).push(r); });
    // Escape-to-close, Tab focus trap, and autofocus on open — wired through a
    // ref so teardown runs on the webjsx ref(null) unmount branch.
    const dialogRef = (el) => {
        if (!el) { if (ShortcutHelpDialog._teardown) { ShortcutHelpDialog._teardown(); ShortcutHelpDialog._teardown = null; } return; }
        const focusables = () => el.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); if (onClose) onClose(); return; }
            if (e.key === 'Tab') {
                const f = focusables();
                if (!f.length) { e.preventDefault(); return; }
                const first = f[0], last = f[f.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        };
        el.addEventListener('keydown', onKey);
        ShortcutHelpDialog._teardown = () => el.removeEventListener('keydown', onKey);
        // The dialog itself is focusable (tabindex=-1) so it always has a home
        // for focus even when it contains no interactive controls.
        const f = focusables();
        (f[0] || el).focus();
    };
    return h('div', { class: 'ds-ep-dialog-backdrop', onmousedown: (e) => { if (e.target === e.currentTarget && onClose) onClose(); } },
        h('div', { class: 'ds-ep-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts', tabindex: '-1', ref: dialogRef },
            h('h2', null, 'Keyboard shortcuts'),
            ...Object.entries(groups).map(([scope, rows]) =>
                h('section', { class: 'ds-kbd-group' },
                    h('h3', null, scope),
                    h('ul', null, ...rows.map(r => h('li', { class: 'ds-kbd-row' },
                        h(ShortcutHint, { combo: r.combo }),
                        (r.label || r.description) ? h('span', { class: 'ds-kbd-label' }, r.label || r.description) : null
                    )))
                )
            )
        )
    );
}
