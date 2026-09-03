#!/usr/bin/env node
// Merged camera spec (t11-witness-merge): combines witness-camera-gestures.mjs,
// witness-camera-input.mjs, witness-camera-persist.mjs, and
// witness-desktop-camera.mjs into one runnable probe with 4 independent
// cases. Each case boots its own isolated browser/page (same lifecycle each
// original script used) so a hang/crash in one case can't corrupt another's
// state -- only the process, report-shape, and file are merged, not the
// test isolation. witness-all.mjs discovers this file by its witness-*.mjs
// glob exactly as it discovered the 4 originals; results are exposed under
// case-prefixed keys (e.g. "gestures.shiftWheelZoomedIn") so nothing is lost
// from the flattened 40->~15 script count.
import { bootBrowser, sleep, assert, printReportAndExit } from './witness-lib.mjs';

// --- case: gestures (was witness-camera-gestures.mjs) ---
// Real shift+wheel zoom, ctrl+wheel pinch, and window drag tracks the cursor
// 1:1 under scale != 1 (the canvas-aware drag math).
async function caseGestures() {
  const { browser, page, errs } = await bootBrowser({ tag: 'cg' });
  const out = {};
  try {
    for (let i = 0; i < 60; i++) { const ok = await page.evaluate(() => !!(window.__debug?.desktopCamera && document.querySelector('.wm-win'))); if (ok) break; await sleep(1000); }

    await page.evaluate(() => window.__debug.desktopCamera.reset());

    const s0 = await page.evaluate(() => window.__debug.desktopCamera.scale);
    await page.evaluate(() => {
      const root = document.getElementById('wm-root');
      const r = root.getBoundingClientRect();
      root.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, shiftKey: true, bubbles: true, cancelable: true, clientX: r.left + 50, clientY: r.top + 50 }));
    });
    await new Promise(r => setTimeout(r, 80));
    const s1 = await page.evaluate(() => window.__debug.desktopCamera.scale);

    await page.evaluate(() => {
      const root = document.getElementById('wm-root'); const r = root.getBoundingClientRect();
      root.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, ctrlKey: true, bubbles: true, cancelable: true, clientX: r.left + 50, clientY: r.top + 50 }));
    });
    await new Promise(r => setTimeout(r, 80));
    const s2 = await page.evaluate(() => window.__debug.desktopCamera.scale);

    const drag = await page.evaluate(async () => {
      const cam = window.__debug.desktopCamera; cam.reset(); cam.zoomAt(1.5, 0, 0);
      await new Promise(r => setTimeout(r, 30));
      const win = document.querySelector('.wm-win');
      const bar = win.querySelector('.wm-bar');
      const b0 = win.getBoundingClientRect();
      const start = { x: b0.left + 40, y: b0.top + 8 };
      const send = (type, x, y, btns) => bar.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, button: 0, buttons: btns, bubbles: true, cancelable: true }));
      send('pointerdown', start.x, start.y, 1);
      const docSend = (type, x, y, btns) => document.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, button: 0, buttons: btns, bubbles: true }));
      docSend('pointermove', start.x + 100, start.y + 60, 1);
      await new Promise(r => setTimeout(r, 40));
      docSend('pointerup', start.x + 100, start.y + 60, 0);
      const b1 = win.getBoundingClientRect();
      return { scale: cam.scale, dxScreen: Math.round(b1.left - b0.left), dyScreen: Math.round(b1.top - b0.top) };
    });

    console.log('[gestures] shiftWheel:', { before: s0, afterZoomIn: s1, afterPinchOut: s2, zoomedIn: s1 > s0, pinchChanged: s2 !== s1 });
    console.log('[gestures] dragUnderScale:', JSON.stringify(drag), ' (expect dxScreen~100 dyScreen~60 since drag tracks cursor 1:1)');
    console.log('[gestures] ERRS:', errs.slice(0, 6));

    assert(out, 'shiftWheelZoomedIn', s1 > s0, 'shift+wheel did not zoom in: before=' + s0 + ' after=' + s1);
    assert(out, 'ctrlWheelPinchChanged', s2 !== s1, 'ctrl+wheel pinch did not change scale: ' + s1 + ' -> ' + s2);
    out.dragUnderScale = drag;
    assert(out, 'dragTracksCursorX', Math.abs(drag.dxScreen - 100) < 12, 'drag dx not ~100px at scale ' + drag.scale + ': got ' + drag.dxScreen);
    assert(out, 'dragTracksCursorY', Math.abs(drag.dyScreen - 60) < 12, 'drag dy not ~60px at scale ' + drag.scale + ': got ' + drag.dyScreen);
    out.errors = errs.slice(0, 6);
  } finally {
    await browser.close();
  }
  return out;
}

