// Public typed SDK facade -- one coherent per-instance object exposed as
// window.thebird, replacing scattered window.__debug pokes. This is also the
// documented surface page.evaluate-based witnesses should drive.
//
// Wraps the existing instance.fs (docs/instance-fs.js) shape rather than
// reimplementing storage: fs.{read,write,list,mkdir,remove,grep} below are
// thin adapters over the already-synchronous snapshot-backed instance fs.

// Typed event emitter -- ready|error|status|file.change|log. Deliberately
// tiny (no wildcard matching, no once()) to match instance-fs's own
// dependency-free style; ~30 lines, ported near-verbatim from the clawless
// pattern this SDK is modeled on.
export function createEventEmitter() {
    const listeners = new Map();
    return {
        on(event, fn) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(fn);
            return () => listeners.get(event)?.delete(fn);
        },
        off(event, fn) {
            listeners.get(event)?.delete(fn);
        },
        emit(event, payload) {
            const set = listeners.get(event);
            if (!set) return;
            for (const fn of [...set]) {
                try { fn(payload); } catch (err) { console.error('[sdk] listener for ' + event + ' threw:', err); }
            }
        },
    };
}

const toKey = p => String(p).replace(/^\//, '');

// fs.grep: regex search over every stored path's text content, mirroring
// clawless's ContainerManager.grep. Only meaningful over text-shaped entries
// (readJson/readFile paths); binary blobs (if any) are skipped via a try/catch
// per line since instance-fs stores everything as strings already.
function makeFsGrep(instance) {
    return function grep(pattern, opts = {}) {
        const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, opts.flags || 'i');
        const results = [];
        const prefix = opts.path ? toKey(opts.path) : '';
        for (const key of instance.fs.list(prefix)) {
            let text;
            try { text = instance.fs.readFile('/' + key); } catch { continue; }
            if (typeof text !== 'string') continue;
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (re.test(lines[i])) {
                    results.push({ path: '/' + key, line: i + 1, text: lines[i] });
                    if (opts.limit && results.length >= opts.limit) return results;
                }
            }
        }
        return results;
    };
}

// Creates the per-instance SDK object. `instance` is the shell's instance
// record (has .id, .fs, .sw, and by convention may gain .shell/.emit later).
// `hooks` optionally supplies exec/sendInput/git/zip functions from the
// caller (os-shell.js) since those live outside instance-fs's own scope.
export function createSdk(instance, hooks = {}) {
    const events = createEventEmitter();

    // instance-fs has no change-notification today; wrap write/unlink so the
    // SDK's file.change event fires without instance-fs itself depending on
    // an event emitter (keeps instance-fs dependency-free per its own file
    // header discipline -- the emitter lives at the SDK layer, one level up).
    const rawWriteFile = instance.fs.writeFile.bind(instance.fs);
    const rawWriteJson = instance.fs.writeJson.bind(instance.fs);
    const rawUnlink = instance.fs.unlink.bind(instance.fs);
    instance.fs.writeFile = (path, data) => { const r = rawWriteFile(path, data); events.emit('file.change', { path, type: 'write' }); return r; };
    instance.fs.writeJson = (path, obj) => { const r = rawWriteJson(path, obj); events.emit('file.change', { path, type: 'write' }); return r; };
    instance.fs.unlink = (path) => { const r = rawUnlink(path); events.emit('file.change', { path, type: 'remove' }); return r; };

    const fs = {
        read: (path) => instance.fs.readFile(path),
        write: (path, data) => instance.fs.writeFile(path, data),
        list: (prefix) => instance.fs.list(prefix),
        mkdir: () => { /* instance-fs is a flat key-value snapshot: directories are implicit
                           path prefixes, not real entries, so there is nothing to create. */ },
        remove: (path) => instance.fs.unlink(path),
        grep: makeFsGrep(instance),
        readJson: (path, dflt) => instance.fs.readJson(path, dflt),
        writeJson: (path, obj) => instance.fs.writeJson(path, obj),
        exists: (path) => instance.fs.exists(path),
    };

    const sdk = {
        instanceId: instance.id,
        fs,
        exec: hooks.exec || (() => { throw new Error('sdk.exec: not wired for this instance'); }),
        sendInput: hooks.sendInput || (() => { throw new Error('sdk.sendInput: not wired for this instance'); }),
        git: hooks.git || {
            clone: () => { throw new Error('sdk.git.clone: not wired for this instance'); },
            push: () => { throw new Error('sdk.git.push: not wired for this instance'); },
            checkVisibility: () => { throw new Error('sdk.git.checkVisibility: not wired for this instance'); },
        },
        zip: hooks.zip || {
            export: () => { throw new Error('sdk.zip.export: not wired for this instance'); },
            import: () => { throw new Error('sdk.zip.import: not wired for this instance'); },
        },
        logs: hooks.logs || (() => []),
        use: hooks.use || (() => { throw new Error('sdk.use: plugin architecture not wired for this instance'); }),
        on: events.on,
        off: events.off,
        emit: events.emit,
    };

    events.emit('ready', { instanceId: instance.id });
    return sdk;
}

// Mounts window.thebird as a live map of instanceId -> sdk, refreshed on
// each createSdk call. Multiple instances coexist (thebird is multi-instance
// by design), so window.thebird is keyed by id rather than a single object.
export function mountSdk(instanceId, sdk) {
    if (typeof window === 'undefined') return;
    if (!window.thebird) window.thebird = {};
    window.thebird[instanceId] = sdk;
}
