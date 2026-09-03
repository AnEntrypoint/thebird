// react-counter-app: a small stateful counter, closure-based like every
// other hand-rolled thebird app -- `count` is a closed-over let, render()
// builds the vnode tree via webjsx's createElement and diffs it onto the
// mount point via applyDiff. Zero design CSS: 'os-btn'/'meta' are the only
// classNames used, same as every other app already reuses. Ported off
// react-lite (h/createRoot/useState) onto webjsx directly -- react-lite.js
// was deleted, this was its only consumer. Extracted from docs/apps.js
// (pure code motion + the webjsx port applied in place), then moved to
// docs/examples/apps/ (t7-toy-apps-extract).
import { createElement, applyDiff } from '../../vendor/webjsx/index.js';
import { el, resolveInstance } from '../../apps.js';

export function reactCounterApp(ctx) {
    const instance = resolveInstance(ctx);
    const node = el('div', 'app-pane');
    node.dataset.component = 'react-counter-app';
    const mountPoint = document.createElement('div');
    node.appendChild(mountPoint);

    let count = 0;
    const render = () => {
        applyDiff(mountPoint, createElement('div', null,
            createElement('div', { class: 'meta' }, 'counter - ' + instance.id),
            createElement('div', null, 'count: ' + count),
            createElement('button', { class: 'os-btn', onclick: () => { count += 1; render(); } }, '+1'),
            createElement('button', { class: 'os-btn', onclick: () => { count = 0; render(); } }, 'reset'),
        ));
    };
    render();

    return {
        node,
        dispose: () => { try { mountPoint.replaceChildren(); } catch { /* swallow: window is closing regardless */ } },
    };
}
