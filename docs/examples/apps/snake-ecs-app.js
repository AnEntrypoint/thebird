// snake-ecs-app.js — ECS-powered snake game using the shared @spoint/ecs
// via thebird's lib/ecs.js adapter. Demonstrates the adapter working end-to-end:
// createWorld, createEntity, addComponent, query, addSystem, step, serialize/deserialize.
//
// This is the FIRST SLICE of cross-project-ecs-thebird-adopt-shared-package:
// "replace one thebird game app's ecs.js import with @spoint/ecs and verify it works."

import { createWorld } from '../../lib/ecs.js';
import { t } from '../../vendor/i18n.js';

const HS_PATH = '/etc/snake-ecs/highscore.json';
const GRID = 20;
const CELL = 16;
const TICK_MS = 120;

// Component types
const POSITION = 'position';
const SNAKE_SEGMENT = 'snakeSegment';
const FOOD = 'food';
const HEAD = 'head';

export function createSnakeEcsApp({ instance }) {
  const node = document.createElement('div');
  node.className = 'app-pane';
  node.dataset.component = 'snake-ecs-app';
  node.tabIndex = 0;

  const headEl = document.createElement('div');
  headEl.textContent = t('snakeEcs.titlePrefix', 'snake (ECS) · ') + (instance ? instance.id : '');
  const status = document.createElement('div');
  status.className = 'meta';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const cv = document.createElement('canvas');
  cv.width = GRID * CELL;
  cv.height = GRID * CELL;
  cv.className = 'app-canvas';

  const hint = document.createElement('div');
  hint.className = 'meta';
  hint.textContent = t('snake.hint', 'arrow keys / WASD to move · space to restart');

  node.append(headEl, status, cv, hint);

  const ctx2d = cv.getContext('2d');

  // --- ECS world ---
  let world = createWorld();
  let dir = { x: 1, y: 0 };
  let nextDir = { x: 1, y: 0 };
  let score = 0;
  let alive = true;
  let highScore = 0;
  let saveError = null;
  let timer = null;
  let segmentOrder = []; // head-first ordered list of segment entity ids; single source of truth for tail removal

  try {
    const saved = instance && instance.fs && instance.fs.readJson ? instance.fs.readJson(HS_PATH, null) : null;
    if (saved && typeof saved.highScore === 'number') highScore = saved.highScore;
  } catch { /* first run */ }

  function saveHighScore() {
    try {
      if (instance && instance.fs && instance.fs.writeJson) instance.fs.writeJson(HS_PATH, { highScore });
      if (instance && instance.fs && instance.fs.flush) instance.fs.flush();
      saveError = null;
    } catch (e) {
      saveError = (e && e.message) || String(e);
    }
  }

  function placeFood() {
    // Get all occupied positions from snake segments
    const occupied = new Set();
    for (const id of world.query(POSITION, SNAKE_SEGMENT)) {
      const p = world.getComponent(id, POSITION);
      if (p) occupied.add(p.x + ',' + p.y);
    }
    while (true) {
      const x = (Math.random() * GRID) | 0;
      const y = (Math.random() * GRID) | 0;
      if (!occupied.has(x + ',' + y)) {
        return { x, y };
      }
    }
  }

  function spawnSnake() {
    const segments = [
      { x: 10, y: 10 },
      { x: 9, y: 10 },
      { x: 8, y: 10 },
    ];
    segmentOrder = [];
    for (let i = 0; i < segments.length; i++) {
      const id = world.createEntity();
      world.addComponent(id, POSITION, { x: segments[i].x, y: segments[i].y });
      world.addComponent(id, SNAKE_SEGMENT, { index: i });
      if (i === 0) {
        world.addComponent(id, HEAD, true);
      }
      segmentOrder.push(id);
    }
  }

  function spawnFood() {
    const p = placeFood();
    const id = world.createEntity();
    world.addComponent(id, POSITION, p);
    world.addComponent(id, FOOD, {});
    return id;
  }

  function reset() {
    world = createWorld();
    dir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    score = 0;
    alive = true;
    saveError = null;
    spawnSnake();
    spawnFood();
    updateStatus();
    draw();
  }

  // --- ECS Systems ---

  // Movement system: called every tick
  world.addSystem(function movementSystem(w, dt) {
    if (!alive) return;

    dir = nextDir;

    // Find the head entity
    const headEntities = w.query(HEAD, POSITION, SNAKE_SEGMENT);
    if (headEntities.length === 0) return;
    const headId = headEntities[0];
    const headPos = w.getComponent(headId, POSITION);

    const nh = { x: headPos.x + dir.x, y: headPos.y + dir.y };
    const hitWall = nh.x < 0 || nh.y < 0 || nh.x >= GRID || nh.y >= GRID;

    // Check self-collision using ECS query
    let hitSelf = false;
    for (const id of w.query(POSITION, SNAKE_SEGMENT)) {
      const p = w.getComponent(id, POSITION);
      if (p && p.x === nh.x && p.y === nh.y) {
        hitSelf = true;
        break;
      }
    }

    if (hitWall || hitSelf) {
      alive = false;
      if (score > highScore) { highScore = score; saveHighScore(); }
      updateStatus();
      draw();
      return;
    }

    // Move head: create new head entity
    const newHeadId = w.createEntity();
    w.addComponent(newHeadId, POSITION, { x: nh.x, y: nh.y });
    w.addComponent(newHeadId, SNAKE_SEGMENT, { index: 0 });
    w.addComponent(newHeadId, HEAD, true);
    segmentOrder.unshift(newHeadId);

    // Remove HEAD tag from old head, keep it as a body segment
    w.removeComponent(headId, HEAD);

    // Check if food is eaten
    const foodEntities = w.query(FOOD, POSITION);
    let ate = false;
    for (const foodId of foodEntities) {
      const fp = w.getComponent(foodId, POSITION);
      if (fp && fp.x === nh.x && fp.y === nh.y) {
        // Eat food
        w.destroyEntity(foodId);
        score += 1;
        if (score > highScore) { highScore = score; saveHighScore(); }
        spawnFood();
        ate = true;
        break;
      }
    }

    if (!ate) {
      // Remove tail: true tail is the last entry of the explicit head-first order,
      // not a max-index scan (SNAKE_SEGMENT.index is never renumbered after removals
      // so it can tie or point at a non-tail segment after enough grow/shrink cycles).
      const tailId = segmentOrder.pop();
      if (tailId != null) {
        w.destroyEntity(tailId);
      }
    }

    updateStatus();
    draw();
  }, 0);

  function updateStatus() {
    status.textContent = t('snake.scoreLabel', 'score: ') + score + t('snake.highScoreLabel', '  ·  high score: ') + highScore
      + (alive ? '' : t('snake.gameOver', '  ·  GAME OVER (space to restart)'))
      + (saveError ? t('snake.saveFailedLabel', '  ·  (high score save failed: ') + saveError + ')' : '');
  }

  function draw() {
    ctx2d.clearRect(0, 0, cv.width, cv.height);
    ctx2d.fillStyle = alive ? '#1a1a1a' : '#301010';
    ctx2d.fillRect(0, 0, cv.width, cv.height);

    // Draw food
    for (const id of world.query(FOOD, POSITION)) {
      const p = world.getComponent(id, POSITION);
      if (p) {
        ctx2d.fillStyle = '#e05050';
        ctx2d.fillRect(p.x * CELL, p.y * CELL, CELL - 1, CELL - 1);
      }
    }

    // Draw snake segments
    for (const id of world.query(POSITION, SNAKE_SEGMENT)) {
      const p = world.getComponent(id, POSITION);
      const isHead = world.hasComponent(id, HEAD);
      ctx2d.fillStyle = isHead ? '#60d060' : '#308030';
      if (p) {
        ctx2d.fillRect(p.x * CELL, p.y * CELL, CELL - 1, CELL - 1);
      }
    }
  }

  const KEYMAP = {
    ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 }, W: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 }, S: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, A: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 }, D: { x: 1, y: 0 },
  };

  function onKeydown(e) {
    if (e.key === ' ' || e.code === 'Space') {
      if (!alive) reset();
      e.preventDefault();
      return;
    }
    const d = KEYMAP[e.key];
    if (!d) return;
    if (d.x === -nextDir.x && d.y === -nextDir.y) return;
    nextDir = d;
    e.preventDefault();
  }

  node.addEventListener('keydown', onKeydown);
  node.addEventListener('click', () => node.focus());

  // Pause the tick while the tab/window is hidden so a backgrounded game
  // doesn't keep simulating (and potentially end) off-screen unnoticed.
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      if (timer) { clearInterval(timer); timer = null; }
    } else if (!timer) {
      timer = setInterval(() => world.step(TICK_MS / 1000), TICK_MS);
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  reset();
  timer = setInterval(() => world.step(TICK_MS / 1000), TICK_MS);
  setTimeout(() => { try { node.focus(); } catch { /* swallow */ } }, 0);

  return {
    node,
    dispose: () => { clearInterval(timer); node.removeEventListener('keydown', onKeydown); document.removeEventListener('visibilitychange', onVisibilityChange); },
    getViewState: () => ({ highScore }),
    restoreViewState: (s) => { if (s && typeof s.highScore === 'number' && s.highScore > highScore) { highScore = s.highScore; updateStatus(); } },
    __debug: { get score() { return score; }, get alive() { return alive; }, get highScore() { return highScore; }, reset, get world() { return world; } },
  };
}