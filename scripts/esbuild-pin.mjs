import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ESBUILD_VERSION = '0.28.2';
const esbuildDir = join(tmpdir(), `thebird-esbuild-${ESBUILD_VERSION}`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export async function loadEsbuild() {
  const installed = join(esbuildDir, 'node_modules', 'esbuild', 'package.json');
  if (!existsSync(installed) || JSON.parse(readFileSync(installed, 'utf8')).version !== ESBUILD_VERSION) {
    mkdirSync(esbuildDir, { recursive: true });
    writeFileSync(join(esbuildDir, 'package.json'), '{ "private": true }\n');
    execFileSync(npm, ['install', '--no-save', `esbuild@${ESBUILD_VERSION}`], { cwd: esbuildDir, stdio: 'inherit' });
  }
  return import(pathToFileURL(join(esbuildDir, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
}
