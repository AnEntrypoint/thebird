// ContextTreemap — squarified-treemap SVG layout for a token/cost breakdown,
// nested rectangles sized by value. Raw SVG, no charting library — the only
// reusable precedent in this kit is charts.js's Sparkline, which maps values
// to a single polyline (no area-layout code to build on), so the squarified
// algorithm here is self-contained. Token-stroke/fill only, same convention
// as Sparkline/BarChart in content/charts.js.

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

// squarify(items, x, y, w, h) -> [{ item, x, y, w, h }]
// Classic squarified treemap (Bruls/Huizing/Wijk): lays out `items` (each
// with a numeric `.value`) into the x/y/w/h rect, recursively slicing off
// rows that keep aspect ratios closest to 1.
function worstRatio(row, len, totalArea) {
    const sum = row.reduce((s, v) => s + v, 0);
    if (sum === 0) return Infinity;
    const rowLenSq = len * len, sumSq = sum * sum;
    let worst = 0;
    for (const v of row) {
        const r = Math.max((rowLenSq * v) / sumSq, sumSq / (rowLenSq * v));
        if (r > worst) worst = r;
    }
    return worst;
}

export function squarify(items, x, y, w, h) {
    const values = items.map((it) => Math.max(0, Number(it.value) || 0));
    const total = values.reduce((s, v) => s + v, 0);
    if (!items.length || total <= 0) return [];
    const scale = (w * h) / total;
    const scaled = values.map((v) => v * scale);
    const out = [];
    let idx = 0, rx = x, ry = y, rw = w, rh = h;
    while (idx < items.length) {
        const horizontal = rw >= rh;
        const len = horizontal ? rh : rw;
        let row = [scaled[idx]], rowItems = [idx];
        let i = idx + 1;
        while (i < scaled.length) {
            const trial = [...row, scaled[i]];
            if (worstRatio(trial, len, 0) <= worstRatio(row, len, 0)) { row = trial; rowItems.push(i); i++; }
            else break;
        }
        const rowSum = row.reduce((s, v) => s + v, 0);
        const thickness = len > 0 ? rowSum / len : 0;
        let cursor = horizontal ? ry : rx;
        rowItems.forEach((itemIdx, k) => {
            const size = len > 0 ? row[k] / thickness : 0;
            const rect = horizontal
                ? { x: rx, y: cursor, w: thickness, h: size }
                : { x: cursor, y: ry, w: size, h: thickness };
            out.push({ item: items[itemIdx], ...rect });
            cursor += size;
        });
        if (horizontal) { rx += thickness; rw -= thickness; }
        else { ry += thickness; rh -= thickness; }
        idx = i;
    }
    return out;
}

// ContextTreemap({ items, width=280, height=160 })
//   items: [{ id, label, value, tone }] — tone is a semantic class suffix,
//   same vocabulary as ContextMeter's segment tone.
export function ContextTreemap({ items = [], width = 280, height = 160 } = {}) {
    const rects = squarify(items, 0, 0, width, height);
    if (!rects.length) return h('div', { class: 'ds-context-treemap-empty' }, 'no breakdown yet');
    return h('svg', {
        class: 'ds-context-treemap', viewBox: `0 0 ${width} ${height}`, width, height,
        role: 'img', 'aria-label': 'context breakdown treemap',
    },
        ...rects.map((r, i) => h('g', { key: r.item.id || i },
            h('rect', {
                x: r.x.toFixed(1), y: r.y.toFixed(1), width: Math.max(0, r.w - 1).toFixed(1), height: Math.max(0, r.h - 1).toFixed(1),
                class: 'ds-context-treemap-rect ds-context-treemap-rect-' + (r.item.tone || 'other'),
            }),
            r.w > 40 && r.h > 18
                ? h('text', { x: (r.x + 4).toFixed(1), y: (r.y + 14).toFixed(1), class: 'ds-context-treemap-label' }, r.item.label)
                : h('title', {}, `${r.item.label}: ${r.item.value}`))));
}
