// In-call playback surfaces: the mic/deafen/camera/screen/settings/leave
// control toolbar, and the per-speaker audio queue strip with its
// pause/resume/skip transport.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
const h = webjsx.createElement;

function fmtDur(s) {
    s = Math.max(0, Math.round(Number(s) || 0));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
}

export function VoiceControls({ muted = false, deafened = false, cameraOn = false, screenShareOn = false, onMic, onDeafen, onCamera, onScreenShare, onSettings, onLeave } = {}) {
    const btn = (cls, on, label, glyph, handler) => h('button', {
        type: 'button',
        class: 'vx-vc-btn ' + cls + (on ? ' vx-vc-on' : '') + (handler ? '' : ' vx-vc-disabled'),
        'aria-pressed': on ? 'true' : 'false',
        'aria-label': label,
        title: label,
        disabled: handler ? null : true,
        onclick: handler ? (e) => handler(e) : null
    },
        h('span', { class: 'vx-vc-glyph', 'aria-hidden': 'true' }, glyph)
    );
    return h('div', { class: 'vx-vc', role: 'toolbar', 'aria-label': 'voice controls' },
        btn('vx-vc-mic', !muted, muted ? 'Unmute' : 'Mute', Icon(muted ? 'mic-off' : 'mic'), onMic),
        btn('vx-vc-deafen', !deafened, deafened ? 'Undeafen' : 'Deafen', Icon(deafened ? 'speaker-off' : 'speaker'), onDeafen),
        btn('vx-vc-camera', cameraOn, cameraOn ? 'Stop camera' : 'Start camera', Icon('camera'), onCamera),
        btn('vx-vc-screen', screenShareOn, screenShareOn ? 'Stop sharing' : 'Share screen', Icon('screen'), onScreenShare),
        btn('vx-vc-settings', false, 'Voice settings', Icon('settings'), onSettings),
        h('button', {
            type: 'button', class: 'vx-vc-btn vx-vc-leave', 'aria-label': 'Leave voice', title: 'Leave voice',
            onclick: onLeave ? (e) => onLeave(e) : null
        }, h('span', { class: 'vx-vc-glyph', 'aria-hidden': 'true' }, Icon('phone')))
    );
}

export function AudioQueue({ segments = [], currentSegmentId = null, paused = false, onReplay, onSkip, onResume, onPause } = {}) {
    if (!segments || !segments.length) {
        return h('div', { class: 'vx-queue vx-queue-empty' },
            h('span', { class: 'vx-queue-empty-text' }, 'No audio queued'));
    }
    return h('div', { class: 'vx-queue', role: 'group', 'aria-label': 'audio queue' },
        h('div', { class: 'vx-queue-ctrls' },
            h('button', {
                type: 'button', class: 'vx-queue-btn',
                'aria-label': paused ? 'resume' : 'pause',
                onclick: () => paused ? (onResume && onResume()) : (onPause && onPause())
            }, paused ? Icon('play') : Icon('pause')),
            h('button', {
                type: 'button', class: 'vx-queue-btn',
                'aria-label': 'skip', onclick: () => onSkip && onSkip()
            }, Icon('skip-forward'))
        ),
        h('div', { class: 'vx-queue-strip' },
            ...segments.map(s => h('button', {
                key: 'q-' + s.id,
                type: 'button',
                class: 'vx-chip' + (s.id === currentSegmentId ? ' vx-chip-current' : '') + (s.isLive ? ' vx-chip-live' : ''),
                'data-id': s.id,
                onclick: () => onReplay && onReplay(s.id)
            },
                h('span', { class: 'vx-chip-dot', style: s.color ? 'background:' + s.color : null, 'aria-hidden': 'true' }),
                h('span', { class: 'vx-chip-name' }, s.speaker || '—'),
                s.isLive
                    ? h('span', { class: 'vx-chip-tag' }, 'LIVE')
                    : h('span', { class: 'vx-chip-dur' }, fmtDur(s.duration))
            ))
        )
    );
}
