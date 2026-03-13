import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProfile,
  describeProfilePrompt,
  describeProfileRefresh,
  formatProfileUpdatedAt,
  nextProfileName,
  sanitizeLoadedProfile,
  sanitizeProfileName
} from '../src/profiles';

const safePayload = {
  version: '0.8',
  screen: {
    title: 'Saved',
    subtitle: 'Profile payload',
    blocks: [{ type: 'text', text: 'ok' }]
  }
};

test('sanitizeProfileName trims whitespace and falls back safely', () => {
  assert.equal(sanitizeProfileName('   Family   Focus   '), 'Family Focus');
  assert.equal(sanitizeProfileName(''), 'Saved screen');
});

test('createProfile applies defaults and prompt limits', () => {
  const created = createProfile({
    id: 'profile_1',
    name: ' Kitchen ',
    nowIso: '2026-03-13T15:30:00.000Z',
    lastPrompt: 'x'.repeat(1600),
    payload: safePayload as any
  });

  assert.equal(created.id, 'profile_1');
  assert.equal(created.name, 'Kitchen');
  assert.equal(created.lastPrompt.length, 1200);
  assert.equal(created.refreshIntervalSec, 60);
  assert.equal(created.autoRefreshEnabled, false);
});

test('nextProfileName skips existing names case-insensitively', () => {
  const first = createProfile({ id: '1', name: 'Saved screen 1', nowIso: '2026-03-13T15:30:00.000Z' });
  const second = createProfile({ id: '2', name: 'saved SCREEN 2', nowIso: '2026-03-13T15:30:00.000Z' });
  assert.equal(nextProfileName([first, second]), 'Saved screen 3');
});

test('sanitizeLoadedProfile keeps safe payloads and normalizes cadence', () => {
  const loaded = sanitizeLoadedProfile({
    id: 'loaded_1',
    name: ' Desk ',
    lastPrompt: 'Morning brief',
    lastPayload: safePayload,
    refreshIntervalSec: 120,
    autoRefreshEnabled: 1,
    updatedAt: '2026-03-13T15:30:00.000Z'
  }, {
    fallbackId: 'fallback_1',
    nowIso: '2026-03-13T15:31:00.000Z',
    isSafePayload: (payload) => Boolean(payload)
  });

  assert.ok(loaded);
  assert.equal(loaded?.id, 'loaded_1');
  assert.equal(loaded?.name, 'Desk');
  assert.equal(loaded?.refreshIntervalSec, 120);
  assert.equal(loaded?.autoRefreshEnabled, true);
  assert.deepEqual(loaded?.lastPayload, safePayload);
});

test('sanitizeLoadedProfile drops unsafe payloads and repairs invalid values', () => {
  const loaded = sanitizeLoadedProfile({
    name: '',
    lastPrompt: 'A'.repeat(1300),
    lastPayload: { evil: true },
    refreshIntervalSec: 999
  }, {
    fallbackId: 'fallback_2',
    nowIso: '2026-03-13T15:31:00.000Z',
    isSafePayload: () => false
  });

  assert.ok(loaded);
  assert.equal(loaded?.id, 'fallback_2');
  assert.equal(loaded?.name, 'Saved screen');
  assert.equal(loaded?.lastPrompt.length, 1200);
  assert.equal(loaded?.lastPayload, null);
  assert.equal(loaded?.refreshIntervalSec, 60);
});

test('profile descriptions produce human-readable manager copy', () => {
  const manual = createProfile({ id: 'manual', name: 'Manual', nowIso: '2026-03-13T15:30:00.000Z', lastPrompt: '' });
  const auto = { ...manual, autoRefreshEnabled: true, refreshIntervalSec: 300, lastPrompt: 'Show calendar and weather before pickup' };

  assert.equal(describeProfileRefresh(manual), 'Manual refresh only');
  assert.equal(describeProfileRefresh(auto), 'Auto refresh every 5 mins');
  assert.equal(describeProfilePrompt(manual), 'No prompt saved yet.');
  assert.equal(describeProfilePrompt(auto), 'Show calendar and weather before pickup');
  assert.match(formatProfileUpdatedAt('2026-03-13T15:30:00.000Z'), /Updated Mar 13/);
});
