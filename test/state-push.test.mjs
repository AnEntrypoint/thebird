import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEARTBEAT_MS, isPushDue } from '../web/state-push.js';

test('an unchanged snapshot is not pushed again before the heartbeat', () => {
  assert.equal(isPushDue({ json: '{"a":1}', sent: '{"a":1}', sentAt: 1000, now: 1000 + HEARTBEAT_MS - 1 }), false);
});

test('an unchanged snapshot is pushed again once the heartbeat has passed, so a quiet busy fx stays current', () => {
  assert.equal(isPushDue({ json: '{"a":1}', sent: '{"a":1}', sentAt: 1000, now: 1000 + HEARTBEAT_MS }), true);
  assert.equal(isPushDue({ json: '{"a":1}', sent: '{"a":1}', sentAt: 1000, now: 60000 }), true);
});

test('a changed snapshot is pushed at once', () => {
  assert.equal(isPushDue({ json: '{"a":2}', sent: '{"a":1}', sentAt: 1000, now: 1001 }), true);
  assert.equal(isPushDue({ json: '{"a":1}', sent: null, sentAt: 0, now: 1 }), true);
});
