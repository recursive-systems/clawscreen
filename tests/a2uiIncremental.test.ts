import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCanonicalMessages,
  canonicalToCompatiblePayload,
  createInitialRenderState,
  toCanonicalEnvelope
} from '../shared/a2ui';
import { applyEnvelopeBatch } from '../src/protocol/applyMessages';

test('toCanonicalEnvelope accepts streaming message arrays in order', () => {
  const envelope = toCanonicalEnvelope([
    { type: 'beginRendering', version: '0.8' },
    { type: 'dataModelUpdate', model: { user: 'Bradley' } },
    { type: 'surfaceUpdate', screen: { title: 'Live', blocks: [{ type: 'text', text: 'hello' }] } }
  ]);

  assert.equal(envelope.messages.length, 3);
  assert.equal(envelope.messages[0].type, 'beginRendering');
  assert.equal(envelope.messages[1].type, 'dataModelUpdate');
  assert.equal(envelope.messages[2].type, 'surfaceUpdate');
});

test('applyCanonicalMessages incrementally merges model updates and keeps latest surface', () => {
  const envelope = toCanonicalEnvelope([
    { type: 'beginRendering', version: '0.8' },
    { type: 'dataModelUpdate', model: { count: 1, mode: 'warmup' } },
    { type: 'surfaceUpdate', screen: { title: 'Initial', blocks: [{ type: 'metric', label: 'Count', value: 1 }] } },
    { type: 'dataModelUpdate', model: { count: 2 } },
    { type: 'surfaceUpdate', screen: { title: 'Updated', blocks: [{ type: 'metric', label: 'Count', value: 2 }] } }
  ]);

  const state = applyCanonicalMessages(envelope.messages, createInitialRenderState('0.8'));
  assert.equal(state.beganRendering, true);
  assert.deepEqual(state.model, { count: 2, mode: 'warmup' });
  assert.equal(state.screen?.title, 'Updated');

  const compatible = canonicalToCompatiblePayload(envelope);
  assert.equal(compatible.screen?.title, 'Updated');
});

test('applyEnvelopeBatch preserves existing surface when batch only updates model', () => {
  const first = applyEnvelopeBatch({
    version: '0.8',
    screen: { title: 'Stable Screen', blocks: [{ type: 'text', text: 'keep me' }] },
    model: { progress: 0 }
  });

  const second = applyEnvelopeBatch(
    [{ type: 'dataModelUpdate', model: { progress: 50, status: 'running' } }],
    first.state
  );

  assert.equal(second.state.screen?.title, 'Stable Screen');
  assert.deepEqual(second.state.model, { progress: 50, status: 'running' });
  assert.equal(second.payload.screen?.title, 'Stable Screen');
});

test('single-shot payloads route through reducer compatibility path', () => {
  const applied = applyEnvelopeBatch({
    version: '0.8',
    screen: { title: 'One Shot', blocks: [{ type: 'notes', body: 'legacy format' }] }
  });

  assert.equal(applied.envelope.messages[0].type, 'beginRendering');
  assert.equal(applied.envelope.messages[1].type, 'surfaceUpdate');
  assert.equal(applied.payload.screen?.title, 'One Shot');
});
