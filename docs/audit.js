// In-browser audit log subsystem, modeled on the "clawless AuditLog" pattern
// and adapted to thebird's conventions: factory function (not a class),
// persists through the existing per-instance fs (docs/instance-fs.js) rather
// than inventing its own storage, and matches docs/sdk.js's dependency-free
// plain-JS style.

// Fixed enum-like list of event type constants. Kept as plain strings (not a
// frozen object of symbols) so entries serialize to JSON untouched.
export const AuditEvent = {
    PROCESS_SPAWN: 'process.spawn',
    PROCESS_EXIT: 'process.exit',
    FILE_READ: 'file.read',
    FILE_WRITE: 'file.write',
    IO_STDOUT: 'io.stdout',
    IO_STDIN: 'io.stdin',
    NET_REQUEST: 'net.request',
    NET_RESPONSE: 'net.response',
    POLICY_DENY: 'policy.deny',
    GIT_CLONE: 'git.clone',
    GIT_PUSH: 'git.push',
    STATUS_CHANGE: 'status.change',
    ENV_CONFIGURE: 'env.configure',
    SERVER_READY: 'server.ready',
};

const SOURCES = ['boot', 'system', 'policy', 'user', 'agent'];

// High-frequency, low-value-per-entry event types (terminal output/input
// spew) that get debounced before hitting IDB instead of writing through
// immediately like every other event type.
const THROTTLED_EVENTS = new Set([AuditEvent.IO_STDOUT, AuditEvent.IO_STDIN]);

const RING_CAP = 2000;
const THROTTLE_QUIET_MS = 500;
const THROTTLE_CHAR_CAP = 2000;

const AUDIT_PATH = '/var/log/audit.json';

function levelFor(event, source) {
    if (event === AuditEvent.POLICY_DENY) return 'warn';
    if (source === 'policy') return 'warn';
    return 'info';
}

