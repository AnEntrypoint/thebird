// game-player-app.js — generic "game player" shell: opens ANY saved
// level-editor scene-graph JSON from the per-instance fs and RUNS it via
// level-editor-app.js's extracted runScenePlaytest() runner. This is the
// "last one-time source edit" the PRD row asks for — after game-player is
// registered once in apps.js's createAppRegistry, any future user-authored
// scene JSON is playable by opening this app and picking a saved scene,
// with ZERO further edits to apps.js.
//
// Contract: same {node, dispose, getViewState, restoreViewState} shape as
// every other reg()'d app (see docs/snake-app.js for the reference shape).

import { t } from '../../vendor/i18n.js';
import { runScenePlaytest, normalizeScene } from './level-editor-app.js';
import { el } from '../../lib/dom.js';

// Scene files are recognized by extension only (any fs path ending
// .json under any directory) — level-editor-app.js always saves under
// 'level-editor/scene.json' but export/save-as flows and hand-authored
// scenes may live anywhere, so the picker lists every .json key rather
// than hardcoding the level-editor's own path.
function listSceneCandidates(fs) {
    let keys = [];
    try { keys = fs.list('') || []; } catch { keys = []; }
    return keys.filter(k => typeof k === 'string' && k.endsWith('.json'));
}

export function createGamePlayerApp({ instance, ctx } = {}) {
    if (!instance || !instance.fs) {
        const fallbackShell = (typeof window !== 'undefined' && window.__debug && window.__debug.shell) || null;
        instance = (fallbackShell && fallbackShell.active) || instance || {};
    }
    const fs = instance.fs;

    const node = el('div', 'app-pane');
    node.dataset.component = 'game-player-app';
    node.tabIndex = 0;

    const head = el('div', null, t('gameplayer.title', 'game player · ') + (instance.id || ''));

    const picker = el('div', 'meta');
    const pickLabel = el('label', null, t('gameplayer.pickLabel', 'load scene: '));
    const select = document.createElement('select');
    select.setAttribute('aria-label', t('gameplayer.pickLabel', 'load scene'));
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('gameplayer.pickPlaceholder', 'choose a saved scene…');
    select.append(placeholder);
    const btnRefresh = el('button', null, t('gameplayer.refresh', 'refresh list'));
    const btnStop = el('button', null, t('gameplayer.stop', 'stop'));
    const btnReset = el('button', null, t('gameplayer.reset', 'reset'));
    btnStop.disabled = true;
    btnReset.disabled = true;
    picker.append(pickLabel, select, btnRefresh, btnStop, btnReset);

    const status = el('div', 'meta');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const hint = el('div', 'meta', t('gameplayer.hint', 'arrow keys move actor objects · pick a scene above to play it'));
    const errorLine = el('div', 'meta');
    errorLine.style.display = 'none';

    const cv = document.createElement('canvas');
    cv.width = 480; cv.height = 360;
    cv.className = 'app-canvas';
    cv.tabIndex = 0;

    node.append(head, picker, hint, errorLine, cv, status);

    let runner = null;
    let loadedPath = null;

    function setStatus(msg) { status.textContent = msg; }

    function drawIdle(msg) {
        const c2 = cv.getContext('2d');
        c2.clearRect(0, 0, cv.width, cv.height);
        c2.fillStyle = '#1a1a1a';
        c2.fillRect(0, 0, cv.width, cv.height);
        c2.fillStyle = '#888888';
        c2.font = '14px sans-serif';
        c2.fillText(msg, 12, 24);
    }

    function stopPlayback() {
        if (runner) { runner.stop(); runner = null; }
        btnStop.disabled = true;
        btnReset.disabled = true;
    }

    function onPlaytestError(e) {
        errorLine.textContent = t('gameplayer.playError', 'playback error: ') + ((e && e.message) || String(e));
        errorLine.style.display = '';
        stopPlayback();
        setStatus(t('gameplayer.stopped', 'stopped'));
    }

    function playScene(scene, path) {
        stopPlayback();
        errorLine.style.display = 'none';
        loadedPath = path;
        try {
            runner = runScenePlaytest(scene, cv, { inputTarget: node, onError: onPlaytestError });
        } catch (e) {
            onPlaytestError(e);
            return;
        }
        btnStop.disabled = false;
        btnReset.disabled = false;
        setStatus(t('gameplayer.playing', 'playing: {path} ({count} objects)', { path, count: scene.objects.length }));
        node.focus();
    }

    function loadAndPlay(path) {
        try {
            const raw = fs && fs.readJson ? fs.readJson(path, null) : null;
            if (!raw) {
                setStatus(t('gameplayer.loadFailed', 'could not load: ') + path);
                return;
            }
            const scene = normalizeScene(raw);
            playScene(scene, path);
        } catch (e) {
            setStatus(t('gameplayer.loadFailed', 'could not load: ') + path + ' — ' + ((e && e.message) || e));
        }
    }

    function refreshList(preserveSelection) {
        const prev = preserveSelection ? select.value : '';
        while (select.options.length > 1) select.remove(1);
        const candidates = listSceneCandidates(fs);
        for (const path of candidates) {
            const opt = document.createElement('option');
            opt.value = path;
            opt.textContent = path;
            select.append(opt);
        }
        if (prev && candidates.includes(prev)) select.value = prev;
    }

    function ensureOption(path) {
        if (![...select.options].some(o => o.value === path)) {
            const opt = document.createElement('option');
            opt.value = path;
            opt.textContent = path;
            select.append(opt);
        }
    }

    select.addEventListener('change', () => {
        const path = select.value;
        if (path) loadAndPlay(path);
    });
    btnRefresh.addEventListener('click', () => refreshList(true));
    btnStop.addEventListener('click', () => { stopPlayback(); setStatus(t('gameplayer.stopped', 'stopped')); });
    btnReset.addEventListener('click', () => {
        if (!runner) return;
        try { runner.reset(); } catch (e) { onPlaytestError(e); }
    });

    refreshList(false);
    drawIdle(t('gameplayer.idleHint', 'no scene loaded — pick one above'));
    setStatus(t('gameplayer.ready', 'ready'));

    // Allow opening directly at a specific scene path via ctx (e.g. a future
    // "open with game player" action from fsbrowse could pass
    // ctx.args.scenePath) without requiring the manual picker.
    const initialPath = ctx && ctx.args && typeof ctx.args.scenePath === 'string' ? ctx.args.scenePath : null;
    if (initialPath) {
        ensureOption(initialPath);
        select.value = initialPath;
        loadAndPlay(initialPath);
    }

    if (typeof window !== 'undefined') {
        window.__debug = window.__debug || {};
        window.__debug.instances = window.__debug.instances || {};
        window.__debug.instances[instance.id] = window.__debug.instances[instance.id] || {};
        window.__debug.instances[instance.id].gamePlayer = {
            load: loadAndPlay,
            stop: stopPlayback,
            reset: () => { if (runner) { try { runner.reset(); } catch (e) { onPlaytestError(e); } } },
            get loadedPath() { return loadedPath; },
            get isPlaying() { return !!runner; },
            get scene() { return runner ? runner.scene : null; },
        };
    }

    return {
        node,
        dispose: () => { stopPlayback(); },
        getViewState: () => ({ loadedPath }),
        restoreViewState: (s) => { if (s && s.loadedPath) { ensureOption(s.loadedPath); select.value = s.loadedPath; loadAndPlay(s.loadedPath); } },
    };
}
