export const COMMANDS = {
  help: { usage: 'help', api: 'help', describe: 'List commands' },
  tools: { usage: 'tools', api: 'tools', describe: 'List thebird tool names' },
  skills: { usage: 'skills', api: 'skills', describe: 'Search gm skill/knowledge resources' },
  read: { usage: 'read <path> [offset] [limit]', api: 'read', args: ['path', 'offset', 'limit'], describe: 'Read a text file through gm' },
  write: { usage: 'write <path> <content...>', api: 'write', args: ['path', 'content'], joinLast: 'content', describe: 'Write a text file through gm' },
  edit: { usage: 'edit <path> <old> <new>', api: 'edit', args: ['path', 'old', 'new'], describe: 'Replace text through gm' },
  stat: { usage: 'stat <path>', api: 'stat', args: ['path'], describe: 'Stat a path through gm' },
  ls: { usage: 'ls [path] [prefix] [offset] [limit]', api: 'list', args: ['path', 'prefix', 'offset', 'limit'], defaults: { path: '.' }, describe: 'List a directory through gm' },
  list: { usage: 'list [path] [prefix] [offset] [limit]', api: 'list', args: ['path', 'prefix', 'offset', 'limit'], defaults: { path: '.' }, describe: 'Alias of ls' },
  grep: { usage: 'grep <pattern> [path] [mode] [scope]', api: 'grep', args: ['pattern', 'path', 'mode', 'scope'], describe: 'Search file text through gm' },
  search: { usage: 'search <query...> [k]', api: 'search', args: ['query'], joinLast: 'query', trailingNumber: 'k', describe: 'BM25 code search through gm' },
  shell: { usage: 'shell <command...>', api: 'shell', args: ['command'], joinLast: 'command', describe: 'Run a shell command through gm' },
  exec: { usage: 'exec <command...>', api: 'shell', args: ['command'], joinLast: 'command', describe: 'Alias of shell' },
  run: { usage: 'run <prompt...>', api: 'chat', args: ['prompt'], joinLast: 'prompt', describe: 'Run one prompt through the gm-backed research path' },
  memory: { usage: 'memory <action> <key> [value]', api: 'memory', args: ['action', 'key', 'value'], raw: true, describe: 'Look up persistent knowledge through gm' },
  chat: { usage: 'chat <prompt...>', api: 'chat', args: ['prompt'], joinLast: 'prompt', describe: 'Alias of run' },
  delegate: { usage: 'delegate <prompt...>', api: 'delegate', args: ['prompt'], joinLast: 'prompt', describe: 'Delegate through the gm-backed research path' },
  'web-search': { usage: 'web-search <query...>', api: 'webSearch', args: ['query'], joinLast: 'query', describe: 'Fetch DuckDuckGo HTML results through gm fetch' },
  fetch: { usage: 'fetch <url> [maxBytes]', api: 'fetch', args: ['url', 'maxBytes'], describe: 'HTTP GET through gm' },
  job: { usage: 'job <start|status|stop> <name> [command...]', api: 'job', raw: true, describe: 'Manage background gm jobs' },
  log: { usage: 'log [last]', api: 'log', args: ['last'], describe: 'Query the gm run log' },
  git: { usage: 'git <verb> [args...]', api: 'git', raw: true, describe: 'Dispatch a gm git verb' },
  prd: { usage: 'prd <list|add|resolve|delete|park|reopen> [args...]', api: 'prd', raw: true, describe: 'Dispatch a gm PRD verb' },
  unknown: { usage: 'unknown <list|add|resolve> [args...]', api: 'unknown', raw: true, describe: 'Dispatch a gm open-question verb' },
  cron: { usage: 'cron <list|create|delete|park|reopen> [args...]', api: 'cron', args: ['op', 'schedule', 'prompt'], raw: true, describe: 'Compatibility command mapped to gm rows' },
  sessions: { usage: 'sessions', api: 'sessions', describe: 'List gm run sessions' },
  projects: { usage: 'projects [list|active|switch <name>]', api: 'projects', args: ['op', 'name'], raw: true, describe: 'Show the gm workspace' },
  config: { usage: 'config [get <key> <value>|set <key> <value>]', api: 'config', args: ['op', 'key', 'value'], raw: true, describe: 'Show gm client configuration' },
  batch: { usage: 'batch <verb> [json] ...', api: 'batch', raw: true, describe: 'Run gm verbs in sequence' },
  gm: { usage: 'gm <verb> [json]', api: 'gm', raw: true, describe: 'Call any gm verb with a JSON object' },
  repl: { usage: 'repl', api: 'repl', describe: 'Start the interactive CLI' },
  exit: { usage: 'exit', api: 'exit', describe: 'Leave the interactive CLI' },
};

const NUMERIC = new Set(['offset', 'limit', 'k', 'maxBytes', 'last']);

export function commandArgs(spec, argv) {
  if (spec.raw && !spec.args) return argv;
  const out = { ...(spec.defaults || {}) };
  const names = spec.args || [];
  const joinAt = spec.joinLast ? names.indexOf(spec.joinLast) : -1;
  let trailing = null;
  if (spec.trailingNumber && argv.length > names.length && /^\d+$/.test(argv.at(-1))) trailing = Number(argv.at(-1));
  for (let i = 0; i < names.length; i++) {
    const key = names[i];
    let value;
    if (key === spec.joinLast) {
      const end = trailing === null ? argv.length : argv.length - 1;
      value = argv.slice(i, end).join(' ');
    } else {
      value = argv[i];
    }
    if (value === undefined || value === '') continue;
    out[key] = NUMERIC.has(key) ? Number(value) : value;
  }
  if (trailing !== null) out[spec.trailingNumber] = trailing;
  return out;
}

export function helpText() {
  return Object.entries(COMMANDS).map(([name, spec]) => '  ' + spec.usage.padEnd(58) + spec.describe).join('\n');
}
