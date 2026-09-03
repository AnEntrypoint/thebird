# gm vendor

Vendored gm-skill plugkit wasm artifact.

**Source (read-only)**: `C:/Users/user/.claude/gm-tools/`

**Files**:
- `plugkit.wasm` — the plugkit wasm module.
- `plugkit.wasm.sha256` — integrity hash.
- `plugkit.version` — version stamp (mirrored to `.version`).
- `plugkit-wasm-wrapper.js` — **Node-only reference**. Uses `fs` / `child_process` / `net` / `https`; do not import in the browser.

**Refresh**:
```
cp ~/.claude/gm-tools/{plugkit.wasm,plugkit.wasm.sha256,plugkit.version,plugkit-wasm-wrapper.js} docs/vendor/gm/
cp ~/.claude/gm-tools/plugkit.version docs/vendor/gm/.version
```

Browser loader lives at `docs/gm-host.js` (separate from the Node wrapper).
