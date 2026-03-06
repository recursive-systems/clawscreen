import './styles.css';
import {
  A2UIBlock,
  A2UICanonicalEnvelope,
  A2UICompatiblePayload,
  A2UIRenderState,
  createInitialRenderState
} from '../shared/a2ui';
import { renderNode } from './render/registry';
import { applyEnvelopeBatch } from './protocol/applyMessages';
import { unwrapA2uiPayload } from './protocol/unwrapPayload';

const APP_VERSION = 'clawscreen-v1';
const A2UI_ENDPOINT_CANDIDATES = ['/a2ui/generate', `${window.location.protocol}//${window.location.hostname}:18841/a2ui/generate`];
const REQUEST_TIMEOUT_MS = 130_000;
const MAX_RETRIES = 2;
const MAX_PROMPT_LENGTH = 1200;
const A2UI_STORAGE_KEY = 'clawscreen.lastKnownGoodA2UI.v1';
const PROFILES_STORAGE_KEY = 'clawscreen.screenProfiles.v1';

type ScreenProfile = {
  id: string;
  name: string;
  lastPrompt: string;
  lastPayload: A2UICompatiblePayload | null;
  updatedAt: string;
  refreshIntervalSec?: number;
  autoRefreshEnabled?: boolean;
};

type Primitive = string | number | boolean | null | undefined;
type Json = Primitive | Json[] | { [key: string]: Json };

const els = {
  app: document.getElementById('app') as HTMLElement,
  time: document.getElementById('timeDisplay') as HTMLElement,
  date: document.getElementById('dateDisplay') as HTMLElement,
  title: document.getElementById('sceneTitle') as HTMLElement,
  subtitle: document.getElementById('sceneSubtitle') as HTMLElement,
  promptInput: document.getElementById('promptInput') as HTMLInputElement,
  submitBtn: document.getElementById('generateBtn') as HTMLButtonElement,
  retryBtn: document.getElementById('retryBtn') as HTMLButtonElement,
  profileTabs: document.getElementById('profileTabs') as HTMLElement,
  profileManagerTabs: document.getElementById('profileManagerTabs') as HTMLElement,
  openProfileManagerBtn: document.getElementById('openProfileManagerBtn') as HTMLButtonElement,
  profileManagerDialog: document.getElementById('profileManagerDialog') as HTMLDialogElement,
  profileManagerCloseBtn: document.getElementById('profileManagerCloseBtn') as HTMLButtonElement,
  saveProfileBtn: document.getElementById('saveProfileBtn') as HTMLButtonElement,
  renameProfileBtn: document.getElementById('renameProfileBtn') as HTMLButtonElement,
  deleteProfileBtn: document.getElementById('deleteProfileBtn') as HTMLButtonElement,
  refreshProfileBtn: document.getElementById('refreshProfileBtn') as HTMLButtonElement,
  autoRefreshEnabled: document.getElementById('autoRefreshEnabled') as HTMLInputElement,
  autoRefreshInterval: document.getElementById('autoRefreshInterval') as HTMLSelectElement,
  renderSurface: document.getElementById('sceneCards') as HTMLElement,
  rawDialog: document.getElementById('rawSceneDialog') as HTMLDialogElement,
  rawOutput: document.getElementById('rawSceneOutput') as HTMLElement,
  showRawBtn: document.getElementById('showRawBtn') as HTMLButtonElement,
  rawCloseBtn: document.getElementById('rawCloseBtn') as HTMLButtonElement,
  statusPill: document.getElementById('statusPill') as HTMLElement,
  statusTitle: document.getElementById('statusTitle') as HTMLElement,
  statusInfo: document.getElementById('statusInfo') as HTMLElement,
  statusMessage: document.getElementById('statusMessage') as HTMLElement,
  sourceBadges: document.getElementById('sourceBadges') as HTMLElement,
  screenUpdatedAt: document.getElementById('screenUpdatedAt') as HTMLElement
};

