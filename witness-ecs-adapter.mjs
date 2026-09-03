// witness-ecs-adapter.mjs — Verifies thebird's lib/ecs.js adapter works
// end-to-end with @spoint/ecs. Run with: node --check witness-ecs-adapter.mjs && node witness-ecs-adapter.mjs
//
// This is the verification for PRD row cross-project-ecs-thebird-adopt-shared-package
// first slice: "replace one thebird game app's ecs.js import with @spoint/ecs and verify it works."

import { createWorld } from './docs/lib/ecs.js';

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL: ${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// 1. World creation
check('createWorld returns world object', () => {
  const w = createWorld();
  assert(typeof w === 'object', 'world should be an object');
  assert(typeof w.createEntity === 'function', 'createEntity should be a function');
  assert(typeof w.destroyEntity === 'function', 'destroyEntity should be a function');
  assert(typeof w.addComponent === 'function', 'addComponent should be a function');
  assert(typeof w.removeComponent === 'function', 'removeComponent should be a function');
  assert(typeof w.getComponent === 'function', 'getComponent should be a function');
  assert(typeof w.hasComponent === 'function', 'hasComponent should be a function');
  assert(typeof w.query === 'function', 'query should be a function');
  assert(typeof w.addSystem === 'function', 'addSystem should be a function');
  assert(typeof w.removeSystem === 'function', 'removeSystem should be a function');
  assert(typeof w.step === 'function', 'step should be a function');
  assert(typeof w.serialize === 'function', 'serialize should be a function');
  assert(typeof w.deserialize === 'function', 'deserialize should be a function');
  assert(w.entityCount === 0, 'entityCount should be 0');
});

// 2. Entity lifecycle
check('createEntity returns string id', () => {
  const w = createWorld();
  const id = w.createEntity();
  assert(typeof id === 'string', 'entity id should be string');
  assert(w.entityCount === 1, 'entityCount should be 1');
});

check('createEntity with explicit id', () => {
  const w = createWorld();
  const id = w.createEntity('player');
  assert(id === 'player', 'should return the explicit id');
  assert(w.entityCount === 1, 'entityCount should be 1');
});

check('createEntity duplicate id throws', () => {
  const w = createWorld();
  w.createEntity('player');
  let threw = false;
  try { w.createEntity('player'); } catch (e) { threw = true; }
  assert(threw, 'should throw on duplicate id');
});

check('destroyEntity returns true for existing entity', () => {
  const w = createWorld();
  const id = w.createEntity();
  assert(w.destroyEntity(id) === true, 'destroyEntity should return true');
  assert(w.entityCount === 0, 'entityCount should be 0');
});

check('destroyEntity returns false for non-existing entity', () => {
  const w = createWorld();
  assert(w.destroyEntity('nonexistent') === false, 'destroyEntity should return false');
});

// 3. Component CRUD
check('addComponent and getComponent with string id', () => {
  const w = createWorld();
  const id = w.createEntity('e1');
  w.addComponent(id, 'position', { x: 10, y: 20 });
  const pos = w.getComponent(id, 'position');
  assert(pos !== undefined, 'component should exist');
  assert(pos.x === 10 && pos.y === 20, 'component data should match');
});

check('hasComponent returns true/false', () => {
  const w = createWorld();
  const id = w.createEntity('e1');
  w.addComponent(id, 'health', 100);
  assert(w.hasComponent(id, 'health') === true, 'should have health');
  assert(w.hasComponent(id, 'mana') === false, 'should not have mana');
});

check('removeComponent returns true for existing component', () => {
  const w = createWorld();
  const id = w.createEntity('e1');
  w.addComponent(id, 'health', 100);
  assert(w.removeComponent(id, 'health') === true, 'removeComponent should return true');
  assert(w.hasComponent(id, 'health') === false, 'should no longer have health');
});

check('removeComponent returns false for unknown entity', () => {
  const w = createWorld();
  assert(w.removeComponent('nonexistent', 'health') === false, 'removeComponent should return false');
});

// 4. Query
check('query() returns all entity ids', () => {
  const w = createWorld();
  w.createEntity('a');
  w.createEntity('b');
  w.createEntity('c');
  const all = w.query();
  assert(all.length === 3, 'should return 3 entities');
  assert(all.includes('a') && all.includes('b') && all.includes('c'), 'should include all ids');
});

check('query(type) returns entities with that component', () => {
  const w = createWorld();
  const a = w.createEntity('a');
  const b = w.createEntity('b');
  w.addComponent(a, 'position', { x: 0, y: 0 });
  w.addComponent(b, 'velocity', { x: 1, y: 0 });
  const posEntities = w.query('position');
  assert(posEntities.length === 1, 'should return 1 entity with position');
  assert(posEntities[0] === 'a', 'should be entity a');
});

check('query(type1, type2) returns entities with both components', () => {
  const w = createWorld();
  const a = w.createEntity('a');
  const b = w.createEntity('b');
  w.addComponent(a, 'position', { x: 0, y: 0 });
  w.addComponent(a, 'velocity', { x: 1, y: 0 });
  w.addComponent(b, 'position', { x: 5, y: 5 });
  const movers = w.query('position', 'velocity');
  assert(movers.length === 1, 'should return 1 entity with both');
  assert(movers[0] === 'a', 'should be entity a');
});

// 5. Systems
check('addSystem and step execute systems', () => {
  const w = createWorld();
  let called = false;
  w.addSystem((world, dt) => { called = true; }, 0);
  w.step(0.016);
  assert(called === true, 'system should be called');
});

check('system receives dt parameter', () => {
  const w = createWorld();
  let receivedDt = null;
  w.addSystem((world, dt) => { receivedDt = dt; }, 0);
  w.step(0.016);
  assert(receivedDt === 0.016, 'system should receive dt');
});

check('removeSystem prevents execution', () => {
  const w = createWorld();
  let count = 0;
  const fn = (world, dt) => { count++; };
  w.addSystem(fn, 0);
  w.step(0.016);
  assert(count === 1, 'system should execute once');
  assert(w.removeSystem(fn) === true, 'removeSystem should return true');
  w.step(0.016);
  assert(count === 1, 'system should not execute after removal');
});

check('removeSystem returns false for unknown system', () => {
  const w = createWorld();
  const fn = () => {};
  assert(w.removeSystem(fn) === false, 'removeSystem should return false');
});

// 6. Serialize/deserialize round-trip
check('serialize/deserialize round-trip preserves entities and components', () => {
  const w = createWorld();
  const a = w.createEntity('a');
  const b = w.createEntity('b');
  w.addComponent(a, 'position', { x: 10, y: 20 });
  w.addComponent(b, 'health', 100);

  const data = w.serialize();
  assert(data.schemaVersion === 1, 'schemaVersion should be 1');
  assert(data.entities.length === 2, 'should serialize 2 entities');
  assert(data.entities.includes('a') && data.entities.includes('b'), 'should include entity ids');
  assert(data.components.position !== undefined, 'should have position component');
  assert(data.components.health !== undefined, 'should have health component');

  const w2 = createWorld();
  w2.deserialize(data);
  assert(w2.entityCount === 2, 'deserialized world should have 2 entities');
  assert(w2.hasComponent('a', 'position'), 'entity a should have position');
  assert(w2.getComponent('a', 'position').x === 10, 'position data should survive');
  assert(w2.getComponent('b', 'health') === 100, 'health data should survive');
});

// 7. Game simulation (ECS snake logic)
check('ECS snake game logic: create snake, move, eat food', () => {
  const w = createWorld();

  // Create snake segments
  const head = w.createEntity('head');
  w.addComponent(head, 'position', { x: 10, y: 10 });
  w.addComponent(head, 'snakeSegment', { index: 0 });
  w.addComponent(head, 'head', true);

  const body = w.createEntity('body');
  w.addComponent(body, 'position', { x: 9, y: 10 });
  w.addComponent(body, 'snakeSegment', { index: 1 });

  // Create food
  const food = w.createEntity('food');
  w.addComponent(food, 'position', { x: 11, y: 10 });
  w.addComponent(food, 'food', {});

  // Verify initial state
  assert(w.entityCount === 3, 'should have 3 entities');
  const heads = w.query('head');
  assert(heads.length === 1, 'should have 1 head');
  assert(heads[0] === 'head', 'head entity should be head');

  const foods = w.query('food');
  assert(foods.length === 1, 'should have 1 food');

  // Simulate moving right and eating food: head moves to (11,10) which is food position
  w.destroyEntity('head'); // Remove old head
  w.destroyEntity('food'); // Remove eaten food

  const newHead = w.createEntity('newHead');
  w.addComponent(newHead, 'position', { x: 11, y: 10 });
  w.addComponent(newHead, 'snakeSegment', { index: 0 });
  w.addComponent(newHead, 'head', true);

  assert(w.entityCount === 2, 'should have 2 entities after eating (head + body, food removed)');
  assert(w.query('food').length === 0, 'food should be gone');
  assert(w.query('head').length === 1, 'should still have 1 head');
});

// 8. Entity id stability (string IDs survive round-trip)
check('entity string IDs are stable through adapter', () => {
  const w = createWorld();
  const id = w.createEntity('myEntity');
  assert(id === 'myEntity', 'createEntity should return the string id');
  assert(w.entityCount === 1, 'entityCount should reflect string id entity');
  const all = w.query();
  assert(all.length === 1 && all[0] === 'myEntity', 'query should return string ids');
});

// 9. System ordering (priority)
check('systems execute in priority order', () => {
  const w = createWorld();
  const order = [];
  w.addSystem(() => { order.push('B'); }, 10);
  w.addSystem(() => { order.push('A'); }, 5);
  w.addSystem(() => { order.push('C'); }, 15);
  w.step(0.016);
  assert(order.join(',') === 'A,B,C', 'systems should execute in priority order');
});

// 10. Multiple worlds are independent
check('multiple worlds are independent', () => {
  const w1 = createWorld();
  const w2 = createWorld();
  w1.createEntity('e1');
  w2.createEntity('e2');
  assert(w1.entityCount === 1, 'w1 should have 1 entity');
  assert(w2.entityCount === 1, 'w2 should have 1 entity');
  assert(w1.query().includes('e1'), 'w1 should have e1');
  assert(w2.query().includes('e2'), 'w2 should have e2');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);