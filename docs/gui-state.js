// Per-instance GUI state lives in the instance's Service Worker (see
// docs/sw-instance.js). This module exposes thin wrappers that take an
// instance's `sw` handle. The legacy global IDB DB ('thebird-gui-state') is
// no longer opened from the page — isolation is enforced at the SW thread.

import { createMachine, createActor, assign, fromPromise } from 'xstate';

// Debounced persistence as an explicit state machine: clean -> dirty -> (after
// 250ms) persisting -> clean. Replaces the ad-hoc dirty-flag + setTimeout. A
// CHANGE event while persisting re-dirties so no write is lost. The `flush`
// event forces immediate persistence (used on teardown).
const guiPersistMachine = createMachine({
    id: 'guiPersist',
    context: ({ input }) => ({ sw: input.sw, pending: null }),
    initial: 'clean',
    states: {
        clean: {
            on: { CHANGE: { target: 'dirty', actions: assign({ pending: ({ event }) => event.state }) } },
        },
        dirty: {
            on: {
                CHANGE: { actions: assign({ pending: ({ event }) => event.state }) },
                FLUSH: 'persisting',
            },
            after: { 250: 'persisting' },
        },
        persisting: {
            invoke: {
                src: 'save',
                input: ({ context }) => ({ sw: context.sw, state: context.pending }),
                onDone: 'clean',
                onError: { target: 'clean', actions: ({ event }) => console.warn('[thebird] gui-save dropped:', event.error && event.error.message || event.error) },
            },
            // A change during the write re-dirties so the next pending state persists.
            on: { CHANGE: { actions: assign({ pending: ({ event }) => event.state }) } },
        },
    },
}).provide({
    actors: {
        save: fromPromise(async ({ input }) => {
            if (input.state == null) return;
            await input.sw.call('gui-save', { state: input.state });
        }),
    },
});

export async function loadGuiState(sw) {
    if (!sw || typeof sw.call !== 'function') throw new Error('loadGuiState: sw handle required');
    return await sw.call('gui-load');
}

export async function saveGuiState(sw, state) {
    if (!sw || typeof sw.call !== 'function') throw new Error('saveGuiState: sw handle required');
    return await sw.call('gui-save', { state });
}

export function createGuiStateStore(sw) {
    if (!sw || typeof sw.call !== 'function') throw new Error('createGuiStateStore: sw handle required');
    const listeners = new Set();
    const actor = createActor(guiPersistMachine, { input: { sw } });
    actor.start();

    return {
        load: async () => await sw.call('gui-load'),
        save: async (state) => { await sw.call('gui-save', { state }); },
        // schedulePersist debounces through the machine (clean->dirty->persisting).
        schedulePersist: (state) => { actor.send({ type: 'CHANGE', state }); },
        flush: () => { actor.send({ type: 'FLUSH' }); },
        get state() { return actor.getSnapshot().value; },
        subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
        notify: (state) => { for (const fn of listeners) fn(state); }
    };
}
