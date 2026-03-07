import { type JsonValue, toCanonicalEnvelope, type A2UICanonicalEnvelope } from './a2ui.js';

export type A2UIActionProvenance = {
  origin: 'user' | 'agent' | 'system';
  session_id?: string;
  parent_task_id?: string;
  tool?: string;
  confidence?: number;
  timestamp?: string;
};

export type A2UIModality = 'form' | 'oauth_redirect' | 'biometric' | 'voice' | 'passkey';

export type A2UIHumanControl = {
  signal: 'pause' | 'resume' | 'takeover' | 'release';
  resume_token?: string;
  takeover_reason?: string;
};

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
  provenance?: A2UIActionProvenance;
};

export type A2UIActionRequestEnvelope = {
  version: string;
  event: A2UIActionEvent;
  control?: A2UIHumanControl;
  accepted_modalities?: A2UIModality[];
};

export type A2UITaskStatus = 'queued' | 'running' | 'paused' | 'input_required' | 'completed' | 'failed';

export type A2UIInputRequired = {
  reason: string;
  required_fields: string[];
  resume_token: string;
  modality?: A2UIModality;
  timeout_seconds?: number;
  fallback_action?: 'fail' | 'skip' | 'retry';
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

  const provenanceRaw = asObject(event.provenance);
  const provenance: A2UIActionProvenance | undefined = provenanceRaw
    ? {
        origin: (provenanceRaw.origin === 'agent' || provenanceRaw.origin === 'system') ? provenanceRaw.origin : 'user',
        ...(typeof provenanceRaw.session_id === 'string' ? { session_id: provenanceRaw.session_id } : {}),
        ...(typeof provenanceRaw.parent_task_id === 'string' ? { parent_task_id: provenanceRaw.parent_task_id } : {}),
        ...(typeof provenanceRaw.tool === 'string' ? { tool: provenanceRaw.tool } : {}),
        ...(typeof provenanceRaw.confidence === 'number' ? { confidence: provenanceRaw.confidence } : {}),
        ...(typeof provenanceRaw.timestamp === 'string' ? { timestamp: provenanceRaw.timestamp } : {})
      }
    : undefined;

  const controlRaw = asObject(root.control);
  const control = controlRaw && ['pause', 'resume', 'takeover', 'release'].includes(String(controlRaw.signal))
    ? {
        signal: String(controlRaw.signal) as A2UIHumanControl['signal'],
        ...(typeof controlRaw.resume_token === 'string' ? { resume_token: controlRaw.resume_token } : {}),
        ...(typeof controlRaw.takeover_reason === 'string' ? { takeover_reason: controlRaw.takeover_reason } : {})
      }
    : undefined;

  const acceptedModalities = Array.isArray(root.accepted_modalities)
    ? root.accepted_modalities.filter((m): m is A2UIModality =>
      typeof m === 'string' && ['form', 'oauth_redirect', 'biometric', 'voice', 'passkey'].includes(m)
    )
    : undefined;

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
        ...(normalizedSnapshot ? { snapshot: normalizedSnapshot } : {}),
        ...(provenance ? { provenance } : {})
      },
      ...(control ? { control } : {}),
      ...(acceptedModalities ? { accepted_modalities: acceptedModalities } : {})
    }
  };
}

const TASK_STATUS_ORDER: Record<A2UITaskStatus, number> = {
  queued: 1,
  running: 2,
  paused: 2,
  input_required: 3,
  completed: 4,
  failed: 4
};

export function validateTaskStatusTransition(previous: A2UITaskStatus | null, next: A2UITaskStatus): boolean {
  if (!previous) return next === 'queued' || next === 'running';
  if (previous === 'completed' || previous === 'failed') return false;
  if (previous === 'input_required') return next === 'running' || next === 'failed';
  if (previous === 'running') return next === 'running' || next === 'paused' || next === 'input_required' || next === 'completed' || next === 'failed';
  if (previous === 'paused') return next === 'running' || next === 'failed';
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
  if (!['queued', 'running', 'paused', 'input_required', 'completed', 'failed'].includes(status)) {
    return { ok: false, error: 'task.status must be one of queued|running|paused|input_required|completed|failed' };
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
        resume_token: typeof maybeInputRequired.resume_token === 'string' ? maybeInputRequired.resume_token : '',
        ...(typeof maybeInputRequired.modality === 'string' && ['form', 'oauth_redirect', 'biometric', 'voice', 'passkey'].includes(maybeInputRequired.modality)
          ? { modality: maybeInputRequired.modality as A2UIModality }
          : {}),
        ...(typeof maybeInputRequired.timeout_seconds === 'number' && maybeInputRequired.timeout_seconds > 0
          ? { timeout_seconds: Math.floor(maybeInputRequired.timeout_seconds) }
          : {}),
        ...(typeof maybeInputRequired.fallback_action === 'string' && ['fail', 'skip', 'retry'].includes(maybeInputRequired.fallback_action)
          ? { fallback_action: maybeInputRequired.fallback_action as 'fail' | 'skip' | 'retry' }
          : {})
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
