// ChatMessage — one conversational turn in every layout the surface supports:
// messenger bubbles (you/them), centered out-of-band roles (system/tool/
// thinking), and the flat full-width claude.ai/code turn. Owns the turn's
// notices (stopped / incomplete / error+retry), reactions, read receipt,
// meta line, and the hover-revealed per-message action row.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { t } from '../../i18n.js';
import { renderInline } from '../chat-message-parts.js';
import { avatarInitial } from '../content.js';
import { countMessage, renderPart } from './stats.js';

const h = webjsx.createElement;

export function ChatMessage({ role, who = 'them', avatar, text, parts, time, typing, key, aicat, reactions, receipt, name, streaming, actions, incomplete, stopped, flat, error, onRetry, onToggleReaction }) {
    countMessage();
    // Support legacy 'who' prop, prefer 'role' with mapping:
    //   'user'      -> 'you'   (right-aligned, accent bubble)
    //   'assistant' -> 'them'  (left-aligned, paper bubble)
    //   'system'    -> 'system' (centered, italic muted)
    //   'tool'      -> 'tool'   (centered, collapsible card chrome)
    //   'thinking'  -> 'thinking' (centered, transient typing dots)
    const resolvedWho = role
        ? (role === 'user' ? 'you'
            : role === 'assistant' ? 'them'
            : (role === 'system' || role === 'tool' || role === 'thinking') ? role
            : role)
        : who;
    const isCentered = resolvedWho === 'system' || resolvedWho === 'tool' || resolvedWho === 'thinking';
    // Flat layout (Claude-Code-web): full-width, avatar-less turns with a role
    // label above the content and a faint assistant background, instead of the
    // messenger avatar-disc + colored-bubble layout (kept for the chat demo).
    const isFlat = flat && !isCentered;
    const cls = 'chat-msg ' + resolvedWho + (aicat && resolvedWho === 'them' ? ' aicat' : '') + (isCentered ? ' centered' : '') + (isFlat ? ' chat-msg-flat' : '');
    const fallbackAvatar = avatar != null
        ? avatar
        : (resolvedWho === 'you' ? 'u' : avatarInitial(name));
    const av = h('span', { class: 'chat-avatar' }, fallbackAvatar);
    let bodyNodes;
    if (typing) bodyNodes = [h('div', { class: 'chat-bubble chat-bubble-typing', key: 'typb' }, h('span', { class: 'chat-typing' }, h('span'), h('span'), h('span')))];
    else if (parts && parts.length) bodyNodes = parts.map((p, i) => renderPart(p, i));
    else bodyNodes = [h('div', { class: 'chat-bubble', key: 't' }, ...renderInline(text || ''))];
    // A blinking caret at the stream head: while an assistant turn is streaming
    // AND already shows content (so the inline typing dots have stopped), append
    // a thin caret so the live edge reads as "still writing", not "done". Drawn as
    // a CSS element, not a glyph character.
    // Only append the caret as a sibling if the last part did not already embed
    // it inline (streamingCaret flag on the last text/md part in parts array).
    const lastPartHasCaret = parts && parts.length && parts[parts.length - 1] && parts[parts.length - 1].streamingCaret;
    if (streaming && !typing && !lastPartHasCaret) bodyNodes = [...bodyNodes, h('span', { key: '_caret', class: 'chat-stream-caret', 'aria-hidden': 'true' })];
    // Out-of-band turn notices, plain copy in a NEUTRAL tone (not error red):
    //   stopped    — the turn was cancelled (locally or remotely); truncated
    //                output must not read as a finished answer.
    //   incomplete — the connection dropped mid-turn and events were not
    //                replayed; the response may be missing content.
    // Pass true for the default copy or a string to override it. Retry rides
    // the existing per-message actions row.
    if (stopped) bodyNodes = [...bodyNodes, h('div', { key: '_stopped', class: 'chat-msg-notice is-stopped', role: 'status' },
        typeof stopped === 'string' ? stopped : 'stopped — this turn was cancelled before it finished')];
    if (incomplete) bodyNodes = [...bodyNodes, h('div', { key: '_incomplete', class: 'chat-msg-notice is-incomplete', role: 'status' },
        typeof incomplete === 'string' ? incomplete : 'connection dropped mid-turn — the response may be incomplete')];
    // Inline per-turn error: unlike a global toast, this pins the failure to
    // the specific turn that failed (docstudio pattern) with a retry action
    // right there instead of forcing the user to hunt for what broke.
    if (error) bodyNodes = [...bodyNodes, h('div', { key: '_error', class: 'chat-msg-notice is-error', role: 'alert' },
        h('span', {}, typeof error === 'string' ? error : 'this turn failed'),
        onRetry ? h('button', {
            type: 'button', class: 'chat-msg-retry-btn',
            onclick: (e) => { e.preventDefault(); onRetry(e); },
        }, 'retry') : null)];
    const reactionRow = reactions && reactions.length
        ? h('div', { class: 'chat-reactions' },
            // A bare <span> has no role, so it can carry no accessible name —
            // an aria-label here was silently DISCARDED and the whole reaction
            // announced as nothing, while aria-hidden suppressed the only real
            // text. So the visible label/count stay in the accessibility tree
            // as content, and an .sr-only span supplies just the wording the
            // visuals imply but do not spell out.
            ...reactions.map((r, i) => h('button', {
                type: 'button', class: 'rxn' + (r.you ? ' you' : ''), key: 'r' + i,
                'aria-pressed': String(!!r.you),
                title: (r.you ? 'remove your ' : 'add ') + r.emoji + ' reaction',
                onclick: onToggleReaction ? (e) => { e.preventDefault(); onToggleReaction(r.emoji); } : undefined,
            },
                h('span', { class: 'e' }, r.emoji),
                h('span', { class: 'n' }, String(r.count)),
                h('span', { class: 'sr-only' }, ` ${String(r.count) === '1' ? 'reaction' : 'reactions'}${r.you ? ', you reacted' : ''}`))))
        : null;
    const tickNode = resolvedWho === 'you' && receipt
        ? h('span', { class: 'tick' + (receipt === 'read' ? ' read' : ''), role: 'img', 'aria-label': receipt === 'read' ? 'message read' : 'message sent' }, Icon(receipt === 'read' ? 'check-check' : 'check', { size: 14 }))
        : null;
    const metaItems = [];
    if (name && resolvedWho === 'them') metaItems.push(h('span', { class: 'who', key: 'w' }, name));
    if (time) metaItems.push(h('span', { class: 't', key: 'ti' }, time));
    if (tickNode) metaItems.push(tickNode);
    const meta = metaItems.length ? h('div', { class: 'chat-meta' }, ...metaItems) : null;
    // Per-message actions (copy / retry / edit) — a hover-revealed control row
    // below the bubble, the way Claude-Desktop surfaces message-level actions.
    // Each action is { label, icon, onClick, title }. Kept icon-only with an
    // accessible name; no decorative glyphs (the Icon set is line-SVG).
    const actionRow = (actions && actions.length)
        ? h('div', { class: 'chat-msg-actions', role: 'group', 'aria-label': 'message actions' },
            ...actions.filter(Boolean).map((a, i) => h('button', {
                key: 'ma' + i, type: 'button', class: 'chat-msg-action',
                title: a.title || a.label, 'aria-label': a.label || a.title,
                onclick: (e) => {
                    e.preventDefault();
                    a.onClick && a.onClick(e);
                    // Copy is the highest-traffic per-message action and, unlike
                    // code-block/tool-result copy elsewhere in this file, had no
                    // self-contained visual feedback — a sighted/mouse user saw
                    // nothing happen. Flip the button's own label/icon the same
                    // way those sibling copy controls already do.
                    if (a.label === 'copy') {
                        const btn = e.currentTarget;
                        const labelEl = btn.querySelector('.chat-msg-action-label');
                        clearTimeout(btn._dsCopyTimer);
                        btn.classList.add('is-copied');
                        if (labelEl) labelEl.textContent = 'copied';
                        btn._dsCopyTimer = setTimeout(() => {
                            btn.classList.remove('is-copied');
                            if (labelEl) labelEl.textContent = 'copy';
                        }, 1600);
                    }
                },
            }, a.icon ? Icon(a.icon, { size: 14 }) : null,
               a.label ? h('span', { class: 'chat-msg-action-label' }, a.label) : null)))
        : null;
    // Flat layout leads the turn with a small role label (You / agent name)
    // above the content, the way claude.ai/code titles each turn.
    const roleLabel = isFlat
        ? h('div', { class: 'chat-role', key: '_role' }, resolvedWho === 'you' ? t('chat.roleYou', 'You') : (name || t('chat.roleAssistant', 'Assistant')))
        : null;
    const stack = h('div', { class: 'chat-stack' }, roleLabel, ...bodyNodes, reactionRow, actionRow, meta);
    // Centered roles (system/tool/thinking) skip the avatar column entirely so
    // the bubble owns the full row — the chrome reads as out-of-band signal,
    // not a participant turn.
    if (isCentered) return h('div', { key, class: cls }, stack);
    // Flat turns drop the avatar column entirely (full-width content).
    if (isFlat) return h('div', { key, class: cls }, stack);
    return h('div', { key, class: cls }, resolvedWho === 'you' ? stack : av, resolvedWho === 'you' ? av : stack);
}