const state: {
  lastPrompt: string;
  lastPayload: A2UICompatiblePayload | null;
  renderState: A2UIRenderState;
  lastError: Error | null;
  profiles: ScreenProfile[];
  activeProfileId: string;
  autoRefreshTimer: number | null;
  isSubmitting: boolean;
} = {
  lastPrompt: 'Show me everything I need before leaving in 20 minutes.',
  lastPayload: null,
  renderState: createInitialRenderState('0.8'),
  lastError: null,
  profiles: [],
  activeProfileId: '',
  autoRefreshTimer: null,
  isSubmitting: false
};

const offlineFallbackPayload: A2UICompatiblePayload = {
  version: '0.8',
  screen: {
    title: 'Offline Dev Fallback',
    subtitle: 'Gateway unavailable — local payload rendered',
    updatedAt: new Date().toISOString(),
    source: 'local_fallback',
    blocks: [
      {
        type: 'card',
        title: 'Prompt-to-Screen is active',
        body: 'You are seeing a minimal local fallback used only when generation cannot be reached.'
      },
      {
        type: 'list',
        title: 'Next checks',
        items: [
          'Verify OpenClaw Gateway route for A2UI generation',
          'Submit a prompt to confirm dynamic payload changes',
          'Use “Show Raw” to inspect returned payload'
        ]
      }
    ]
  }
};

function heuristicPayloadFromPrompt(prompt: string): A2UICompatiblePayload {
  const p = String(prompt || '').trim();
  const lower = p.toLowerCase();
  const blocks: A2UIBlock[] = [];

  blocks.push({ type: 'summary', title: 'Your request', text: p });

  if (/calm|simplify|stress|overwhelmed/.test(lower)) {
    blocks.push({
      type: 'list',
      title: 'Three focus actions',
      items: ['Pick one must-do outcome', 'Remove one non-essential task', 'Start a 25-minute focused block']
    });
  }

  if (/morning|leave|today|brief/.test(lower)) {
    blocks.push({
      type: 'list',
      title: 'Right now',
      items: ['Next commitment and departure buffer', 'Critical messages to check', 'Top blocker to clear first']
    });
  }

  if (/executive|overview|system|status|openclaw/.test(lower)) {
    blocks.push({ type: 'metric', title: 'System snapshot', label: 'Mode', value: 'Prototype / Prompt-to-Screen' });
    blocks.push({ type: 'list', title: 'Suggested checks', items: ['Gateway health', 'Active automations', 'Recent updates or failures'] });
  }

  if (blocks.length === 1) {
    blocks.push({
      type: 'notes',
      title: 'Interpreted intent',
      body: 'No fixed template matched, so this screen is intentionally generic and generated from your request.'
    });
  }

  return {
    version: '0.8',
    screen: {
      title: 'Dynamic Prompt View',
      subtitle: 'Local heuristic render (while Gateway generation endpoint is unavailable)',
      updatedAt: nowIso(),
      source: 'local_heuristic',
      blocks
    }
  };
}

const nowIso = () => new Date().toISOString();

function formatLastUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Last updated: just now';
  return `Last updated: ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSourceLabel(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function collectSourceLabels(payload: A2UICompatiblePayload): string[] {
  const labels = new Set<string>();

  const push = (candidate: unknown) => {
    if (typeof candidate === 'string' && candidate.trim()) labels.add(normalizeSourceLabel(candidate));
  };

  const scanNode = (node: unknown) => {
    if (!isRecord(node)) return;

    push(node.source);
    push(node.provider);
    push(node.tool);

    const sourceArray = node.sources;
    if (Array.isArray(sourceArray)) sourceArray.forEach(push);

    const provenance = node.provenance;
    if (Array.isArray(provenance)) {
      provenance.forEach((entry) => {
        if (!isRecord(entry)) return;
        push(entry.source);
        push(entry.provider);
        push(entry.tool);
      });
    }

    ['blocks', 'children', 'content', 'items'].forEach((key) => {
      const nested = node[key];
      if (Array.isArray(nested)) nested.forEach(scanNode);
    });
  };

  scanNode(payload.screen);
  return Array.from(labels).slice(0, 4);
}

function refreshTrustMeta(payload: A2UICompatiblePayload) {
  const sources = collectSourceLabels(payload);
  if (!sources.length) {
    els.sourceBadges.innerHTML = '<span class="trust-placeholder">Source: generated locally</span>';
  } else {
    els.sourceBadges.innerHTML = sources.map((source) => `<span class="source-badge">${source}</span>`).join('');
  }

  const screen = isRecord(payload.screen) ? payload.screen : {};
  const timestampCandidate =
    (typeof screen.updatedAt === 'string' && screen.updatedAt) ||
    (typeof screen.lastUpdated === 'string' && screen.lastUpdated) ||
    (typeof screen.generatedAt === 'string' && screen.generatedAt) ||
    nowIso();

  els.screenUpdatedAt.textContent = formatLastUpdated(timestampCandidate);
}

function formatClock() {
  const now = new Date();
  els.time.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  els.date.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function setUiState(nextState: string, message?: string) {
  els.app.dataset.state = nextState;
  const isBusy = nextState === 'thinking' || nextState === 'rendering';
  els.renderSurface.setAttribute('aria-busy', isBusy ? 'true' : 'false');

  els.submitBtn.classList.toggle('is-loading', isBusy);
  els.submitBtn.textContent = isBusy ? 'Working…' : 'Create screen';
  els.submitBtn.setAttribute('aria-busy', isBusy ? 'true' : 'false');

  const pillByState: Record<string, string> = {
    idle: 'Ready',
    thinking: 'Working',
    rendering: 'Working',
    ready: 'Ready',
    error: 'Needs attention'
  };

  const titleByState: Record<string, string> = {
    idle: 'Screen status',
    thinking: 'Working',
    rendering: 'Working',
    ready: 'Screen is up to date',
    error: 'Could not fully refresh'
  };

  els.statusPill.textContent = pillByState[nextState] || 'Status';
  els.statusTitle.textContent = titleByState[nextState] || 'Screen status';

  if (isBusy) {
    els.statusMessage.textContent = 'Working…';
    els.statusInfo.style.display = 'inline-flex';
    els.statusInfo.setAttribute('title', message || 'Working on your request. Complex screens may take up to about a minute.');
  } else {
    els.statusInfo.style.display = 'none';
    if (message) els.statusMessage.textContent = message;
  }

  if (message) {
    els.app.setAttribute('aria-label', message);
  }
}

function renderLoadingSkeleton(cardCount = 3) {
  els.renderSurface.innerHTML = '';
  for (let index = 0; index < cardCount; index += 1) {
    const article = document.createElement('article');
    article.className = 'scene-card size-medium skeleton-card';
    article.innerHTML = '<div class="skeleton-line"></div><div class="skeleton-line short"></div><div class="skeleton-line"></div>';
    els.renderSurface.appendChild(article);
  }
}

const persistLkg = (payload: A2UICompatiblePayload) => localStorage.setItem(A2UI_STORAGE_KEY, JSON.stringify(payload));

function loadLkg(): A2UICompatiblePayload | null {
  try {
    const raw = localStorage.getItem(A2UI_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as A2UICompatiblePayload) : null;
  } catch {
    return null;
  }
}

function createProfile(name: string, lastPrompt = state.lastPrompt, payload: A2UICompatiblePayload | null = state.lastPayload): ScreenProfile {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `profile-${Date.now()}`,
    name: sanitizeProfileName(name),
    lastPrompt: String(lastPrompt || '').slice(0, MAX_PROMPT_LENGTH),
    lastPayload: payload,
    updatedAt: nowIso(),
    refreshIntervalSec: 60,
    autoRefreshEnabled: false
  };
}

function nextProfileName(base = 'Saved screen'): string {
  const existing = new Set(state.profiles.map((profile) => profile.name.trim().toLowerCase()));
  for (let index = 1; index <= 999; index += 1) {
    const candidate = `${base} ${index}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

function persistProfiles() {
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify({ profiles: state.profiles, activeProfileId: state.activeProfileId }));
}

function sanitizeProfileName(input: unknown): string {
  const name = String(input || '').trim().replace(/\s+/g, ' ').slice(0, 48);
  return name || 'Saved screen';
}

