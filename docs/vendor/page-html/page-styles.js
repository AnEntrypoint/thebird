// The inline <style> block the SSR document ships ahead of the unpkg CSS
// bundle: page-stage rhythm, body-prose spacing, hero stat strip, and the
// feature-row stack. Kept inline (not in a .css file) because it must apply
// before the bundle loads — several rules carry !important purely to beat the
// bundle on load-order at equal specificity.

export const PAGE_INLINE_STYLES = `
.app-stage { width: 100%; max-width: var(--stage-wide, min(96%, 1600px)); margin-inline: auto; padding: var(--space-6, 48px) var(--space-4, 24px) var(--space-8, 96px); display: grid; gap: var(--space-6, 48px); box-sizing: border-box }
/* Container-coupled, not viewport-coupled: .app-stage is a descendant of the
   .app root, which declares container-type: inline-size (src/css/app-shell/base.css)
   with nothing resetting containment in between (.app-body/.app-main are plain
   blocks) — so @container here resolves against .app's real rendered width,
   correct for embedded shells that have no useful viewport of their own. This
   matches the hero and .app-body collapse rules, which were already @container. */
@container (max-width: 768px) { .app-stage { padding: var(--space-4, 24px) var(--space-3, 16px) var(--space-6, 48px); gap: var(--space-5, 32px) } }
/* Tier movements — the stage's uniform gap is deliberately overridden here.
   Panels inside one tier sit tight (--space-3, 16px) because they are peers;
   between tiers that reopens to --space-5 on top of the stage's own --space-6,
   so the three movements read as distinct instead of one repeating slab. */
.app-stage > .ds-tier { display: grid; gap: var(--space-3, 16px) }
.app-stage > .ds-tier + .ds-tier { margin-top: var(--space-5, 32px) }
.ds-tier-head { display: grid; gap: var(--space-2, 8px); margin-bottom: var(--space-1, 4px); justify-items: start }
/* The tier label is an h2 so the three movements are real landmarks in the
   accessibility tree; it keeps the .eyebrow voice, so the UA heading margin
   and size are reset back onto the mono kicker scale. */
.ds-tier-head > h2.eyebrow { margin: 0; font-size: var(--fs-tiny, 11px); line-height: 1.2 }
.ds-tier-lede { margin: 0; max-width: var(--measure, 68ch); color: var(--fg-3); font-size: var(--fs-sm, 15px) }
/* The lead tier carries the accent spine so the primary path is visible at a
   squint; supporting tiers stay unmarked rather than competing. The head div
   is the tier's first child, so the marker is an explicit class rather than a
   positional :first-of-type, which would not match past it. */
.ds-tier-lead { border-radius: 0 var(--r-2, 14px) var(--r-2, 14px) 0; padding-left: calc(var(--space-3, 16px) + var(--bw-chunk, 6px)); position: relative }
.ds-tier-lead::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: var(--bw-chunk, 6px); background: var(--accent); border-radius: var(--bw-chunk, 6px) 0 0 var(--bw-chunk, 6px) }
/* Tertiary tier reads at prose weight: quieter rows, no panel fill competition. */
.ds-tier-read .panel { background: var(--panel-1, var(--bg)) }
.ds-tier-read .row .meta { color: var(--fg-3) }
.page-body > :first-child { margin-top: 0 }
.page-body h1 { margin-top: 0 } .page-body h2 { margin-top: var(--space-5, 32px) } .page-body h3 { margin-top: var(--space-4, 24px) }
.page-body > * + * { margin-top: var(--space-3, 16px) }
.page-body pre { margin: var(--space-3, 16px) 0; background: var(--panel-2); padding: var(--space-3, 16px); border-radius: var(--r-1, 10px); overflow-x: auto }
/* .app-stage owns inter-block rhythm via grid gap; sections/hero must not double it.
   These selectors carry !important because this inline block loads before the
   unpkg CSS bundle, which would otherwise win on load-order for equal specificity. */
.ds-247420 .app-stage > .ds-hero { margin: 0 !important; padding: var(--space-4, 24px) 0 0 !important; max-width: none !important; gap: var(--space-4, 24px) !important }
.ds-247420 .app-stage > .ds-section { margin: 0 !important }
.app-stage .row + .row { margin-top: var(--space-1, 4px) }
.app-stage .ds-section .row { margin-top: var(--space-2, 8px) }
.app-stage .ds-section > p.ds-lede { margin: 0 0 var(--space-3, 16px); max-width: var(--measure, 68ch); color: var(--fg-2) }
.row-benefit { font-style: italic; color: var(--fg-3); font-size: var(--fs-sm); margin-top: var(--space-1, 4px) }
.ds-row-arrow { margin-left: auto; opacity: .5; transition: opacity var(--dur-snap, 80ms) var(--ease) }
a.row:hover .ds-row-arrow { opacity: 1 }
/* hero stat strip — all badges as a wrapping inline rhythm, not one empty panel */
.ds-hero-stats { display: flex; flex-wrap: wrap; gap: var(--space-3, 16px) var(--space-5, 32px); margin-top: var(--space-2, 8px) }
/* hero-content.css's .ds-hero-stat is styled for a vertical stacked list
   (border-bottom row divider, meant to read top-to-bottom); this page renders
   badges in a horizontal row instead (.ds-hero-stats above), where that same
   border reads as an underlined tab strip -- an affordance for a set of
   plain, non-interactive metadata chips. Reset both inherited properties so a
   row of badges never borrows tab-bar chrome it did not opt into. */
.ds-hero-stat { display: flex; align-items: baseline; gap: var(--space-2, 8px); border-bottom: none !important; padding-bottom: 0 !important }
.ds-hero-stat-n { font-family: var(--ff-body); font-weight: 700; font-size: var(--fs-lg, 18px); color: var(--fg) }
.ds-hero-stat-l { font-size: var(--fs-sm, 15px); color: var(--fg-3) }
/* accent sits on its own line, muted, so it reads as a distinct aside instead
   of running on from the hero body sentence. */
.ds-hero-accent { display: block; margin-top: var(--space-2, 8px); color: var(--fg-3) }
/* feature rows — single-column stack (the dashboard .row grid forces a 3-col
   code/title/meta layout that mangles title+desc+benefit) */
/* background uses a theme-neutral panel token (resolves per data-theme) so dark
   mode doesn't flash a literal white card before/independent of the bundle.
   Flat tonal fill only — no border-left rail accent (house style: no bespoke
   tile chrome, no shadows, no borders; see ui_kits/gallery/app.js). */
.ds-feature { padding: var(--space-3, 16px) var(--space-4, 24px); background: var(--panel-1, var(--bg)); border-radius: var(--r-2, 14px); display: grid; gap: var(--space-1, 4px) }
.ds-feature + .ds-feature { margin-top: var(--space-2, 8px) }
.ds-feature-title { font-weight: 600; font-size: var(--fs-lg, 18px); color: var(--fg) }
.ds-feature-desc { font-size: var(--fs-sm, 15px); color: var(--fg-2); line-height: 1.5; overflow-wrap: anywhere }
.ds-feature-benefit { font-style: italic; font-size: var(--fs-sm, 15px); color: var(--fg-3); margin-top: var(--space-1, 4px) }
/* Real closing content instead of the page simply stopping after its last
   panel — a tonal divider line, a copyright string, and the same external
   links the topbar already carries (footer.js reuses data.navItems, so this
   is never invented content). Sits inside .app-stage's own grid gap like
   every other block, no extra margin needed. */
.ds-page-footer {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: var(--space-3, 16px);
  padding-top: var(--space-5, 32px);
  margin-top: var(--space-3, 16px);
  border-top: 1px solid var(--rule, var(--bg-3));
  color: var(--fg-3); font-size: var(--fs-sm, 15px);
}
.ds-page-footer-links { display: flex; gap: var(--space-4, 24px) }
.ds-page-footer-links a { color: var(--fg-3) }
.ds-page-footer-links a:hover { color: var(--fg) }
/* Live component showcase: a grid of cards, each holding a real mounted
   specimen (not a screenshot) of the actual SDK components. */
.ds-showcase-grid {
  display: grid; gap: var(--space-3, 16px);
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.ds-showcase-card {
  padding: var(--space-3, 16px); background: var(--panel-1, var(--bg));
  border-radius: var(--r-2, 14px); display: grid; gap: var(--space-2, 8px);
}
.ds-showcase-card--wide { grid-column: 1 / -1; }
.ds-showcase-label {
  font-size: var(--fs-tiny, 13px); font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--fg-3, #6b6b6b);
}
.ds-showcase-row { display: flex; flex-wrap: wrap; gap: var(--space-2, 8px); align-items: center; }
/* Sets Danger apart from Primary/Default/Ghost in the button showcase row: an
   extra left margin beyond the row's own gap, plus a hairline divider, so a
   danger action never reads as just one more same-weight choice beside the
   primary action. */
.ds-showcase-btn-danger-group {
  display: inline-flex; align-items: center;
  margin-left: var(--space-3, 16px);
  padding-left: var(--space-3, 16px);
  border-left: 1px solid var(--rule, rgba(0,0,0,.12));
}
/* Card-grid layout (panel.layout === 'cards'): a browsable gallery of tiles
   instead of a dense text-row list, opt-in per panel via home.yaml's
   kits.layout: cards. */
.ds-kit-card-grid {
  display: grid; gap: var(--space-2, 8px);
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}
.ds-kit-card {
  display: grid; gap: var(--space-1, 4px); align-content: start;
  padding: var(--space-3, 16px); background: var(--panel-1, var(--bg));
  border-radius: var(--r-2, 14px); color: inherit; text-decoration: none;
  transition: transform var(--dur-base, .18s) var(--ease, ease), box-shadow var(--dur-base, .18s) var(--ease, ease);
  position: relative;
}
.ds-kit-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-1, 0 1px 2px rgba(0,0,0,.1)); }
.ds-kit-card:focus-visible { outline: var(--focus-w, 2px) solid var(--focus-color, currentColor); outline-offset: var(--focus-offset, 2px); }
.ds-kit-card-code {
  font-family: var(--ff-mono, monospace); font-size: var(--fs-micro, 12px);
  color: var(--fg-3, #6b6b6b);
}
.ds-kit-card-title { font-weight: 600; font-size: var(--fs-base, 16px); }
.ds-kit-card-sub { font-size: var(--fs-sm, 15px); color: var(--fg-2, #444); }
.ds-kit-card-arrow {
  position: absolute; top: var(--space-3, 16px); right: var(--space-3, 16px);
  color: var(--fg-3, #6b6b6b); font-size: var(--fs-sm, 15px);
}
`.trim();
