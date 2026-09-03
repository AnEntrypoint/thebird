// Pure DOM paint: rebuilds the minimap's children from current `state`. Kept
// outside webjsx's own vdom diff (this subtree is imperative, like a canvas)
// because dot count/positions and hover/tooltip visibility change far more
// often than a full component re-render is warranted for.

import { messagePreview } from './preview.js';

const TOOLTIP_HEIGHT = 22;
const TOOLTIP_GAP = 2;
const TOOLTIP_WIDTH = 200;

export function paintMinimap(el, state, messages, width) {
    el.style.display = state.visible ? '' : 'none';
    el.innerHTML = '';
    if (!state.visible) return;

    const viewportBox = document.createElement('div');
    viewportBox.className = 'chat-minimap-viewport';
    viewportBox.style.top = (state.scrollRatio * (1 - state.viewportRatio) * 100) + '%';
    viewportBox.style.height = (state.viewportRatio * 100) + '%';
    el.appendChild(viewportBox);

    const centerLine = document.createElement('div');
    centerLine.className = 'chat-minimap-centerline';
    el.appendChild(centerLine);

    const nodes = state.nodes;
    let nearestIndex = null;
    if (state.mouseYRatio != null && nodes.length) {
        let best = 0;
        for (let i = 1; i < nodes.length; i++) {
            if (Math.abs(nodes[i].topRatio - state.mouseYRatio) < Math.abs(nodes[best].topRatio - state.mouseYRatio)) best = i;
        }
        nearestIndex = nodes[best].index;
    }

    for (const node of nodes) {
        const dot = document.createElement('div');
        const isUser = node.msg && node.msg.role === 'user';
        dot.className = 'chat-minimap-dot ' + (isUser ? 'is-user' : 'is-assistant') + (state.hovered && nearestIndex === node.index ? ' is-nearest' : '');
        dot.style.top = (node.topRatio * 100) + '%';
        el.appendChild(dot);
    }

    if (state.hovered && nodes.length) {
        const minimapHeightPx = el.clientHeight || 600;
        const positions = nodes.map((n) => Math.round(n.topRatio * minimapHeightPx - TOOLTIP_HEIGHT / 2));
        for (let pass = 0; pass < 10; pass++) {
            for (let i = 1; i < positions.length; i++) {
                const minTop = positions[i - 1] + TOOLTIP_HEIGHT + TOOLTIP_GAP;
                if (positions[i] < minTop) positions[i] = minTop;
            }
            for (let i = positions.length - 2; i >= 0; i--) {
                const maxTop = positions[i + 1] - TOOLTIP_HEIGHT - TOOLTIP_GAP;
                if (positions[i] > maxTop) positions[i] = maxTop;
            }
        }
        for (let i = 0; i < positions.length; i++) {
            positions[i] = Math.max(0, Math.min(minimapHeightPx - TOOLTIP_HEIGHT, positions[i]));
        }
        nodes.forEach((node, i) => {
            const preview = messagePreview(node.msg);
            if (!preview) return;
            const isNearest = nearestIndex === node.index;
            const tip = document.createElement('div');
            tip.className = 'chat-minimap-tooltip' + (isNearest ? ' is-nearest' : '') + (node.msg.role === 'user' ? ' is-user' : ' is-assistant');
            tip.style.top = positions[i] + 'px';
            tip.style.width = TOOLTIP_WIDTH + 'px';
            tip.textContent = preview;
            el.appendChild(tip);
        });
    }
}
