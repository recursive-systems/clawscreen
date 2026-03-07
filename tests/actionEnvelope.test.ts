import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createActionResponseEnvelope,
  validateActionRequestEnvelope,
  validateActionResponseEnvelope,
  validateTaskStatusTransition
} from '../shared/actionEnvelope';
import { canonicalToCompatiblePayload } from '../shared/a2ui';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'action-events', name), 'utf8')) as unknown;
}

test('valid action request fixture passes envelope validation', () => {
  const parsed = validateActionRequestEnvelope(fixture('valid-click.json'));
  assert.equal(parsed.ok, true);

  if (parsed.ok) {
    assert.equal(parsed.value.version, '0.8');
    assert.equal(parsed.value.event.type, 'button.click');
    assert.equal(parsed.value.event.target, 'approve-btn');
    assert.deepEqual(parsed.value.event.snapshot?.model, { draftId: 'd_123', confidence: 0.93 });
  }
});

test('request envelope supports provenance/control/modality negotiation fields', () => {
  const parsed = validateActionRequestEnvelope({
    version: '0.9',
    event: {
      id: 'evt_1',
      type: 'button.click',
      timestamp: new Date().toISOString(),
      provenance: {
        origin: 'agent',
        parent_task_id: 'task_parent',
        tool: 'openclaw.exec',
        confidence: 0.91
      }
    },
    control: { signal: 'takeover', takeover_reason: 'needs_human_confirmation' },
    accepted_modalities: ['oauth_redirect', 'form']
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.event.provenance?.origin, 'agent');
    assert.equal(parsed.value.control?.signal, 'takeover');
    assert.deepEqual(parsed.value.accepted_modalities, ['oauth_redirect', 'form']);
  }
});

test('invalid action request fixture is rejected with required-field error', () => {
  const parsed = validateActionRequestEnvelope(fixture('invalid-missing-event-id.json'));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.match(parsed.error, /event\.id/);
  }
});

test('action response envelope canonicalizes output and stays compatible with generate path', () => {
  const response = createActionResponseEnvelope({
    taskId: 'task_42',
    output: {
      version: '0.8',
      screen: {
        title: 'Action Applied',
        subtitle: 'Button click acknowledged',
        blocks: [{ type: 'text', text: 'All set.' }]
      }
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.task.status, 'completed');
  assert.equal(response.task_id, 'task_42');
  assert.equal(response.task.artifact?.messages[0].type, 'beginRendering');

  const compatibility = canonicalToCompatiblePayload(response.a2ui!);
  assert.equal(compatibility.screen?.title, 'Action Applied');
});

test('task lifecycle transitions enforce queued/running/paused/input_required/completed rules', () => {
  assert.equal(validateTaskStatusTransition(null, 'queued'), true);
  assert.equal(validateTaskStatusTransition('queued', 'running'), true);
  assert.equal(validateTaskStatusTransition('running', 'paused'), true);
  assert.equal(validateTaskStatusTransition('paused', 'running'), true);
  assert.equal(validateTaskStatusTransition('paused', 'failed'), true);
  assert.equal(validateTaskStatusTransition('paused', 'completed'), false);
  assert.equal(validateTaskStatusTransition('running', 'input_required'), true);
  assert.equal(validateTaskStatusTransition('input_required', 'running'), true);
  assert.equal(validateTaskStatusTransition('running', 'completed'), true);
  assert.equal(validateTaskStatusTransition('completed', 'running'), false);
  assert.equal(validateTaskStatusTransition('queued', 'completed'), true);
  assert.equal(validateTaskStatusTransition('queued', 'input_required'), true);
});

test('response validator enforces input_required payload and terminal artifacts/errors', () => {
  const inputReq = validateActionResponseEnvelope({
    ok: true,
    version: '0.8',
    task_id: 'task_abc',
    task: {
      id: 'task_abc',
      status: 'input_required',
      progress_message: 'Need MFA code',
      input_required: {
        reason: 'mfa_challenge',
        required_fields: ['otp_code'],
        resume_token: 'resume_123',
        modality: 'oauth_redirect',
        timeout_seconds: 120,
        fallback_action: 'retry'
      }
    }
  }, 'running');
  assert.equal(inputReq.ok, true);

  const badInputReq = validateActionResponseEnvelope({
    ok: true,
    task_id: 'task_abc',
    task: {
      id: 'task_abc',
      status: 'input_required'
    }
  }, 'running');
  assert.equal(badInputReq.ok, false);

  const completed = validateActionResponseEnvelope({
    ok: true,
    task_id: 'task_abc',
    task: {
      id: 'task_abc',
      status: 'completed',
      artifact: {
        version: '0.8',
        screen: { title: 'Done', blocks: [{ type: 'text', text: 'Complete' }] }
      }
    }
  }, 'running');
  assert.equal(completed.ok, true);

  const failedNoError = validateActionResponseEnvelope({
    ok: true,
    task_id: 'task_abc',
    task: { id: 'task_abc', status: 'failed' }
  }, 'running');
  assert.equal(failedNoError.ok, false);
});
