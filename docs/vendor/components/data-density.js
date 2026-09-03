// Data-density components: dense observability/dashboard primitives ported
// from the gmsniff GUI (phase-walk, tree timeline, bar charts, KPI tiles,
// sub-nav grid, session rows, deviation callouts, live log stream). Pure
// factories — props in, webjsx vnode out. Theme-aware: every color rides a
// semantic var(--token) from colors_and_type.css, never a raw hex literal.
// CSS lives in app-shell.css under the "data density" section (ds- prefix
// keeps scripts/lint-classes.mjs passing without a PREFIXES change).

import * as webjsx from '../../vendor/webjsx/index.js';
import { Pill } from './shell.js';
import { Progress } from './data-density/progress.js';
const h = webjsx.createElement;

export { Progress };

// ---------------------------------------------------------------------------
// PhaseWalk — compact horizontal phase-progress indicator.
//   phases  : ordered phase names (default the 5-stage gm chain).
//   reached : bool[] parallel to phases — true once that phase has been hit.
//   gapKinds: phase names that are a known gap (red), overrides reached.
// ---------------------------------------------------------------------------
export const DEFAULT_PHASES = ['PLAN', 'EXECUTE', 'EMIT', 'VERIFY', 'CONSOLIDATE', 'COMPLETE'];

export function PhaseWalk({ phases = DEFAULT_PHASES, reached = [], gapKinds = [] } = {}) {
    const gaps = new Set(gapKinds || []);
    return h('div', { class: 'ds-phasewalk', role: 'group', 'aria-label': 'phase progress' },
        ...phases.map((p, i) => {
            const isGap = gaps.has(p);
            const isReached = Boolean(reached[i]);
            const cls = 'ds-phasewalk-seg' + (isGap ? ' is-gap' : (isReached ? ' is-reached' : ''));
            const title = p + (isGap ? ' (gap)' : (isReached ? ' (reached)' : ' (not reached)'));
            return h('span', { key: p, class: cls, title },
                h('span', { class: 'ds-phasewalk-lbl', 'aria-hidden': 'true' }, p.charAt(0)));
        }));
}

// ---------------------------------------------------------------------------
// TreeNode — indented timeline/tree entry with left-border variant coloring.
//   variant: '' | 'phase' | 'deviation' | 'mutable-resolve' | 'prd-add'
//   residuals: array of strings, joined with ", " when present.
// ---------------------------------------------------------------------------
export function TreeNode({ ts, kind, variant = '', phase, id, keyLabel, reason, deviationLabel, residuals } = {}) {
    const cls = 'ds-tree-node' + (variant ? ' is-' + variant : '');
    const pills = [
        phase ? Pill({ key: 'phase', children: phase }) : null,
        id ? Pill({ key: 'id', children: id }) : null,
        keyLabel ? Pill({ key: 'key', children: keyLabel }) : null,
    ].filter(Boolean);
    return h('div', { class: cls },
        ts != null ? h('span', { class: 'ds-tree-node-ts' }, ts) : null,
        h('strong', {}, kind),
        pills.length ? h('span', { class: 'ds-tree-node-pills' }, ...pills) : null,
        reason ? h('div', { class: 'ds-tree-node-reason' }, reason) : null,
        deviationLabel ? h('div', { class: 'ds-tree-node-deviation' }, h('strong', {}, deviationLabel)) : null,
        (residuals && residuals.length) ? h('div', { class: 'ds-tree-node-residuals' }, residuals.join(', ')) : null);
}

// ---------------------------------------------------------------------------
// BarRow — inline horizontal bar-chart row (label + track + value).
//   tone: a CSS color value (var(--token) or color-mix expression) — never a
//   bare hex string should be passed by a caller; the component itself never
//   hardcodes one.
// ---------------------------------------------------------------------------
export function BarRow({ label, value, pct = 0, tone } = {}) {
    const clamped = Math.max(0, Math.min(100, pct));
    return h('div', {
        class: 'ds-bar-row', role: 'meter', 'aria-label': label != null ? String(label) : 'value',
        'aria-valuenow': String(clamped), 'aria-valuemin': '0', 'aria-valuemax': '100',
    },
        h('span', { class: 'ds-bar-row-label', style: tone ? `color:${tone}` : null }, label),
        h('div', { class: 'ds-bar-bg', 'aria-hidden': 'true' },
            h('div', { class: 'ds-bar-fill', style: `width:${clamped}%` + (tone ? `;background:${tone}` : '') })),
        h('span', { class: 'ds-bar-row-value', 'aria-hidden': 'true' }, value));
}

// ---------------------------------------------------------------------------
// RateCell — a tone-colored numeric cell for dense admin/observability tables
// (percentile latency columns, success-rate columns). Ported from docstudio's
// admin-observability-views.js endpointsView() success-rate coloring, which
// had no kit equivalent: a plain Table cell has no notion of a value implying
// good/warn/bad. Host computes the tone (this component has no opinion on
// thresholds, matching Table's onSort host-owns-logic convention) and passes
// it plus the display text; renders inline so it drops into any Table row.
// ---------------------------------------------------------------------------
export function RateCell({ value, tone = 'neutral' } = {}) {
    const cls = 'ds-rate-cell ds-rate-cell-' + tone;
    return h('span', { class: cls }, value == null ? '–' : String(value));
}

