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

export type A2UIRenderState = {
  version: string;
  beganRendering: boolean;
  screen?: A2UIScreen;
  model: Record<string, JsonValue>;
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

function cloneModel(model: Record<string, JsonValue>): Record<string, JsonValue> {
  return { ...model };
}

function toCanonicalMessage(value: unknown, fallbackVersion: string): A2UICanonicalMessage | null {
  const msg = asObject(value);
  if (!msg) return null;
  const type = typeof msg.type === 'string' ? msg.type : '';
  const version = typeof msg.version === 'string' && msg.version ? msg.version : fallbackVersion;

  if (type === 'beginRendering') {
    return {
      type: 'beginRendering',
      version,
      issuedAt: typeof msg.issuedAt === 'string' ? msg.issuedAt : new Date().toISOString()
    };
  }

  if (type === 'surfaceUpdate') {
    const screen = findScreenCandidate(msg.screen);
    if (!screen) return null;
    return { type: 'surfaceUpdate', version, screen };
  }

  if (type === 'dataModelUpdate') {
    const model = asObject(msg.model);
    if (!model) return null;
    return { type: 'dataModelUpdate', version, model: model as Record<string, JsonValue> };
  }

  return null;
}

function canonicalMessagesFromObject(rawObject: Record<string, unknown>, fallbackVersion: string): A2UICanonicalMessage[] {
  if (Array.isArray(rawObject.messages)) {
    return rawObject.messages
      .map((msg) => toCanonicalMessage(msg, fallbackVersion))
      .filter(Boolean) as A2UICanonicalMessage[];
  }

  const payload = (rawObject.a2ui ?? rawObject.payload ?? rawObject) as unknown;
  const p = asObject(payload) || {};
  const version = typeof p.version === 'string' && p.version ? p.version : fallbackVersion;
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

  return messages;
}

function extractCanonicalMessages(raw: unknown, fallbackVersion: string): A2UICanonicalMessage[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => extractCanonicalMessages(entry, fallbackVersion));
  }

  const obj = asObject(raw);
  if (!obj) return [];

  const directMessage = toCanonicalMessage(obj, fallbackVersion);
  if (directMessage) return [directMessage];

  return canonicalMessagesFromObject(obj, fallbackVersion);
}

// Trust-boundary adapter: coerce mixed external payload shapes into one internal envelope.
export function toCanonicalEnvelope(raw: unknown): A2UICanonicalEnvelope {
  const messages = extractCanonicalMessages(raw, DEFAULT_VERSION);
  const version = messages.find((m) => typeof m.version === 'string' && m.version)?.version || DEFAULT_VERSION;
  const safeMessages = messages.length
    ? messages
    : [{ type: 'beginRendering', version, issuedAt: new Date().toISOString() } satisfies A2UIBeginRenderingMessage];

  return { version, messages: safeMessages };
}

export function createInitialRenderState(version = DEFAULT_VERSION): A2UIRenderState {
  return {
    version,
    beganRendering: false,
    model: {}
  };
}

export function applyCanonicalMessage(state: A2UIRenderState, message: A2UICanonicalMessage): A2UIRenderState {
  const version = message.version || state.version || DEFAULT_VERSION;

  if (message.type === 'beginRendering') {
    return {
      ...state,
      version,
      beganRendering: true
    };
  }

  if (message.type === 'surfaceUpdate') {
    return {
      ...state,
      version,
      screen: message.screen
    };
  }

  return {
    ...state,
    version,
    model: {
      ...cloneModel(state.model),
      ...message.model
    }
  };
}

export function applyCanonicalMessages(
  messages: A2UICanonicalMessage[],
  initialState: A2UIRenderState = createInitialRenderState()
): A2UIRenderState {
  return messages.reduce((acc, message) => applyCanonicalMessage(acc, message), initialState);
}

// Compatibility adapter: preserve legacy "{ version, screen }" contract for existing callers.
export function canonicalToCompatiblePayload(envelope: A2UICanonicalEnvelope): A2UICompatiblePayload {
  const finalState = applyCanonicalMessages(envelope.messages, createInitialRenderState(envelope.version || DEFAULT_VERSION));
  const fallbackScreen: A2UIScreen = { title: 'A2UI Output', blocks: [] };
  return { version: finalState.version || DEFAULT_VERSION, screen: finalState.screen || fallbackScreen };
}
