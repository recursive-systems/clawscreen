import test from 'node:test';
import assert from 'node:assert/strict';

import { applyGenerationGuardrails } from '../server/generationGuardrails';

test('guardrails add required HUD structure when model output is sparse', () => {
  const result = applyGenerationGuardrails(
    {
      version: '0.8',
      screen: {
        title: 'Sparse',
        subtitle: 'missing structure',
        blocks: [{ type: 'text', text: 'hello' }]
      }
    },
    'show me status before leaving'
  );

  assert.equal(result.repaired, true);
  assert.equal(result.issues.length, 0);

  const blocks = result.normalized.screen.blocks;
  const titles = blocks.map((block) => String(block.title || block.label || '').toLowerCase());

  assert.equal(titles.some((title) => title.includes('priorit')), true);
  assert.equal(titles.some((title) => title.includes('timeline')), true);
  assert.equal(titles.some((title) => title.includes('alert')), true);
  assert.equal(blocks.some((block) => block.type === 'metric'), true);
});

test('guardrails cap block count and repair incomplete block fields', () => {
  const tooMany = Array.from({ length: 14 }, (_, i) => ({ type: i % 2 === 0 ? 'list' : 'metric', items: [], value: '' }));
  const result = applyGenerationGuardrails(
    {
      version: '0.8',
      screen: {
        title: 'Overflow',
        subtitle: 'bad blocks',
        blocks: tooMany
      }
    },
    'system overview'
  );

  assert.equal(result.normalized.screen.blocks.length <= 10, true);
  assert.equal(result.issues.length, 0);

  for (const block of result.normalized.screen.blocks) {
    if (block.type === 'list') assert.equal(Array.isArray(block.items) && block.items.length > 0, true);
    if (block.type === 'metric') assert.equal(Boolean(block.value), true);
  }
});
