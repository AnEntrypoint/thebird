// Masthead blocks — the page-opening surfaces: Hero (a left-aligned,
// left-inset single-column stack: oversized display title, body copy, then
// the badge/CTA cluster as a full-width card below — offset off the left
// edge rather than dead-centered), HeroFromPageData (the same shape driven
// by a parsed page-data object), PageHeader (display and dense forms),
// Marquee (the signature ticker) and Manifesto (long-form prose block).

import * as webjsx from '../../../vendor/webjsx/index.js';
const h = webjsx.createElement;

export function Hero({ eyebrow, title, body, accent, actions, badges }) {
    // Eyebrow + title stack at the top of the single-column layout; badges +
    // actions render into a full-width card BELOW the body copy (.ds-hero-aside)
    // rather than a side column, so it still carries real visual weight instead
    // of sitting empty beside the body copy.
    const badgeList = Array.isArray(badges) ? badges.filter(Boolean) : [];
    const badgeRow = badgeList.length
        ? h('div', { class: 'ds-hero-stats' }, ...badgeList.map((b, i) =>
            h('span', { key: 'hb' + i, class: 'ds-hero-stat' }, String(b && b.label != null ? b.label : b))))
        : null;
    const actionRow = actions ? h('div', { class: 'ds-hero-actions' }, ...(Array.isArray(actions) ? actions : [actions])) : null;
    const aside = (badgeRow || actionRow) ? h('div', { class: 'ds-hero-aside' }, badgeRow, actionRow) : null;
    return h('div', { class: 'ds-hero' },
        h('div', { class: 'ds-hero-head' },
            eyebrow ? h('span', { class: 'eyebrow' }, eyebrow) : null,
            h('h1', { class: 'ds-hero-title' }, title)
        ),
        body ? h('p', { class: 'ds-hero-body' },
            body,
            accent ? h('span', { class: 'ds-hero-accent' }, ' ' + accent) : null
        ) : null,
        aside
    );
}

// HeroFromPageData — a single factory for the "hero block driven by a page-data
// object" shape that recurs, independently hand-rolled, across every flatspace
// consumer theme.mjs (heading/subheading/body/badges/ctas/install all read off
// a `hero` object parsed from the `__site__` JSON script tag). Consumers differ
// only in which fields their content YAML populates; this factory renders every
// field it is given and omits what is absent, so it is a drop-in for the
// narrowest (heading+body only) or richest (badges+ctas+install) hero shape
// alike. Returns null on a falsy `hero` so callers can write
// `HeroFromPageData(page.hero)` unconditionally, matching the existing
// `!home.hero ? null : ...` guard every hand-rolled version repeats.
//
// Shape: { heading, title, subheading, body, accent, badges, ctas, install }
//   heading/title  — hero <h1> text (heading wins if both given)
//   subheading     — a Lede-style standalone line above `body`
//   body           — the hero paragraph
//   accent         — a muted trailing aside appended to `body`
//   badges         — [{label, desc}] or [string], rendered as a stat strip
//   ctas           — [{label, href, primary}], rendered as Btn-equivalent links
//   install        — a single install command string, rendered as a `.cli` block
export function HeroFromPageData(hero) {
    if (!hero) return null;
    const heading = hero.heading || hero.title || '';
    const badges = Array.isArray(hero.badges) ? hero.badges.filter(Boolean) : [];
    const ctas = Array.isArray(hero.ctas) ? hero.ctas.filter(Boolean) : [];
    const badgeRow = badges.length
        ? h('div', { class: 'ds-hero-stats' }, ...badges.map((b, i) =>
            h('span', { key: 'hb' + i, class: 'ds-hero-stat' },
                h('strong', { class: 'ds-hero-stat-n' }, String(b && b.label != null ? b.label : b)),
                (b && b.desc) ? h('span', { class: 'ds-hero-stat-l' }, String(b.desc)) : null,
            )))
        : null;
    const ctaRow = ctas.length
        ? h('div', { class: 'ds-hero-actions' }, ...ctas.map((c, i) =>
            h('a', {
                key: 'hc' + i,
                class: (c.primary || i === 0) ? 'btn btn-accent' : 'btn btn-ghost',
                href: c.href || '#',
            }, c.label || c.cta || 'go')))
        : null;
    const installRow = hero.install
        ? h('div', { class: 'cli' },
            h('span', { class: 'prompt' }, '$'),
            h('span', { class: 'cmd' }, hero.install))
        : null;
    return h('div', { class: 'ds-hero' },
        h('div', { class: 'ds-hero-head' },
            hero.eyebrow ? h('span', { class: 'eyebrow' }, hero.eyebrow) : null,
            h('h1', { class: 'ds-hero-title' }, heading)
        ),
        hero.subheading ? h('p', { class: 'ds-hero-body lede' }, hero.subheading) : null,
        hero.body ? h('p', { class: 'ds-hero-body' },
            hero.body,
            hero.accent ? h('span', { class: 'ds-hero-accent' }, ' ' + hero.accent) : null,
        ) : null,
        (badgeRow || ctaRow || installRow)
            ? h('div', { class: 'ds-hero-aside' }, badgeRow, installRow, ctaRow)
            : null,
    );
}

