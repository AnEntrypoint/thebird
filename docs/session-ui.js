// Session-management UX surface for thebird.
//
// Replaces the cramped i1/i2 pills in the menubar's .os-instances slot with
// labeled session chips that carry: name, window-count badge, close-x,
// drag-reorder. Owns create/destroy/rename modals, keyboard shortcuts,
// per-session label persistence (alongside the SW-owned gui-state snapshot),
// and an empty-state CTA when zero sessions exist.
//
// The os-shell calls attachSessionUI(shellApi) after construction; this module
// takes over the .os-instances DOM and the create/destroy lifecycle while
// delegating actual instance work to shellApi.newInstance/destroyInstance.

import { t } from './vendor/i18n.js';
import { listTemplates, applyTemplate } from './lib/templates.js';
import { setIcon, el } from './lib/dom.js';

const LABELS_LS = 'thebird-session-labels';
const LAST_TEMPLATE_LS = 'thebird-last-template';

function readLastTemplate() {
    try { return localStorage.getItem(LAST_TEMPLATE_LS) || 'default.json'; } catch { return 'default.json'; }
}
function writeLastTemplate(filename) {
    try { localStorage.setItem(LAST_TEMPLATE_LS, filename); } catch { /* swallow: localStorage unavailable/quota-exceeded, remembering last template is best-effort */ }
}

function readLabels() {
    try { return JSON.parse(localStorage.getItem(LABELS_LS) || '{}'); } catch { return {}; }
}
function writeLabels(map) {
    try { localStorage.setItem(LABELS_LS, JSON.stringify(map)); } catch { /* swallow: localStorage unavailable/quota-exceeded, label persistence is best-effort */ }
}
function defaultLabel(id, counter) {
    return t('session.defaultWorkspaceLabel', 'Workspace {n}', { n: counter || id.replace(/^i/, '') });
}

// `labels` (localStorage) only holds instances explicitly renamed/created-
// with-a-name through this UI — an auto-labeled instance (default "Workspace
// N" from its list position, never renamed) has no entry there at all, so a
// duplicate-name check against `labels` alone misses every auto-labeled
// workspace. `meta` (populated for every instance on each rebuildChips())
// reflects the label actually shown for each instance, auto or explicit, so
// duplicate checks compare against currentLabels() instead of raw `labels`.
function currentLabelEntries(meta) {
    return [...meta.entries()].map(([id, m]) => [id, m.label]);
}


// Track dialogs opened via buildOverlay so openDestroyConfirm's re-entrancy
// guard (keyed on `tag`) still works without the old modalStack array.
const openDialogTags = new Set();

function buildOverlay(title, bodyNode, actions, tag) {
    // Native <dialog> gives focus-trap, ESC-to-close, and top-layer stacking
    // for free; we only need to build the .tb-sess-modal content + wire the
    // Enter-triggers-primary shortcut (not native to <dialog>).
    const opener = document.activeElement;
    const dialog = el('dialog', 'tb-sess-modal');
    const head = el('div', 'tb-sess-modal-head');
    head.append(el('span', 'tb-sess-modal-title', title));
    const closeBtn = el('button', 'tb-sess-modal-x');
    closeBtn.setAttribute('aria-label', t('session.closeModalAriaLabel', 'Close'));
    setIcon(closeBtn, 'x');
    closeBtn.type = 'button';
    head.append(closeBtn);
    const body = el('div', 'tb-sess-modal-body');
    body.append(bodyNode);
    const foot = el('div', 'tb-sess-modal-foot');
    for (const a of actions) {
        const b = el('button', 'tb-sess-modal-btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), a.label);
        b.type = 'button';
        b.addEventListener('click', () => a.onClick(close));
        foot.append(b);
    }
    dialog.append(head, body, foot);
    document.body.append(dialog);
    if (tag) openDialogTags.add(tag);

    function close() {
        dialog.close();
    }
    dialog.addEventListener('close', () => {
        if (tag) openDialogTags.delete(tag);
        dialog.remove();
        // Modern browsers restore focus to the previously-focused element
        // automatically on dialog close; keep a defensive fallback in case
        // that landed on <body> (older engines / detached opener).
        if (document.activeElement === document.body || !document.activeElement) {
            if (opener && opener.isConnected && typeof opener.focus === 'function') {
                opener.focus();
            } else {
                const fallback = document.querySelector('button,a[href],input,textarea,select,[tabindex]:not([tabindex="-1"])');
                if (fallback) fallback.focus();
            }
        }
    }, { once: true });
    // ESC fires 'cancel' natively; let it proceed to 'close' (no extra work needed).
    dialog.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
            const prim = foot.querySelector('.primary');
            if (prim) { e.preventDefault(); prim.click(); }
        }
    });
    closeBtn.addEventListener('click', close);
    // Click on the ::backdrop (outside the dialog's own box) closes it, same
    // as the old back-drop-click-to-dismiss behavior.
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    dialog.showModal();
    // Focus first input or primary button. requestAnimationFrame ties this to
    // the next paint (after showModal's layout/top-layer promotion settles)
    // rather than a bare setTimeout(0) macrotask, which offers no ordering
    // guarantee relative to other main-thread work queued the same tick.
    requestAnimationFrame(() => {
        const i = body.querySelector('input,textarea,select');
        if (i) i.focus();
        else { const p = foot.querySelector('.primary'); if (p) p.focus(); }
    });
    return { close, card: dialog, body };
}

