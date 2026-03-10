import type { A2UICanonicalEnvelope } from './a2ui.js';
import { parseMixedRunStream } from './mixedRunStream.js';
import type {
  A2UIActionProvenance,
  A2UIActionResponseEnvelope,
  A2UIInputRequired,
  A2UIInterruptPayload,
  A2UIResumeContext,
  A2UITaskStatus
} from './actionEnvelope.js';

export type RunEventTrust = 'trusted' | 'untrusted';
export type RunEventKind =
  | 'run_started'
  | 'status_delta'
  | 'text_chunk'
  | 'ui_delta'
  | 'input_required'
  | 'interrupted'
  | 'resumed'
  | 'completed'
  | 'errored'
  | 'handoff_requested';

export type RunEventSource = {
  channel: 'generate' | 'action' | 'server' | 'gateway' | 'client';
  label: string;
  origin: 'local' | 'remote' | 'user' | 'agent' | 'system';
  tool?: string;
};

export type CanonicalRunCapabilities = {
  components: string[];
  modalities: string[];
  interrupts: boolean;
  screenshot: boolean;
  payloadLimitKb?: number;
  messageTypes?: string[];
};

export type CanonicalRunEvent = {
  eventId: string;
  runId: string;
  sequence: number;
  timestamp: string;
  kind: RunEventKind;
  trust: RunEventTrust;
  source: RunEventSource;
  summary: string;
  status?: A2UITaskStatus | 'interrupted' | 'errored' | 'completed';
  surfaceId?: string;
  capabilities?: CanonicalRunCapabilities;
  provenance?: A2UIActionProvenance;
  text?: string;
  ui?: A2UICanonicalEnvelope;
  inputRequired?: A2UIInputRequired;
  interrupt?: A2UIInterruptPayload;
  resume?: A2UIResumeContext;
  error?: { code: string; message: string };
  payload?: unknown;
};

export type CanonicalRunSummary = {
  runId: string;
  latestEventId: string;
  latestKind: RunEventKind;
  latestStatus: CanonicalRunEvent['status'];
  trust: RunEventTrust;
  sourceLabel: string;
  eventCount: number;
  startedAt: string;
  updatedAt: string;
  capabilities?: CanonicalRunCapabilities;
};

let sequenceSeed = 0;

export function createRunId(prefix = 'run'): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

export function createCanonicalRunEvent(args: Omit<CanonicalRunEvent, 'eventId' | 'sequence'> & { sequence?: number }): CanonicalRunEvent {
  sequenceSeed += 1;
  return {
    eventId: `${args.runId}_evt_${sequenceSeed}`,
    sequence: typeof args.sequence === 'number' ? args.sequence : sequenceSeed,
    ...args
  };
}

export function summarizeRun(events: CanonicalRunEvent[]): CanonicalRunSummary | null {
  if (!events.length) return null;
  const started = events.find((event) => event.kind === 'run_started') || events[0];
  const latest = events[events.length - 1];
  return {
    runId: latest.runId,
    latestEventId: latest.eventId,
    latestKind: latest.kind,
    latestStatus: latest.status,
    trust: latest.trust,
    sourceLabel: latest.source.label,
    eventCount: events.length,
    startedAt: started.timestamp,
    updatedAt: latest.timestamp,
    capabilities: started.capabilities || latest.capabilities
  };
}

export function capabilitiesFromA2UI(input: {
  components?: string[];
  modalities?: string[];
  messageTypes?: string[];
  payloadLimitKb?: number;
  interrupts?: boolean;
  screenshot?: boolean;
}): CanonicalRunCapabilities {
  return {
    components: Array.isArray(input.components) ? input.components : [],
    modalities: Array.isArray(input.modalities) ? input.modalities : [],
    messageTypes: Array.isArray(input.messageTypes) ? input.messageTypes : undefined,
    payloadLimitKb: typeof input.payloadLimitKb === 'number' ? input.payloadLimitKb : undefined,
    interrupts: input.interrupts !== false,
    screenshot: Boolean(input.screenshot)
  };
}

