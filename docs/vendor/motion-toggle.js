// 247420 design system — motion preference controller. Mirrors theme.js's
// applyX/getX + localStorage-persistence + browser-guard pattern.
//
// src/motion.js already gates every entry animation behind the OS-level
// @media (prefers-reduced-motion: no-preference) query -- a user whose OS
// default is "no preference" (the common default) has no way to opt OUT of
// motion without changing a system-wide OS setting. This adds a real
// in-app override: [data-motion="reduced"] on <html> disables/shortens
// transitions identically to the OS media query, independent of the OS
// setting.

const KEY = '247420:motion';
const VALID = new Set(['auto', 'reduced']);
const listeners = new Set();
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
    try { window.localStorage.setItem(KEY, mode); } catch { /* swallow: persistence is best-effort, motion preference still applies in-memory */ }
}

function writeAttr(mode) {
    if (!isBrowser()) return;
    if (mode === 'reduced') document.documentElement.setAttribute('data-motion', 'reduced');
    else document.documentElement.removeAttribute('data-motion');
}

export function applyMotion(mode) {
    if (!VALID.has(mode)) mode = 'auto';
    _current = mode;
    writeAttr(mode);
    writeStored(mode);
    for (const cb of listeners) {
        try { cb({ mode }); } catch { /* swallow: a listener's error must not block notifying the rest */ }
    }
    return mode;
}

export function getMotion() {
    return _current;
}

// True when motion is actually suppressed right now -- either the user's
// explicit override is 'reduced', OR (mode is 'auto' AND the OS itself
// prefers reduced motion). Consumers that gate a JS-driven animation (not
// just CSS transitions, which the [data-motion=reduced] selector already
// handles) should check this before running anything non-essential.
export function isMotionReduced() {
    if (_current === 'reduced') return true;
    if (_current !== 'auto') return false;
    if (!isBrowser() || !window.matchMedia) return false;
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function onMotionChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

// Auto-init on browser import. Picks stored value, else 'auto' (OS-driven).
export function initMotion() {
    if (!isBrowser()) return 'auto';
    const stored = readStored();
    applyMotion(stored || 'auto');
    return _current;
}

if (isBrowser()) initMotion();
