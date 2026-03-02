import { type JsonValue, toCanonicalEnvelope, type A2UICanonicalEnvelope } from './a2ui.js';

export type A2UIActionEvent = {
  id: string;
  type: string;
  target?: string;
  timestamp: string;
  payload?: JsonValue;
  snapshot?: {
    screen?: JsonValue;
    model?: Record<string, JsonValue>;
  };
};

export type A2UIActionRequestEnvelope = {
  version: string;
  event: A2UIActionEvent;
};

export type A2UIActionResponseEnvelope = {
  ok: true;
  version: string;
  task: {
    id: string;
    status: 'completed';
  };
  a2ui: A2UICanonicalEnvelope;
};

const DEFAULT_VERSION = '0.8';

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const isIsoLike = (value: string): boolean => /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/u.test(value);

export function validateActionRequestEnvelope(raw: unknown):
  | { ok: true; value: A2UIActionRequestEnvelope }
  | { ok: false; error: string } {
  const root = asObject(raw);
  if (!root) return { ok: false, error: 'Action payload must be an object' };

  const version = typeof root.version === 'string' && root.version ? root.version : DEFAULT_VERSION;
  const event = asObject(root.event);
  if (!event) return { ok: false, error: 'Missing required object: event' };

  const id = typeof event.id === 'string' && event.id.trim() ? event.id.trim() : '';
  if (!id) return { ok: false, error: 'Missing required event.id (string)' };

  const type = typeof event.type === 'string' && event.type.trim() ? event.type.trim() : '';
  if (!type) return { ok: false, error: 'Missing required event.type (string)' };

  const timestampRaw = typeof event.timestamp === 'string' ? event.timestamp : new Date().toISOString();
  if (!isIsoLike(timestampRaw)) return { ok: false, error: 'event.timestamp must be ISO-8601 string' };

  const snapshot = asObject(event.snapshot);
  let normalizedSnapshot: A2UIActionEvent['snapshot'];
  if (snapshot) {
    const modelRaw = asObject(snapshot.model);
    normalizedSnapshot = {
      ...(snapshot.screen ? { screen: snapshot.screen as JsonValue } : {}),
      ...(modelRaw ? { model: modelRaw as Record<string, JsonValue> } : {})
    };
  }

  return {
    ok: true,
    value: {
      version,
      event: {
        id,
        type,
        timestamp: timestampRaw,
        ...(typeof event.target === 'string' && event.target ? { target: event.target } : {}),
        ...(event.payload !== undefined ? { payload: event.payload as JsonValue } : {}),
        ...(normalizedSnapshot ? { snapshot: normalizedSnapshot } : {})
      }
    }
  };
}

export function createActionResponseEnvelope(args: {
  version?: string;
  taskId: string;
  status?: 'completed';
  output: unknown;
}): A2UIActionResponseEnvelope {
  const version = args.version || DEFAULT_VERSION;
  const canonical = toCanonicalEnvelope(args.output);

  return {
    ok: true,
    version,
    task: {
      id: args.taskId,
      status: args.status || 'completed'
    },
    a2ui: canonical
  };
}
