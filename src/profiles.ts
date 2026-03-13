import type { A2UICompatiblePayload } from '../shared/a2ui';

export const MAX_PROFILE_NAME_LENGTH = 48;
export const MAX_PROFILE_PROMPT_LENGTH = 1200;
export const ALLOWED_REFRESH_INTERVALS = [30, 60, 120, 300] as const;

export type ScreenProfile = {
  id: string;
  name: string;
  lastPrompt: string;
  lastPayload: A2UICompatiblePayload | null;
  updatedAt: string;
  refreshIntervalSec?: number;
  autoRefreshEnabled?: boolean;
};

export function sanitizeProfileName(input: unknown): string {
  const name = String(input || '').trim().replace(/\s+/g, ' ').slice(0, MAX_PROFILE_NAME_LENGTH);
  return name || 'Saved screen';
}

export function createProfile(input: {
  name: string;
  id: string;
  nowIso: string;
  lastPrompt?: string;
  payload?: A2UICompatiblePayload | null;
}): ScreenProfile {
  return {
    id: input.id,
    name: sanitizeProfileName(input.name),
    lastPrompt: String(input.lastPrompt || '').slice(0, MAX_PROFILE_PROMPT_LENGTH),
    lastPayload: input.payload || null,
    updatedAt: input.nowIso,
    refreshIntervalSec: 60,
    autoRefreshEnabled: false
  };
}

export function nextProfileName(existingProfiles: ScreenProfile[], base = 'Saved screen'): string {
  const existing = new Set(existingProfiles.map((profile) => profile.name.trim().toLowerCase()));
  for (let index = 1; index <= 999; index += 1) {
    const candidate = `${base} ${index}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

export function sanitizeLoadedProfile(candidate: unknown, options: { fallbackId: string; nowIso: string; isSafePayload: (payload: unknown) => boolean }): ScreenProfile | null {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : options.fallbackId;
  const lastPromptRaw = typeof record.lastPrompt === 'string' ? record.lastPrompt : '';
  const lastPrompt = lastPromptRaw.slice(0, MAX_PROFILE_PROMPT_LENGTH);
  const lastPayload = record.lastPayload ?? null;
  const refreshIntervalSec = Number(record.refreshIntervalSec);

  return {
    id,
    name: sanitizeProfileName(record.name),
    lastPrompt,
    lastPayload: lastPayload && options.isSafePayload(lastPayload) ? (lastPayload as A2UICompatiblePayload) : null,
    updatedAt: typeof record.updatedAt === 'string' && record.updatedAt ? record.updatedAt : options.nowIso,
    refreshIntervalSec: ALLOWED_REFRESH_INTERVALS.includes(refreshIntervalSec as (typeof ALLOWED_REFRESH_INTERVALS)[number]) ? refreshIntervalSec : 60,
    autoRefreshEnabled: Boolean(record.autoRefreshEnabled)
  };
}

export function describeProfileRefresh(profile: ScreenProfile): string {
  if (!profile.autoRefreshEnabled) return 'Manual refresh only';
  const interval = profile.refreshIntervalSec || 60;
  if (interval < 60) return `Auto refresh every ${interval} sec`;
  if (interval % 60 === 0) {
    const mins = interval / 60;
    return `Auto refresh every ${mins} min${mins === 1 ? '' : 's'}`;
  }
  return `Auto refresh every ${interval} sec`;
}

export function describeProfilePrompt(profile: ScreenProfile): string {
  const prompt = String(profile.lastPrompt || '').trim();
  if (!prompt) return 'No prompt saved yet.';
  return prompt.length > 140 ? `${prompt.slice(0, 137)}…` : prompt;
}

export function formatProfileUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return 'Updated just now';
  return `Updated ${date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}
