// Tools-ish freddie pages: analytics, models, cron, skills, config, env, tools, batch, gateway.
import * as webjsx from '../../../../vendor/webjsx/index.js';
import * as components from '../../../components.js';
import { pre, form, skillLabel } from '../../../components/freddie/helpers.js';

const h = webjsx.createElement;
const { Panel, Row, Receipt, Kpi, Table, Section, EmptyState, Chip, Icon } = components;

export function makeToolsPages(ctx) {
    const { rerender } = ctx;
    return {
        async analytics(h0) {
            const list = await h0.pi.sessions.list();
            const tools = [...h0.pi.tools.values()];
            const byPlatform = list.reduce((a, s) => { const k = s.platform || 'unknown'; a[k] = (a[k] || 0) + 1; return a; }, {});
            const byModel = list.reduce((a, s) => { const k = s.model || 'unknown'; a[k] = (a[k] || 0) + 1; return a; }, {});
            const byToolset = tools.reduce((a, t) => { (a[t.toolset || 'core'] = a[t.toolset || 'core'] || []).push(t.name); return a; }, {});
            return [
                Kpi({ items: [[list.length, 'sessions'], [tools.length, 'tools']] }),
                Panel({ title: 'sessions by platform', children: Object.keys(byPlatform).length === 0
                    ? EmptyState({ text: 'no data', glyph: Icon('activity') })
                    : Table({ headers: ['platform', 'count'], striped: true, rows: Object.entries(byPlatform).sort((a, b) => b[1] - a[1]) }) }),
                Panel({ title: 'sessions by model', children: Object.keys(byModel).length === 0
                    ? EmptyState({ text: 'no data', glyph: Icon('circle-dot') })
                    : Table({ headers: ['model', 'count'], striped: true, rows: Object.entries(byModel).sort((a, b) => b[1] - a[1]) }) }),
                Panel({ title: 'tool distribution', children: Table({ headers: ['toolset', 'count', 'tools'], striped: true,
                    rows: Object.entries(byToolset).map(([k, v]) => [k, v.length, v.slice(0, 4).join(', ') + (v.length > 4 ? '…' : '')]) }) }),
            ];
        },
        async models(h0) {
            const cfg = (typeof h0.pi.config?.load === 'function') ? await h0.pi.config.load() : {};
            const agent = cfg.agent || {};
            const providers = await fetch('/api/providers').then(r => r.json()).catch(() => []);
            return [
                Kpi({ items: [[agent.provider || '—', 'provider'], [agent.model || '—', 'model']] }),
                Panel({ title: 'active model', children: Receipt({ rows: [
                    ['provider', agent.provider || '(unset)'],
                    ['model', agent.model || '(unset)'],
                    ['max_iterations', String(agent.max_iterations || '—')],
                    ['max_tokens', String(agent.max_tokens || '—')],
                    ['temperature', String(agent.temperature ?? '—')],
                ] }) }),
                Panel({ title: 'change model', children: form({
                    fields: [{ name: 'provider', placeholder: 'provider', value: agent.provider || '' }, { name: 'model', placeholder: 'model id', value: agent.model || '' }],
                    submit: 'update',
                    onSubmit: async (ev) => {
                        await h0.pi.config.saveValue('agent.provider', ev.target.elements.provider.value);
                        await h0.pi.config.saveValue('agent.model', ev.target.elements.model.value);
                        rerender();
                    },
                }) }),
                Panel({ title: 'provider availability', children: h('div', { class: 'fd-chip-wrap' },
                    ...providers.map(p => Chip({ tone: p.configured ? (p.available ? 'ok' : 'warn') : 'miss', children: [p.name, ' ', p.configured ? (p.available ? Icon('circle-dot') : Icon('circle')) : Icon('dot')] }))
                ) }),
            ];
        },
        async cron(h0) {
            const list = await h0.pi.cron.list();
            return [
                Kpi({ items: [[list.length, 'cron jobs']] }),
                Panel({ title: 'add job', children: form({
                    fields: [{ name: 'cron', placeholder: '* * * * *', required: true }, { name: 'prompt', placeholder: 'prompt', required: true }],
                    submit: 'create',
                    onSubmit: async (ev) => { try { await h0.pi.cron.create({ cron: ev.target.elements.cron.value, prompt: ev.target.elements.prompt.value }); rerender(); } catch (e) { alert(e.message); } },
                }) }),
                Panel({ title: 'scheduled jobs', count: list.length, children: list.length === 0
                    ? EmptyState({ text: 'no cron jobs — add one above', glyph: Icon('circle') })
                    : Table({ headers: ['id', 'cron', 'prompt', 'enabled'], striped: true,
                        rows: list.map(j => [j.id, j.cron, (j.prompt || '').slice(0, 40), j.enabled ? 'yes' : 'no']) }) }),
            ];
        },
        async skills(h0) {
            const list = [...h0.pi.skills.values()];
            const byCat = list.reduce((a, s) => { (a[s.category || 'other'] = a[s.category || 'other'] || []).push(s); return a; }, {});
            return [
                Kpi({ items: [[list.length, 'skills'], [Object.keys(byCat).length, 'categories']] }),
                list.length === 0 ? EmptyState({ text: 'no skills loaded — add SKILL.md files to ~/.freddie/skills/', glyph: Icon('square') }) : null,
                ...Object.entries(byCat).map(([cat, ss]) => Panel({ title: cat, count: ss.length,
                    children: ss.length === 0 ? EmptyState({ text: 'none', glyph: Icon('square') })
                        : Table({ headers: ['name', 'description'], striped: true, rows: ss.map(s => [skillLabel(s), (s.description || '').slice(0, 120)]) }) })),
            ].filter(Boolean);
        },
        async config(h0) {
            const cfg = (typeof h0.pi.config?.load === 'function') ? await h0.pi.config.load() : {};
            const profiles = (typeof h0.pi.profiles?.list === 'function') ? h0.pi.profiles.list() : [];
            const commands = (typeof h0.pi.commands?.list === 'function') ? h0.pi.commands.list() : [];
            return [
                Kpi({ items: [[profiles.length, 'profiles'], [commands.length, 'commands'], [cfg._config_version || 0, 'config version']] }),
                Panel({ title: 'set config value', children: form({
                    fields: [{ name: 'key', placeholder: 'dotted.key (e.g. agent.model)', required: true }, { name: 'value', placeholder: 'value (json or string)', required: true }],
                    submit: 'save',
                    onSubmit: async (ev) => {
                        let v = ev.target.elements.value.value;
                        try { v = JSON.parse(v); } catch { /* swallow: value may be a plain string, not JSON — keep it as-is */ }
                        await h0.pi.config.saveValue(ev.target.elements.key.value, v);
                        rerender();
                    },
                }) }),
                Panel({ title: 'commands', count: commands.length,
                    children: Table({ headers: ['name', 'category', 'description'], striped: true, rows: commands.map(c => [c.name, c.category || '', c.description || '']) }) }),
                Panel({ title: 'active config', children: pre(cfg) }),
            ];
        },
        async env(h0) {
            const list = (typeof h0.pi.env?.list === 'function') ? h0.pi.env.list() : [];
            const setCount = list.filter(k => k.set).length;
            const makeEditEnvVar = (k) => () => {
                const v = prompt('set ' + k.key + ' (empty to unset):');
                if (v == null) return;
                if (typeof h0.pi.env.set === 'function') { h0.pi.env.set(k.key, v); rerender(); }
            };
            const chipNodes = list.map(k => {
                const editEnvVar = makeEditEnvVar(k);
                return h(
                    'span',
                    {
                        key: k.key,
                        class: 'fd-env-chip',
                        role: 'button',
                        tabindex: '0',
                        'aria-label': 'edit environment variable ' + k.key,
                        onclick: editEnvVar,
                        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editEnvVar(); } },
                    },
                    Chip({ tone: k.set ? 'ok' : 'miss', children: k.key + (k.set ? ' [x]' : ' [ ]') })
                );
            });
            return [
                Kpi({ items: [[setCount, 'set'], [list.length - setCount, 'missing'], [list.length, 'total known']] }),
                Panel({
                    title: 'environment variables',
                    right: h('span', {}, Chip({ tone: 'ok', children: setCount + ' set' }), ' ', Chip({ tone: 'miss', children: (list.length - setCount) + ' missing' })),
                    children: h('div', { class: 'fd-chip-wrap fd-chip-wrap-padded' }, ...chipNodes),
                }),
            ];
        },
        async tools(h0) {
            const list = [...h0.pi.tools.values()];
            const byToolset = list.reduce((a, t) => { (a[t.toolset || 'core'] = a[t.toolset || 'core'] || []).push(t); return a; }, {});
            return [
                Kpi({ items: [[list.length, 'tools'], [Object.keys(byToolset).length, 'toolsets']] }),
                ...Object.entries(byToolset).map(([ts, items]) => Panel({ title: 'toolset · ' + ts, count: items.length,
                    children: items.map(t => Row({ key: t.name, code: Icon('settings'), title: t.name, sub: (t.description || (t.schema && t.schema.description) || '').slice(0, 80) })) })),
            ];
        },
        async batch(h0) {
            const out = h('div', { id: 'fd-batch-out' });
            const root = ctx.root;
            return [
                Section({ title: 'batch runner', children: [
                    Panel({ title: 'run prompts', children: form({
                        fields: [{ name: 'prompts', kind: 'textarea', placeholder: 'one prompt per line' }, { name: 'concurrency', type: 'number', value: '4' }],
                        submit: 'run',
                        onSubmit: async (ev) => {
                            const prompts = ev.target.elements.prompts.value.split('\n').map(s => s.trim()).filter(Boolean);
                            if (!prompts.length) return;
                            const node = root.querySelector('#fd-batch-out');
                            if (node) node.textContent = 'running…';
                            try {
                                const r = await h0.pi.batch.run({ prompts, concurrency: Number(ev.target.elements.concurrency.value) || 4 });
                                if (node) { node.innerHTML = ''; node.appendChild(document.createTextNode(JSON.stringify(r, null, 2))); }
                            } catch (e) { if (node) node.textContent = 'error: ' + (e.message || e); }
                        },
                    }) }),
                    Panel({ title: 'results', children: out }),
                    Panel({ title: 'cli usage', children: Receipt({ rows: [
                        ['run batch file', 'freddie batch prompts.txt'],
                        ['set concurrency', 'freddie batch prompts.txt --concurrency 8'],
                        ['jsonl output', 'freddie batch prompts.txt > out.jsonl'],
                    ] }) }),
                ] }),
            ];
        },
        async gateway(h0) {
            const platforms = (typeof h0.pi.gateway?.platforms === 'function') ? h0.pi.gateway.platforms() : [];
            const active = platforms.filter(p => p.enabled);
            return [
                Kpi({ items: [[platforms.length, 'platforms'], [active.length, 'active']] }),
                Panel({ title: 'platforms', count: platforms.length,
                    right: active.length > 0 ? Chip({ tone: 'ok', children: active.length + ' active' }) : Chip({ tone: 'miss', children: 'none active' }),
                    children: platforms.length === 0 ? EmptyState({ text: 'no platforms registered', glyph: Icon('arrow-right') })
                        : platforms.map(p => Row({ key: p.name, code: p.enabled ? Icon('circle-dot') : Icon('circle'), title: p.name, sub: p.note || '', meta: p.enabled ? 'enabled' : '' })) }),
                Panel({ title: 'start gateway', children: Receipt({ rows: [
                    ['webhook + api_server', 'freddie gateway --port 3000'],
                    ['specific platform', 'TELEGRAM_BOT_TOKEN=… freddie gateway'],
                    ['all platforms', 'set env vars per platform, then freddie gateway'],
                ] }) }),
            ];
        },
    };
}
