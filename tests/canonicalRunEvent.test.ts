import test from 'node:test';
import assert from 'node:assert/strict';

import { toCanonicalEnvelope } from '../shared/a2ui.js';
import {
  canonicalErrorEvents,
  canonicalEventsFromActionResponse,
  canonicalEventsFromGenerateResult,
  capabilitiesFromA2UI,
  summarizeRun
} from '../shared/canonicalRunEvent.js';
import { createActionResponseEnvelope } from '../shared/actionEnvelope.js';
import { createRunTimelineStore } from '../server/runTimeline.js';

test('generate result maps into canonical run lifecycle with capabilities', () => {
  const envelope = toCanonicalEnvelope({
    version: '0.9',
    screen: { title: 'ClawScreen', blocks: [{ type: 'text', text: 'Ready' }] }
  });
  const capabilities = capabilitiesFromA2UI({
    components: ['text', 'card'],
    modalities: ['text', 'form'],
    messageTypes: ['beginRendering', 'surfaceUpdate'],
    interrupts: true,
    screenshot: false,
    payloadLimitKb: 256
  });

  const events = canonicalEventsFromGenerateResult({ runId: 'run_generate', envelope, capabilities });
  assert.deepEqual(events.map((event) => event.kind), ['run_started', 'ui_delta', 'completed']);
  assert.equal(events[0].capabilities?.payloadLimitKb, 256);
  assert.equal(events[1].ui?.messages[1].type, 'surfaceUpdate');
  const summary = summarizeRun(events);
  assert.equal(summary?.latestKind, 'completed');
  assert.equal(summary?.trust, 'trusted');
});

test('action response maps input_required and interrupt states', () => {
  const interrupt = createActionResponseEnvelope({
    version: '0.9',
    taskId: 'task_interrupt',
    status: 'completed',
    outcome: 'interrupt',
    progressMessage: 'Waiting for resume',
    interrupt: { id: 'interrupt_1', reason: 'mfa_required', payload: { field: 'otp' } }
  });
  const inputRequired = createActionResponseEnvelope({
    version: '0.9',
    taskId: 'task_input',
    status: 'input_required',
    progressMessage: 'Need credentials',
    inputRequired: {
      reason: 'auth_handoff',
      required_fields: ['username'],
      resume_token: 'resume_1',
      modality: 'form'
    }
  });

  const interruptEvents = canonicalEventsFromActionResponse({ runId: 'run_interrupt', response: interrupt });
  const inputEvents = canonicalEventsFromActionResponse({ runId: 'run_input', response: inputRequired });

  assert.ok(interruptEvents.some((event) => event.kind === 'interrupted'));
  assert.equal(interruptEvents.at(-1)?.kind, 'completed');
  assert.ok(inputEvents.some((event) => event.kind === 'input_required'));
  assert.equal(inputEvents.find((event) => event.kind === 'input_required')?.inputRequired?.resume_token, 'resume_1');
});

test('timeline store returns bounded replay and summary', () => {
  const store = createRunTimelineStore(3);
  const errorEvents = canonicalErrorEvents({ runId: 'run_error', message: 'boom' });
  const snapshot = store.appendMany('run_error', errorEvents);

  assert.equal(snapshot.summary?.latestKind, 'errored');
  assert.equal(snapshot.events.length, 2);

  store.appendMany('run_error', canonicalErrorEvents({ runId: 'run_error', message: 'boom again' }));
  const replay = store.getTimeline('run_error');
  assert.equal(replay.events.length, 3);
  assert.equal(replay.summary?.latestKind, 'errored');
});