export function createAuditLog(instance) {
    const fs = instance && instance.fs;
    if (!fs) throw new Error('createAuditLog: instance.fs required');

    let entries = [];
    let priorLogWasCorrupt = false;
    // Seed from any prior session's persisted log so the ring buffer isn't
    // empty after a refresh.
    try {
        const prior = fs.readJson(AUDIT_PATH, null);
        if (Array.isArray(prior)) entries = prior.slice(-RING_CAP);
        else if (prior !== null) priorLogWasCorrupt = true;
    } catch {
        priorLogWasCorrupt = true;
    }
    // Persist the seeded (already-trimmed-to-RING_CAP) copy immediately so
    // on-disk state matches in-memory state at a known point. Without this,
    // unpersistedCount (reset to 0 below) undercounts entries.length -- it
    // only reflects pushes made THIS session -- so push()'s trim guard could
    // splice out seeded rows that were never actually written by fs.writeJson
    // this session, violating the "never trim before persisted" invariant.
    if (entries.length) fs.writeJson(AUDIT_PATH, entries);

    // Debounce state for throttled (stdout/stdin) event types: entries queue
    // here and flush to fs after a quiet period, capped per flush window.
    let throttleTimer = null;
    let throttleCharCount = 0;
    // Count of entries pushed since the last persistNow() actually ran. Used
    // to force an immediate flush once unpersisted entries would be trimmed
    // out of the ring buffer by push(), so trimming and persistence stay in
    // sync (an entry is never spliced out before it has been written through).
    let unpersistedCount = 0;

    function persistNow() {
        fs.writeJson(AUDIT_PATH, entries);
        unpersistedCount = 0;
    }

    function scheduleThrottledFlush() {
        if (throttleTimer) return;
        throttleTimer = setTimeout(() => {
            throttleTimer = null;
            throttleCharCount = 0;
            persistNow();
        }, THROTTLE_QUIET_MS);
    }

    function push(entry) {
        entries.push(entry);
        unpersistedCount++;
        if (entries.length > RING_CAP) {
            // Never trim an entry that hasn't been persisted yet -- force a
            // synchronous flush first so nothing is lost from the log.
            if (unpersistedCount >= RING_CAP) {
                if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null; throttleCharCount = 0; }
                persistNow();
            }
            entries.splice(0, entries.length - RING_CAP);
        }
    }

    function log(event, source, data = {}) {
        if (!SOURCES.includes(source)) source = 'system';
        const entry = { ts: Date.now(), event, source, level: levelFor(event, source), data };
        push(entry);

        if (THROTTLED_EVENTS.has(event)) {
            // Approximate the entry's char cost via its data payload so a burst
            // of stdout doesn't hammer IDB: count toward the per-window cap and
            // only flush once quiet, or immediately if the cap is exceeded.
            const size = typeof data.text === 'string' ? data.text.length : JSON.stringify(data).length;
            throttleCharCount += size;
            if (throttleCharCount >= THROTTLE_CHAR_CAP) {
                if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null; }
                throttleCharCount = 0;
                persistNow();
            } else {
                scheduleThrottledFlush();
            }
        } else {
            // Low-frequency, high-value events write through immediately.
            if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null; throttleCharCount = 0; }
            persistNow();
        }
        return entry;
    }

    if (priorLogWasCorrupt) {
        log(AuditEvent.STATUS_CHANGE, 'system', { reason: 'prior audit log unreadable, history reset' });
    }

    function toText(opts = {}) {
        const bySource = new Map(SOURCES.map(s => [s, []]));
        const unknown = [];
        for (const e of entries) {
            if (opts.source && e.source !== opts.source) continue;
            const bucket = bySource.get(e.source);
            if (bucket) bucket.push(e);
            else unknown.push(e);
        }
        const lines = [];
        for (const source of SOURCES) {
            const rows = bySource.get(source);
            if (!rows || !rows.length) continue;
            lines.push('== ' + source + ' ==');
            for (const e of rows) {
                const when = new Date(e.ts).toISOString();
                const dataStr = e.data && Object.keys(e.data).length ? ' ' + JSON.stringify(e.data) : '';
                lines.push('[' + when + '] (' + e.level + ') ' + e.event + dataStr);
            }
        }
        if (unknown.length) {
            lines.push('== unknown ==');
            for (const e of unknown) {
                const when = new Date(e.ts).toISOString();
                const dataStr = e.data && Object.keys(e.data).length ? ' ' + JSON.stringify(e.data) : '';
                lines.push('[' + when + '] (' + e.level + ') [source:' + e.source + '] ' + e.event + dataStr);
            }
        }
        return lines.join('\n');
    }

    function toJSON() {
        return entries.slice();
    }

    function filter({ source, level, event } = {}) {
        return entries.filter(e =>
            (source == null || e.source === source) &&
            (level == null || e.level === level) &&
            (event == null || e.event === event)
        );
    }

    // Flush any pending throttled batch synchronously before the page goes
    // away -- without this, closing/reloading the tab during the 500ms quiet
    // window drops whatever stdout/stdin was queued since the last write.
    function flushPending() {
        if (throttleTimer) {
            clearTimeout(throttleTimer);
            throttleTimer = null;
            throttleCharCount = 0;
            persistNow();
        }
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('pagehide', flushPending);
        window.addEventListener('beforeunload', flushPending);
    }

    return { log, toText, toJSON, filter, AuditEvent, flushPending };
}

// --- Secret-hygiene helpers (plain functions, not methods on the log) ---

// Shows first 7 + last 4 chars of a key, masks the middle -- e.g.
// "sk-abc1...ab12". Short keys (too short to have a safe middle to mask)
// are fully masked to avoid leaking their whole value.
export function maskKey(key) {
    if (key == null) return key;
    const str = String(key);
    if (str.length <= 11) return '*'.repeat(str.length);
    return str.slice(0, 7) + '...' + str.slice(-4);
}

