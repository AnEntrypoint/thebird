// Shared render helpers used by every freddie page module: the `section`
// Panel wrapper, the alert/refresh/live-region chrome, and the truncation
// vocabulary (named widths + the span/JSON renderers that carry the full
// text in a title tooltip).

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Panel } from '../content.js';
import { Btn, Icon } from '../shell.js';

const h = webjsx.createElement;

export const section = (title, ...children) => Panel({ title, children: children.flat().filter(Boolean) });
export const noteAlert = (note) => note ? h('div', { class: 'ds-alert ds-alert-' + note.kind, role: 'alert' },
    h('span', { class: 'ds-alert-icon' }, '!'),
    h('div', { class: 'ds-alert-content' }, note.msg)) : null;
// Manual refresh button for non-polling pages — parity with auto-refreshing ones.
export const refreshBtn = (onClick, busy) => Btn({ children: busy ? 'refreshing…' : [Icon('refresh'), ' refresh'], disabled: !!busy, onClick, 'aria-label': 'refresh' });
// Polite live region announcing async busy/done state to screen readers.
export const liveRegion = (msg) => h('div', { class: 'fd-sr-live', role: 'status', 'aria-live': 'polite' }, msg || '');
// Truncate with a title tooltip carrying the full text.
export const trunc = (s, n = 90) => { const str = String(s || ''); return str.length > n ? { text: str.slice(0, n) + '…', title: str } : { text: str, title: null }; };
// Named truncation widths so list pages cap display consistently (and any
// raw .slice(0,N) on user text routes through trunc() for ellipsis + tooltip).
export const TRUNC_TITLE = 60;   // session/skill/tool titles
export const TRUNC_SUB = 80;     // row sub-text (prompts, descriptions)
export const TRUNC_OUTPUT = 70;  // batch output cells
export const TRUNC_DESC = 90;    // long descriptions
export const TRUNC_PROMPT = 50;  // batch prompt cells
// Render trunc() result as a span carrying the full text in its title tooltip.
export const truncSpan = (s, n) => { const t = trunc(s, n); return h('span', { title: t.title }, t.text); };
// Cap a raw JSON dump for an inline table cell without losing the data via tooltip.
export const truncJson = (v, n = TRUNC_TITLE) => truncSpan(JSON.stringify(v), n);
