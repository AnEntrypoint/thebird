// Progress — plain value/max progress bar. Sibling module of data-density.js
// (kept separate purely to respect the 200-line module cap, not a
// barrel-over-submodules split of the whole group): the percentage-width
// bar-fill approach is the same one BarRow uses in data-density.js, just
// without BarRow's label/meta column chrome — track + fill only.

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

export function Progress({ value = 0, max = 100, label } = {}) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return h('div', {
        class: 'ds-progress', role: 'progressbar',
        'aria-valuenow': String(value), 'aria-valuemin': '0', 'aria-valuemax': String(max),
        'aria-label': label != null ? String(label) : 'progress',
    },
        label ? h('span', { class: 'ds-progress-label' }, label) : null,
        h('div', { class: 'ds-progress-track' },
            h('div', { class: 'ds-progress-fill', style: `width:${pct}%` })));
}