// Takes a headers object or Headers instance, returns a plain-object copy
// with values for sensitive-looking keys (authorization/api-key/token/secret)
// replaced by their masked form.
export function maskHeaders(headers) {
    const SENSITIVE = /authorization|api-key|token|secret/i;
    const out = {};
    const entries = typeof headers?.entries === 'function' ? headers.entries() : Object.entries(headers || {});
    for (const [k, v] of entries) {
        out[k] = SENSITIVE.test(k) ? maskKey(v) : v;
    }
    return out;
}

// Truncates a string/object body to maxLen chars, appending a
// "...(N more chars)" suffix when truncation happened.
export function truncateBody(body, maxLen = 500) {
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    if (str == null) return str;
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + '...(' + (str.length - maxLen) + ' more chars)';
}

// --- window.fetch interceptor (opt-in, per call site) ---
//
// NOT installed globally by default -- callers opt in by invoking this at a
// specific call site (see docs/shell-sw-jobs.js's makeCurlBuiltin for the
// real integration). Captures the native fetch BEFORE any reassignment and
// always calls through to it; never swallows or short-circuits a real
// request, only observes it and logs masked request/response pairs.
//
// Returns { fetch, uninstall } -- `fetch` is the audited replacement to use
// in place of window.fetch at the call site; `uninstall` restores nothing
// (there is nothing global to restore) and exists only for API symmetry with
// a hypothetical future global-install mode.
export function installFetchAudit(instance, auditLog) {
    const nativeFetch = (instance && instance.fetch ? instance.fetch : window.fetch).bind(instance || window);

    async function auditedFetch(input, init = {}) {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        const method = (init && init.method) || (input && input.method) || 'GET';
        const reqHeaders = maskHeaders((init && init.headers) || (input && input.headers) || {});
        const reqBody = init && init.body != null ? truncateBody(init.body) : undefined;

        auditLog?.log(auditLog.AuditEvent.NET_REQUEST, 'agent', {
            method, url, headers: reqHeaders, ...(reqBody !== undefined ? { body: reqBody } : {}),
        });

        const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        try {
            const res = await nativeFetch(input, init);
            const duration = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start);
            // Peek the body for the audit log without consuming the caller's
            // stream: clone() before any read.
            let bodyPreview;
            try {
                const clone = res.clone();
                const text = await clone.text();
                bodyPreview = truncateBody(text);
            } catch { /* opaque/streamed responses may not support clone/text */ }
            auditLog?.log(auditLog.AuditEvent.NET_RESPONSE, 'agent', {
                method, url, status: res.status, ok: res.ok, durationMs: duration,
                headers: maskHeaders(res.headers), ...(bodyPreview !== undefined ? { body: bodyPreview } : {}),
            });
            return res;
        } catch (e) {
            const duration = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start);
            auditLog?.log(auditLog.AuditEvent.NET_RESPONSE, 'agent', {
                method, url, error: e && e.message ? e.message : String(e), durationMs: duration,
            });
            throw e;
        }
    }

    return { fetch: auditedFetch, uninstall: () => {} };
}

// Marker prefix used to smuggle audit events in-band on a worker's stdout
// stream (e.g. a node-runtime shell command's output) alongside normal
// output. A line beginning with this prefix carries a JSON payload and MUST
// be stripped from anything rendered to the user, then parsed and routed
// into the audit log instead. See docs/shell.js's term.write wrapper for the
// consumer side of this contract.
export const NET_AUDIT_MARKER = '__NET_AUDIT__:';

// Parses a single output line for the marker prefix. Returns the parsed
// payload object if the line is a marker line, or null if it's normal
// output that should pass through untouched. Malformed JSON after the
// marker is treated as normal output (returns null) rather than throwing,
// so a stray/corrupted marker-shaped line never crashes the terminal.
export function parseNetAuditLine(line) {
    if (typeof line !== 'string' || !line.startsWith(NET_AUDIT_MARKER)) return null;
    try {
        return JSON.parse(line.slice(NET_AUDIT_MARKER.length));
    } catch {
        return null;
    }
}
