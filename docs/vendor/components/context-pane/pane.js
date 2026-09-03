// ContextPane — a compact right-hand context panel for the chat surface.
//
// Surfaces the current conversation's agent, model, working directory, and a
// live count of running tool calls in the in-flight turn. Built from the kit's
// Panel + Row primitives so it inherits the design tokens and rail semantics.
//
// Usage (consumer wires its own state):
//   ContextPane({ agent, model, cwd, toolCount, onSetCwd })
//
// Props:
//   agent      : display name of the active agent (string) or falsy for "none"
//   model      : model id/name (string) or falsy
//   cwd        : the chat working directory (string) or falsy for server default
//   toolCount  : number of tool calls running in the current live turn (>=0)
//   usage      : OPTIONAL last-turn usage { inputTokens, outputTokens, costUsd, turns, durationMs }
//   session    : OPTIONAL whole-conversation totals { turns, cost } shown as a block
//   recentFiles: OPTIONAL [{ path, time }] files touched by tool calls this
//                session (most-recent first), rendered as a compact panel -
//                Claude Desktop's context surfaces recently-touched files.
//   onSetCwd   : optional callback for the "set working directory" affordance
//   onOpenFile : optional callback(path) for clicking a recent-files row
//
// No decorative glyphs — words + the kit's Icon SVGs only.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Panel, Row } from '../content.js';
import { Btn } from '../shell.js';
import { fmtDuration } from '../sessions.js';

const h = webjsx.createElement;

function fmtTok(n) {
    if (n == null) return null;
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k';
    return (n / 1000000).toFixed(1) + 'M';
}

export function ContextPane({ agent, model, cwd, toolCount = 0, usage, session, recentFiles, onSetCwd, onOpenFile } = {}) {
    const running = Number(toolCount) > 0;
    const hasUsage = usage && (usage.inputTokens != null || usage.outputTokens != null || usage.costUsd != null);
    const hasSession = session && (session.turns != null || session.cost != null);
    // Empty state: before an agent is picked AND with no usage/session, four
    // placeholder rows (agent: none / model: dash / ...) read as a dead panel.
    // Show one honest line instead.
    if (!agent && !hasUsage && !hasSession && !cwd) {
        return h('div', { class: 'ds-context' },
            h('div', { class: 'ds-context-empty', role: 'status' },
                'No active conversation — start a chat to see context here'),
            onSetCwd ? h('div', { class: 'ds-context-actions' }, Btn({ onClick: onSetCwd, children: 'set working dir' })) : null);
    }
    // Each Panel's children array is all-unkeyed (no key prop on any sibling),
    // so webjsx never sees a mixed keyed/unkeyed array here.
    const panels = [
        Panel({
            title: 'context',
            children: [
                Row({ title: 'agent', meta: agent || 'none' }),
                Row({ title: 'model', meta: model || '—' }),
                // Wrapped in a scoping div (`ds-context-cwd-row`) so the cwd
                // fact's `.sub` text can be styled monospace to match
                // .ds-dash-cwd/.ds-session-agent/.ds-dash-model without
                // affecting every other Row's `.sub` in the app.
                h('div', { class: 'ds-context-cwd-row' }, Row({
                    title: 'working dir',
                    sub: cwd || 'server default',
                    // Use the rail tone consistently with the GUI-wide semantics:
                    // green = active/ok. A default cwd carries no rail (neutral).
                    rail: cwd ? 'green' : null,
                    // The change-cwd affordance belongs ON the working-dir fact,
                    // not as a button floating under the panels.
                    onClick: onSetCwd || undefined,
                    meta: onSetCwd ? 'change' : undefined,
                })),
                Row({
                    title: 'running tools',
                    meta: running ? String(toolCount) : 'idle',
                    rail: running ? 'purple' : null,
                }),
            ],
        }),
    ];
    // Conversation block: whole-session totals (turn count + accumulated cost)
    // between the context panel and the per-turn usage panel. All-zero totals
    // are noise, not context - hide the block until there is a conversation.
    // Rendered as a lighter fact group (no card chrome) since it's 1-2 short
    // facts, not enough weight to justify a full bordered Panel.
    if (hasSession && (Number(session.turns) > 0 || Number(session.cost) > 0)) {
        const sesRows = [];
        if (session.turns != null) sesRows.push(Row({ title: 'turns', meta: String(session.turns) }));
        if (session.cost != null) sesRows.push(Row({ title: 'total cost', meta: '$' + Number(session.cost).toFixed(4) }));
        panels.push(h('div', { class: 'ds-context-group' },
            h('div', { class: 'ds-context-group-label' }, 'conversation'),
            ...sesRows));
    }
    // Usage block: surface the last turn's token/cost/turn/duration so the
    // result event is no longer silently dropped. Lighter fact group, not a
    // full Panel - same reasoning as the conversation block above.
    if (hasUsage) {
        const tokRows = [];
        if (usage.inputTokens != null) tokRows.push(Row({ title: 'input', meta: fmtTok(usage.inputTokens) + ' tok' }));
        if (usage.outputTokens != null) tokRows.push(Row({ title: 'output', meta: fmtTok(usage.outputTokens) + ' tok' }));
        if (usage.costUsd != null) tokRows.push(Row({ title: 'cost', meta: '$' + usage.costUsd.toFixed(4) }));
        if (usage.turns != null) tokRows.push(Row({ title: 'turns', meta: String(usage.turns) }));
        // One duration vocabulary kit-wide: shared fmtDuration (s -> m -> h).
        if (usage.durationMs != null) tokRows.push(Row({ title: 'duration', meta: fmtDuration(usage.durationMs) }));
        panels.push(h('div', { class: 'ds-context-group' },
            h('div', { class: 'ds-context-group-label' }, 'last turn'),
            ...tokRows));
    }
    // Recent files: files touched by tool calls this session, most-recent
    // first, capped to 5 rows so the panel stays a glance not a log. Lighter
    // fact group, not a full Panel - same reasoning as above.
    if (Array.isArray(recentFiles) && recentFiles.length) {
        const fileRows = recentFiles.slice(0, 5).map((f) => Row({
            title: f.path.split(/[/\\]/).filter(Boolean).pop() || f.path,
            sub: f.path,
            meta: f.time || undefined,
            onClick: onOpenFile ? () => onOpenFile(f.path) : undefined,
        }));
        panels.push(h('div', { class: 'ds-context-group' },
            h('div', { class: 'ds-context-group-label' }, 'recent files'),
            ...fileRows));
    }
    // The cwd action lives on the working-dir row above; no floating footer button.
    return h('div', { class: 'ds-context' }, ...panels);
}
