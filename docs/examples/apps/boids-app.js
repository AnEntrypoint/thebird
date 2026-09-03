// boids-app.js — flocking simulation toy (separation + alignment + cohesion).
// Migrated to use the ECS adapter (lib/ecs.js, backed by @spoint/ecs) for boid
// entities instead of a plain array. Each boid is an ECS entity with 'position'
// and 'velocity' components; the flocking algorithm runs as a registered system.
//
// First slice of cross-project-ecs-thebird-migrate-remaining-apps:
// "migrate boids-app.js to use ECS for boid entities."

import { createWorld } from '../../lib/ecs.js';
import { el, resolveInstance } from '../../apps.js';

const POSITION = 'position';
const VELOCITY = 'velocity';

export function boidsApp(ctx) {
    const instance = resolveInstance(ctx);
    const node = el('div', 'app-pane');
    node.dataset.component = 'boids-app';

    const head = el('div', null, 'boids (ECS) · ' + instance.id);
    const sub = el('div', 'meta', 'flocking simulation — separation + alignment + cohesion');
    node.append(head, sub);

    const cv = document.createElement('canvas');
    cv.className = 'app-canvas';
    node.appendChild(cv);

    const ctx2d = cv.getContext('2d');
    const N = 120;
    let world = createWorld();
    let raf = null;
    let running = true;
    let lastTime = performance.now();

    const rand = (a, b) => a + Math.random() * (b - a);

    function seed(w, h) {
        world = createWorld();
        for (let i = 0; i < N; i++) {
            const id = world.createEntity();
            world.addComponent(id, POSITION, { x: rand(0, w), y: rand(0, h) });
            world.addComponent(id, VELOCITY, { x: rand(-1, 1), y: rand(-1, 1) });
        }
    }

    function resize() {
        const w = Math.max(1, node.clientWidth || (cv.parentElement && cv.parentElement.clientWidth) || 320);
        const h = Math.max(80, (node.clientHeight || 240) - head.offsetHeight - sub.offsetHeight - 8);
        const dpr = window.devicePixelRatio || 1;
        cv.width = Math.floor(w * dpr);
        cv.height = Math.floor(h * dpr);
        cv.style.width = w + 'px';
        cv.style.height = h + 'px';
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (world.entityCount === 0) seed(w, h);
    }

    const ro = new ResizeObserver(() => resize());
    ro.observe(node);
    resize();

    const PERCEPTION = 50;
    const MAX_SPEED = 2.6;

    // Flocking system: separation + alignment + cohesion, registered as an ECS
    // system so it runs on every world.step(dt) call.
    world.addSystem(function flockingSystem(w, dt) {
        const wPx = cv.width / (window.devicePixelRatio || 1);
        const hPx = cv.height / (window.devicePixelRatio || 1);

        // Collect all boid entities (those with both position and velocity)
        const boidIds = w.query(POSITION, VELOCITY);
        if (boidIds.length === 0) return;

        // Pre-fetch all positions and velocities for O(n^2) flocking
        const positions = new Map();
        const velocities = new Map();
        for (const id of boidIds) {
            positions.set(id, w.getComponent(id, POSITION));
            velocities.set(id, w.getComponent(id, VELOCITY));
        }

        // Compute flocking forces for each boid
        for (const id of boidIds) {
            const b = positions.get(id);
            const bv = velocities.get(id);
            let sepX = 0, sepY = 0, aliX = 0, aliY = 0, cohX = 0, cohY = 0, count = 0;

            for (const oid of boidIds) {
                if (oid === id) continue;
                const o = positions.get(oid);
                const dx = b.x - o.x, dy = b.y - o.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < PERCEPTION * PERCEPTION && d2 > 0) {
                    count++;
                    if (d2 < 400) { sepX += dx / d2; sepY += dy / d2; }
                    aliX += velocities.get(oid).x; aliY += velocities.get(oid).y;
                    cohX += o.x; cohY += o.y;
                }
            }

            if (count > 0) {
                aliX /= count; aliY /= count;
                cohX = cohX / count - b.x; cohY = cohY / count - b.y;
                bv.x += sepX * 0.06 + aliX * 0.05 + cohX * 0.0006;
                bv.y += sepY * 0.06 + aliY * 0.05 + cohY * 0.0006;
            }

            const sp = Math.hypot(bv.x, bv.y) || 1;
            if (sp > MAX_SPEED) { bv.x = (bv.x / sp) * MAX_SPEED; bv.y = (bv.y / sp) * MAX_SPEED; }

            b.x += bv.x; b.y += bv.y;
            if (b.x < 0) b.x += wPx; if (b.x > wPx) b.x -= wPx;
            if (b.y < 0) b.y += hPx; if (b.y > hPx) b.y -= hPx;

            // Write back updated components
            w.addComponent(id, POSITION, b);
            w.addComponent(id, VELOCITY, bv);
        }
    }, 0);

    function step(now) {
        if (!running) { raf = null; return; }
        const dt = Math.min((now - lastTime) / 1000, 0.1); // cap dt to avoid spiral of death
        lastTime = now;
        world.step(dt);

        const wPx = cv.width / (window.devicePixelRatio || 1);
        const hPx = cv.height / (window.devicePixelRatio || 1);
        ctx2d.clearRect(0, 0, wPx, hPx);
        ctx2d.fillStyle = 'rgba(36,116,32,0.85)';

        for (const id of world.query(POSITION, VELOCITY)) {
            const pos = world.getComponent(id, POSITION);
            const vel = world.getComponent(id, VELOCITY);
            if (!pos || !vel) continue;
            const ang = Math.atan2(vel.y, vel.x);
            ctx2d.save();
            ctx2d.translate(pos.x, pos.y);
            ctx2d.rotate(ang);
            ctx2d.beginPath();
            ctx2d.moveTo(5, 0);
            ctx2d.lineTo(-4, 3);
            ctx2d.lineTo(-4, -3);
            ctx2d.closePath();
            ctx2d.fill();
            ctx2d.restore();
        }

        if (running) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);

    const onVis = () => {
        running = document.visibilityState === 'visible';
        if (running && !raf) {
            lastTime = performance.now();
            raf = requestAnimationFrame(step);
        }
    };
    document.addEventListener('visibilitychange', onVis);

    return {
        node,
        dispose: () => {
            running = false;
            if (raf) cancelAnimationFrame(raf);
            ro.disconnect();
            document.removeEventListener('visibilitychange', onVis);
        },
        // Test hook: expose the world for witness scripts
        __debug: { get world() { return world; }, get entityCount() { return world.entityCount; } },
    };
}