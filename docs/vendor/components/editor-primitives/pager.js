// ---------------------------------------------------------------------------
// Pager — prev/next paginator with a page label. Generalizes gmsniff's
// gm-pager. page is 1-indexed; pageCount<=1 disables both buttons (no
// divide-by-zero, no dead-end enabled control). total (optional) renders an
// item-count suffix ("42 items") alongside the page label.
//
// numbered=true switches to a compact numbered-button row (screen-real-estate
// dense mode) instead of the prev/next label: always shows first, last, the
// current page, and up to `siblingCount` neighbors either side, collapsing
// gaps into an ellipsis span. Falls back to prev/next automatically when
// pageCount<=1. The prev/next contract (default) is untouched.
// ---------------------------------------------------------------------------

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

function buildPageRange(count, page, siblingCount) {
    const limit = siblingCount * 2 + 3; // first + last + current + siblings
    if (count <= limit) return Array.from({ length: count }, (_, i) => i + 1);
    const pages = new Set([1, count, page]);
    for (let i = 1; i <= siblingCount; i++) {
        pages.add(page - i);
        pages.add(page + i);
    }
    const sorted = [...pages].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
    const result = [];
    let prev = null;
    for (const p of sorted) {
        if (prev !== null && p - prev > 1) result.push('...');
        result.push(p);
        prev = p;
    }
    return result;
}

export function Pager({ page = 1, pageCount = 1, onPage, total, itemLabel = 'items', numbered = false, siblingCount = 1 } = {}) {
    const safeCount = Math.max(1, pageCount || 1);
    const safePage = Math.min(Math.max(1, page || 1), safeCount);
    const atStart = safePage <= 1;
    const atEnd = safePage >= safeCount;
    const prevBtn = h('button', {
        type: 'button', class: 'ds-ep-pager-btn', disabled: atStart ? 'disabled' : null,
        'aria-label': 'previous page',
        onclick: () => { if (!atStart && onPage) onPage(safePage - 1); },
    }, '<-');
    const nextBtn = h('button', {
        type: 'button', class: 'ds-ep-pager-btn', disabled: atEnd ? 'disabled' : null,
        'aria-label': 'next page',
        onclick: () => { if (!atEnd && onPage) onPage(safePage + 1); },
    }, '->');
    if (numbered) {
        const range = buildPageRange(safeCount, safePage, Math.max(1, siblingCount || 1));
        return h('div', { class: 'ds-ep-pager ds-ep-pager-numbered', role: 'group', 'aria-label': 'pagination' },
            prevBtn,
            ...range.map((p, i) => p === '...'
                ? h('span', { key: 'ellipsis-' + i, class: 'ds-ep-pager-ellipsis' }, '...')
                : h('button', {
                    key: 'p' + p, type: 'button',
                    class: 'ds-ep-pager-num' + (p === safePage ? ' is-current' : ''),
                    'aria-current': p === safePage ? 'page' : null,
                    'aria-label': 'page ' + p,
                    onclick: () => { if (p !== safePage && onPage) onPage(p); },
                }, String(p))),
            nextBtn,
            total != null ? h('span', { class: 'ds-ep-pager-total' }, total + ' ' + itemLabel) : null
        );
    }
    return h('div', { class: 'ds-ep-pager', role: 'group', 'aria-label': 'pagination' },
        prevBtn,
        h('span', { class: 'ds-ep-pager-label' },
            'page ' + safePage + ' / ' + safeCount + (total != null ? ' (' + total + ' ' + itemLabel + ')' : '')),
        nextBtn
    );
}