// --- case: input (was witness-camera-input.mjs) ---
// Gestures fire over EMPTY DESKTOP (.wm-root has pointer-events:none so
// listeners must be on window), plain wheel pans, ctrl+wheel pinch-zooms, and
// wheel OVER A WINDOW is left alone (window content scrolls instead).
async function caseInput() {
  const { browser, page, errs } = await bootBrowser({ tag: 'ci', settleMs: 10000 });
  const out = {};
  try {
    for (let i = 0; i < 60; i++) { const ok = await page.evaluate(() => !!(window.__debug?.desktopCamera && document.querySelector('.wm-win'))); if (ok) break; await sleep(1000); }

    const r = await page.evaluate(async () => {
      const cam = window.__debug.desktopCamera;
      const res = {};
      const EX = 80, EY = 840;
      const emptyEl = document.elementFromPoint(EX, EY);
      res.emptySpotNotWindow = !(emptyEl && emptyEl.closest && emptyEl.closest('.wm-win'));

      cam.reset();
      const pan0 = { ...cam.pan };
      window.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, deltaY: 30, clientX: EX, clientY: EY, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 40));
      res.plainWheelPanned = (cam.pan.x !== pan0.x || cam.pan.y !== pan0.y);
      res.panDir = { dx: Math.round(cam.pan.x - pan0.x), dy: Math.round(cam.pan.y - pan0.y) };

      cam.reset();
      const s0 = cam.scale;
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, clientX: EX, clientY: EY, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 40));
      res.ctrlWheelZoomed = cam.scale > s0;

      cam.reset();
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, shiftKey: true, clientX: EX, clientY: EY, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 40));
      res.shiftWheelZoomed = cam.scale > 1;

      // desktop-camera.js deliberately keeps panning over a window for 250ms
      // after the last pinch tick; the ctrl-wheel test above set that timer,
      // so this waits it out first.
      await new Promise(r => setTimeout(r, 300));
      cam.reset();
      const fwin = document.querySelector('.wm-win');
      const fr = fwin.getBoundingClientRect();
      const wx = Math.round(fr.x + fr.width / 2), wy = Math.round(fr.y + fr.height / 2);
      const panBeforeWin = { ...cam.pan };
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, clientX: wx, clientY: wy, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 40));
      res.wheelOverWindowLeftAlone = (cam.pan.x === panBeforeWin.x && cam.pan.y === panBeforeWin.y);

      cam.reset();
      return res;
    });
    console.log('[input] CAMERA-INPUT:', JSON.stringify(r, null, 2));
    console.log('[input] ERRS:', errs.slice(0, 6));

    out.raw = r;
    assert(out, 'emptySpotNotWindow', r.emptySpotNotWindow, 'probe point unexpectedly landed inside a window');
    assert(out, 'plainWheelPanned', r.plainWheelPanned, 'plain wheel over empty desktop did not pan: ' + JSON.stringify(r.panDir));
    assert(out, 'ctrlWheelZoomed', r.ctrlWheelZoomed, 'ctrl+wheel over empty desktop did not zoom');
    assert(out, 'shiftWheelZoomed', r.shiftWheelZoomed, 'shift+wheel did not zoom');
    assert(out, 'wheelOverWindowLeftAlone', r.wheelOverWindowLeftAlone, 'plain wheel over a window incorrectly panned the desktop');
    out.errors = errs.slice(0, 6);
  } finally {
    await browser.close();
  }
  return out;
}

