// docs/lib/event-chain-runtime.js — the EXECUTOR half of the event-chain
// model. docs/lib/event-chain.js builds the graph DATA STRUCTURE + its
// algorithms (cycle detection, topological execution order); this module
// RUNS such a graph against a live play-state, one evaluation pass per
// fixed game-loop step.
//
// What consumes this today: level-editor-app.js's runScenePlaytest() wires
// a scene's optional `chains` array (one event-chain graph per entry) into
// its ECS-driven playtest loop via a chainSystem. The AUTHORING UI for
// those chains lives in level-editor-app.js's collapsible chains panel
// (renderChains()), which writes the graphs into scene.chains;
// hand-authored scene JSON still loads unchanged.
//
// ---- concrete config shapes ------------------------------------------------
// event-chain.js deliberately leaves the kind-specific config fields open
// ("...kind-specific"); this executor fixes ONE concrete shape per kind —
// the smallest serializable form that still expresses the authored intent.
// Anything outside these shapes is inert (never fires / no-op), mirroring
// normalizeEventChain's never-throw recovery philosophy.
//
//   trigger onCollision  — { kind:'onCollision', objectId, otherId? }
//       Fires when object `objectId` starts overlapping another object.
//       `otherId` pins the check to one specific other object; when absent,
//       ANY other object counts. Overlap is AABB intersection on the live
//       {x,y,w,h} of both objects.
//   trigger onKeyPress   — { kind:'onKeyPress', key }
//       `key` is a KeyboardEvent.key string ('ArrowLeft', ' ', 'a', ...).
//   trigger onTimer      — { kind:'onTimer', intervalMs, repeat? }
//       Fires every intervalMs of accumulated game-loop dt. repeat defaults
//       to true; repeat:false fires exactly once per playtest/reset.
//       intervalMs must be finite and > 0 or the trigger is inert, and
//       firing is clamped to at most ONE fire per frame however large dt is
//       (a 1ms interval under a 16.7ms step fires once per frame, it does
//       NOT burst 16 times — this is what keeps an absurd interval from
//       wedging the loop).
//   condition compare    — { kind:'compare', left, op, right }
//       `left`/`right` operands are EITHER { value: <literal> } OR
//       { objectId, prop } (reads that live object's CURRENT property;
//       unresolvable -> undefined). `op` is one of == != < > <= >= ;
//       equality is STRICT (=== / !==) — authored JSON has no use for JS's
//       loose-equality coercion surprises. Unknown op -> false.
//   action setProperty   — { kind:'setProperty', objectId, prop, value }
//       Writes `prop` on the live object. Numeric x/y writes are clamped to
//       the canvas bounds (same clamp the arrow-key movement applies), so a
//       chain cannot shove an object off-canvas.
//   action destroyObject — { kind:'destroyObject', objectId }
//       Removes the object from the PLAY state only (the editor's scene is
//       never touched — runScenePlaytest operates on a deep clone/ECS copy).
//   action playSound     — { kind:'playSound', frequency?, durationMs? }
//       Tiny WebAudio oscillator beep (default 440Hz / 120ms, capped at
//       2000ms). No audio assets, no dependencies. Where WebAudio is
//       unavailable (worker scope) or autoplay-blocked it degrades to a
//       silent no-op.
//
// ---- execution semantics ---------------------------------------------------
// * Triggers are EDGE-TRIGGERED: onCollision fires on the not-overlapping ->
//   overlapping TRANSITION (the pair must separate before it can fire
//   again); onKeyPress fires on the key-up -> key-down transition. A
//   level-triggered collision would re-run its actions every single frame
//   the objects touch — destroyObject/setProperty firing dozens of times
//   per second off one authored "when X hits Y" is never what an author
//   means by "on collision". onTimer is inherently periodic, neither edge
//   nor level.
// * Per frame, nodes are visited in event-chain.js's topologicalOrder.
//   Triggers evaluate themselves; a non-trigger node runs iff some incoming
//   edge comes from a node that fired/ran this frame AND (the edge is
//   unconditional OR the edge's `condition` matches the source condition
//   node's result this frame). A `condition`-tagged edge whose source is
//   not a fired condition node never activates its target. Each node runs
//   at most once per frame (graphs are DAGs — a cyclic chain is refused by
//   topologicalOrder and its runner goes inert), so a frame is O(V+E) with
//   no runaway path.
// * A throwing node is caught and routed to ctx.onError (the same sink
//   runScenePlaytest's own update/render use) — one bad node never kills
//   the frame or the loop.
//
// ctx contract (supplied by the play-state owner, e.g. runScenePlaytest):
//   {
//     getObjects(),                   // -> live object views {id, kind, x, y, w, h, color, ...}
//     setObjectProp(objectId, prop, value),
//     removeObject(objectId),         // play-state only
//     isKeyDown(key),                 // input-poller level state
//     width, height,                  // canvas dims (numbers or getters), for x/y clamping
//     onError(err),                   // per-node error sink
//   }

