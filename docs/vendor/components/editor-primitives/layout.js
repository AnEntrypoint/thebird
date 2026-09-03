// Layout primitives — the static structural shapes an editor lays its panes
// out with: Dock (five-region frame), the BP_* breakpoint scale +
// useMediaQuery, Grid/GridItem (24-column responsive layout) and Divider.
// Interactive resizing lives in ./split-panel.js; progressive disclosure in
// ./collapse.js.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { kids } from './shared.js';
const h = webjsx.createElement;

export function Dock({ top, left, right, bottom, center } = {}) {
    return h('div', { class: 'ds-ep-dock' },
        top    != null ? h('div', { class: 'ds-ep-dock-top' },    ...kids(top))    : null,
        left   != null ? h('div', { class: 'ds-ep-dock-left' },   ...kids(left))   : null,
        h('div', { class: 'ds-ep-dock-center' }, ...kids(center)),
        right  != null ? h('div', { class: 'ds-ep-dock-right' },  ...kids(right))  : null,
        bottom != null ? h('div', { class: 'ds-ep-dock-bottom' }, ...kids(bottom)) : null
    );
}

// ---------------------------------------------------------------------------
// Breakpoints + useMediaQuery
// ---------------------------------------------------------------------------
export const BP_SM = 480;
export const BP_MD = 768;
export const BP_LG = 1024;
export const BP_XL = 1440;

export function useMediaQuery(query) {
    if (typeof window === 'undefined' || !window.matchMedia) {
        return { matches: false, addListener: () => {}, removeListener: () => {} };
    }
    const mql = window.matchMedia(query);
    return {
        get matches() { return mql.matches; },
        addListener(fn) { mql.addEventListener ? mql.addEventListener('change', fn) : mql.addListener(fn); },
        removeListener(fn) { mql.removeEventListener ? mql.removeEventListener('change', fn) : mql.removeListener(fn); },
    };
}

// ---------------------------------------------------------------------------
// Grid / GridItem — 24-column responsive layout primitive (screen-real-estate
// density: dense multi-column panels without a hand-rolled grid-template-
// columns per consumer). Column-span props are integers 1-24 (or `true` for
// full-width/auto-grow, or `0` to hide at that breakpoint) evaluated at four
// tiers mirroring BP_SM/MD/LG/XL (480/768/1024/1440) via media queries in
// editor-primitives.css — no JS-side matchMedia needed, CSS custom
// properties + @media do the layout work so it degrades gracefully with
// SSR/no-hydration. Grid itself is a flex row wrapper; GridItem computes
// flex-basis/max-width from its span at each tier.
// ---------------------------------------------------------------------------
export function Grid({ gap, justify, align, children, key } = {}) {
    const style = [
        gap != null ? `gap:${typeof gap === 'number' ? gap + 'px' : gap}` : '',
        justify ? `justify-content:${justify}` : '',
        align ? `align-items:${align}` : '',
    ].filter(Boolean).join(';');
    return h('div', { key, class: 'ds-ep-grid', style: style || null }, children);
}

function gridSpanStyle(prefix, val) {
    if (val === undefined) return '';
    if (val === true) return `--${prefix}-basis:100%;--${prefix}-grow:1;--${prefix}-display:inherit;`;
    if (val === 0) return `--${prefix}-display:none;`;
    const pct = Math.max(0, Math.min(100, (100 / 24) * val));
    return `--${prefix}-basis:${pct}%;--${prefix}-grow:0;--${prefix}-display:inherit;`;
}

export function GridItem({ xs, sm, md, lg, xl, children, key } = {}) {
    const style = [
        gridSpanStyle('xs', xs),
        gridSpanStyle('sm', sm),
        gridSpanStyle('md', md),
        gridSpanStyle('lg', lg),
        gridSpanStyle('xl', xl),
    ].join('');
    return h('div', { key, class: 'ds-ep-grid-item', style: style || null }, children);
}

// ---------------------------------------------------------------------------
// Divider — plain rule, optional centered text label, optional vertical
// orientation (for segmenting dense panels without a full Section wrapper).
// ---------------------------------------------------------------------------
export function Divider({ label, vertical = false, key } = {}) {
    if (vertical) return h('span', { key, class: 'ds-ep-divider ds-ep-divider-vertical', role: 'separator', 'aria-orientation': 'vertical' });
    if (!label) return h('hr', { key, class: 'ds-ep-divider' });
    return h('div', { key, class: 'ds-ep-divider ds-ep-divider-labeled', role: 'separator' },
        h('span', { class: 'ds-ep-divider-label' }, label));
}

// ---------------------------------------------------------------------------
// AspectRatio — thin wrapper over the `.ds-aspect` CSS utility (app-shell's
// base.css), matching Divider's own trivial-CSS-only-primitive-still-gets-a-
// factory convention. `ratio` accepts a CSS ratio string ('1/1', '16/9') or
// a number (interpreted as width/height); falls back to the utility's own
// 16/9 default when omitted.
// ---------------------------------------------------------------------------
export function AspectRatio({ ratio, children, key } = {}) {
    const cssRatio = typeof ratio === 'number' ? `${ratio} / 1` : ratio;
    return h('div', { key, class: 'ds-aspect', style: cssRatio ? `--aspect:${cssRatio}` : null }, children);
}
