import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
const C_SOURCE = /\.([ch]|css)$/;
const DOTFILE_HASH = '.gitignore';
const NO_COMMENT_SYNTAX = /\.(json|wasm)$|LICENSE|NOTICE/;
const MIT_GRANT = 'Permission is hereby granted, free of charge';
const PROVENANCE = {
  'web/vendor/acorn.mjs': { licence: 'web/vendor/ACORN-LICENSE', upstream: 'acorn' },
  'web/vendor/isomorphic-git.mjs': { licence: 'web/vendor/ISOMORPHIC-GIT-LICENSE', upstream: 'isomorphic-git' },
  'web/vendor/sqljs/sql-wasm-browser.js': { licence: 'web/vendor/SQLJS-LICENSE', upstream: 'sql.js' },
  'web/vendor/xterm/xterm.mjs': { licence: 'web/vendor/xterm/XTERM-LICENSE', upstream: 'xterm.js' },
  'web/vendor/xterm/xterm.css': { licence: 'web/vendor/xterm/XTERM-LICENSE', upstream: 'xterm.js' },
  'web/vendor/xterm/addon-fit.mjs': { licence: 'web/vendor/xterm/FIT-LICENSE', upstream: 'xterm.js' },
  'web/vendor/xterm/addon-webgl.mjs': { licence: 'web/vendor/xterm/WEBGL-LICENSE', upstream: 'xterm.js' },
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

function provenanceProblem(file) {
  const entry = PROVENANCE[file];
  if (!entry) return 'no provenance entry';
  if (!existsSync(join(root, entry.licence))) return `licence ${entry.licence} is missing`;
  if (!readFileSync(join(root, entry.licence), 'utf8').includes(MIT_GRANT)) return `licence ${entry.licence} has no MIT grant`;
  if (!readFileSync(join(root, file), 'utf8').toLowerCase().includes(entry.upstream)) return `upstream name ${entry.upstream} does not appear in the file`;
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
    findings.push(problem ? `FAIL ${file}  ${problem}` : `VENDORED ${file}: ${comments.length} comments kept; licence ${PROVENANCE[file].licence} (MIT grant), upstream named (third-party, not edited)`);
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
