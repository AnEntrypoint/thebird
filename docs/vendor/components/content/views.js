// Composed page views — the two whole-page compositions assembled from the
// primitives in this group: HomeView (hero + shipping/works/writing/manifesto
// sections) and ProjectView (project prose + install + receipt + changelog).
// Both return a flat array of blocks for a host to render directly.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Heading, Lede, Dot } from '../shell.js';
import { Row } from './row.js';
import { Panel, Section, Receipt, Changelog } from './panel.js';
import { Hero, Manifesto } from './hero.js';
import { Install } from './cli.js';
import { WorksList, WritingList } from './lists.js';
const h = webjsx.createElement;

export function HomeView({ state = {}, onNav, onToggleWork, works = [], posts = [], manifesto = [], currentlyShipping } = {}) {
    return [
        // The page's one deliberate kicker. 'an entrypoint' is the collective's
        // name-as-tagline — it says something the <h1> does not, and it is the
        // masthead position where a print eyebrow actually belongs. The sections
        // below intentionally carry NO eyebrow: each has a heading that already
        // names it, so a kicker there would only restate the <h3> one word
        // shorter. Do not add eyebrows to the sibling sections to "match" this.
        Hero({
            eyebrow: 'an entrypoint',
            title: 'Small, weird, useful tools — built in public.',
            body: '247420 is a creative collective of eight, scattered across three timezones. We have been shipping open-source tools for the web since 2018.',
            accent: 'Some become the future. Most don\'t. That\'s the deal.'
        }),
        // Titleless section: promoted its former eyebrow to the actual heading
        // rather than leaving a kicker hovering over an unnamed panel. The label
        // was carrying the section's only name, so it became the <h3>.
        currentlyShipping ? Section({
            title: 'currently shipping',
            children: Panel({
                kind: 'wide',
                children: currentlyShipping.map((row, i) => {
                    const dotNode = Dot({ tone: row.live ? 'live' : 'idle' });
                    dotNode.props = { ...dotNode.props, 'aria-label': row.live ? 'live status' : 'idle status' };
                    return Row({
                        key: i,
                        code: dotNode,
                        title: row.title, sub: row.sub, meta: row.meta
                    });
                })
            })
        }) : null,
        works.length ? Section({
            title: 'Everything else.',
            children: WorksList({ works, openedIndex: state.opened ?? -1, onToggle: onToggleWork })
        }) : null,
        posts.length ? Section({
            title: 'When we have something to say.',
            children: WritingList({ posts })
        }) : null,
        manifesto.length ? Section({
            title: 'Eight people, three timezones, one ongoing conversation.',
            children: Manifesto({ paragraphs: manifesto })
        }) : null
    ].filter(Boolean);
}

export function ProjectView({ project = {}, copied, onCopy } = {}) {
    return [
        h('div', { class: 'ds-prose' },
            Heading({ level: 1, children: project.name }),
            Lede({ children: project.tagline })
        ),
        project.install ? [
            Heading({ level: 3, children: 'install' }),
            Install({ cmd: project.install, copied, onCopy }),
        ] : null,
        project.receipt ? [
            Heading({ level: 3, children: 'by the numbers' }),
            Receipt({ rows: project.receipt }),
        ] : null,
        project.changelog ? [
            Heading({ level: 3, children: 'recent releases' }),
            Changelog({ entries: project.changelog })
        ] : null
    ].filter(Boolean).flat();
}
