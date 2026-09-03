// Monochrome inline-SVG icon set. Single source for the line-icon vocabulary
// AGENTS.md mandates in place of decorative unicode glyphs: extend ICON_PATHS
// to add a name (an out-of-set name renders an EMPTY span, a silent bug).
// Two renderers share one attribute contract — Icon() for webjsx render
// scopes, iconMarkup() for raw-DOM consumers that assign innerHTML.

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

// Monochrome inline-SVG icons (stroke=currentColor) so chrome reads as one
// coherent line-icon set instead of multicolor OS emoji. 16px box, 1.6 stroke.
export const ICON_PATHS = {
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    mic: '<path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    'mic-off': '<path d="M9 9v2a3 3 0 0 0 4.5 2.6M15 11V6a3 3 0 0 0-5.9-.8"/><path d="M5 11a7 7 0 0 0 11.5 5.4M12 18v3"/><path d="m4 4 16 16"/>',
    speaker: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    'speaker-off': '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m17 9 4 6M21 9l-4 6"/>',
    camera: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
    screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    phone: '<path d="M5 4h3l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    members: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    paperclip: '<path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0"/><path d="M9 9h.01M15 9h.01"/>',
    'more-horizontal': '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 8a4 4 0 0 1 0 8M18 5a8 8 0 0 1 0 14"/>',
    forum: '<path d="M4 5h13a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
    page: '<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8 13h8M8 17h6"/>',
    thread: '<path d="M5 6h14M5 11h14M5 16h8"/><circle cx="17" cy="17" r="3"/>',
    // status / control icons (replace decorative text glyphs at the source)
    check: '<path d="M20 6 9 17l-5-5"/>',
    'check-check': '<path d="M18 6 7 17l-3-3"/><path d="m22 10-7.5 7.5L13 16"/>',
    'chevron-right': '<path d="m9 6 6 6-6 6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-up': '<path d="m6 15 6-6 6 6"/>',
    'arrow-down': '<path d="M12 5v14M5 12l7 7 7-7"/>',
    'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    play: '<path d="M6 4v16l14-8z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    circle: '<circle cx="12" cy="12" r="9"/>',
    'circle-dot': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
    dot: '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
    square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2-2.4 3.7M12 17h.01"/>',
    warn: '<path d="M10.3 4 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    // file-type icons (replace the FILE_GLYPHS unicode set)
    'file-pdf': '<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
    'file-zip': '<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M11 4v3M11 9v3M11 14v3"/>',
    'file-video': '<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="m10 12 4 2.5L10 17z"/>',
    'file-audio': '<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M9 17v-3l4-1v3"/><circle cx="8" cy="17" r="1"/><circle cx="12" cy="16" r="1"/>',
    'file-sheet': '<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h8M12 11v8"/>',
    'file-code': '<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="m10 12-2 2 2 2M14 12l2 2-2 2"/>',
    'file-text': '<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h6"/>',
    file: '<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/>',
    pencil: '<path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17z"/><path d="M14 6l3 3"/>',
    'skip-forward': '<path d="M5 5v14l9-7z"/><path d="M19 5v14"/>',
    'chevron-left': '<path d="m15 6-6 6 6 6"/>',
    trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
    'external-link': '<path d="M14 4h6v6M20 4l-9 9M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
    // theme-toggle icons (replace decorative sun/moon/contrast text glyphs)
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
    contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>',
    // file-browser icons (replace folder/file emoji + arrow glyphs in fs apps)
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    'folder-open': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2H5l-2 9z"/><path d="M3 18l2-9h17l-2 9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    // density-picker icons (list / compact / thumbnail view modes)
    rows: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    'rows-tight': '<path d="M4 5h16M4 9h16M4 13h16M4 17h16"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    'file-image': '<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><circle cx="9.5" cy="12.5" r="1.5"/><path d="M18 19l-4-4-3 3-2-2-3 3"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/>',
    'corner-up-left': '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v6"/>',
    // clipboard/copy — for the per-block code copy + message copy action, so the
    // copy affordance reads as copy, not the lined-document `page` glyph.
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    clipboard: '<rect x="8" y="4" width="8" height="4" rx="1"/><path d="M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2"/>',
    // Live-cursor pointer arrow — collab.js's LiveCursorOverlay renders one
    // per remote collaborator, filled with that collaborator's color.
    cursor: '<path d="M5 3l14 8-6.5 1.5L11 20z"/>',
    // Password-visibility toggle — eye / eye-off pair.
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M2 12s3.5-7 10-7c1.7 0 3.2.4 4.5 1.1M22 12s-3.5 7-10 7c-1.7 0-3.2-.4-4.5-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m4 4 16 16"/>',
    // Auth-provider glyphs for the signin kit — generic provider-neutral
    // shapes (not trademarked logo reproductions), so a real icon renders
    // instead of a text-letter abbreviation per AGENTS.md icon policy.
    // github: a rounded body + one circular "eye", a widely-recognized
    // silhouette-family shape without tracing the actual brand mark.
    github: '<path d="M12 3a8 8 0 0 0-2.5 15.6c.4.1.5-.2.5-.4v-1.7c-2.2.4-2.7-1-2.9-1.6-.1-.3-.5-1-1-1.2-.3-.1-.6-.4 0-.5.9-.1 1.5.8 1.7 1.1.7 1.1 1.7.8 2.1.6.1-.5.3-.8.6-1-2.2-.3-3.4-1.4-3.4-3.4 0-.8.3-1.5.7-2-.1-.3-.3-1.1.1-2.2 0 0 .8-.2 2.5.9a8 8 0 0 1 4.5 0c1.7-1.1 2.5-.9 2.5-.9.4 1.1.2 1.9.1 2.2.5.5.7 1.2.7 2 0 2-1.2 3.1-3.4 3.4.3.3.6.8.6 1.5v2.1c0 .2.1.5.5.4A8 8 0 0 0 12 3z"/>',
    // google: provider-neutral "G-circle" — a plain ring with a break and a
    // short spoke, evoking the four-color pinwheel mark's silhouette only.
    google: '<circle cx="12" cy="12" r="8"/><path d="M12 12h6"/><path d="M12 8v4"/>',
    // sso: shield-check, a common auth/identity glyph for a generic
    // single-sign-on entry point.
    sso: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>'
};