// --- case: persist (was witness-camera-persist.mjs) ---
// Fit-to-windows recovery, and per-instance camera re-frame on switch.
async function casePersist() {
  const { browser, page, errs } = await bootBrowser({ tag: 'cp', settleMs: 10000 });
  const out = {};
  try {
    for (let i = 0; i < 60; i++) { const ok = await page.evaluate(() => !!(window.__debug?.desktopCamera && window.__debug?.shell && document.querySelector('.wm-win'))); if (ok) break; await sleep(1000); }

    const fit = await page.evaluate(async () => {
      const cam = window.__debug.desktopCamera, wm = window.__debug.wm;
      cam.reset(); cam.panBy(-3000, -2000);
      await new Promise(r => setTimeout(r, 30));
      const win = document.querySelector('.wm-win');
      const offBefore = win.getBoundingClientRect();
      const offscreen = offBefore.right < 0 || offBefore.bottom < 0 || offBefore.left > innerWidth;
      wm.fitToWindows();
      await new Promise(r => setTimeout(r, 50));
      const onAfter = win.getBoundingClientRect();
      const onscreen = onAfter.right > 0 && onAfter.bottom > 0 && onAfter.left < innerWidth && onAfter.top < innerHeight;
      return { offscreenBeforeFit: offscreen, onscreenAfterFit: onscreen, scale: cam.scale };
    });

    const perInst = await page.evaluate(async () => {
      const api = window.__debug.shell, cam = window.__debug.desktopCamera;
      api.setActive && api.setActive('i1');
      cam.reset(); cam.zoomAt(2.0, 100, 100);
      const i1scale = cam.scale;
      let i2 = null;
      try { const inst = await api.newInstance(); i2 = inst.id; } catch (e) { return { err: 'newInstance: ' + e.message }; }
      await new Promise(r => setTimeout(r, 400));
      cam.reset(); cam.panBy(250, 150);
      const i2pan = cam.pan.x;
      api.setActive('i1');
      await new Promise(r => setTimeout(r, 200));
      const backToI1scale = cam.scale;
      api.setActive(i2);
      await new Promise(r => setTimeout(r, 200));
      const backToI2pan = cam.pan.x;
      return { i1scale, i2, i2pan, backToI1scale, backToI2pan, i1Reframed: Math.abs(backToI1scale - 2.0) < 0.2, i2Reframed: Math.abs(backToI2pan - 250) < 5 };
    });

    console.log('[persist] FIT-TO-WINDOWS:', JSON.stringify(fit));
    console.log('[persist] PER-INSTANCE:', JSON.stringify(perInst));
    console.log('[persist] ERRS:', errs.slice(0, 6));

    out.fit = fit;
    assert(out, 'offscreenBeforeFit', fit.offscreenBeforeFit, 'window was not actually off-screen after panBy setup');
    assert(out, 'onscreenAfterFit', fit.onscreenAfterFit, 'fitToWindows() did not bring the window back on-screen');
    out.perInstance = perInst;
    assert(out, 'perInstance.noError', !perInst.err, perInst.err || null);
    if (!perInst.err) {
      assert(out, 'i1Reframed', perInst.i1Reframed, 'switching back to instance 1 did not restore its camera scale: ' + JSON.stringify(perInst));
      assert(out, 'i2Reframed', perInst.i2Reframed, 'switching back to instance 2 did not restore its camera pan: ' + JSON.stringify(perInst));
    }
    out.errors = errs.slice(0, 6);
  } finally {
    await browser.close();
  }
  return out;
}

