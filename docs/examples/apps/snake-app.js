// Classic snake game, canvas-rendered, no CSS (contract: thebird ships zero
// design CSS — plain canvas sized via JS attrs only). High score persisted
// per-instance via instance.fs.readJson/writeJson (simple scalar state — a
// full xstate actor would be overkill for a single high-score number, see
// AGENTS.md xstate-everywhere note: "instance.fs read/write if a full xstate
// actor is overkill for just a high-score number").

import { t } from '../../vendor/i18n.js';

const HS_PATH = '/etc/snake/highscore.json';
const GRID = 20;       // cells per side
const CELL = 16;       // px per cell
const TICK_MS = 120;

export function createSnakeApp({ instance }) {
    const node = document.createElement('div');
    node.className = 'app-pane';
    node.dataset.component = 'snake-app';
    node.tabIndex = 0; // focusable so keydown reaches it without a click first

    const head = document.createElement('div');
    head.textContent = t('snake.titlePrefix', 'snake · ') + (instance ? instance.id : '');
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

    node.append(head, status, cv, hint);

    const ctx = cv.getContext('2d');

    let highScore = 0;
    let saveError = null; // set by a failed saveHighScore(); read by updateStatus() so the
                           // warning survives the updateStatus() call that always runs right
                           // after saveHighScore() in step() (it would otherwise immediately
                           // clobber a message written straight to status.textContent).
    try {
        const saved = instance && instance.fs && instance.fs.readJson ? instance.fs.readJson(HS_PATH, null) : null;
        if (saved && typeof saved.highScore === 'number') highScore = saved.highScore;
    } catch { /* swallow: no saved high score yet (first run) or fs read failed, start from 0 */ }

    function saveHighScore() {
        // Mirrors notes-app.js: writeJson only debounces to IDB after 250ms, so
        // an immediate flush() is required here or a high score set right before
        // the window closes (dispose() only clears the tick timer, it does not
        // flush) would be silently lost.
        try {
            if (instance && instance.fs && instance.fs.writeJson) instance.fs.writeJson(HS_PATH, { highScore });
            if (instance && instance.fs && instance.fs.flush) instance.fs.flush();
            saveError = null;
        } catch (e) {
            // A failed high-score persist must not vanish silently -- the score
            // itself already updated in memory, so failing here means the record
            // will NOT survive a reload though the player believes it did.
            // Surface it the same way notes-app.js surfaces a save failure.
            saveError = (e && e.message) || String(e);
        }
    }

    let snake, dir, nextDir, food, score, alive, timer, started;

    function place() {
        while (true) {
            const p = { x: (Math.random() * GRID) | 0, y: (Math.random() * GRID) | 0 };
            if (!snake.some(s => s.x === p.x && s.y === p.y)) return p;
        }
    }

    function reset() {
        snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
        dir = { x: 1, y: 0 };
        nextDir = dir;
        score = 0;
        alive = true;
        // The board is never moving the instant the app mounts -- step() is a
        // no-op (see below) until the player presses a direction key. Without
        // this, the snake starts sliding toward the wall it's already closest
        // to (~1.2s at TICK_MS=120 from x=10 to the x=20 wall) with zero input
        // from the player, so any real-world startup lag between mount and the
        // player actually looking at the window (window-open animation, focus
        // delay, a slow paint, or the browser's main thread still busy with an
        // unrelated heavy boot task) silently burns through that window and the
        // player's first real frame is already "GAME OVER (space to restart)"
        // -- indistinguishable from the game never having started at all. This
        // was reported live: the app opened straight into a red board, score 0.
        started = false;
        saveError = null;
        food = place();
        updateStatus();
        draw();
    }

    function updateStatus() {
        status.textContent = t('snake.scoreLabel', 'score: ') + score + t('snake.highScoreLabel', '  ·  high score: ') + highScore
            + (alive && !started ? t('snake.readyLabel', '  ·  press a direction key to start') : '')
            + (alive ? '' : t('snake.gameOver', '  ·  GAME OVER (space to restart)'))
            + (saveError ? t('snake.saveFailedLabel', '  ·  (high score save failed: ') + saveError + ')' : '');
    }

    function step() {
        if (!alive || !started) return;
        dir = nextDir;
        const head0 = snake[0];
        const nh = { x: head0.x + dir.x, y: head0.y + dir.y };
        const hitWall = nh.x < 0 || nh.y < 0 || nh.x >= GRID || nh.y >= GRID;
        const hitSelf = snake.some(s => s.x === nh.x && s.y === nh.y);
        if (hitWall || hitSelf) {
            alive = false;
            if (score > highScore) { highScore = score; saveHighScore(); }
            updateStatus();
            draw();
            return;
        }
        snake.unshift(nh);
        if (nh.x === food.x && nh.y === food.y) {
            score += 1;
            food = place();
            if (score > highScore) { highScore = score; saveHighScore(); }
        } else {
            snake.pop();
        }
        updateStatus();
        draw();
    }

    function draw() {
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = alive ? '#1a1a1a' : '#301010';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = '#e05050';
        ctx.fillRect(food.x * CELL, food.y * CELL, CELL - 1, CELL - 1);
        for (let i = 0; i < snake.length; i++) {
            ctx.fillStyle = i === 0 ? '#60d060' : '#308030';
            ctx.fillRect(snake[i].x * CELL, snake[i].y * CELL, CELL - 1, CELL - 1);
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
        // Disallow reversing directly into the body. Checked against nextDir
        // (the already-queued heading), not dir (the last-committed heading):
        // multiple keydowns can arrive within one tick window, and comparing
        // against the stale dir lets a second keypress compose into a true
        // 180 relative to the first queued turn (see snake-app-double-turn-
        // reversal finding).
        if (snake.length > 1 && d.x === -nextDir.x && d.y === -nextDir.y) return;
        nextDir = d;
        started = true; // first direction key actually sets the game in motion
        e.preventDefault();
    }

    node.addEventListener('keydown', onKeydown);
    node.addEventListener('click', () => node.focus());

    // Pause the tick while the tab/window is hidden: without this the game
    // keeps simulating (and can run into a wall and end) entirely off-screen,
    // so the player returns to an already-game-over board with no warning.
    function onVisibilityChange() {
        if (document.visibilityState === 'hidden') {
            if (timer) { clearInterval(timer); timer = null; }
        } else if (!timer) {
            timer = setInterval(step, TICK_MS);
        }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    reset();
    timer = document.visibilityState === 'hidden' ? null : setInterval(step, TICK_MS);
    // Focus on next tick so the window is mounted first.
    setTimeout(() => { try { node.focus(); } catch { /* swallow: node may already be unmounted (window closed before this tick), focus is best-effort */ } }, 0);

    return {
        node,
        dispose: () => { clearInterval(timer); node.removeEventListener('keydown', onKeydown); document.removeEventListener('visibilitychange', onVisibilityChange); },
        getViewState: () => ({ highScore }),
        restoreViewState: (s) => { if (s && typeof s.highScore === 'number' && s.highScore > highScore) { highScore = s.highScore; updateStatus(); } },
        // Test hook for the browser-witness verb: expose minimal state.
        __debug: { get score() { return score; }, get alive() { return alive; }, get highScore() { return highScore; }, get started() { return started; }, step, reset },
    };
}
