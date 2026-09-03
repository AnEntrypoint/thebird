// Real instance-registry module: the load-path accessor for "the current
// active instance" object, consumed by app factories via
// docs/apps.js resolveInstance(). Single writer is docs/os-shell.js — it is
// the ONLY module that calls registerInstanceSource(), once, right after it
// builds the live `instances` Map and the shellActor-backed
// getActiveInstance() closure. Everything else (apps.js, individual app
// factories) only reads via getActiveInstance()/getInstances() below.
//
// window.__debug.shell / window.__debug.instances still exist (os-shell.js
// keeps setting them) as a READ-ONLY mirror for console/witness-script
// access, but nothing in this module — and nothing on the production read
// path through resolveInstance() — depends on them anymore.

let _instances = null;    // live Map<id, instanceObject>, owned by os-shell.js
let _getActiveId = null;  // () => string|null, owned by os-shell.js (shellActor-backed)

// Called once by os-shell.js after it constructs the live `instances` Map
// and its shellActor-backed activeInstance accessor. Both are stable
// references — the Map is mutated in place (set/delete), so no further
// re-registration is needed as instances come and go.
export function registerInstanceSource(src) {
    if (_instances && _instances !== src.instances) {
        throw new Error(
            'instance-registry: registerInstanceSource() called twice with a ' +
            'different instances Map — os-shell.js is documented as the single ' +
            'writer calling this exactly once. A second registration with a new ' +
            'live Map would silently strand every existing consumer on the old ' +
            'instance set.'
        );
    }
    _instances = src.instances;
    _getActiveId = src.getActiveId;
}

// All currently-live instance objects, in Map-iteration order. Empty array
// before registerInstanceSource() has run (e.g. imported outside a running
// shell, such as in a unit test).
export function getInstances() {
    return _instances ? [..._instances.values()] : [];
}

// The live active instance object, or null. Falls back to the sole live
// instance when the active-id hasn't landed yet (early-boot race between
// newInstance() minting an id and setActiveInstance() completing) — this
// mirrors the tolerance the old window.__debug.instances fallback provided.
export function getActiveInstance() {
    if (!_instances) return null;
    const id = _getActiveId ? _getActiveId() : null;
    if (id && _instances.has(id)) return _instances.get(id);
    if (_instances.size === 1) return [..._instances.values()][0];
    return null;
}

// Look up a single instance object by id, or null. This is the single
// source of truth for "does instance X exist" — docs/sw-client.js's SW
// message router calls this instead of keeping its own parallel array of
// instance Maps (both used to hold a reference to the exact same `instances`
// Map os-shell.js owns; consolidated here to remove that duplication).
export function getInstanceById(id) {
    return (_instances && id && _instances.has(id)) ? _instances.get(id) : null;
}
