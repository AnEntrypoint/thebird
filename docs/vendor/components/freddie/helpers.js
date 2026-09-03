// Freddie helpers — shared registry/localStorage/render helpers used by both
// the freddie component surface (src/components/freddie.js) and the OS kit's
// freddie pages (src/kits/os/freddie/*.js). Canonical merged location: this
// module previously had a diverged twin at src/kits/os/freddie/helpers.js
// (pre/form/getRecentPaths/saveRecentPath/skillLabel) that re-implemented the
// same localStorage-recent-paths + skill-label concerns with different keys
// and a different skillLabel() call shape; merged here so both surfaces
// share one behavior.

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

// The ONE eyebrow on the freddie surface, and it earns it by being the only
// label that varies: `freddie · <id>` names the specific unimplemented route,
// which is the whole point of a stub — the reader needs to know WHICH page
// failed to resolve, and the <h2> below only shows a human title. The real
// freddie pages (src/components/freddie.js) deliberately carry NO eyebrow:
// there, the kicker was the constant string 'freddie' on all 22 headers, which
// named nothing the topbar/crumb did not already say. Do not add siblings.
export function renderPageStub({ id, title }) {
    return h('div', { class: 'ds-freddie-stub' },
        h('span', { class: 'eyebrow' }, 'freddie · ' + id),
        h('h2', {}, title || id),
        h('p', { class: 'dim' }, 'this page renderer is a stub. consumers override it on their own freddie router.')
    );
}

// pre() / form() — small raw-DOM helpers used by the OS kit's freddie pages
// (JSON dumps, quick add-forms) that don't need the full component barrel.
export function pre(obj) {
    return h('pre', { class: 'fd-pre' }, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

export function form(opts) {
    const { fields = [], submit = 'submit', onSubmit } = opts;
    return h('form', { class: 'row-form', onsubmit: (ev) => { ev.preventDefault(); onSubmit && onSubmit(ev); } },
        ...fields.map(f => f.kind === 'textarea'
            ? h('textarea', { name: f.name, placeholder: f.placeholder || '', rows: f.rows || 4 })
            : h('input', { name: f.name, type: f.type || 'text', placeholder: f.placeholder || '', value: f.value || '', required: f.required ? 'true' : null })),
        h('button', { type: 'submit', class: 'btn-primary' }, submit));
}

const SKILL_SLUG_LABELS = {
    transcribe: 'transcribe',
    summarize:  'summarize',
    translate:  'translate',
    extract:    'extract',
    classify:   'classify',
};

// skillLabel() accepts EITHER call shape used by existing call sites:
//   skillLabel('transcribe')             -> looks up the static slug map
//   skillLabel({ name, shortName })      -> derives a display label from a
//                                           freddie skill object (OS kit's
//                                           pages-core/-tools/-chat usage)
// Additive/widened on purpose: never narrows either existing signature.
export function skillLabel(input) {
    if (input && typeof input === 'object') {
        if (input.shortName) return input.shortName;
        const n = input.name || '';
        return n.replace(/^gm:/, '').replace(/^software-development$/, 'software dev').replace(/-/g, ' ');
    }
    return SKILL_SLUG_LABELS[input] || input;
}

// Recent-cwd localStorage helpers. The two diverged copies used different
// keys (ds247420.recent.paths vs fd_recent_cwds) and different caps (10 vs
// 5) — keep the fd_recent_cwds key + cap 5 since that is the one every real
// call site (the OS kit's freddie chat page) actually reads/writes; a
// consumer of the ds247420.recent.paths key never existed (grep-confirmed
// zero other readers), so this is a safe consolidation, not a behavior cut.
const RECENT_KEY = 'fd_recent_cwds';
const RECENT_CAP = 5;

export function getRecentPaths() {
    if (typeof localStorage === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
    catch { return []; }
}

export function saveRecentPath(path) {
    if (typeof localStorage === 'undefined' || !path) return;
    const list = getRecentPaths().filter(p => p !== path);
    list.unshift(path);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_CAP))); } catch { /* swallow: persistence is best-effort, recent-path history is non-critical */ }
}

// Helper used by consumers that want to render chat-message arrays with
// our ChatMessage factory but pre-formatted for freddie's data shape.
export function renderChatMessages(messages = [], opts = {}) {
    // Import lazily to keep this module light.
    return import('../chat.js').then(({ ChatMessage }) =>
        messages.map((m, i) => ChatMessage({ ...m, key: m.key != null ? m.key : i, ...opts }))
    );
}
