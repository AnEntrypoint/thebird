// gm-app: the in-OS "memory" browser over gm (rs-learn/rs-codesearch/rs-codeinsight
// + orchestrator) via window.__debug.gm. Extracted from docs/apps.js (pure code motion).
import { el, resolveInstance } from './apps.js';

export function gmApp(ctx) {
    const instance = resolveInstance(ctx);
    // Per-instance UI state (active tab, form drafts) lives in the instance's
    // own fs — NOT shared localStorage (the two-key registry rule: only
    // thebird-last-instance / thebird-session-labels / thebird-last-template
    // are sanctioned there; everything else is per-instance IDB/OPFS).
    const STATE_PATH = '/gm-app/ui-state.json';
    const ephemeral = {}; // fallback when instance.fs is unavailable: state still works for this mount, just isn't durable
    const readState = () => {
        try { return (instance.fs && instance.fs.readJson(STATE_PATH, {})) || {}; } catch { return ephemeral; }
    };
    const stateGet = (k, d = '') => {
        const v = readState()[k];
        return typeof v === 'string' ? v : d;
    };
    const stateSet = (k, v) => {
        try {
            if (!instance.fs) { ephemeral[k] = v; return; }
            const s = readState();
            s[k] = v;
            instance.fs.writeJson(STATE_PATH, s);
        } catch { /* swallow: best-effort UI-state persistence, non-fatal if the instance fs is unavailable */ }
    };

    // Include the active freddie instance namespace (freddie learns under 'instance-<id>'
    // via globalThis.__GM_NAMESPACE__) so the memory browser can see what freddie learned,
    // not just operator-written namespaces.
    const activeInstanceNs = (() => {
        try {
            const id = typeof window !== 'undefined' && window.__GM_NAMESPACE__
                ? (typeof window.__GM_NAMESPACE__ === 'function' ? window.__GM_NAMESPACE__() : window.__GM_NAMESPACE__)
                : null;
            return id || null;
        } catch { return null; }
    })();
    const NAMESPACES = [...new Set([activeInstanceNs, 'default', 'project', 'meta', 'global', 'session'].filter(Boolean))];

    const node = el('div', 'app-pane ds-prose');
    node.dataset.component = 'gm-app';

    const head = el('div', 'ds-section');
    const title = el('h3');
    title.textContent = 'memory — ' + instance.id;
    head.appendChild(title);

    const status = el('div', 'ds-field-hint');
    status.textContent = 'probing gm…';
    head.appendChild(status);
    node.appendChild(head);

    // Tab bar
    const tabBar = el('div', 'ds-segmented');
    tabBar.setAttribute('role', 'tablist');
    const TABS = [
        { id: 'recall',       label: 'recall' },
        { id: 'memorize',     label: 'memorize' },
        { id: 'codesearch',   label: 'codesearch' },
        { id: 'codeinsight',  label: 'codeinsight' },
        { id: 'orchestrator', label: 'orchestrator' },
        { id: 'raw',          label: 'raw' },
    ];
    const panels = {};
    for (const t of TABS) {
        const b = el('button', 'ds-seg-btn');
        b.type = 'button';
        b.textContent = t.label;
        b.dataset.tab = t.id;
        b.addEventListener('click', () => activate(t.id));
        tabBar.appendChild(b);
    }
    node.appendChild(tabBar);

    const panelHost = el('div', 'ds-section');
    node.appendChild(panelHost);

    const activate = (id) => {
        stateSet('active', id);
        for (const child of tabBar.children) child.classList.toggle('is-on', child.dataset.tab === id);
        for (const k of Object.keys(panels)) panels[k].classList.toggle('is-hidden', k !== id);
        for (const k of Object.keys(panels)) panels[k].hidden = (k !== id);
    };

    const getGm = () => (typeof window !== 'undefined' && window.__debug && window.__debug.gm) || null;
    const fmt = (r) => { try { return typeof r === 'string' ? r : JSON.stringify(r, null, 2); } catch { return String(r); } };

    // Helper: panel skeleton (label row + control row + output pre)
    const makePanel = (id) => {
        const p = el('div', 'ds-field-wrap');
        p.dataset.panel = id;
        panels[id] = p;
        panelHost.appendChild(p);
        return p;
    };
    const makeRow = (parent) => { const r = el('div', 'ds-chat-composer'); parent.appendChild(r); return r; };
    const makeOut = (parent) => { const o = el('pre', 'ds-prose mono'); parent.appendChild(o); return o; };
    const makeNsSelect = (key) => {
        const sel = el('select', 'ds-select');
        for (const n of NAMESPACES) { const opt = document.createElement('option'); opt.value = n; opt.textContent = n; sel.appendChild(opt); }
        sel.value = stateGet(key, 'default');
        sel.addEventListener('change', () => stateSet(key, sel.value));
        return sel;
    };
    const makeInput = (placeholder, key) => {
        const i = document.createElement('input');
        i.type = 'text';
        i.placeholder = placeholder;
        i.className = 'ds-field';
        if (key) {
            i.value = stateGet(key, '');
            i.addEventListener('input', () => stateSet(key, i.value));
        }
        return i;
    };
    const makeBtn = (label) => { const b = el('button', 'btn'); b.type = 'button'; b.textContent = label; return b; };

    // --- recall ---
    {
        const p = makePanel('recall');
        const row = makeRow(p);
        const ns = makeNsSelect('recall:ns');
        const q = makeInput('query', 'recall:q');
        const limit = makeInput('limit (default 8)', 'recall:limit');
        const btn = makeBtn('search');
        row.append(ns, q, limit, btn);
        // Hits render as interactive rows (not a static <pre>) so each learned memory can be
        // pruned in place — an OS-like memory browser over what freddie/the operator stored.
        const hitsHost = el('div', 'gm-recall-hits');
        p.appendChild(hitsHost);
        const out = makeOut(p);
        const fmtScore = (h) => (h.score != null ? Number(h.score).toFixed(4) : (h.cosine != null ? Number(h.cosine).toFixed(4) : '?'));
        const renderHits = (hits) => {
            hitsHost.replaceChildren();
            hits.forEach((h, i) => {
                const card = el('div', 'gm-recall-hit');
                const meta = el('div', 'gm-recall-meta');
                meta.textContent = `[${i + 1}] score=${fmtScore(h)}` + (h.key ? `  key=${h.key}` : '');
                const body = el('div', 'gm-recall-text');
                body.textContent = (h.text || h.snippet || h.content || '').slice(0, 400);
                const acts = el('div', 'gm-recall-acts');
                if (h.key) {
                    const forget = makeBtn('forget');
                    forget.classList.add('gm-recall-forget');
                    forget.addEventListener('click', () => {
                        const gm = getGm();
                        if (!gm || !gm.dispatch) { meta.textContent = 'gm not booted'; return; }
                        try {
                            const pr = gm.dispatch('memorize-prune', { keys: [h.key] });
                            const n = (pr && pr.data && pr.data.pruned) ?? (pr && pr.pruned) ?? 0;
                            card.classList.add('is-pruned');
                            forget.textContent = n ? 'forgotten' : 'not found';
                            forget.disabled = true;
                        } catch (e) { meta.textContent = 'prune error: ' + (e && e.message || e); }
                    });
                    acts.appendChild(forget);
                }
                card.append(meta, body, acts);
                hitsHost.appendChild(card);
            });
        };
        const run = () => {
            const gm = getGm();
            if (!gm || !gm.recall) { out.textContent = 'gm not booted yet'; return; }
            try {
                const lim = parseInt(limit.value, 10);
                const r = gm.recall(q.value.trim(), Number.isFinite(lim) && lim > 0 ? lim : 8, ns.value);
                const hits = (r && Array.isArray(r.hits)) ? r.hits : (r && r.data && Array.isArray(r.data.hits)) ? r.data.hits : null;
                if (hits) {
                    if (!hits.length) { hitsHost.replaceChildren(); out.textContent = '(no hits)'; return; }
                    out.textContent = '';
                    renderHits(hits);
                } else {
                    hitsHost.replaceChildren();
                    out.textContent = fmt(r);
                }
            } catch (e) { out.textContent = 'recall error: ' + (e && e.message || e); }
        };
        btn.addEventListener('click', run);
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    }

    // --- memorize ---
    {
        const p = makePanel('memorize');
        const row = makeRow(p);
        const ns = makeNsSelect('memorize:ns');
        row.appendChild(ns);
        const ta = document.createElement('textarea');
        ta.className = 'ds-field';
        ta.placeholder = 'text to remember';
        ta.rows = 6;
        ta.value = stateGet('memorize:text', '');
        ta.addEventListener('input', () => stateSet('memorize:text', ta.value));
        p.appendChild(ta);
        const row2 = makeRow(p);
        const btn = makeBtn('remember');
        const stat = el('span', 'ds-field-hint');
        row2.append(btn, stat);
        const out = makeOut(p);
        btn.addEventListener('click', () => {
            const gm = getGm();
            if (!gm || !gm.memorize) { stat.textContent = 'gm not booted yet'; return; }
            try {
                const txt = ta.value.trim();
                if (!txt) { stat.textContent = 'empty text'; return; }
                const r = gm.memorize(txt, ns.value);
                if (r == null) { stat.textContent = 'no response from gm (not stored)'; }
                else if (r && r.error) { stat.textContent = 'error: ' + r.error; }
                else { stat.textContent = 'stored @ ' + new Date().toLocaleTimeString(); }
                out.textContent = fmt(r);
            } catch (e) { stat.textContent = 'error'; out.textContent = 'memorize error: ' + (e && e.message || e); }
        });
    }

    // --- codesearch ---
    {
        const p = makePanel('codesearch');
        const row = makeRow(p);
        const q = makeInput('code query', 'codesearch:q');
        const limit = makeInput('k (default 10)', 'codesearch:k');
        const btn = makeBtn('search');
        row.append(q, limit, btn);
        const out = makeOut(p);
        const run = () => {
            const gm = getGm();
            if (!gm || !gm.codesearch) { out.textContent = 'gm not booted yet'; return; }
            try {
                const k = parseInt(limit.value, 10);
                const r = gm.codesearch(q.value.trim(), Number.isFinite(k) && k > 0 ? k : 10);
                const hits = (r && (r.hits || r.results)) || [];
                if (hits.length) {
                    out.textContent = hits.map((h, i) => {
                        const file = h.path || h.file || h.uri || '?';
                        const line = h.line != null ? h.line : (h.start_line != null ? h.start_line : '?');
                        const score = h.score != null ? h.score.toFixed(4) : (h.cosine != null ? h.cosine.toFixed(4) : '?');
                        const snip = (h.text || h.snippet || h.content || '').slice(0, 240);
                        return `[${i + 1}] ${file}:${line}  (score=${score})\n${snip}`;
                    }).join('\n\n');
                } else {
                    out.textContent = fmt(r);
                }
            } catch (e) { out.textContent = 'codesearch error: ' + (e && e.message || e); }
        };
        btn.addEventListener('click', run);
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    }

    // --- codeinsight ---
    {
        const p = makePanel('codeinsight');
        const row = makeRow(p);
        const btn = makeBtn('rebuild index');
        const counter = el('span', 'ds-field-hint');
        const last = el('span', 'ds-field-hint');
        counter.textContent = 'files: ?';
        last.textContent = 'last: never';
        row.append(btn, counter, last);
        const out = makeOut(p);
        btn.addEventListener('click', () => {
            const gm = getGm();
            if (!gm || !gm.dispatch) { out.textContent = 'gm not booted yet'; return; }
            try {
                const r = gm.dispatch('codeinsight_index', { root: '/', max_files: 300 });
                if (r == null) { counter.textContent = 'files: error'; out.textContent = 'codeinsight_index: call succeeded but returned no data'; return; }
                if (r.error) { counter.textContent = 'files: error'; out.textContent = 'codeinsight error: ' + r.error; return; }
                const files = (r.files != null ? r.files : (r.chunks != null ? r.chunks : (r.indexed != null ? r.indexed : '?')));
                counter.textContent = 'files: ' + files;
                last.textContent = 'last: ' + new Date().toLocaleTimeString();
                out.textContent = fmt(r);
            } catch (e) { out.textContent = 'codeinsight error: ' + (e && e.message || e); }
        });
    }

    // --- orchestrator ---
    {
        const p = makePanel('orchestrator');
        const row = makeRow(p);
        const prompt = makeInput('instruction prompt', 'orch:prompt');
        const instBtn = makeBtn('instruction');
        const phaseBtn = makeBtn('phase-status');
        const prdBtn = makeBtn('prd-list');
        row.append(prompt, instBtn, phaseBtn, prdBtn);
        const out = makeOut(p);
        const callVerb = (verb, body) => {
            const gm = getGm();
            if (!gm || !gm.dispatch) { out.textContent = 'gm not booted yet'; return { ok: false }; }
            try {
                const value = gm.dispatch(verb, body || {});
                if (value && value.wasm_aborted === true) {
                    out.textContent = verb + ': gm supervisor restarting (wasm_aborted) — retry';
                    return { ok: false };
                }
                return { ok: true, value };
            }
            catch (e) { out.textContent = verb + ' error: ' + (e && e.message || e); return { ok: false }; }
        };
        instBtn.addEventListener('click', () => {
            const call = callVerb('instruction', { prompt: prompt.value.trim() });
            if (!call.ok) return;
            const r = call.value;
            if (r == null) { out.textContent = 'instruction: call succeeded but returned no data'; return; }
            const phase = r.phase || (r.response && r.response.phase) || '?';
            const hint = r.next_phase_hint || (r.response && r.response.next_phase_hint) || '';
            const hits = r.recall_hits || (r.response && r.response.recall_hits) || [];
            const preview = Array.isArray(hits)
                ? hits.slice(0, 3).map((h, i) => `  [${i + 1}] ${(h.text || h.snippet || '').slice(0, 120)}`).join('\n')
                : '';
            out.textContent = `phase: ${phase}\nnext_phase_hint: ${hint}\nrecall_hits: ${Array.isArray(hits) ? hits.length : '?'}\n${preview}\n\n--- raw ---\n${fmt(r)}`;
        });
        phaseBtn.addEventListener('click', () => {
            const call = callVerb('phase-status', {});
            if (!call.ok) return;
            const r = call.value;
            if (r == null) { out.textContent = 'phase-status: call succeeded but returned no data'; return; }
            out.textContent = `current phase: ${r.phase || r.current || '?'}\n\n--- raw ---\n${fmt(r)}`;
        });
        prdBtn.addEventListener('click', () => {
            const call = callVerb('prd-list', {});
            if (!call.ok) return;
            const r = call.value;
            if (r == null) { out.textContent = 'prd-list: call succeeded but returned no data'; return; }
            const list = (r && (r.prds || r.pending || r.list)) || [];
            const lines = Array.isArray(list) ? list.map((x, i) => `  [${i + 1}] ${x.id || x.title || JSON.stringify(x).slice(0, 100)}`).join('\n') : '';
            out.textContent = `pending PRDs: ${Array.isArray(list) ? list.length : '?'}\n${lines}\n\n--- raw ---\n${fmt(r)}`;
        });
    }

    // --- raw ---
    {
        const p = makePanel('raw');
        const row = makeRow(p);
        const verb = makeInput('verb (e.g. instruction)', 'raw:verb');
        const bodyInp = makeInput('JSON body (optional)', 'raw:body');
        const btn = makeBtn('dispatch');
        row.append(verb, bodyInp, btn);
        const out = makeOut(p);
        btn.addEventListener('click', () => {
            const v = verb.value.trim();
            if (!v) { out.textContent = 'empty verb'; return; }
            let parsed = {};
            try { if (bodyInp.value.trim()) parsed = JSON.parse(bodyInp.value); }
            catch (e) { out.textContent = 'JSON parse error: ' + e.message; return; }
            const gm = getGm();
            if (!gm || !gm.dispatch) { out.textContent = 'gm not booted yet'; return; }
            try {
                const r = gm.dispatch(v, parsed);
                if (r && r.wasm_aborted === true) {
                    out.textContent = v + ': gm supervisor restarting (wasm_aborted) — retry';
                    return;
                }
                out.textContent = fmt(r);
            }
            catch (e) { out.textContent = 'dispatch error: ' + (e && e.message || e); }
        });

        // Status footer with gm summary, only rendered in raw panel
        const foot = el('pre', 'ds-prose mono ds-field-hint');
        p.appendChild(foot);
        const refresh = () => {
            const gm = getGm();
            if (!gm) { foot.textContent = 'waiting for assistant host…'; return; }
            const lines = [
                'exports: ' + (gm.exports ? gm.exports.length + ' (' + gm.exports.slice(0, 6).join(', ') + (gm.exports.length > 6 ? ', …' : '') + ')' : 'n/a'),
                'last hook: ' + (gm.lastHook ? gm.lastHook.hook + ' @ ' + new Date(gm.lastHook.at).toLocaleTimeString() : 'none'),
                'trajectory: ' + (gm.trajectory ? gm.trajectory.length + ' entries' : '0'),
                'embeddings ns: ' + (gm.embeddings ? Object.keys(gm.embeddings).join(', ') || '(none)' : 'n/a'),
            ];
            foot.textContent = lines.join('\n');
        };
        refresh();
        p._refresh = refresh;
    }

    // Activate persisted or default tab
    activate(stateGet('active', 'recall'));

    // Bootstrap probe: poll up to 5s for window.__debug.gm
    let probeIv = null;
    let probeCount = 0;
    const probe = () => {
        const gm = getGm();
        if (gm && gm.dispatch) {
            status.textContent = 'memory ready — exports=' + (gm.exports ? gm.exports.length : '?');
            clearInterval(probeIv);
            probeIv = null;
        } else if (++probeCount > 25) {
            status.textContent = 'memory not booted after 5s — open an assistant pane first';
            clearInterval(probeIv);
            probeIv = null;
        } else {
            status.textContent = 'probing gm… (' + probeCount + '/25)';
        }
    };
    probe();
    if (!getGm()) probeIv = setInterval(probe, 200);

    // Periodic refresh of raw-panel footer
    const footIv = setInterval(() => { try { panels.raw && panels.raw._refresh && panels.raw._refresh(); } catch { /* swallow: periodic footer refresh, panel may be mid-teardown/unmounted */ } }, 1500);

    return {
        node,
        dispose: () => {
            if (probeIv) clearInterval(probeIv);
            clearInterval(footIv);
        },
        getViewState() { return { tab: stateGet('active', 'recall') }; },
        restoreViewState(s) {
            if (!s || typeof s.tab !== 'string' || !panels[s.tab]) return;
            activate(s.tab);
        },
    };
}
