import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gmRepo = process.env.GM_REPO ?? join(root, '..', 'gm');
const source = join(root, 'scripts', 'gm');
const out = join(root, 'web', 'vendor', 'gm');
const modules = [{ name: 'gm-core.js', path: join(out, 'gm-core.js') }, { name: 'gm-in-page.js', path: join(root, 'web', 'gm-in-page.js') }];
const skills = ['skills/gm/SKILL.md', 'skills/gm/WORKFLOWS.md', 'skills/gm-continue/SKILL.md'];

const zig = () => {
  const candidates = [process.env.ZIG, '/usr/local/bin/zig', '/usr/bin/zig'];
  const found = candidates.find((path) => path && existsSync(path));
  if (!found) throw new Error('gm WASM needs Zig 0.17.1: set ZIG to the zig executable');
  return found;
};

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const syncSources = () => {
  const copies = [
    [join(gmRepo, 'native', 'components', 'json', 'json.cpp'), join(source, 'json.cpp')],
    [join(gmRepo, 'native', 'components', 'mcp', 'sha256.cpp'), join(source, 'sha256.cpp')],
    [join(gmRepo, 'native', 'components', 'mcp', 'compact.cpp'), join(source, 'compact.cpp')],
    [join(gmRepo, 'native', 'include', 'gm', 'json.hpp'), join(source, 'include', 'gm', 'json.hpp')],
    [join(gmRepo, 'include', 'deoxidene', 'result.hpp'), join(source, 'include', 'deoxidene', 'result.hpp')],
    [join(gmRepo, 'native', 'components', 'mcp', 'internal.hpp'), join(source, 'internal.hpp')],
  ];
  mkdirSync(join(source, 'include', 'gm'), { recursive: true });
  mkdirSync(join(source, 'include', 'deoxidene'), { recursive: true });
  for (const [from, to] of copies) copyFileSync(from, to);
  writeFileSync(join(source, 'include', 'gm', 'mcp.hpp'), '#pragma once\n\n#include <string>\n#include <string_view>\n\nnamespace gm::mcp {\n\nstd::string sha256_hex(std::string_view bytes);\n\n}\n');
};

export async function vendorGm() {
  syncSources();
  const gmCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: gmRepo, encoding: 'utf8' }).trim();
  const exe = zig();
  const flags = ['-target', 'wasm32-wasi', '-Oz', '-std=c++23', '-fno-exceptions', '-w'];
  const includes = ['-Iinclude', '-I.'];
  const exports = ['gm_alloc', 'gm_free', 'gm_json_len', 'gm_json_out', 'gm_json_normalize', 'gm_sha256_hex', 'gm_clip', 'gm_output_digest', 'gm_core_version'];
  const objects = [];
  for (const name of ['json.cpp', 'sha256.cpp', 'compact.cpp', 'bridge.cpp']) {
    const object = join(root, '.thebird', 'gm-build', `${name}.o`);
    mkdirSync(dirname(object), { recursive: true });
    execFileSync(exe, ['c++', ...flags, ...includes, '-c', name, '-o', object], { cwd: source, stdio: 'inherit' });
    objects.push(object);
  }
  const wasm = join(out, 'gm-core.wasm');
  mkdirSync(out, { recursive: true });
  const skillsOut = join(out, 'skills');
  mkdirSync(join(skillsOut, 'gm'), { recursive: true });
  mkdirSync(join(skillsOut, 'gm-continue'), { recursive: true });
  const skillTexts = {};
  for (const name of skills) {
    copyFileSync(join(gmRepo, name), join(out, name));
    skillTexts[name] = readFileSync(join(out, name), 'utf8');
  }
  writeFileSync(join(out, 'skills.js'), `export const GM_SKILLS = ${JSON.stringify(skillTexts)};\n`);
  execFileSync(exe, ['c++', ...flags, ...objects, '-o', wasm, '-Wl,--no-entry', ...exports.flatMap((name) => ['-Wl,--export=' + name])], { cwd: source, stdio: 'inherit' });
  rmSync(join(root, '.thebird', 'gm-build'), { recursive: true, force: true });
  const manifest = {
    generator: 'scripts/vendor-gm.mjs',
    source: `gm native C++ core at ${gmCommit}`,
    wasm: { name: 'gm-core.wasm', sha256: sha256(wasm) },
    modules: modules.map(({ name, path }) => ({ name, sha256: sha256(path) })),
    skills: skills.map((name) => ({ name, sha256: sha256(join(out, name)) })),
    skillsModule: { name: 'skills.js', sha256: sha256(join(out, 'skills.js')) },
  };
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { out, manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await vendorGm();
  console.log(`gm vendor written to ${result.out}: ${result.manifest.wasm.sha256.slice(0, 12)}`);
}
