// docs/lib/event-chain.js — minimal visual event/trigger-action logic-chain
// data model for the level editor: the DATA STRUCTURE + its algorithms
// (cycle detection and topological execution-order resolution). The graph
// is EXECUTED by docs/lib/event-chain-runtime.js, which level-editor-
// app.js's runScenePlaytest() wires into its ECS-driven playtest loop (a
// scene's optional `chains` array runs live: triggers fire, conditions
// branch, actions mutate the play state). The AUTHORING half lives in
// level-editor-app.js's collapsible chains panel (renderChains()): a
// list-based editor — one row per node with a type:kind select,
// kind-appropriate config fields, and outgoing-edge dropdowns whose
// selections are vetted through detectCycles below before being applied —
// writing these graphs into scene.chains (hand-authored scene JSON still
// loads unchanged). This file is the closed kernel both the runtime and
// that editor build on without redesign.
//
// Graph shape (versioned like level-editor-app.js's scene graph, for the
// same reason — future format changes get a migration branch instead of
// silently breaking saved chains):
//   {
//     schemaVersion: 1,
//     nodes: [ { id, type: 'trigger'|'action'|'condition', config } ],
//     edges: [ { from, to, condition?: 'true'|'false' } ]
//   }
//
// Node types (minimal, real shapes, not an exhaustive taxonomy):
//   trigger   — { id, type:'trigger', config:{ kind:'onCollision'|'onKeyPress'|'onTimer', ...kind-specific } }
//               Fires the chain. No incoming edges expected (source node).
//   action    — { id, type:'action', config:{ kind:'setProperty'|'playSound'|'destroyObject', ...kind-specific } }
//               Does something. May have one outgoing edge (next step).
//   condition — { id, type:'condition', config:{ kind:'compare', ... } }
//               Branches. Up to two outgoing edges, disambiguated by
//               edge.condition === 'true' | 'false'.
//
// The kind-specific config fields are intentionally left open here
// ("...kind-specific"): this file validates SHAPE only. The ONE concrete
// config shape per kind that the executor honors is defined and documented
// in docs/lib/event-chain-runtime.js's header — it consumes this same
// graph + topologicalOrder() without the data model needing to change.

const SCHEMA_VERSION = 1;

const NODE_TYPES = new Set(['trigger', 'action', 'condition']);

export function createEventChain() {
    return { schemaVersion: SCHEMA_VERSION, nodes: [], edges: [] };
}

function isValidNode(n) {
    return n && typeof n === 'object' && typeof n.id === 'string' && NODE_TYPES.has(n.type);
}

function isValidEdge(e) {
    return e && typeof e === 'object' && typeof e.from === 'string' && typeof e.to === 'string'
        && (e.condition === undefined || e.condition === 'true' || e.condition === 'false');
}

// Corrupt/malformed-load fallback, mirroring level-editor-app.js's
// normalizeScene: never throw on a bad save, always recover a valid
// (possibly emptier) graph.
export function normalizeEventChain(raw) {
    if (!raw || typeof raw !== 'object') return createEventChain();
    const seenIds = new Set();
    const nodes = Array.isArray(raw.nodes) ? raw.nodes.filter(isValidNode).filter(n => {
        if (seenIds.has(n.id)) return false;
        seenIds.add(n.id);
        return true;
    }).map(n => ({
        id: n.id, type: n.type, config: (n.config && typeof n.config === 'object') ? n.config : {},
    })) : [];
    const ids = new Set(nodes.map(n => n.id));
    const edges = Array.isArray(raw.edges) ? raw.edges.filter(e => isValidEdge(e) && ids.has(e.from) && ids.has(e.to))
        .map(e => ({ from: e.from, to: e.to, ...(e.condition ? { condition: e.condition } : {}) })) : [];
    return { schemaVersion: SCHEMA_VERSION, nodes, edges };
}

function adjacency(graph) {
    const adj = new Map();
    for (const n of graph.nodes) adj.set(n.id, []);
    for (const e of graph.edges) {
        if (!adj.has(e.from)) adj.set(e.from, []);
        adj.get(e.from).push(e.to);
    }
    return adj;
}

