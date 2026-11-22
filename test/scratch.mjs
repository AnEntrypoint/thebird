import { mkdtempSync, rmSync } from 'node:fs';
import { after } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made = [];
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

export const scratchDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
