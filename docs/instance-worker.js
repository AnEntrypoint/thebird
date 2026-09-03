import { createMachine, createActor, assign } from 'xstate';

const WORKER_BODY = `
let canvas = null, ctx = null, raf = 0, t = 0, lastEvent = null, instanceId = null;
self.onmessage = e => {
    const m = e.data;
    if (m.type === 'init') {
        instanceId = m.instanceId;
        self.postMessage({ type: 'ready', instanceId });
        return;
    }
    if (m.type === 'mount') {
        canvas = m.canvas;
        ctx = canvas.getContext('2d');
        if (raf) cancelAnimationFrame(raf);
        const draw = () => {
            t += 1;
            const w = canvas.width, h = canvas.height;
            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = '#3FA93A';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i < 60; i++) {
                const x = (i / 60) * w;
                const y = h / 2 + Math.sin(t / 20 + i / 5) * (h / 3);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.fillStyle = '#e8e8e8';
            ctx.font = '12px monospace';
            ctx.fillText('worker[' + instanceId + '] frame=' + t, 8, 14);
            if (lastEvent) ctx.fillText('last=' + lastEvent, 8, 28);
            raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw);
        self.postMessage({ type: 'mounted', instanceId });
        return;
    }
    if (m.type === 'input') {
        lastEvent = m.kind + '@' + m.x + ',' + m.y;
        self.postMessage({ type: 'input-ack', instanceId, lastEvent });
        return;
    }
    if (m.type === 'resize') {
        if (canvas) { canvas.width = m.width; canvas.height = m.height; }
        return;
    }
    if (m.type === 'frame-count') {
        self.postMessage({ type: 'frame-count-reply', instanceId, t });
        return;
    }
    if (m.type === 'stop') {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        self.postMessage({ type: 'stopped', instanceId });
        return;
    }
};
`;

let _blobUrl = null;
function workerUrl() {
    if (_blobUrl) return _blobUrl;
    _blobUrl = URL.createObjectURL(new Blob([WORKER_BODY], { type: 'application/javascript' }));
    return _blobUrl;
}

// Explicit lifecycle machine: booting -> ready -> mounted -> stopping -> stopped.
// Tracks worker lifecycle so teardown/restore is deterministic and a refresh
// never leaves a half-mounted worker. The machine mirrors worker-thread events;
// the actual postMessage/onmessage wiring stays the source of truth.
//
// PERSISTED JOB DESCRIPTOR
// ------------------------
// The machine context carries a small serializable `job` descriptor recording
// WHAT the worker had mounted. It is fully JSON-serializable so it survives a
// page refresh via xstate's getPersistedSnapshot()/{ snapshot } rehydration.
//
// IMPORTANT BOUNDARY: the mounted thing is a DOM <canvas> (an OffscreenCanvas is
// transferred into the worker thread). A DOM node CANNOT be serialized, so the
// descriptor only records that a canvas WAS mounted, its pixel dimensions, and a
// cheap worker-side job id. On restore the host/app is responsible for creating a
// fresh canvas and calling worker.mount(canvas) again; the persisted descriptor
// tells the host "this worker had a canvas job, re-mount it" and seeds matching
// dimensions. The machine restores its serializable job state only.
function makeWorkerMachine() {
    return createMachine({
        id: 'instanceWorker',
        initial: 'booting',
        context: {
            // Serializable descriptor of the mounted job. `mounted` is the only
            // strictly-required field; the rest is cheap identifying info that lets
            // the app re-establish the same logical state on restore.
            job: {
                mounted: false,
                jobId: null,   // worker-side job id (serializable), assigned on mount
                width: null,   // canvas pixel width recorded at mount time
                height: null,  // canvas pixel height recorded at mount time
            },
        },
        states: {
            // Worker spawned, 'init' posted, awaiting 'ready' from the thread.
            booting: {
                on: { READY: 'ready', STOP: 'stopping' },
            },
            // Worker reported ready; not yet rendering to a canvas.
            ready: {
                on: { MOUNTED: 'mounted', STOP: 'stopping' },
            },
            // OffscreenCanvas transferred and the worker is drawing frames.
            mounted: {
                // Record the serializable job descriptor on entry.
                entry: assign({
                    job: ({ event }) => ({
                        mounted: true,
                        jobId: event.jobId ?? ('job-' + Date.now()),
                        width: event.width ?? null,
                        height: event.height ?? null,
                    }),
                }),
                on: { STOP: 'stopping' },
            },
            // 'stop' posted, awaiting 'stopped' ack before terminate().
            stopping: {
                entry: assign({ job: ({ context }) => ({ ...context.job, mounted: false }) }),
                on: { STOPPED: 'stopped' },
            },
            // Terminal: worker thread torn down.
            stopped: { type: 'final' },
        },
    });
}

