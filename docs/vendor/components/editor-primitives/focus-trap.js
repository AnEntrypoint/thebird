// ---------------------------------------------------------------------------
// FocusTrap — wraps subtree, traps Tab/Shift+Tab. Mount/unmount lifecycle is
// managed via DOM-level keydown listener attached when first focused.
// ---------------------------------------------------------------------------

import * as webjsx from '../../../vendor/webjsx/index.js';
import { kids, FOCUSABLE_SEL, trapTabKey } from './shared.js';
const h = webjsx.createElement;

export function FocusTrap({ children } = {}) {
    return h('div', {
        class: 'ds-ep-focustrap',
        tabindex: '-1',
        ref: (el) => {
            if (!el || el._dsTrap) return;
            el._dsTrap = true;
            el.addEventListener('keydown', (e) => trapTabKey(el, e));
            // Auto-focus first focusable. setTimeout(0), not queueMicrotask: the
            // triggering click's own default focus-on-click runs in the same tick,
            // which can race a same-tick microtask and leave focus on the trigger.
            setTimeout(() => {
                const first = el.querySelector(FOCUSABLE_SEL);
                if (first) first.focus();
                else el.focus();
            }, 0);
        }
    }, ...kids(children));
}
