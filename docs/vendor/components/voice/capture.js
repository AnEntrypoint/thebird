// Capture-side voice surfaces — what the local user speaks and shows through:
// the push-to-talk button, the voice-activity level meter with its threshold
// handle, and the webcam preview with resolution/fps pickers.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
const h = webjsx.createElement;

export function PttButton({ state = 'idle', mode = 'ptt', onHoldStart, onHoldEnd, onClick, label = 'Hold to talk' } = {}) {
    const active = state === 'live' || state === 'recording' || state === 'vad';
    const start = (e) => { onHoldStart && onHoldStart(e); };
    const end = (e) => { onHoldEnd && onHoldEnd(e); };
    return h('button', {
        type: 'button',
        class: 'vx-ptt vx-ptt-' + state + ' vx-ptt-mode-' + mode,
        'data-state': state,
        'data-mode': mode,
        'aria-pressed': active ? 'true' : 'false',
        'aria-label': label,
        onclick: onClick ? (e) => onClick(e) : null,
        onpointerdown: (e) => { e.preventDefault(); start(e); },
        onpointerup: (e) => { e.preventDefault(); end(e); },
        onpointerleave: (e) => end(e),
        oncontextmenu: (e) => e.preventDefault(),
        ontouchstart: (e) => start(e),
        ontouchend: (e) => { e.preventDefault(); end(e); }
    },
        h('span', { class: 'vx-ptt-glow', 'aria-hidden': 'true' }),
        h('span', { class: 'vx-ptt-icon', 'aria-hidden': 'true' }, state === 'idle' ? Icon('mic') : h('span', { class: 'ds-dot ds-dot-on', 'aria-hidden': 'true' })),
        h('span', { class: 'vx-ptt-label' }, label)
    );
}

export function VadMeter({ level = 0, threshold = 0.5, onThresholdChange } = {}) {
    const lvl = Math.max(0, Math.min(1, Number(level) || 0));
    const thr = Math.max(0, Math.min(1, Number(threshold) || 0));
    const over = lvl >= thr;
    return h('div', { class: 'vx-vad', role: 'group', 'aria-label': 'voice activity meter' },
        h('div', { class: 'vx-vad-track' },
            h('div', { class: 'vx-vad-fill' + (over ? ' vx-vad-fill-over' : ''), style: 'width:' + (lvl * 100).toFixed(1) + '%' }),
            h('div', { class: 'vx-vad-marker', style: 'left:' + (thr * 100).toFixed(1) + '%', 'aria-hidden': 'true' }),
            h('input', {
                class: 'vx-vad-range',
                type: 'range', min: '0', max: '1', step: '0.01',
                value: String(thr),
                'aria-label': 'VAD threshold',
                oninput: onThresholdChange ? (e) => onThresholdChange(parseFloat(e.target.value)) : null
            })
        ),
        h('div', { class: 'vx-vad-readout' },
            h('span', {}, 'lvl ' + Math.round(lvl * 100)),
            h('span', {}, 'thr ' + Math.round(thr * 100))
        )
    );
}

export function WebcamPreview({ videoStream = null, resolution = '640x480', fps = 30, enabled = true, resolutions = [], fpsOptions = [], onResolutionChange, onFpsChange, onToggle } = {}) {
    const videoRef = (el) => {
        if (!el) return;
        if (el.srcObject !== videoStream) el.srcObject = videoStream || null;
    };
    const resOpts = (resolutions.length ? resolutions : [resolution]).map(r =>
        h('option', { key: 'r-' + r, value: r, selected: r === resolution }, r));
    const fpsList = fpsOptions.length ? fpsOptions : [fps];
    const fpsOpts = fpsList.map(f =>
        h('option', { key: 'f-' + f, value: String(f), selected: Number(f) === Number(fps) }, f + ' fps'));
    return h('div', { class: 'vx-cam' + (enabled ? '' : ' vx-cam-off') },
        h('div', { class: 'vx-cam-stage' },
            enabled
                ? h('video', { class: 'vx-cam-video', ref: videoRef, autoplay: true, muted: true, playsinline: true })
                : h('div', { class: 'vx-cam-placeholder' }, h('span', {}, Icon('camera')), h('span', {}, 'Camera off'))
        ),
        h('div', { class: 'vx-cam-controls' },
            h('select', {
                class: 'vx-select', 'aria-label': 'resolution',
                onchange: onResolutionChange ? (e) => onResolutionChange(e.target.value) : null
            }, ...resOpts),
            h('select', {
                class: 'vx-select', 'aria-label': 'frame rate',
                onchange: onFpsChange ? (e) => onFpsChange(Number(e.target.value)) : null
            }, ...fpsOpts),
            h('button', {
                type: 'button',
                class: 'vx-btn' + (enabled ? ' vx-btn-on' : ''),
                'aria-pressed': enabled ? 'true' : 'false',
                onclick: onToggle ? () => onToggle() : null
            }, enabled ? 'Disable' : 'Enable')
        )
    );
}
