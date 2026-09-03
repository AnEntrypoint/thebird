// Agent-turn bubbles: the collapsible tool-call card (with per-section copy,
// stringify caching, and unified-diff detection that routes a patch-shaped
// result through GitDiffView) and the transient/settled thinking indicator.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { t } from '../../i18n.js';
import { GitDiffView } from '../git-status.js';
import { copyToClipboardWithFeedback } from './inline.js';

const h = webjsx.createElement;

// A tool result reads as a unified diff when it has at least one `@@ ... @@`
// hunk header and a +/- line — cheap enough to check on every render (no
// caching) since it only runs once per settled tool card, not per rAF tick.
function looksLikeUnifiedDiff(text) {
    if (!text || text.indexOf('@@') === -1) return false;
    return /^@@ .* @@/m.test(text) && /^[+-]/m.test(text);
}

// Pull a filename out of a unified diff's `+++ b/path` (or `--- a/path`)
// header line, for the GitDiffView head label — best-effort, no filename is
// fine (GitDiffView renders headerless).
function filenameFromDiff(text) {
    const m = /^\+\+\+ b?\/?(.+)$/m.exec(text) || /^--- a?\/?(.+)$/m.exec(text);
    return m ? m[1].trim() : undefined;
}

// Freddie-flavored agent parts: collapsible tool-call card, tool-result, and
// transient thinking indicator. Each renders as a `chat-bubble` variant so the
// surrounding ChatMessage chrome (avatar/meta/reactions) stays consistent.
export function ToolCallNode(p) {
    const status = p.status || (p.error ? 'error' : (p.result != null ? 'done' : 'running'));
    // Args/result are re-stringified on every rAF re-render while any part of
    // the turn is streaming, even for collapsed cards whose own args/result
    // haven't changed since the last frame. Cache by identity on the part
    // object itself so an unchanged args/result skips the stringify.
    if (p._argsCache !== p.args) {
        p._argsTextCache = typeof p.args === 'string' ? p.args : JSON.stringify(p.args || {}, null, 2);
        p._argsCache = p.args;
    }
    const argsText = p._argsTextCache;
    if (p._resultCache !== p.result) {
        p._resultTextCache = p.result == null ? '' : (typeof p.result === 'string' ? p.result : JSON.stringify(p.result, null, 2));
        p._resultCache = p.result;
    }
    const resultText = p._resultTextCache;
    const hasArgs = p.args != null && argsText !== '{}' && argsText.trim() !== '';
    // Default-open while running or on error so the user sees live progress / failure detail;
    // collapse on success unless the caller explicitly overrides with open:true.
    const defaultOpen = p.open != null ? !!p.open : (status === 'running' || status === 'error');
    const iconName = status === 'running' ? 'refresh' : (status === 'error' ? 'warn' : 'check');
    const copyText = (txt) => (e) => copyToClipboardWithFeedback(txt, e.currentTarget);
    const sectionLabel = (text, txt) => h('div', { class: 'chat-tool-section-label' },
        h('span', {}, text),
        h('button', { type: 'button', class: 'chat-code-copy chat-tool-copy', 'aria-label': 'copy ' + text, onclick: copyText(txt) }, 'copy'));
    return h('details', { class: 'chat-bubble chat-tool tool-' + status, open: defaultOpen },
        h('summary', { class: 'chat-tool-head' },
            h('span', { class: 'chat-tool-icon', 'aria-hidden': 'true' }, Icon(iconName, { size: 14 })),
            h('span', { class: 'chat-tool-name' }, p.name || 'tool'),
            p.label ? h('span', { class: 'chat-tool-label' }, p.label) : null,
            h('span', { class: 'chat-tool-status' }, status)
        ),
        h('div', { class: 'chat-tool-body' },
            ...[
                hasArgs ? h('div', { class: 'chat-tool-section' },
                    sectionLabel('args', argsText),
                    h('pre', { class: 'chat-tool-pre' }, h('code', {}, argsText))) : null,
                resultText
                    ? (!p.error && looksLikeUnifiedDiff(resultText)
                        // A patch-shaped tool result (edit/write/diff tools) renders
                        // through the same split unified-diff view git-status.js's
                        // GitDiffView already owns, instead of a raw JSON/text dump —
                        // colored +/- hunks read far better than escaped plaintext.
                        ? h('div', { class: 'chat-tool-section' },
                            sectionLabel('result', resultText),
                            GitDiffView({ diff: resultText, filename: filenameFromDiff(resultText) }))
                        : h('div', { class: 'chat-tool-section' },
                            sectionLabel(p.error ? 'error' : 'result', resultText),
                            h('pre', { class: 'chat-tool-pre' + (p.error ? ' is-error' : '') }, h('code', {}, resultText))))
                    // A finished tool with no output would otherwise render no result
                    // section, reading identically to a still-running tool. Show an
                    // explicit placeholder so "done, empty" is distinguishable.
                    : (status === 'done' ? h('div', { class: 'chat-tool-section' },
                        h('div', { class: 'chat-tool-section-label' }, 'result'),
                        h('pre', { class: 'chat-tool-pre chat-tool-empty' }, h('code', {}, '(no output)'))) : null)
            ].filter(Boolean)
        )
    );
}

