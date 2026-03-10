import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { toCanonicalEnvelope } from '../shared/a2ui.js';
import { canonicalEventsFromGenerateResult } from '../shared/canonicalRunEvent.js';
import { extractEmbeddedUiObject, extractLatestUiPayload, parseMixedRunStream } from '../shared/mixedRunStream.js';
import { createRunTimelineStore } from '../server/runTimeline.js';

const FIXTURES_DIR = path.join(process.cwd(), 'tests/fixtures/a2ui-valid');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

test('parseMixedRunStream preserves ordered text and ui segments across fence + xml payloads', () => {
  const source = readFixture('mixed-stream-happy.txt');
  const segments = parseMixedRunStream(source);

  assert.deepEqual(segments.map((segment) => segment.kind), ['text', 'ui', 'text', 'ui', 'text']);
  assert.equal(segments[0]?.kind, 'text');
  assert.match((segments[0] as { text: string }).text, /Narrative intro/);
  assert.equal(segments[1]?.kind, 'ui');
  assert.equal((segments[1] as { delimiter: string }).delimiter, 'fence');
  assert.equal((segments[3] as { delimiter: string }).delimiter, 'xml');

  const latest = extractLatestUiPayload(source) as { screen?: { title?: string } };
  assert.equal(latest.screen?.title, 'Ops HUD 2');
});

test('malformed embedded payload is isolated and downgraded to safe text', () => {
  const source = readFixture('mixed-stream-malformed.txt');
  const segments = parseMixedRunStream(source);

  assert.deepEqual(segments.map((segment) => segment.kind), ['text', 'text', 'text']);
  assert.equal(extractEmbeddedUiObject(source), null);
  assert.match((segments[1] as { text: string }).text, /```a2ui/);
});

test('generate result can emit replayable mixed text + ui timeline events in source order', () => {
  const source = readFixture('mixed-stream-happy.txt');
  const finalPayload = extractLatestUiPayload(source);
  const envelope = toCanonicalEnvelope(finalPayload);
  const events = canonicalEventsFromGenerateResult({
    runId: 'run_mixed',
    envelope,
    raw: source,
    summary: 'Mixed stream test run'
  });

  assert.deepEqual(events.map((event) => event.kind), ['run_started', 'text_chunk', 'ui_delta', 'text_chunk', 'ui_delta', 'text_chunk', 'completed']);
  assert.equal(events[1]?.text?.trim(), 'Narrative intro: here\'s the current dashboard status.');
  assert.equal(events[2]?.ui?.messages[1]?.type, 'surfaceUpdate');
  assert.match(events[3]?.text || '', /After the first screen/);
  assert.match(events[5]?.text || '', /Final narrative wrap-up/);

  const replay = createRunTimelineStore(16).appendMany('run_mixed', events);
  assert.deepEqual(replay.events.map((event) => event.kind), events.map((event) => event.kind));
});
