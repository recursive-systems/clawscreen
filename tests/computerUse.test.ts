import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectTerminalState,
  negotiateHarnessCapabilities,
  normalizeHarnessTurn,
  remapActionBatch,
  remapCoordinates
} from '../shared/computerUse.js';

test('negotiateHarnessCapabilities downgrades optional zoom and rejects unsupported actions', () => {
  const negotiated = negotiateHarnessCapabilities(
    {
      screenshot: true,
      actions: ['click', 'type', 'zoom'],
      maxActionsPerTurn: 8,
      toolVersion: 'provider-v2'
    },
    {
      screenshot: true,
      actions: ['click', 'type', 'scroll', 'wait', 'screenshot'],
      optionalActions: ['zoom'],
      maxActionsPerTurn: 6,
      toolVersion: 'clawscreen-harness-v1'
    }
  );

  assert.equal(negotiated.screenshot, true);
  assert.deepEqual(negotiated.actions, ['click', 'type']);
  assert.deepEqual(negotiated.downgradedActions, ['zoom']);
  assert.deepEqual(negotiated.unsupportedActions, []);
  assert.equal(negotiated.maxActionsPerTurn, 6);
});

test('remapCoordinates and remapActionBatch preserve deterministic click mapping for scaled screenshots', () => {
  const mapped = remapCoordinates({
    x: 100,
    y: 50,
    from: { width: 1000, height: 500 },
    to: { width: 2000, height: 1000 }
  });
  assert.deepEqual(mapped, { x: 200, y: 100 });

  const replay = remapActionBatch(
    [{ type: 'click', x: 100, y: 50 }, { type: 'scroll', deltaY: 400 }],
    { width: 1000, height: 500 },
    { width: 2000, height: 1000 }
  );
  assert.deepEqual(replay[0]?.mapped, { type: 'click', x: 200, y: 100 });
  assert.equal(replay[1]?.mapped, undefined);
});

test('normalizeHarnessTurn converts screenshot-first provider requests into canonical batches with replay records', () => {
  const normalized = normalizeHarnessTurn({
    provider: 'openai',
    toolVersion: 'computer-use-preview',
    domain: 'github.com',
    turn: {
      request: 'screenshot',
      actions: [
        { type: 'click', x: 120, y: 80 },
        { type: 'zoom', zoomLevel: 1.25 },
        { type: 'wait', durationMs: 500 }
      ]
    }
  }, {
    coordinateSpace: {
      from: { width: 1000, height: 500 },
      to: { width: 2000, height: 1000 }
    },
    safetyPolicy: {
      allowedDomains: ['github.com'],
      allowedActions: ['click', 'type', 'scroll', 'wait', 'screenshot'],
      confirmationActions: ['click']
    }
  });

  assert.equal(normalized.provider, 'openai');
  assert.equal(normalized.kind, 'action_batch');
  assert.equal(normalized.screenshot?.mode, 'current');
  assert.deepEqual(normalized.actions, [
    { type: 'click', x: 120, y: 80 },
    { type: 'scroll', deltaY: -240 },
    { type: 'wait', durationMs: 500 }
  ]);
  assert.deepEqual(normalized.replay[0]?.mapped, { type: 'click', x: 240, y: 160 });
  assert.equal(normalized.capabilityNegotiation?.downgradedActions.includes('zoom'), true);
  assert.equal(normalized.safety.requiresConfirmation, true);
  assert.equal(normalized.safety.decisions[0]?.decision, 'confirm');
});

test('normalizeHarnessTurn blocks actions outside the allowed safety policy domain', () => {
  const normalized = normalizeHarnessTurn({
    provider: 'anthropic',
    domain: 'payments.example.com',
    turn: {
      actions: [{ type: 'type', text: '4111 1111 1111 1111' }]
    }
  }, {
    safetyPolicy: {
      allowedDomains: ['github.com'],
      allowedActions: ['click', 'type', 'scroll', 'wait', 'screenshot'],
      confirmationActions: ['type']
    }
  });

  assert.equal(normalized.safety.requiresConfirmation, true);
  assert.equal(normalized.safety.decisions[0]?.decision, 'block');
  assert.match(normalized.safety.decisions[0]?.reason || '', /outside policy/);
});

test('detectTerminalState and normalizeHarnessTurn mark terminal completion deterministically', () => {
  assert.equal(detectTerminalState({ status: 'completed' }), true);
  assert.equal(detectTerminalState({ done: true }), true);
  assert.equal(detectTerminalState({ status: 'running' }), false);

  const normalized = normalizeHarnessTurn({
    provider: 'generic',
    turn: { status: 'completed', actions: [{ type: 'click', x: 4, y: 8 }] }
  });

  assert.equal(normalized.terminal, true);
  assert.equal(normalized.kind, 'terminal');
});