import { normalizeEventChain, topologicalOrder } from './event-chain.js';

function aabbOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Lazily-created shared AudioContext for playSound beeps. Module-level so
// repeated beeps across chains/playtests reuse one context instead of
// leaking one per firing.
let sharedAudioCtx = null;
// Reference count of live playtest/chain-runner sessions currently relying
// on sharedAudioCtx. acquireSharedAudioContext()/closeSharedAudioContext()
// increment/decrement it so the context is only actually closed once the
// LAST holder releases it -- otherwise any one playtest's stop() would tear
// down the AudioContext still owned by other concurrently-running playtests
// sharing this module-level singleton (e.g. two game-player windows).
let sharedAudioCtxRefCount = 0;
// Call once per playtest/chain-runner session that may use beep(), when
// that session starts, to register interest in keeping sharedAudioCtx
// alive. Must be paired with exactly one closeSharedAudioContext() call
// when that session ends.
export function acquireSharedAudioContext() {
    sharedAudioCtxRefCount++;
}
function beep(config) {
    try {
        const AC = (typeof AudioContext !== 'undefined') ? AudioContext
            : (typeof webkitAudioContext !== 'undefined') ? webkitAudioContext : null;
        if (!AC) return; // no WebAudio in this scope (e.g. a worker): playSound is a silent no-op
        if (!sharedAudioCtx) sharedAudioCtx = new AC();
        if (sharedAudioCtx.state === 'suspended') {
            // Autoplay policy can hold the context suspended until a user
            // gesture; resume is best-effort — if it stays suspended the
            // beep is simply silent this frame.
            sharedAudioCtx.resume().catch(() => { /* swallow: resume rejected (no gesture yet); beep stays silent */ });
        }
        const frequency = Number.isFinite(config.frequency) ? config.frequency : 440;
        const durationMs = (Number.isFinite(config.durationMs) && config.durationMs > 0)
            ? Math.min(config.durationMs, 2000) : 120;
        const osc = sharedAudioCtx.createOscillator();
        const gain = sharedAudioCtx.createGain();
        gain.gain.value = 0.05;
        osc.frequency.value = frequency;
        osc.connect(gain);
        gain.connect(sharedAudioCtx.destination);
        osc.start();
        osc.stop(sharedAudioCtx.currentTime + durationMs / 1000);
    } catch { /* swallow: audio is best-effort; a failing AudioContext must not break chain execution */ }
}

