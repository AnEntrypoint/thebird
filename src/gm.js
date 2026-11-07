import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { clientFrom } from './gm-client.js';

const require = createRequire(import.meta.url);

function candidates(explicit) {
  const list = [];
  if (explicit) list.push(resolve(explicit));
  const configured = process.env.GM_HOME || process.env.THEBIRD_GM_HOME;
  if (configured) list.push(resolve(configured));
  try {
    const pkg = require.resolve('gm/package.json');
    list.push(resolve(pkg, '..'));
  } catch {}
  list.push(resolve(process.cwd(), '../gm'), resolve(process.cwd(), 'gm'));
  return [...new Set(list)];
}

async function locateGm(explicit) {
  const tried = candidates(explicit);
  for (const home of tried) {
    if (existsSync(join(home, 'src/tools.mjs')) && existsSync(join(home, 'src/log.mjs'))) {
      return home;
    }
  }
  throw new Error('gm tooling not found. Set GM_HOME to a gm checkout, install the gm package, or place ../gm next to this project. Searched: ' + tried.join(', '));
}

export async function createGmClient(options = {}) {
  const home = await locateGm(options.gmHome);
  const workspace = resolve(options.workspace || process.cwd());
  const runDir = resolve(options.runDir || join(workspace, '.thebird', 'run'));
  const [{ createTools }, { openLog }] = await Promise.all([
    import(pathToFileURL(join(home, 'src/tools.mjs')).href),
    import(pathToFileURL(join(home, 'src/log.mjs')).href),
  ]);
  mkdirSync(runDir, { recursive: true });
  const log = options.log || openLog(join(runDir, 'log.jsonl'));
  const tools = createTools({
    workspace,
    runDir,
    log,
    background: options.background !== false,
    jobLifetimeMs: options.jobLifetimeMs,
    stuckMs: options.stuckMs,
    monitorMs: options.monitorMs,
    noticeMs: options.noticeMs,
  });

  return clientFrom(tools, { gmHome: home, workspace, runDir });
}
