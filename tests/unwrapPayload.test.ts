import assert from 'node:assert/strict';
import test from 'node:test';
import { unwrapA2uiPayload } from '../src/protocol/unwrapPayload.js';

test('unwrapA2uiPayload returns nested a2ui payload when wrapper is present', () => {
  const wrapped = { ok: true, provider: 'x', a2ui: { version: '0.8', screen: { title: 'Hello' } } };
  assert.deepEqual(unwrapA2uiPayload(wrapped), wrapped.a2ui);
});

test('unwrapA2uiPayload preserves direct payload and arrays', () => {
  const direct = { version: '0.8', screen: { title: 'Direct' } };
  assert.equal(unwrapA2uiPayload(direct), direct);
  const arr = [{ op: 'set' }];
  assert.equal(unwrapA2uiPayload(arr), arr);
});
