const METHODS = {
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

const MEMORY_READS = new Set(['search', 'get', 'read', 'lookup', 'find']);
const MEMORY_WRITES = new Set(['write', 'set', 'put', 'store']);

export function asciiText(text) {
  return text.replace(/[^\x00-\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export async function sourceIdOf(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

export function joinPath(base, name) {
  const parts = (name.startsWith('/') ? name : base + '/' + name).split('/');
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export function createApi(gm) {
  const api = {};
  for (const [name, verb] of Object.entries(METHODS)) api[name] = (args = {}) => gm.call(verb, args);

  api.memory = async (action, key, value) => {
    if (action === undefined || MEMORY_READS.has(action)) return gm.call('wiki_search', { query: String(key ?? ''), k: 5 });
    if (!MEMORY_WRITES.has(action)) throw new Error('memory ' + action + ' is not mapped; use memory write <key> <value> or memory search <query>');
    if (value === undefined) throw new Error('memory write needs a key and a value');
    const body = asciiText(String(value));
    const id = await sourceIdOf(body);
    await gm.call('write_file', { path: 'sources/' + id + '.txt', content: body });
    const summary = body.split('\n')[0].trim().slice(0, 80) || String(key);
    return gm.call('wiki_write', { page: String(key), title: String(key), body, summary, sources: [id] });
  };
  api.chat = (prompt) => gm.call('search', { query: String(prompt ?? ''), k: 5 });
  api.delegate = api.chat;
  api.webSearch = (query) => {
    const q = typeof query === 'string' ? query : (query?.query ?? query?.q ?? '');
    return gm.call('fetch', { url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(String(q)), maxBytes: 262144 });
  };
  api.gm = (name, args) => gm.call(name, args);
  api.tools = () => Object.keys(METHODS).concat(['memory', 'chat', 'delegate', 'webSearch', 'gm']).sort();
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
    if (op === 'switch' && name) return { ok: true, output: joinPath(gm.workspace, name), note: 'create a client with workspace to switch' };
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

export default createApi;