export function Marquee({ items = [], sep = '/' }) {
    // No items -> no ticker: an empty marquee still paints its border-block
    // rules as an unexplained full-width stripe.
    if (!items.length) return null;
    // Two identical runs make the -50% translate loop seamless. Each text and
    // separator is a keyed span so webjsx applyDiff never sees a primitive
    // sibling beside a keyed VElement. Run 'a' is the real, assistive-tech-
    // visible content; run 'b' is a purely visual duplicate for the seamless
    // loop and must not be exposed to screen readers as doubled text, so it
    // is wrapped in its own aria-hidden container (standard seamless-marquee
    // technique).
    const run = (runKey) => items.flatMap((it, i) => [
        h('span', { class: 'ds-marquee-item', key: `${runKey}-i${i}` }, it),
        h('span', { class: 'ds-marquee-sep', key: `${runKey}-s${i}`, 'aria-hidden': 'true' }, sep),
    ]);
    return h('div', { class: 'ds-marquee', role: 'marquee' },
        h('div', { class: 'ds-marquee-track' },
            h('span', { class: 'ds-marquee-run ds-marquee-run-a' }, ...run('a')),
            h('span', { class: 'ds-marquee-run ds-marquee-run-b', 'aria-hidden': 'true' }, ...run('b')),
        )
    );
}

export function Manifesto({ paragraphs = [], maxWidth }) {
    return h('div', {
        class: 'ds-prose ds-manifesto',
        'data-max-width': maxWidth ? String(maxWidth) : null
    },
        ...paragraphs.map((p, i) => h('p', {
            key: i,
            class: 'ds-manifesto-para' + (p.dim ? ' dim' : '')
        }, p.text || p))
    );
}

export function PageHeader({ title, lede, eyebrow, right, compact, dense, id }) {
    // `compact` drops the large leading/trailing section margins so a PageHeader
    // used as a page's first element top-aligns cleanly without the consumer
    // having to !important-override the .ds-section margin. `id` lands on the
    // outermost section so the header can serve as a deep-link anchor.
    // `dense` is the content-first working-surface form: one row - a small
    // heading with the lede beside it, clamped to a single muted line - instead
    // of a display H1 over a paragraph. App surfaces (files, dashboards,
    // settings) should not spend 150px of fold on an intro.
    if (dense) {
        return h('section', { class: 'ds-section ds-section-compact ds-page-header-dense', ...(id ? { id } : {}) },
            h('div', { class: 'ds-page-header-dense-row' },
                ...[
                    title != null ? h('h1', { key: 'dh' }, title) : null,
                    lede != null ? h('span', { key: 'dl', class: 'ds-page-header-dense-lede', title: typeof lede === 'string' ? lede : null }, lede) : null,
                    right != null ? h('div', { key: 'dr', class: 'ds-page-header-right' }, ...(Array.isArray(right) ? right : [right])) : null,
                ].filter(Boolean)));
    }
    return h('section', { class: 'ds-section' + (compact ? ' ds-section-compact' : ''), ...(id ? { id } : {}) },
        eyebrow ? h('span', { class: 'eyebrow' }, eyebrow) : null,
        title != null ? h('h1', {}, title) : null,
        lede != null ? h('p', { class: 'lede' }, lede) : null,
        right != null ? h('div', { class: 'ds-page-header-right' }, ...(Array.isArray(right) ? right : [right])) : null
    );
}
