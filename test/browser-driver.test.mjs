import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { closeBrowserTrees, recordBrowserTree } from '../scripts/browser-driver.mjs';

const stateOf = (pid) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
  } catch {
    return null;
  }
};
const alive = (pid) => stateOf(pid) !== null && stateOf(pid) !== 'Z';
const childrenOf = (pid) => spawnSync('ps', ['-o', 'pid=', '--ppid', String(pid)], { encoding: 'utf8' })
  .stdout.trim().split(/\s+/).filter(Boolean).map(Number);

test('cleanup closes only the recorded tree and leaves an unrecorded process alone', async () => {
  const root = spawn('/bin/sh', ['-c', 'sleep 300 & sleep 300 & wait'], { detached: true, stdio: 'ignore' });
  const unrelated = spawn('sleep', ['300'], { stdio: 'ignore' });
  let members = [];
  for (let attempt = 0; attempt < 60 && members.length < 2; attempt++) {
    await sleep(50);
    members = childrenOf(root.pid);
  }
  assert.equal(members.length, 2, 'the shell started its two sleeps');
  recordBrowserTree(root.pid);
  const tree = [root.pid, ...members];
  assert.ok(tree.every(alive), 'every recorded process is running before cleanup');
  assert.ok(alive(unrelated.pid));

  const closed = closeBrowserTrees();
  assert.deepEqual([...closed].sort(), [...tree].sort());
  await sleep(200);
  assert.ok(tree.every((pid) => !alive(pid)), 'every recorded process is gone after cleanup');
  assert.ok(alive(unrelated.pid), 'the unrecorded process is still running');
  unrelated.kill('SIGKILL');
});
