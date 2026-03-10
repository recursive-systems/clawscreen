import {
  canonicalToCompatiblePayload,
  toCanonicalEnvelope,
  type A2UICanonicalEnvelope,
  type A2UICompatiblePayload
} from './a2ui.js';

export type MixedRunSegment =
  | {
      kind: 'text';
      text: string;
      raw: string;
      start: number;
      end: number;
    }
  | {
      kind: 'ui';
      raw: string;
      envelope: A2UICanonicalEnvelope;
      payload: A2UICompatiblePayload;
      start: number;
      end: number;
      delimiter: 'fence' | 'xml' | 'object';
    };

const FENCE_RE = /```(?:a2ui|ag-ui|json|ui)\s*\n([\s\S]*?)\n```/gi;
const XML_RE = /<(a2ui|ag-ui|ui)>([\s\S]*?)<\/\1>/gi;

function pushTextSegment(segments: MixedRunSegment[], source: string, start: number, end: number) {
  if (end <= start) return;
  const raw = source.slice(start, end);
  if (!raw.trim()) return;
  segments.push({ kind: 'text', text: raw, raw, start, end });
}

function parseEmbeddedUi(rawBody: string): { envelope: A2UICanonicalEnvelope; payload: A2UICompatiblePayload } | null {
  const trimmed = rawBody.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const envelope = toCanonicalEnvelope(parsed);
    return { envelope, payload: canonicalToCompatiblePayload(envelope) };
  } catch {
    return null;
  }
}

export function parseMixedRunStream(input: unknown): MixedRunSegment[] {
  if (typeof input === 'string') {
    const source = input;
    const matches: Array<{ start: number; end: number; body: string; delimiter: 'fence' | 'xml' }> = [];

    for (const match of source.matchAll(FENCE_RE)) {
      const [full, body] = match;
      if (typeof match.index !== 'number') continue;
      matches.push({ start: match.index, end: match.index + full.length, body, delimiter: 'fence' });
    }

    for (const match of source.matchAll(XML_RE)) {
      const [full, , body] = match;
      if (typeof match.index !== 'number') continue;
      matches.push({ start: match.index, end: match.index + full.length, body, delimiter: 'xml' });
    }

    matches.sort((a, b) => a.start - b.start || a.end - b.end);

    const segments: MixedRunSegment[] = [];
    let cursor = 0;

    for (const match of matches) {
      if (match.start < cursor) continue;
      pushTextSegment(segments, source, cursor, match.start);
      const parsed = parseEmbeddedUi(match.body);
      if (parsed) {
        segments.push({
          kind: 'ui',
          raw: source.slice(match.start, match.end),
          envelope: parsed.envelope,
          payload: parsed.payload,
          start: match.start,
          end: match.end,
          delimiter: match.delimiter
        });
      } else {
        pushTextSegment(segments, source, match.start, match.end);
      }
      cursor = match.end;
    }

    pushTextSegment(segments, source, cursor, source.length);
    return segments;
  }

  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const envelope = toCanonicalEnvelope(input);
    return [{
      kind: 'ui',
      raw: JSON.stringify(input),
      envelope,
      payload: canonicalToCompatiblePayload(envelope),
      start: 0,
      end: 0,
      delimiter: 'object'
    }];
  }

  return [];
}

export function extractLatestUiPayload(input: unknown): A2UICompatiblePayload | unknown {
  const segments = parseMixedRunStream(input);
  const latestUi = [...segments].reverse().find((segment) => segment.kind === 'ui');
  return latestUi && latestUi.kind === 'ui' ? latestUi.payload : input;
}

export function extractEmbeddedUiObject(input: string): unknown | null {
  const segments = parseMixedRunStream(input);
  const latestUi = [...segments].reverse().find((segment) => segment.kind === 'ui');
  if (!latestUi || latestUi.kind !== 'ui') return null;
  return latestUi.payload;
}
