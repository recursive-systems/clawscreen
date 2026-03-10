import { extractLatestUiPayload } from '../../shared/mixedRunStream.js';

export function unwrapA2uiPayload(payload: unknown): unknown {
  if (typeof payload === 'string') return extractLatestUiPayload(payload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const candidate = payload as { a2ui?: unknown };
  return 'a2ui' in candidate ? extractLatestUiPayload(candidate.a2ui) : payload;
}
