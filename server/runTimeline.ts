import type { CanonicalRunEvent, CanonicalRunSummary } from '../shared/canonicalRunEvent.js';
import { summarizeRun } from '../shared/canonicalRunEvent.js';
import { createRunAuthorityStore } from './runAuthority.js';

export type RunTimelineSnapshot = {
  runId: string;
  events: CanonicalRunEvent[];
  summary: CanonicalRunSummary | null;
};

export function createRunTimelineStore(maxEventsPerRun = 24) {
  const store = new Map<string, CanonicalRunEvent[]>();
  const authority = createRunAuthorityStore();

  const append = (runId: string, event: CanonicalRunEvent): RunTimelineSnapshot => {
    const governedEvents = authority.applyEvent(runId, event);
    const next = [...(store.get(runId) || []), ...governedEvents].slice(-maxEventsPerRun);
    store.set(runId, next);
    return { runId, events: next, summary: summarizeRun(next) };
  };

  const appendMany = (runId: string, events: CanonicalRunEvent[]): RunTimelineSnapshot => {
    let snapshot: RunTimelineSnapshot = { runId, events: store.get(runId) || [], summary: summarizeRun(store.get(runId) || []) };
    for (const event of events) snapshot = append(runId, event);
    return snapshot;
  };

  const getTimeline = (runId: string): RunTimelineSnapshot => {
    const events = store.get(runId) || [];
    return { runId, events, summary: summarizeRun(events) };
  };

  return { append, appendMany, getTimeline };
}
