import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PYODIDE_VERSION = '314.0.7';
const FILES = {
  'pyodide.mjs': '6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109',
  'pyodide.asm.mjs': 'f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635',
  'pyodide.asm.wasm': 'cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6',
  'python_stdlib.zip': 'fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a',
  'pyodide-lock.json': '5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010',
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'web', 'vendor', 'pyodide');

export async function vendorPyodide() {
  const work = mkdtempSync(join(tmpdir(), 'vendor-pyodide-'));
  try {
    const tarball = execFileSync('npm', ['pack', `pyodide@${PYODIDE_VERSION}`, '--silent'], { cwd: work, encoding: 'utf8' }).trim().split('\n').pop();
    execFileSync('tar', ['-xzf', join(work, tarball), '-C', work]);
    const pkg = join(work, 'package');
    const digests = {};
    for (const [file, expected] of Object.entries(FILES)) {
      const digest = createHash('sha256').update(readFileSync(join(pkg, file))).digest('hex');
      if (digest !== expected) throw new Error(`pyodide ${file} sha256 ${digest} does not match the pinned ${expected}`);
      digests[file] = digest;
    }
    mkdirSync(target, { recursive: true });
    for (const file of Object.keys(FILES)) copyFileSync(join(pkg, file), join(target, file));
    return { version: PYODIDE_VERSION, files: digests, dir: target };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const done = await vendorPyodide();
  console.log(`vendored pyodide ${done.version} into ${done.dir} (${Object.keys(done.files).length} files, sha256 checked)`);
}
