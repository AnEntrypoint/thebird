// docs/lib/chat.js — merged chat pipeline module (events + transcript +
// broadcast). Previously three files (chat-events.js, chat-transcript.js,
// chat-broadcast.js); merged because each was small (27/189/138 lines) and
// tightly coupled -- chat-broadcast.js imported from both of the others,
// and all three exist purely to serve one pipeline (freddie-chat.js's
// message flow: emit a vocabulary event on the shared bus, persist it
// durably, and mirror it to other tabs/instances via BroadcastChannel).
// Splitting them across three files bought no independent reuse -- nothing
// outside this pipeline imports chat-transcript.js or chat-broadcast.js
// without also depending on chat-events.js.
//
// docs/lib/event-chain.js (level-editor trigger-chain data model) is NOT
// part of this merge despite the similar name to chat-events.js -- it is a
// generic graph/cycle-detection utility for the level editor with zero
// relationship to the chat pipeline; merging it in would conflate two
// unrelated domains under one file for a naming coincidence alone.

// ============================================================================
// events -- fixed vocabulary for thebird chat internal events. This section
// defines WHAT the events are called AND hosts the one shared bus
// (chatEventBus) so producers that live below freddie-chat.js in the import
// graph (e.g. docs/lib/acptoapi-browser.js, which freddie-chat.js imports --
// the reverse import would be circular) can emit on the same bus
// freddie-chat.js's UI subscribes to, without freddie-chat.js needing to
// hand a callback down. docs/sdk.js's createEventEmitter() is reused rather
// than reinventing pubsub.
// ============================================================================
import { createEventEmitter } from '../sdk.js';

export const ChatEvent = Object.freeze({
    STREAMING_START: 'streaming_start',
    STREAMING_PROGRESS: 'streaming_progress',
    STREAMING_COMPLETE: 'streaming_complete',
    STREAMING_ERROR: 'streaming_error',
    STREAMING_CANCELLED: 'streaming_cancelled',
    MESSAGE_CREATED: 'message_created',
    QUEUE_STATUS: 'queue_status',
    QUEUE_ITEM_DEQUEUED: 'queue_item_dequeued',
    RATE_LIMIT_HIT: 'rate_limit_hit',
    RATE_LIMIT_CLEAR: 'rate_limit_clear',
    CHAT_ACTIVE_CHANGED: 'chat_active_changed',
});

// Shared singleton bus. freddie-chat.js's exported `chatEvents` IS this
// instance (re-exported there, not a second emitter) so every existing
// `chatEvents.emit/on` call site keeps working unchanged.
export const chatEventBus = createEventEmitter();

// ============================================================================
// transcript -- durable, chunked chat transcript persistence layer.
//
// Backend choice: instance-fs.js (JSON-over-IDB), NOT sqlite-shim.js.
// Justification: instance.fs (docs/instance-fs.js) is already the storage
// substrate freddie-chat.js uses for chat state (chatStateKey/loadChatState/
// saveChatState) and for every other per-instance surface (config,
// attachments). It gives readJson/writeJson over a debounced-persist IDB
// snapshot with zero extra boot cost. sqlite-shim.js exists for apps that
// need real SQL (joins, WHERE clauses, the sqlite3InitModule()-shaped API)
// -- this store's access patterns are all keyed lookups + append + a single
// "seq > N" scan per session, which a handful of JSON arrays under
// conversation/session-scoped keys serve directly without SQL parsing
// overhead or an extra wasm surface. Every row-shape from the spec maps to
// a plain object; migrations are just shape-transforms over the same JSON
// documents.
//
// Storage layout (paths on instance.fs):
//   /chat-db/schema-version.json         -> { version: number }
//   /chat-db/conversations.json          -> { [id]: {id, createdAt, title} }
//   /chat-db/sessions.json               -> { [id]: {id, conversationId, status, startedAt} }
//   /chat-db/messages/<conversationId>.json -> [{id, conversationId, sessionId, role, text, createdAt}, ...]
//   /chat-db/chunks/<sessionId>.json     -> [{sessionId, conversationId, seq, blockType, block, createdAt}, ...]
//
// Per-conversation/per-session sharding (rather than one giant array) keeps
// each read/write small and avoids one hot key becoming a write-contention
// bottleneck as transcripts grow.
// ============================================================================

const SCHEMA_VERSION_PATH = '/chat-db/schema-version.json';

