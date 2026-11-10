import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CALL_BUDGET_MS = 330000;
export const PAUSED = 75;

export const digest = (text) => createHash('sha256').update(text).digest('hex');

export function treeKey(root) {
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).stdout ?? '';
  return digest([git(['rev-parse', 'HEAD']), git(['diff', 'HEAD', '--binary']), git(['status', '--porcelain', '--untracked-files=all'])].join('\n')).slice(0, 16);
}

export function openCheckpoint({ dir, root }) {
  mkdirSync(dir, { recursive: true });
  const tree = treeKey(root);
  const file = join(dir, 'state.json');
  const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const fresh = !prior || prior.tree !== tree;
  if (fresh) {
    for (const name of readdirSync(dir)) rmSync(join(dir, name), { recursive: true, force: true });
  }
  const state = fresh ? { tree, calls: 0, terminals: 0, ports: {}, checks: [] } : prior;
  state.calls += 1;
  const started = Date.now();
  const save = () => writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  save();
  return {
    state,
    fresh,
    profile: join(dir, 'profile'),
    overBudget: () => Date.now() - started > CALL_BUDGET_MS,
    terminalFile: (index) => join(dir, `terminal-${String(index).padStart(3, '0')}.json`),
    save,
  };
}
