// AuthModal — centered login dialog: extension / generate / import (nsec) modes.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
const h = webjsx.createElement;

export function AuthModal({ mode = 'extension', error = '', busy = false, open = false, onModeChange, onConnectExtension, onGenerate, onImport, onClose } = {}) {
    if (!open) return null;
    const close = () => onClose && onClose();
    const modes = [
        { id: 'extension', label: 'Extension' },
        { id: 'generate', label: 'Generate' },
        { id: 'import', label: 'Import key' },
    ];
    let nsec = '';
    const body = () => {
        if (mode === 'generate') {
            return [
                h('p', { class: 'ov-auth-hint' }, 'Create a fresh Nostr identity. Back up the key after.'),
                h('button', { type: 'button', class: 'ov-auth-primary', disabled: busy ? true : null,
                    onclick: () => onGenerate && onGenerate() }, busy ? 'Working…' : 'Generate new key'),
            ];
        }
        if (mode === 'import') {
            return [
                h('p', { class: 'ov-auth-hint' }, 'Paste an existing nsec / hex secret key.'),
                h('input', {
                    type: 'password', class: 'ov-auth-input', placeholder: 'nsec1…',
                    'aria-label': 'secret key', disabled: busy ? true : null,
                    oninput: (e) => { nsec = e.target.value; },
                    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); onImport && onImport(nsec); } },
                }),
                h('button', { type: 'button', class: 'ov-auth-primary', disabled: busy ? true : null,
                    onclick: () => onImport && onImport(nsec) }, busy ? 'Working…' : 'Import'),
            ];
        }
        return [
            h('p', { class: 'ov-auth-hint' }, 'Connect a NIP-07 browser extension (Alby, nos2x…).'),
            h('button', { type: 'button', class: 'ov-auth-primary', disabled: busy ? true : null,
                onclick: () => onConnectExtension && onConnectExtension() }, busy ? 'Connecting…' : 'Connect extension'),
        ];
    };
    return h('div', {
        class: 'ov-auth-backdrop', role: 'presentation',
        ref: (el) => {
            if (!el || el._ovAuth) return; el._ovAuth = true;
            el.addEventListener('mousedown', (e) => {
                const panel = el.querySelector('.ov-auth-panel');
                if (panel && !panel.contains(e.target)) close();
            });
        },
    },
        h('div', {
            class: 'ov-auth-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sign in',
            onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } },
        },
            h('div', { class: 'ov-auth-head' },
                h('h2', { class: 'ov-auth-title' }, 'Sign in'),
                h('button', { type: 'button', class: 'ov-auth-x', 'aria-label': 'close', onclick: close }, Icon('x'))
            ),
            h('div', { class: 'ov-auth-tabs', role: 'tablist',
                onkeydown: (e) => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                    const panel = e.currentTarget.closest('.ov-auth-panel');
                    const tabs = panel ? [...panel.querySelectorAll('.ov-auth-tab')] : [];
                    if (!tabs.length) return;
                    const idx = tabs.indexOf(document.activeElement);
                    if (idx < 0) return;
                    e.preventDefault();
                    const next = e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
                    tabs[next].focus();
                    onModeChange && onModeChange(modes[next].id);
                },
            },
                ...modes.map(m => h('button', {
                    type: 'button', role: 'tab', key: 'am-' + m.id,
                    id: 'ov-auth-tab-' + m.id,
                    class: 'ov-auth-tab' + (m.id === mode ? ' is-active' : ''),
                    'aria-selected': m.id === mode ? 'true' : 'false',
                    'aria-controls': 'ov-auth-panel',
                    onclick: () => onModeChange && onModeChange(m.id),
                }, m.label))
            ),
            h('div', { class: 'ov-auth-body', id: 'ov-auth-panel', role: 'tabpanel',
                'aria-labelledby': 'ov-auth-tab-' + mode }, ...body()),
            error ? h('div', { class: 'ov-auth-error', role: 'alert' }, String(error)) : null
        )
    );
}
