import test from 'node:test';
import assert from 'node:assert/strict';

import { renderNode } from '../src/render/registry';

test('renderNode resolves alias types through trusted component coercion', () => {
  const html = renderNode({
    type: 'markdown',
    content: 'Alias body'
  });

  assert.match(html, /<p>Alias body<\/p>/);
});

test('renderNode falls back to unsupported renderer for unknown component type', () => {
  const html = renderNode({
    type: 'totally-unknown',
    title: 'Fallback block',
    extra: 'visible detail'
  });

  assert.match(html, /generic-block type-unsupported/);
  assert.match(html, /<h3>Fallback block<\/h3>/);
  assert.match(html, /<dt>extra<\/dt>/);
  assert.match(html, /visible detail/);
});

test('renderNode checks kind/component keys when type is absent', () => {
  const fromKind = renderNode({ kind: 'kpi', value: 42 });
  const fromComponent = renderNode({ component: 'hr' });

  assert.match(fromKind, /metric-value/);
  assert.match(fromComponent, /<hr class="divider" \/>/);
});
