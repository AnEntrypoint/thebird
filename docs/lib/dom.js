// Small DOM helpers that centralize the innerHTML sinks thebird still needs.
//
// setIcon() is the ONE audited call site for injecting icon markup (trusted,
// static SVG strings from vendor/components/shell.js iconMarkup()) — instead
// of every app doing `el.innerHTML = iconMarkup(name)` inline, they call
// setIcon(el, name) and the sink lives here alone.
//
// Clear-then-rebuild patterns (`el.innerHTML = ''` before appending fresh
// children) should use `el.replaceChildren()` directly — no innerHTML sink
// needed for that case, so there's no helper for it here.

import { iconMarkup } from '../vendor/components/shell.js';

export function setIcon(el, name, opts) {
  el.innerHTML = iconMarkup(name, opts);
  return el;
}

// Canonical el() helper, unifying the two incompatible el() signatures that
// were hand-copied across seven app files:
//   el(tag, cls, text)          -- className string + single text child
//   el(tag, attrs, ...kids)     -- attrs object (class/on*/other attrs) + N children (nodes or text)
// The second positional arg's typeof decides which contract applies, so
// every existing call site works unchanged: a string is treated as
// className (+ optional 3rd-arg text), a plain object is treated as attrs
// (+ trailing node/string children).
export function el(tag, clsOrAttrs, ...rest) {
  const e = document.createElement(tag);
  // null/undefined arg2 takes the string branch with no className: callers
  // passing el(tag, null, text) meant "no class, with text" and previously
  // lost the text silently (empty-label buttons) — treat null like ''.
  if (typeof clsOrAttrs === 'string' || clsOrAttrs == null) {
    if (clsOrAttrs) e.className = clsOrAttrs;
    const text = rest[0];
    if (text != null) { if (text.nodeType) e.append(text); else e.textContent = text; }
  } else if (clsOrAttrs && typeof clsOrAttrs === 'object') {
    for (const [k, v] of Object.entries(clsOrAttrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === false) { /* omit boolean-false attrs (disabled/checked/...) */ }
      else if (v === true) e.setAttribute(k, '');
      else if (v != null) {
        if (typeof v === 'object') console.warn(`el(): non-primitive attribute value for "${k}" on <${tag}> — did you mean a different arg shape?`, v);
        e.setAttribute(k, v);
      }
    }
    for (const kid of rest) { if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  }
  return e;
}

// Themed confirm dialog shared by every app that needs a destructive-action
// confirm instead of native confirm()/alert(). Reuses the same .tb-sess-modal
// classes session-ui.js's own destroy-workspace modal uses (styled upstream
// in anentrypoint-design) so every confirm dialog in the OS looks identical
// regardless of which app opens it. Returns a Promise<boolean> resolving
// true if the danger action was clicked, false on cancel/ESC/backdrop-click.
export function confirmDialog({ title, message, hint, confirmLabel = 'Delete', cancelLabel = 'Cancel' } = {}) {
  return new Promise(resolve => {
    const opener = document.activeElement;
    const dialog = el('dialog', 'tb-sess-modal');
    const head = el('div', 'tb-sess-modal-head');
    head.append(el('span', 'tb-sess-modal-title', title || ''));
    const closeBtn = el('button', 'tb-sess-modal-x');
    closeBtn.setAttribute('aria-label', 'Close');
    setIcon(closeBtn, 'x');
    closeBtn.type = 'button';
    head.append(closeBtn);
    const body = el('div', 'tb-sess-modal-body');
    body.append(el('div', 'tb-sess-modal-msg', message || ''));
    if (hint) body.append(el('div', 'tb-sess-modal-hint', hint));
    const foot = el('div', 'tb-sess-modal-foot');
    let settled = false;
    const cancelBtn = el('button', 'tb-sess-modal-btn', cancelLabel);
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => close(false));
    const confirmBtn = el('button', 'tb-sess-modal-btn danger primary', confirmLabel);
    confirmBtn.type = 'button';
    confirmBtn.addEventListener('click', () => close(true));
    foot.append(cancelBtn, confirmBtn);
    dialog.append(head, body, foot);
    document.body.append(dialog);

    function close(result) {
      if (settled) return;
      settled = true;
      resolve(result);
      dialog.close();
    }
    dialog.addEventListener('close', () => {
      if (!settled) resolve(false);
      dialog.remove();
      if (document.activeElement === document.body || !document.activeElement) {
        if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
      }
    }, { once: true });
    dialog.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); confirmBtn.click(); }
    });
    closeBtn.addEventListener('click', () => close(false));
    dialog.addEventListener('click', e => { if (e.target === dialog) close(false); });
    dialog.showModal();
    requestAnimationFrame(() => confirmBtn.focus());
  });
}
