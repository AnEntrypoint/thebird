// ---------------------------------------------------------------------------
// InfoRow / InfoSection / DiagnosticsPanel — static debug/system-info
// readouts: a bordered section of label + monospace-value rows. Ported from
// docstudio's diagnostics page (auth/streaming/service-worker state, recent
// client errors, environment facts). Distinct from PropertyGrid, which is
// for EDITABLE properties — these rows are read-only display, never inputs.
// `data == null` (not yet loaded) renders a loading placeholder row instead
// of an empty section, so a panel never flashes an empty bordered box before
// its first data arrives; `onRefresh` renders a trailing refresh button that
// reuses the section's own header row rather than shifting layout beneath it.
// ---------------------------------------------------------------------------

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

export function InfoRow({ label, value, key } = {}) {
    return h('div', { key, class: 'ds-ep-inforow' },
        h('span', { class: 'ds-ep-inforow-label' }, label),
        h('span', { class: 'ds-ep-inforow-value' }, value == null || value === '' ? '—' : String(value)));
}

export function InfoSection({ title, rows, key } = {}) {
    const children = [
        title ? h('h3', { key: 'title', class: 'ds-ep-infosection-title' }, title) : null,
        rows == null
            ? h('div', { key: 'body-loading', class: 'ds-ep-infosection-loading', role: 'status' }, 'Loading…')
            : h('div', { key: 'body-rows', class: 'ds-ep-infosection-rows' }, ...rows.map((r, i) => InfoRow({ ...r, key: r.key != null ? r.key : i })))
    ].filter(Boolean);
    return h('section', { key, class: 'ds-ep-infosection' }, ...children);
}

export function DiagnosticsPanel({ title = 'Diagnostics', sections = [], onRefresh, refreshing = false, key } = {}) {
    const headChildren = [
        h('h2', { key: 'title', class: 'ds-ep-diagnostics-title' }, title),
        onRefresh ? h('button', {
            key: 'refresh', type: 'button', class: 'ds-ep-diagnostics-refresh', disabled: refreshing, 'aria-busy': refreshing ? 'true' : 'false',
            onclick: () => onRefresh()
        }, refreshing ? 'Refreshing…' : 'Refresh') : null
    ].filter(Boolean);
    return h('div', { key, class: 'ds-ep-diagnostics' },
        h('div', { key: 'head', class: 'ds-ep-diagnostics-head' }, ...headChildren),
        ...sections.map((s, i) => InfoSection({ ...s, key: s.key || i }))
    );
}
