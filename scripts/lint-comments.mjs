import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../web/vendor/acorn.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const isVendored = (file) => file.startsWith('web/vendor/');
const owned = tracked.filter((file) => !isVendored(file));
const vendored = tracked.filter(isVendored);
const CODE = /\.(m?js|cjs)$/;
const HTML = /\.html$/;
const MARKDOWN = /\.md$/;
const YAML = /\.ya?ml$/;
const C_SOURCE = /\.(c|h|cpp|hpp|css)$/;
const DOTFILE_HASH = '.gitignore';
const NO_COMMENT_SYNTAX = /\.(json|wasm|tsv)$/;
const PROVENANCE = {
  'web/vendor/acorn.mjs': 'acorn',
  'web/vendor/isomorphic-git.mjs': 'isomorphic-git',
  'web/vendor/xterm/xterm.mjs': 'xterm.js',
  'web/vendor/xterm/xterm.css': 'xterm.js',
  'web/vendor/xterm/addon-fit.mjs': 'xterm.js',
  'web/vendor/xterm/addon-webgl.mjs': 'xterm.js',
  'web/vendor/xterm/addon-unicode11.mjs': 'xterm.js',
};

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;

function codeComments(text, sourceType = 'module') {
  const found = [];
  parse(text, {
    ecmaVersion: 'latest',
    sourceType,
    allowHashBang: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    onComment: (block, value, start) => {
      if (start === 0 && text.startsWith('#!')) return;
      found.push({ start, value: `${block ? '/*' : '//'}${value}` });
    },
  });
  return found;
}

function htmlComments(text) {
  const found = [];
  for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc=/.test(match[1])) continue;
    const module = /type\s*=\s*"module"/.test(match[1]);
    const bodyStart = match.index + match[0].indexOf('>') + 1;
    for (const comment of codeComments(match[2], module ? 'module' : 'script')) found.push({ start: bodyStart + comment.start, value: comment.value });
  }
  for (const match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const bodyStart = match.index + match[0].indexOf('>') + 1;
    for (const comment of match[1].matchAll(/\/\*[\s\S]*?\*\//g)) found.push({ start: bodyStart + comment.index, value: comment[0] });
  }
  for (const match of text.matchAll(/<!--[\s\S]*?-->/g)) found.push({ start: match.index, value: match[0] });
  return found;
}

function markdownComments(text) {
  return [...text.matchAll(/<!--[\s\S]*?-->/g)].map((match) => ({ start: match.index, value: match[0] }));
}

function cComments(text) {
  const pattern = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  return [...text.matchAll(pattern)].filter((match) => match[0].startsWith('/')).map((match) => ({ start: match.index, value: match[0] }));
}

const hashComments = (text) => text.split('\n').flatMap((line, index) => (/^\s*#/.test(line) ? [{ start: index, value: line, line: index + 1 }] : []));

function commentsOf(file) {
  const text = readFileSync(join(root, file), 'utf8');
  if (CODE.test(file)) return codeComments(text);
  if (HTML.test(file)) return htmlComments(text);
  if (MARKDOWN.test(file)) return markdownComments(text);
  if (C_SOURCE.test(file)) return cComments(text);
  if (basename(file) === DOTFILE_HASH || YAML.test(file)) return hashComments(text);
  return [];
}

const classified = (file) => CODE.test(file) || HTML.test(file) || MARKDOWN.test(file) || C_SOURCE.test(file) || YAML.test(file) || basename(file) === DOTFILE_HASH || NO_COMMENT_SYNTAX.test(file);

const GENERATED_MANIFESTS = { 'web/vendor/fx/': 'web/vendor/fx/manifest.json', 'web/vendor/floosie/': 'web/vendor/floosie/manifest.json', 'web/vendor/birdman/': 'web/vendor/birdman/manifest.json' };
const manifestOf = (file) => Object.entries(GENERATED_MANIFESTS).find(([prefix]) => file.startsWith(prefix))?.[1];
const listedNames = (manifest) => {
  const data = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
  return Object.values(data).flatMap((value) => (Array.isArray(value) ? value : [value])).filter((entry) => entry && typeof entry === 'object' && 'name' in entry).map((entry) => entry.name);
};

function provenanceProblem(file) {
  const manifest = manifestOf(file);
  if (manifest) return listedNames(manifest).includes(basename(file)) ? null : `not listed in ${manifest}`;
  const upstream = PROVENANCE[file];
  if (!upstream) return 'no provenance entry';
  if (!readFileSync(join(root, file), 'utf8').toLowerCase().includes(upstream)) return `upstream name ${upstream} does not appear in the file`;
  return null;
}

const findings = [];
const vendoredReport = [];
let repoComments = 0;
for (const file of tracked) {
  if (!classified(file)) {
    findings.push(`FAIL ${file}  no comment rule for this file type`);
    continue;
  }
  const comments = commentsOf(file);
  if (!comments.length) continue;
  if (isVendored(file)) {
    const problem = provenanceProblem(file);
    vendoredReport.push(file);
    findings.push(problem ? `FAIL ${file}  ${problem}` : `VENDORED ${file}: ${comments.length} comments kept; ${manifestOf(file) ? `listed in ${manifestOf(file)}` : `upstream ${PROVENANCE[file]} named`} (third-party, not edited)`);
    continue;
  }
  const text = readFileSync(join(root, file), 'utf8');
  for (const comment of comments) {
    repoComments += 1;
    findings.push(`FAIL ${file}:${comment.line ?? lineOf(text, comment.start)}  ${JSON.stringify(comment.value.slice(0, 100))}`);
  }
}

for (const finding of findings) console.log(finding);
const failed = findings.some((finding) => finding.startsWith('FAIL'));
console.log(`\n${owned.length} repo-owned files checked: ${repoComments} comments; ${tracked.length} tracked files, ${vendoredReport.length} vendored files with comments`);
if (failed) process.exitCode = 1;
