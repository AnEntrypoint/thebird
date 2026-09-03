// WorktreeSwitcher — a dropdown for listing/switching git worktrees + branches,
// with a "new worktree" action. Built on overlay-primitives.js's Dropdown
// (itself the Popover/useFloating primitives + roving-focus menu keyboard
// handling already in this kit) rather than re-deriving popover positioning,
// outside-click, Escape, and focus-trap logic from scratch.

import * as webjsx from '../../vendor/webjsx/index.js';
import { Icon } from './shell.js';
import { Dropdown } from './overlay-primitives.js';
const h = webjsx.createElement;

const NEW_WORKTREE_ID = '__ds_new_worktree__';

// WorktreeSwitcher({ worktrees, current, onSwitch, onCreate })
// worktrees: [{ path, branch, current? }]
// current: path of the active worktree (falls back to a worktree's own `current` flag)
// onSwitch(worktree) — fired when an existing worktree is picked
// onCreate() — fired from the trailing "new worktree" row; the host owns the create flow (prompt/modal)
export function WorktreeSwitcher({ worktrees = [], current, onSwitch, onCreate, ariaLabel = 'switch worktree' } = {}) {
    const isCurrent = (wt) => wt.current || (current != null && wt.path === current);
    const activeWt = worktrees.find(isCurrent) || worktrees[0];
    const byId = new Map(worktrees.map((wt, i) => [wt.path || String(i), wt]));

    const items = [
        ...worktrees.map((wt, i) => ({
            id: wt.path || String(i),
            label: h('span', { class: 'ds-wts-item-body' },
                h('span', { class: 'ds-wts-item-check', 'aria-hidden': 'true' },
                    isCurrent(wt) ? Icon('check', { size: 14 }) : null),
                h('span', { class: 'ds-wts-item-text' },
                    h('span', { class: 'ds-wts-item-branch' }, wt.branch || '(detached HEAD)'),
                    h('span', { class: 'ds-wts-item-path' }, wt.path)
                ),
            ),
            disabled: isCurrent(wt),
        })),
        worktrees.length && onCreate ? { separator: true } : null,
        onCreate ? {
            id: NEW_WORKTREE_ID,
            glyph: '+',
            label: 'new worktree',
        } : null,
    ].filter(Boolean);

    const onSelect = (id) => {
        if (id === NEW_WORKTREE_ID) { onCreate && onCreate(); return; }
        const wt = byId.get(id);
        if (wt && onSwitch && !isCurrent(wt)) onSwitch(wt);
    };

    const trigger = h('button', { type: 'button', class: 'ds-wts-trigger' },
        h('span', { class: 'ds-wts-trigger-branch' }, (activeWt && activeWt.branch) || 'select worktree'),
        h('span', { class: 'ds-wts-trigger-caret', 'aria-hidden': 'true' }, Icon('chevron-down', { size: 13 }))
    );

    return h('span', { class: 'ds-wts' }, Dropdown({ trigger, items, onSelect, ariaLabel }));
}