function convPath() { return '/chat-db/conversations.json'; }
function sessPath() { return '/chat-db/sessions.json'; }
function msgPath(conversationId) { return '/chat-db/messages/' + String(conversationId) + '.json'; }
function chunkPath(sessionId) { return '/chat-db/chunks/' + String(sessionId) + '.json'; }

function readJsonOr(fs, path, dflt) {
    if (typeof fs.readJson === 'function') {
        const v = fs.readJson(path, undefined);
        return v === undefined || v === null ? dflt : v;
    }
    // Fallback for a plain readFile/writeFile-shaped fs.
    try {
        const raw = fs.readFile(path);
        return raw == null ? dflt : JSON.parse(raw);
    } catch { return dflt; }
}
function writeJsonTo(fs, path, obj) {
    if (typeof fs.writeJson === 'function') { fs.writeJson(path, obj); return; }
    fs.writeFile(path, JSON.stringify(obj));
}

function mintId(prefix) {
    const b = new Uint8Array(8);
    (globalThis.crypto || {}).getRandomValues ? globalThis.crypto.getRandomValues(b) : b.forEach((_, i) => b[i] = Math.floor(Math.random() * 256));
    return prefix + '_' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

// --- migration-runner ------------------------------------------------------
// MIGRATIONS is an ordered array of {version, up(fs)}. The runner tracks the
// current applied version at SCHEMA_VERSION_PATH and applies only migrations
// with version > current, in ascending order, updating the stored version
// after each step so a crash mid-run resumes from the last completed step
// rather than re-running already-applied migrations.
const MIGRATIONS = [
    {
        version: 1,
        // Initial shape: create the four top-level stores as empty documents.
        // Per-conversation/per-session shards (messages/<id>.json,
        // chunks/<id>.json) are created lazily on first write -- there is
        // nothing to pre-create for a store with zero conversations yet.
        up(fs) {
            if (readJsonOr(fs, convPath(), null) === null) writeJsonTo(fs, convPath(), {});
            if (readJsonOr(fs, sessPath(), null) === null) writeJsonTo(fs, sessPath(), {});
        },
    },
];

function runMigrations(fs) {
    const state = readJsonOr(fs, SCHEMA_VERSION_PATH, { version: 0 });
    let current = Number(state.version) || 0;
    const pending = MIGRATIONS.filter(m => m.version > current).sort((a, b) => a.version - b.version);
    for (const m of pending) {
        m.up(fs);
        current = m.version;
        writeJsonTo(fs, SCHEMA_VERSION_PATH, { version: current });
    }
    return current;
}

export function createTranscriptStore(instance) {
    const fs = instance && instance.fs;
    if (!fs) throw new Error('createTranscriptStore: instance.fs required');

    const schemaVersion = runMigrations(fs);

    function flush() { if (fs.flush) try { fs.flush(); } catch {
        // swallow: fs.flush is best-effort IDB flush — data was already written to the in-memory fs shape
    } }

    // --- per-path write serialization ----------------------------------
    // Every mutator below is a read-modify-write over a shared JSON document
    // keyed by path (conversations.json, sessions.json, messages/<id>.json,
    // chunks/<id>.json). Two concurrent mutators targeting the SAME path
    // (e.g. two createMessage calls into the same conversation from
    // overlapping streaming/user-input await points, or two tabs' async
    // handlers both firing off the same instance) must never have their
    // read+mutate+write bodies interleave -- if they did, both would read
    // the same base document, both mutate their own in-memory copy, and the
    // second writeJsonTo would silently clobber the first writer's row.
    //
    // fn (the read+mutate+write body passed by each mutator below) is
    // itself always fully synchronous end-to-end -- readJsonOr/writeJsonTo
    // are synchronous instance.fs calls with no `await` in between, and
    // JS's single-threaded, run-to-completion execution model means a
    // synchronous function body can never be preempted mid-execution by
    // another callback (there is no point during `fn()` where the event
    // loop can hand control to a second caller). withPathLock therefore
    // does not need a Promise-chained mutex to prevent interleaving --
    // running `fn` inline already guarantees every read-modify-write pair
    // completes atomically before the next one (on ANY path, not just the
    // same one) can begin. This is enforced structurally, not by a lock:
    // if a future change makes the mutator body genuinely async (an
    // `await` inside `fn`), THAT is the point a real queue becomes
    // necessary again -- keep this a single choke point so that change is
    // a one-function edit, not a call-site hunt.
    function withPathLock(path, fn) {
        return fn();
    }

    // --- conversations ------------------------------------------------
    function createConversation(title) {
        return withPathLock(convPath(), () => {
            const conversations = readJsonOr(fs, convPath(), {});
            const id = mintId('conv');
            const row = { id, createdAt: Date.now(), title: title || null };
            conversations[id] = row;
            writeJsonTo(fs, convPath(), conversations);
            flush();
            return row;
        });
    }
    function getConversation(conversationId) {
        const conversations = readJsonOr(fs, convPath(), {});
        return conversations[conversationId] || null;
    }

    // --- sessions -------------------------------------------------------
    // SESSION_STATUSES is the fixed enum a session's status must belong to.
    // getActiveSessions() filters purely on `s.status === 'active'` -- a
    // typo'd or non-canonical status (e.g. 'Active') would silently mint a
    // session that never appears as active and is never picked up by
    // whatever polls getActiveSessions for reconnect/cleanup, with no error
    // anywhere. Validating at both creation and update closes that gap at
    // its single choke point instead of trusting every future call site.
    const SESSION_STATUSES = new Set(['active', 'ended', 'error']);
    function createSession(conversationId, status = 'active') {
        if (!getConversation(conversationId)) {
            throw new Error('createSession: unknown conversationId ' + JSON.stringify(conversationId));
        }
        if (!SESSION_STATUSES.has(status)) {
            throw new Error('createSession: invalid status ' + JSON.stringify(status) + ' -- must be one of ' + Array.from(SESSION_STATUSES).join(', '));
        }
        return withPathLock(sessPath(), () => {
            const sessions = readJsonOr(fs, sessPath(), {});
            const id = mintId('sess');
            const row = { id, conversationId, status, startedAt: Date.now() };
            sessions[id] = row;
            writeJsonTo(fs, sessPath(), sessions);
            flush();
            return row;
        });
    }
    function updateSessionStatus(sessionId, status) {
        if (!SESSION_STATUSES.has(status)) {
            throw new Error('updateSessionStatus: invalid status ' + JSON.stringify(status) + ' -- must be one of ' + Array.from(SESSION_STATUSES).join(', '));
        }
        return withPathLock(sessPath(), () => {
            const sessions = readJsonOr(fs, sessPath(), {});
            const row = sessions[sessionId];
            if (!row) return null;
            row.status = status;
            writeJsonTo(fs, sessPath(), sessions);
            flush();
            return row;
        });
    }
    function getSession(sessionId) {
        const sessions = readJsonOr(fs, sessPath(), {});
        return sessions[sessionId] || null;
    }
    function getActiveSessions() {
        const sessions = readJsonOr(fs, sessPath(), {});
        return Object.values(sessions).filter(s => s && s.status === 'active');
    }

    // --- messages ---------------------------------------------------------
    const VALID_ROLES = new Set(['user', 'assistant', 'system', 'tool']);
    function createMessage(conversationId, sessionId, role, text) {
        if (!VALID_ROLES.has(role)) {
            throw new Error('createMessage: invalid role ' + JSON.stringify(role) + ' -- must be one of user|assistant|system|tool');
        }
        if (typeof text !== 'string') {
            throw new Error('createMessage: invalid text -- must be a string, got ' + (text === null ? 'null' : typeof text));
        }
        const path = msgPath(conversationId);
        return withPathLock(path, () => {
            const messages = readJsonOr(fs, path, []);
            const row = { id: mintId('msg'), conversationId, sessionId, role, text, createdAt: Date.now() };
            messages.push(row);
            writeJsonTo(fs, path, messages);
            flush();
            return row;
        });
    }
    function getMessages(conversationId) {
        return readJsonOr(fs, msgPath(conversationId), []);
    }

    // --- chunks -------------------------------------------------------
    // seq is monotonically increasing PER SESSION, starting at 0. Tracked as
    // the length of the session's chunk array (append-only, never deleted),
    // so the next seq is always chunks.length -- no separate counter needed.
    // Serialized per session path so two concurrent createChunk calls on the
    // same session can never compute the same seq / clobber each other.
    function createChunk(sessionId, conversationId, blockType, block) {
        const path = chunkPath(sessionId);
        return withPathLock(path, () => {
            const chunks = readJsonOr(fs, path, []);
            const seq = chunks.length;
            const row = { sessionId, conversationId, seq, blockType, block, createdAt: Date.now() };
            chunks.push(row);
            writeJsonTo(fs, path, chunks);
            flush();
            return row;
        });
    }
    function getChunksSince(sessionId, seq) {
        // seq must be a legitimate non-negative integer (0 = "from the start",
        // a valid caller state) -- NOT a stand-in for undefined/NaN/garbage.
        // `Number(seq) || 0` used to coerce all of those to 0 silently,
        // which replays the ENTIRE chunk history for a caller that lost
        // track of its own lastSeq instead of surfacing the bug.
        if (!(Number.isInteger(seq) && seq >= 0)) {
            console.warn('[chat] getChunksSince: invalid seq', seq, 'for session', sessionId, '-- refusing to guess, returning no chunks');
            return [];
        }
        const chunks = readJsonOr(fs, chunkPath(sessionId), []);
        return chunks.filter(c => c.seq > seq);
    }

    return {
        schemaVersion,
        createConversation,
        getConversation,
        createSession,
        updateSessionStatus,
        getSession,
        getActiveSessions,
        createMessage,
        getMessages,
        createChunk,
        getChunksSince,
    };
}

// ============================================================================
// broadcast -- multi-tab/multi-instance chat sync via BroadcastChannel.
//
// Scoping: one BroadcastChannel PER INSTANCE ('thebird-chat-' + instanceId).
// thebird instances are already isolated (per-instance fs/IDB/SW scope --
// see the sw-per-instance-isolation memo), so scoping the channel name on
// instanceId keeps that isolation: two different instances never cross-talk
// even if both are open in tabs at once. Multiple TABS on the SAME instance
// share the same channel name and therefore DO sync.
//
// Topic routing: BroadcastChannel has no topic/subscription filtering --
// every message posted on a channel reaches every other listener on that
// channel. Per-conversation events (message_created, streaming_complete,
// streaming_error) are therefore ALL sent on the single shared channel, with
// `conversationId` embedded in the payload; a receiving tab filters by
// reading payload.conversationId itself in its handler, not by opening a
// separate channel per conversation (which would not scale and gains
// nothing -- BroadcastChannel dispatch is already cheap per-message).
//
// chatEventBus re-emission: re-emitting an incoming broadcast onto
// chatEventBus (defined above, in the same module now) lets a receiving
// tab's existing chatEvents.on(...) subscribers observe cross-tab events
// through the SAME bus they already listen to, with no new plumbing
// required on the listener side.
// ============================================================================

// Map broadcast event names (wire-level, used as BroadcastChannel payload.type)
// to their ChatEvent bus constant, for local re-emission of incoming messages.
const EVENT_TO_CHAT_EVENT = {
    conversation_created: null, // no ChatEvent counterpart yet; local listeners use raw 'on'
    message_created: ChatEvent.MESSAGE_CREATED,
    streaming_complete: ChatEvent.STREAMING_COMPLETE,
    streaming_error: ChatEvent.STREAMING_ERROR,
};

export function createChatBroadcast(instanceId, opts) {
    const id = String(instanceId == null ? '?' : instanceId);
    const channelName = 'thebird-chat-' + id;
    const handlers = new Map(); // eventName -> Set<fn>
    let bc = null;
    let closed = false;

    if (typeof BroadcastChannel !== 'undefined') {
        try { bc = new BroadcastChannel(channelName); }
        catch (e) { console.warn('[chat-broadcast] BroadcastChannel unavailable:', e && e.message); bc = null; }
    }

    function localHandlersFor(eventName) {
        let set = handlers.get(eventName);
        if (!set) { set = new Set(); handlers.set(eventName, set); }
        return set;
    }

    function on(eventName, handler) {
        if (typeof handler !== 'function') return;
        localHandlersFor(eventName).add(handler);
    }
    function off(eventName, handler) {
        const set = handlers.get(eventName);
        if (set) set.delete(handler);
    }

    function dispatchIncoming(eventName, payload) {
        // 1. Notify handlers registered directly on this broadcast instance.
        const set = handlers.get(eventName);
        if (set) for (const h of set) { try { h(payload); } catch (e) { console.warn('[chat-broadcast] handler error:', e && e.message); } }
        // 2. Re-emit onto the shared chatEventBus (if this event has a
        //    ChatEvent counterpart) so existing chatEvents.on(...) UI
        //    subscribers in THIS tab also observe the other tab's event,
        //    without needing to know broadcast exists.
        const ce = EVENT_TO_CHAT_EVENT[eventName];
        if (ce) { try { chatEventBus.emit(ce, { ...payload, _fromBroadcast: true }); } catch {
            // swallow: a chatEventBus subscriber threw — must not break delivery to this broadcast instance's own handlers above
        } }
    }

    if (bc) {
        bc.onmessage = (ev) => {
            const msg = ev && ev.data;
            if (!msg || typeof msg !== 'object' || !msg.type) return;
            dispatchIncoming(msg.type, msg.payload || {});
        };
    }

    // emit: sends a broadcast to OTHER tabs on this instance's channel. Not a
    // local echo -- the sending tab already has its own local chatEvents
    // emission from whichever call site (pushUser/pushFreddie/etc.) triggered
    // this. Receivers get {type, payload, ts} envelopes.
    function emit(eventName, payload) {
        if (!bc || closed) return;
        try { bc.postMessage({ type: eventName, payload: payload || {}, ts: Date.now() }); }
        catch (e) { console.warn('[chat-broadcast] postMessage failed:', e && e.message); }
    }

    function close() {
        if (closed) return;
        closed = true;
        handlers.clear();
        if (bc) { try { bc.close(); } catch {
            // swallow: channel may already be closed — close() is idempotent teardown
        } }
        bc = null;
    }

    // catchUp: late-joining-tab read path. NOT a broadcast -- all tabs on the
    // same instance already share the same per-instance fs/IndexedDB, so a
    // newly-opened tab (or one that was backgrounded and missed messages)
    // just re-reads the durable transcript store directly via
    // getChunksSince(sessionId, sinceSeq), which the monotonic-per-session
    // `seq` field exists to make efficient (only chunks with seq > sinceSeq
    // are returned, an append-only tail read). Accepts either an already-
    // constructed transcriptStore (opts.transcriptStore, reused from the
    // calling chat surface so a second store instance isn't created) or an
    // `instance` (opts.instance) to build one lazily.
    //
    // Freshness caveat (see AGENTS.md "getChunksSince catch-up read
    // ordering"): instance.fs's `snapshot` is an in-memory object populated
    // once at page load and mutated only by THIS tab's own writes -- there
    // is no cross-tab live-refresh of it. So a single getChunksSince read
    // cannot distinguish "no new chunks exist yet" from "this tab's fs view
    // predates another tab's write that has already landed in durable
    // storage (IDB/OPFS) but not in this tab's in-memory snapshot". A raw
    // empty result is therefore not trustworthy as "caught up" for a
    // cross-tab late-join. catchUp is async and retries a bounded number of
    // times with a short backoff before returning empty, giving a
    // same-tick-or-shortly-after write (this tab's own pending flush, or a
    // fresh read of a snapshot that a reload/refresh path may update) a
    // chance to surface; callers still cannot assume empty means "nothing
    // will ever be new", only "nothing new after this bounded wait" -- true
    // cross-tab push freshness requires a broadcast 'new chunk' signal
    // (chatEventBus emits message_created/streaming_complete already) to
    // trigger a fresh catchUp call, not relying on catchUp alone as a poll.
    let store = opts && opts.transcriptStore ? opts.transcriptStore : null;
    function ensureStore() {
        if (store) return store;
        if (opts && opts.instance) { try { store = createTranscriptStore(opts.instance); } catch (e) { console.warn('[chat-broadcast] catchUp store init failed:', e && e.message); } }
        return store;
    }
    function readSince(conversationId, sessionId, sinceSeq) {
        const s = ensureStore();
        if (!s || typeof s.getChunksSince !== 'function') return [];
        const chunks = s.getChunksSince(sessionId, sinceSeq);
        // conversationId is accepted for filtering/signature-parity with the
        // per-conversation broadcast events (and future multi-conversation
        // catch-up), even though getChunksSince is keyed purely on sessionId
        // today (one session belongs to exactly one conversation, so no
        // cross-conversation leak is possible without it).
        return Array.isArray(chunks) ? chunks.filter(c => !conversationId || c.conversationId === conversationId) : [];
    }
    async function catchUp(conversationId, sessionId, sinceSeq, retryOpts) {
        if (!ensureStore()) return [];
        const maxRetries = (retryOpts && Number.isFinite(retryOpts.retries)) ? retryOpts.retries : 3;
        const delayMs = (retryOpts && Number.isFinite(retryOpts.delayMs)) ? retryOpts.delayMs : 60;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const chunks = readSince(conversationId, sessionId, sinceSeq);
            if (chunks.length > 0) return chunks;
            if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        return [];
    }

    return { on, off, emit, close, catchUp, channelName };
}
