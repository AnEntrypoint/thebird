// Carousel — horizontal (or vertical) scroll-snap content carousel. Native
// CSS scroll-snap does the heavy lifting; prev/next Btns call scrollBy() on
// the track element via a `ref` callback (the same raw-DOM-node-reference
// pattern used across the codebase, e.g. editor-primitives/split-panel.js's
// `ref: (el) => { rootEl = el; }`). No drag-library dependency.

import * as webjsx from '../../vendor/webjsx/index.js';
import { Btn } from './shell/atoms.js';
import { Icon } from './shell/icons.js';
const h = webjsx.createElement;

/**
 * A scroll-snap content carousel with prev/next controls.
 *
 * @param {Object} [props]
 * @param {Array} [props.items=[]]
 * @param {Function} props.renderItem - (item, index) => vnode.
 * @param {'horizontal'|'vertical'} [props.orientation='horizontal']
 * @param {string} [props.label] - accessible name for the region.
 * @param {*} [props.key]
 * @returns {*} webjsx vnode
 */
export function Carousel({ items = [], renderItem, orientation = 'horizontal', label = 'carousel', key } = {}) {
    const isVert = orientation === 'vertical';
    let trackEl = null;
    const scrollByPage = (dir) => {
        if (!trackEl) return;
        const delta = isVert
            ? trackEl.clientHeight * 0.9 * dir
            : trackEl.clientWidth * 0.9 * dir;
        trackEl.scrollBy(isVert ? { top: delta, behavior: 'smooth' } : { left: delta, behavior: 'smooth' });
    };
    const track = h('div', {
        key: 'track',
        class: 'ds-carousel-track' + (isVert ? ' ds-carousel-track--vertical' : ''),
        role: 'group',
        'aria-label': label,
        ref: (el) => { trackEl = el; }
    }, ...items.map((item, i) => h('div', { key: 'item-' + i, class: 'ds-carousel-item' }, renderItem(item, i))));
    return h('div', { key, class: 'ds-carousel' + (isVert ? ' ds-carousel--vertical' : '') },
        Btn({
            key: 'prev', variant: 'ghost', class: 'ds-carousel-prev',
            'aria-label': 'previous', onClick: () => scrollByPage(-1),
            children: Icon(isVert ? 'chevron-up' : 'chevron-left')
        }),
        track,
        Btn({
            key: 'next', variant: 'ghost', class: 'ds-carousel-next',
            'aria-label': 'next', onClick: () => scrollByPage(1),
            children: Icon(isVert ? 'chevron-down' : 'chevron-right')
        })
    );
}
