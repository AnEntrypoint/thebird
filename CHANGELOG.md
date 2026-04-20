
## [unreleased] 2026-04-21 node parity pass 12 — internal listen infrastructure
- feat: busnet — in-browser TCP-like listen/connect via BroadcastChannel cross-tab fabric
- feat: net.createServer now uses busnet — apps listen on ports other in-browser apps can connect to
- feat: busHttp — HTTP request/response framing over busnet
- feat: service discovery — busnet.discover() returns [{port,service,origin}] from peer tabs
- feat: netstat builtin — lists local listeners + peer services
- feat: window.__debug.node.busnet exposes full state
- feat: same-tab listen+connect works instantly without BroadcastChannel round-trip

## [unreleased] 2026-04-21 node parity pass 11 — virtualization + polyfills wave 3
- feat: virtual /proc filesystem — /proc/self/{cmdline,environ,stat,status,maps,limits}, /proc/{cpuinfo,meminfo,uptime,loadavg,version,stat,mounts,filesystems}
- feat: virtual /etc — hosts, resolv.conf, passwd, group, os-release, hostname, machine-id, shells
- feat: isomorphic-git wrapper — git.clone/commit/push/pull/status/log/checkout against real remotes via HTTP
- feat: tar/tar.gz extract + list — hand-rolled POSIX tar reader + fflate gunzip, works with real npm tarballs
- feat: DoH DNS polyfill — dns.resolve/resolve4/resolve6/resolveMx/resolveTxt/resolveNs/lookup/reverse via Cloudflare DoH with Google fallback
- feat: native addon dispatch — .node files route to WASM/JS equivalents (bufferutil, utf-8-validate, bcrypt, argon2, farmhash; sharp/better_sqlite3 placeholders)
- feat: process.dlopen for native modules
- feat: coreutils builtins — uname/whoami/hostname/id/df/free/uptime/ps/nproc/arch/yes/seq/tac/rev/nl/fold/od/xxd/dirname/basename/pwd/groups/logname/tty/stty/locale
- feat: npm registry shim — view/search/deps/tarballUrl/fetchTarball via esm.sh + registry.npmjs.org
- feat: os.cpus() returns real navigator.hardwareConcurrency, os.networkInterfaces returns lo
- feat: process.resourceUsage real numbers from performance.memory
- feat: crypto.secureHeapUsed
- feat: os.constants.signals/errno populated

## [unreleased] 2026-04-21 node parity pass 10 — test runner + util extras + IPC
- feat: node:test real runner — test/describe/it execute, report pass/fail/skip with colors and timing
- feat: node:test mock.fn / mock.method with calls recording
- feat: node:test/reporters TAP reporter (ok/not ok/plan)
- feat: util.styleText (named styles: red/green/bold/italic/etc)
- feat: util.stripVTControlCharacters removes ANSI escapes
- feat: util.getCallSites frame extractor
- feat: util.MIMEType + util.MIMEParams (RFC-compliant parse/serialize)
- feat: console.table/group/groupEnd/time/timeEnd/timeLog/count/countReset/dir/trace/assert/clear — full console surface
- feat: readline.createInterface — real interactive question/answer via xterm, asyncIterator, cursorTo/clearLine
- feat: fork IPC via BroadcastChannel — process.send/process.on('message')
- feat: node:sqlite module alias (DatabaseSync) — Node 22+ API

