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
  assert.equal(isTrustedComponentType('markdown'), false);
  assert.equal(isTrustedComponentType('unknown'), false);
});
