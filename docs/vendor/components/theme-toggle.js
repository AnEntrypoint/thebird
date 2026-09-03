// ThemeToggle — segmented auto/paper/ink radio bound to src/theme.js.
//
// Usage:
//   import { ThemeToggle } from 'anentrypoint-design';
//   ThemeToggle()                                   // segmented control
//   ThemeToggle({ compact: true })                  // single cycling glyph button
//
// Reads current mode from the theme controller; clicks call applyTheme()
// which persists, updates <html data-theme>, and notifies listeners.

import * as webjsx from '../../vendor/webjsx/index.js';
import { applyTheme, getTheme, resolvedTheme, onThemeChange } from '../theme.js';
import { Icon, iconMarkup } from './shell/icons.js';

const h = webjsx.createElement;

const MODES = [
    ['auto',  'auto'],
    ['paper', 'light'],
    ['ink',   'dark'],
];

// Sun/moon/contrast line-icon per mode (ICON_PATHS already carries these —
// see icons.js's "theme-toggle icons" entry) so the control reads at a
// glance even before the text label is parsed, not just via the CSS-drawn
// disc (which is icon-rail-only; the compact button keeps its text label).
const ICON_FOR_MODE = { auto: 'contrast', paper: 'sun', ink: 'moon' };

// Both variants render from `getTheme()` at the moment their vnode is built,
// but nothing re-renders this control when the theme changes: a host kit's view
// is not subscribed to the theme, and applyTheme() only touches <html> and the
// theme listeners. So each instance repaints itself from the live theme through
// a ref — once on mount, then on every theme change. `el._dsThemeBound` makes
// that idempotent, since a ref callback runs again on each re-render of the
// host. (This replaces a `refresh` Set that nothing ever added to, so the
// onThemeChange subscription it fed always iterated an empty set.)
function bindThemePaint(el, paint) {
    if (!el || el._dsThemeBound) return;
    el._dsThemeBound = true;
    paint();
    onThemeChange(paint);
}

export function ThemeToggle({ compact = false, onChange } = {}) {
    const current = getTheme();

    if (compact) {
        // Plain words only - 'ink'/'paper' are internal theme codenames a user
        // never chose; the resolved scheme rides in the title, not the label.
        const wordFor = (t) => (t === 'auto' ? 'auto' : (t === 'ink' ? 'dark' : 'light'));
        const labelFor = (t) => 'theme: ' + wordFor(t);
        const titleFor = (t) => labelFor(t)
            + (t === 'auto' ? ' (currently ' + (resolvedTheme() === 'ink' ? 'dark' : 'light') + ')' : '')
            + ' — click to cycle';
        return h('button', {
            class: 'btn ds-theme-toggle',
            type: 'button',
            'aria-label': labelFor(current),
            title: titleFor(current),
            // getTheme() at click time, not the `current` captured when this
            // vnode was built. Nothing re-renders this button on a theme
            // change, so a captured value goes stale after the first click and
            // the cycle sticks: auto -> paper, then every later click computes
            // from a stale 'auto' and lands on paper again.
            onclick: () => {
                const now = getTheme();
                const next = now === 'auto' ? 'paper' : (now === 'paper' ? 'ink' : 'auto');
                applyTheme(next);
                if (onChange) try { onChange(next); } catch { /* swallow: consumer onChange callback must not break the toggle */ }
            },
            ref: (el) => bindThemePaint(el, () => {
                const now = getTheme();
                el.setAttribute('aria-label', labelFor(now));
                el.setAttribute('title', titleFor(now));
                const lab = el.querySelector('.ds-theme-toggle-label');
                if (lab) lab.textContent = labelFor(now);
                const disc = el.querySelector('.ds-theme-disc');
                if (disc) disc.setAttribute('data-mode', now);
                // Repaint via raw markup (not a webjsx re-render — this ref
                // runs outside any applyDiff pass), same pattern as icons.js's
                // iconMarkup() is meant for: raw-DOM consumers with no
                // webjsx render scope at hand.
                const icon = el.querySelector('.ds-theme-toggle-icon');
                if (icon) icon.innerHTML = iconMarkup(ICON_FOR_MODE[now] || 'contrast', { size: 14 });
            })
        },
        // CSS-drawn disc so the control still reads as the theme switch when
        // the label is hidden (icon-only rail strip). data-mode selects a
        // per-mode fill (solid light / solid dark / half-and-half for auto)
        // so the icon itself — not just the title tooltip — shows current
        // state at a glance.
        h('span', { class: 'ds-theme-disc', 'data-mode': current, 'aria-hidden': 'true' }),
        // Sun/moon/contrast glyph alongside the text label — was text-only
        // ("theme: auto"), so the control carried no visual cue of the
        // current mode beyond the tiny CSS disc. Kept minimal: one small
        // line-icon, no extra chrome.
        h('span', { class: 'ds-theme-toggle-icon' }, Icon(ICON_FOR_MODE[current] || 'contrast', { size: 14 })),
        h('span', { class: 'ds-theme-toggle-label' }, labelFor(current)));
    }

    return h('div', {
        class: 'ds-theme-toggle ds-segmented',
        role: 'radiogroup',
        'aria-label': 'theme',
        // Paint the selected segment from the live theme rather than only from
        // `current` (captured when this vnode was built). Nothing re-renders
        // this control when it is clicked: the host kit's view is not
        // subscribed to the theme, so applyTheme() correctly flipped
        // <html data-theme> while the segment kept `is-on` on whatever was
        // selected at mount — clicking "light" changed the theme but left
        // "auto" looking selected, which reads as a control that did nothing.
        // Doing it in a ref keeps this correct for BOTH triggers: a click here,
        // and an external change (another toggle, or the OS scheme flipping
        // while in auto) via the onThemeChange subscription.
        ref: (el) => bindThemePaint(el, () => {
            const now = getTheme();
            for (const btn of el.querySelectorAll('.ds-seg-btn')) {
                const on = btn.dataset.mode === now;
                btn.classList.toggle('is-on', on);
                btn.setAttribute('aria-checked', on ? 'true' : 'false');
            }
        })
    }, ...MODES.map(([mode, label]) =>
        h('button', {
            key: mode,
            type: 'button',
            role: 'radio',
            'data-mode': mode,
            'aria-checked': current === mode ? 'true' : 'false',
            class: 'ds-seg-btn' + (current === mode ? ' is-on' : ''),
            onclick: () => {
                applyTheme(mode);
                if (onChange) try { onChange(mode); } catch { /* swallow: consumer onChange callback must not break the toggle */ }
            }
        }, label)
    ));
}
