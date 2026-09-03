// ContextXRayPanel — per-segment expandable/collapsible breakdown list.
// Reuses editor-primitives/collapse.js's CollapseGroup for the actual
// expand/collapse behavior (single-open-at-a-time accordion) rather than
// reimplementing that state machine; this module only supplies the
// segment-row content (label, value, sub-items) that goes inside each
// Collapse body.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { CollapseGroup } from '../editor-primitives/collapse.js';
const h = webjsx.createElement;

// ContextXRayPanel({ segments, openId, onOpenIdChange })
//   segments: [{ id, label, value, tone, items: [{ label, value }] }]
//   openId/onOpenIdChange: accordion state, forwarded straight to CollapseGroup.
export function ContextXRayPanel({ segments = [], openId, onOpenIdChange } = {}) {
    if (!segments.length) return h('div', { class: 'ds-context-xray-empty' }, 'no segments yet');
    const items = segments.map((seg) => ({
        id: seg.id,
        title: h('span', { class: 'ds-context-xray-head' },
            h('span', { class: 'ds-context-xray-dot ds-context-xray-dot-' + (seg.tone || 'other') }),
            h('span', { class: 'ds-context-xray-label' }, seg.label),
            h('span', { class: 'ds-context-xray-value' }, String(seg.value))),
        children: h('div', { class: 'ds-context-xray-body' },
            ...(seg.items || []).map((it, i) => h('div', { key: i, class: 'ds-context-xray-row' },
                h('span', {}, it.label),
                h('span', {}, String(it.value))))),
    }));
    return h('div', { class: 'ds-context-xray' },
        CollapseGroup({ items, openId, onOpenChange: onOpenIdChange, accordion: true }));
}
