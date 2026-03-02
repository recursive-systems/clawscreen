import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createActionResponseEnvelope, validateActionRequestEnvelope } from '../shared/actionEnvelope';
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
  assert.equal(response.a2ui.messages[0].type, 'beginRendering');

  const compatibility = canonicalToCompatiblePayload(response.a2ui);
  assert.equal(compatibility.screen?.title, 'Action Applied');
});
