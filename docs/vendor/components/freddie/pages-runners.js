// Freddie execution-surface pages: `cron` (scheduled prompt jobs), `tools`
// (grouped tool catalogue with schema drill-down), and `batch` (parallel
// prompt runner + result roll-up).

import * as webjsx from '../../../vendor/webjsx/index.js';
import { makePage, api, loadingState, errorState, emptyState } from './runtime.js';
import { Row, Table, Kpi, PageHeader, SearchInput, TextField } from '../content.js';
import { Chip, Btn, Icon } from '../shell.js';
import { section, noteAlert, trunc, truncSpan, TRUNC_SUB, TRUNC_OUTPUT, TRUNC_DESC, TRUNC_PROMPT } from './shared.js';

const h = webjsx.createElement;

export const cron = makePage((ctx) => {
    Object.assign(ctx.state, { expr: '', prompt: '', busy: false, note: null });
    async function load() { try { ctx.set({ loading: false, list: await api('/api/cron'), error: null }); } catch (e) { ctx.set({ loading: false, error: e }); } }
    async function add() {
        const expr = (ctx.state.expr || '').trim(); const prompt = (ctx.state.prompt || '').trim();
        if (!expr || !prompt) { ctx.set({ note: { kind: 'warn', msg: 'cron expression and prompt required' } }); return; }
        ctx.set({ busy: true, note: null });
        try { await api('/api/cron', { method: 'POST', body: { cron: expr, prompt } }); ctx.state.expr = ''; ctx.state.prompt = ''; await load(); }
        catch (e) { ctx.set({ note: { kind: 'error', msg: String(e.message || e) } }); }
        ctx.set({ busy: false });
    }
    async function del(id) { ctx.set({ busy: true }); try { await api('/api/cron/' + id, { method: 'DELETE' }); await load(); } catch (e) { ctx.set({ note: { kind: 'error', msg: String(e.message || e) } }); } ctx.set({ busy: false }); }
    load();
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading cron jobs…');
        if (s.error && !s.list) return errorState(s.error, load);
        const list = Array.isArray(s.list) ? s.list : [];
        return [
            PageHeader({ title: 'cron', lede: list.length + ' scheduled jobs' }),
            noteAlert(s.note),
            section('jobs', list.length ? list.map((j, i) => Row({
                key: i, code: j.enabled ? Icon('play') : Icon('pause'), title: j.cron, sub: trunc(j.prompt, TRUNC_SUB).text,
                trailing: Btn({ variant: 'danger', children: 'delete', onClick: () => del(j.id) }),
            })) : emptyState('no cron jobs')),
            section('new job',
                TextField({ label: 'cron expression', value: s.expr, onInput: (v) => { s.expr = v; }, placeholder: '0 9 * * *' }),
                TextField({ label: 'prompt', value: s.prompt, multiline: true, onInput: (v) => { s.prompt = v; }, placeholder: 'what to run…' }),
                Btn({ variant: 'primary', disabled: s.busy, children: s.busy ? 'working…' : 'add job', onClick: add })),
        ];
    };
});

export const tools = makePage((ctx) => {
    Object.assign(ctx.state, { open: null, q: '' });
    async function load() { try { ctx.set({ loading: false, list: await api('/api/tools'), error: null }); } catch (e) { ctx.set({ loading: false, error: e }); } }
    load();
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading tools…');
        if (s.error) return errorState(s.error, load);
        let list = Array.isArray(s.list) ? s.list : (s.list?.tools || []);
        if (s.q) list = list.filter(t => (t.name || '').includes(s.q));
        const groups = {};
        for (const t of list) { const g = t.toolset || 'core'; (groups[g] = groups[g] || []).push(t); }
        return [
            PageHeader({ title: 'tools', lede: list.length + ' tools' }),
            SearchInput({ value: s.q, label: 'filter tools', placeholder: 'filter tools…', onInput: (v) => ctx.set({ q: v }) }),
            ...Object.entries(groups).map(([g, ts]) => section(g + ' · ' + ts.length, ts.map((t, i) => h('div', { key: i },
                Row({ title: t.name, sub: trunc(t.schema?.description || t.description, TRUNC_DESC).text, onClick: () => ctx.set({ open: ctx.state.open === t.name ? null : t.name }), active: ctx.state.open === t.name }),
                ctx.state.open === t.name ? h('pre', { class: 'fd-pre' }, JSON.stringify(t.schema || t, null, 2)) : null,
            )))),
            list.length ? null : emptyState('no tools match'),
        ].filter(Boolean);
    };
});

export const batch = makePage((ctx) => {
    Object.assign(ctx.state, { loading: false, prompts: '', concurrency: 4, busy: false, result: null, note: null });
    async function run() {
        const prompts = (ctx.state.prompts || '').split('\n').map(x => x.trim()).filter(Boolean);
        if (!prompts.length) { ctx.set({ note: { kind: 'warn', msg: 'enter at least one prompt (one per line)' } }); return; }
        ctx.set({ busy: true, note: null, result: null });
        try { const r = await api('/api/batch', { method: 'POST', body: { prompts, concurrency: Number(ctx.state.concurrency) || 4 } }); ctx.set({ result: r }); }
        catch (e) { ctx.set({ note: { kind: 'error', msg: String(e.message || e) } }); }
        ctx.set({ busy: false });
    }
    return () => {
        const s = ctx.state;
        return [
            PageHeader({ title: 'batch', lede: 'parallel prompt runner' }),
            noteAlert(s.note),
            section('prompts',
                TextField({ label: 'prompts (one per line)', value: s.prompts, multiline: true, rows: 6, onInput: (v) => { s.prompts = v; } }),
                TextField({ label: 'concurrency', type: 'number', min: 1, 'aria-label': 'batch concurrency', value: String(s.concurrency), onInput: (v) => { s.concurrency = v; } }),
                Btn({ variant: 'primary', disabled: s.busy, children: s.busy ? 'running…' : 'run batch', onClick: run })),
            s.result ? section('result', (() => {
                const r = s.result;
                const items = Array.isArray(r.results) ? r.results : (Array.isArray(r) ? r : null);
                if (!items) return h('pre', { class: 'fd-pre' }, JSON.stringify(r, null, 2));
                return [
                    Kpi({ items: [[items.length, 'prompts'], [items.filter(x => !x.error).length, 'ok'], [items.filter(x => x.error).length, 'errors']] }),
                    Table({ headers: ['#', 'prompt', 'status', 'output'], rows: items.map((x, i) => {
                        return [String(i + 1), truncSpan(x.prompt || x.input || '', TRUNC_PROMPT), x.error ? Chip({ tone: 'miss', children: 'error' }) : Chip({ tone: 'ok', children: 'ok' }), truncSpan(x.error || x.result || x.content || x.output || '', TRUNC_OUTPUT)];
                    }) }),
                ];
            })()) : null,
        ].filter(Boolean);
    };
});
