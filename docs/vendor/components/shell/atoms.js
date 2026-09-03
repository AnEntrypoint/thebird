// Chrome atoms: the smallest pure label/control factories the shell and every
// higher-level component build on — Brand, Chip, Btn, IconButton, Badge, Pill,
// Glyph, Heading, Lede, Dot, Rail. Props in, webjsx vnode out; all visuals ride
// class names defined in app-shell.css.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Icon } from './icons.js';
const h = webjsx.createElement;

/**
 * The wordmark used in Topbar/AppShell headers.
 *
 * @param {Object} [props]
 * @param {string} [props.name='247420'] - the brand text.
 * @param {*} [props.leaf] - optional trailing breadcrumb-style leaf, rendered after a " / " separator.
 * @returns {*} webjsx vnode
 */
export function Brand({ name = '247420', leaf } = {}) {
    return h('span', { class: 'brand' }, name,
        leaf ? h('span', { class: 'slash' }, ' / ') : null,
        leaf || null);
}

/**
 * A small pill/tag label.
 *
 * @param {Object} props
 * @param {string} [props.tone=''] - semantic color tone (empty = neutral).
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {boolean} [props.tag=false] - true renders a rectangular sentence-case variant for dense data (drops the all-caps pill styling). Orthogonal to tone.
 * @param {Function} [props.onRemove] - if given, renders a trailing dismiss (x) button that calls onRemove() on click. Omitted entirely (no button) when not supplied.
 * @param {*} props.children
 * @returns {*} webjsx vnode
 */
export function Chip({ tone = '', size = 'md', tag = false, onRemove, children }) {
    const sizeCls = size === 'sm' ? ' chip--sm' : (size === 'lg' ? ' chip--lg' : '');
    return h('span', { class: 'chip' + sizeCls + (tag ? ' chip--tag' : '') + (tone ? ' tone-' + tone : '') + (onRemove ? ' ds-chip-removable' : '') },
        children,
        onRemove ? h('button', { type: 'button', class: 'ds-chip-remove-btn', 'aria-label': 'Remove', onclick: (e) => { e.stopPropagation(); onRemove(); } }, Icon('x')) : null);
}

/**
 * The standard button/link factory. Renders an `<a>` when `href` is given,
 * otherwise a `<button>`.
 *
 * @param {Object} props
 * @param {string} [props.href] - if present, renders as a link instead of a button.
 * @param {'default'|'primary'|'ghost'|'danger'} [props.variant='default']
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {*} props.children
 * @param {Function} [props.onClick]
 * @param {string} [props['aria-label']]
 * @param {boolean} [props.primary] - legacy alias for variant:'primary', kept for backward compatibility.
 * @param {boolean} [props.ghost] - legacy alias for variant:'ghost'.
 * @param {boolean} [props.danger] - legacy alias for variant:'danger'.
 * @param {boolean} [props.disabled]
 * @param {string} [props.class] - extra class name(s) appended to the generated class list.
 * @param {*} [props.key]
 * @returns {*} webjsx vnode
 */
export function Btn({ href, variant = 'default', size = 'md', children, onClick, 'aria-label': ariaLabel, primary, ghost, danger, disabled, class: className, key }) {
    // Support legacy primary/ghost props for backward compatibility, but prefer variant
    const resolvedVariant = variant !== 'default' ? variant : (primary ? 'primary' : (ghost ? 'ghost' : (danger ? 'danger' : 'default')));
    // size: 'sm' | 'md' | 'lg' — md is the base .btn rule (no class); sm/lg add a
    // modifier that snaps height/padding/font to the --ctl-* ladder. Unknown
    // sizes fall back to md so a typo never drops the button's base styling.
    const sizeCls = size === 'sm' ? ' btn-sm' : (size === 'lg' ? ' btn-lg' : '');
    const cls = (resolvedVariant === 'primary' ? 'btn-primary' : (resolvedVariant === 'ghost' ? 'btn-ghost' : (resolvedVariant === 'danger' ? 'btn-primary danger' : (resolvedVariant === 'link' ? 'btn-link' : 'btn'))))
        + sizeCls
        + (disabled ? ' is-disabled' : '')
        + (className ? ' ' + className : '');
    const onclick = (e) => {
        if (disabled) { e.preventDefault(); return; }
        if (onClick) onClick(e);
    };
    const ariaName = ariaLabel || (typeof children === 'string' ? children : undefined);

    // A real navigational href renders an anchor; everything else is an action
    // button and renders a native <button> (correct semantics + keyboard
    // activation for free, no role=button / href="#" scroll-jump hack).
    // children may be a string OR an array of vnodes (e.g. icon + label); spread
    // arrays so each vnode is a real child - passing the array as a single child
    // produces a nested array webjsx applyDiff cannot key-diff (reading 'key').
    const kids = Array.isArray(children) ? children : [children];
    const isLink = href != null && href !== '' && href !== '#';
    if (isLink) {
        return h('a', {
            key,
            class: cls, href,
            'aria-label': ariaName,
            'aria-disabled': disabled ? 'true' : null,
            tabindex: disabled ? '-1' : null,
            onclick
        }, ...kids);
    }
    return h('button', {
        key,
        type: 'button', class: cls,
        disabled: disabled ? true : null,
        'aria-label': ariaName,
        onclick
    }, ...kids);
}

