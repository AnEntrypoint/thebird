// Freddie overview pages: the dashboard `home` KPI roll-up, `agents` live
// activity, and `analytics` provider/sampler health. All read-only polling
// pages over /api/health, /api/agents, /api/sessions and /api/models/*.

import { makePage, api, loadingState, errorState, emptyState, refreshError } from './runtime.js';
import { Table, Kpi, PageHeader } from '../content.js';
import { fmtAgo } from '../sessions.js';
import { section, truncSpan, truncJson, TRUNC_TITLE } from './shared.js';

export const home = makePage((ctx) => {
    async function load() {
        try {
            // tools/skills counts come from the host when injected; otherwise
            // fall back to the same /api/* endpoints the tools/skills pages use
            // so the home KPIs never render an em-dash placeholder.
            const needTools = ctx.host?.pi?.tools?.size == null;
            const needSkills = ctx.host?.pi?.skills?.size == null;
            const [health, agents, sessions, toolsList, skillsList] = await Promise.all([
                api('/api/health').catch(() => null),
                api('/api/agents').catch(() => null),
                api('/api/sessions').catch((e) => ({ _err: e })),
                needTools ? api('/api/tools').catch(() => null) : Promise.resolve(null),
                needSkills ? api('/api/skills').catch(() => null) : Promise.resolve(null),
            ]);
            const toolsCount = needTools ? (Array.isArray(toolsList) ? toolsList.length : (toolsList?.tools?.length ?? null)) : null;
            const skillsCount = needSkills ? (Array.isArray(skillsList) ? skillsList.length : (skillsList?.skills?.length ?? null)) : null;
            const sessFailed = sessions && sessions._err;
            ctx.set({ loading: false, health, agents, sessions: Array.isArray(sessions) ? sessions : [], sessFailed, toolsCount, skillsCount, error: null });
        } catch (e) { ctx.set({ loading: false, error: e }); }
    }
    load();
    ctx.interval(load, 15000);
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading dashboard…');
        if (s.error) return errorState(s.error, load);
        const sessions = s.sessions || [];
        const agents = s.agents || {};
        const tools = ctx.host?.pi?.tools?.size ?? s.toolsCount ?? '—';
        const skills = ctx.host?.pi?.skills?.size ?? s.skillsCount ?? '—';
        return [
            PageHeader({ title: 'dashboard', lede: 'agent harness · live overview' }),
            Kpi({ items: [
                [tools, 'tools'],
                [skills, 'skills'],
                [sessions.length, 'sessions'],
                [agents.count ?? 0, 'active agents'],
            ] }),
            section('recent sessions',
                s.sessFailed
                    ? errorState(new Error('could not load sessions'))
                    : sessions.length
                        ? Table({
                            headers: ['session', 'platform', 'updated'],
                            rows: sessions.slice(0, 8).map(x => [truncSpan(x.title || x.id, TRUNC_TITLE), x.platform || '—', fmtAgo(x.updated_at)]),
                        })
                        : emptyState('no sessions yet')),
            section('health',
                s.health ? Table({ headers: ['check', 'status'], rows: Object.entries(s.health).map(([k, v]) => [k, typeof v === 'object' ? truncJson(v) : String(v)]) })
                    : emptyState('health endpoint unavailable')),
        ];
    };
});

export const agents = makePage((ctx) => {
    async function load() { try { ctx.set({ loading: false, data: await api('/api/agents'), error: null }); } catch (e) { ctx.set({ loading: false, error: e }); } }
    load(); ctx.interval(load, 5000);
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading agents…');
        if (s.error && !s.data) return errorState(s.error, load);
        const d = s.data || {};
        return [
            PageHeader({ title: 'agents', lede: 'live agent activity' }),
            s.error && s.data ? refreshError(s.error) : null,
            Kpi({ items: [[d.count ?? 0, 'active'], [d.turns ?? 0, 'total turns'], [d.last_activity ? fmtAgo(d.last_activity) : '—', 'last activity']] }),
            section('detail', Table({ headers: ['field', 'value'], rows: Object.entries(d).map(([k, v]) => [k, String(v)]) })),
        ].filter(Boolean);
    };
});

export const analytics = makePage((ctx) => {
    async function load() {
        try {
            const [sampler, avail] = await Promise.all([
                api('/api/models/sampler').catch(() => null),
                api('/api/models/availability/summary').catch(() => null),
            ]);
            ctx.set({ loading: false, sampler, avail, error: null });
        } catch (e) { ctx.set({ loading: false, error: e }); }
    }
    load(); ctx.interval(load, 15000);
    return () => {
        const s = ctx.state;
        if (s.loading) return loadingState('loading analytics…');
        if (s.error && !s.sampler && !s.avail) return errorState(s.error, load);
        const samp = s.sampler?.status ? Object.values(s.sampler.status) : [];
        const ok = samp.filter(x => x && x.available !== false).length;
        const sum = s.avail?.summary || {};
        return [
            PageHeader({ title: 'analytics', lede: 'provider availability & sampler health' }),
            s.error && (s.sampler || s.avail) ? refreshError(s.error) : null,
            Kpi({ items: [[ok + '/' + samp.length, 'providers up'], [sum.total_models ?? '—', 'models'], [sum.usable_in_any_mode ?? '—', 'usable']] }),
            section('sampler', samp.length ? Table({ headers: ['provider', 'available', 'fails'], rows: Object.entries(s.sampler.status).map(([k, v]) => [k, v.available === false ? 'no' : 'yes', String(v.failCount ?? 0)]) }) : emptyState('no sampler data')),
        ].filter(Boolean);
    };
});
