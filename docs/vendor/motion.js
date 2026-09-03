// Minimal motion — the SDK historically wired animate.css for entry
// flourishes. We tone this down: no animate.css, just a single GPU-friendly
// fade-up on first paint. animateTree() walks once and marks rendered nodes
// so it doesn't re-animate on every applyDiff.

export function installMotion() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('ds-247420-motion')) return;
    const style = document.createElement('style');
    style.id = 'ds-247420-motion';
    style.textContent = `
@media (prefers-reduced-motion: no-preference) {
  .ds-247420 [data-anim="in"] {
    opacity: 0; transform: translateY(14px);
    /* Physical signature reveal — a slight spring landing, not a flat fade. */
    transition: opacity var(--dur-reveal, 560ms) var(--ease, cubic-bezier(.2,0,0,1)),
                transform var(--dur-reveal, 560ms) var(--ease-spring, cubic-bezier(0.34,1.56,0.64,1));
  }
  .ds-247420 [data-anim="ready"] {
    opacity: 1; transform: translateY(0);
  }
}
/* [data-motion="reduced"] is the in-app user override (motion-toggle.js) —
   applies the exact same reduced-motion treatment as the OS-level
   prefers-reduced-motion media query above, independent of the OS setting.
   Selector applies regardless of the media query's own match state, so it
   correctly overrides the animated block above on any OS. */
:root[data-motion="reduced"] .ds-247420 [data-anim="in"],
.ds-247420[data-motion="reduced"] [data-anim="in"] {
  opacity: 1 !important; transform: translateY(0) !important;
  transition: none !important;
}
:root[data-motion="reduced"] .ds-247420 [data-anim="ready"],
.ds-247420[data-motion="reduced"] [data-anim="ready"] {
  transition: none !important;
}`.trim();
    document.head.appendChild(style);
}

export function animateTree(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    // Mark sections / hero / panels for entry.
    const targets = root.querySelectorAll('.ds-hero,.panel,.ds-section,.app-main > *');
    targets.forEach((el, i) => {
        if (el.dataset.anim === 'ready') return;
        el.dataset.anim = 'in';
        // stagger up to 6 elements, then snap the rest in
        const delay = Math.min(i, 6) * 30;
        setTimeout(() => { el.dataset.anim = 'ready'; }, delay);
    });
}
