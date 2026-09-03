// Reorderable — a drag-to-reorder list composed from useDraggable +
// useDropTarget: every row is both a drag source (via its own handle) and a
// drop target carrying its index.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { useDraggable, useDropTarget } from './pointer.js';
const h = webjsx.createElement;

export function Reorderable({ items = [], getKey, renderItem, onReorder, axis = 'vertical', kind = 'reorder' } = {}) {
    const order = items.map((_, i) => i);
    const cls = 'ds-reorderable ds-reorderable-' + axis;
    return h('div', { class: cls, role: 'list' },
        ...items.map((item, i) => {
            const key = getKey ? getKey(item, i) : i;
            const onRef = (el) => {
                if (!el || el._dsReorder) return;
                el._dsReorder = true;
                const handle = el.querySelector('.ds-reorder-handle') || el;
                const drag = useDraggable(handle, {
                    data: { index: i }, kind,
                    onDragEnd: ({ drop }) => {
                        if (!drop) return;
                        const toIdx = Number(drop.getAttribute('data-reorder-index'));
                        if (Number.isNaN(toIdx) || toIdx === i) return;
                        const next = order.slice();
                        const [m] = next.splice(i, 1);
                        next.splice(toIdx, 0, m);
                        if (onReorder) onReorder(next);
                    },
                });
                const drop = useDropTarget(el, { accepts: [kind] });
                el._dsReorderDestroy = () => { drag.destroy(); drop.destroy(); };
            };
            return h('div', {
                key, ref: onRef, class: 'ds-reorder-item',
                'data-reorder-index': String(i), role: 'listitem',
            },
                h('button', {
                    type: 'button', class: 'ds-reorder-handle',
                    'aria-label': 'Reorder', tabindex: '0',
                }, Icon('more-horizontal')),
                renderItem ? renderItem(item, i) : null
            );
        })
    );
}
