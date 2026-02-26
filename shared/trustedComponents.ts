export const TRUSTED_COMPONENT_TYPES = ['text', 'list', 'metric', 'card', 'notes', 'divider'] as const;

export type TrustedComponentType = (typeof TRUSTED_COMPONENT_TYPES)[number];
export type TrustedComponentOrUnknown = TrustedComponentType | 'unknown';

const TYPE_ALIAS_MAP: Record<string, TrustedComponentType> = {
  text: 'text',
  markdown: 'text',
  summary: 'text',
  list: 'list',
  checklist: 'list',
  bullets: 'list',
  metric: 'metric',
  stat: 'metric',
  kpi: 'metric',
  card: 'card',
  panel: 'card',
  notes: 'notes',
  note: 'notes',
  divider: 'divider',
  hr: 'divider'
};

export function isTrustedComponentType(value: string): value is TrustedComponentType {
  return value in TYPE_ALIAS_MAP && TYPE_ALIAS_MAP[value] === value;
}

export function toTrustedComponentType(value: unknown): TrustedComponentOrUnknown {
  const normalized = String(value || '').toLowerCase();
  return TYPE_ALIAS_MAP[normalized] || 'unknown';
}

export function coerceTrustedComponentType(value: unknown, fallback: TrustedComponentType = 'card'): TrustedComponentType {
  const trusted = toTrustedComponentType(value);
  return trusted === 'unknown' ? fallback : trusted;
}
