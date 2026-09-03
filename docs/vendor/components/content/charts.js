// Metric visuals — Kpi (stat cards with optional delta/sparkline footer),
// Sparkline (inline trend line) and BarChart (horizontal breakdown). All
// token-stroke/token-fill only; no raw color literals.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
const h = webjsx.createElement;

// items: [n, label] or [n, label, {delta, tone: 'up'|'down', spark: number[], invert, glyph}]
// meta is optional and additive — every existing 2-tuple call site is untouched.
// `tone` always drives the arrow glyph (it mirrors the delta's own arithmetic
// sign, so the arrow never contradicts the figure beside it). `invert` is a
// separate, optional per-metric flag for "lower is better" metrics (error
// rate, latency, p95, etc.): when set, the good/bad COLOR polarity flips
// relative to tone while the arrow direction is left alone — a rising error
// rate still shows an up-arrow (the number went up) but in the bad/danger
// color, not the good/success color the raw arithmetic sign would imply.
// `meta.glyph` is an optional icon NAME (resolved via Icon()) giving each
// tile a small identifying glyph in its top-right corner — purely additive,
// omitted call sites render exactly as before (no icon slot in the DOM).
export function Kpi({ items = [], emptyText = 'no metrics yet' }) {
    if (!items.length) return h('div', { class: 'empty' }, emptyText);
    return h('div', { class: 'kpi' }, ...items.map(([n, l, meta], i) => {
        const isUp = meta && meta.tone !== 'down';
        const good = meta && meta.invert ? !isUp : isUp;
        // Colour + arrow direction alone is not enough for colorblind/
        // low-vision readers to tell "this movement is good" from "this
        // movement is bad" -- the same up-arrow means opposite things for a
        // normal metric vs an `invert` one (see the invert doc above). An
        // sr-only word carries the actual verdict as text, independent of
        // hue or glyph shape, reusing the same `good` boolean the color
        // class already keys off so the two can never disagree.
        const worseBetter = good ? 'better' : 'worse';
        return h('div', { key: i, class: 'kpi-card' },
            meta && meta.glyph ? h('div', { class: 'kpi-glyph' }, Icon(meta.glyph, { size: 16 })) : null,
            // Fixed-alignment number+caption stack: a shared flex column with
            // an explicit start alignment means a short one-line caption and
            // a long wrapping caption both anchor their number at the same
            // top position instead of drifting per tile height.
            h('div', { class: 'kpi-stack' },
                h('div', { class: 'num' }, String(n)),
                h('div', { class: 'lbl' }, l)),
            meta && (meta.delta != null || meta.spark)
                ? h('div', { class: 'kpi-foot' },
                    meta.delta != null
                        ? h('span', { class: 'kpi-delta kpi-delta-' + (good ? 'up' : 'down') },
                            Icon(isUp ? 'arrow-up' : 'arrow-down', { size: 12 }),
                            String(meta.delta),
                            h('span', { class: 'sr-only' }, ' (' + worseBetter + ')'))
                        : null,
                    meta.spark ? Sparkline({ values: meta.spark, tone: good ? 'up' : 'down' }) : null)
                : null);
    }));
}

// Minimal inline SVG trend line — token-stroke only, no raw color literals.
// `title` (native <title> element, not the `title` attribute — SVG scopes
// tooltip text to the element it's nested in) gives every point a lightweight
// hover tooltip showing its value; no custom tooltip machinery, just the
// browser's own affordance, so this stays a "minimal inline SVG" primitive.
export function Sparkline({ values = [], width = 72, height = 24, tone }) {
    if (!values.length) return null;
    const max = Math.max(...values), min = Math.min(...values);
    const span = (max - min) || 1;
    const step = width / (values.length - 1 || 1);
    const points = values.map((v, i) => [i * step, height - ((v - min) / span) * height]);
    const d = points.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
    return h('svg', { class: 'ds-sparkline ds-sparkline-' + (tone === 'down' ? 'down' : 'up'), viewBox: '0 0 ' + width + ' ' + height, width, height, role: 'img', 'aria-label': 'trend: ' + values.join(', ') },
        h('title', {}, values.join(', ')),
        h('path', { d, fill: 'none', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
        ...points.map(([x, y], i) => h('circle', { key: i, cx: x.toFixed(1), cy: y.toFixed(1), r: 6, fill: 'transparent', stroke: 'none' },
            h('title', {}, String(values[i])))));
}

// Horizontal token-only bar breakdown — e.g. revenue by channel, traffic by source.
export function BarChart({ items = [], emptyText = 'no data yet' }) {
    if (!items.length) return h('div', { class: 'empty' }, emptyText);
    const max = Math.max(...items.map(it => it.value || 0)) || 1;
    return h('div', { class: 'ds-barchart' }, ...items.map((it, i) =>
        h('div', { key: i, class: 'ds-barchart-row' },
            h('div', { class: 'ds-barchart-label' }, it.label),
            h('div', { class: 'ds-barchart-track' },
                h('div', { class: 'ds-barchart-fill', style: '--bar-pct:' + Math.round((it.value / max) * 100) + '%' })),
            h('div', { class: 'ds-barchart-value' }, it.display != null ? it.display : String(it.value)))));
}