// --- case: canvas (was witness-desktop-camera.mjs) ---
// The infinite zoom/pan desktop surface: .wm-canvas carries the transform,
// windows live inside it, zoom is cursor-anchored, pan moves windows but not
// bars, and reset restores baseline.
async function caseCanvas() {
  const { browser, page, errs } = await bootBrowser({ tag: 'cam' });
  const out = {};
  try {
    for (let i = 0; i < 60; i++) { const ok = await page.evaluate(() => !!(window.__debug?.shell && document.querySelector('.wm-win') && window.__debug?.desktopCamera)); if (ok) break; await sleep(1000); }

    const r = await page.evaluate(async () => {
      const cam = window.__debug.desktopCamera;
      const res = {};
      res.canvasExists = !!document.querySelector('.wm-root > .wm-canvas');
      res.windowsInCanvas = document.querySelectorAll('.wm-canvas .wm-win').length;
      res.barsOutsideCanvas = !document.querySelector('.wm-canvas .os-menubar, .wm-canvas .os-taskbar');

      const canvas = cam.canvas;
      const transform0 = getComputedStyle(canvas).transform;

      const before = cam.screenToCanvas(400, 300);
      cam.zoomAt(1.5, 400, 300);
      res.scaleAfterZoom = cam.scale;
      const after = cam.screenToCanvas(400, 300);
      res.zoomAnchored = Math.abs(after.x - before.x) < 0.5 && Math.abs(after.y - before.y) < 0.5;

      const fwin = document.querySelector('.wm-win');
      const winBefore = fwin.getBoundingClientRect();
      const menubar = document.querySelector('.os-menubar');
      const barBefore = menubar ? menubar.getBoundingClientRect().top : null;
      cam.panBy(120, 60);
      await new Promise(r => setTimeout(r, 50));
      const winAfter = fwin.getBoundingClientRect();
      const barAfter = menubar ? menubar.getBoundingClientRect().top : null;
      res.windowPanned = Math.abs((winAfter.left - winBefore.left) - 120) < 2 && Math.abs((winAfter.top - winBefore.top) - 60) < 2;
      res.barsFixed = barBefore === barAfter;

      res.transformChanged = getComputedStyle(canvas).transform !== transform0;
      cam.reset();
      res.resetWorks = cam.scale === 1 && cam.pan.x === 0 && cam.pan.y === 0;
      return res;
    });
    console.log('[canvas] DESKTOP-CAMERA:', JSON.stringify(r, null, 2));
    console.log('[canvas] ERRS:', errs.slice(0, 6));

    assert(out, 'canvasExists', !!r.canvasExists, 'no .wm-root > .wm-canvas element found');
    assert(out, 'windowsInCanvas', r.windowsInCanvas > 0, 'no .wm-win elements found inside .wm-canvas');
    assert(out, 'barsOutsideCanvas', !!r.barsOutsideCanvas, 'menubar/taskbar found inside .wm-canvas (should be outside)');
    assert(out, 'zoomAnchored', !!r.zoomAnchored, 'zoomAt(1.5,400,300) did not keep the canvas point under the cursor stationary');
    assert(out, 'windowPanned', !!r.windowPanned, 'panBy(120,60) did not move the window by the expected delta');
    assert(out, 'barsFixed', !!r.barsFixed, 'menubar position moved during pan (should stay fixed)');
    assert(out, 'resetWorks', !!r.resetWorks, 'cam.reset() did not restore scale=1 and pan={0,0}');
    out.raw = r;
  } finally {
    await browser.close();
  }
  return out;
}

const cases = [
  ['gestures', caseGestures],
  ['input', caseInput],
  ['persist', casePersist],
  ['canvas', caseCanvas],
];

const report = {};
for (const [name, fn] of cases) {
  let caseReport;
  try {
    caseReport = await fn();
  } catch (e) {
    caseReport = { crashed: { pass: false, detail: String(e && e.stack || e).slice(0, 500) } };
  }
  for (const [k, v] of Object.entries(caseReport)) {
    report[`${name}.${k}`] = v;
  }
}
printReportAndExit(report);