export function attachSessionUI(shellApi, { instSwitch, menubar } = {}) {
    if (!instSwitch) throw new Error('attachSessionUI: instSwitch element required');

    const labels = readLabels();
    const meta = new Map();        // id -> { label, createdAt, lastActiveAt }
    const chips = new Map();       // id -> chip element

    // Prefer the live wm registry over inst.windows.length: the latter is a
    // side-tracked array (os-shell.js pushes/splices it from openApp's own
    // instance-resolution path) that can silently undercount if that
    // resolution ever misses a transient race. wm.list() is the same source
    // buildSnapshot/persistence trusts (see monitor-app.js's identical fix),
    // so counting from it here can't drift from what actually got persisted.
    // Fall back to the side-tracked array only if wm is unavailable.
    function liveWindowCount(inst) {
        return shellApi.wm && typeof shellApi.wm.list === 'function'
            ? shellApi.wm.list().filter(w => w.instanceId === inst.id).length
            : (inst.windows || []).filter(w => w && w.el && w.el.isConnected).length;
    }

    // Empty-state element created once and shown/hidden via the standard HTML
    // `hidden` attribute so the 1000ms badge tick never does DOM append/remove
    // surgery while user gestures are in flight.
    const emptyState = (() => {
        const es = el('div', 'tb-sess-empty');
        const card = el('div', 'tb-sess-empty-card');
        card.append(
            el('div', 'tb-sess-empty-title', t('session.emptyTitle', 'No workspaces open')),
            el('div', 'tb-sess-empty-sub', t('session.emptySubtitle', 'Create a new workspace to start working')),
        );
        const btn = el('button', 'tb-sess-empty-cta', t('session.emptyCta', '+ New Workspace'));
        btn.type = 'button';
        btn.addEventListener('click', () => openCreateWizard());
        card.append(btn);
        es.append(card);
        es.hidden = true;
        document.body.append(es);
        return es;
    })();

    // CSS lives in docs/thebird-brand.css — see the "Session-UX surfaces"
    // block. Keep paint out of docs/*.js (no inline <style> injection) so the
    // brand stylesheet stays the single source.

    function rebuildChips() {
        instSwitch.replaceChildren();
        chips.clear();
        const list = shellApi.instances;
        // Clean up orphaned meta entries for instances that no longer exist.
        // Also drop the corresponding persisted label so a later instance
        // reusing this id (id counters get reused after destroy+recreate)
        // never silently re-adopts a stale label from localStorage.
        let orphanedLabels = false;
        for (const id of meta.keys()) {
            if (!list.find(i => i.id === id)) {
                console.warn('[session-ui] orphaned meta entry:', id);
                meta.delete(id);
                if (Object.prototype.hasOwnProperty.call(labels, id)) {
                    delete labels[id];
                    orphanedLabels = true;
                }
            }
        }
        if (orphanedLabels) writeLabels(labels);
        for (let idx = 0; idx < list.length; idx++) {
            const inst = list[idx];
            // Default labels derive from the instance's stable position in the
            // source-of-truth list (idx + 1), not a mutable rebuild counter, so
            // labels stay stable across rebuilds and survive page refresh.
            const m = meta.get(inst.id) || { label: labels[inst.id] || defaultLabel(inst.id, idx + 1), createdAt: Date.now(), lastActiveAt: Date.now() };
            meta.set(inst.id, m);
            const chip = el('div', 'tb-sess-chip');
            chip.dataset.instanceId = inst.id;
            // Per-instance lifecycle status (booting|installing|ready|error), sourced
            // from shellActor context via shellApi.getInstanceStatus (extends the
            // SAME shellMachine actor, xstate-everywhere — no parallel enum). No new
            // CSS is authored here (thebird ships zero design CSS of its own); until
            // an upstream anentrypoint-design visual treatment exists for this, the
            // status is exposed only as a data attribute + an error-only className
            // toggle (harmless no-op if the class isn't styled upstream yet).
            const status0 = typeof shellApi.getInstanceStatus === 'function' ? shellApi.getInstanceStatus(inst.id) : null;
            if (status0) chip.dataset.status = status0;
            chip.classList.toggle('tb-sess-status-error', status0 === 'error');
            const dot = el('span', 'tb-sess-dot');
            const lbl = el('span', 'tb-sess-label', m.label);
            const wins = liveWindowCount(inst);
            const badge = el('span', 'tb-sess-badge', String(wins));
            badge.title = t('session.windowCountTitle', '{n} window{s}', { n: wins, s: wins === 1 ? '' : 's' });
            const x = el('button', 'tb-sess-x');
            x.setAttribute('aria-label', t('session.closeWorkspaceAriaLabel', 'Close workspace'));
            setIcon(x, 'x');
            x.type = 'button';
            x.title = t('session.closeWorkspaceTitle', 'Close workspace');
            x.setAttribute('aria-label', t('session.closeWorkspaceNamedAriaLabel', 'Close workspace {label}', { label: m.label }));
            chip.append(dot, lbl, badge, x);
            chip.title = t('session.chipTitle', '{label} · {n} window{s}', { label: m.label, n: wins, s: wins === 1 ? '' : 's' });
            // a11y: the chip is a clickable instance-switcher control (role
            // implied by its click handler below) — give it an accessible
            // name bound to the instance's label, mirroring chip.title.
            chip.setAttribute('aria-label', t('session.chipAriaLabel', 'Workspace {label} · {n} window{s}', { label: m.label, n: wins, s: wins === 1 ? '' : 's' }));

            chip.addEventListener('click', e => {
                if (e.target === x) return;
                m.lastActiveAt = Date.now();
                shellApi.setActive && shellApi.setActive(inst.id);
            });
            chip.addEventListener('dblclick', e => {
                if (e.target === x) return;
                e.preventDefault();
                openRenameModal(inst.id);
            });
            x.addEventListener('click', e => {
                e.stopPropagation();
                openDestroyConfirm(inst.id);
            });

            chips.set(inst.id, chip);
            instSwitch.append(chip);
        }
        paintActive(shellApi.active && shellApi.active.id);
        toggleEmptyState();
    }

    function paintActive(id) {
        for (const [iid, chip] of chips) chip.classList.toggle('active', iid === id);
    }

    function toggleEmptyState() {
        emptyState.hidden = shellApi.instances.length !== 0;
    }

    function openCreateWizard() {
        const body = el('div');
        const lbl = el('label', 'tb-sess-modal-lbl', t('session.workspaceNameLabel', 'Workspace name'));
        lbl.htmlFor = 'tb-sess-new-name';
        body.append(lbl);
        const input = el('input', 'tb-sess-modal-input');
        input.id = 'tb-sess-new-name';
        input.type = 'text';
        input.placeholder = t('session.defaultWorkspaceLabel', 'Workspace {n}', { n: shellApi.count + 1 });
        input.value = '';
        input.maxLength = 32;
        body.append(input);
        body.append(el('div', 'tb-sess-modal-hint', t('session.newWorkspaceHint', 'An isolated workspace: its own filesystem, terminal, browser pane, and chat sessions.')));
        const errHint = el('div', 'tb-sess-modal-hint');
        errHint.classList.add('error');
        errHint.hidden = true;
        body.append(errHint);

        const tplLbl = el('label', 'tb-sess-modal-lbl', t('session.templateLabel', 'Template'));
        tplLbl.htmlFor = 'tb-sess-new-template';
        body.append(tplLbl);
        const tplSelect = el('select', 'tb-sess-modal-input');
        tplSelect.id = 'tb-sess-new-template';
        body.append(tplSelect);
        const lastTemplate = readLastTemplate();
        listTemplates().then(templates => {
            tplSelect.replaceChildren();
            for (const tpl of templates) {
                const opt = el('option', '', tpl.name || tpl._filename);
                opt.value = tpl._filename;
                tplSelect.append(opt);
            }
            tplSelect.value = lastTemplate;
            if (tplSelect.value !== lastTemplate) tplSelect.value = 'default.json';
        }).catch(e => console.error('[session-ui] listTemplates failed:', e));

        let submitting = false;
        const ov = buildOverlay(t('session.newWorkspaceTitle', 'New Workspace'), body, [
            { label: t('session.cancel', 'Cancel'), onClick: close => close() },
            {
                label: t('session.create', 'Create'), primary: true, onClick: async close => {
                    if (submitting) return;
                    const name = (input.value.trim() || input.placeholder).slice(0, 32);
                    const dup = currentLabelEntries(meta).some(([, l]) => l === name);
                    if (dup) {
                        errHint.textContent = t('session.duplicateNameError', 'A workspace named "{name}" already exists', { name });
                        errHint.hidden = false;
                        return;
                    }
                    const chosenFilename = tplSelect.value || 'default.json';
                    submitting = true;
                    close();
                    try {
                        const inst = await shellApi.newInstance({ skipRestore: true });
                        if (!inst) return;
                        let finalName = name;
                        if (currentLabelEntries(meta).some(([iid, l]) => iid !== inst.id && l === finalName)) {
                            let n = 2;
                            while (currentLabelEntries(meta).some(([iid, l]) => iid !== inst.id && l === `${name} (${n})`)) n++;
                            finalName = `${name} (${n})`;
                        }
                        const m = { label: finalName, createdAt: Date.now(), lastActiveAt: Date.now() };
                        meta.set(inst.id, m);
                        labels[inst.id] = finalName;
                        writeLabels(labels);
                        try {
                            const templates = await listTemplates();
                            const chosen = templates.find(tp => tp._filename === chosenFilename);
                            if (chosen) applyTemplate(inst, chosen);
                        } catch (e) {
                            console.error('[session-ui] applyTemplate failed:', e);
                            const detail = e && e.partial && Array.isArray(e.failures)
                                ? e.failures.map(f => f.path).join(', ')
                                : (e && e.message) || String(e);
                            try {
                                alert(t('session.templateApplyError', 'Workspace "{name}" was created, but its template only partially applied. Failed: {detail}', { name, detail }));
                            } catch { /* alert unavailable (headless/test env) */ }
                        }
                        writeLastTemplate(chosenFilename);
                        rebuildChips();
                    } catch (e) {
                        console.error('[session-ui] create failed:', e);
                    }
                }
            },
        ]);
        return ov;
    }

    function openRenameModal(id, onSaved) {
        const m = meta.get(id);
        if (!m) return;
        const body = el('div');
        body.append(el('label', 'tb-sess-modal-lbl', t('session.workspaceNameLabel', 'Workspace name')));
        const input = el('input', 'tb-sess-modal-input');
        input.type = 'text';
        input.value = m.label;
        input.maxLength = 32;
        body.append(input);
        const errHint = el('div', 'tb-sess-modal-hint');
        errHint.classList.add('error');
        errHint.hidden = true;
        body.append(errHint);
        buildOverlay(t('session.renameWorkspaceTitle', 'Rename Workspace'), body, [
            { label: t('session.cancel', 'Cancel'), onClick: close => close() },
            {
                label: t('session.save', 'Save'), primary: true, onClick: close => {
                    if (!shellApi.instances.find(i => i.id === id)) {
                        close();
                        return;
                    }
                    const name = input.value.trim().slice(0, 32);
                    if (!name) {
                        errHint.textContent = t('session.emptyNameError', 'Workspace name cannot be empty');
                        errHint.hidden = false;
                        return;
                    }
                    const dup = name !== m.label && currentLabelEntries(meta).some(([oid, l]) => oid !== id && l === name);
                    if (dup) {
                        errHint.textContent = t('session.duplicateNameError', 'A workspace named "{name}" already exists', { name });
                        errHint.hidden = false;
                        return;
                    }
                    m.label = name;
                    labels[id] = name;
                    writeLabels(labels);
                    rebuildChips();
                    close();
                    if (typeof onSaved === 'function') onSaved(id);
                }
            },
        ]);
    }

    function openDestroyConfirm(id, opts) {
        // Re-entrancy guard: a rapid double-click on the chip's close button must
        // not stack a second confirm modal for the same workspace.
        if (openDialogTags.has('destroy:' + id)) return;
        const m = meta.get(id);
        const inst = shellApi.instances.find(i => i.id === id);
        if (!m || !inst) return;
        const wins = liveWindowCount(inst);
        // Commit-time guard: callers (e.g. workspaces-app.js) may pass a
        // canCommit() check re-evaluated right before destroyInstance() fires,
        // so a destroy confirmed while a concurrent export started AFTER this
        // dialog opened (invisible to the caller's own pre-open check) is
        // blocked instead of racing fs.destroy() against the export's
        // in-flight fs.snapshot() read.
        const canCommit = opts && typeof opts.canCommit === 'function' ? opts.canCommit : null;
        const body = el('div');
        body.append(el('div', 'tb-sess-modal-msg', t('session.closeWorkspaceConfirmMsg', 'Close workspace "{label}"?', { label: m.label })));
        body.append(el('div', 'tb-sess-modal-hint', wins
            ? t('session.closeWorkspaceHintWithWindows', '{n} window{s} will be closed. Workspace filesystem will be deleted.', { n: wins, s: wins === 1 ? '' : 's' })
            : t('session.closeWorkspaceHint', 'Workspace filesystem will be deleted.')));
        buildOverlay(t('session.closeWorkspaceTitleModal', 'Close Workspace'), body, [
            { label: t('session.cancel', 'Cancel'), onClick: close => close() },
            {
                label: t('session.closeWorkspaceAction', 'Close workspace'), danger: true, onClick: async close => {
                    if (canCommit && !canCommit(id)) {
                        console.warn('[session-ui] destroy blocked at commit time for', id, '- guard rejected (e.g. export in progress)');
                        return;
                    }
                    const liveInst = shellApi.instances.find(i => i.id === id);
                    const finalWins = liveInst ? liveWindowCount(liveInst) : wins;
                    if (finalWins !== wins) {
                        console.warn('[session-ui] window count changed while destroy-confirm was open:', wins, '->', finalWins);
                    }
                    close();
                    try {
                        await shellApi.destroyInstance(id);
                        delete labels[id];
                        writeLabels(labels);
                        meta.delete(id);
                        rebuildChips();
                    } catch (e) {
                        console.error('[session-ui] destroy failed:', e);
                    }
                }
            },
        ], 'destroy:' + id);
    }

    // Override the kit's tiny + button: hide it (it still wires onNewInstance
    // via os-shell, but we want our own with text/label). Replace with our chip.
    function mountCreateChip() {
        // Remove kit's plus button (data-role="add").
        if (menubar) {
            const kitAdd = menubar.querySelector('button[data-role="add"]');
            if (kitAdd) kitAdd.remove();
        }
        const addChip = el('button', 'tb-sess-add');
        addChip.type = 'button';
        addChip.title = t('session.newWorkspaceShortcutTitle', 'New workspace (Ctrl+Shift+N)');
        addChip.setAttribute('aria-label', t('session.newWorkspaceAriaLabel', 'New workspace'));
        addChip.append(el('span', 'tb-sess-add-plus', '+'), el('span', 'tb-sess-add-lbl', t('session.workspaceLabelShort', 'Workspace')));
        addChip.addEventListener('click', () => openCreateWizard());
        // Insert directly before the instSwitch in the menubar layout.
        instSwitch.parentNode && instSwitch.parentNode.insertBefore(addChip, instSwitch);
    }
    mountCreateChip();

    // Keyboard shortcuts
    function onKey(e) {
        const ae = document.activeElement;
        if (ae) {
            const tn = (ae.tagName || '').toUpperCase();
            if (tn === 'INPUT' || tn === 'TEXTAREA' || ae.isContentEditable) return;
        }
        // Ctrl+Shift+N — new session
        if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
            e.preventDefault();
            openCreateWizard();
            return;
        }
        // Ctrl+Shift+W — close active session
        if (e.ctrlKey && e.shiftKey && (e.key === 'W' || e.key === 'w')) {
            const act = shellApi.active;
            if (act) { e.preventDefault(); openDestroyConfirm(act.id); }
            return;
        }
        // Ctrl+1..9 — switch by index (skip when alt/meta also held)
        if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
            const idx = parseInt(e.key, 10) - 1;
            const list = shellApi.instances;
            if (list[idx]) {
                e.preventDefault();
                shellApi.setActive && shellApi.setActive(list[idx].id);
            }
        }
    }
    document.addEventListener('keydown', onKey, true);

    // Chip rendering is driven by the shell's xstate actor. Every structural
    // change (newInstance/destroyInstance/setActive) is a transition on
    // shellApi.shellActor, so subscribing gives a deterministic rebuild signal
    // instead of a 250ms poll. Window-count badges still change via the WM (not
    // the shell actor), so a slow badge-only refresh covers that — but the
    // structural truth comes from the actor subscription.
    let lastSig = '';
    function winCount(inst) {
        return liveWindowCount(inst);
    }
    function getStatus(id) {
        return typeof shellApi.getInstanceStatus === 'function' ? shellApi.getInstanceStatus(id) : null;
    }
    function computeSig() {
        const list = shellApi.instances;
        const active = shellApi.active && shellApi.active.id;
        return list.map(i => i.id + ':' + winCount(i) + ':' + (getStatus(i.id) || '')).join('|') + '#' + active;
    }
    function refreshBadges() {
        // Cosmetic-only path: mutate badge text/titles in the existing chips
        // instead of tearing down and rebuilding the whole strip.
        for (const inst of shellApi.instances) {
            const chip = chips.get(inst.id);
            if (!chip) continue;
            const wins = winCount(inst);
            const badge = chip.querySelector('.tb-sess-badge');
            if (badge && badge.textContent !== String(wins)) {
                badge.textContent = String(wins);
                badge.title = t('session.windowCountTitle', '{n} window{s}', { n: wins, s: wins === 1 ? '' : 's' });
                const m = meta.get(inst.id);
                chip.title = t('session.chipTitle', '{label} · {n} window{s}', { label: (m && m.label) || inst.id, n: wins, s: wins === 1 ? '' : 's' });
            }
            const status = getStatus(inst.id);
            if (chip.dataset.status !== (status || undefined)) {
                if (status) chip.dataset.status = status; else delete chip.dataset.status;
                chip.classList.toggle('tb-sess-status-error', status === 'error');
            }
        }
        paintActive(shellApi.active && shellApi.active.id);
    }
    function refreshIfChanged() {
        const sig = computeSig();
        if (sig === lastSig) return;
        lastSig = sig;
        // Only rebuild the DOM when the instance LIST changed; badge/active
        // deltas update the existing chips in place.
        const structSig = shellApi.instances.map(i => i.id).join('|');
        const prevStruct = [...chips.keys()].join('|');
        if (structSig !== prevStruct) rebuildChips();
        else refreshBadges();
    }
    let actorSub = null;
    if (shellApi.shellActor && typeof shellApi.shellActor.subscribe === 'function') {
        actorSub = shellApi.shellActor.subscribe(() => refreshIfChanged());
    }
    // Badge-only fallback at a relaxed cadence (window counts come from the WM,
    // which is a separate actor set; a slow tick keeps the badge in sync without
    // the old hot 250ms poll).
    const badgeTick = setInterval(refreshIfChanged, 1000);

    rebuildChips();

    return {
        rebuildChips,
        openCreateWizard,
        openRenameModal,
        openDestroyConfirm,
        getMeta: id => meta.get(id),
        getLabel: id => (meta.get(id) || {}).label || defaultLabel(id),
        dispose() {
            clearInterval(badgeTick);
            try { actorSub && actorSub.unsubscribe(); } catch { /* swallow: xstate subscription already torn down */ }
            document.removeEventListener('keydown', onKey, true);
            if (emptyState?.isConnected) emptyState.remove();
        },
    };
}

