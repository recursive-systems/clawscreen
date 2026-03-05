export function unwrapA2uiPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const candidate = payload as { a2ui?: unknown };
  return 'a2ui' in candidate ? candidate.a2ui : payload;
}
