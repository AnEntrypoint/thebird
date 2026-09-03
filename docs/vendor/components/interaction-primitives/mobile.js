// Mobile-breakpoint detection — subscribe-style (webjsx has no hooks/
// useSyncExternalStore equivalent; consumers re-render on the callback).
// Builds on editor-primitives.js's BP_SM (480px) rather than pi-web's
// hardcoded 640px so it stays one source of truth with the Grid/GridItem
// breakpoint tiers already in this design system.

const MOBILE_QUERY = '(max-width: 480px)';

export function isMobileNow() {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(MOBILE_QUERY).matches;
}

// Returns an unsubscribe function, mirroring theme.js's onThemeChange shape.
export function onMobileChange(cb) {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mql = window.matchMedia(MOBILE_QUERY);
    const handler = () => cb(mql.matches);
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler);
    return () => {
        if (mql.removeEventListener) mql.removeEventListener('change', handler);
        else mql.removeListener(handler);
    };
}
