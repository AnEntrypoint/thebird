// Composer side-affordances that live in the DOM rather than the vnode tree:
// the queued transient note strip, the detected-attachment badge, the
// coarse-pointer probe that decides Enter-to-send vs Enter-for-newline, and
// the ticking m:ss streaming counter.

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

// Transient, non-blocking composer note (aria-live polite): e.g. a pasted image
// when no onPasteFiles handler is wired. Pure-DOM, auto-clears.
export function flashComposerNote(composerEl, text) {
    if (!composerEl) return;
    let note = composerEl.querySelector('.chat-composer-note');
    if (!note) {
        note = document.createElement('div');
        note.className = 'chat-composer-note';
        note.setAttribute('role', 'status');
        note.setAttribute('aria-live', 'polite');
        composerEl.appendChild(note);
    }
    // A single shared node means a second call before the first note's timeout
    // fires used to silently overwrite it (lost message, not just an early
    // dismiss). Queue instead: show immediately if idle, otherwise append and
    // let the display loop drain the queue in order.
    note._dsNoteQueue = note._dsNoteQueue || [];
    note._dsNoteQueue.push(text);
    if (note._dsNoteTimer) return; // already draining the queue
    const showNext = () => {
        const next = note._dsNoteQueue.shift();
        if (next === undefined) { note.remove(); note._dsNoteTimer = null; return; }
        note.textContent = next;
        note._dsNoteTimer = setTimeout(showNext, 2600);
    };
    showNext();
}

// Cached once per session: coarse-pointer (touch/no-hover) devices get a
// newline on Enter instead of send (mirrors the one-time-cache pattern
// editor-primitives.js uses for its own pointer/matchMedia checks).
let _coarsePointerCache = null;
export function isCoarsePointer() {
    if (_coarsePointerCache != null) return _coarsePointerCache;
    _coarsePointerCache = !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    return _coarsePointerCache;
}

// m:ss elapsed-time formatter for the streaming counter.
function fmtElapsedMs(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + String(s).padStart(2, '0');
}

// A small ticking `m:ss` counter, keyed off the streamingSince timestamp so a
// parent re-render does not reset the interval — the ref only (re)starts the
// interval when the timestamp actually changes, and clears it when streaming
// goes false or the node unmounts.
export function ChatComposerElapsed({ streamingSince }) {
    return h('span', {
        class: 'chat-composer-elapsed', role: 'status', 'aria-live': 'off',
        ref: (el) => {
            if (!el) return;
            if (el._dsElapsedTimer && el._dsElapsedSince === streamingSince) return; // already ticking for this timestamp
            if (el._dsElapsedTimer) clearInterval(el._dsElapsedTimer);
            el._dsElapsedSince = streamingSince;
            const tick = () => { el.textContent = fmtElapsedMs(Date.now() - streamingSince); };
            tick();
            el._dsElapsedTimer = setInterval(tick, 1000);
        },
    });
}

// detectAttachment(text) -> {type,label,id} runs on every input change; the
// badge above the textarea shows/clears based on its result, and clears
// outright when the textarea empties (mirrors the dismissible-badge pattern
// via a DOM-owned dismissed flag so a re-render with the same detection
// doesn't resurrect a badge the user just dismissed).
export function updateDetectedBadge(composerEl, text, detectAttachment) {
    if (!composerEl) return;
    let badge = composerEl.querySelector('.chat-composer-detected-badge');
    const detected = (text && detectAttachment) ? detectAttachment(text) : null;
    if (!detected) {
        if (badge) badge.remove();
        composerEl._dsDetectedId = null;
        return;
    }
    if (composerEl._dsDismissedId === detected.id) return; // user dismissed this exact detection
    if (composerEl._dsDetectedId === detected.id && badge) return; // unchanged
    composerEl._dsDetectedId = detected.id;
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'chat-composer-detected-badge';
        badge.setAttribute('role', 'status');
        composerEl.insertBefore(badge, composerEl.firstChild);
    }
    badge.textContent = '';
    const label = document.createElement('span');
    label.className = 'chat-composer-detected-label';
    label.textContent = detected.label;
    badge.appendChild(label);
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'chat-composer-detected-dismiss';
    dismiss.setAttribute('aria-label', 'dismiss ' + detected.label);
    dismiss.textContent = 'x';
    dismiss.onclick = (e) => { e.preventDefault(); composerEl._dsDismissedId = detected.id; badge.remove(); };
    badge.appendChild(dismiss);
}
