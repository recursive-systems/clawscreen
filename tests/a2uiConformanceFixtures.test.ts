import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyCanonicalMessages,
  createInitialRenderState,
  toCanonicalEnvelope,
  type A2UICanonicalMessage
} from '../shared/a2ui';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, 'fixtures');
const validDir = path.join(fixtureRoot, 'a2ui-valid');
const invalidDir = path.join(fixtureRoot, 'a2ui-invalid');

function loadFixture(relativePath: string): unknown {
  const raw = readFileSync(path.join(fixtureRoot, relativePath), 'utf8');
  return JSON.parse(raw) as unknown;
}

function requiredFieldsForMessage(msg: A2UICanonicalMessage): string[] {
  if (msg.type === 'beginRendering') return ['type', 'version', 'issuedAt'];
  if (msg.type === 'surfaceUpdate') return ['type', 'version', 'screen'];
  return ['type', 'version', 'model'];
}

test('valid fixtures canonicalize and reduce with order-sensitive semantics', () => {
  const files = readdirSync(validDir).filter((name) => name.endsWith('.json')).sort();
  assert.ok(files.length > 0, 'expected at least one valid fixture');

  for (const file of files) {
    const envelope = toCanonicalEnvelope(loadFixture(path.join('a2ui-valid', file)));

    assert.ok(envelope.version.length > 0, `${file}: canonical envelope version should be present`);
    assert.ok(envelope.messages.length > 0, `${file}: canonical envelope should emit at least one message`);

    for (const msg of envelope.messages) {
      const required = requiredFieldsForMessage(msg);
      for (const field of required) {
        assert.ok(Object.hasOwn(msg, field), `${file}: ${msg.type} is missing required field "${field}"`);
      }

      if (msg.type === 'beginRendering') {
        assert.equal(typeof msg.issuedAt, 'string', `${file}: beginRendering issuedAt should be string`);
      }

      if (msg.type === 'surfaceUpdate') {
        assert.equal(typeof msg.screen, 'object', `${file}: surfaceUpdate.screen must be object`);
      }

      if (msg.type === 'dataModelUpdate') {
        assert.equal(Array.isArray(msg.model), false, `${file}: dataModelUpdate.model must not be array`);
      }
    }

    const state = applyCanonicalMessages(envelope.messages, createInitialRenderState(envelope.version));
    assert.equal(state.version, envelope.version, `${file}: reducer should preserve canonical version`);
  }

  const streamEnvelope = toCanonicalEnvelope(loadFixture('a2ui-valid/stream-sequence.json'));
  const streamTypes = streamEnvelope.messages.map((msg) => msg.type);
  assert.deepEqual(streamTypes, ['beginRendering', 'dataModelUpdate', 'surfaceUpdate', 'dataModelUpdate', 'surfaceUpdate']);

  const streamState = applyCanonicalMessages(streamEnvelope.messages, createInitialRenderState(streamEnvelope.version));
  assert.equal(streamState.beganRendering, true);
  assert.deepEqual(streamState.model, { count: 2, mode: 'warmup' });
  assert.equal(streamState.screen?.title, 'Hot');
});

test('invalid fixtures fail closed with safe fallback/normalization', () => {
  const files = readdirSync(invalidDir).filter((name) => name.endsWith('.json')).sort();
  assert.ok(files.length > 0, 'expected at least one invalid fixture');

  for (const file of files) {
    const envelope = toCanonicalEnvelope(loadFixture(path.join('a2ui-invalid', file)));
    assert.ok(envelope.messages.length >= 1, `${file}: normalization must emit at least one message`);
    assert.equal(envelope.messages[0].type, 'beginRendering', `${file}: first message must always be beginRendering`);

    for (const msg of envelope.messages) {
      assert.notEqual(msg.type, 'dataModelUpdate', `${file}: invalid fixtures should not produce model updates`);
    }

    const state = applyCanonicalMessages(envelope.messages, createInitialRenderState(envelope.version));
    assert.equal(state.beganRendering, true, `${file}: normalization still begins rendering`);
    assert.deepEqual(state.model, {}, `${file}: invalid payload must not mutate model`);
  }
});

test('normalization ignores unsafe/unexpected nested message shapes', () => {
  const envelope = toCanonicalEnvelope({
    version: '0.8',
    messages: [
      null,
      123,
      { type: 'surfaceUpdate' },
      { type: 'dataModelUpdate', model: [] },
      { type: 'beginRendering', issuedAt: '2026-02-26T00:00:00.000Z' },
      { type: 'dataModelUpdate', model: { safe: true } }
    ]
  });

  assert.deepEqual(
    envelope.messages.map((msg) => msg.type),
    ['beginRendering', 'dataModelUpdate']
  );

  const state = applyCanonicalMessages(envelope.messages, createInitialRenderState(envelope.version));
  assert.deepEqual(state.model, { safe: true });
  assert.equal(state.screen, undefined);
});

test('new display/layout fixture types survive canonical normalization', () => {
  const envelope = toCanonicalEnvelope(loadFixture('a2ui-valid/layout-display-types.json'));
  const state = applyCanonicalMessages(envelope.messages, createInitialRenderState(envelope.version));
  const blocks = state.screen?.blocks || [];
  const blockTypes = blocks.map((block) => block.type);

  assert.deepEqual(blockTypes, ['section', 'row', 'column']);
});

test('interactive parity fixture preserves v0.9 aliases, surface blocks, and model bindings', () => {
  const envelope = toCanonicalEnvelope(loadFixture('a2ui-valid/interactive-parity-slice.json'));
  assert.deepEqual(
    envelope.messages.map((msg) => msg.type),
    ['beginRendering', 'dataModelUpdate', 'surfaceUpdate']
  );

  const state = applyCanonicalMessages(envelope.messages, createInitialRenderState(envelope.version));
  assert.equal(state.version, '0.9');
  assert.deepEqual(state.model, {
    approval_note: 'Needs finance review',
    due_date: '2026-03-15',
    reviewers: ['Ana', 'Priya'],
    ship_at: '2026-03-16T09:30'
  });

  const blockTypes = (state.screen?.blocks || []).map((block) => block.type);
  assert.deepEqual(blockTypes, ['button', 'textfield', 'textfield', 'multiplechoice', 'datetimeinput']);
});
