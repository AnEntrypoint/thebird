# Third-party notices

tte.js is a browser adaptation of text effects created by other open source
projects. The JavaScript renderer is original to tte.js, but the effect names,
concepts, and animation designs come from the projects credited below.

## TerminalTextEffects

[TerminalTextEffects](https://github.com/ChrisBuilds/terminaltexteffects) was
created by [ChrisBuilds](https://github.com/ChrisBuilds).

It is the original Python terminal effects engine and the source of the 37
effect designs adapted by tte.js.

TerminalTextEffects is distributed under the MIT License. Its original license
text is preserved in
[`LICENSES/terminaltexteffects-MIT.txt`](LICENSES/terminaltexteffects-MIT.txt).

## ttfx

[ttfx](https://github.com/omacom/ttfx) is a Rust port maintained by
[37signals](https://37signals.com) and
[omacom](https://github.com/omacom).

Its parity work provided another reference for the effect behavior.

ttfx is distributed under the MIT License. Its original license text is
preserved in [`LICENSES/ttfx-MIT.txt`](LICENSES/ttfx-MIT.txt), together with
its original [`NOTICE`](LICENSES/ttfx-NOTICE.txt).

## Omarchy browser demo

The project started after
[DHH shared the effects running on the Omarchy homepage](https://x.com/dhh/status/2093771424234099030).
[Christoffer Hallas](https://x.com/hicsfh) ported ttfx to WebAssembly for that
page.

tte.js does not include that WebAssembly build or code from the Omarchy
integration. It reimplements the effects for the browser using JavaScript and
Canvas.
