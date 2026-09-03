// ContextMeter — horizontal meter bar showing proportional colored segments
// of token usage (e.g. system/user/assistant) against a total, plus a
// remaining-capacity sliver. Token-styled: each segment's color is a CSS
// custom property set inline (the one runtime-value exception the inline-
// style ban already carves out for percentage widths elsewhere in this kit,
// e.g. BarRow/BarChart's --bar-pct), the palette itself lives in
// context-pane.css as semantic classes, never a raw hex per segment.

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

// ContextMeter({ used, total, segments })
//   used     : tokens consumed so far (number).
//   total    : total budget (number) — the meter's 100%.
//   segments : [{ label, value, tone }] — tone is a semantic class suffix
//              ('system'|'user'|'assistant'|'other'); values need not sum to
//              `used` exactly but are clamped to the remaining budget.
export function ContextMeter({ used = 0, total = 0, segments = [] } = {}) {
    const safeTotal = total > 0 ? total : 1;
    let acc = 0;
    const bars = segments.map((seg, i) => {
        const val = Math.max(0, Number(seg.value) || 0);
        const pct = Math.max(0, Math.min(100, (val / safeTotal) * 100));
        acc += val;
        return h('span', {
            key: seg.id || i,
            class: 'ds-context-meter-seg ds-context-meter-seg-' + (seg.tone || 'other'),
            style: `width:${pct}%`,
            title: `${seg.label || 'segment'}: ${val}`,
        });
    });
    const usedPct = Math.max(0, Math.min(100, (used / safeTotal) * 100));
    return h('div', { class: 'ds-context-meter' },
        h('div', {
            class: 'ds-context-meter-track', role: 'meter',
            'aria-label': 'context usage', 'aria-valuenow': String(used),
            'aria-valuemin': '0', 'aria-valuemax': String(total),
        }, ...bars),
        h('div', { class: 'ds-context-meter-foot' },
            h('span', {}, `${used.toLocaleString()} / ${total.toLocaleString()} tokens`),
            h('span', {}, `${Math.round(usedPct)}%`)));
}
