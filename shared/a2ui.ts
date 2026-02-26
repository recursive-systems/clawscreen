export type Primitive = string | number | boolean | null;
export type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

export type A2UIBlock = {
  type?: string;
  title?: string;
  label?: string;
  text?: string;
  body?: string;
  content?: JsonValue;
  value?: JsonValue;
  number?: JsonValue;
  metric?: JsonValue;
  delta?: string;
  items?: JsonValue[];
  values?: JsonValue[];
  children?: JsonValue[];
  [key: string]: unknown;
};

export type A2UIScreen = {
  title?: string;
  subtitle?: string;
  name?: string;
  blocks?: A2UIBlock[];
  children?: A2UIBlock[];
  content?: A2UIBlock[];
  items?: A2UIBlock[];
  [key: string]: unknown;
};

// Compatibility shape for current render path and /a2ui/generate response.
export type A2UICompatiblePayload = {
  version?: string;
  screen?: A2UIScreen;
  payload?: JsonValue;
  a2ui?: JsonValue;
  ops?: Array<{ value?: A2UIScreen }>;
  [key: string]: unknown;
};

export type A2UIBeginRenderingMessage = {
  type: 'beginRendering';
  version?: string;
  issuedAt?: string;
};

export type A2UISurfaceUpdateMessage = {
  type: 'surfaceUpdate';
  version?: string;
  screen: A2UIScreen;
};

export type A2UIDataModelUpdateMessage = {
  type: 'dataModelUpdate';
  version?: string;
  model: Record<string, JsonValue>;
};

export type A2UICanonicalMessage =
  | A2UIBeginRenderingMessage
  | A2UISurfaceUpdateMessage
  | A2UIDataModelUpdateMessage;

export type A2UICanonicalEnvelope = {
  version: string;
  messages: A2UICanonicalMessage[];
};

const DEFAULT_VERSION = '0.8';

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

function findScreenCandidate(payload: unknown): A2UIScreen | undefined {
  const p = asObject(payload);
  if (!p) return undefined;

  if (Array.isArray(p.ops)) {
    const setScreen = p.ops.find((op) => {
      const o = asObject(op);
      const v = asObject(o?.value);
      return !!(v && (Array.isArray(v.blocks) || Array.isArray(v.children) || Array.isArray(v.content) || Array.isArray(v.items)));
    });

    const maybeScreen = asObject(asObject(setScreen)?.value);
    if (maybeScreen) return maybeScreen as A2UIScreen;
  }

  const screen = asObject(p.screen);
  if (screen) return screen as A2UIScreen;

  if (Array.isArray(p.blocks) || Array.isArray(p.children) || Array.isArray(p.content) || Array.isArray(p.items)) {
    return p as A2UIScreen;
  }

  return p as A2UIScreen;
}

// Trust-boundary adapter: coerce mixed external payload shapes into one internal envelope.
export function toCanonicalEnvelope(raw: unknown): A2UICanonicalEnvelope {
  const r = asObject(raw) || {};
  const payload = (r.a2ui ?? r.payload ?? r) as unknown;
  const p = asObject(payload) || {};
  const version = typeof p.version === 'string' && p.version ? p.version : DEFAULT_VERSION;
  const screen = findScreenCandidate(payload);

  const messages: A2UICanonicalMessage[] = [
    { type: 'beginRendering', version, issuedAt: new Date().toISOString() }
  ];

  if (screen) messages.push({ type: 'surfaceUpdate', version, screen });

  if (asObject(p.model)) {
    messages.push({
      type: 'dataModelUpdate',
      version,
      model: p.model as Record<string, JsonValue>
    });
  }

  return { version, messages };
}

// Compatibility adapter: preserve legacy "{ version, screen }" contract for existing callers.
export function canonicalToCompatiblePayload(envelope: A2UICanonicalEnvelope): A2UICompatiblePayload {
  const version = envelope.version || DEFAULT_VERSION;
  const surface = envelope.messages.find((m) => m.type === 'surfaceUpdate') as A2UISurfaceUpdateMessage | undefined;
  const fallbackScreen: A2UIScreen = { title: 'A2UI Output', blocks: [] };
  return { version, screen: surface?.screen || fallbackScreen };
}
