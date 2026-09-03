// ---------------------------------------------------------------------------
// BatchProgressLabel — sequential batch-operation progress readout: "label
// (i/n)" while in flight. Ported from docstudio's sequential upload badge
// and bulk-action progress button (both show a live count against a total
// while processing one item at a time). Pure display — the host owns the
// actual queue/loop; this only renders its current {done, total} state.
// done === 0 renders the bare label with no count suffix (nothing has
// happened yet); done === total renders as complete with no live-region
// churn once settled.
// ---------------------------------------------------------------------------

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

export function BatchProgressLabel({ label = 'Processing', done = 0, total = 0, key } = {}) {
    const inFlight = total > 0 && done < total;
    const suffix = total > 0 ? ` (${done}/${total})` : '';
    return h('span', { key, class: 'ds-ep-batchprogress', role: 'status', 'aria-live': inFlight ? 'polite' : 'off' },
        label + suffix);
}

// formatBatchOutcome — pure string helper for the aggregate toast shown once
// a batch settles: "N/total succeeded" plus a truncated failed-name list
// when any items failed, matching docstudio's attach-bar/bulk-action
// aggregation copy. Handles all three outcome shapes (all-succeed, all-fail,
// partial) and truncates a long failed-name list ("...and N more") instead
// of growing the toast unboundedly for a big batch.
export function formatBatchOutcome({ succeeded = 0, total = 0, failedNames = [], maxNames = 3 } = {}) {
    if (total === 0) return '';
    if (failedNames.length === 0) return `${succeeded}/${total} succeeded`;
    const shown = failedNames.slice(0, maxNames).join(', ');
    const more = failedNames.length > maxNames ? ` and ${failedNames.length - maxNames} more` : '';
    return `${succeeded}/${total} succeeded; failed: ${shown}${more}`;
}

// runBatchSequential — pure async orchestration companion to
// BatchProgressLabel/formatBatchOutcome: runs `items` through `fn` one at a
// time (never in parallel, matching docstudio's rate-limited bulk-action
// runner), never aborting on a single item's failure. `onProgress({done,
// total})` fires after each item settles so a host can drive
// BatchProgressLabel live; the final `{succeeded, total, failedNames}`
// return shape feeds formatBatchOutcome directly. `fn` receives (item, index)
// and may reject/throw — a rejection is recorded as a failure keyed by
// `item.name != null ? item.name : String(item)`, never re-thrown.
export async function runBatchSequential(items = [], fn, onProgress) {
    const total = items.length;
    let succeeded = 0;
    const failedNames = [];
    for (let i = 0; i < total; i += 1) {
        const item = items[i];
        try {
            await fn(item, i);
            succeeded += 1;
        } catch (err) {
            failedNames.push(item && item.name != null ? item.name : String(item));
        }
        if (onProgress) onProgress({ done: i + 1, total });
    }
    return { succeeded, total, failedNames };
}
