import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { pythonBundle } from '../web/python-bundle.js';

const realFetch = globalThis.fetch;
const realWarn = console.warn;
let calls;
let warnings;

beforeEach(() => {
  calls = 0;
  warnings = [];
  console.warn = (message) => warnings.push(String(message));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
});

test('a network error on the bundle fetch is retried twice, each retry logged, then the error is raised', async () => {
  globalThis.fetch = async () => {
    calls += 1;
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(pythonBundle(), (error) => error instanceof TypeError && error.message === 'Failed to fetch');
  assert.equal(calls, 3);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /attempt 1 failed with a network error \(Failed to fetch\); retry 1 of 2 in 1000 ms/);
  assert.match(warnings[1], /attempt 2 failed with a network error \(Failed to fetch\); retry 2 of 2 in 3000 ms/);
});

test('an HTTP error on the bundle fetch is not retried', async () => {
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('', { status: 503 });
  };
  await assert.rejects(pythonBundle(), /Python bundle: HTTP 503/);
  assert.equal(calls, 1);
  assert.equal(warnings.length, 0);
});
