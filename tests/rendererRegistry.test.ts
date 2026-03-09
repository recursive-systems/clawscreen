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
  assert.doesNotMatch(html, /Fallback block/);
  assert.doesNotMatch(html, /visible detail/);
});

test('renderNode checks kind/component keys when type is absent', () => {
  const fromKind = renderNode({ kind: 'kpi', value: 42 });
  const fromComponent = renderNode({ component: 'hr' });

  assert.match(fromKind, /metric-value/);
  assert.match(fromComponent, /<hr class="divider" \/>/);
});

test('renderNode supports image/icon/row/column/section renderers', () => {
  const image = renderNode({ type: 'image', src: 'https://example.com/pic.jpg', alt: 'Preview', caption: 'Safe image' });
  const icon = renderNode({ type: 'icon', icon: 'warning' });
  const row = renderNode({ type: 'row', children: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] });
  const column = renderNode({ type: 'column', children: [{ type: 'text', text: 'Top' }, { type: 'text', text: 'Bottom' }] });
  const section = renderNode({ type: 'section', title: 'Grouped', body: 'Body text', children: [{ type: 'text', text: 'Child' }] });

  assert.match(image, /<img /);
  assert.match(image, /<figcaption class="muted">Safe image<\/figcaption>/);
  assert.match(icon, /type-icon/);
  assert.match(icon, /warning/);
  assert.match(row, /type-row/);
  assert.match(column, /type-column/);
  assert.match(section, /type-section/);
  assert.match(section, /Grouped/);
});

test('renderNode rejects javascript URLs for image sources', () => {
  const html = renderNode({
    type: 'image',
    src: 'javascript:alert(1)',
    caption: 'blocked'
  });

  assert.match(html, /Image unavailable/);
  assert.doesNotMatch(html, /<img /);
  assert.doesNotMatch(html, /javascript:/i);
});

test('renderNode supports interactive foundation components for slice A', () => {
  const choice = renderNode({ type: 'multiplechoice', title: 'Pick one', items: ['A', 'B'], selected: 'A' });
  const datetime = renderNode({ type: 'datetimeinput', title: 'When', value: '2026-03-06T12:00' });
  const textField = renderNode({ type: 'textfield', variant: 'long', label: 'Notes', value: 'hello' });
  const actionButton = renderNode({ type: 'button', variant: 'destructive', label: 'Delete', action: { kind: 'delete', target: 'item-1' } });
  const tabs = renderNode({ type: 'tabs', items: ['Overview', 'Alerts'], active: 'alerts' });
  const slider = renderNode({ type: 'slider', min: 0, max: 10, value: 4, step: 2 });
  const checkbox = renderNode({ type: 'checkbox', label: 'Enable sync', checked: true });
  const modal = renderNode({ type: 'modal', title: 'Approve action', body: 'Proceed?', confirmLabel: 'Approve', cancelLabel: 'Cancel' });

  assert.match(choice, /type-choicepicker/);
  assert.match(choice, /choice-item/);
  assert.match(choice, /is-selected/);
  assert.match(choice, /role="radio"/);
  assert.match(datetime, /datetime-local/);
  assert.match(datetime, /data-a2ui-type="datetimeinput"/);
  assert.match(textField, /<textarea/);
  assert.match(textField, /data-a2ui-type="textfield"/);
  assert.match(actionButton, /ui-button destructive/);
  assert.match(actionButton, /data-a2ui-action=/);
  assert.match(actionButton, /data-action-type="delete"/);
  assert.match(actionButton, /data-action-target="item-1"/);
  assert.match(tabs, /type-tabs/);
  assert.match(tabs, /tab-pill/);
  assert.match(slider, /type-slider/);
  assert.match(slider, /type="range"/);
  assert.match(checkbox, /type-checkbox/);
  assert.match(checkbox, /type="checkbox"/);
  assert.match(modal, /type-modal/);
  assert.match(modal, /modal-actions/);
});

test('renderNode uses bindings and validation semantics for textfield/datetime/choicepicker', () => {
  const model = {
    note_text: 'bound note',
    due_on: '2026-03-09',
    schedule_at: '2026-03-09T12:30',
    picks: ['A', 'C']
  };
  const shortText = renderNode({
    type: 'textfield',
    bind: 'due_on',
    variant: 'date-like',
    validationState: 'error',
    validationMessage: 'Date is required',
    placeholder: 'YYYY-MM-DD'
  }, model);
  const longText = renderNode({
    type: 'textfield',
    bind: 'note_text',
    variant: 'long'
  }, model);
  const datetime = renderNode({
    type: 'datetimeinput',
    bind: 'schedule_at',
    validationState: 'valid'
  }, model);
  const multiChoice = renderNode({
    type: 'choicepicker',
    bind: 'picks',
    multiple: true,
    items: ['A', 'B', 'C']
  }, model);

  assert.match(shortText, /type="date"/);
  assert.match(shortText, /value="2026-03-09"/);
  assert.match(shortText, /aria-invalid="true"/);
  assert.match(longText, /bound note/);
  assert.match(datetime, /value="2026-03-09T12:30"/);
  assert.match(datetime, /is-valid/);
  assert.match(multiChoice, /role="checkbox"/);
  assert.match(multiChoice, /data-multi="true"/);
  assert.match(multiChoice, /is-selected/);
});

test('renderNode humanizes technical source errors for non-technical UX', () => {
  const primitive = renderNode('Missing source: nodes.location_get (error: node required).');
  const list = renderNode({
    type: 'list',
    items: ['Missing source: nodes.status (no paired nodes available).']
  });

  assert.match(primitive, /Some live information is unavailable right now\./);
  assert.match(list, /Some live information is unavailable right now\./);
  assert.doesNotMatch(primitive, /nodes\.location_get/);
  assert.doesNotMatch(list, /no paired nodes available/);
});
