// Files-app paint surface — bible classes, pure DOM. Consumer provides callbacks.
// renderFilesApp({list, readFile}) -> {node, refresh, dispose}.
// list() -> Promise<string[]>; readFile(path) -> Promise<string|Uint8Array>.
// Header text comes from {label} (consumer assembles "<id> — N files").

export function renderFilesApp(opts = {}) {
    const { list, readFile, label = '', pollMs = 2000 } = opts;
    const node = document.createElement('div');
    node.className = 'app-pane mono';
    node.dataset.component = 'files-app';

    let preview = null;
    let selected = null;
    function renderError(err) {
        node.innerHTML = '';
        const errRow = document.createElement('div');
        errRow.className = 'row-error';
        errRow.textContent = 'could not load files: ' + (err && err.message ? err.message : String(err));
        node.appendChild(errRow);
    }
    async function refresh() {
        const items = await list();
        preview = null;
        selected = null;
        node.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'head';
        head.textContent = (label ? label + ' — ' : '') + items.length + ' files';
        node.appendChild(head);
        for (const p of items) {
            const row = document.createElement('div');
            row.className = 'row';
            row.textContent = p;
            row.title = p;
            row.addEventListener('click', async () => {
                if (selected) selected.classList.remove('selected');
                selected = row;
                row.classList.add('selected');
                const body = await readFile(p);
                if (preview) preview.remove();
                preview = document.createElement('pre');
                preview.textContent = String(body);
                node.appendChild(preview);
            });
            node.appendChild(row);
        }
    }

    let timer = null;
    refresh().catch(renderError);
    if (pollMs > 0) timer = setInterval(() => refresh().catch(renderError), pollMs);

    return {
        node,
        refresh,
        dispose() { if (timer) clearInterval(timer); },
    };
}
