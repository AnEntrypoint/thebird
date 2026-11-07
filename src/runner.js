import { COMMANDS, commandArgs, helpText } from './commands.js';

export function textOf(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (typeof result.output === 'string') return result.output;
  return JSON.stringify(result, null, 2);
}

export function tokenize(line) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{' && cur === '') {
      const end = jsonEnd(line, i);
      out.push(line.slice(i, end + 1));
      i = end;
    }
    else if (/\s/.test(c)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function jsonEnd(line, start) {
  let depth = 0;
  let inString = false;
  for (let j = start; j < line.length; j++) {
    const c = line[j];
    if (inString) {
      if (c === '\\') j++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j;
  }
  return line.length - 1;
}

function jsonArg(text, fallback) {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

const GIT_VERBS = {
  status: 'git_status', add: 'git_add', rm: 'git_rm', commit: 'git_commit', push: 'git_push',
  log: 'git_log', diff: 'git_diff', show: 'git_show', fetch: 'git_fetch', pull: 'git_pull',
  checkout: 'git_checkout', branch: 'git_branch', ci: 'ci_status',
};
const PRD_VERBS = {
  list: 'prd_list', add: 'prd_add', resolve: 'prd_resolve', delete: 'prd_delete',
  park: 'prd_park', reopen: 'prd_reopen',
};
const UNKNOWN_VERBS = { list: 'unknown_list', add: 'unknown_add', resolve: 'unknown_resolve' };

export function createRunner(api) {
  return async function runCommand(line) {
    const argv = tokenize(line.trim());
    const name = argv.shift();
    if (!name) return '';
    const spec = COMMANDS[name];
    if (!spec) return 'unknown command: ' + name + ' (try help)';
    if (spec.api === 'help') return 'thebird — gm-backed CLI\n\n' + helpText();
    if (spec.api === 'exit') return { exit: true };
    if (spec.api === 'repl') return 'already in the interactive CLI';

    let target = spec.api;
    const rawCompat = ['memory', 'cron', 'projects', 'config'].includes(target);
    let args = rawCompat ? argv : commandArgs(spec, argv);
    if (target === 'shell') args = { command: line.trim().slice(name.length).trim() };
    if (target === 'job') {
      const [op, job, ...rest] = argv;
      const verb = { start: 'job_start', status: 'job_status', stop: 'job_stop' }[op];
      if (!verb) throw new Error('job takes start, status or stop');
      target = 'gm';
      args = [verb, { job, command: rest.join(' '), ...(op === 'status' ? { waitMs: 100 } : {}) }];
    } else if (target === 'git') {
      const [op, ...rest] = argv;
      const verb = GIT_VERBS[op];
      if (!verb) throw new Error('unknown git op: ' + String(op));
      target = 'gm';
      args = [verb, gitArgs(verb, rest)];
    } else if (target === 'prd') {
      const [op, ...rest] = argv;
      const verb = PRD_VERBS[op];
      if (!verb) throw new Error('unknown prd op: ' + String(op));
      target = 'gm';
      args = [verb, rowArgs(verb, rest)];
    } else if (target === 'unknown') {
      const [op, ...rest] = argv;
      const verb = UNKNOWN_VERBS[op];
      if (!verb) throw new Error('unknown op: ' + String(op));
      target = 'gm';
      args = [verb, rowArgs(verb, rest)];
    } else if (target === 'gm') {
      const [verb, ...rest] = argv;
      if (!verb) throw new Error('gm needs a verb name');
      args = [verb, rest.length === 1 && rest[0].startsWith('{') ? jsonArg(rest[0], {}) : pairsFrom(['_', ...rest])[0][1]];
    } else if (target === 'batch') {
      args = pairsFrom(argv);
    }

    let result;
    if (target === 'batch') result = await api.batch(...args);
    else if (target === 'gm' && Array.isArray(args)) result = await api.gm(args[0], args[1]);
    else if (['memory', 'cron', 'projects', 'config'].includes(target)) result = await api[target](...args);
    else result = await api[target](args);
    return textOf(result);
  };
}

function pairsFrom(argv) {
  const pairs = [];
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    const next = argv[i + 1];
    if (next && next.startsWith('{')) {
      pairs.push([name, jsonArg(next, {})]);
      i += 1;
    } else if (next && next.includes('=') && !next.startsWith('{')) {
      const args = {};
      while (i + 1 < argv.length && argv[i + 1].includes('=') && !argv[i + 1].startsWith('{')) {
        const eq = argv[i + 1].indexOf('=');
        const key = argv[i + 1].slice(0, eq);
        const raw = argv[i + 1].slice(eq + 1);
        args[key] = /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw;
        i += 1;
      }
      pairs.push([name, args]);
    } else {
      pairs.push([name, {}]);
    }
  }
  return pairs;
}

function gitArgs(verb, rest) {
  if (verb === 'git_add' || verb === 'git_rm' || verb === 'git_commit' || verb === 'git_diff') {
    if (verb === 'git_commit') return { message: rest[0] || 'thebird', paths: rest.slice(1) };
    return { paths: rest };
  }
  if (verb === 'git_log') return { count: Number(rest[0]) || 20 };
  if (verb === 'git_show') return { ref: rest[0] || 'HEAD' };
  if (verb === 'git_checkout') return { ref: rest[0] || '' };
  if (verb === 'ci_status') return rest[0] ? { sha: rest[0] } : {};
  return {};
}

function rowArgs(verb, rest) {
  if (verb === 'prd_add' || verb === 'unknown_add') return { title: rest.join(' ') || 'untitled' };
  if (verb === 'prd_list' || verb === 'unknown_list') return rest[0] ? { status: rest[0] } : {};
  if (verb === 'prd_resolve' || verb === 'unknown_resolve') return { id: rest[0] || '', witness: rest.slice(1).join(' ') || 'resolved by thebird' };
  return { id: rest[0] || '' };
}
