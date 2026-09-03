// SessionCard — one running session on the live dashboard: status disc, agent /
// model / cwd, elapsed + live counters, cost/tokens, last activity, and the
// per-session controls that each act on this session's id independently.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Btn, Icon } from '../shell.js';
import { formatNumber } from '../../locale.js';
import { fmtDuration, STATUS_WORD, STATUS_DISC } from './format.js';
const h = webjsx.createElement;

// SessionCard — one running session in the live dashboard. Status dot, agent /
// model / cwd, elapsed, live counter, last activity, and per-session controls
// that each act on this session's id independently.
//
//   session : { sid, agent, model, cwd, elapsed, counter, lastActivity, currentTool, status }
//   actions : { onStop, onOpen, onResume, onView } (any subset)
// `counter` carries the live activity tally (e.g. "12 ev · 3 tools"); `lastActivity`
// the relative time of the most-recent event ("4s ago"); `currentTool` the tool
// name a still-running turn is executing - together they distinguish a busy
// session from a stuck one (a frozen elapsed alone reads identically for both).
// `session.stopping` is the in-flight cancel state: the stop button disables
// with label 'stopping…' and the status word flips to 'stopping', so the click
// visibly took and cannot re-fire while the host waits for the active poll.
// `session.external` marks a session we observe (ccsniff stream) but do not own
// (no process to kill): the stop button is suppressed, an 'external' tag renders
// in the head, and the host wires onView to open it in history instead.
// `session.title` is the SAME string the conversation rails use, rendered as
// the card heading so the rail row and its dashboard card share one identity.
// `session.elapsedMs` (raw ms) is formatted internally via fmtDuration; the
// pre-formatted `elapsed` string remains as a legacy fallback.
// `density` trades vertical space for scannability, the same list/compact axis
// FileGrid already exposes:
//   'comfortable' (default) — the full card: title, head, meta, per-card actions.
//   'compact'               — one line per session. Measured on a real 16-session
//                             dashboard the comfortable card renders 208px tall,
//                             so a 439px viewport shows two sessions; the point of
//                             a command center is scanning many at once. Compact
//                             keeps every FACT (status, agent, cwd, elapsed,
//                             activity) and drops only the per-card action row,
//                             which is reachable by opening the session.
export function SessionCard({ session = {}, onStop, onOpen, onView, active = false,
                             selectable = false, selected = false, onToggleSelect,
                             density = 'comfortable' } = {}) {
  const s = session;
  const compact = density === 'compact';
  const st = s.stopping ? 'stopping' : (s.status === 'error' ? 'error' : (s.status === 'stale' ? 'stale' : 'running'));
  // The stat line composes elapsed + live counter; the activity line carries the
  // last-activity time and the current tool so a card shows MOTION, not just a
  // start offset. Both are middot-joined (kept product separator).
  const elapsedText = s.elapsedMs != null ? fmtDuration(s.elapsedMs) : (s.elapsed != null ? s.elapsed : null);
  // At-a-glance cost/usage (the prompt's named command-center signal). Null-safe:
  // sessions with no cost source (external tally rows) simply omit the segment.
  const tokText = s.tokens != null ? (typeof s.tokens === 'number' ? formatNumber(s.tokens) : s.tokens) + ' tok' : null;
  const costText = s.cost != null ? (typeof s.cost === 'number' ? '$' + s.cost.toFixed(4) : String(s.cost)) : null;
  // Cost is rendered as its own emphasized segment (not buried in the mono run)
  // so the command-center cost-at-a-glance signal is scannable.
  const statBits = [elapsedText, s.counter != null ? s.counter : null, tokText].filter((x) => x != null && x !== '');
  const activityBits = [
    s.currentTool ? 'running: ' + s.currentTool : null,
    s.lastActivity ? 'last ' + s.lastActivity : null,
  ].filter(Boolean);
  const cls = 'ds-dash-card is-' + st + (compact ? ' is-compact' : '') + (active ? ' is-active' : '') + (selected ? ' is-selected' : '') + (s.external ? ' is-external' : '') + (s.isNew ? ' is-new' : '');
  // EVERY children array is filter(Boolean)'d: webjsx applyDiff crashes
  // (reading 'key') on a bare null among VElement siblings, so a null cwd /
  // model / external flag must never reach a positional child slot.
  const head = h('div', { class: 'ds-dash-card-head' }, ...[
    selectable ? h('button', {
      type: 'button', class: 'ds-dash-select', role: 'checkbox',
      'aria-checked': selected ? 'true' : 'false',
      'aria-label': (selected ? 'deselect' : 'select') + ' session ' + (s.title || s.agent || s.sid),
      onclick: () => onToggleSelect && onToggleSelect(s),
    }, h('span', { class: 'ds-check-box', 'aria-hidden': 'true' })) : null,
    h('span', { class: 'status-dot-disc ' + STATUS_DISC[st], 'aria-hidden': 'true' }),
    h('span', { class: 'ds-dash-status is-' + st }, STATUS_WORD[st]),
    s.external ? h('span', { class: 'ds-dash-external' }, 'external') : null,
    h('span', { class: 'ds-dash-agent', title: s.agent || null }, s.agent || 'agent'),
    s.model ? h('span', { class: 'ds-dash-model', title: s.model }, s.model) : null,
  ].filter(Boolean));
  const meta = h('div', { class: 'ds-dash-meta' }, ...[
    s.cwd ? h('span', { class: 'ds-dash-cwd', title: s.cwd }, s.cwd) : null,
    (statBits.length || costText) ? h('span', { class: 'ds-dash-stat' },
      ...[
        statBits.length ? statBits.join(' · ') : null,
        (statBits.length && costText) ? ' · ' : null,
        costText ? h('span', { class: 'ds-dash-stat-cost' }, costText) : null,
      ].filter(Boolean)
    ) : null,
    activityBits.length ? h('span', { class: 'ds-dash-activity' }, activityBits.join(' · ')) : null,
  ].filter(Boolean));
  const actions = h('div', { class: 'ds-dash-actions', role: 'group', 'aria-label': 'session actions' }, ...[
    onOpen ? Btn({ key: 'open', variant: 'primary', 'aria-label': 'open session', onClick: () => onOpen(s),
      children: [Icon('external-link', { size: 14 }), h('span', {}, 'open')] }) : null,
    onView ? Btn({ key: 'view', 'aria-label': s.external ? 'open in history' : 'view events', onClick: () => onView(s),
      children: [Icon('file-text', { size: 14 }), h('span', {}, s.external ? 'history' : 'events')] }) : null,
    (onStop && !s.external) ? Btn({ key: 'stop', variant: 'danger', disabled: !!s.stopping, 'aria-label': 'stop session',
      onClick: () => !s.stopping && onStop(s),
      children: [Icon('square', { size: 14 }), h('span', {}, s.stopping ? 'stopping…' : 'stop')] }) : null,
  ].filter(Boolean));
  // Compact keeps head + meta on ONE row and drops the action group; the title
  // rides as the element's own accessible name (already set below) rather than
  // taking a line of its own, so nothing is lost, only re-laid-out.
  const children = compact
    ? [head, meta].filter(Boolean)
    : [
        s.title ? h('div', { class: 'ds-dash-title', title: s.title }, s.title) : null,
        head, meta, actions,
      ].filter(Boolean);
  return h('div', { class: cls, role: 'group', 'aria-label': 'session ' + (s.title || s.agent || s.sid), 'aria-current': active ? 'true' : null },
    ...children);
}
