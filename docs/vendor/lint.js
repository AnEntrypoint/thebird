// Public re-export of the two source-hygiene lint gates that external
// consumers (thebird-owned UI files, freddie's GUI plugins) most plausibly
// want to run in their OWN build/lint setups: the decorative-glyph guard and
// the webjsx null-children guard. `scripts/` is intentionally not part of
// the published package surface (see package.json `files`), so this
// `src/`-located re-export is the published entry point — the actual lint
// logic still lives in scripts/lint-glyphs.mjs and scripts/lint-null-children.mjs
// and is not duplicated here.
export { lintGlyphsOrThrow } from '../scripts/lint-glyphs.mjs';
export { lintNullChildrenOrThrow } from '../scripts/lint-null-children.mjs';
