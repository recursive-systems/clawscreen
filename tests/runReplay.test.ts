import test from 'node:test';
import assert from 'node:assert/strict';

import { toCanonicalEnvelope } from '../shared/a2ui.js';
import { createCanonicalRunEvent } from '../shared/canonicalRunEvent.js';
import { replayRunEvents } from '../shared/runReplay.js';

const source = { channel: 'action' as const, label: 'Action API', origin: 'agent' as const, tool: 'a2ui.action' };

test('replayRunEvents reconstructs final visible screen and transcript from append-only mixed stream history', () => {
  const first = toCanonicalEnvelope({ version: '0.9', screen: { title: 'Ops HUD 1', blocks: [{ type: 'text', text: 'First screen' }] } });
  const second = toCanonicalEnvelope({ version: '0.9', screen: { title: 'Ops HUD 2', blocks: [{ type: 'list', title: 'Timeline', items: ['Ship replay inspector'] }] } });
  const events = [
    createCanonicalRunEvent({ runId: 'run_replay', timestamp: '2026-03-10T20:30:00.000Z', kind: 'run_started', trust: 'trusted', source, summary: 'Replay run', status: 'running' }),
    createCanonicalRunEvent({ runId: 'run_replay', timestamp: '2026-03-10T20:30:01.000Z', kind: 'text_chunk', trust: 'trusted', source, summary: 'Narrative intro', status: 'running', text: 'Narrative intro' }),
    createCanonicalRunEvent({ runId: 'run_replay', timestamp: '2026-03-10T20:30:02.000Z', kind: 'ui_delta', trust: 'trusted', source, summary: 'First screen', status: 'running', ui: first }),
    createCanonicalRunEvent({ runId: 'run_replay', timestamp: '2026-03-10T20:30:03.000Z', kind: 'text_chunk', trust: 'trusted', source, summary: 'Mid-run note', status: 'running', text: 'Mid-run note' }),
    createCanonicalRunEvent({ runId: 'run_replay', timestamp: '2026-03-10T20:30:04.000Z', kind: 'ui_delta', trust: 'trusted', source, summary: 'Second screen', status: 'running', ui: second }),
    createCanonicalRunEvent({ runId: 'run_replay', timestamp: '2026-03-10T20:30:05.000Z', kind: 'text_chunk', trust: 'trusted', source, summary: 'Done', status: 'running', text: 'Done' }),
    createCanonicalRunEvent({ runId: 'run_replay', timestamp: '2026-03-10T20:30:06.000Z', kind: 'completed', trust: 'trusted', source, summary: 'Replay complete', status: 'completed' })
  ];

  const replay = replayRunEvents(events);
  assert.equal(replay.summary?.latestKind, 'completed');
  assert.equal(replay.payload?.screen?.title, 'Ops HUD 2');
  assert.equal(replay.transcript.length, 3);
  assert.match(replay.latestNarrative, /Done/);
});

test('replayRunEvents surfaces approvals, handoffs, and interrupts in visible replay metadata', () => {
  const events = [
    createCanonicalRunEvent({
      runId: 'run_controls',
      timestamp: '2026-03-10T20:30:00.000Z',
      kind: 'run_started',
      trust: 'trusted',
      source,
      summary: 'Action started',
      status: 'queued'
    }),
    createCanonicalRunEvent({
      runId: 'run_controls',
      timestamp: '2026-03-10T20:30:01.000Z',
      kind: 'input_required',
      trust: 'trusted',
      source,
      summary: 'Approval required before submit',
      status: 'input_required',
      inputRequired: {
        reason: 'approval_required',
        required_fields: ['approve'],
        resume_token: 'resume_1',
        modality: 'form'
      }
    }),
    createCanonicalRunEvent({
      runId: 'run_controls',
      timestamp: '2026-03-10T20:30:02.000Z',
      kind: 'interrupted',
      trust: 'trusted',
      source,
      summary: 'mfa_required',
      status: 'interrupted',
      interrupt: { id: 'interrupt_1', reason: 'mfa_required' }
    })
  ];

  const replay = replayRunEvents(events);
  assert.equal(replay.handoffs.length, 1);
  assert.equal(replay.approvals.length, 2);
  assert.equal(replay.interrupts[0]?.reason, 'mfa_required');
});
