import test from 'node:test';
import assert from 'node:assert/strict';

import { composeHudPayload } from '../src/protocol/hudComposer';

test('composeHudPayload builds a robust HUD layout from minimal payload', () => {
  const payload = composeHudPayload(
    {
      version: '0.8',
      screen: {
        title: 'Daily View',
        blocks: [{ type: 'card', title: 'Note', body: 'Prepare for meetings and shipping tasks.' }]
      }
    },
    { prompt: 'Show me everything before leaving', trust: 'trusted', eventCount: 12 }
  );

  const blocks = payload.screen?.blocks || [];
  const titles = blocks.map((block) => String(block.title || block.label || block.type || ''));

  assert.ok(titles.includes('Current Focus'));
  assert.ok(titles.includes('Priorities'));
  assert.ok(titles.includes('Timeline'));
  assert.ok(titles.includes('Alerts'));
  assert.ok(titles.includes('Quick actions'));

  const metricRow = blocks.find((block) => block.type === 'row');
  assert.ok(metricRow);
  const metricChildren = Array.isArray(metricRow?.children) ? metricRow?.children : [];
  assert.equal(metricChildren.length >= 3, true);
});

test('composeHudPayload preserves actionable buttons from source payload', () => {
  const payload = composeHudPayload(
    {
      version: '0.9',
      screen: {
        title: 'Ops',
        blocks: [
          {
            type: 'button',
            label: 'Approve release',
            variant: 'primary',
            action: { type: 'release.approve', target: 'v1.2.3' }
          }
        ]
      }
    },
    { trust: 'untrusted', eventCount: 2 }
  );

  const blocks = payload.screen?.blocks || [];
  const quickActions = blocks.find((block) => block.type === 'section' && String(block.title || '').toLowerCase().includes('quick'));
  assert.ok(quickActions);

  const children = Array.isArray(quickActions?.children) ? quickActions.children : [];
  assert.equal(children.length > 0, true);
  const first = children[0] as Record<string, unknown>;
  assert.equal(first.type, 'button');
  assert.equal(first.label, 'Approve release');
  assert.deepEqual(first.action, { type: 'release.approve', target: 'v1.2.3' });

  const alerts = blocks.find((block) => block.type === 'list' && String(block.title || '').toLowerCase() === 'alerts');
  const items = Array.isArray(alerts?.items) ? alerts.items.map((item) => String(item)) : [];
  assert.equal(items.some((item) => /trust warning/i.test(item)), true);
});

test('composeHudPayload surfaces action provenance and live human controls for active tasks', () => {
  const payload = composeHudPayload(
    {
      version: '0.9',
      screen: {
        title: 'Ops',
        blocks: [{ type: 'card', title: 'Queue', body: 'One approval is waiting.' }]
      }
    },
    {
      trust: 'trusted',
      eventCount: 7,
      actionAssist: {
        taskId: 'task_42',
        status: 'input_required',
        label: 'Authentication required',
        target: 'billing_portal',
        timestamp: '2026-03-12T20:35:00.000Z',
        interruptId: 'interrupt_42',
        resumeToken: 'resume_42',
        provenance: {
          origin: 'agent',
          tool: 'a2ui.action',
          confidence: 0.82,
          timestamp: '2026-03-12T20:35:00.000Z'
        }
      }
    }
  );

  const blocks = payload.screen?.blocks || [];
  const provenance = blocks.find((block) => block.type === 'list' && String(block.title || '').toLowerCase() === 'action provenance');
  assert.ok(provenance);
  const provenanceItems = Array.isArray(provenance?.items) ? provenance.items.map((item) => String(item)) : [];
  assert.equal(provenanceItems.some((item) => /initiator: agent/i.test(item)), true);
  assert.equal(provenanceItems.some((item) => /source: a2ui.action/i.test(item)), true);

  const controls = blocks.find((block) => block.type === 'section' && String(block.title || '').toLowerCase() === 'human controls');
  assert.ok(controls);
  const children = Array.isArray(controls?.children) ? controls.children : [];
  const labels = children.map((child) => String((child as Record<string, unknown>).label || ''));
  assert.equal(labels.includes('Resume task'), true);
  assert.equal(labels.includes('Take over manually'), true);

  const resumeButton = children.find((child) => String((child as Record<string, unknown>).label || '') === 'Resume task') as Record<string, any>;
  assert.deepEqual(resumeButton.action.control, { signal: 'resume' });
  assert.deepEqual(resumeButton.action.resume, { interrupt_id: 'interrupt_42', resume_token: 'resume_42' });
});