function sanitizeLoadedProfile(candidate: unknown): ScreenProfile | null {
  if (!isRecord(candidate)) return null;
  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `profile-${Date.now()}`);
  const lastPromptRaw = typeof candidate.lastPrompt === 'string' ? candidate.lastPrompt : '';
  const lastPrompt = lastPromptRaw.slice(0, MAX_PROMPT_LENGTH);
  const lastPayload = candidate.lastPayload ?? null;
  return {
    id,
    name: sanitizeProfileName(candidate.name),
    lastPrompt,
    lastPayload: lastPayload && isSafePayload(lastPayload) ? (lastPayload as A2UICompatiblePayload) : null,
    updatedAt: typeof candidate.updatedAt === 'string' && candidate.updatedAt ? candidate.updatedAt : nowIso(),
    refreshIntervalSec: [30, 60, 120, 300].includes(Number(candidate.refreshIntervalSec)) ? Number(candidate.refreshIntervalSec) : 60,
    autoRefreshEnabled: Boolean(candidate.autoRefreshEnabled)
  };
}

function loadProfiles() {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { profiles?: unknown[]; activeProfileId?: string };
    const profiles = Array.isArray(parsed.profiles) ? parsed.profiles.map(sanitizeLoadedProfile).filter(Boolean) as ScreenProfile[] : [];
    if (!profiles.length) return null;
    const activeProfileId = typeof parsed.activeProfileId === 'string' ? parsed.activeProfileId : profiles[0].id;
    return { profiles, activeProfileId };
  } catch {
    return null;
  }
}

function getFriendlyErrorMessage(error: Error): string {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('timed out') || message.includes('abort')) return 'This request took too long, so we showed a local draft instead.';
  if (message.includes('failed to fetch') || message.includes('networkerror')) return 'We could not reach live generation, so we showed a local draft instead.';
  return 'Live generation is unavailable, so we made a local draft to keep you moving.';
}

function getActiveProfile(): ScreenProfile {
  const active = state.profiles.find((profile) => profile.id === state.activeProfileId);
  if (active) return active;
  const fallback = state.profiles[0];
  if (!fallback) {
    const created = createProfile('Main screen');
    state.profiles = [created];
    state.activeProfileId = created.id;
    return created;
  }
  state.activeProfileId = fallback.id;
  return fallback;
}

function updateActiveProfile(updater: (profile: ScreenProfile) => ScreenProfile) {
  state.profiles = state.profiles.map((profile) => {
    if (profile.id !== state.activeProfileId) return profile;
    return updater(profile);
  });
  persistProfiles();
}

function renderProfileTabs() {
  const renderInto = (container: HTMLElement, baseClass: string) => {
    container.innerHTML = '';
    state.profiles.forEach((profile) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = baseClass;
      tab.setAttribute('role', 'tab');
      tab.id = `${baseClass}-${profile.id}`;
      tab.setAttribute('aria-selected', String(profile.id === state.activeProfileId));
      tab.setAttribute('aria-controls', 'sceneCards');
      tab.tabIndex = profile.id === state.activeProfileId ? 0 : -1;
      tab.disabled = state.isSubmitting;
      tab.textContent = profile.name;
      if (profile.id === state.activeProfileId) tab.classList.add('is-active');
      tab.addEventListener('click', () => switchProfile(profile.id));
      container.appendChild(tab);
    });
  };

  renderInto(els.profileTabs, 'profile-tab');
  renderInto(els.profileManagerTabs, 'profile-manager-tab');
}

function focusProfileTab(profileId: string) {
  const target = document.getElementById(`profile-tab-${profileId}`) as HTMLButtonElement | null;
  if (target) target.focus();
}