// The single SVG attribute contract (viewBox/stroke/linecap…) shared by both
// the markup-string and the vnode renderers below, so the icon shape is defined
// once. Insertion order is the serialized attribute order iconMarkup emits.
function iconAttrs(name, size) {
    return {
        class: 'ds-icon ds-icon-' + name,
        width: String(size), height: String(size), viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', 'stroke-width': 'var(--ds-icon-stroke, 1.6)',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
    };
}
// Normalize the (name) | ({name,size}) call shapes both renderers accept.
function iconArgs(name, size) {
    if (name && typeof name === 'object') ({ name, size = 16 } = name);
    return { name, size };
}
// Raw-DOM consumers (no webjsx render in scope) need the SVG as a markup string
// rather than an h() vnode. Same path table + attr contract as Icon(); use
// innerHTML = iconMarkup(name). Keeps the icon paths upstream so raw-DOM call
// sites never reintroduce decorative glyph literals.
export function iconMarkup(name, { size = 16 } = {}) {
    ({ name, size } = iconArgs(name, size));
    const inner = ICON_PATHS[name];
    if (!inner) return '';
    const attrs = Object.entries(iconAttrs(name, size)).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<svg ${attrs}>${inner}</svg>`;
}
export function Icon(name, { size = 16 } = {}) {
    ({ name, size } = iconArgs(name, size));
    const inner = ICON_PATHS[name];
    if (!inner) return h('span', { class: 'glyph', 'aria-hidden': 'true' }, '');
    return h('svg', { ...iconAttrs(name, size), dangerouslySetInnerHTML: { __html: inner } });
}
