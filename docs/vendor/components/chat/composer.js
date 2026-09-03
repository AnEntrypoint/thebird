// ChatComposer — the message input: controlled textarea with caret-safe value
// sync and auto-grow, the inline `:emoji` and `@file` autocomplete triggers,
// paste/drop file routing, the optional context line, and the send/stop
// toolbar. DOM-side affordances (notes, detected badge, elapsed counter,
// pointer probe) live in ./composer-affordances.js.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from '../shell.js';
import { EmojiPicker, CommandPalette } from '../overlay-primitives.js';
import { extractAtQuery, filterFileEntries, buildAtInsertText } from '../../file-mention.js';
import { flashComposerNote, isCoarsePointer, ChatComposerElapsed, updateDetectedBadge } from './composer-affordances.js';

const h = webjsx.createElement;

// Matches a trailing `:keyword` at the end of the composer draft (optionally
// preceded by whitespace/start-of-string) so typing `:smile` opens an inline
// filtered EmojiPicker without requiring the toolbar button or Ctrl+;.
const EMOJI_TRIGGER_RE = /(?:^|\s)(:([a-zA-Z0-9_+-]{0,24}))$/;

export function ChatComposer({ value, onInput, onSend, onEmoji, onCancel, busy, placeholder = 'message…', disabled, disabledReason, label, context, onPasteFiles, onDropFiles, streamingSince, detectAttachment, mentionFiles }) {
    // Keep a handle to the live textarea so send() reads the actual DOM value
    // (not the possibly-lagging `value` prop) and so we can sync the DOM value
    // only when it genuinely differs — re-applying `value` on every parent
    // re-render otherwise resets the caret and drops fast keystrokes.
    let taEl = null;
    const send = () => {
        const v = ((taEl && taEl.value) || value || '').trim();
        if (!v || disabled) return;
        if (onSend) onSend(v);
    };
    const triggerMatch = EMOJI_TRIGGER_RE.exec(value || '');
    // `@`-file-mention autocomplete: host supplies mentionFiles (a flat list of
    // {path,isDir} entries, or a plain string[] of paths — filterFileEntries
    // normalizes both), we own detection/filtering/insertion. Caret-position-
    // aware (extractAtQuery needs the text BEFORE the caret, not the whole
    // draft) so an "@" earlier in an already-sent-past part of the text doesn't
    // re-trigger after the cursor has moved on.
    const caretPos = taEl ? taEl.selectionStart : (value || '').length;
    const atQuery = mentionFiles ? extractAtQuery((value || '').slice(0, caretPos)) : null;
    // taEl is only assigned by taRef during DOM diffing, which happens AFTER
    // this render function returns — so on first paint of a trigger it is
    // still null here. Fall back to the live DOM textarea from the previous
    // paint (same composer, content patched in place) so the picker anchors
    // near the input instead of the viewport origin.
    const anchorEl = taEl || (typeof document !== 'undefined' ? document.querySelector('.chat-composer textarea') : null);
    const insertEmoji = (ch) => {
        const v = (taEl && taEl.value) || value || '';
        const m = EMOJI_TRIGGER_RE.exec(v);
        const next = m ? (v.slice(0, m.index) + (m[0].startsWith(':') ? '' : v[m.index]) + ch + ' ') : (v + ch);
        if (onInput) onInput(next);
        if (taEl) {
            // Programmatic .value= (like the draft-restore path) discards the
            // native undo stack the same way — surface that once, matching the
            // existing one-time draft-restore note pattern.
            try {
                if (!sessionStorage.getItem('ds.composer.undoNoteShown')) {
                    sessionStorage.setItem('ds.composer.undoNoteShown', '1');
                    flashComposerNote(taEl.closest('.chat-composer'), 'inserted — undo history does not include this insert');
                }
            } catch { /* swallow: sessionStorage unavailable (private mode etc) — skip the note */ }
            taEl.value = next;
            taEl.focus();
            taEl.selectionStart = taEl.selectionEnd = next.length;
        }
    };
    let autoGrowScheduled = false;
    const autoGrow = (e) => {
        const ta = e.target;
        if (onInput) onInput(ta.value);
        if (detectAttachment) updateDetectedBadge(ta.closest('.chat-composer'), ta.value, detectAttachment);
        // Debounce scrollHeight read with rAF to prevent sync reflow thrashing
        if (!autoGrowScheduled) {
            autoGrowScheduled = true;
            requestAnimationFrame(() => {
                ta.style.height = 'auto';
                // Respect the CSS max-height cap (120px in short-landscape via
                // app-shell.css) instead of a hardcoded 200px.
                const cap = parseFloat(getComputedStyle(ta).maxHeight) || 200;
                ta.style.height = Math.min(ta.scrollHeight, cap) + 'px';
                autoGrowScheduled = false;
            });
        }
    };
    const taRef = (el) => {
        if (!el) return;
        taEl = el;
        // Sync the controlled value into the DOM only when it actually differs,
        // so a re-render mid-type does not clobber the caret or pending input.
        const next = value || '';
        if (el.value !== next) el.value = next;
        el.style.height = 'auto';
        const cap = parseFloat(getComputedStyle(el).maxHeight) || 200;
        el.style.height = Math.min(el.scrollHeight, cap) + 'px';
        if (detectAttachment) updateDetectedBadge(el.closest('.chat-composer'), next, detectAttachment);
    };
    // Optional context line shown above the textarea: agent / model / cwd at the
    // point of typing (the way Claude-Desktop surfaces the active target inline).
    // `context` is { bits:[...], onClick? }. Bits may be plain strings (inert
    // text) or { text, onClick, title } objects — a bit with its own onClick
    // renders as an inline button (.chat-composer-context-bit) so e.g. the cwd
    // segment routes to the cwd editor WITHOUT making the whole line one giant
    // click target. Legacy whole-line context.onClick is honored only when no
    // bit carries its own handler. All children are keyed VElements.
    // Normalize FIRST (a bit may carry `text` or `label`), then drop empties -
    // separators must only ever sit between bits that actually render. An
    // object bit whose text resolved empty used to leave a dangling trailing
    // middot AND an invisible zero-width button.
    const ctxBits = ((context && context.bits) ? context.bits : [])
        .map((b) => {
            if (b == null) return null;
            if (typeof b === 'object') {
                const text = b.text || b.label || '';
                return text ? { text, onClick: b.onClick, title: b.title } : null;
            }
            const text = String(b);
            return text ? { text } : null;
        })
        .filter(Boolean);
    const hasBitClicks = ctxBits.some((b) => b.onClick);
    let contextLine = null;
    if (ctxBits.length && hasBitClicks) {
        const kids = [];
        ctxBits.forEach((b, i) => {
            if (i) kids.push(h('span', { key: 'csep' + i, class: 'chat-composer-context-sep', 'aria-hidden': 'true' }, ' · '));
            if (b.onClick) kids.push(h('button', {
                key: 'cbit' + i, type: 'button', class: 'chat-composer-context-bit',
                title: b.title || null, 'aria-label': b.title || b.text,
                onclick: (e) => { e.preventDefault(); b.onClick(e); },
            }, b.text));
            else kids.push(h('span', { key: 'cbit' + i, class: 'chat-composer-context-text' }, b.text));
        });
        contextLine = h('div', { class: 'chat-composer-context', role: 'group', 'aria-label': 'active session: ' + ctxBits.map((b) => b.text).join(', ') }, ...kids);
    } else if (ctxBits.length) {
        const joined = ctxBits.map((b) => b.text).join(' · ');
        contextLine = h(context.onClick ? 'button' : 'div', {
            class: 'chat-composer-context', type: context.onClick ? 'button' : null,
            'aria-label': context.onClick ? ('change target: ' + joined) : null,
            onclick: context.onClick ? (e) => { e.preventDefault(); context.onClick(e); } : null,
        }, joined);
    }
    const hasDraft = !!(value && value.trim());
    // Clamp the picker anchor to the visual viewport: with the on-screen
    // keyboard open the composer sits near the visual-viewport bottom, and on
    // narrow screens the picker width can overflow the right edge.
    const anchorRect = (anchorEl && anchorEl.getBoundingClientRect) ? anchorEl.getBoundingClientRect() : null;
    const vvWidth = (typeof window !== 'undefined')
        ? ((window.visualViewport && window.visualViewport.width) || window.innerWidth)
        : 0;
    const triggerPicker = triggerMatch ? EmojiPicker({
        open: true,
        anchorX: anchorRect ? Math.max(0, Math.min(anchorRect.left, vvWidth - 280)) : 0,
        anchorY: anchorRect ? Math.max(8, anchorRect.top - 8) : 0,
        query: triggerMatch[2] || '',
        onSelect: (ch) => insertEmoji(ch),
        onClose: () => { if (taEl) { const v = taEl.value.replace(EMOJI_TRIGGER_RE, (full, tail) => full.slice(0, full.length - tail.length)); if (onInput) onInput(v); taEl.value = v; taEl.focus(); } },
    }) : null;
    // insertMention: replace the in-progress @token (atQuery.start..caretPos)
    // with the built mention text, mirroring insertEmoji's DOM-authoritative
    // read/write-back so the native undo stack isn't clobbered any more than
    // the existing emoji path already accepts.
    const insertMention = (entry) => {
        const v = (taEl && taEl.value) || value || '';
        if (!atQuery) return;
        // buildAtInsertText returns {text, cursorOffset} — cursorOffset is
        // relative to the start of the inserted text, matching the emoji
        // path's absolute-caret style once added to atQuery.start.
        const { text: insertText, cursorOffset } = buildAtInsertText(entry.path, entry.isDir);
        const next = v.slice(0, atQuery.start) + insertText + v.slice(caretPos);
        if (onInput) onInput(next);
        if (taEl) {
            taEl.value = next;
            taEl.focus();
            const pos = atQuery.start + cursorOffset;
            taEl.selectionStart = taEl.selectionEnd = pos;
        }
    };
    const mentionEntries = atQuery ? filterFileEntries(mentionFiles, atQuery.query) : [];
    const mentionPicker = atQuery ? CommandPalette({
        open: true,
        items: mentionEntries.map((e) => ({ label: e.path, group: null, icon: e.isDir ? '📁' : null, _entry: e })),
        onSelect: (it) => insertMention(it._entry),
        onClose: () => { if (taEl) { const v = taEl.value.slice(0, atQuery.start) + taEl.value.slice(caretPos); if (onInput) onInput(v); taEl.value = v; taEl.focus(); taEl.selectionStart = taEl.selectionEnd = atQuery.start; } },
    }) : null;
    return h('div', {
        class: 'chat-composer' + (hasDraft ? ' has-draft' : '') + (disabled ? ' is-disabled' : ''),
        // A drop on the composer must NEVER navigate the browser away from the
        // live session: preventDefault on both dragover and drop, route files to
        // the optional onDropFiles handler, ring via .dragover.
        ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('dragover'); },
        ondragleave: (e) => { e.currentTarget.classList.remove('dragover'); },
        ondrop: (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('dragover');
            const files = e.dataTransfer && e.dataTransfer.files;
            if (files && files.length) {
                if (onDropFiles) onDropFiles(files);
                else flashComposerNote(e.currentTarget, 'dropped files are not supported here yet');
            }
        },
    },
        contextLine,
        triggerPicker,
        mentionPicker,
        h('textarea', { ref: taRef, placeholder, rows: 1,
            'aria-label': label || (disabled && disabledReason ? 'message input — ' + disabledReason : 'message input'),
            disabled: !!disabled, 'aria-disabled': disabled ? 'true' : null,
            oninput: autoGrow,
            onpaste: (e) => {
                const cd = e.clipboardData;
                // If the clipboard contains files, always route them — even when
                // text is also present (some apps attach a filename as text).
                if (cd && cd.files && cd.files.length) {
                    e.preventDefault();
                    if (onPasteFiles) onPasteFiles(cd.files);
                    else flashComposerNote(e.currentTarget.closest('.chat-composer'), 'images are not supported yet');
                    return;
                }
                // Large plain-text pastes (e.g. a whole file/log dropped into the
                // composer) get no feedback otherwise — the textarea just grows to
                // its max-height cap with no signal of how much landed. Note the
                // character count; this does not change any truncation behavior.
                const text = cd && cd.getData ? cd.getData('text/plain') : '';
                if (text && text.length > 2000) {
                    flashComposerNote(e.currentTarget.closest('.chat-composer'), 'pasted ' + text.length + ' characters');
                }
            },
            onkeydown: (e) => {
                // Escape blurs the textarea when idle; stops generation when busy.
                if (e.key === 'Escape') {
                    if (!busy) { e.currentTarget.blur(); return; }
                    if (onCancel) { e.preventDefault(); onCancel(e); return; }
                }
                // IME guard: the Enter that commits a CJK composition must never
                // send (isComposing; keyCode 229 covers older engines).
                // Coarse-pointer (touch) devices get a newline on Enter instead of
                // send — there is no keyboard shortcut discoverability benefit on
                // touch, and Enter-to-send is a frequent accidental-send source on
                // phones/tablets where "Tap Send to send" is the predictable model.
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !isCoarsePointer()) { e.preventDefault(); send(); }
                if (e.key === ';' && e.ctrlKey) { e.preventDefault(); onEmoji && onEmoji(e); }
            } }),
        // Enter-to-send affordance (Claude-Desktop style): a muted hint visible
        // at rest so it's discoverable without focusing the composer first;
        // hidden under 420px (CSS) to save rows. Middot is kept product typography.
        h('div', { class: 'chat-composer-hint' }, isCoarsePointer() ? 'Tap Send to send' : 'Enter to send · Shift+Enter for a new line'),
        (busy && streamingSince) ? ChatComposerElapsed({ streamingSince }) : null,
        h('div', { class: 'chat-composer-toolbar' },
            onEmoji ? h('button', { type: 'button', class: 'composer-btn', onclick: (e) => { e.preventDefault(); onEmoji(e); }, 'aria-label': 'emoji picker', title: 'emoji picker (Ctrl+;)' }, Icon('smile')) : null,
            busy && onCancel
                ? h('button', { type: 'button', class: 'send cancel', onclick: (e) => { e.preventDefault(); onCancel(e); }, 'aria-label': 'stop generating', title: 'stop generating (Esc)' }, Icon('square'))
                : h('button', { type: 'button', class: 'send', disabled: disabled || !(value && value.trim()), onclick: send,
                    'aria-label': disabled && disabledReason ? 'send message (' + disabledReason + ')' : 'send message',
                    title: disabled && disabledReason ? 'send message (' + disabledReason + ')' : 'send message (Enter)' }, Icon('arrow-up'))
        )
    );
}
