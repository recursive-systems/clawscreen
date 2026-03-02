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

export type A2UITaskStatus = 'queued' | 'running' | 'input_required' | 'completed' | 'failed';

export type A2UIInputRequired = {
  reason: string;
  required_fields: string[];
  resume_token: string;
};

export type A2UIActionResponseEnvelope = {
  ok: true;
  version: string;
  task_id: string;
  task: {
    id: string;
    status: A2UITaskStatus;
    progress_message?: string;
    artifact?: A2UICanonicalEnvelope;
    error?: {
      code: string;
      message: string;
    };
    input_required?: A2UIInputRequired;
  };
  a2ui?: A2UICanonicalEnvelope;
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

const TASK_STATUS_ORDER: Record<A2UITaskStatus, number> = {
  queued: 1,
  running: 2,
  input_required: 3,
  completed: 4,
  failed: 4
};

export function validateTaskStatusTransition(previous: A2UITaskStatus | null, next: A2UITaskStatus): boolean {
  if (!previous) return next === 'queued' || next === 'running';
  if (previous === 'completed' || previous === 'failed') return false;
  if (previous === 'input_required') return next === 'running' || next === 'failed';
  return TASK_STATUS_ORDER[next] >= TASK_STATUS_ORDER[previous];
}

export function validateActionResponseEnvelope(raw: unknown, previousStatus: A2UITaskStatus | null = null):
  | { ok: true; value: A2UIActionResponseEnvelope }
  | { ok: false; error: string } {
  const root = asObject(raw);
  if (!root || root.ok !== true) return { ok: false, error: 'Response envelope must be an object with ok=true' };

  const version = typeof root.version === 'string' && root.version ? root.version : DEFAULT_VERSION;
  const task = asObject(root.task);
  if (!task) return { ok: false, error: 'Missing required object: task' };

  const taskId = typeof task.id === 'string' && task.id ? task.id : typeof root.task_id === 'string' ? root.task_id : '';
  if (!taskId) return { ok: false, error: 'Missing required task id (task.id or task_id)' };

  const status = typeof task.status === 'string' ? task.status : '';
  if (!['queued', 'running', 'input_required', 'completed', 'failed'].includes(status)) {
    return { ok: false, error: 'task.status must be one of queued|running|input_required|completed|failed' };
  }

  if (!validateTaskStatusTransition(previousStatus, status as A2UITaskStatus)) {
    return { ok: false, error: `Invalid task status transition: ${previousStatus || 'null'} -> ${status}` };
  }

  const progress = typeof task.progress_message === 'string' && task.progress_message ? task.progress_message : undefined;

  const maybeInputRequired = asObject(task.input_required);
  const inputRequired = maybeInputRequired
    ? {
        reason: typeof maybeInputRequired.reason === 'string' ? maybeInputRequired.reason : '',
        required_fields: Array.isArray(maybeInputRequired.required_fields)
          ? maybeInputRequired.required_fields.filter((f): f is string => typeof f === 'string' && !!f)
          : [],
        resume_token: typeof maybeInputRequired.resume_token === 'string' ? maybeInputRequired.resume_token : ''
      }
    : undefined;

  if (status === 'input_required') {
    if (!inputRequired?.reason || !inputRequired.required_fields.length || !inputRequired.resume_token) {
      return { ok: false, error: 'input_required status requires task.input_required.reason, required_fields[], resume_token' };
    }
  }

  const maybeError = asObject(task.error);
  const error = maybeError
    ? {
        code: typeof maybeError.code === 'string' && maybeError.code ? maybeError.code : 'unknown_error',
        message: typeof maybeError.message === 'string' && maybeError.message ? maybeError.message : 'Unknown error'
      }
    : undefined;

  if (status === 'failed' && !error) {
    return { ok: false, error: 'failed status requires task.error with code and message' };
  }

  const artifact = task.artifact ? toCanonicalEnvelope(task.artifact) : undefined;
  if (status === 'completed' && !artifact) {
    return { ok: false, error: 'completed status requires task.artifact' };
  }

  const normalized: A2UIActionResponseEnvelope = {
    ok: true,
    version,
    task_id: taskId,
    task: {
      id: taskId,
      status: status as A2UITaskStatus,
      ...(progress ? { progress_message: progress } : {}),
      ...(artifact ? { artifact } : {}),
      ...(error ? { error } : {}),
      ...(inputRequired ? { input_required: inputRequired } : {})
    },
    ...(artifact ? { a2ui: artifact } : {})
  };

  return { ok: true, value: normalized };
}

export function createActionResponseEnvelope(args: {
  version?: string;
  taskId: string;
  status?: A2UITaskStatus;
  progressMessage?: string;
  output?: unknown;
  error?: { code: string; message: string };
  inputRequired?: A2UIInputRequired;
}): A2UIActionResponseEnvelope {
  const version = args.version || DEFAULT_VERSION;
  const status = args.status || 'completed';
  const canonical = args.output ? toCanonicalEnvelope(args.output) : undefined;

  return {
    ok: true,
    version,
    task_id: args.taskId,
    task: {
      id: args.taskId,
      status,
      ...(args.progressMessage ? { progress_message: args.progressMessage } : {}),
      ...(canonical ? { artifact: canonical } : {}),
      ...(args.error ? { error: args.error } : {}),
      ...(args.inputRequired ? { input_required: args.inputRequired } : {})
    },
    ...(canonical ? { a2ui: canonical } : {})
  };
}
