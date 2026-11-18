import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFetchArgs } from '../web/curl-in-page.js';

const URL_ONE = 'http://localhost:4310/final';

test('wget -qO- and -O- write to stdout, in one cluster or as a separate argument', () => {
  assert.deepEqual(parseFetchArgs('wget', ['-qO-', URL_ONE]), { url: URL_ONE, output: '-', fail: true });
  assert.deepEqual(parseFetchArgs('wget', ['-O-', URL_ONE]), { url: URL_ONE, output: '-', fail: true });
  assert.deepEqual(parseFetchArgs('wget', ['-O', '-', URL_ONE]), { url: URL_ONE, output: '-', fail: true });
  assert.deepEqual(parseFetchArgs('wget', ['--output-document=-', URL_ONE]), { url: URL_ONE, output: '-', fail: true });
});

test('wget without -O saves the URL basename, and -O takes a file name', () => {
  assert.equal(parseFetchArgs('wget', [URL_ONE]).output, 'final');
  assert.equal(parseFetchArgs('wget', ['-q', '-O', 'page.html', URL_ONE]).output, 'page.html');
  assert.equal(parseFetchArgs('wget', ['http://localhost:4310/']).output, 'index.html');
});

test('curl reads the common silent, fail, location and output flags, in clusters or long form', () => {
  assert.deepEqual(parseFetchArgs('curl', ['-sSfL', URL_ONE]), { url: URL_ONE, output: undefined, fail: true });
  assert.deepEqual(parseFetchArgs('curl', ['-fsS', '-o', 'out.txt', URL_ONE]), { url: URL_ONE, output: 'out.txt', fail: true });
  assert.deepEqual(parseFetchArgs('curl', ['--silent', '--fail', '--output=out.txt', URL_ONE]), { url: URL_ONE, output: 'out.txt', fail: true });
  assert.deepEqual(parseFetchArgs('curl', ['-o-', URL_ONE]), { url: URL_ONE, output: '-', fail: false });
  assert.equal(parseFetchArgs('curl', ['-sO', URL_ONE]).output, 'final');
});

test('a flag that cannot work in the page is refused with what to use instead', () => {
  assert.throws(() => parseFetchArgs('curl', ['-X', 'POST', URL_ONE]), /use fetch in a node -e script/);
  assert.throws(() => parseFetchArgs('curl', ['-I', URL_ONE]), /read the body with curl -s/);
  assert.throws(() => parseFetchArgs('wget', ['-r', URL_ONE]), /fetch each URL with wget -O/);
  assert.throws(() => parseFetchArgs('curl', ['-Z', URL_ONE]), /not supported in the in-page shell; usage: curl/);
});

test('one URL per call, and a URL is required', () => {
  assert.throws(() => parseFetchArgs('curl', [URL_ONE, URL_ONE]), /one URL per call/);
  assert.throws(() => parseFetchArgs('wget', ['-q']), /usage: wget/);
});
