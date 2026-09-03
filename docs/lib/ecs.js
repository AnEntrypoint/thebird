// ecs.js — adapter wrapping @spoint/ecs with thebird-compatible API surface.
//
// Ported from the original standalone ecs.js (Map<entityId, Map<componentType,data>>)
// to use the shared @spoint/ecs package (component-major Map<componentName, Map<entityId,data>>).
// The adapter preserves the same function signatures so existing callers work unchanged.
//
// Key bridge: thebird uses string entity IDs (monotonic String counter), @spoint/ecs
// uses numeric IDs. The adapter internally maps string IDs to the underlying numeric IDs
// and converts back in all returned values.

import { createWorld as _createSpointWorld, createQuery } from '../vendor/spoint-ecs/src/index.js';

export function createWorld() {
  let _w = _createSpointWorld();

  // string id -> numeric id
  const _idMap = new Map();
  // numeric id -> string id (reverse)
  const _revMap = new Map();
  let __nextId = 1;

  // Track registered system functions for removeSystem()
  const _sysReg = new Map(); // fn -> array of unregister fns (stack; supports duplicate fn registration)
  let __sysSeq = 0;

  function _toNum(id) {
    if (typeof id === 'number') return id;
    const num = _idMap.get(String(id));
    if (num === undefined) throw new Error('ecs: unknown entity id: ' + id);
    return num;
  }

  function _toStr(num) {
    const str = _revMap.get(num);
    if (str === undefined) throw new Error('ecs: internal id mapping missing for ' + num);
    return str;
  }

  function createEntity(id) {
    const sid = id != null ? String(id) : String(__nextId++);
    if (_idMap.has(sid)) throw new Error('ecs: entity id already exists: ' + sid);
    const num = _w.createEntity();
    _idMap.set(sid, num);
    _revMap.set(num, sid);
    return sid;
  }

  function destroyEntity(id) {
    const num = _idMap.get(String(id));
    if (num === undefined) return false;
    _w.destroyEntity(num);
    _idMap.delete(String(id));
    _revMap.delete(num);
    return true;
  }

  function addComponent(id, type, data) {
    return _w.addComponent(_toNum(id), type, data);
  }

  function removeComponent(id, type) {
    const num = _idMap.get(String(id));
    if (num === undefined) return false;
    _w.removeComponent(num, type);
    return true;
  }

  function getComponent(id, type) {
    const num = _idMap.get(String(id));
    if (num === undefined) return undefined;
    return _w.getComponent(num, type);
  }

  function hasComponent(id, type) {
    const num = _idMap.get(String(id));
    if (num === undefined) return false;
    return _w.hasComponent(num, type);
  }

  // query(...types) -> array of string entity ids possessing ALL given types.
  function query(...types) {
    if (types.length === 0) {
      return [..._idMap.keys()];
    }
    const q = createQuery(_w, { has: types });
    return [...q].map(_toStr);
  }

  function addSystem(fn, order = 0) {
    const name = 'sys_' + (__sysSeq++);
    const unreg = _w.registerSystem(name, (world, dt) => fn(worldApi, dt), order);
    let stack = _sysReg.get(fn);
    if (!stack) {
      stack = [];
      _sysReg.set(fn, stack);
    }
    stack.push(unreg);
    return fn;
  }

  function removeSystem(fn) {
    const stack = _sysReg.get(fn);
    if (!stack || stack.length === 0) return false;
    const unreg = stack.pop();
    unreg();
    if (stack.length === 0) _sysReg.delete(fn);
    return true;
  }

  function step(dt) {
    _w.update(dt);
  }

  function serialize() {
    const snap = _w.snapshot();
    const entityIds = [];
    const components = {};
    for (const num of snap.entities) {
      const sid = _revMap.get(num);
      if (sid !== undefined) {
        entityIds.push(sid);
      }
    }
    for (const [type, store] of Object.entries(snap.components)) {
      const byId = {};
      for (const [num, data] of Object.entries(store)) {
        const sid = _revMap.get(Number(num));
        if (sid !== undefined) {
          byId[sid] = data;
        }
      }
      if (Object.keys(byId).length > 0) {
        components[type] = byId;
      }
    }
    return { schemaVersion: 1, entities: entityIds, components };
  }

  function deserialize(data) {
    _idMap.clear();
    _revMap.clear();
    _sysReg.clear();
    __sysSeq = 0;

    // Create a fresh world and rebuild
    _w = _createSpointWorld();

    if (!data || typeof data !== 'object') return worldApi;

    const entityIds = Array.isArray(data.entities) ? data.entities : [];
    const compData = data.components && typeof data.components === 'object' ? data.components : {};

    for (const sid of entityIds) {
      const num = _w.createEntity();
      _idMap.set(String(sid), num);
      _revMap.set(num, String(sid));
      // Update __nextId to be past any numeric ids
      const n = Number(sid);
      if (!isNaN(n) && n >= __nextId) __nextId = n + 1;
    }

    for (const type of Object.keys(compData)) {
      const byId = compData[type];
      for (const sid of Object.keys(byId)) {
        const num = _idMap.get(sid);
        if (num !== undefined) {
          _w.addComponent(num, type, byId[sid]);
        }
      }
    }

    return worldApi;
  }

  const worldApi = {
    createEntity, destroyEntity,
    addComponent, removeComponent, getComponent, hasComponent,
    query,
    addSystem, removeSystem,
    step,
    serialize, deserialize,
    get entityCount() {
      return _idMap.size;
    },
  };

  return worldApi;
}