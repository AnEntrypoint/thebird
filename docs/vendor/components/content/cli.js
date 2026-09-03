// Command-line blocks — Install (the single-line copyable `.cli` prompt+cmd
// row) and CliBlock (the multi-line `.ds-cli-block` quickstart list). These
// are two different contracts that once collided on the same `.cli` class
// name with incompatible display models; keep them distinct.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Panel } from './panel.js';
import { Btn } from '../shell.js';
const h = webjsx.createElement;

export function Install({ cmd, copied, onCopy }) {
    return h('div', { class: 'cli' },
        h('span', { class: 'prompt' }, '$'),
        h('span', { class: 'cmd' }, cmd),
        Btn({
            class: 'copy', size: 'sm',
            onClick: () => onCopy && onCopy(cmd),
            'aria-label': copied ? 'copied to clipboard' : 'copy install command',
            children: h('span', { 'aria-live': 'polite' }, copied ? 'copied' : 'copy')
        })
    );
}

// CliBlock — the shared 'quickstart.lines[] -> stacked CLI block' renderer
// every portfolio consumer theme.mjs (zellous/wireweave/247420) had hand-rolled
// identically: lines.map((l,i) => a div per line holding a prompt span ('$' or
// '#' for a comment line) and a cmd span, all wrapped in a Panel. This factory
// targets the multi-line `.ds-cli-block` contract defined in gm-prose.css
// (`.ds-cli-block` holding `.ds-cli-row` rows — each a prompt+cmd pair — and
// `.ds-cli-comment` comment rows). `lines` is [{kind, text}] where kind: 'cmt' renders a
// comment-only row (no prompt glyph); any other kind (or omitted) renders a
// command row prefixed '$'. `heading` titles the wrapping Panel ('quick start'
// default, matching every hand-rolled instance); pass `heading: null` to
// render the bare `.ds-cli-block` block with no Panel chrome.
// Note: this is a different component than the bare `.cli` single prompt+cmd
// row primitive (app-shell.css; see Install() above and the per-line usage
// in terminal/site quickstart renderers) — the two used to collide on the
// same `.cli` class name with incompatible display models.
export function CliBlock({ lines = [], heading = 'quick start', className = '' } = {}) {
    if (!lines || !lines.length) return null;
    const rows = lines.map((l, i) => {
        const isComment = l && l.kind === 'cmt';
        const text = l && l.text != null ? l.text : '';
        return isComment
            ? h('div', { key: 'q' + i, class: 'ds-cli-comment' }, text)
            : h('div', { key: 'q' + i, class: 'ds-cli-row' },
                h('span', { class: 'prompt' }, '$'),
                h('span', { class: 'cmd' }, text));
    });
    const body = h('div', { class: 'ds-cli-block' + (className ? ' ' + className : '') }, ...rows);
    return heading == null ? body : Panel({ title: heading, children: body });
}
