// ChatMinimap — the component itself: a single ref callback owning the
// imperative lifecycle (scroll listener, ResizeObserver rebinding, throttled
// node measurement, drag/click-to-scroll, hover tracking, teardown), painting
// through ./paint.js.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { hasTextContent, isMappedRole, resolveMessageEl } from './preview.js';
import { paintMinimap } from './paint.js';

const h = webjsx.createElement;

export const CHAT_MINIMAP_WIDTH = 36;
const MEASURE_THROTTLE_MS = 150;
const MIN_SCROLLABLE_PX = 20;

export function ChatMinimap({ messages = [], getThreadEl, getMessageEl, width = CHAT_MINIMAP_WIDTH } = {}) {
    // All mutable state lives on the container element itself (webjsx factories
    // are pure-render; the ref callback owns the imperative lifecycle, same
    // pattern as makeThreadAutoScroll in chat.js).
    const state = {
        scrollRatio: 0,
        viewportRatio: 1,
        visible: false,
        nodes: /** @type {Array<{topRatio:number, heightRatio:number, msg:any, index:number}>} */ ([]),
        hovered: false,
        mouseYRatio: null,
    };

    const containerRef = (el) => {
        if (!el) return;
        if (el._dsMinimapCleanup) return; // already wired for this DOM node
        let measureTimer = null;
        let ro = null;
        let threadEl = null;
        let scrollListenerEl = null;

        const render = () => paintMinimap(el, state, messages, width);

        const updateScroll = () => {
            const t = typeof getThreadEl === 'function' ? getThreadEl() : null;
            if (!t) return;
            const totalH = t.scrollHeight;
            const clientH = t.clientHeight;
            const scrollable = totalH - clientH;
            state.visible = scrollable > MIN_SCROLLABLE_PX;
            if (scrollable <= 0) {
                state.scrollRatio = 0;
                state.viewportRatio = 1;
            } else {
                state.scrollRatio = t.scrollTop / scrollable;
                state.viewportRatio = clientH / totalH;
            }
            render();
        };

        const measureNodes = () => {
            if (measureTimer) return; // throttled — one pending pass at a time
            measureTimer = setTimeout(() => {
                measureTimer = null;
                const t = typeof getThreadEl === 'function' ? getThreadEl() : null;
                if (!t) return;
                const totalH = t.scrollHeight;
                if (totalH <= 0) return;
                const containerRect = t.getBoundingClientRect();
                const newNodes = [];
                for (let i = 0; i < messages.length; i++) {
                    const msg = messages[i];
                    if (!isMappedRole(msg && msg.role)) continue;
                    if (!hasTextContent(msg)) continue;
                    const msgEl = resolveMessageEl(t, getMessageEl, i);
                    if (!msgEl) continue;
                    const elRect = msgEl.getBoundingClientRect();
                    const top = elRect.top - containerRect.top + t.scrollTop;
                    newNodes.push({
                        topRatio: top / totalH,
                        heightRatio: elRect.height / totalH,
                        msg,
                        index: newNodes.length,
                    });
                }
                state.nodes = newNodes;
                render();
            }, MEASURE_THROTTLE_MS);
        };

        const syncLayout = () => { updateScroll(); measureNodes(); };

        // Rebinds scroll listener + ResizeObserver to whichever thread element
        // getThreadEl currently resolves to (it may be null on first paint and
        // become available once the thread's own ref fires).
        const rebind = () => {
            const t = typeof getThreadEl === 'function' ? getThreadEl() : null;
            if (t === threadEl) return;
            if (scrollListenerEl) scrollListenerEl.removeEventListener('scroll', updateScroll);
            if (ro) { ro.disconnect(); ro = null; }
            threadEl = t;
            scrollListenerEl = t;
            if (!t) return;
            t.addEventListener('scroll', updateScroll, { passive: true });
            ro = new ResizeObserver(syncLayout);
            ro.observe(t);
            if (t.firstElementChild) ro.observe(t.firstElementChild);
            syncLayout();
        };
        rebind();
        // Thread element may not exist yet on first mount; poll briefly (mirrors
        // upstream's 50ms post-message-change settle) until it appears, then the
        // ResizeObserver takes over for everything after.
        const rebindPoll = setInterval(rebind, 200);

        // Drag-to-scroll + click-to-jump on the strip itself.
        let dragging = false;
        const scrollToRatio = (viewportTopRatio) => {
            const t = typeof getThreadEl === 'function' ? getThreadEl() : null;
            if (!t) return;
            const scrollable = t.scrollHeight - t.clientHeight;
            if (scrollable <= 0) return;
            const clamped = Math.max(0, Math.min(1 - state.viewportRatio, viewportTopRatio));
            t.scrollTop = (clamped / (1 - state.viewportRatio)) * scrollable;
        };
        const ratioFromEvent = (ev) => {
            const rect = el.getBoundingClientRect();
            return (ev.clientY - rect.top) / rect.height;
        };
        const onMouseDown = (ev) => {
            if (!state.visible) return;
            dragging = true;
            const clickRatio = ratioFromEvent(ev);
            const grabOffset = clickRatio - state.scrollRatio * (1 - state.viewportRatio);
            const insideBox = grabOffset >= 0 && grabOffset <= state.viewportRatio;
            const offset = insideBox ? grabOffset : state.viewportRatio / 2;
            scrollToRatio(clickRatio - offset);
            const onMove = (mv) => { if (dragging) scrollToRatio(ratioFromEvent(mv) - offset); };
            const onUp = () => { dragging = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        };
        const onMouseEnter = () => { state.hovered = true; render(); };
        const onMouseLeave = () => { state.hovered = false; state.mouseYRatio = null; render(); };
        const onMouseMove = (ev) => { state.mouseYRatio = ratioFromEvent(ev); render(); };
        el.addEventListener('mousedown', onMouseDown);
        el.addEventListener('mouseenter', onMouseEnter);
        el.addEventListener('mouseleave', onMouseLeave);
        el.addEventListener('mousemove', onMouseMove);

        el._dsMinimapCleanup = () => {
            clearInterval(rebindPoll);
            if (measureTimer) clearTimeout(measureTimer);
            if (scrollListenerEl) scrollListenerEl.removeEventListener('scroll', updateScroll);
            if (ro) ro.disconnect();
            el.removeEventListener('mousedown', onMouseDown);
            el.removeEventListener('mouseenter', onMouseEnter);
            el.removeEventListener('mouseleave', onMouseLeave);
            el.removeEventListener('mousemove', onMouseMove);
        };

        render();
    };

    return h('div', {
        class: 'chat-minimap',
        ref: containerRef,
        role: 'navigation',
        'aria-label': 'conversation scroll overview',
        style: 'width:' + width + 'px',
    });
}