function handleProfileTabsKeydown(event: KeyboardEvent) {
  const tabs = Array.from(els.profileTabs.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  if (!tabs.length) return;

  const currentIndex = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
  const selectedIndex = currentIndex >= 0 ? currentIndex : 0;

  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    let nextIndex = selectedIndex;
    if (event.key === 'ArrowRight') nextIndex = (selectedIndex + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (selectedIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    const tabId = tabs[nextIndex]?.id?.replace(/^tab-/, '');
    if (tabId) {
      switchProfile(tabId);
      focusProfileTab(tabId);
    }
  }

  if (event.key === 'Delete' && state.profiles.length > 1) {
    event.preventDefault();
    els.deleteProfileBtn.click();
  }
}

function refreshAutoRefreshTimer() {
  if (state.autoRefreshTimer) {
    window.clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
  const profile = getActiveProfile();
  const cadence = profile.refreshIntervalSec || 60;
  els.autoRefreshEnabled.checked = Boolean(profile.autoRefreshEnabled);
  els.autoRefreshInterval.value = String(cadence);
  if (profile.autoRefreshEnabled) {
    state.autoRefreshTimer = window.setInterval(() => {
      if (state.isSubmitting) return;
      submitPrompt(getActiveProfile().lastPrompt || els.promptInput.value, 'auto-refresh');
    }, cadence * 1000);
  }
}

function switchProfile(profileId: string) {
  if (state.isSubmitting) {
    setUiState('thinking', 'Please wait for the current screen to finish updating.');
    return;
  }

  state.activeProfileId = profileId;
  const profile = getActiveProfile();
  state.lastPrompt = profile.lastPrompt || '';
  state.lastPayload = profile.lastPayload || null;
  els.promptInput.value = profile.lastPrompt || '';

  if (profile.lastPayload && isSafePayload(profile.lastPayload)) {
    renderA2ui(profile.lastPayload, 'profile-switch');
    setUiState('ready', `Showing ${profile.name}.`);
  } else {
    renderA2ui(offlineFallbackPayload, 'profile-switch-empty');
    setUiState('idle', `${profile.name} is ready. Add a prompt and create a screen.`);
  }

  renderProfileTabs();
  refreshAutoRefreshTimer();
  persistProfiles();

  if (els.profileManagerDialog.open) {
    els.profileManagerDialog.close();
  }
}

function isSafePayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const serialized = JSON.stringify(payload);
  if (serialized.length > 300_000) return false;
  if (/<script|javascript:|onerror=|onload=/i.test(serialized)) return false;
  return true;
}

function tryParseJson(text: string): unknown | null {
  try { return JSON.parse(text); } catch { return null; }
}

function parseJsonLines(text: string): unknown[] | null {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const objects = lines.map((line) => tryParseJson(line)).filter(Boolean) as unknown[];
  return objects.length ? objects : null;
}

function normalizeA2uiPayload(
  raw: unknown,
  previousState?: A2UIRenderState
): { envelope: A2UICanonicalEnvelope; payload: A2UICompatiblePayload; renderState: A2UIRenderState } {
  if (raw == null) throw new Error('Empty A2UI payload');

  let normalizedRaw: unknown = raw;
  if (typeof normalizedRaw === 'string') {
    const asJson = tryParseJson(normalizedRaw);
    if (asJson) normalizedRaw = asJson;
    else {
      const asJsonl = parseJsonLines(normalizedRaw);
      if (!asJsonl) throw new Error('Unparseable A2UI string payload');
      normalizedRaw = asJsonl;
    }
  }

  // Trust boundary: all network payload variants are coerced into canonical messages first.
  const applied = applyEnvelopeBatch(normalizedRaw, previousState);
  return { envelope: applied.envelope, payload: applied.payload, renderState: applied.state };
}

function withTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then((res) => { clearTimeout(timeout); resolve(res); }).catch((err) => { clearTimeout(timeout); reject(err); });
  });
}

function buildRequestBody(prompt: string) {
  return {
    prompt,
    input: prompt,
    request: prompt,
    schemaVersion: '0.8',
    context: { now: nowIso(), appVersion: APP_VERSION, previousSummary: state.lastPayload?.screen?.title || null }
  };
}

type StreamCallbacks = {
  onStatus: (text: string) => void;
  onPartial?: (payload: unknown) => void;
};

