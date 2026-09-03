// Avatar — generic identity disc: an image when `src` resolves, else a
// letter fallback derived from `name`/`fallback`. Kit previously only had
// scoped one-offs (chat.js `.chat-avatar`, community.js `.cm-user-avatar`)
// duplicating this same letter-fallback logic; this is the reusable version.

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

// avatarInitial — the single shared letter-fallback computation behind
// Avatar and every custom-colored avatar wrapper (community.js's voice/user/
// member rows use their own `--avatar-bg` CSS-variable styling and can't
// drop in the Avatar element directly, but still want the SAME fallback
// text, not their own independently-drifting .slice(0,n).toUpperCase()).
// Empty-guards to '?' identically everywhere it's used.
export function avatarInitial(name, count = 1) {
    return name ? String(name).trim().slice(0, count).toUpperCase() || '?' : '?';
}

// avatarContrastFg — picks black or white text against an arbitrary
// per-user hashed --avatar-bg color, via WCAG relative luminance, so
// initials clear 4.5:1 regardless of which hue the hash lands on (a
// single fixed --fg-2 token can't: some hashed hues are light enough
// that dark-on-dark or light-on-light both existed in the wild).
// Returns null for an unparsable color so callers can omit the
// inline style entirely and fall back to the CSS default.
export function avatarContrastFg(color) {
    if (!color) return null;
    let r, g, b;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
    if (hex) {
        let h = hex[1];
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
    } else {
        const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(String(color).trim());
        if (!rgb) return null;
        r = +rgb[1]; g = +rgb[2]; b = +rgb[3];
    }
    const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    // Contrast against pure black/white; pick whichever side clears more
    // headroom (both landing >=4.5:1 is common, but some hues only clear
    // one side, so max-headroom is the right tiebreak, not a 0.5 cutoff).
    const contrastWhite = 1.05 / (L + 0.05);
    const contrastBlack = (L + 0.05) / 0.05;
    return contrastWhite >= contrastBlack ? '#fff' : '#000';
}

// Avatar — the single letter-fallback/image avatar primitive. `initialsCount`
// (default 1) controls how many leading characters of `name` become the
// fallback letters when no `src`/`fallback` is given (community.js's
// pill-shaped ServerIcon wants 2); `shape` ('circle' default, or 'square')
// covers non-circular consumers without each hand-rolling its own
// .slice(0,n).toUpperCase() (previously duplicated across 5+ call sites in
// community.js and chat.js with drifting char-counts/empty-guards).
export function Avatar({ name, src, fallback, size = 'md', shape = 'circle', initialsCount = 1, key } = {}) {
    const letter = fallback != null ? fallback : avatarInitial(name, initialsCount);
    const cls = 'ds-avatar ds-avatar-' + size + (shape === 'square' ? ' ds-avatar-square' : '');
    if (src) return h('img', { key, class: cls, src, alt: name || '', loading: 'lazy' });
    return h('span', { key, class: cls, 'aria-hidden': !!name, role: name ? 'img' : undefined, 'aria-label': name || undefined }, letter);
}