## [unreleased] 2026-04-21 node parity pass 9 — pnpm/yarn wired, workspaces, dlx
- feat: shell dispatches pnpm/yarn/bun/deno/corepack/dlx commands (previously shell-pm.js existed but wasn't wired)
- feat: workspaces resolution — package.json 'workspaces' field + pnpm-workspace.yaml packages:- syntax
- feat: Yarn Classic v1 lockfile writer + parser (real format, not JSON placeholder)
- feat: pnpm dlx / yarn dlx / bun x / npx — unified dlx runner via esm.sh
- feat: runtime observability — window.__debug.node.runtime.history tracks node→deno→bun switches
- feat: window.__debug.node.pm — pm command history (200 entries, cwd, ts, args)
- feat: Deno.stdin/stdout/stderr with ReadableStream/WritableStream surfaces
- feat: Bun.stdin/stdout/stderr .stream()/.text()/.writer() API
- feat: tab completion includes pnpm/yarn/bun/deno/npx/corepack
- feat: pnpm layout scaffold (.pnpm/<name>@<ver>/node_modules/<name> + symlinks) via shell-pm-layout.js

## [unreleased] 2026-04-20 node parity pass 8 — Deno/Bun/pnpm/yarn + POSIX
- feat: runtime detection (Deno, Bun, Node, browser) with capability flags
- feat: Deno global namespace — readTextFile/writeTextFile/mkdir/remove/stat/serve/Command/permissions/env
- feat: Bun global namespace — file/write/serve/spawn/shell(\`\`)/hash/password/TOML/nanoseconds/deepEquals
- feat: package manager dispatcher — auto-detects bun.lock/pnpm-lock.yaml/yarn.lock/package-lock.json + packageManager field
- feat: pm install/add/remove/run/ls/init/task unified across npm/pnpm/yarn/bun
- feat: deno task, deno.json/jsonc parsing, bunfig.toml parser, workspaces enumeration hooks
- feat: jsr: and npm: specifier rewriting to esm.sh
- feat: TypeScript direct execution — .ts/.tsx strip via regex (sucrase lazy-loaded)
- feat: shebang dispatch — #!/usr/bin/env deno|bun|node sets matching globals
- feat: corepack stub (no-op)
- feat: POSIX symlinks via sentinel entries — symlinkSync/readlinkSync/lstatSync/realpathSync with ELOOP at 40 hops
- feat: hard links + inode refcounting — linkSync, stat.nlink, stat.ino
- feat: file mode bits — chmodSync, S_IFREG/S_IFDIR/S_IFLNK/S_IFIFO constants
- feat: file descriptors — openSync/closeSync/readSync/writeSync/fstatSync/ftruncate
- feat: process.umask/cwd/chdir
- feat: mkdtempSync, cpSync(recursive), fs.mkfifoSync stub
- feat: Stats with isFile/isDirectory/isSymbolicLink/isFIFO, atime/mtime/ctime/birthtime Dates

## [unreleased] 2026-04-20 node parity pass 7 — Firefox maximization + polyfills
- feat: browser detection (vendor, version, 10+ capabilities) + window.__debug.node.polyfills registry
- feat: OPFS-backed fs.promises when available — real persistence (readFile/writeFile/mkdir/rm/stat/list) via SyncAccessHandle in worker, IDB fallback
- feat: brotli polyfill via brotli-wasm (compressSync/decompressSync + Transform streams)
- feat: Error.prepareStackTrace source-map integration via source-map-js — original filenames/lines when process.sourceMapsEnabled
- feat: net.Socket/tls.connect real polyfill via WebSocket-backed TCP tunnel (window.__plugkit_tcp_relay)
- feat: dgram.Socket polyfill via WebSocket-wrapped datagrams (window.__plugkit_udp_relay)
- feat: inspector.open() real CDP endpoint via postMessage channel (Runtime.evaluate/Debugger.enable/Profiler.*)
- feat: v8 CPU profiler backed by PerformanceObserver (CPUProfile.startProfiling/stopProfiling)
- feat: v8.writeHeapSnapshot — minimal valid V8 heap snapshot JSON format, Chrome DevTools importable
- feat: X509Certificate sync access via crypto.preloadX509()
- feat: vm cross-realm structuredClone boundary — Array/Object instanceof works across iframe
- feat: cluster module real impl via BroadcastChannel (fork/isMaster/worker.send/'message')
- feat: CompressionStream native gzip/deflate preferred over fflate when available
- feat: WebCodecs exposed as 'codecs' module (VideoEncoder/AudioEncoder/etc)
- feat: web-push module (pushManager.subscribe/getSubscription)
- feat: process.storage.estimate/persist/persisted + process.storageBuckets
- feat: FileSystemObserver integration for real fs.watch events on OPFS
- feat: Firefox Worker module-type compat shim
- feat: observability panel window.__debug.node.polyfills shows backing (native|wasm|fallback) per feature

## [unreleased] 2026-04-20 node parity pass 6 — 23 PRD items shipped
- feat: crypto ECDSA PEM sign/verify (P-256/P-384/P-521)
- feat: crypto.hkdf/hkdfAsync via webcrypto deriveBits
- feat: crypto.createECDH (prime256v1/secp384r1/secp521r1) shared-secret derivation
- feat: KeyObject (createPrivateKey/createPublicKey) + X509Certificate via @peculiar/x509
- feat: streaming zlib (createGzip/Gunzip/Deflate/Inflate) via fflate class API
- feat: vm module (runInThisContext/runInNewContext/runInContext via iframe)
- feat: module.register() ESM loader hooks (resolve/load pipeline)
- feat: http2.connect fetch-backed ClientHttp2Session
- feat: WASI real impl via @bjorn3/browser_wasi_shim
- feat: diagnostics_channel real pub/sub + tracingChannel
- feat: trace_events real recorder with event buffer
- feat: worker_threads.Worker backed by real Web Worker + Blob URL
- feat: child_process exec/spawn via WebContainer when available
- feat: fs.watch real events via IDB snapshot diff polling
- feat: REPL command handling (.clear/.exit/.help/.load/.save/.editor) + multi-line balance detection
- feat: Buffer pool (Buffer.poolSize=8192) for small allocUnsafe
- feat: process.binding('util') selective exposure, execArgv, features
- feat: process.memoryUsage from performance.memory
- feat: http.Agent / https.Agent real fetch pool with maxSockets
- feat: Error.prepareStackTrace V8-hook via Object.defineProperty on Error.prototype.stack
- feat: window.__debug.node registry for runtime observability
- feat: net/tls stubs with clearer error messages

## [unreleased] 2026-04-20 node parity pass 5
- feat: zlib sync (fflate via esm.sh /es2022 bundle) — gzipSync/gunzipSync/deflateSync/inflateSync
- feat: crypto.sign/verify + createSign/createVerify with PEM key import (RSA-SHA256 via webcrypto pkcs8/spki)
- feat: module resolution — full conditional exports (node/import/require/default/browser), subpath patterns (*), #internal imports map, type:module ESM detection
- feat: util.inspect — BigInt 'n' suffix, Symbol keys, colors:true ANSI, showHidden for non-enumerable
- feat: Error.captureStackTrace polyfill, process.execArgv from NODE_OPTIONS, --enable-source-maps flag, expanded allowedNodeEnvironmentFlags, process.features

## [unreleased] 2026-04-20 node parity pass 3
- feat: crypto sha1/sha512/md5 pure-JS + hmac (RFC 2104) + pbkdf2Sync + randomBytes via Web Crypto — all byte-for-byte match with real node
- feat: util.inspect circular refs use node format '<ref *N> { ... [Circular *N] }' exactly
- feat: package.json exports field resolution + node_modules walk-up parent dirs
- feat: require('module') with builtinModules, createRequire, _resolveFilename, Module, wrap, wrapper
- feat: require throws Error with .code='MODULE_NOT_FOUND' and requireStack
- feat: fs.promises mirrors sync API; fs.watch FSWatcher stub
- feat: net/dgram throw descriptive errors on use (not silent stubs)
- feat: worker_threads throws descriptive; execSync throws with explanation
- feat: process.stdin.setRawMode no-op (inquirer compatibility)
- feat: globalThis.process/Buffer set during eval (real node globals)
- feat: __filename/__dirname injected into ESM preamble
- feat: REPL eval loop — input → try-expr-then-stmt → util.inspect result; .exit/.help/.clear commands; prompt '> ' during REPL
- new: shell-node-crypto.js (sha1/256/512/md5/hmac/pbkdf2), shell-node-resolve.js (exports/walk-up/module/fs.promises/net/dgram/worker_threads stubs)

## [unreleased] 2026-04-20 node parity pass 2
- feat: util.inspect matches node format (braces-with-spaces, Map(N){k=>v}, arrays, circular, <Buffer ...>)
- feat: console.log/info/warn/error use util.format (printf-style %s/%d/%o)
- feat: crypto.createHash pure-JS sha256 — matches node hex output byte-for-byte
- feat: Buffer.write/compare/equals/indexOf/includes/subarray/readUIntXX/Buffer.compare/allocUnsafe
- feat: fs.rmSync/rmdirSync/accessSync/realpathSync
- feat: child_process.spawn/exec route through shell runPipeline, EventEmitter-style stdout/stderr/exit
- feat: http.request/http.get via fetch, return IncomingMessage-style with statusCode/headers/on(data,end)
- feat: process.execPath/argv0/title/memoryUsage/uptime/getuid/umask/release; env defaults PATH/HOME/USER/SHELL/TERM/LANG
- feat: ESM detection — code with import/export wrapped in Blob URL + dynamic import
- feat: unhandledrejection → lastExitCode=1 + node-style stack
- feat: stack trace trailer "Node.js v23.10.0" on error
- feat: .env loading at script start
- feat: node: prefixed specifiers (node:fs, node:path, etc.)
- feat: zlib.gzip/gunzip via pako (async, auto-loaded from esm.sh)
- new: shell-node-stdlib.js (util/crypto/zlib), shell-node-io.js (cp/http/proc env/ESM/stack/dotenv)

## [unreleased] 2026-04-20 node/npm CLI parity
- feat: node reports v23.10.0 + full process.versions map (27 fields, matches real CLI)
- feat: npm reports 10.9.2, npm_lifecycle_event/npm_package_name/npm_package_version env injection, pre/post<script> lifecycle hooks
- feat: process.exit(n) throws NodeExit, propagates to ctx.lastExitCode
- feat: script errors set lastExitCode=1 with stack trace display
- feat: node reads stdin via pipe (echo x | node script.js) through proc.stdin._feed
- feat: require.resolve + require.cache for module introspection
- feat: npx builtin (npx cowsay hi)
- feat: node -h/--help, node -p fixed (stdout.write not console.log)
- refactor: extracted runNode + runNpmResult into shell-exec.js (shell.js stays <200L)

## [unreleased] 2026-04-18 browser validation
- fix: require('express') returned instance not factory (MODULES wrapper called createExpress twice)
- fix: SW registration non-blocking — shell boots immediately, SW registers in background
- fix: splitTopLevel sep semantics — sep is preceding operator not following, fixes && || chain evaluation
- fix: lastExitCode-based lastOk — false builtin sets exit code 1 without throwing

## [unreleased] 2026-04-18
- feat: full CLI overhaul — shell-parser.js (tokenize/expand/parsePipes/splitTopLevel/parseRedirects), shell-builtins.js (POSIX builtins: ls -la, rm -r, cp -r, grep -inH, cd -, history), shell-npm.js (install/uninstall/ls/run/init with package.json read/write), shell.js refactored to use modules; IDB_KEY bumped to thebird_fs_v4; defaults.json updated with all new files
## [Unreleased]

### Added
- `docs/defaults.json`: bundled real project files (package.json, index.js, server.js, lib/*, lib/providers/*) so browser jsh has a working thebird source tree on boot — user can immediately run `npm install && node server.js` without needing to write files first
- `docs/shell.js`: `npm install` with no args reads cwd `package.json` dependencies + peerDependencies, installs all of them (multi-pkg via single command)
- `docs/shell-node.js`: `preloadAsyncPkgs` now walks the full require graph from entry file (BFS through relative requires) so transitive external package deps get loaded before sync require runs. Previously only scanned top-level code — server.js → ./index.js → @google/genai chain failed
- `docs/index.html`: callExpressRoute response object supports both Node http-style (writeHead/write/end/setHeader) and express-style (send/json/status). Request object now has `url`, `method`, async iterator for empty body — matches what `http.createServer` handlers expect

### Changed
- `docs/terminal.js`: IDB_KEY bumped `thebird_fs_v2` → `thebird_fs_v3` to force refresh of browser fs cache (users with stale idb will re-fetch defaults.json with the real project files)

### Added (prev)
- `docs/shell-node.js`: `http` and `https` core builtins — `http.createServer(handler)` registers wildcard route in `window.__debug.shell.httpHandlers[port]` (same mechanism as express.listen), so `node server.js` now works for servers that use raw `require('http')`
- `docs/shell-node.js`: `buffer`, `child_process`, `net`, `zlib`, `assert` builtin stubs so common Node scripts don't die on trivial requires
- `docs/shell-node.js`: `preloadAsyncPkgs(code)` scans source for `require('pkg')` calls, resolves each via dynamic `import(esm.sh/pkg)`, populates `pkgCache`. Synchronous `require()` then reads from cache — bridges Node CJS semantics to browser ESM loading
- `docs/shell-node-modules.js`: new file holding `createExpress`, `createHttp`, `createSqlite`, `createConsole`, `createProcess` factories (split out to keep shell-node.js under 200 lines)

### Changed
- `docs/shell.js`: `npm install` supports multiple packages per invocation; writes an `await import(...)` stub to `node_modules/<pkg>/index.js` as a marker, real resolution happens via `preloadAsyncPkgs` in nodeEval
- `docs/shell-node.js`: external (non-relative, non-builtin) require throws clear `Cannot find module: X (run: npm install X)` instead of generic error
- `docs/shell-node-modules.js` createExpress: routes now store `{ path, fn }` where `fn` runs full middleware chain via `runFns`, matching `index.html` callExpressRoute's `match.fn(req, res)` expectation (was previously `{ path, fns }` which broke route invocation)

### Fixed
- `docs/shell.js`: httpHandlers now returned on shell object instead of assigned to window.__debug.shell separately — terminal.js overwrote the debug object (which had httpHandlers) with the createShell() return value (which had none), making express routes invisible to index.html callExpressRoute(). Fix: remove internal window.__debug.shell assignment, include httpHandlers and all debug getters on the returned shell object so terminal.js assignment preserves the reference
- `test.js`: consolidate e2e-test.js coverage into test.js (express routing e2e + httpHandlers fix regression); delete e2e-test.js to enforce single-test-file policy

### Fixed
- `docs/app.js`: Normalize message content format to Anthropic array structure `[{ type: 'text', text: '...' }]` to prevent double-conversion in streamGemini/streamOpenAI (was sending string content)
- `docs/agent-chat.js`: Add lastError tracking in window.__debug.agent for error visibility and debugging
- `docs/shell.js`: Expose onPreviewWrite callback on returned shell object for preview refresh integration
- `docs/terminal.js`: Add shell reference to window.__debug for tool access; reduce preview refresh debounce 5s → 1s for quicker feedback
- `docs/preview-sw.js`: Add missing service worker for preview iframe routing (handle EXPRESS_REQUEST messages from main thread)
- `test.js`: Create integration test suite validating bootstrap, defaults.json, tools, errors, observability structures

### Changed
- `docs/defaults.json`: Split and optimized for Git constraints — reduced from 154.83 MB to 1.23 MB by including only 16 critical bootstrap files (app.js, agent-chat.js, terminal.js, shell.js, vendor/xterm-bundle.js, vendor/xstate.js, vendor/ui-libs.js, vendor/thebird-browser.js, etc.). Excludes large unused vendors (winterjs.wasm 46 MB, wasmer_js_bg.wasm 6.3 MB, rippleui.css 4.5 MB, sql-wasm.wasm 0.6 MB, acp-sdk.js 0.6 MB) not required for WebContainer bootstrap path.
- `docs/terminal.js`: Updated xterm.js theme with green foreground (#33ff33) to match Claude Code TUI aesthetic. Maintains AAA contrast ratio (14.61:1 on black background).

### Added
- `docs/node-builtins.js`: Full Node.js module polyfills — path, fs (IDB-backed), events (EventEmitter), url, querystring, Buffer class with encoding support
- `docs/shell-node.js`: Enhanced Node env — relative require, JSON require, per-file __dirname, process.stdout/stderr/nextTick/argv/hrtime, console.dir/table/time/assert/count, express with route params/middleware/static/json, os/util/crypto/stream modules
- `docs/shell.js`: Added node -e/-v flags, touch/head/tail/wc/grep/which commands, npm i alias

### Changed
- `docs/shell-node.js`: Rewritten to import from node-builtins.js; require() resolves relative paths, .json, directory/index.js
- `docs/shell.js`: Trimmed from 206L to 189L; ls shows directory entries properly

### Added
- `lib/errors.js`: Typed error hierarchy — BridgeError, AuthError, RateLimitError, TimeoutError, ContextWindowError, ContentPolicyError, ProviderError with classifyError factory. GeminiError kept as alias.
- `lib/errors.js`: `redactKeys()` — auto-redacts API keys (AIza, sk-, key- patterns) in error messages to `...XXXX`
- `lib/errors.js`: `parseRetryAfterHeader()` — parses standard HTTP Retry-After header (seconds and date formats) in addition to Gemini-specific retry info
- `lib/stream-guard.js`: `guardStream()` — wraps async iterables with per-chunk timeout (30s default) and repeated-chunk detection (100 threshold)
- `lib/circuit-breaker.js`: `createCircuitBreaker()` — per-provider failure tracking with auto-recovery after cooldown
- `lib/capabilities.js`: `getCapabilities()` / `stripUnsupported()` — provider capability metadata with automatic feature stripping and warnings
- `lib/router-stream.js`: Router logic extracted from index.js — circuit breaker and capability checks integrated
- `docs/tui.css`: TUI (text user interface) theme — monospace, green-on-black, box-drawing borders, scanline overlay, ASCII spinner

### Changed
- `docs/index.html`: Restyled to TUI aesthetic — ASCII art header, bracket-style tabs, removed Tailwind/RippleUI dependencies
- `docs/app.js`: Chat UI uses TUI-styled classes — monospace messages with `> ` / `< ` prefixes, bracket buttons

### Changed
- `index.js`: Trimmed from 177 to 104 lines by extracting router logic to lib/router-stream.js
- `index.d.ts`: Added types for BridgeError hierarchy, StreamGuardOptions, CapabilitySet, CircuitBreakerOptions
- `lib/providers/openai.js`: Passes response headers to error objects for Retry-After parsing; integrates guardStream

### Added
- `docs/app.js`: Cerebras as OpenAI-compatible provider option (https://api.cerebras.ai/v1)
- `docs/shell.js`: `createShell({ term, onPreviewWrite })` — POSIX shell + Node REPL using browser V8 eval + xstate v5 state machine. Dispatch table of built-ins: ls, cat, echo, pwd, cd, mkdir, rm, cp, mv, env, export, clear, help, node, npm install, exit. Pipe support via ` | ` split. `window.__debug.shell` exposes state, cwd, env, history, httpHandlers, nodeMode. `http.createServer` polyfill registers handlers in httpHandlers map.
- `docs/shell-node.js`: `createNodeEnv({ ctx, term })` — persistent V8 eval scope with process, console, require (IDB node_modules), Buffer shim, http.createServer polyfill, fetch, timers.
- `docs/vendor/xstate.js`: replaced broken stub with self-contained 46KB jsdelivr bundle (xstate@5.30.0) exporting createMachine, createActor — no external imports.
- `docs/terminal.js`: rewritten — removes all Wasmer/WinterJS; boots xterm, loads IDB, registers preview SW, creates shell via shell.js with 5s debounced hot-reload on idbWrite. window.__debug.term and window.__debug.shell live.

### Fixed
- Gemini tool result wrapping: string results wrapped as `{ output: result }` to satisfy Gemini Struct requirement for `function_response.response`
- Browser bundle rebuilt with fix

## [Unreleased - agent-tools]

### Added
- `docs/agent-chat.js`: 3 new tools — `list_files` (IDB snapshot keys), `read_terminal` (xterm buffer snapshot, last N lines), `send_to_terminal` (write to jsh stdin via shellWriter); `read_file` falls back to IDB snapshot when container not ready; `write_file` writes to both container and IDB snapshot; `window.__debug.agent.lastTool` tracks last dispatched tool
- `docs/terminal.js`: exposes `window.__debug.shellWriter` (jsh stdin writer), `window.__debug.idbSnapshot` (live file map), `window.__debug.idbPersist` (persist snapshot to IndexedDB)

## [Unreleased - browser-sdk]

### Added
- `docs/vendor/thebird-browser.js`: thebird `streamGemini`/`generateGemini` bundled for browser via esbuild (712KB, includes @google/genai browser build)
- `docs/agent-chat.js`: rewritten to use thebird `streamGemini` directly; TOOLS map with `read_file`, `write_file`, `run_command` dispatch to `window.__debug.container` (WebContainer); `window.__debug.agent` live state; removes raw Gemini REST API dependency
- `docs/app.js`: removed `convertMessages` (now handled internally by thebird); passes raw Anthropic-format messages to `agentGenerate`

# Changelog

## [Unreleased]

### Added
- `docs/agent-chat.js`: Gemini function-calling agentic loop; tools `read_file`, `write_file`, `run_command` dispatch to `window.__debug.container` (WebContainer FS + spawn)
- `docs/app.js`: imports `agentGenerate` from `agent-chat.js`; chat `send()` now runs agentic tool loop; `window.__debug` constructor uses `Object.assign` merge to not overwrite terminal.js keys; `streamGenerate` removed; `convertMessages` simplified

### Added (prev)
- `docs/index.html`: GEMINI_API_KEY input + Run Agent button in Terminal tab toolbar for in-browser agent validation
- `docs/terminal.js`: `window.__debug.runAgent(key, task)` spawns `node agent.js` with env, pipes output to terminal, tracks `{ running, output, exitCode }` in `window.__debug.validation`

### Fixed
- `docs/terminal.js`: build nested WebContainer mount tree from flat path keys (fixes `EIO: invalid file name` for files in subdirectories like `lib/providers/openai.js`); bump IDB_KEY to `thebird_fs_v2` to force re-fetch of defaults.json for users with stale cache

### Added
- `docs/defaults.json`: JSON blob of all thebird lib files + `server.js` + `agent.js` fetched by terminal.js on first boot
- `docs/terminal.js`: fetches `defaults.json` instead of hardcoded DEFAULT_FILES; jsh PTY shell with resize; `server-ready` wires iframe src + `window.__debug.previewUrl`; all debug keys registered
- `docs/index.html`: COEP fix via `window.coi = { coepDegrade: () => false }` (prevents Tailwind CDN block); Preview iframe `allow` attribute removed (invalid Feature Policy); `window.__debug` observability for container, term, shell, srv, previewUrl
- `agent.js` (in container): agentic loop using `@anthropic-ai/sdk` pointing at `http://localhost:3000` (thebird proxy), tools: `read_file`, `write_file`, `run_command`

### Added (prev)
- `wasi/cli.ts`: Deno CLI — Anthropic-format prompt → Gemini streaming via REST, flags: `--model`, `--system`
- `deno.json`: tasks `cli` (run) and `cli:compile` (single binary)

## [Unreleased - 2]

### Added
- `server.js`: HTTP proxy on port 3456, serves Anthropic Messages API wire format (streaming SSE + non-streaming JSON), backed by thebird → Gemini. Observability at `GET /debug/server`.
- `examples/sdk-validate.js`: Anthropic SDK (`@anthropic-ai/sdk`) client pointing at local proxy, validates both streaming and non-streaming paths.
- `@anthropic-ai/sdk` added to dependencies.

## [Unreleased - 3]

### Added
- `docs/terminal.js`: WebContainer-powered in-browser terminal with xterm.js, IndexedDB FS persistence, npm install on boot, @anthropic-ai/sdk pre-installed. `window.__debug.container` and `window.__debug.term` live.
- `docs/index.html`: tabs (Chat / Terminal), coi-serviceworker shim for SharedArrayBuffer on GitHub Pages, xterm CSS.

## [Unreleased - 4]

### Added
- `docs/index.html`: Preview tab with iframe (`#preview-frame`), `switchTab` extended to dispatch over `['chat','term','preview']`.
- `docs/terminal.js`: DEFAULT_FILES now includes `server.js` (HTTP server on port 3000, JSON status endpoint) and updated `index.js` (loads @anthropic-ai/sdk, hits server). Server auto-starts after `npm install`. `container.on('server-ready')` wires iframe src + `window.__debug.previewUrl`. Shell upgraded from `sh` loop to `jsh` with PTY resize. `window.__debug.srv` and `window.__debug.shell` live.


## shell predictability fixes (2026-04-18)
- Pipe stdin passthrough: grep/sed detect piped content as first arg (stdinFirst pattern)
- Tokenizer: preserves \\n inside double-quotes so echo -e works correctly
- $? expansion, $() command substitution, inline var assignment (X=val cmd)
- echo -e with \\n \\t escape sequences
- New builtins: sed, sort, uniq, tr
- shell-builtins.js split into shell-builtins-text.js (both under 200L)