// createInstanceWorker(id) — backward-compatible: returns { ready, mount, stop, state, ... }.
// createInstanceWorker(id, { snapshot }) — optional. `snapshot` is a value previously
// obtained from worker.getPersistedSnapshot() (xstate persisted snapshot). When passed,
// the lifecycle machine is rehydrated with the prior job descriptor so a refresh
// re-establishes the worker's logical state. The persisted `job` descriptor (in
// snapshot.context.job) tells the host whether a canvas was mounted and its dimensions
// so the app can re-create + re-mount a canvas; the DOM node itself is never serialized.
export function createInstanceWorker(instanceId, opts = {}) {
    if (!instanceId) throw new Error('createInstanceWorker: instanceId required');
    const { snapshot } = opts;
    const w = new Worker(workerUrl());
    const handlers = new Set();
    w.onmessage = e => { for (const h of handlers) h(e.data); };
    function once(predicate) {
        return new Promise(resolve => {
            const h = msg => { if (predicate(msg)) { handlers.delete(h); resolve(msg); } };
            handlers.add(h);
        });
    }

    // Rehydrate from a prior persisted snapshot when provided (refresh restore),
    // otherwise start fresh. The restored snapshot carries the serializable `job`
    // descriptor so getJob() reflects the pre-refresh logical state immediately.
    const actor = snapshot
        ? createActor(makeWorkerMachine(), { snapshot })
        : createActor(makeWorkerMachine());
    actor.start();

    // Resolve worker.ready when the actor reaches 'ready'.
    let _resolveReady;
    const readyPromise = new Promise(res => { _resolveReady = res; });
    const sub = actor.subscribe(snap => {
        if (snap.value === 'ready') _resolveReady();
    });

    // Pending mount metadata, captured at mount() call time, attached to MOUNTED
    // so the machine records serializable dimensions/jobId in its job descriptor.
    let _pendingMount = null;

    // Bridge worker-thread events into the machine.
    handlers.add(msg => {
        if (msg.instanceId !== instanceId) return;
        if (msg.type === 'ready') actor.send({ type: 'READY' });
        else if (msg.type === 'mounted') {
            actor.send({ type: 'MOUNTED', ...(_pendingMount || {}) });
            _pendingMount = null;
        }
        else if (msg.type === 'stopped') actor.send({ type: 'STOPPED' });
    });

    w.postMessage({ type: 'init', instanceId });

    const api = {
        instanceId,
        ready: readyPromise,
        get state() { return actor.getSnapshot().value; },
        async mount(canvasEl, jobId, timeoutMs = 5000) {
            // Bounded wait, same rationale as frameCount(): once() only resolves on a
            // matching reply, so a worker that stalls or drops the 'mounted' ack
            // (thrown error before self.postMessage, transferControlToOffscreen()
            // failing async) would otherwise leave the caller hung forever and leak
            // one `handlers` entry per failed retry. Race a timer alongside it and
            // always remove the handler so a stall costs one handler for timeoutMs,
            // never a permanent leak, and the caller gets a real rejection instead
            // of hanging indefinitely.
            _pendingMount = {
                width: canvasEl.width || null,
                height: canvasEl.height || null,
                jobId: jobId ?? null,
            };
            const off = canvasEl.transferControlToOffscreen();
            let h;
            const matched = new Promise(resolve => {
                h = msg => { if (msg.type === 'mounted' && msg.instanceId === instanceId) resolve(msg); };
                handlers.add(h);
            });
            w.postMessage({ type: 'mount', canvas: off }, [off]);
            let timer;
            const timeout = new Promise(resolve => {
                timer = setTimeout(() => resolve(null), timeoutMs);
            });
            const msg = await Promise.race([matched, timeout]);
            clearTimeout(timer);
            handlers.delete(h);
            if (!msg) {
                _pendingMount = null;
                throw new Error(`instance-worker: mount() timed out after ${timeoutMs}ms (instance ${instanceId})`);
            }
        },
        // Serializable descriptor of the mounted job (or its restored state).
        // { mounted, jobId, width, height }. The DOM canvas is NOT here — the app
        // re-creates it and calls mount() again on restore.
        getJob() { return { ...actor.getSnapshot().context.job }; },
        // xstate persisted snapshot — JSON-serializable. Persist this per-instance
        // (e.g. IndexedDB / persistence-registry) and pass back as
        // createInstanceWorker(id, { snapshot }) to restore the worker's job state.
        getPersistedSnapshot() { return actor.getPersistedSnapshot(); },
        async sendInput(kind, x, y, timeoutMs = 2000) {
            // Bounded wait, same rationale as frameCount(): once() never rejects on
            // its own, so a stalled/torn-down worker would otherwise leave the
            // handler in `handlers` forever -- one leaked entry per call during a
            // stall (plausible under frequent pointer/keyboard input). Race a timer
            // and always remove the handler on the timeout path.
            let h;
            const matched = new Promise(resolve => {
                h = msg => { if (msg.type === 'input-ack' && msg.instanceId === instanceId) resolve(msg); };
                handlers.add(h);
            });
            w.postMessage({ type: 'input', kind, x, y });
            let timer;
            const timeout = new Promise(resolve => {
                timer = setTimeout(() => resolve(null), timeoutMs);
            });
            const msg = await Promise.race([matched, timeout]);
            clearTimeout(timer);
            handlers.delete(h);
            return msg;
        },
        resize(width, height) {
            w.postMessage({ type: 'resize', width, height });
        },
        async frameCount(timeoutMs = 2000) {
            // Bounded wait: once() never rejects on its own (only resolves when the
            // matching reply arrives), so a torn-down/stuck worker would otherwise
            // leave its handler in `handlers` forever — one extra Set entry per
            // stalled call, growing unbounded across repeated polling (e.g. the
            // monitor app's 1s tick). Race a timer alongside it and always remove
            // the handler on the timeout path so a stall costs one handler for
            // timeoutMs, never a permanent leak.
            let h;
            const matched = new Promise(resolve => {
                h = msg => { if (msg.type === 'frame-count-reply' && msg.instanceId === instanceId) resolve(msg); };
                handlers.add(h);
            });
            w.postMessage({ type: 'frame-count' });
            let timer;
            const timeout = new Promise(resolve => {
                timer = setTimeout(() => resolve(null), timeoutMs);
            });
            const msg = await Promise.race([matched, timeout]);
            clearTimeout(timer);
            handlers.delete(h);
            return msg ? msg.t : 0;
        },
        async stop(timeoutMs = 2000) {
            // Bounded wait, same pattern as frameCount(): a crashed/stalled worker
            // may never post 'stopped', and this is the terminal cleanup path (the
            // one caller that most needs a guaranteed-bounded exit) -- an unbounded
            // await here would leak the Worker thread and its handlers Set entry
            // forever while the caller believes teardown happened. Race a timer
            // alongside the ack and always remove the handler + force-terminate on
            // the timeout path so a stall costs timeoutMs, never a stuck teardown.
            actor.send({ type: 'STOP' });
            let h;
            const matched = new Promise(resolve => {
                h = msg => { if (msg.type === 'stopped' && msg.instanceId === instanceId) resolve(msg); };
                handlers.add(h);
            });
            w.postMessage({ type: 'stop' });
            let timer;
            const timeout = new Promise(resolve => {
                timer = setTimeout(() => resolve(null), timeoutMs);
            });
            await Promise.race([matched, timeout]);
            clearTimeout(timer);
            handlers.delete(h);
            w.terminate();
            sub.unsubscribe();
            actor.stop();
        },
        get raw() { return w; },
    };

    if (typeof window !== 'undefined') {
        if (!window.__debug) window.__debug = {};
        window.__debug.instances = window.__debug.instances || {};
        window.__debug.instances[instanceId] = window.__debug.instances[instanceId] || {};
        window.__debug.instances[instanceId].worker = api;
    }
    return api;
}