export function IconButton({ icon, onClick, title, size = 'base', variant = 'ghost', disabled = false }) {
    const cls = 'ds-icon-btn ds-icon-btn-' + variant + ' ds-icon-btn-' + size + (disabled ? ' is-disabled' : '');
    return h('button', {
        type: 'button',
        class: cls,
        title,
        'aria-label': title,
        disabled: disabled ? true : null,
        onclick: (e) => { if (disabled) { e.preventDefault(); return; } if (onClick) onClick(e); }
    }, Glyph({ children: icon, size }));
}

export function Badge({ children, variant = 'default', tone = 'neutral', size = 'md' }) {
    // size: 'sm' | 'md' | 'lg' — md is the base 18px badge.
    const sizeCls = size === 'sm' ? ' ds-badge--sm' : (size === 'lg' ? ' ds-badge--lg' : '');
    return h('span', { class: 'ds-badge ds-badge-' + variant + sizeCls + ' tone-' + tone }, children);
}

// Pill — plain non-interactive label chip for tag-like annotations (a phase
// name, an id, a subsystem tag). Distinct from Chip (status-tone indicator),
// Badge (count/variant marker), and FilterPills (interactive toggle-group):
// Pill renders no button, carries no pressed/active state, just a small
// rounded label. tone is a semantic keyword ('' | 'accent' | 'muted'),
// never a raw color — every visual rides colors_and_type.css tokens.
export function Pill({ tone = '', children, key } = {}) {
    return h('span', { key, class: 'ds-pill' + (tone ? ' tone-' + tone : '') }, children);
}

export function Glyph({ children, color, size = 'base', label } = {}) {
    // Font-size is var-driven per size class (--glyph-size-{size}) so themes can
    // retune glyph scale; inline fallback keeps sizing if the SDK CSS hasn't
    // loaded yet. Size class is the stable hook (glyph-sm / glyph-base / glyph-lg).
    const fallback = size === 'sm' ? '11px' : (size === 'lg' ? '16px' : '13px');
    const cls = 'glyph glyph-' + size;
    const style = `font-size:var(--glyph-size-${size}, ${fallback})` + (color ? `;color:${color}` : '');
    // Decorative by default (screen readers skip the glyph char). Pass `label`
    // to expose an accessible name instead.
    return h('span', label
        ? { class: cls, style, role: 'img', 'aria-label': label }
        : { class: cls, style, 'aria-hidden': 'true' }, children);
}

export function Heading({ level = 1, children, style = '', class: className = '', 'aria-level': ariaLevel }) {
    return h('h' + level, { class: className || null, style, 'aria-level': ariaLevel != null ? String(ariaLevel) : null }, children);
}

export function Lede({ children }) {
    return h('p', { class: 'lede' }, children);
}

export function Dot({ tone = 'on' }) {
    const isOn = tone === 'on' || tone === 'live';
    // 'live' gets its own visual modifier (ds-dot-live, sky hue) layered on
    // top of ds-dot-on so a live-broadcast indicator is never visually
    // identical to a plain "this thing is on" status dot — same split
    // rationale as .chip.tone-live / .ds-badge.tone-live.
    const modifierCls = tone === 'live' ? ' ds-dot-live' : (tone === 'warn' ? ' ds-dot-warn' : '');
    const cls = 'ds-dot ' + (tone === 'warn' ? 'ds-dot-off' : (isOn ? 'ds-dot-on' : 'ds-dot-off')) + modifierCls;
    const statusLabel = tone === 'live' ? 'live status indicator' : (tone === 'warn' ? 'warning status indicator' : (isOn ? 'on status indicator' : 'off status indicator'));
    // Drawn as a CSS circle (.ds-dot) — no decorative text glyph.
    return h('span', { class: cls, role: 'img', 'aria-label': statusLabel });
}

export function Rail({ tone = 'green' }) {
    return h('span', { class: 'ds-rail tone-' + tone, 'aria-hidden': 'true' });
}
