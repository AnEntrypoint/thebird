// todo-app: a small todo list app backed by in-browser busybase (plugkit).
// Extracted from docs/apps.js (pure code motion).
import { t } from './vendor/i18n.js';
import { resolveInstance } from './apps.js';

export function todoApp(ctx) {
    const instance = resolveInstance(ctx);
    const node = document.createElement('div');
    node.className = 'app-pane';
    node.dataset.component = 'todo-app';

    const head = document.createElement('div');
    head.textContent = t('todo.titlePrefix', 'todo · ') + instance.id;
    const sub = document.createElement('div');
    sub.className = 'meta';
    sub.textContent = t('todo.subtitle', 'data -> database');
    node.append(head, sub);

    const row1 = document.createElement('div');
    row1.className = 'tb-todo-bar';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('todo.placeholder', 'what needs doing?');
    input.className = 'tb-todo-input';
    const addBtn = document.createElement('button');
    addBtn.textContent = t('todo.add', 'Add');
    addBtn.className = 'os-btn';
    row1.append(input, addBtn);

    const list = document.createElement('ul');
    list.className = 'tb-todo-list';

    const footer = document.createElement('div');
    footer.className = 'tb-todo-footer';
    const clearBtn = document.createElement('button');
    clearBtn.textContent = t('todo.clearCompleted', 'Clear completed');
    clearBtn.className = 'os-btn';
    const counter = document.createElement('span');
    footer.append(clearBtn, counter);

    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.className = 'tb-todo-status';
    status.textContent = t('todo.booting', 'booting…');

    node.append(row1, list, footer, status);

    let bb = null;
    let disposed = false;
    const tablePrefix = 'todo_' + instance.id.replace(/[^a-z0-9]/gi, '_') + '_';
    const todoTable = tablePrefix + 'todos';

    const TODO_RENDER_LIMIT = 200;

    let refreshSeq = 0;
    async function refresh() {
        if (disposed || !bb) return;
        const seq = ++refreshSeq;
        const { data: recent, error } = await bb.from(todoTable).select().order('created', { ascending: false }).limit(TODO_RENDER_LIMIT);
        if (disposed || seq !== refreshSeq) return; // a newer refresh superseded this one, or app was torn down; discard stale result
        if (error) { status.textContent = t('todo.selectError', 'select error: ') + error.message; return; }
        const data = recent.slice().reverse();
        list.replaceChildren();
        let open = 0;
        for (const task of data) {
            const li = document.createElement('li');
            li.className = 'tb-todo-item';
            const isDone = task.done === '1' || task.done === 1 || task.done === true;
            if (!isDone) open++;
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = isDone;
            cb.onclick = async () => {
                cb.disabled = true;
                try {
                    const r = await bb.from(todoTable).update({ done: cb.checked ? '1' : '0' }).eq('id', task.id);
                    if (disposed) return;
                    if (r.error) status.textContent = t('todo.updateError', 'update error: ') + r.error.message;
                    await refresh();
                } finally {
                    if (!disposed) cb.disabled = false;
                }
            };
            const sp = document.createElement('span');
            sp.className = 'tb-todo-text' + (isDone ? ' is-done' : '');
            sp.textContent = (task.text && String(task.text).slice(0, TODO_TEXT_MAX)) || '(empty)';
            const del = document.createElement('button');
            del.textContent = 'x';
            del.className = 'os-btn tb-todo-del';
            del.setAttribute('aria-label', 'Delete task');
            del.type = 'button';
            del.onclick = async () => {
                del.disabled = true;
                try {
                    const r = await bb.from(todoTable).delete().eq('id', task.id);
                    if (disposed) return;
                    if (r.error) status.textContent = t('todo.deleteError', 'delete error: ') + r.error.message;
                    await refresh();
                } finally {
                    if (!disposed) del.disabled = false;
                }
            };
            li.append(cb, sp, del);
            list.appendChild(li);
        }
        const capped = data.length >= TODO_RENDER_LIMIT;
        counter.textContent = data.length + (capped ? '+' : '') + ' shown · ' + open + ' open';
    }

    const TODO_TEXT_MAX = 500;

    async function insertTask(rawText) {
        if (disposed || !bb) return { error: { message: 'not ready — data unavailable' } };
        const text = String(rawText == null ? '' : rawText).trim().slice(0, TODO_TEXT_MAX);
        if (!text) return { error: { message: 'text is required' } };
        const r = await bb.from(todoTable).insert({ text, done: '0', created: Date.now().toString() });
        await refresh();
        return r;
    }

    addBtn.onclick = async () => {
        if (!bb) { status.textContent = t('todo.notReady', 'not ready — data unavailable'); return; }
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        const r = await insertTask(text);
        if (disposed) return;
        if (r.error) status.textContent = t('todo.insertError', 'insert error: ') + r.error.message;
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
    clearBtn.onclick = async () => {
        if (!bb) { status.textContent = t('todo.notReady', 'not ready — data unavailable'); return; }
        const r = await bb.from(todoTable).delete().eq('done', '1');
        if (disposed) return;
        if (r.error) status.textContent = t('todo.clearError', 'clear error: ') + r.error.message;
        refresh();
    };

    function setControlsDisabled(disabled) {
        input.disabled = disabled;
        addBtn.disabled = disabled;
        clearBtn.disabled = disabled;
    }

    (async () => {
        try {
            // Real upstream busybase running in-browser, plugkit-backed.
            const mod = await import('busybase');
            const embedded = await mod.createEmbedded({ backend: 'plugkit', dir: 'todo_app_' + instance.id });
            if (disposed) {
                // App was closed while boot was in flight; close the connection we just opened and stop.
                if (embedded && typeof embedded.close === 'function') { try { await embedded.close(); } catch (_) { /* ignore */ } }
                return;
            }
            bb = embedded;
            status.textContent = t('todo.readyDataPrefix', 'ready · data · ') + instance.id;
            window.__todoApps = window.__todoApps || {};
            window.__todoApps[instance.id] = { bb, refresh, tablePrefix, insertTask };
            await refresh();
        } catch (e) {
            if (disposed) return;
            status.textContent = t('todo.bootError', 'boot error: ') + (e && e.message || e);
            console.error('[todoApp] boot failed', e);
            setControlsDisabled(true);
        }
    })();

    function dispose() {
        if (disposed) return;
        disposed = true;
        if (window.__todoApps) delete window.__todoApps[instance.id];
        if (bb && typeof bb.close === 'function') {
            try { bb.close(); } catch (_) { /* ignore */ }
        }
        bb = null;
    }

    return { node, refresh: () => refresh(), dispose };
}