// Approval-request card for the freddie wire protocol's approval.request event
// (plugins/gui/gui-agent): a gated tool call pauses mid-turn until the user
// resolves it here. p.onResolve({approved, always?}) sends the decision back
// over the same channel; once resolved the card renders the settled state.
export function ApprovalNode(p) {
    const status = p.status || 'pending';
    const argsText = typeof p.args === 'string' ? p.args : JSON.stringify(p.args || {}, null, 2);
    const iconName = status === 'pending' ? 'warn' : (status === 'approved' ? 'check' : 'warn');
    const decide = (decision) => (e) => { e.preventDefault(); if (p.onResolve) p.onResolve(decision); };
    return h('div', { class: 'chat-bubble chat-tool chat-approval tool-' + (status === 'pending' ? 'running' : status) },
        h('div', { class: 'chat-tool-head' },
            h('span', { class: 'chat-tool-icon', 'aria-hidden': 'true' }, Icon(iconName, { size: 14 })),
            h('span', { class: 'chat-tool-name' }, 'approval: ' + (p.name || 'tool')),
            h('span', { class: 'chat-tool-status' }, status)
        ),
        h('div', { class: 'chat-tool-body' },
            h('div', { class: 'chat-tool-section' },
                h('div', { class: 'chat-tool-section-label' }, h('span', {}, 'args')),
                h('pre', { class: 'chat-tool-pre' }, h('code', {}, argsText))),
            status === 'pending'
                ? h('div', { class: 'chat-approval-actions' },
                    h('button', { type: 'button', class: 'chat-code-copy chat-approval-btn', onclick: decide({ approved: true }) }, 'approve'),
                    h('button', { type: 'button', class: 'chat-code-copy chat-approval-btn', onclick: decide({ approved: true, always: true }) }, 'always'),
                    h('button', { type: 'button', class: 'chat-code-copy chat-approval-btn', onclick: decide({ approved: false }) }, 'reject'))
                : h('div', { class: 'chat-approval-note' }, status === 'approved' ? (p.always ? 'approved (always, this turn)' : 'approved') : 'rejected')
        )
    );
}

export function ThinkingNode(p) {
    if (p.settled) {
        return h('details', { class: 'chat-bubble chat-thinking-settled' },
            h('summary', {}, t('chat.viewThinking', 'View thinking')),
            h('div', { class: 'chat-thinking-body' }, p.text)
        );
    }
    return h('div', { class: 'chat-bubble chat-thinking', role: 'status', 'aria-live': 'polite' },
        h('span', { class: 'chat-thinking-dots', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
        h('span', { class: 'chat-thinking-text' }, p.text || t('chat.thinking', 'thinking…'))
    );
}
