// 247420 design system — theme controller.
//
// Theme modes (data-theme):
//   'auto'    — follow OS (prefers-color-scheme). Live-updates on OS change.
//   'paper'   — force light.
//   'ink'     — force dark.
//   'thebird' — warm-paper brand preset (named theme).
// Accents (data-accent): 'green' | 'purple' | 'mascot'.
// Density (data-density): 'compact' | 'comfortable' | 'spacious'.
//
// Each is one attribute on <html> the canonical theme (colors_and_type.css)
// reads. Adding a theme = one [data-theme="X"] block in colors_and_type.css
// plus its name in THEMES below. Persists to localStorage; auto-inits on
// browser import; safe no-op on server.

const KEY = '247420:theme';
const ACCENT_KEY = '247420:accent';
const DENSITY_KEY = '247420:density';
const LOCALE_KEY = '247420:locale';
// 'auto' is a mode, not a [data-theme] preset block — it stays in VALID for the
// controller but is the OS-follow path. The named presets are the rest.
const VALID = new Set(['auto', 'paper', 'ink', 'thebird', 'github-dark']);
const VALID_ACCENT = new Set(['green', 'purple', 'mascot']);
const VALID_DENSITY = new Set(['compact', 'comfortable', 'spacious']);
const listeners = new Set();
let _mq = null;
let _current = 'auto';

function isBrowser() {
    return typeof document !== 'undefined' && typeof window !== 'undefined';
}

function readStored() {
    try {
        const v = window.localStorage.getItem(KEY);
        return VALID.has(v) ? v : null;
    } catch { return null; }
}

function writeStored(mode) {
    try { window.localStorage.setItem(KEY, mode); } catch { /* swallow: persistence is best-effort, theme still applies in-memory */ }
}

function writeAttr(mode) {
    if (!isBrowser()) return;
    // data-theme must live on the same element carrying the .ds-247420 scope
    // class (<html>, per every shipped page template) -- the bundled CSS
    // selectors are `.ds-247420[data-theme="ink"]`, which cannot match if
    // the attribute sits on <body> instead of <html>.
    document.documentElement.setAttribute('data-theme', mode);
}

function ensureMq() {
    if (_mq || !isBrowser() || !window.matchMedia) return;
    _mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
        if (_current === 'auto') {
            // Re-emit so listeners can re-render derived UI even though
            // data-theme stays "auto" — the CSS @media handles the swap.
            for (const cb of listeners) {
                try { cb({ mode: 'auto', resolved: _mq.matches ? 'ink' : 'paper' }); } catch { /* swallow: a listener's error must not block notifying the rest */ }
            }
        }
    };
    if (_mq.addEventListener) _mq.addEventListener('change', onChange);
    else if (_mq.addListener) _mq.addListener(onChange);
}

export function applyTheme(mode) {
    if (!VALID.has(mode)) mode = 'auto';
    _current = mode;
    writeAttr(mode);
    writeStored(mode);
    ensureMq();
    const resolved = mode === 'auto'
        ? (_mq && _mq.matches ? 'ink' : 'paper')
        : mode;
    for (const cb of listeners) {
        try { cb({ mode, resolved }); } catch { /* swallow: a listener's error must not block notifying the rest */ }
    }
    return mode;
}

export function getTheme() {
    return _current;
}

export function resolvedTheme() {
    if (_current !== 'auto') return _current;
    ensureMq();
    return _mq && _mq.matches ? 'ink' : 'paper';
}

export function onThemeChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

// ---- Accent + density: independent attribute controllers ----

function readStoredKey(key, valid) {
    try { const v = window.localStorage.getItem(key); return valid.has(v) ? v : null; } catch { return null; }
}

export function applyAccent(accent) {
    if (!isBrowser()) return accent;
    if (VALID_ACCENT.has(accent)) {
        document.documentElement.setAttribute('data-accent', accent);
        try { window.localStorage.setItem(ACCENT_KEY, accent); } catch { /* swallow: persistence is best-effort, accent still applies in-memory */ }
    } else {
        // No accent attribute = the theme's default accent (green).
        document.documentElement.removeAttribute('data-accent');
        try { window.localStorage.removeItem(ACCENT_KEY); } catch { /* swallow: persistence is best-effort, accent still applies in-memory */ }
    }
    return accent;
}

export function getAccent() {
    if (!isBrowser()) return null;
    return document.documentElement.getAttribute('data-accent');
}

export function applyDensity(density) {
    if (!isBrowser()) return density;
    if (VALID_DENSITY.has(density)) {
        document.documentElement.setAttribute('data-density', density);
        try { window.localStorage.setItem(DENSITY_KEY, density); } catch { /* swallow: persistence is best-effort, density still applies in-memory */ }
    }
    return density;
}

export function getDensity() {
    if (!isBrowser()) return null;
    return document.documentElement.getAttribute('data-density');
}

// ---- Direction: derived from an active locale, not user-toggled ----
//
// Unlike theme/accent/density (explicit user picks), direction is DERIVED
// from whichever locale the consumer's i18n catalog has active — mirrors the
// data-theme pattern (one attribute the CSS reads) but the input is a BCP-47
// locale tag, not a direct rtl/ltr choice. Intl.Locale(locale).textInfo is
// the real platform primitive for this (no manual RTL-language list to
// maintain). Falls back to 'ltr' for a locale the runtime can't resolve
// (unknown tag, or a runtime without Intl.Locale.textInfo support).
export function applyDirection(locale) {
    if (!isBrowser()) return 'ltr';
    let dir = 'ltr';
    try {
        const info = new Intl.Locale(locale).textInfo;
        if (info && (info.direction === 'rtl' || info.direction === 'ltr')) dir = info.direction;
    } catch { /* swallow: unresolvable locale tag or no Intl.Locale.textInfo support — default ltr already set */ }
    document.documentElement.setAttribute('dir', dir);
    try { window.localStorage.setItem(LOCALE_KEY, locale); } catch { /* swallow: persistence is best-effort, direction still applies in-memory */ }
    return dir;
}

export function getDirection() {
    if (!isBrowser()) return 'ltr';
    return document.documentElement.getAttribute('dir') || 'ltr';
}

// Restores the last-applied locale's direction on boot (no-op if none
// stored — leaves whatever dir the page was authored/SSR'd with).
export function initDirection() {
    if (!isBrowser()) return 'ltr';
    let stored = null;
    try { stored = window.localStorage.getItem(LOCALE_KEY); } catch { /* swallow: no stored locale, use SSR/authored dir as-is */ }
    if (stored) return applyDirection(stored);
    return getDirection();
}

export function initTheme() {
    if (!isBrowser()) return 'auto';
    const stored = readStored();
    const fromAttr = document.documentElement.getAttribute('data-theme');
    const initial = stored || (VALID.has(fromAttr) ? fromAttr : 'auto');
    applyTheme(initial);
    // Restore persisted accent/density (no-op if none stored — keeps the
    // theme's default accent and the page's authored density).
    const accent = readStoredKey(ACCENT_KEY, VALID_ACCENT);
    if (accent) applyAccent(accent);
    const density = readStoredKey(DENSITY_KEY, VALID_DENSITY);
    if (density) applyDensity(density);
    return initial;
}

if (isBrowser()) {
    // Run on next microtask so SSR-injected attributes settle first.
    Promise.resolve().then(() => {
        try { initTheme(); } catch { /* swallow: deferred init is a progressive enhancement, page already rendered without it */ }
        try { initDirection(); } catch { /* swallow: deferred init is a progressive enhancement, page already rendered without it */ }
    });
}
