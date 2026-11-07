import { resolve } from 'node:path';
import { createGmClient } from './gm.js';

export { createGmClient };

export async function createClient(options) {
  return createGmClient(options);
}

export async function createThebird(options) {
  const gm = await createGmClient(options);
  const api = {};

  const methods = {
    read: 'read_file',
    write: 'write_file',
    edit: 'edit_file',
    stat: 'stat_file',
    list: 'list_dir',
    shell: 'run_shell',
    jobStart: 'job_start',
    jobStatus: 'job_status',
    jobStop: 'job_stop',
    log: 'query_log',
    search: 'search',
    wikiSearch: 'wiki_search',
    grep: 'grep',
    wikiWrite: 'wiki_write',
    reviewPacket: 'review_packet',
    reviewRecord: 'review_record',
    reviewJoin: 'review_join',
    fetch: 'fetch',
    callers: 'callers',
    impact: 'impact',
    gitStatus: 'git_status',
    gitAdd: 'git_add',
    gitRm: 'git_rm',
    gitCommit: 'git_commit',
    gitPush: 'git_push',
    gitLog: 'git_log',
    gitDiff: 'git_diff',
    gitShow: 'git_show',
    gitFetch: 'git_fetch',
    gitPull: 'git_pull',
    gitCheckout: 'git_checkout',
    gitBranch: 'git_branch',
    ciStatus: 'ci_status',
    prdAdd: 'prd_add',
    prdList: 'prd_list',
    prdResolve: 'prd_resolve',
    prdDelete: 'prd_delete',
    prdPark: 'prd_park',
    prdReopen: 'prd_reopen',
    unknownAdd: 'unknown_add',
    unknownList: 'unknown_list',
    unknownResolve: 'unknown_resolve',
  };
  for (const [name, verb] of Object.entries(methods)) api[name] = (args = {}) => gm.call(verb, args);

  const memoryReads = new Set(['search', 'get', 'read', 'lookup', 'find']);
  api.memory = (action, key) => {
    if (action !== undefined && !memoryReads.has(action)) {
      throw new Error('memory ' + action + ' is not mapped; write wiki pages with `gm wiki_write <json>` (needs sources and claims)');
    }
    return gm.call('wiki_search', { query: String(key ?? ''), k: 5 });
  };
  api.chat = (prompt) => gm.call('search', { query: String(prompt ?? ''), k: 5 });
  api.delegate = api.chat;
  api.webSearch = (query) => {
    const q = typeof query === 'string' ? query : (query?.query ?? query?.q ?? '');
    return gm.call('fetch', { url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(String(q)), maxBytes: 262144 });
  };
  api.gm = (name, args) => gm.call(name, args);
  api.tools = () => Object.keys(methods).concat(['memory', 'chat', 'delegate', 'webSearch', 'gm']).sort();
  api.skills = () => gm.call('wiki_search', { query: 'skill', k: 10 });
  api.sessions = () => gm.call('query_log', { kind: 'start', last: 20 });
  api.cron = (op, ...rest) => {
    if (op === 'list') return gm.call('prd_list', { status: 'open' });
    if (op === 'create') return gm.call('prd_add', { title: rest.slice(1).join(' ') || 'scheduled task', body: 'schedule: ' + String(rest[0] ?? '') });
    if (op === 'delete') return gm.call('prd_resolve', { id: String(rest[0] ?? ''), witness: 'resolved through thebird cron' });
    if (op === 'park') return gm.call('prd_park', { id: String(rest[0] ?? '') });
    if (op === 'reopen') return gm.call('prd_reopen', { id: String(rest[0] ?? '') });
    throw new Error('unknown cron op: ' + String(op));
  };
  api.batch = async (...verbs) => {
    const out = [];
    for (const [name, args] of verbs) out.push({ name, result: await gm.call(name, args || {}) });
    return { ok: true, output: JSON.stringify(out, null, 2) };
  };
  api.projects = (op, name) => {
    if (op === 'list' || op === 'active' || !op) return { ok: true, output: gm.workspace };
    if (op === 'switch' && name) return { ok: true, output: resolve(gm.workspace, name), note: 'create a client with workspace to switch' };
    throw new Error('unknown projects op: ' + String(op));
  };
  api.config = (op, key, value) => {
    if (op === 'get') return { ok: true, output: JSON.stringify({ [key]: value ?? null }) };
    if (op === 'set') return { ok: true, output: 'set ' + String(key) };
    return { ok: true, output: JSON.stringify({ gmHome: gm.gmHome, workspace: gm.workspace, runDir: gm.runDir }) };
  };
  api.client = gm;
  api.close = () => gm.close();
  return api;
}

export default createThebird;
