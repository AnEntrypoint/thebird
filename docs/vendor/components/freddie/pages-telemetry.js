// Freddie telemetry pages: `logs` (live WebSocket JSONL tail with
// subsystem/severity/message filtering and auto-reconnect) and `debug`
// (per-subsystem snapshot + log drill-down).

import * as webjsx from '../../../vendor/webjsx/index.js';
import { makePage, api, loadingState, errorState, emptyState, refreshError } from './runtime.js';
import { Row, Table, PageHeader, SearchInput, Select } from '../content.js';
import { Chip } from '../shell.js';
import { formatTime } from '../../locale.js';
import { register as registerDebug, unregister as unregisterDebug } from '../../debug.js';
import { section, truncSpan, TRUNC_DESC } from './shared.js';

const h = webjsx.createElement;

const LOG_SEVERITY_TONE = { error: 'error', warning: 'warning', info: 'accent', debug: 'muted' };

export const logs = makePage((ctx) => {
    Object.assign(ctx.state, { lines: [], subsystems: [], activeSubsystem: '', activeSeverity: '', q: '', connected: false, wsError: null });
    const MAX_LINES = 500;

    async function loadSubsystems() {
        try { ctx.set({ subsystems: await api('/api/logs') }); }
        catch (e) { /* swallow: non-fatal, subsystem list is a filter convenience, not required for the stream */ }
    }

    let unmounted = false;
    let reconnectTimer = null;
    function connect() {
        if (unmounted) return;
        if (typeof WebSocket === 'undefined') { ctx.set({ wsError: new Error('WebSocket not available in this environment') }); return }
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(proto + '//' + location.host + '/api/logs/stream');
        ws.onopen = () => ctx.set({ connected: true, wsError: null });
        ws.onerror = () => ctx.set({ connected: false, wsError: new Error('log stream connection error') });
        ws.onclose = () => { ctx.set({ connected: false }); if (!unmounted) reconnectTimer = setTimeout(connect, 3000); };
        ws.onmessage = (ev) => {
            let rec; try { rec = JSON.parse(ev.data); } catch { return; }
            const next = [rec, ...ctx.state.lines].slice(0, MAX_LINES);
            ctx.set({ lines: next });
        };
        currentWs = ws;
    }
    let currentWs = null;

    loadSubsystems();
    connect();
    registerDebug('logs', () => ({ connected: ctx.state.connected, lineCount: ctx.state.lines.length, activeSubsystem: ctx.state.activeSubsystem, activeSeverity: ctx.state.activeSeverity }));
    ctx.onCleanup(() => {
        unmounted = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        try { currentWs?.close(); } catch { /* swallow: teardown-only close, socket may already be closed/closing */ }
        unregisterDebug('logs');
    });

    function filtered() {
        const s = ctx.state;
        return s.lines.filter((l) => {
            if (s.activeSubsystem && l.subsystem !== s.activeSubsystem) return false;
            if (s.activeSeverity && l.severity !== s.activeSeverity) return false;
            if (s.q && !String(l.msg || '').toLowerCase().includes(s.q.toLowerCase())) return false;
            return true;
        });
    }

    return () => {
        const s = ctx.state;
        const rows = filtered();
        const severities = ['error', 'warning', 'info', 'debug'];
        return [
            PageHeader({
                title: 'logs', lede: 'live JSONL log tail — /api/logs/stream',
                right: s.connected ? Chip({ tone: 'live', children: 'live' }) : Chip({ tone: 'miss', children: 'reconnecting…' }),
            }),
            s.wsError ? refreshError(s.wsError) : null,
            h('div', { class: 'ds-toolbar' },
                SearchInput({ value: s.q, placeholder: 'filter by message…', onInput: (v) => ctx.set({ q: v }), resultCount: rows.length }),
                Select({
                    label: 'subsystem', value: s.activeSubsystem, placeholder: 'all subsystems',
                    options: (s.subsystems || []).map((name) => ({ value: name, label: name })),
                    onChange: (v) => ctx.set({ activeSubsystem: v }),
                }),
                Select({
                    label: 'severity', value: s.activeSeverity, placeholder: 'all severities',
                    options: severities.map((sv) => ({ value: sv, label: sv })),
                    onChange: (v) => ctx.set({ activeSeverity: v }),
                }),
            ),
            rows.length ? section('lines · ' + rows.length,
                Table({
                    headers: ['time', 'subsystem', 'severity', 'message'],
                    rows: rows.map((l) => [
                        formatTime(l.ts ? Date.parse(l.ts) : Date.now()),
                        l.subsystem || '—',
                        Chip({ tone: LOG_SEVERITY_TONE[l.severity] || 'dim', children: l.severity || 'info' }),
                        truncSpan(l.msg, TRUNC_DESC),
                    ]),
                }),
            ) : emptyState(s.connected ? 'no log lines yet — waiting for activity' : 'connecting to log stream…'),
        ].filter(Boolean);
    };
});

export const debug = makePage((ctx) => {
    Object.assign(ctx.state, { sub: null, logs: null });
    async function load() { try { ctx.set({ loading: false, data: await api('/api/debug'), error: null }); } catch (e) { ctx.set({ loading: false, error: e }); } }
    async function loadLogs(name) {
        ctx.set({ sub: name });
        try { ctx.set({ logs: await api('/api/logs/' + encodeURIComponent(name)) }); }
        catch (e) { ctx.set({ logs: { error: String(e.message || e) } }); }
    }
    load();
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading debug snapshots…');
        if (s.error) return errorState(s.error, load);
        const d = s.data || {};
        const subsystems = d.subsystems || Object.keys(d);
        return [
            PageHeader({ title: 'debug', lede: 'subsystem snapshots & logs' }),
            section('subsystems', subsystems.length ? subsystems.map((name, i) => Row({
                key: i, title: name, onClick: () => loadLogs(name), active: s.sub === name,
            })) : emptyState('no debug subsystems')),
            s.sub ? section('logs · ' + s.sub, h('pre', { class: 'fd-pre' }, JSON.stringify(s.logs, null, 2))) : null,
        ].filter(Boolean);
    };
});
