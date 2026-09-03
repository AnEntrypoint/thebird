// 247420 design system — styles
// Loads the prefixed CSS bundle (./247420.css alongside this file) and
// exposes the scope class consumers add to their wrapping element.

export const scope = '.ds-247420';

let _cssPromise = null;

export function loadCss() {
    if (_cssPromise) return _cssPromise;
    _cssPromise = (async () => {
        // Resolve relative to this module so it works whether loaded from
        // unpkg, jsdelivr, or a local copy.
        const url = new URL('../dist/247420.css', import.meta.url);
        const res = await fetch(url);
        if (!res.ok) throw new Error('247420: failed to load css ' + res.status);
        return await res.text();
    })();
    return _cssPromise;
}

// Back-compat: code that read `css` directly after a `loadCss()` call gets
// the populated string. New code should `await loadCss()`.
export let css = '';
loadCss().then((s) => { css = s; }).catch(() => {});
