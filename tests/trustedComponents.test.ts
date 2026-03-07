import test from 'node:test';
import assert from 'node:assert/strict';

import {
  coerceTrustedComponentType,
  isTrustedComponentType,
  toTrustedComponentType
} from '../shared/trustedComponents';

test('toTrustedComponentType maps canonical and alias values', () => {
  assert.equal(toTrustedComponentType('text'), 'text');
  assert.equal(toTrustedComponentType('markdown'), 'text');
  assert.equal(toTrustedComponentType('stat'), 'metric');
  assert.equal(toTrustedComponentType('panel'), 'card');
  assert.equal(toTrustedComponentType('note'), 'notes');
  assert.equal(toTrustedComponentType('hr'), 'divider');
  assert.equal(toTrustedComponentType('img'), 'image');
  assert.equal(toTrustedComponentType('glyph'), 'icon');
  assert.equal(toTrustedComponentType('hstack'), 'row');
  assert.equal(toTrustedComponentType('col'), 'column');
  assert.equal(toTrustedComponentType('group'), 'section');
  assert.equal(toTrustedComponentType('multiplechoice'), 'choicepicker');
  assert.equal(toTrustedComponentType('datetime'), 'datetimeinput');
  assert.equal(toTrustedComponentType('input'), 'textfield');
  assert.equal(toTrustedComponentType('cta'), 'button');
});

test('toTrustedComponentType normalizes casing and unknownish inputs', () => {
  assert.equal(toTrustedComponentType('SUMMARY'), 'text');
  assert.equal(toTrustedComponentType('not-real'), 'unknown');
  assert.equal(toTrustedComponentType(undefined), 'unknown');
  assert.equal(toTrustedComponentType(null), 'unknown');
});

test('coerceTrustedComponentType returns fallback for unknown values', () => {
  assert.equal(coerceTrustedComponentType('kpi'), 'metric');
  assert.equal(coerceTrustedComponentType('missing-type'), 'card');
  assert.equal(coerceTrustedComponentType('missing-type', 'list'), 'list');
});

test('isTrustedComponentType only accepts canonical values', () => {
  assert.equal(isTrustedComponentType('text'), true);
  assert.equal(isTrustedComponentType('divider'), true);
  assert.equal(isTrustedComponentType('image'), true);
  assert.equal(isTrustedComponentType('section'), true);
  assert.equal(isTrustedComponentType('choicepicker'), true);
  assert.equal(isTrustedComponentType('datetimeinput'), true);
  assert.equal(isTrustedComponentType('textfield'), true);
  assert.equal(isTrustedComponentType('button'), true);
  assert.equal(isTrustedComponentType('markdown'), false);
  assert.equal(isTrustedComponentType('unknown'), false);
});
