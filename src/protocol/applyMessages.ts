import {
  A2UICanonicalEnvelope,
  A2UICanonicalMessage,
  A2UICompatiblePayload,
  A2UIRenderState,
  applyCanonicalMessages,
  canonicalToCompatiblePayload,
  createInitialRenderState,
  toCanonicalEnvelope
} from '../../shared/a2ui';

export type ApplyBatchResult = {
  envelope: A2UICanonicalEnvelope;
  state: A2UIRenderState;
  payload: A2UICompatiblePayload;
};

export function applyEnvelopeBatch(
  raw: unknown,
  previousState?: A2UIRenderState
): ApplyBatchResult {
  const envelope = toCanonicalEnvelope(raw);
  const baseState = previousState || createInitialRenderState(envelope.version);
  const state = applyCanonicalMessages(envelope.messages, baseState);

  // Keep legacy consumer shape available while all updates flow through the reducer path.
  const payload = canonicalToCompatiblePayload({
    version: state.version,
    messages: [
      { type: 'beginRendering', version: state.version },
      ...(state.screen ? [{ type: 'surfaceUpdate', version: state.version, screen: state.screen } as A2UICanonicalMessage] : [])
    ]
  });

  return { envelope, state, payload };
}

export function applyMessageBatch(
  messages: A2UICanonicalMessage[],
  previousState?: A2UIRenderState,
  version = '0.8'
): A2UIRenderState {
  const baseState = previousState || createInitialRenderState(version);
  return applyCanonicalMessages(messages, baseState);
}
