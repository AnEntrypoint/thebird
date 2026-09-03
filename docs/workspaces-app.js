// workspaces-app: full-window workspace manager (card grid over OS instances).
// Extracted from docs/apps.js (pure code motion).
import { el } from './apps.js';
import { getInstances, getActiveInstance } from './lib/instance-registry.js';
import { confirmDialog } from './lib/dom.js';
import { toast } from './vendor/components/editor-primitives.js';

export function workspacesApp() {
    // Full-window workspace manager: card grid of all instances with rename,
    // duplicate, export, delete, bulk-select. Instance list/active-instance
    // reads go through lib/instance-registry.js (the single-writer
    // registry, fed by os-shell.js). sessionUI access and the setActive/
    // destroyInstance mutators are NOT yet exposed by that registry module
    // (it is read-only, list+active only) — those still go through
    // window.__debug.shell until a proper single-writer mutator surface is
    // extracted, which is a larger separate change.
    // (Workspaces are OS instances — distinct from chat sessions inside them.)
    // CSS lives in docs/thebird-brand.css — see "Workspaces app" block.
    // Convention: no inline <style> creation in docs/*.js — keep paint in
    // docs/thebird-brand.css so the design tokens stay the single source.
    const root = el('div', 'tb-sessions-app');

    const bar = el('div', 'tb-sessions-bar');
    const title = el('span', 'tb-sessions-title', 'workspaces');
    const count = el('span', 'tb-sessions-count', '');
    const spacer = el('div', 'tb-sessions-spacer');
    const bulkDel = document.createElement('button');
    bulkDel.className = 'tb-sessions-btn danger';
    bulkDel.textContent = 'delete selected';
    bulkDel.hidden = true;
    const newBtn = document.createElement('button');
    newBtn.className = 'tb-sessions-btn primary';
    newBtn.textContent = '+ new workspace';
    bar.append(title, count, spacer, bulkDel, newBtn);

    const grid = el('div', 'tb-sessions-grid');
    root.append(bar, grid);

    const selected = new Set();
    const exportsInFlight = new Set(); // instance ids with a pending export snapshot() await

    function shell() { return (window.__debug && window.__debug.shell) || null; }

    // Structural truth (instance list) comes from the shell's xstate actor —
    // subscribing gives a deterministic rebuild signal instead of a hot poll.
    // Window counts live in a separate actor set (the WM), so a slow fallback
    // tick still covers badge-only drift. Rename now routes through
    // sessionUI.openRenameModal (a proper dialog), so there is no in-place
    // edit state here to guard against clobbering.
    function refresh() {
        const s = shell();
        if (!s) { grid.replaceChildren(el('div', 'tb-sessions-empty-mid', 'Shell not ready')); return; }
        const list = getInstances();
        count.textContent = '(' + list.length + ')';
        const liveIds = new Set(list.map(inst => inst.id));
        for (const id of selected) { if (!liveIds.has(id)) selected.delete(id); }
        bulkDel.hidden = selected.size === 0;
        grid.replaceChildren();
        if (!list.length) {
            grid.replaceChildren(el('div', 'tb-sessions-empty-mid', 'no workspaces. click + new workspace to create one.'));
            return;
        }
        const active = getActiveInstance();
        const activeId = active && active.id;
        for (const inst of list) {
            const m = s.sessionUI ? s.sessionUI.getMeta(inst.id) : null;
            const label = (m && m.label) || inst.id;
            const wins = (s.wm && typeof s.wm.list === 'function')
                ? s.wm.list().filter(w => w.instanceId === inst.id).length
                : (inst.windows || []).filter(w => w && w.el && w.el.isConnected).length;
            const created = m && m.createdAt ? new Date(m.createdAt).toLocaleString() : '—';

            const card = el('div', 'tb-sessions-card' + (inst.id === activeId ? ' active' : ''));
            const head = el('div', 'tb-sessions-card-head');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'tb-sessions-card-check';
            cb.checked = selected.has(inst.id);
            cb.addEventListener('change', () => {
                if (cb.checked) selected.add(inst.id); else selected.delete(inst.id);
                bulkDel.hidden = selected.size === 0;
            });
            const name = el('div', 'tb-sessions-card-name', label);
            name.title = 'Double-click to rename';
            name.addEventListener('dblclick', () => {
                if (s.sessionUI && typeof s.sessionUI.openRenameModal === 'function') {
                    // openRenameModal is an async dialog (Cancel or Save, confirmed
                    // later by the user) — the onSaved callback fires only once Save
                    // actually commits the new label, so this app's grid refreshes
                    // exactly when there is something new to show, not immediately
                    // on open.
                    s.sessionUI.openRenameModal(inst.id, () => refresh());
                }
            });
            const idTag = el('span', 'tb-sessions-card-id', inst.id);
            head.append(cb, name, idTag);

            const stats = el('div', 'tb-sessions-card-stats');
            stats.append(
                el('span', null, wins + ' window' + (wins === 1 ? '' : 's')),
                el('span', null, 'created ' + created),
            );

            const actions = el('div', 'tb-sessions-card-actions');
            const swBtn = document.createElement('button');
            swBtn.textContent = inst.id === activeId ? 'active' : 'switch';
            swBtn.disabled = inst.id === activeId;
            swBtn.addEventListener('click', () => { s.setActive(inst.id); refresh(); });
            const exBtn = document.createElement('button');
            exBtn.textContent = 'export';
            exBtn.addEventListener('click', async () => {
                // Re-read label/meta/window-count live at click time rather than
                // closing over the last refresh() render pass's values — a rename
                // or window open/close in the up-to-2s window between the last
                // refresh and this click must not produce an export whose
                // label/createdAt/windowCount are stale relative to the fsSnapshot
                // captured below.
                const sNow = shell();
                const mNow = sNow && sNow.sessionUI ? sNow.sessionUI.getMeta(inst.id) : m;
                const labelNow = (mNow && mNow.label) || label;
                const winsNow = (sNow && sNow.wm && typeof sNow.wm.list === 'function')
                    ? sNow.wm.list().filter(w => w.instanceId === inst.id).length
                    : wins;
                const payload = {
                    id: inst.id,
                    label: labelNow,
                    createdAt: mNow && mNow.createdAt,
                    windowCount: winsNow,
                    exportedAt: Date.now(),
                };
                exportsInFlight.add(inst.id);
                try {
                    try { if (inst.fs && inst.fs.snapshot) payload.fsSnapshot = await inst.fs.snapshot(); } catch { /* swallow: export proceeds without fs snapshot if it fails */ }
                } finally {
                    exportsInFlight.delete(inst.id);
                }
                if (payload.fsSnapshot === undefined) payload.partial = true;
                let blob;
                try {
                    blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                } catch (e) {
                    console.warn('export: JSON.stringify failed', inst.id, e);
                    toast({ message: `Export failed for ${labelNow}: workspace data could not be serialized`, kind: 'error', duration: 6000 });
                    return;
                }
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `workspace-${labelNow.slice(0, 40).replace(/\W+/g, '_')}-${inst.id}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            });
            const delBtn = document.createElement('button');
            delBtn.className = 'danger';
            delBtn.textContent = 'delete';
            delBtn.addEventListener('click', () => {
                if (exportsInFlight.has(inst.id)) { console.warn('delete: skipping', inst.id, '- export in progress'); return; }
                // canCommit is re-checked by session-ui right before it calls
                // destroyInstance(), inside the async confirm dialog's onClick —
                // closes the TOCTOU where an export starts (and adds to
                // exportsInFlight) AFTER this initial click-time check but
                // WHILE the confirm dialog is still open.
                if (s.sessionUI) s.sessionUI.openDestroyConfirm(inst.id, { canCommit: id => !exportsInFlight.has(id) });
            });
            actions.append(swBtn, exBtn, delBtn);

            card.append(head, stats, actions);
            grid.append(card);
        }
    }

    newBtn.addEventListener('click', () => {
        const s = shell();
        if (s && s.sessionUI) s.sessionUI.openCreateWizard();
    });
    bulkDel.addEventListener('click', async () => {
        const s = shell();
        if (!s || !selected.size) return;
        const n = selected.size;
        const ok = await confirmDialog({
            title: 'Delete Workspaces',
            message: `Delete ${n} workspace${n === 1 ? '' : 's'}?`,
            hint: 'This cannot be undone.',
            confirmLabel: 'Delete',
        });
        if (!ok) return;
        let failed = 0;
        for (const id of [...selected]) {
            if (exportsInFlight.has(id)) { console.warn('bulk delete: skipping', id, '- export in progress'); failed++; continue; }
            try {
                await s.destroyInstance(id);
                selected.delete(id);
            } catch (e) {
                console.warn('bulk delete', id, e);
                failed++;
            }
        }
        if (failed) {
            toast({
                message: `Deleted ${n - failed} of ${n} workspace${n === 1 ? '' : 's'} — ${failed} failed, still selected`,
                kind: 'error',
                duration: 6000,
            });
        }
        refresh();
    });

    let actorSub = null;
    const s0 = shell();
    if (s0 && s0.shellActor && typeof s0.shellActor.subscribe === 'function') {
        actorSub = s0.shellActor.subscribe(() => refresh());
    }
    // Relaxed-cadence fallback: covers window-count badges (a separate WM
    // actor set) and the case where shell()/shellActor wasn't ready yet at
    // mount time; the old hot 500ms full-rebuild poll is gone.
    const tick = setInterval(refresh, 2000);
    refresh();

    return {
        node: root,
        dispose() {
            clearInterval(tick);
            try { actorSub && actorSub.unsubscribe(); } catch { /* swallow: xstate subscription already torn down */ }
        },
        getViewState() {
            try { return { selected: [...selected], scrollTop: grid.scrollTop }; } catch { return null; }
        },
        restoreViewState(s) {
            if (!s) return;
            selected.clear();
            const live = getInstances();
            if (Array.isArray(s.selected)) {
                for (const id of s.selected) {
                    if (live.some(i => i && i.id === id)) selected.add(id);
                }
            }
            refresh();
            if (typeof s.scrollTop === 'number') grid.scrollTop = s.scrollTop;
        },
    };
}
