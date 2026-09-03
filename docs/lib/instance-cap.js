// Single source of truth for the instance-count ceiling shared across the
// Node-side build script (scripts/gen-static-sws.mjs) and the browser-side
// shell (docs/os-shell.js). Plain ES module so it works unmodified with both
// Node's `import` (via a relative path) and a browser `<script type=module>`
// import — no bundler, no dual-format shim needed.
//
// MAX_RESTORE_INSTANCES: hard ceiling on instances materialized from a
// persisted snapshot (see os-shell.js SNAPSHOT restore). Also the count of
// static docs/sw-i{1..N}/index.js stub directories gen-static-sws.mjs must
// generate — fewer static SWs than this cap silently falls back every
// instance past the static count to the dynamic sw-instance.js?inst= route,
// which needs a custom header GH Pages cannot serve.
export const MAX_RESTORE_INSTANCES = 50;