export function createChainRunner(chain, ctx) {
    const graph = normalizeEventChain(chain);
    const order = topologicalOrder(graph); // null on a cyclic graph
    // Cyclic or empty chain: the runner is inert (never throws, never
    // fires). This is normalizeEventChain's recover-don't-throw philosophy
    // extended to execution — a bad chain cannot break the playtest.
    const active = Array.isArray(order) && order.length > 0;
    const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
    const onError = (ctx && typeof ctx.onError === 'function') ? ctx.onError : () => {};

    const incoming = new Map(); // nodeId -> edges arriving at it
    for (const e of graph.edges) {
        if (!incoming.has(e.to)) incoming.set(e.to, []);
        incoming.get(e.to).push(e);
    }

    // Per-trigger live state, keyed by node id. Rebuilt on reset() so a
    // playtest reset restarts every edge detector and timer from scratch.
    let triggerState = new Map();
    function initTriggerState() {
        triggerState = new Map();
        for (const n of graph.nodes) {
            if (n.type !== 'trigger') continue;
            const kind = n.config && n.config.kind;
            if (kind === 'onCollision') triggerState.set(n.id, { overlapping: false });
            else if (kind === 'onKeyPress') triggerState.set(n.id, { wasDown: false });
            else if (kind === 'onTimer') triggerState.set(n.id, { acc: 0, firedOnce: false });
        }
    }

    function evalTrigger(node, dt) {
        const config = node.config || {};
        const st = triggerState.get(node.id);
        switch (config.kind) {
            case 'onCollision': {
                const objects = ctx.getObjects();
                const self = objects.find(o => o.id === config.objectId);
                // Configured object gone (e.g. destroyed this playtest):
                // reset the edge so state stays honest, never fire.
                if (!self) { st.overlapping = false; return false; }
                const pinned = typeof config.otherId === 'string' ? config.otherId : null;
                let hit = false;
                for (const o of objects) {
                    if (o.id === self.id) continue;
                    if (pinned !== null && o.id !== pinned) continue;
                    if (aabbOverlap(self, o)) { hit = true; break; }
                }
                const firedNow = hit && !st.overlapping; // edge-trigger: transition only
                st.overlapping = hit;
                return firedNow;
            }
            case 'onKeyPress': {
                const down = (typeof config.key === 'string' && config.key.length > 0)
                    ? !!ctx.isKeyDown(config.key) : false;
                const firedNow = down && !st.wasDown; // edge-trigger: key-up -> key-down transition only
                st.wasDown = down;
                return firedNow;
            }
            case 'onTimer': {
                const intervalMs = Number(config.intervalMs);
                // Invalid/absurd interval (<= 0, NaN, Infinity): inert —
                // must never wedge the loop.
                if (!Number.isFinite(intervalMs) || intervalMs <= 0) return false;
                if (config.repeat === false && st.firedOnce) return false;
                st.acc += Number.isFinite(dt) ? dt : 0;
                if (st.acc < intervalMs) return false;
                // Clamp: at most ONE firing per frame regardless of how far
                // past the interval the accumulator has run (a huge dt does
                // not burst multiple firings); the leftover keeps cadence.
                // Cap leftover backlog to one interval's worth: a huge dt
                // (backgrounded tab, GC pause) must not leave minutes of
                // accumulated debt that re-fires this timer on every
                // subsequent frame until it drains.
                st.acc = Math.min(st.acc - intervalMs, intervalMs);
                st.firedOnce = true;
                return true;
            }
            default:
                return false; // unknown trigger kind: inert
        }
    }

    function resolveOperand(operand, objects) {
        if (!operand || typeof operand !== 'object') return undefined;
        if (Object.prototype.hasOwnProperty.call(operand, 'value')) return operand.value; // literal
        if (typeof operand.objectId === 'string' && typeof operand.prop === 'string') {
            const obj = objects.find(o => o.id === operand.objectId);
            return obj ? obj[operand.prop] : undefined;
        }
        return undefined; // malformed operand: unresolvable
    }

    function evalCondition(node) {
        const config = node.config || {};
        if (config.kind !== 'compare') return false; // unknown condition kind: always the false branch
        const objects = ctx.getObjects();
        const left = resolveOperand(config.left, objects);
        const right = resolveOperand(config.right, objects);
        switch (config.op) {
            case '==': return left === right; // strict by design (see header)
            case '!=': return left !== right;
            case '<': return left < right;
            case '>': return left > right;
            case '<=': return left <= right;
            case '>=': return left >= right;
            default: return false; // unknown op: false branch
        }
    }

    function runAction(node) {
        const config = node.config || {};
        switch (config.kind) {
            case 'setProperty': {
                if (typeof config.objectId !== 'string' || typeof config.prop !== 'string') return;
                // Fail closed on prototype-mutating keys: a scene is
                // author-controlled JSON, and `obj['__proto__'|'prototype'|
                // 'constructor'] = value` is the classic pollution vector —
                // the action silently refuses these three rather than
                // letting a crafted scene swap a live object's prototype.
                if (config.prop === '__proto__' || config.prop === 'prototype' || config.prop === 'constructor') return;
                let value = config.value;
                if ((config.prop === 'x' || config.prop === 'y') && Number.isFinite(value)) {
                    // Canvas-bounds clamp, same shape as the arrow-key
                    // movement clamp: needs the object's CURRENT size.
                    const obj = ctx.getObjects().find(o => o.id === config.objectId);
                    if (!obj) return;
                    const max = Math.max(0, (config.prop === 'x' ? ctx.width - obj.w : ctx.height - obj.h));
                    value = Math.max(0, Math.min(max, value));
                }
                ctx.setObjectProp(config.objectId, config.prop, value);
                return;
            }
            case 'destroyObject':
                if (typeof config.objectId === 'string') ctx.removeObject(config.objectId);
                return;
            case 'playSound':
                beep(config);
                return;
            default:
                return; // unknown action kind: no-op (mirrors unknown-trigger inertness)
        }
    }

    // One evaluation pass = one fixed game-loop step. dt in milliseconds
    // (createGameLoop's fixedDt convention).
    function update(dt) {
        if (!active) return;
        const fired = new Set(); // node ids that fired/ran this frame
        const conditionResults = new Map(); // condition nodeId -> 'true'|'false' this frame
        for (const id of order) {
            const node = nodeById.get(id);
            try {
                if (node.type === 'trigger') {
                    if (evalTrigger(node, dt)) fired.add(id);
                    continue;
                }
                let activated = false;
                for (const e of (incoming.get(id) || [])) {
                    if (!fired.has(e.from)) continue;
                    if (e.condition === undefined || conditionResults.get(e.from) === e.condition) {
                        activated = true;
                        break;
                    }
                }
                if (!activated) continue;
                fired.add(id); // downstream nodes see this node as having run
                if (node.type === 'condition') {
                    conditionResults.set(id, evalCondition(node) ? 'true' : 'false');
                } else {
                    runAction(node);
                }
            } catch (err) {
                onError(err); // one throwing node must not kill the frame or the loop
            }
        }
    }

    initTriggerState();

    return {
        update,
        reset: initTriggerState,
        get active() { return active; },
        get graph() { return graph; },
    };
}

