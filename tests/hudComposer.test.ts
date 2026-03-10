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
