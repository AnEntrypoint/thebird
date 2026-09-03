// Core freddie pages: projects, home, sessions, agents, logs.
import * as webjsx from '../../../../vendor/webjsx/index.js';
import * as components from '../../../components.js';
import { pre, form, skillLabel } from '../../../components/freddie/helpers.js';

const h = webjsx.createElement;
const { Panel, Row, Hero, Receipt, Kpi, Table, EmptyState, Icon } = components;

export function makeCorePages(ctx) {
    return {
        async projects(h0) {
            const list = h0.pi.projects.list();
            const activeProj = (typeof h0.pi.projects.active === 'function') ? h0.pi.projects.active() : null;
            const rows = list.map(p => Row({
                key: p.name,
                code: p.name === activeProj?.name ? Icon('circle-dot') : Icon('circle'),
                title: p.name + (p.name === activeProj?.name ? '  (active)' : ''),
                meta: p.path,
                onClick: () => { if (p.name !== activeProj?.name) try { h0.pi.projects.setActive(p.name); ctx.rerender(); } catch (e) { alert(e.message); } },
            }));
            return [
                Hero({ title: 'projects', body: 'each project is its own ~/.freddie home: separate sessions, agents, skills, config, env, cron, batches.', accent: activeProj ? 'active · ' + activeProj.name : 'no active project' }),
                Kpi({ items: [[list.length, 'projects'], [activeProj?.name || '—', 'active'], [activeProj?.path?.length > 30 ? '…' + activeProj.path.slice(-28) : (activeProj?.path || '—'), 'path']] }),
                Panel({ title: 'add a project', children: form({
                    fields: [{ name: 'name', placeholder: 'project name', required: true }, { name: 'path', placeholder: '/abs/path' }],
                    submit: 'add',
                    onSubmit: (ev) => { try { h0.pi.projects.create({ name: ev.target.elements.name.value, path: ev.target.elements.path.value }); ctx.rerender(); } catch (e) { alert(e.message); } },
                }) }),
                Panel({ title: 'all projects', count: list.length, children: rows.length ? rows : EmptyState({ text: 'no projects', glyph: Icon('square') }) }),
                Panel({ title: 'how encapsulation works', children: Receipt({ rows: [
                    ['sessions db', '<project>/sessions.db'],
                    ['config', '<project>/config.json'],
                    ['skills', '<project>/skills/'],
                    ['plugins', '<project>/plugins/'],
                    ['cron', '<project>/cron.db'],
                    ['batches', '<project>/batches/'],
                    ['logs', '<project>/logs/'],
                    ['auth', '<project>/auth.json'],
                ] }) }),
            ];
        },
        async home(h0) {
            const sessions = await h0.pi.sessions.list();
            const tools = h0.pi.tools.size;
            const skills = h0.pi.skills.size;
            const health = (typeof h0.pi.health === 'function') ? h0.pi.health() : { ok: true };
            // Epoch-ms fields (ts, or any *At/*Time-suffixed key) render as raw
            // 13-digit numbers otherwise -- unreadable and gives no sense of
            // recency. Format as a locale timestamp; anything that doesn't
            // parse as a plausible epoch-ms value falls through to String(v)
            // unchanged so this never mangles a genuine small integer.
            const isEpochMsKey = (k) => k === 'ts' || /(At|Time)$/.test(k);
            const fmtHealthValue = (k, v) => {
                if (isEpochMsKey(k) && typeof v === 'number' && v > 1e12) return new Date(v).toLocaleString();
                return String(v);
            };
            return [
                Hero({ title: 'assistant', body: 'open js agent harness — in-page agent runtime.', accent: h0.version || 'web' }),
                Kpi({ items: [[sessions.length, 'sessions'], [tools, 'tools'], [skills, 'skills']] }),
                Panel({ title: 'quick start', children: Receipt({ rows: [
                    ['open chat',   "click 'chat' in sidebar — set a working directory and pick a skill"],
                    ['pick skill',  "software dev, research, planning — shown with descriptions"],
                    ['pick model',  "select a configured provider + model in the chat bar"],
                    ['list tools',  '/tools in chat -> tools tab'],
                    ['set api key', 'keys tab -> click chip to set value'],
                    ['add cron',    'cron tab -> form'],
                ] }) }),
                Panel({ title: 'host', children: Receipt({ rows: Object.entries(health).map(([k, v]) => [k, fmtHealthValue(k, v)]) }) }),
            ];
        },
        async sessions(h0) {
            const list = await h0.pi.sessions.list();
            const rows = list.map(s => {
                const cont = h('button', {
                    class: 'btn-primary fd-btn-mini',
                    onclick: async () => {
                        const msgs = await h0.pi.sessions.getMessages(s.id);
                        const cs = window.__fd_chatState = window.__fd_chatState || { messages: [], busy: false, sessionId: null, cwd: '', skill: '', provider: '', model: '' };
                        cs.sessionId = s.id;
                        cs.messages = msgs.map(m => ({ role: m.role, content: String(m.content || '') }));
                        if (s.cwd) cs.cwd = s.cwd;
                        if (s.skill) cs.skill = s.skill;
                        if (typeof window.__fd_nav === 'function') window.__fd_nav('chat');
                    },
                }, 'continue');
                return [(s.id || '').slice(0, 8), s.title || '—', s.platform || '—', s.model || '—', s.cwd ? s.cwd.slice(-30) : '—', s.skill ? skillLabel({ name: s.skill }) : '—', cont];
            });
            return [
                Kpi({ items: [[list.length, 'sessions']] }),
                Panel({ title: 'recent sessions', count: list.length, children: list.length === 0
                    ? EmptyState({ text: 'no sessions yet — open chat and send a message', glyph: Icon('thread') })
                    : Table({ headers: ['id', 'title', 'platform', 'model', 'cwd', 'skill', ''], striped: true, rows }) }),
            ];
        },
        async agents(h0) {
            const a = (typeof h0.pi.agents === 'function') ? await h0.pi.agents() : { count: 0, turns: 0, active: null };
            const subagents = (h0.pi.subagents && typeof h0.pi.subagents.list === 'function') ? await h0.pi.subagents.list() : [];
            const sorted = [...subagents].sort((x, y) => String(y.created_at || '').localeCompare(String(x.created_at || '')));
            const rows = sorted.map(s => Row({
                key: s.agent_id,
                code: s.status === 'completed' ? Icon('circle-dot') : s.status === 'running' ? Icon('circle') : Icon('circle'),
                title: `${s.agent_id}  [${s.status}]`,
                meta: `${s.subagent_type || '?'} · depth ${s.depth ?? '?'} · ${s.description || (s.task || '').slice(0, 60)}`,
            }));
            return [
                Kpi({ items: [[a.count || 0, 'active'], [a.turns || 0, 'turns'], [subagents.length, 'subagents']] }),
                Panel({ title: 'agent overview', children: Receipt({ rows: [
                    ['total turns', String(a.turns || 0)],
                    ['active session', a.active || '—'],
                    ['last activity', a.last_activity ? new Date(a.last_activity).toLocaleString() : '—'],
                ] }) }),
                Panel({ title: 'subagents (fan-out)', count: rows.length, children: rows.length === 0
                    ? EmptyState({ text: 'no subagents yet — agent_swarm/delegate spawns appear here live', glyph: Icon('members') })
                    : h('div', null, rows) }),
            ];
        },
        async logs(h0) {
            const dbg = (typeof h0.pi.debug === 'function') ? h0.pi.debug() : { note: 'no debug surface' };
            return [Panel({ title: 'host debug snapshot', children: pre(dbg) })];
        },
    };
}
