// Launcher dock paint surface — pure DOM rendering, no lifecycle.
// Consumer (thebird) owns instance creation, fs/worker/shell wiring, teardown.
// renderDock returns a handle whose setInstances/setActive are called from
// lifecycle code. Visuals are bible-aligned: panel-select bg + accent inset
// rail for active, tonal hover, lowercase mono labels. Add/close controls
// render through ./icons.js's SVG contract, not raw ASCII glyphs.

import { icons } from './icons.js';

export function renderDock(opts = {}) {
    const { root = document.body, callbacks = {} } = opts;

    const el = document.createElement('div');
    el.className = 'launcher-dock';

    const addBtn = document.createElement('button');
    addBtn.className = 'launcher-btn launcher-add';
    addBtn.innerHTML = icons.plus;
    addBtn.title = 'new instance';
    addBtn.setAttribute('aria-label', 'new instance');
    addBtn.addEventListener('click', () => callbacks.onNewInstance && callbacks.onNewInstance());
    el.appendChild(addBtn);

    const instancesHost = document.createElement('div');
    instancesHost.className = 'launcher-instances';
    el.appendChild(instancesHost);

    root.appendChild(el);

    let activeId = null;
    const buttons = new Map();

    function clear() {
        while (instancesHost.firstChild) instancesHost.removeChild(instancesHost.firstChild);
        buttons.clear();
    }

    function setInstances(list) {
        clear();
        for (const inst of list) {
            const row = document.createElement('div');
            row.className = 'launcher-row';
            row.dataset.instanceId = inst.id;

            const selBtn = document.createElement('button');
            selBtn.className = 'launcher-btn';
            selBtn.textContent = inst.label || inst.id;
            selBtn.title = 'instance ' + inst.id;
            selBtn.setAttribute('aria-label', 'instance ' + inst.id);
            selBtn.dataset.role = 'select';
            selBtn.dataset.instanceId = inst.id;
            if (inst.active || inst.id === activeId) selBtn.classList.add('active');
            selBtn.addEventListener('click', () => callbacks.onSelectInstance && callbacks.onSelectInstance(inst.id));

            const closeBtn = document.createElement('button');
            closeBtn.className = 'launcher-btn launcher-close';
            closeBtn.innerHTML = icons.close;
            closeBtn.title = 'close ' + inst.id;
            closeBtn.setAttribute('aria-label', 'close ' + inst.id);
            closeBtn.dataset.role = 'close';
            closeBtn.dataset.instanceId = inst.id;
            // Destructive one-click close gets a second-click-to-confirm: the
            // first click arms the button (visual + aria-label change) instead
            // of firing immediately; a second click within the window commits.
            // Clicking elsewhere, or the arm window elapsing, disarms silently.
            let armed = false;
            let armTimer = null;
            function disarm() {
                armed = false;
                if (armTimer) { clearTimeout(armTimer); armTimer = null; }
                closeBtn.classList.remove('confirm');
                closeBtn.setAttribute('aria-label', 'close ' + inst.id);
            }
            closeBtn.addEventListener('click', e => {
                e.stopPropagation();
                if (!armed) {
                    armed = true;
                    closeBtn.classList.add('confirm');
                    closeBtn.setAttribute('aria-label', 'confirm close ' + inst.id);
                    armTimer = setTimeout(disarm, 3000);
                    return;
                }
                disarm();
                callbacks.onCloseInstance && callbacks.onCloseInstance(inst.id);
            });
            closeBtn.addEventListener('blur', disarm);

            row.append(selBtn, closeBtn);
            instancesHost.appendChild(row);
            buttons.set(inst.id, { selBtn, closeBtn, row });
        }
        if (activeId && !buttons.has(activeId)) activeId = null;
    }

    function setActive(id) {
        activeId = id;
        for (const [iid, b] of buttons) b.selBtn.classList.toggle('active', iid === id);
    }

    function dispose() {
        el.remove();
        buttons.clear();
    }

    return { el, setInstances, setActive, dispose };
}
