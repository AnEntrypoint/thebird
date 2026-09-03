// deck-stage — compat re-export shim. registerDeckStage() lazily side-effect
// imports the real implementation, now living at src/kits/slides/deck-stage.js
// (moved from the top-level slides/ dir so the deck kit follows the same
// src/kits/<name>/ convention every other kit uses; this shim keeps the old
// src/deck-stage.js import path working for any existing consumer).

let _registered = false;
export async function registerDeckStage() {
    if (_registered) return (typeof customElements !== 'undefined') ? customElements.get('deck-stage') : null;
    if (typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') return null;
    try {
        await import('./kits/slides/deck-stage.js');
    } catch (err) {
        console.warn('[247420] deck-stage import failed:', err);
        return null;
    }
    _registered = true;
    return customElements.get('deck-stage');
}

export function getDeckStage() {
    return (typeof customElements !== 'undefined') ? customElements.get('deck-stage') : null;
}
