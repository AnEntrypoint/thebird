import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
const TEXT_WITHOUT_COMMENTS = /\.(json|wasm|gitignore)$|LICENSE|NOTICE/;

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

function commentsOf(file) {
  const text = readFileSync(join(root, file), 'utf8');
  if (CODE.test(file)) return codeComments(text);
  if (HTML.test(file)) return htmlComments(text);
  if (MARKDOWN.test(file)) return markdownComments(text);
  if (file === '.gitignore') return text.split('\n').flatMap((line, index) => (line.startsWith('#') ? [{ start: index, value: line, line: index + 1 }] : []));
  return [];
}

const unchecked = owned.filter((file) => !CODE.test(file) && !HTML.test(file) && !MARKDOWN.test(file) && !TEXT_WITHOUT_COMMENTS.test(file));
const failures = [];
const perVendored = [];
for (const file of owned) {
  const text = readFileSync(join(root, file), 'utf8');
  for (const comment of commentsOf(file)) {
    const line = comment.line ?? lineOf(text, comment.start);
    failures.push({ file, line, value: comment.value });
  }
}
for (const file of vendored) {
  if (!CODE.test(file) && !HTML.test(file)) continue;
  const count = commentsOf(file).length;
  if (count) perVendored.push({ file, count });
}

for (const { file, line, value } of failures) {
  console.log(`FAIL ${file}:${line}  ${JSON.stringify(value.slice(0, 100))}`);
}
for (const { file, count } of perVendored) {
  console.log(`VENDORED ${file}: ${count} comments (third-party bundle, not edited)`);
}
for (const file of unchecked) console.log(`UNCHECKED ${file}: no comment rule for this file type`);
console.log(`\n${owned.length} repo-owned files checked: ${failures.length} comments`);
if (failures.length) process.exitCode = 1;
