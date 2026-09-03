// Panel family — the bordered content container (`Panel`, aliased `Card`),
// the section wrapper (`Section`), the items[]-to-rows mapper
// (`PanelFromItems`), and the two tabular panel bodies that only ever appear
// inside one (`Receipt` key/value table, `Changelog` release list).

import * as webjsx from '../../../vendor/webjsx/index.js';
import { RowLink } from './row.js';
const h = webjsx.createElement;

export function Panel({ title, count, right, style = '', class: className = '', children, kind, id, headingLevel = 2 }) {
    const cls = 'panel' + (kind ? ' panel-' + kind : '') + (className ? ' ' + className : '');
    // title renders as a real heading (h2 by default; `headingLevel` lets a
    // caller nest a Panel under an existing h2/h3 without skipping a level) so
    // a screen-reader heading-jump can actually find each section, not just
    // the page's single top-level h1.
    const headingTag = 'h' + headingLevel;
    return h('div', { class: cls, style, ...(id ? { id } : {}) },
        title != null ? h('div', { class: 'panel-head' },
            h(headingTag, { class: 'panel-title' }, title),
            right != null ? right : (count != null ? h('span', { class: 'ds-badge' }, String(count)) : null)
        ) : null,
        h('div', { class: 'panel-body' }, ...(Array.isArray(children) ? children : [children]))
    );
}

// Card — semantic alias of Panel; behaves identically.
export const Card = Panel;

// PanelFromItems — the shared 'items[] -> RowLink wrapped in Panel' mapper
// every portfolio consumer theme.mjs (zellous/wireweave/thebird/247420) had
// hand-rolled identically: items.map((it,i) => RowLink({code, title, sub,
// meta, href})) inside a titled Panel. `keyPrefix` seeds each row's stable
// key (`${keyPrefix}${i}`), matching the consumer convention of a
// one-letter-per-section prefix (e.g. 'f' for features, 'm' for modules).
// Field aliasing mirrors the union of shapes actually hand-rolled downstream:
// title reads `title` then `name`; sub reads `sub` then `desc`; code falls
// back to a zero-padded 1-based index when the item carries none. `heading`/
// `count`/`style`/`kind` pass through to Panel unchanged.
export function PanelFromItems({ heading, items = [], keyPrefix = 'i', count, style, kind, emptyText } = {}) {
    if (!items || !items.length) return emptyText != null ? h('div', { class: 'empty' }, emptyText) : null;
    const rows = items.map((it, i) => {
        const codeVal = it.code != null ? it.code : (it.rank != null ? it.rank : String(i + 1).padStart(2, '0'));
        return RowLink({
            key: keyPrefix + i,
            code: codeVal,
            title: it.title != null ? it.title : it.name,
            sub: it.sub != null ? it.sub : (it.desc != null ? it.desc : ''),
            meta: it.meta != null ? it.meta : '',
            href: it.href || '#'
        });
    });
    return Panel({ title: heading, count, style, kind, children: rows });
}

export function Section({ title, eyebrow, children, id }) {
    return h('section', { class: 'ds-section', ...(id ? { id } : {}) },
        eyebrow ? h('span', { class: 'eyebrow' }, eyebrow) : null,
        title ? h('h3', {}, title) : null,
        ...(Array.isArray(children) ? children : [children])
    );
}

export function Receipt({ rows = [], emptyText = 'nothing here yet' }) {
    if (!rows.length) return h('div', { class: 'empty' }, emptyText);
    return h('table', { class: 'kv' },
        h('tbody', {}, ...rows.map(([k, v], i) =>
            h('tr', { key: i }, h('td', {}, k), h('td', {}, v))
        ))
    );
}

export function Changelog({ entries = [], emptyText = 'no changelog entries yet' }) {
    if (!entries.length) return h('div', { class: 'empty' }, emptyText);
    return Panel({
        kind: 'wide',
        children: entries.map((e, i) =>
            h('div', { key: i, class: 'row ds-changelog-row' },
                h('span', { class: 'code' }, e.date),
                h('span', { class: 'ds-changelog-ver' }, e.ver),
                h('span', { class: 'title' }, e.msg)
            )
        )
    });
}
