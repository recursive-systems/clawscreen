export type Primitive = string | number | boolean | null;
export type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

export type A2UIBlock = {
  type?: string;
  title?: string;
  label?: string;
  text?: string;
  body?: string;
  icon?: string;
  token?: string;
  alt?: string;
  caption?: string;
  url?: string;
  src?: string;
  image?: string;
  href?: string;
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

export type A2UIValidationError = {
  code: 'ValidationFailed';
  message: string;
  hints: string[];
};

export type A2UICapabilities = {
  version: string;
  supportedVersions: string[];
  messageTypes: {
    canonical: string[];
    aliases: string[];
  };
  components: string[];
  modalities: string[];
};

const DEFAULT_VERSION = '0.8';
const LATEST_VERSION = '0.9';

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

function normalizeMessageType(type: string): string {
  return type.trim();
}

function mapToCanonicalType(type: string): A2UICanonicalMessage['type'] | null {
  const normalized = normalizeMessageType(type);
  if (normalized === 'beginRendering' || normalized === 'createSurface') return 'beginRendering';
  if (normalized === 'surfaceUpdate' || normalized === 'updateComponents') return 'surfaceUpdate';
  if (normalized === 'dataModelUpdate' || normalized === 'updateDataModel' || normalized === 'sendDataModel') return 'dataModelUpdate';
  return null;
}

function inferVersion(msg: Record<string, unknown>, fallbackVersion: string, originalType?: string): string {
  const version = typeof msg.version === 'string' && msg.version ? msg.version : typeof msg.schemaVersion === 'string' && msg.schemaVersion ? msg.schemaVersion : '';
  if (version) return version;
  if (originalType && ['createSurface', 'updateComponents', 'updateDataModel', 'sendDataModel'].includes(originalType)) return LATEST_VERSION;
  return fallbackVersion;
}

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

  const screen = asObject(p.screen ?? p.surface ?? p.components);
  if (screen) return screen as A2UIScreen;

  if (Array.isArray(p.blocks) || Array.isArray(p.children) || Array.isArray(p.content) || Array.isArray(p.items)) {
    return p as A2UIScreen;
  }

  if (typeof p.title === 'string' || typeof p.subtitle === 'string' || typeof p.name === 'string') {
    return p as A2UIScreen;
  }

  return undefined;
}

function cloneModel(model: Record<string, JsonValue>): Record<string, JsonValue> {
  return { ...model };
}

function toCanonicalMessage(value: unknown, fallbackVersion: string): A2UICanonicalMessage | null {
  const msg = asObject(value);
  if (!msg) return null;
  const sourceType = typeof msg.type === 'string' ? msg.type : '';
  const type = mapToCanonicalType(sourceType);
  if (!type) return null;

  const version = inferVersion(msg, fallbackVersion, sourceType);

  if (type === 'beginRendering') {
    return {
      type: 'beginRendering',
      version,
      issuedAt: typeof msg.issuedAt === 'string' ? msg.issuedAt : new Date().toISOString()
    };
  }

  if (type === 'surfaceUpdate') {
    const screen = findScreenCandidate(msg.screen ?? msg.surface ?? msg.components ?? msg);
    if (!screen) return null;
    return { type: 'surfaceUpdate', version, screen };
  }

  const model = asObject(msg.model ?? msg.dataModel ?? msg.data);
  if (!model) return null;
  return { type: 'dataModelUpdate', version, model: model as Record<string, JsonValue> };
}

function canonicalMessagesFromObject(rawObject: Record<string, unknown>, fallbackVersion: string): A2UICanonicalMessage[] {
  if (Array.isArray(rawObject.messages)) {
    return rawObject.messages
      .map((msg) => toCanonicalMessage(msg, fallbackVersion))
      .filter(Boolean) as A2UICanonicalMessage[];
  }

  const payload = (rawObject.a2ui ?? rawObject.payload ?? rawObject) as unknown;
  const p = asObject(payload) || {};
  const version = inferVersion(p, fallbackVersion);
  const screen = findScreenCandidate(payload);

  const messages: A2UICanonicalMessage[] = [{ type: 'beginRendering', version, issuedAt: new Date().toISOString() }];

  if (screen) messages.push({ type: 'surfaceUpdate', version, screen });

  const model = asObject(p.model ?? p.dataModel ?? p.data);
  if (model) {
    messages.push({
      type: 'dataModelUpdate',
      version,
      model: model as Record<string, JsonValue>
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

export function validateRemoteA2UIIntent(raw: unknown): { ok: true } | { ok: false; error: A2UIValidationError } {
  const obj = asObject(raw);
  if (!obj) {
    return {
      ok: false,
      error: {
        code: 'ValidationFailed',
        message: 'Remote payload must be a JSON object.',
        hints: ['Send an object with either messages[] or a2ui/screen payload.']
      }
    };
  }

  const messages = Array.isArray(obj.messages) ? obj.messages : [obj];
  for (const entry of messages) {
    const msg = asObject(entry);
    if (!msg) continue;
    const type = typeof msg.type === 'string' ? msg.type : '';
    if (type && !mapToCanonicalType(type)) {
      return {
        ok: false,
        error: {
          code: 'ValidationFailed',
          message: `Unsupported message type: ${type}`,
          hints: [
            'Use canonical types beginRendering/surfaceUpdate/dataModelUpdate.',
            'Or use supported aliases createSurface/updateComponents/updateDataModel/sendDataModel.'
          ]
        }
      };
    }
  }

  return { ok: true };
}

export function getA2UICapabilities(): A2UICapabilities {
  return {
    version: LATEST_VERSION,
    supportedVersions: [DEFAULT_VERSION, LATEST_VERSION],
    messageTypes: {
      canonical: ['beginRendering', 'surfaceUpdate', 'dataModelUpdate'],
      aliases: ['createSurface', 'updateComponents', 'updateDataModel', 'sendDataModel']
    },
    components: ['text', 'list', 'metric', 'card', 'notes', 'divider', 'image', 'icon', 'row', 'column', 'section'],
    modalities: ['text', 'form', 'file', 'media']
  };
}

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

export function canonicalToCompatiblePayload(envelope: A2UICanonicalEnvelope): A2UICompatiblePayload {
  const finalState = applyCanonicalMessages(envelope.messages, createInitialRenderState(envelope.version || DEFAULT_VERSION));
  const fallbackScreen: A2UIScreen = { title: 'A2UI Output', blocks: [] };
  return { version: finalState.version || DEFAULT_VERSION, screen: finalState.screen || fallbackScreen };
}
