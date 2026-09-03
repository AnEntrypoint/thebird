// ApprovalPrompt — an inline, in-thread tool-permission card (as opposed to
// PermissionMenu's settings-style dropdown): shows the tool name + an
// optional args preview, an optional free-text note the user can attach to
// their decision (auto-focused, since the note is usually the primary
// reason to open this card at all), and up to four resolution actions
// (once/session/all/deny). Mirrors docstudio's chat-approval-prompts.js
// buildApprovalPrompt shape. The note textarea is entirely optional -
// omitting `onDecision`'s use of the note arg keeps existing simpler
// once/deny-only call sites unaffected.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
const h = webjsx.createElement;

export function ApprovalPrompt({ toolName, categoryLabel, argsPreview, onDecision, autoFocusNote = true } = {}) {
    let noteEl = null;
    const noteRef = (el) => {
        if (!el || noteEl === el) return;
        noteEl = el;
        if (autoFocusNote) setTimeout(() => noteEl && noteEl.focus(), 0);
    };
    const decide = (kind) => { if (onDecision) onDecision(kind, (noteEl && noteEl.value || '').trim()); };
    return h('div', { class: 'ov-approval', role: 'group', 'aria-label': toolName ? `Permission requested: ${toolName}` : 'Permission requested' },
        h('div', { class: 'ov-approval-head' },
            h('span', { class: 'ov-approval-icon' }, Icon('lock', { size: 16 })),
            h('strong', { class: 'ov-approval-tool' }, toolName || ''),
            categoryLabel ? h('span', { class: 'ov-approval-cat' }, '- ' + categoryLabel) : null),
        argsPreview ? h('pre', { class: 'ov-approval-args' }, argsPreview) : null,
        h('textarea', {
            class: 'ov-approval-note', ref: noteRef,
            placeholder: 'Add instructions for the assistant (optional)...',
        }),
        h('div', { class: 'ov-approval-actions' },
            h('button', { type: 'button', class: 'ov-approval-btn ov-approval-btn-primary', onclick: () => decide('once') }, 'Allow once'),
            h('button', { type: 'button', class: 'ov-approval-btn ov-approval-btn-soft', onclick: () => decide('session') }, 'Allow for session'),
            h('button', { type: 'button', class: 'ov-approval-btn', onclick: () => decide('all') }, 'Allow all'),
            h('button', { type: 'button', class: 'ov-approval-btn ov-approval-btn-deny', onclick: () => decide('deny') }, 'Deny')));
}
