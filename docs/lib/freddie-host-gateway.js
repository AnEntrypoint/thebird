// freddie-host gateway probing + never-reject acptoapi fallback fetch. Split
// out of docs/freddie-host.js (pure move, no behavior change).
import { t } from '../vendor/i18n.js';

export async function checkAcptoapi(endpoint = 'http://localhost:4800') {
    try {
        const r = await fetch(endpoint + '/health', { method: 'GET' });
        return r.ok;
    } catch {
        return false;
    }
}

// Probe each gateway in the chain on boot; log to window.__debug for diagnostics.
// Localhost gateways (acptoapi) are skipped silently on github.io to avoid pointless
// mixed-content/CORS noise.
export async function probeGatewayChain(chain) {
    const isLocalDev = typeof location !== 'undefined' && /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname);
    const results = [];
    for (const url of chain || []) {
        const isLocal = /localhost|127\.|0\.0\.0\.0/.test(url);
        if (!isLocalDev && isLocal) { results.push({ url, status: 'skipped-remote-host' }); continue; }
        try {
            const r = await fetch(String(url).replace(/\/$/, '') + '/health');
            results.push({ url, status: r.ok ? 'up' : 'http-' + r.status });
        } catch (e) { results.push({ url, status: 'down', error: String(e && e.message || e) }); }
    }
    if (typeof window !== 'undefined') {
        window.__debug = window.__debug || {};
        window.__debug.gatewayChain = { probedAt: Date.now(), results };
    }
    return results;
}

export function _isLoopback(u) {
    try {
        const x = new URL(u, (typeof location !== 'undefined' && location.href) || 'http://_/');
        const h = (x.hostname || '').toLowerCase();
        return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1';
    } catch { return false; }
}
export function _pageOnLoopback() {
    try {
        const h = (typeof location !== 'undefined' && location.hostname || '').toLowerCase();
        return h === 'localhost' || h === '127.0.0.1' || h === '' || h === '::1';
    } catch { return true; }
}

export function formatAgo(ts) {
    if (!ts) return t('offline.agoUnknown', 'unknown time');
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (secs < 60) return t('offline.agoSeconds', '{secs}s ago', { secs });
    const mins = Math.round(secs / 60);
    if (mins < 60) return t('offline.agoMinutes', '{mins}m ago', { mins });
    const hours = Math.round(mins / 60);
    if (hours < 24) return t('offline.agoHours', '{hours}h ago', { hours });
    const days = Math.round(hours / 24);
    return t('offline.agoDays', '{days}d ago', { days });
}

export async function acptoapiFallback({ prompt, endpoint = 'http://localhost:4800', model = 'claude-haiku-4-5-20251001', timeoutMs = 60000 }) {
    // Per acptoapi-local memo: only /v1/chat/completions works; /v1/messages is broken.
    // Skip loopback endpoints when the page itself is not on loopback — the fetch
    // would hang indefinitely under Chrome's private-network rules.
    if (_isLoopback(endpoint) && !_pageOnLoopback()) return null;
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(new Error('acptoapi fetch timeout')), timeoutMs);
    try {
        const base = String(endpoint).replace(/\/$/, '');
        const url = base.endsWith('/v1') ? base + '/chat/completions' : base + '/v1/chat/completions';
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
            signal: ac.signal,
        });
        if (!r.ok) return null;
        const j = await r.json();
        const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (content) return { content, _provider: 'acptoapi' };
        return null;
    } catch {
        return null;
    } finally {
        clearTimeout(tid);
    }
}