// ---------------------------------------------------------------------------
// StatTile / StatsGrid — compact KPI tiles, denser than the existing .kpi.
//   cls on StatTile selects an accent variant: '' | 'rate-big' | 'err-rate'.
// ---------------------------------------------------------------------------
export function StatTile({ val, lbl, cls = '' } = {}) {
    return h('div', { class: 'ds-stat', role: 'group', 'aria-label': `${lbl || 'stat'}: ${val}` },
        h('div', { class: 'ds-stat-val' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, val),
        h('div', { class: 'ds-stat-lbl', 'aria-hidden': 'true' }, lbl));
}

export function StatsGrid({ items = [] } = {}) {
    if (!items.length) return h('div', { class: 'ds-stats-grid ds-stats-grid-empty' },
        h('span', { class: 'ds-stat-lbl' }, 'no stats'));
    return h('div', { class: 'ds-stats-grid', role: 'group', 'aria-label': 'stats' },
        ...items.map((it, i) => h('div', { key: it.key || i }, StatTile(it))));
}

// ---------------------------------------------------------------------------
// SubGrid — small button grid: big number + label, for category navigation.
// ---------------------------------------------------------------------------
export function SubGrid({ items = [] } = {}) {
    if (!items.length) return h('div', { class: 'ds-sub-grid ds-sub-grid-empty' },
        h('span', { class: 'ds-stat-lbl' }, 'no items'));
    return h('div', { class: 'ds-sub-grid', role: 'group', 'aria-label': 'categories' },
        ...items.map((it, i) => h('button', {
            key: it.key || i, type: 'button', class: 'ds-sub-btn',
            onclick: it.onClick || null,
            'aria-label': `${it.label}: ${String(it.count)}`,
        }, h('span', { 'aria-hidden': 'true' }, String(it.count)), it.label)));
}

// ---------------------------------------------------------------------------
// SessionRow — compact single-line session summary row.
//   phaseWalkProps: props forwarded to PhaseWalk for the inline phase strip.
// ---------------------------------------------------------------------------
export function SessionRow({ sessId, phaseWalkProps, events, verbs, prd, muts, resid, deviations, firstTs, lastTs, onClick } = {}) {
    const counts = [
        events != null ? events + ' ev' : null,
        verbs != null ? verbs + ' verb' : null,
        prd != null ? prd + ' prd' : null,
        muts != null ? muts + ' mut' : null,
        resid != null ? resid + ' resid' : null,
    ].filter(Boolean).join(' · ');
    // Keyboard activation parity: role=button + tabindex without onkeydown is
    // announced as a button but inert to Enter/Space (mirrors Table()).
    return h('div', {
        class: 'ds-session-row', onclick: onClick || null,
        role: onClick ? 'button' : null, tabindex: onClick ? '0' : null,
        onkeydown: onClick ? (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onClick(e); } } : null,
        'aria-label': onClick ? `session ${sessId}: ${counts}` : null,
    },
        h('span', { class: 'ds-session-row-id' }, sessId),
        h('span', { class: 'ds-session-row-counts' }, counts),
        (deviations != null && deviations !== 0) ? h('span', { class: 'ds-session-row-devcnt' }, String(deviations) + ' dev') : null,
        phaseWalkProps ? PhaseWalk(phaseWalkProps) : null,
        (firstTs || lastTs) ? h('span', { class: 'ds-session-row-span' }, [firstTs, lastTs].filter(Boolean).join(' -> ')) : null);
}

// ---------------------------------------------------------------------------
// DevRow — deviation/error callout row. Uses the danger-surface token, never
// a bare hex background.
// ---------------------------------------------------------------------------
export function DevRow({ ts, event, sess, operation, residuals } = {}) {
    const pills = [
        sess ? Pill({ key: 'sess', children: sess }) : null,
        operation ? Pill({ key: 'op', children: operation }) : null,
    ].filter(Boolean);
    return h('div', { class: 'ds-dev-row' },
        ts != null ? h('span', { class: 'ds-tree-node-ts' }, ts) : null,
        h('strong', {}, event),
        pills.length ? h('span', { class: 'ds-tree-node-pills' }, ...pills) : null,
        (residuals && residuals.length) ? h('div', { class: 'ds-tree-node-residuals' }, residuals.join(', ')) : null);
}

// ---------------------------------------------------------------------------
// LiveLog / LiveLogEntry — scrollable dense log stream with a colored
// subsystem tag + bold event name + muted payload preview.
//   entries[i].tone is a CSS color value; the background derives from it via
//   color-mix at render time (no raw "#hex22" alpha-suffix hack).
// ---------------------------------------------------------------------------
export function LiveLogEntry({ ts, sub, tone, event, preview } = {}) {
    const tagStyle = tone
        ? `background:color-mix(in oklab, ${tone} 18%, transparent);color:${tone}`
        : null;
    return h('div', { class: 'ds-live-log-entry' },
        h('span', { class: 'ds-live-log-ts' }, ts),
        sub ? h('span', { class: 'ds-live-log-subtag', style: tagStyle }, sub) : null,
        h('strong', {}, event),
        preview ? h('span', { class: 'ds-live-log-preview' }, preview) : null);
}

export function LiveLog({ entries = [], autoScroll = true } = {}) {
    const seedScroll = (el) => {
        if (!el || !autoScroll) return;
        el.scrollTop = el.scrollHeight;
    };
    if (!entries.length) return h('div', { class: 'ds-live-log ds-live-log-empty' },
        h('span', { class: 'ds-stat-lbl' }, 'no log entries'));
    return h('div', { class: 'ds-live-log', ref: seedScroll, role: 'log', 'aria-label': 'live log' },
        ...entries.map((e, i) => h('div', { key: e.key || i }, LiveLogEntry(e))));
}
