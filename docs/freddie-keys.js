import { bootHost, FREDDIE_ENV_KEYS } from './freddie-loader.js';
import { t } from './vendor/i18n.js';
import { createAuditLog, maskKey as auditMaskKey } from './audit.js';

const PROVIDERS = ['groq', 'nvidia', 'cerebras', 'google', 'mistral', 'cloudflare', 'openrouter', 'sambanova', 'codestral', 'zai', 'qwen', 'opencode_zen', 'anthropic', 'openai'];

function maskKey(v) {
    if (!v) return '';
    const s = String(v);
    return 'sk-...' + s.slice(-4);
}

function isAllowedNimHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

function validateNimUrl(raw) {
    let u;
    try { u = new URL(raw); } catch (e) { return { ok: false, reason: 'invalid URL' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'must be http(s)' };
    if (!isAllowedNimHost(u.hostname)) return { ok: false, reason: 'NIM_URL host must be localhost' };
    return { ok: true, url: u };
}

async function loadFromNim(sw, statusEl) {
    const url = ((await sw.call('nim-url-get')) || '').trim();
    if (!url) { statusEl.textContent = t('keys.setNimUrlFirst', 'set NIM_URL first'); return; }
    const validation = validateNimUrl(url);
    if (!validation.ok) {
        statusEl.textContent = t('keys.nimLoadFailed', 'nim load failed: {msg}', { msg: validation.reason });
        return;
    }
    if (!window.confirm(t('keys.nimConfirm', 'Load API keys from {url}? This will overwrite matching stored provider keys.', { url }))) {
        statusEl.textContent = t('keys.nimCancelled', 'cancelled');
        return;
    }
    try {
        const res = await fetch(url.replace(/\/$/, '') + '/keys', { headers: { 'X-API-Key': 'theultimateflex' } });
        if (!res.ok) throw new Error('http ' + res.status);
        const body = await res.json();
        const map = body.keys || body;
        let n = 0;
        for (const [k, v] of Object.entries(map)) {
            const norm = String(k).toLowerCase().replace(/_api_key$/, '');
            if (PROVIDERS.includes(norm) && v) { await sw.call('keys-set', { provider: norm, key: String(v) }); n++; }
        }
        window.dispatchEvent(new CustomEvent('agent-keys-change'));
        statusEl.textContent = t('keys.loadedFromNim', 'loaded {n} keys from nim', { n });
    } catch (e) { statusEl.textContent = t('keys.nimLoadFailed', 'nim load failed: {msg}', { msg: e.message }); }
}

export function createFreddieKeys({ instance }) {
    const node = document.createElement('div');
    node.className = 'freddie-keys-panel fk-root';

    const sw = instance && instance.sw;
    if (!sw) throw new Error('createFreddieKeys: instance.sw required');
    const audit = createAuditLog(instance);
    let host = null;
    // Uncommitted NIM_URL draft (committed values live in SW storage).
    // Not persisted via getViewState - transient input discarded on refresh.
    let nimDraft = null;
    // Last committed nim value the draft was taken against. If a render sees
    // a fetched nimUrl that no longer matches this, the committed value
    // changed via some other path (another tab/instance, loadFromNim, etc.)
    // while the draft was sitting uncommitted - drop the stale draft instead
    // of masking the new value.
    let nimDraftBase = null;
    const status = document.createElement('div');
    status.className = 'fk-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    let hostFailed = false;
    Promise.race([
        bootHost({ fs: instance.fs, sw }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('bootHost timeout after 180s')), 180000)),
    ]).then(h => { host = h; render(); }).catch(e => {
        hostFailed = true;
        status.textContent = t('keys.bootHostFailed', 'bootHost failed: {msg}', { msg: (e && e.message || e) });
        render();
    });

    // Per-instance debug helper bound to this instance's SW
    if (typeof window !== 'undefined') {
        window.__debug = window.__debug || {};
        window.__debug.config = window.__debug.config || {};
        window.__debug.config[instance.id] = {
            // Masked by design: this is a global, ungated surface reachable by any
            // script on the page (console paste, hot-reloaded user app, XSS elsewhere).
            // Never return plaintext key material here - see docs/freddie-keys.js audit.
            get: async p => maskKey((await sw.call('keys-get', { provider: p })) || ''),
            set: async (p, k) => {
                try { await sw.call('keys-set', { provider: p, key: k }); }
                catch (err) { status.textContent = t('keys.saveFailed', '{provider}: save failed: {msg}', { provider: p, msg: (err && err.message || err) }); throw err; }
                window.dispatchEvent(new CustomEvent('agent-keys-change', { detail: { provider: p, instance: instance.id } }));
            },
            list: async () => {
                const raw = await sw.call('keys-list');
                if (!raw || typeof raw !== 'object') return raw;
                const masked = {};
                for (const [k, v] of Object.entries(raw)) masked[k] = maskKey(v);
                return masked;
            },
            clear: async p => { await sw.call('keys-set', { provider: p, key: '' }); window.dispatchEvent(new CustomEvent('agent-keys-change', { detail: { provider: p, instance: instance.id } })); },
        };
        window.__debug.audit = window.__debug.audit || {};
        window.__debug.audit[instance.id] = audit;
    }

    function row(provider, label, val, isAgent) {
        const wrap = document.createElement('div');
        wrap.className = 'fk-row';
        const inputId = 'fk-input-' + provider;
        const lab = document.createElement('label');
        lab.textContent = label;
        lab.htmlFor = inputId;
        wrap.appendChild(lab);
        const input = document.createElement('input');
        input.type = 'password';
        input.id = inputId;
        input.placeholder = val ? t('keys.pasteToOverwrite', '{masked} (paste to overwrite)', { masked: maskKey(val) }) : t('keys.unset', '(unset)');
        input.className = 'fk-input';
        input.dataset.provider = provider;
        wrap.appendChild(input);
        const save = document.createElement('button');
        save.textContent = t('keys.save', 'save');
        save.onclick = async () => {
            const v = input.value.trim();
            if (!v) { status.textContent = t('keys.noValue', 'no value'); return; }
            try {
                if (isAgent) await sw.call('keys-set', { provider, key: v });
                else if (host) host.pi.env.set(provider, v);
            } catch (err) {
                status.textContent = t('keys.saveFailed', '{provider}: save failed: {msg}', { provider, msg: (err && err.message || err) });
                return;
            }
            audit.log(audit.AuditEvent.ENV_CONFIGURE, 'user', { provider, action: 'set', value: auditMaskKey(v), instance: instance.id });
            input.value = '';
            status.textContent = t('keys.savedWithMask', '{provider} saved ({masked})', { provider, masked: maskKey(v) });
            setTimeout(render, 400);
        };
        wrap.appendChild(save);
        const clr = document.createElement('button');
        clr.textContent = t('keys.clear', 'clear');
        clr.onclick = async () => {
            if (isAgent) await sw.call('keys-set', { provider, key: '' });
            else host && host.pi.env.set(provider, null);
            audit.log(audit.AuditEvent.ENV_CONFIGURE, 'user', { provider, action: 'clear', instance: instance.id });
            status.textContent = t('keys.cleared', '{provider} cleared', { provider });
            setTimeout(render, 400);
        };
        wrap.appendChild(clr);
        return wrap;
    }

    async function render() {
        // Preserve any uncommitted (unsaved) input text across the rebuild below -
        // a save/clear on one row's setTimeout(render, 400) used to wipe every
        // other row's in-progress typed value via replaceChildren(). Snapshot by
        // input id (stable per provider/host-key across renderBody calls) and
        // restore after the new inputs exist.
        const draftValues = {};
        for (const el of node.querySelectorAll('input.fk-input')) {
            if (el.value) draftValues[el.id] = el.value;
        }
        node.replaceChildren();
        const title = document.createElement('div');
        title.textContent = t('keys.apiKeysTitle', 'api keys (per-instance · sw[{id}])', { id: instance.id });
        title.className = 'fk-title';
        node.appendChild(title);

        try {
            await renderBody();
            for (const [id, v] of Object.entries(draftValues)) {
                const el = node.querySelector('#' + CSS.escape(id));
                if (el) el.value = v;
            }
        } catch (e) {
            // A rejected sw.call() (SW not claimed yet, message-channel timeout,
            // worker not active, ...) used to abort this whole async function
            // after the title had already been appended, leaving the window
            // showing only the header with no key list/inputs/controls and no
            // visible error — silently "broken". Surface the failure and offer
            // a retry instead of leaving a stripped-down window.
            const err = document.createElement('div');
            err.className = 'fk-status';
            err.textContent = t('keys.renderFailed', 'failed to load keys: {msg}', { msg: (e && e.message) || String(e) });
            node.appendChild(err);
            const retry = document.createElement('button');
            retry.textContent = t('keys.retry', 'retry');
            retry.onclick = () => render();
            node.appendChild(retry);
        }
    }

    async function renderBody() {
        const nimUrl = (await sw.call('nim-url-get')) || '';
        if (nimDraft != null && nimUrl !== nimDraftBase) {
            // The committed value moved out from under the draft (external
            // writer). Discard the now-stale draft so the fresh value shows.
            nimDraft = null;
        }
        const nimWrap = document.createElement('div');
        nimWrap.className = 'fk-nim-wrap';
        const nimLab = document.createElement('label');
        nimLab.textContent = t('keys.nimUrlLabel', 'NIM_URL');
        nimWrap.appendChild(nimLab);
        const nimIn = document.createElement('input');
        nimIn.placeholder = t('keys.nimUrlPlaceholder', 'http://localhost:4900');
        nimIn.value = nimDraft != null ? nimDraft : nimUrl;
        nimIn.className = 'fk-nim-in';
        const badge = document.createElement('span');
        badge.textContent = t('keys.localNimProxyMode', 'local nim proxy mode');
        badge.className = 'fk-badge';
        badge.style.display = nimIn.value ? '' : 'none';
        nimIn.oninput = () => { nimDraft = nimIn.value; nimDraftBase = nimUrl; badge.style.display = nimIn.value ? '' : 'none'; };
        nimIn.onchange = async () => { nimDraft = null; nimDraftBase = null; await sw.call('nim-url-set', { url: nimIn.value.trim() }); render(); };
        nimWrap.appendChild(nimIn);
        const nimBtn = document.createElement('button');
        nimBtn.textContent = t('keys.loadFromNim', 'load from nim');
        nimBtn.onclick = () => loadFromNim(sw, status);
        nimWrap.appendChild(nimBtn);
        nimWrap.appendChild(badge);
        node.appendChild(nimWrap);

        const agentTitle = document.createElement('div');
        agentTitle.textContent = t('keys.agentKeysTitle', 'agent keys (per-instance · paste once per instance)');
        agentTitle.className = 'fk-agent-title';
        node.appendChild(agentTitle);
        const keys = (await sw.call('keys-get')) || {};
        for (const p of PROVIDERS) node.appendChild(row(p, p, keys[p] || '', true));
        const summary = document.createElement('div');
        summary.textContent = t('keys.agentKeysConfigured', '{count} agent keys configured (sw[{id}])', { count: Object.keys(keys).length, id: instance.id });
        summary.className = 'fk-summary';
        node.appendChild(summary);

        if (host) {
            const hostTitle = document.createElement('div');
            hostTitle.textContent = t('keys.assistantEnvKeys', 'assistant env keys');
            hostTitle.className = 'fk-host-title';
            node.appendChild(hostTitle);
            for (const { key, set } of host.pi.env.list()) {
                node.appendChild(row(key, key, set ? t('keys.set', 'set') : '', false));
            }
        } else if (hostFailed) {
            const retryBtn = document.createElement('button');
            retryBtn.textContent = t('keys.retryAssistantConnection', 'retry assistant connection');
            retryBtn.className = 'fk-retry-btn';
            retryBtn.onclick = () => {
                hostFailed = false;
                host = null;
                status.textContent = t('keys.retrying', 'retrying...');
                render();
                Promise.race([
                    bootHost({ fs: instance.fs, sw }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('bootHost timeout after 180s')), 180000)),
                ]).then(h => { host = h; render(); }).catch(e => {
                    hostFailed = true;
                    status.textContent = t('keys.bootHostFailed', 'bootHost failed: {msg}', { msg: (e && e.message || e) });
                    render();
                });
            };
            node.appendChild(retryBtn);
        } else {
            const hostLoading = document.createElement('div');
            hostLoading.textContent = t('keys.assistantEnvKeysLoading', 'assistant env keys: loading...');
            hostLoading.className = 'fk-host-title';
            node.appendChild(hostLoading);
        }

        node.appendChild(status);
    }

    render();
    return {
        node,
        getHost: () => host,
        refresh: render,
        getViewState: () => ({}),
        restoreViewState: () => {},
        dispose: () => {
            if (typeof window !== 'undefined' && window.__debug) {
                if (window.__debug.config) delete window.__debug.config[instance.id];
                if (window.__debug.audit) delete window.__debug.audit[instance.id];
            }
        },
    };
}