// Convenience for the playtest loop: map a scene's raw `chains` array to
// runners in one call. Non-array input -> empty list; each entry is
// normalized (and cyclic/empty ones self-disable) inside createChainRunner.
export function createChainRunners(chains, ctx) {
    const list = Array.isArray(chains) ? chains : [];
    return list.map(c => createChainRunner(c, ctx));
}

// Teardown for the module-level shared AudioContext (see the comment above
// `sharedAudioCtx`). Callers that own a playtest session's lifecycle (e.g.
// runScenePlaytest's stop()) call this when playtest mode actually ends.
// Reference-counted: decrements sharedAudioCtxRefCount and only actually
// closes the context once the count drops to zero, i.e. once every
// concurrently-running playtest/chain session sharing this module-level
// singleton has released it -- a single playtest's stop() must never tear
// down audio still owned by another live playtest (e.g. two game-player
// windows open at once). Safe to call more times than acquire() was called
// (ref count is clamped at zero, matching close()-on-already-closed being a
// no-op) and safe to call when no context was ever created (no-op).
export function closeSharedAudioContext() {
    if (sharedAudioCtxRefCount > 0) sharedAudioCtxRefCount--;
    if (sharedAudioCtxRefCount > 0) return; // other sessions still hold it
    if (!sharedAudioCtx) return;
    const ctx = sharedAudioCtx;
    sharedAudioCtx = null;
    if (ctx.state !== 'closed') {
        try { ctx.close().catch(() => { /* swallow: close rejected, context is being torn down anyway */ }); }
        catch { /* swallow: close threw synchronously (already closing/closed in some engines) */ }
    }
}