export function canonicalEventsFromActionResponse(args: {
  runId: string;
  response: A2UIActionResponseEnvelope;
  source?: RunEventSource;
  trust?: RunEventTrust;
  capabilities?: CanonicalRunCapabilities;
  provenance?: A2UIActionProvenance;
}): CanonicalRunEvent[] {
  const { runId, response } = args;
  const trust = args.trust || 'trusted';
  const source = args.source || { channel: 'action', label: 'Action API', origin: 'agent', tool: 'a2ui.action' };
  const timestamp = new Date().toISOString();
  const events: CanonicalRunEvent[] = [
    createCanonicalRunEvent({
      runId,
      timestamp,
      kind: 'run_started',
      trust,
      source,
      summary: 'Action run started',
      status: 'queued',
      capabilities: args.capabilities,
      provenance: args.provenance
    }),
    createCanonicalRunEvent({
      runId,
      timestamp,
      kind: 'status_delta',
      trust,
      source,
      summary: response.task.progress_message || `Task is ${response.task.status}`,
      status: response.task.status,
      provenance: args.provenance,
      ...(response.task.resume ? { resume: response.task.resume } : {})
    })
  ];

  if (response.task.input_required) {
    events.push(createCanonicalRunEvent({
      runId,
      timestamp,
      kind: 'input_required',
      trust,
      source,
      summary: response.task.input_required.reason,
      status: 'input_required',
      inputRequired: response.task.input_required,
      provenance: args.provenance
    }));
  }

  if (response.task.outcome === 'interrupt' && response.task.interrupt) {
    events.push(createCanonicalRunEvent({
      runId,
      timestamp,
      kind: 'interrupted',
      trust,
      source,
      summary: response.task.interrupt.reason,
      status: 'interrupted',
      interrupt: response.task.interrupt,
      provenance: args.provenance
    }));
  }

  if (response.task.resume) {
    events.push(createCanonicalRunEvent({
      runId,
      timestamp,
      kind: 'resumed',
      trust,
      source,
      summary: 'Run resumed',
      status: response.task.status === 'completed' ? 'completed' : response.task.status,
      resume: response.task.resume,
      provenance: args.provenance
    }));
  }

  if (response.task.artifact) {
    events.push(createCanonicalRunEvent({
      runId,
      timestamp,
      kind: 'ui_delta',
      trust,
      source,
      summary: 'UI artifact updated',
      status: response.task.status,
      ui: response.task.artifact,
      surfaceId: response.task.id,
      provenance: args.provenance
    }));
  }

  if (response.task.status === 'completed') {
    events.push(createCanonicalRunEvent({
      runId,
      timestamp,
      kind: 'completed',
      trust,
      source,
      summary: response.task.progress_message || 'Run completed',
      status: 'completed',
      provenance: args.provenance,
      ...(response.task.interrupt ? { interrupt: response.task.interrupt } : {})
    }));
  }

  if (response.task.status === 'failed' && response.task.error) {
    events.push(createCanonicalRunEvent({
      runId,
      timestamp,
      kind: 'errored',
      trust,
      source,
      summary: response.task.error.message,
      status: 'errored',
      error: response.task.error,
      provenance: args.provenance
    }));
  }

  return events;
}

export function canonicalEventsFromGenerateResult(args: {
  runId: string;
  envelope: A2UICanonicalEnvelope;
  source?: RunEventSource;
  trust?: RunEventTrust;
  capabilities?: CanonicalRunCapabilities;
  summary?: string;
  raw?: unknown;
}): CanonicalRunEvent[] {
  const trust = args.trust || 'trusted';
  const source = args.source || { channel: 'generate', label: 'OpenClaw Gateway', origin: 'remote', tool: 'openclaw-gateway' };
  const timestamp = new Date().toISOString();
  const rawSegments = args.raw == null ? [] : parseMixedRunStream(args.raw);
  const orderedContentEvents = rawSegments.flatMap((segment): CanonicalRunEvent[] => {
    if (segment.kind === 'text') {
      return [createCanonicalRunEvent({
        runId: args.runId,
        timestamp,
        kind: 'text_chunk',
        trust,
        source,
        summary: segment.text.trim().slice(0, 80) || 'Narrative update',
        status: 'running',
        text: segment.text,
        payload: { text: segment.text }
      })];
    }

    return [createCanonicalRunEvent({
      runId: args.runId,
      timestamp,
      kind: 'ui_delta',
      trust,
      source,
      summary: 'Screen updated from canonical envelope',
      status: 'running',
      ui: segment.envelope,
      surfaceId: 'primary',
      payload: { delimiter: segment.delimiter }
    })];
  });

  const contentEvents = orderedContentEvents.length
    ? orderedContentEvents
    : [createCanonicalRunEvent({
        runId: args.runId,
        timestamp,
        kind: 'ui_delta',
        trust,
        source,
        summary: 'Screen updated from canonical envelope',
        status: 'running',
        ui: args.envelope,
        surfaceId: 'primary'
      })];

  return [
    createCanonicalRunEvent({
      runId: args.runId,
      timestamp,
      kind: 'run_started',
      trust,
      source,
      summary: args.summary || 'Generate run started',
      status: 'running',
      capabilities: args.capabilities
    }),
    ...contentEvents,
    createCanonicalRunEvent({
      runId: args.runId,
      timestamp,
      kind: 'completed',
      trust,
      source,
      summary: 'Generate run completed',
      status: 'completed'
    })
  ];
}

export function canonicalErrorEvents(args: {
  runId: string;
  message: string;
  source?: RunEventSource;
  trust?: RunEventTrust;
  capabilities?: CanonicalRunCapabilities;
  code?: string;
}): CanonicalRunEvent[] {
  const source = args.source || { channel: 'server', label: 'ClawScreen Server', origin: 'system' };
  const trust = args.trust || 'trusted';
  const timestamp = new Date().toISOString();
  return [
    createCanonicalRunEvent({
      runId: args.runId,
      timestamp,
      kind: 'run_started',
      trust,
      source,
      summary: 'Run started',
      status: 'running',
      capabilities: args.capabilities
    }),
    createCanonicalRunEvent({
      runId: args.runId,
      timestamp,
      kind: 'errored',
      trust,
      source,
      summary: args.message,
      status: 'errored',
      error: { code: args.code || 'generation_failed', message: args.message }
    })
  ];
}
