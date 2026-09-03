// Full-screen overlays — BootOverlay (brand/progress splash with an error
// state) and VideoLightbox (fullscreen video player with backdrop dismiss).
// Both cover the whole viewport rather than anchoring to a trigger.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
const h = webjsx.createElement;

// BootOverlay — full-screen brand/progress overlay with error state.
export function BootOverlay({ progress = 0, phase = '', errored = false, visible = false } = {}) {
    if (!visible) return null;
    let pct = Number(progress) || 0;
    if (pct <= 1) pct = pct * 100;
    pct = Math.max(0, Math.min(100, pct));
    return h('div', { class: 'ov-boot' + (errored ? ' is-error' : ''), role: errored ? 'alert' : 'status', 'aria-live': 'polite' },
        h('div', { class: 'ov-boot-inner' },
            errored
                ? h('div', { class: 'ov-boot-mark ov-boot-mark-error', 'aria-hidden': 'true' }, Icon('warn'))
                : h('div', { class: 'ov-boot-spinner', 'aria-hidden': 'true' }),
            !errored ? h('div', { class: 'ov-boot-bar', role: 'progressbar',
                'aria-valuenow': String(Math.round(pct)), 'aria-valuemin': '0', 'aria-valuemax': '100' },
                h('div', { class: 'ov-boot-bar-fill', style: 'width:' + pct + '%' })) : null,
            h('div', { class: 'ov-boot-phase' }, String(phase || (errored ? 'Error' : 'Loading…')))
        )
    );
}

// VideoLightbox — fullscreen video player overlay with backdrop dismiss.
export function VideoLightbox({ src, label = '', open = false, onClose } = {}) {
    if (!open || !src) return null;
    const close = () => onClose && onClose();
    return h('div', {
        class: 'ov-lightbox-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': label || 'Video',
        tabindex: '-1',
        onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } },
        ref: (el) => { if (el && !el._ovLb) { el._ovLb = true; setTimeout(() => el.focus(), 0); } },
        onmousedown: (e) => { if (e.target === e.currentTarget) close(); },
    },
        h('button', { type: 'button', class: 'ov-lightbox-x', 'aria-label': 'close', onclick: close }, Icon('x')),
        h('div', { class: 'ov-lightbox-stage' },
            h('video', { class: 'ov-lightbox-video', src, controls: true, autoplay: true, playsinline: true }),
            label ? h('div', { class: 'ov-lightbox-label' }, label) : null
        )
    );
}