async function requestA2uiStreaming(prompt: string, endpoint: string, callbacks: StreamCallbacks): Promise<unknown> {
  const { onStatus, onPartial } = callbacks;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(buildRequestBody(prompt)),
      signal: controller.signal
    });

    if (!res.ok) throw new Error(`${endpoint} responded ${res.status}`);
    const contentType = res.headers.get('content-type') || '';

    // If server doesn't support SSE, fall back to JSON
    if (!contentType.includes('text/event-stream')) {
      if (contentType.includes('application/json')) return res.json();
      return res.text();
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let result: unknown = null;
    let errorMsg = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data);
            if (eventType === 'status' && parsed.text) {
              onStatus(parsed.text);
            } else if (eventType === 'partial' && onPartial) {
              onPartial(parsed);
            } else if (eventType === 'result') {
              result = parsed;
            } else if (eventType === 'error') {
              errorMsg = parsed.message || 'Generation failed';
            }
          } catch { /* ignore malformed events */ }
          eventType = '';
        } else if (line === '') {
          eventType = '';
        }
      }
    }

    if (errorMsg) throw new Error(errorMsg);
    if (!result) throw new Error('No result received from stream');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function requestA2ui(prompt: string, endpoint: string): Promise<unknown> {
  const res = await withTimeout(REQUEST_TIMEOUT_MS, fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain' },
    body: JSON.stringify(buildRequestBody(prompt))
  }));

  if (!res.ok) throw new Error(`${endpoint} responded ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

async function generateA2ui(prompt: string, callbacks?: StreamCallbacks): Promise<unknown> {
  const failures: string[] = [];
  for (const endpoint of A2UI_ENDPOINT_CANDIDATES) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        if (callbacks) {
          return await requestA2uiStreaming(prompt, endpoint, callbacks);
        }
        return await requestA2ui(prompt, endpoint);
      } catch (err) {
        failures.push(`${endpoint} attempt ${attempt}: ${(err as Error).message}`);
      }
    }
  }
  throw new Error(failures.join(' | '));
}

const asArray = <T>(value: T | T[] | null | undefined): T[] => (Array.isArray(value) ? value : value == null ? [] : [value]);

function getNodeSizeClass(node: unknown): string {
  if (!node || typeof node !== 'object') return 'size-large';
  const candidate = (node as { size?: string }).size;
  if (candidate === 'small') return 'size-small';
  if (candidate === 'medium') return 'size-medium';
  return 'size-large';
}

function syncRenderSurface(nodesToRender: unknown[]) {
  if (!nodesToRender.length) {
    els.renderSurface.innerHTML = '<article class="scene-card size-large empty-card"><h3>No blocks returned</h3><p class="muted">Try a more specific prompt to generate a richer layout.</p></article>';
    return;
  }

  const existing = Array.from(els.renderSurface.children) as HTMLElement[];

  nodesToRender.forEach((node, index) => {
    const html = renderNode(node);
    const current = existing[index];
    const sizeClass = getNodeSizeClass(node);

    if (!current) {
      const article = document.createElement('article');
      article.className = `scene-card ${sizeClass}`;
      if (node && typeof node === 'object' && 'type' in node) {
        article.dataset.blockType = String((node as { type?: unknown }).type || 'unknown');
      }
      article.innerHTML = html;
      article.tabIndex = index === 0 ? 0 : -1;
      els.renderSurface.appendChild(article);
      return;
    }

    current.className = `scene-card ${sizeClass}`;
    if (node && typeof node === 'object' && 'type' in node) {
      current.dataset.blockType = String((node as { type?: unknown }).type || 'unknown');
    } else {
      delete current.dataset.blockType;
    }
    current.tabIndex = index === 0 ? 0 : -1;
    if (current.innerHTML !== html) current.innerHTML = html;
  });

  for (let i = existing.length - 1; i >= nodesToRender.length; i -= 1) {
    existing[i].remove();
  }
}

function renderA2ui(payload: unknown, source: string) {
  const normalized = normalizeA2uiPayload(payload, state.renderState);
  if (!isSafePayload(normalized.payload)) throw new Error('Payload failed safety checks');

  setUiState('rendering', 'Building your screen now…');
  const screen = normalized.payload.screen || {};
  const title = screen.title || screen.name || 'Dynamic Screen';
  const subtitle = screen.subtitle || `Generated from prompt at ${new Date().toLocaleTimeString()}`;

  els.title.textContent = title;
  els.subtitle.textContent = subtitle;

  const blocks = asArray(screen.blocks || screen.children || screen.content || screen.items);
  const nodesToRender = blocks.length ? blocks : [screen];
  syncRenderSurface(nodesToRender);

  state.renderState = normalized.renderState;
  state.lastPayload = normalized.payload;
  persistLkg(normalized.payload);
  refreshTrustMeta(normalized.payload);

  const shouldPersistProfilePayload = source !== 'profile-switch-empty' && source !== 'startup-offline-fallback';
  if (shouldPersistProfilePayload) {
    updateActiveProfile((profile) => ({
      ...profile,
      lastPrompt: state.lastPrompt,
      lastPayload: normalized.payload,
      updatedAt: nowIso()
    }));
    renderProfileTabs();
  }

  setUiState('ready', `Screen ready. Showing ${nodesToRender.length} section${nodesToRender.length === 1 ? '' : 's'}.`);
}

function showRawPayload() {
  if (!state.lastPayload) return;
  els.rawOutput.textContent = JSON.stringify(state.lastPayload, null, 2);
  els.rawDialog.showModal();
}

function setBusyControls(isBusy: boolean) {
  els.submitBtn.disabled = isBusy;
  els.retryBtn.disabled = isBusy;
  els.openProfileManagerBtn.disabled = isBusy;
  els.saveProfileBtn.disabled = isBusy;
  els.renameProfileBtn.disabled = isBusy;
  els.deleteProfileBtn.disabled = isBusy;
  els.refreshProfileBtn.disabled = isBusy;
  els.autoRefreshEnabled.disabled = isBusy;
  els.autoRefreshInterval.disabled = isBusy;
  renderProfileTabs();
}

async function submitPrompt(prompt: string, source = 'prompt') {
  if (state.isSubmitting) return;

  const trimmed = (prompt || '').trim();
  if (!trimmed) {
    setUiState('error', 'Please enter what you want to see first. Example: “Show my top 3 priorities for today.”');
    els.promptInput.focus();
    return;
  }

  const normalizedPrompt = trimmed.slice(0, MAX_PROMPT_LENGTH);
  state.lastPrompt = normalizedPrompt;
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    setUiState('thinking', `Long prompt detected — we used the first ${MAX_PROMPT_LENGTH} characters for reliability.`);
  }

  state.lastError = null;
  state.isSubmitting = true;
  setBusyControls(true);
  setUiState('thinking', 'Got it — turning your request into a screen layout.');

  try {
    renderLoadingSkeleton();
    const payload = await generateA2ui(normalizedPrompt, {
      onStatus: (_statusText) => {
        setUiState('thinking', 'Still working… complex requests can take about a minute.');
      },
      onPartial: (partialPayload) => {
        try {
          renderA2ui(unwrapA2uiPayload(partialPayload), 'partial');
          setUiState('rendering', 'Live updates are in. Finalizing your full screen…');
        } catch { /* ignore partial render failures */ }
      }
    });
    renderA2ui(unwrapA2uiPayload(payload), source);
  } catch (err) {
    state.lastError = err as Error;
    const fallbackMessage = getFriendlyErrorMessage(state.lastError);
    try {
      renderA2ui(heuristicPayloadFromPrompt(normalizedPrompt), 'local-heuristic');
      setUiState('error', fallbackMessage);
      return;
    } catch {
      // continue fallback chain
    }

    const lkg = loadLkg();
    if (lkg && isSafePayload(lkg)) {
      try {
        renderA2ui(lkg, 'last-known-good');
        setUiState('error', 'Couldn’t refresh right now. We restored your last working screen. Choose Try again when ready.');
        return;
      } catch {
        // continue to offline fallback
      }
    }

    try {
      renderA2ui(offlineFallbackPayload, 'offline-fallback');
      setUiState('error', 'We can’t reach live generation, so you’re seeing offline fallback content for now.');
    } catch {
      setUiState('error', 'Something unexpected failed. Please choose Try again in a moment.');
    }
  } finally {
    state.isSubmitting = false;
    setBusyControls(false);
  }
}

function wire() {
  els.profileTabs.addEventListener('keydown', handleProfileTabsKeydown);
  els.profileManagerTabs.addEventListener('keydown', handleProfileTabsKeydown);

  els.openProfileManagerBtn.addEventListener('click', () => {
    if (state.isSubmitting) return;
    els.profileManagerDialog.showModal();
  });

  els.profileManagerCloseBtn.addEventListener('click', () => {
    els.profileManagerDialog.close();
  });

  els.submitBtn.addEventListener('click', () => submitPrompt(els.promptInput.value, 'prompt'));
  els.promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitPrompt(els.promptInput.value, 'prompt');
    }
  });

  els.retryBtn.addEventListener('click', () => submitPrompt(getActiveProfile().lastPrompt || state.lastPrompt, 'retry'));
  els.saveProfileBtn.addEventListener('click', () => {
    const name = nextProfileName();
    const next = createProfile(name, state.lastPrompt, state.lastPayload);
    state.profiles.push(next);
    state.activeProfileId = next.id;
    renderProfileTabs();
    refreshAutoRefreshTimer();
    persistProfiles();
    setUiState('ready', `${name} saved. You can rename it anytime.`);
  });

  els.renameProfileBtn.addEventListener('click', () => {
    const active = getActiveProfile();
    const renamedInput = window.prompt('Rename this tab', active.name);
    if (renamedInput == null) {
      setUiState('ready', 'Rename canceled.');
      return;
    }
    const renamed = sanitizeProfileName(renamedInput);
    updateActiveProfile((profile) => ({ ...profile, name: renamed, updatedAt: nowIso() }));
    renderProfileTabs();
    setUiState('ready', `Tab renamed to “${renamed}”.`);
  });

  els.deleteProfileBtn.addEventListener('click', () => {
    if (state.profiles.length <= 1) {
      setUiState('error', 'You need at least one tab to keep your screen saved.');
      return;
    }
    const active = getActiveProfile();
    const confirmed = window.confirm(`Delete “${active.name}”? This cannot be undone.`);
    if (!confirmed) {
      setUiState('ready', 'Delete canceled.');
      return;
    }
    state.profiles = state.profiles.filter((profile) => profile.id !== active.id);
    state.activeProfileId = state.profiles[0].id;
    renderProfileTabs();
    switchProfile(state.activeProfileId);
    focusProfileTab(state.activeProfileId);
    setUiState('ready', 'Tab deleted.');
  });

  els.refreshProfileBtn.addEventListener('click', () => {
    const active = getActiveProfile();
    submitPrompt(active.lastPrompt || els.promptInput.value, 'profile-refresh');
  });

  els.autoRefreshEnabled.addEventListener('change', () => {
    updateActiveProfile((profile) => ({ ...profile, autoRefreshEnabled: els.autoRefreshEnabled.checked, updatedAt: nowIso() }));
    refreshAutoRefreshTimer();
  });

  els.autoRefreshInterval.addEventListener('change', () => {
    const refreshIntervalSec = Number(els.autoRefreshInterval.value);
    updateActiveProfile((profile) => ({ ...profile, refreshIntervalSec, updatedAt: nowIso() }));
    refreshAutoRefreshTimer();
  });

  els.showRawBtn.addEventListener('click', showRawPayload);
  els.rawCloseBtn.addEventListener('click', () => els.rawDialog.close());
}

function start() {
  formatClock();
  setInterval(formatClock, 1000);

  const savedProfiles = loadProfiles();
  if (savedProfiles?.profiles?.length) {
    state.profiles = savedProfiles.profiles;
    state.activeProfileId = savedProfiles.activeProfileId || savedProfiles.profiles[0].id;
  } else {
    const initial = createProfile('Main screen', state.lastPrompt, null);
    state.profiles = [initial];
    state.activeProfileId = initial.id;
    persistProfiles();
  }

  wire();
  renderProfileTabs();

  const active = getActiveProfile();
  state.lastPrompt = active.lastPrompt;
  state.lastPayload = active.lastPayload;
  els.promptInput.value = active.lastPrompt;

  if (active.lastPayload && isSafePayload(active.lastPayload)) {
    renderA2ui(active.lastPayload, 'startup-profile');
  } else {
    const lkg = loadLkg();
    if (lkg && isSafePayload(lkg)) {
      try {
        renderA2ui(lkg, 'startup-lkg');
      } catch {
        renderA2ui(offlineFallbackPayload, 'startup-offline-fallback');
      }
    } else {
      renderA2ui(offlineFallbackPayload, 'startup-offline-fallback');
    }
  }

  refreshAutoRefreshTimer();
  setUiState('idle', 'Ready when you are — describe what you want and choose Create screen.');
}

start();