// ---- cycle detection ----------------------------------------------------
// Structural (author-time) cycle detection over the graph's STATIC edge
// set — this is a different safety mechanism from shell-control.js's
// runWhile LOOP_CAP (docs/shell-control.js:98), which guards a live
// iteration count at RUNTIME (a while-loop that could legitimately run a
// huge-but-finite number of times gets a hard 10,000,000-iteration cap so
// a runaway script can't hang the shell forever). detectCycles here has no
// runtime counterpart to cap — it answers a yes/no question about the
// graph's SHAPE before any execution happens, so an author can never save
// a trigger chain that would loop forever in the first place. Both are
// needed for a real runtime: this file supplies the structural half; the
// executor (docs/lib/event-chain-runtime.js) honors the structural verdict
// by going inert on a cyclic chain and running each node at most once per
// frame. An engine that ever chose to ALLOW a conditional back-edge at
// runtime would still want its own iteration guard in the same spirit as
// LOOP_CAP (this data model currently forbids cycles outright via
// topologicalOrder's refusal below, so no such back-edge is legal yet).
//
// Algorithm: classic DFS three-color (white/gray/black) cycle detection.
// white = unvisited, gray = on the current DFS stack (visiting), black =
// fully explored. A gray->gray edge (visiting a node already gray) is a
// back edge, i.e. a cycle. This is O(V+E) and, unlike Tarjan's SCC, gives
// the actual cycle path directly from the DFS stack for free — exactly
// what the return shape ({hasCycle, cyclePath}) needs.
export function detectCycles(graph) {
    const g = graph && Array.isArray(graph.nodes) ? graph : createEventChain();
    if (g.nodes.length === 0) return { hasCycle: false, cyclePath: null };

    const adj = adjacency(g);
    const color = new Map(g.nodes.map(n => [n.id, 'white']));
    const stack = [];

    // Iterative DFS (explicit work-stack of {id, iterator over neighbors}
    // frames) instead of a recursive dfs() — a JS-stack-recursive version
    // pushes one call frame per edge traversed with no depth cap, so a long
    // linear or densely-connected chain graph could exceed the JS call
    // stack and throw RangeError instead of returning {hasCycle,cyclePath}.
    // This walks the exact same three-color algorithm and produces the
    // identical cyclePath shape, but depth is bounded only by heap (the
    // `frames` array), never by the JS call stack.
    function dfs(startId) {
        const frames = [{ id: startId, it: (adj.get(startId) || [])[Symbol.iterator]() }];
        color.set(startId, 'gray');
        stack.push(startId);

        while (frames.length > 0) {
            const frame = frames[frames.length - 1];
            const step = frame.it.next();
            if (step.done) {
                stack.pop();
                color.set(frame.id, 'black');
                frames.pop();
                continue;
            }
            const next = step.value;
            const c = color.get(next);
            if (c === 'gray') {
                // Found the back edge: extract the cycle portion of the stack.
                const start = stack.indexOf(next);
                return stack.slice(start).concat(next);
            }
            if (c === 'white') {
                color.set(next, 'gray');
                stack.push(next);
                frames.push({ id: next, it: (adj.get(next) || [])[Symbol.iterator]() });
            }
            // black = already fully explored, safe to skip (no cycle through it)
        }
        return null;
    }

    for (const n of g.nodes) {
        if (color.get(n.id) === 'white') {
            const cyclePath = dfs(n.id);
            if (cyclePath) return { hasCycle: true, cyclePath };
        }
    }
    return { hasCycle: false, cyclePath: null };
}

// ---- topological execution order -----------------------------------------
// Kahn's algorithm (in-degree queue). Refuses (returns null) on a cyclic
// graph — callers must run detectCycles first, per the empty-graph and
// cyclic-graph contracts below. Empty graph -> empty array, never throws.
export function topologicalOrder(graph) {
    const g = graph && Array.isArray(graph.nodes) ? graph : createEventChain();
    if (g.nodes.length === 0) return [];

    const { hasCycle } = detectCycles(g);
    if (hasCycle) return null;

    const adj = adjacency(g);
    const inDegree = new Map(g.nodes.map(n => [n.id, 0]));
    for (const e of g.edges) {
        inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
    }

    const queue = g.nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
    const order = [];
    while (queue.length) {
        const id = queue.shift();
        order.push(id);
        for (const next of (adj.get(id) || [])) {
            inDegree.set(next, inDegree.get(next) - 1);
            if (inDegree.get(next) === 0) queue.push(next);
        }
    }
    return order;
}

// ---- persistence ----------------------------------------------------------
// Design choice: a SNAPSHOT-SHAPED PLAIN-OBJECT API, not a real xstate
// actor. Rationale (per wm.js's own convention at docs/wm.js:14,
// docs/wm.js:317-318, docs/wm.js:549 — `getPersistedSnapshot()` /
// `createActor(machine, { snapshot })` / `createActor(machine, { input })`):
// xstate earns its keep in this codebase when a surface has real runtime
// STATE TRANSITIONS driven by events (windowMachine reacts to move/resize/
// minimize/focus events with guards and side effects). The graph itself has
// no runtime transitions — the executor (docs/lib/event-chain-runtime.js)
// consumes it READ-ONLY, keeping all live trigger state (edge detectors,
// timer accumulators) in its own closure, so this remains an author-time
// data structure plus pure functions over it (detectCycles,
// topologicalOrder). Wrapping a value with no transitions in a machine
// would be a machine with one state and assign actions standing in for
// plain mutation — false ceremony, not honesty.
// So this exposes the SAME SHAPE the xstate-everywhere convention expects
// (getPersistedSnapshot() / restoreFromSnapshot(snapshot) mirroring
// createActor(machine, { snapshot })) as plain functions over the graph
// value, so the existing executor — or a future engine with genuinely
// event-driven graph-state transitions — can lift this verbatim into a
// real createMachine/createActor pair by swapping these two functions for
// actor.getPersistedSnapshot()/createActor(m, {snapshot}) without changing
// the graph shape or any call site that only cares about the snapshot JSON.
export function getPersistedSnapshot(graph) {
    return normalizeEventChain(graph);
}

export function restoreFromSnapshot(snapshot) {
    return normalizeEventChain(snapshot);
}
