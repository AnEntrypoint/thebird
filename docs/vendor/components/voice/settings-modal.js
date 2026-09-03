// VoiceSettingsModal — mode (PTT / VAD / live), input+output device pickers,
// VAD threshold, processing toggles, bitrate and master volume, plus the small
// section / device-select / toggle-row builders it composes from.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
const h = webjsx.createElement;

function seg({ label, children, className = '' }) {
    return h('div', { class: 'vx-section ' + className },
        label != null ? h('div', { class: 'vx-section-label' }, label) : null,
        ...(Array.isArray(children) ? children : [children])
    );
}

function devSelect(value, devices, onChange, aria) {
    return h('select', {
        class: 'vx-select', 'aria-label': aria,
        onchange: onChange ? (e) => onChange(e.target.value) : null
    }, ...(devices || []).map(d =>
        h('option', { key: 'd-' + d.value, value: d.value, selected: d.value === value }, d.label)));
}

function toggleRow(label, checked, onToggle) {
    return h('label', { class: 'vx-toggle-row' },
        h('span', {}, label),
        h('input', {
            type: 'checkbox', class: 'vx-toggle',
            checked: checked ? true : null,
            onchange: onToggle ? (e) => onToggle(e.target.checked) : null
        })
    );
}

export function VoiceSettingsModal({ open = false, mode = 'ptt', inputId, outputId, inputDevices = [], outputDevices = [], vadThreshold = 0.5, rnnoise = false, autoGain = false, forceTurn = false, bitrate = 64, volume, onChange, onSave, onCancel, onClose } = {}) {
    if (!open) return null;
    const patch = (p) => onChange && onChange(p);
    const modes = ['ptt', 'vad', 'live'];
    const vol = volume == null ? 1 : volume;
    return h('div', {
        class: 'vx-modal-backdrop',
        onclick: (e) => { if (e.target === e.currentTarget) onClose && onClose(); },
        onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose && onClose(); } }
    },
        h('div', { class: 'vx-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Voice settings' },
            h('div', { class: 'vx-modal-head' },
                h('h2', { class: 'vx-modal-title' }, 'Voice settings'),
                h('button', { type: 'button', class: 'vx-modal-x', 'aria-label': 'close', onclick: () => onClose && onClose() }, Icon('x'))
            ),
            h('div', { class: 'vx-modal-body' },
                seg({ label: 'Mode', children:
                    h('div', { class: 'vx-segmented', role: 'group', 'aria-label': 'mode' },
                        ...modes.map(m => h('button', {
                            key: 'm-' + m, type: 'button',
                            class: 'vx-seg' + (m === mode ? ' vx-seg-on' : ''),
                            'aria-pressed': m === mode ? 'true' : 'false',
                            onclick: () => patch({ mode: m })
                        }, m.toUpperCase())))
                }),
                seg({ label: 'Input device', children: devSelect(inputId, inputDevices, (v) => patch({ inputId: v }), 'input device') }),
                seg({ label: 'Output device', children: devSelect(outputId, outputDevices, (v) => patch({ outputId: v }), 'output device') }),
                mode === 'vad' ? seg({ label: 'VAD threshold', children:
                    h('div', { class: 'vx-range-row' },
                        h('input', {
                            type: 'range', class: 'vx-range', min: '0', max: '1', step: '0.01',
                            value: String(vadThreshold), 'aria-label': 'VAD threshold',
                            oninput: (e) => patch({ vadThreshold: parseFloat(e.target.value) })
                        }),
                        h('span', { class: 'vx-range-val' }, Math.round((Number(vadThreshold) || 0) * 100) + '%')
                    )
                }) : null,
                seg({ label: 'Processing', children: [
                    toggleRow('RNNoise', rnnoise, (v) => patch({ rnnoise: v })),
                    toggleRow('Auto gain', autoGain, (v) => patch({ autoGain: v })),
                    toggleRow('Force TURN', forceTurn, (v) => patch({ forceTurn: v }))
                ]}),
                seg({ label: 'Bitrate', children:
                    h('div', { class: 'vx-range-row' },
                        h('input', {
                            type: 'range', class: 'vx-range', min: '8', max: '256', step: '8',
                            value: String(bitrate), 'aria-label': 'bitrate',
                            oninput: (e) => patch({ bitrate: parseInt(e.target.value, 10) })
                        }),
                        h('span', { class: 'vx-range-val' }, (Number(bitrate) || 0) + ' kbps')
                    )
                }),
                seg({ label: 'Master volume', children:
                    h('div', { class: 'vx-range-row' },
                        h('input', {
                            type: 'range', class: 'vx-range', min: '0', max: '1', step: '0.01',
                            value: String(vol), 'aria-label': 'master volume',
                            oninput: (e) => patch({ volume: parseFloat(e.target.value) })
                        }),
                        h('span', { class: 'vx-range-val' }, Math.round(vol * 100) + '%')
                    )
                })
            ),
            h('div', { class: 'vx-modal-foot' },
                h('button', { type: 'button', class: 'vx-btn', onclick: () => onCancel && onCancel() }, 'Cancel'),
                h('button', { type: 'button', class: 'vx-btn vx-btn-primary', onclick: () => onSave && onSave() }, 'Save')
            )
        )
    );
}
