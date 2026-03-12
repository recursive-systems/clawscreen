import test from 'node:test';
import assert from 'node:assert/strict';

import { toCanonicalEnvelope } from '../shared/a2ui.js';
import { createCanonicalRunEvent } from '../shared/canonicalRunEvent.js';
import { createRunTimelineStore } from '../server/runTimeline.js';

const actionSource = { channel: 'action' as const, label: 'Action API', origin: 'agent' as const, tool: 'a2ui.action' };
const gatewaySource = { channel: 'generate' as const, label: 'Gateway', origin: 'remote' as const, tool: 'openclaw-gateway' };

test('timeline authority assigns surface ownership and records authority metadata', () => {
  const store = createRunTimelineStore(20);
  const envelope = toCanonicalEnvelope({ version: '0.9', screen: { title: 'Ops', blocks: [{ type: 'text', text: 'Ready' }] } });

  const snapshot = store.appendMany('run_authority', [
    createCanonicalRunEvent({
      runId: 'run_authority',
      timestamp: '2026-03-12T16:00:00.000Z',
      kind: 'run_started',
      trust: 'trusted',
      source: gatewaySource,
      summary: 'Run started',
      status: 'running',
      capabilities: {
        components: ['text', 'card', 'list', 'metric'],
        modalities: ['text', 'form'],
        interrupts: true,
        screenshot: false
      }
    }),
    createCanonicalRunEvent({
      runId: 'run_authority',
      timestamp: '2026-03-12T16:00:01.000Z',
      kind: 'ui_delta',
      trust: 'trusted',
      source: gatewaySource,
      summary: 'Primary surface updated',
      status: 'running',
      surfaceId: 'primary',
      ui: envelope
    })
  ]);

  const transfer = snapshot.events.find((event) => event.kind === 'authority_transfer');
  const delta = snapshot.events.find((event) => event.kind === 'ui_delta');
  assert.ok(transfer);
  assert.equal(transfer?.authority?.decision, 'transferred');
  assert.equal(transfer?.authority?.surfaceId, 'primary');
  assert.ok(delta?.authority);
  assert.equal(delta?.authority?.ownerId, 'openclaw-gateway');
  assert.equal(delta?.authority?.sourceKind, 'declarative_ui');
  assert.equal(delta?.authority?.capabilitySnapshot?.interrupts, true);
});

test('timeline authority rejects unauthorized surface mutation from a different owner', () => {
  const store = createRunTimelineStore(20);
  const envelope = toCanonicalEnvelope({ version: '0.9', screen: { title: 'Owned', blocks: [{ type: 'text', text: 'Owner A' }] } });
  const secondEnvelope = toCanonicalEnvelope({ version: '0.9', screen: { title: 'Hijack', blocks: [{ type: 'text', text: 'Owner B' }] } });

  store.appendMany('run_conflict', [
    createCanonicalRunEvent({
      runId: 'run_conflict',
      timestamp: '2026-03-12T16:05:00.000Z',
      kind: 'run_started',
      trust: 'trusted',
      source: gatewaySource,
      summary: 'Run started',
      status: 'running'
    }),
    createCanonicalRunEvent({
      runId: 'run_conflict',
      timestamp: '2026-03-12T16:05:01.000Z',
      kind: 'ui_delta',
      trust: 'trusted',
      source: gatewaySource,
      summary: 'Gateway owns primary',
      status: 'running',
      surfaceId: 'primary',
      ui: envelope
    })
  ]);

  const conflict = store.append('run_conflict', createCanonicalRunEvent({
    runId: 'run_conflict',
    timestamp: '2026-03-12T16:05:02.000Z',
    kind: 'ui_delta',
    trust: 'trusted',
    source: actionSource,
    summary: 'Action tries to overwrite primary',
    status: 'running',
    surfaceId: 'primary',
    provenance: { origin: 'agent', tool: 'different-agent', timestamp: '2026-03-12T16:05:02.000Z' },
    ui: secondEnvelope
  }));

  const last = conflict.events.at(-1);
  assert.equal(last?.kind, 'errored');
  assert.equal(last?.error?.code, 'surface_authority_violation');
  assert.equal(last?.authority?.decision, 'rejected');
});

test('timeline authority downgrades unsupported components deterministically', () => {
  const store = createRunTimelineStore(20);
  const envelope = toCanonicalEnvelope({
    version: '0.9',
    screen: {
      title: 'Fancy HUD',
      blocks: [
        { type: 'tabs', title: 'Modes', items: ['A', 'B'] },
        { type: 'text', text: 'Still visible' }
      ]
    }
  });

  const snapshot = store.appendMany('run_downgrade', [
    createCanonicalRunEvent({
      runId: 'run_downgrade',
      timestamp: '2026-03-12T16:10:00.000Z',
      kind: 'run_started',
      trust: 'trusted',
      source: gatewaySource,
      summary: 'Run started',
      status: 'running',
      capabilities: {
        components: ['text', 'card'],
        modalities: ['text'],
        interrupts: true,
        screenshot: false
      }
    }),
    createCanonicalRunEvent({
      runId: 'run_downgrade',
      timestamp: '2026-03-12T16:10:01.000Z',
      kind: 'ui_delta',
      trust: 'trusted',
      source: gatewaySource,
      summary: 'Render downgraded screen',
      status: 'running',
      surfaceId: 'primary',
      ui: envelope
    })
  ]);

  const downgrade = snapshot.events.find((event) => event.kind === 'downgrade');
  const delta = snapshot.events.find((event) => event.kind === 'ui_delta');
  const screen = delta?.ui?.messages.find((message) => message.type === 'surfaceUpdate' && 'screen' in message);
  assert.ok(downgrade);
  assert.equal(downgrade?.authority?.decision, 'downgraded');
  assert.deepEqual((downgrade?.payload as { unsupportedComponents?: string[] })?.unsupportedComponents, ['tabs']);
  assert.equal(screen && 'screen' in screen ? screen.screen.blocks?.[0]?.type : undefined, 'card');
});

test('action completion records executed result before terminal completion', () => {
  const store = createRunTimelineStore(20);
  const snapshot = store.appendMany('run_action_result', [
    createCanonicalRunEvent({
      runId: 'run_action_result',
      timestamp: '2026-03-12T16:15:00.000Z',
      kind: 'run_started',
      trust: 'trusted',
      source: actionSource,
      summary: 'Action run',
      status: 'queued'
    }),
    createCanonicalRunEvent({
      runId: 'run_action_result',
      timestamp: '2026-03-12T16:15:01.000Z',
      kind: 'completed',
      trust: 'trusted',
      source: actionSource,
      summary: 'Action completed',
      status: 'completed'
    })
  ]);

  const executedIndex = snapshot.events.findIndex((event) => event.kind === 'action_executed');
  const completedIndex = snapshot.events.findIndex((event) => event.kind === 'completed');
  assert.ok(executedIndex >= 0);
  assert.ok(completedIndex > executedIndex);
  assert.equal(snapshot.summary?.latestKind, 'completed');
});
