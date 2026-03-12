import './styles.css';
import {
  A2UIBlock,
  A2UICanonicalEnvelope,
  A2UICompatiblePayload,
  A2UIRenderState,
  JsonValue,
  createInitialRenderState
} from '../shared/a2ui';
import type { CanonicalRunEvent } from '../shared/canonicalRunEvent';
import { replayRunEvents } from '../shared/runReplay';
import { renderNode } from './render/registry';
import { applyEnvelopeBatch } from './protocol/applyMessages';
import { unwrapA2uiPayload } from './protocol/unwrapPayload';
import { composeHudPayload } from './protocol/hudComposer';

const APP_VERSION = 'clawscreen-v1';
const A2UI_ENDPOINT_CANDIDATES = ['/a2ui/generate', `${window.location.protocol}//${window.location.hostname}:18841/a2ui/generate`];
const A2UI_ACTION_ENDPOINT_CANDIDATES = ['/a2ui/action', `${window.location.protocol}//${window.location.hostname}:18841/a2ui/action`];
const HEALTH_ENDPOINT_CANDIDATES = ['/healthz', `${window.location.protocol}//${window.location.hostname}:18841/healthz`];
const REQUEST_TIMEOUT_MS = 130_000;
const MAX_RETRIES = 2;
const MAX_PROMPT_LENGTH = 1200;
const A2UI_STORAGE_KEY = 'clawscreen.lastKnownGoodA2UI.v1';
const PROFILES_STORAGE_KEY = 'clawscreen.screenProfiles.v1';
const UI_MODE_STORAGE_KEY = 'clawscreen.uiMode.v1';
const KIOSK_UNLOCK_HOLD_MS = 1200;
const KIOSK_IDLE_RETURN_MS = 45000;
const HEALTH_POLL_INTERVAL_MS = 30000;
const FRESH_DATA_MS = 5 * 60 * 1000;
const STALE_DATA_MS = 15 * 60 * 1000;

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

type RunSummary = {
  runId: string;
  latestEventId: string;
  latestKind: string;
  latestStatus?: string;
  trust: 'trusted' | 'untrusted';
  sourceLabel: string;
  eventCount: number;
  startedAt: string;
  updatedAt: string;
  capabilities?: {
    components: string[];
    modalities: string[];
    interrupts: boolean;
    screenshot: boolean;
    payloadLimitKb?: number;
    messageTypes?: string[];
  };
};

type RunTimelineSnapshot = {
  runId: string;
  events: CanonicalRunEvent[];
  summary: RunSummary | null;
};

type UiMode = 'kiosk' | 'admin';

type PendingApproval = {
  button: HTMLButtonElement;
  actionPayload: Record<string, unknown>;
  eventType: string;
  eventTarget?: string;
  previousLabel: string;
  riskLabel: string;
  riskReason: string;
  conflictNote?: string;
};

type ActionAssistContext = {
  taskId?: string;
  status?: string;
  label?: string;
  target?: string;
  timestamp?: string;
  interruptId?: string;
  resumeToken?: string;
  provenance?: {
    origin?: string;
    tool?: string;
    confidence?: number;
    timestamp?: string;
  };
};

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
  profileSelect: document.getElementById('profileSelect') as HTMLSelectElement,
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
  timelineDialog: document.getElementById('timelineDialog') as HTMLDialogElement,
  timelineSummary: document.getElementById('timelineSummary') as HTMLElement,
  timelineReplay: document.getElementById('timelineReplay') as HTMLElement,
  timelineEvents: document.getElementById('timelineEvents') as HTMLElement,
  showTimelineBtn: document.getElementById('showTimelineBtn') as HTMLButtonElement,
  timelineCloseBtn: document.getElementById('timelineCloseBtn') as HTMLButtonElement,
  rawDialog: document.getElementById('rawSceneDialog') as HTMLDialogElement,
  rawOutput: document.getElementById('rawSceneOutput') as HTMLElement,
  showRawBtn: document.getElementById('showRawBtn') as HTMLButtonElement,
  rawCloseBtn: document.getElementById('rawCloseBtn') as HTMLButtonElement,
  actionApprovalDialog: document.getElementById('actionApprovalDialog') as HTMLDialogElement,
  actionApprovalBody: document.getElementById('actionApprovalBody') as HTMLElement,
  actionApprovalCloseBtn: document.getElementById('actionApprovalCloseBtn') as HTMLButtonElement,
  actionApprovalDeclineBtn: document.getElementById('actionApprovalDeclineBtn') as HTMLButtonElement,
  actionApprovalPauseBtn: document.getElementById('actionApprovalPauseBtn') as HTMLButtonElement,
  actionApprovalConfirmBtn: document.getElementById('actionApprovalConfirmBtn') as HTMLButtonElement,
  statusPill: document.getElementById('statusPill') as HTMLElement,
  statusTitle: document.getElementById('statusTitle') as HTMLElement,
  statusInfo: document.getElementById('statusInfo') as HTMLElement,
  statusMessage: document.getElementById('statusMessage') as HTMLElement,
  sourceBadges: document.getElementById('sourceBadges') as HTMLElement,
  screenUpdatedAt: document.getElementById('screenUpdatedAt') as HTMLElement,
  kioskModeToggleBtn: document.getElementById('kioskModeToggleBtn') as HTMLButtonElement,
  kioskUnlockZone: document.getElementById('kioskUnlockZone') as HTMLElement
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
  isActionSubmitting: boolean;
  runSummary: RunSummary | null;
  runTimeline: RunTimelineSnapshot | null;
  uiMode: UiMode;
  idleViewTimer: number | null;
  backendHealthy: boolean;
  healthPollTimer: number | null;
  pendingApproval: PendingApproval | null;
} = {
  lastPrompt: 'Show me everything I need before leaving in 20 minutes.',
  lastPayload: null,
  renderState: createInitialRenderState('0.8'),
  lastError: null,
  profiles: [],
  activeProfileId: '',
  autoRefreshTimer: null,
  isSubmitting: false,
  isActionSubmitting: false,
  runSummary: null,
  runTimeline: null,
  uiMode: 'kiosk',
  idleViewTimer: null,
  backendHealthy: true,
  healthPollTimer: null,
  pendingApproval: null
};

const offlineFallbackPayload: A2UICompatiblePayload = {
  version: '0.8',
  screen: {
    title: 'Saved View',
    subtitle: 'Live update unavailable — showing saved view',
    updatedAt: new Date().toISOString(),
    source: 'local_fallback',
    blocks: [
      {
        type: 'card',
        title: 'Your screen is ready',
        body: 'This view keeps your screen usable when live updates are temporarily unavailable.'
      },
      {
        type: 'list',
        title: 'Next checks',
        items: [
          'Check your connection and try again',
          'Ask for a new update',
          'Open More options if you want details'
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
    blocks.push({ type: 'metric', title: 'Home snapshot', label: 'Mode', value: 'Personal Assistant' });
    blocks.push({ type: 'list', title: 'Suggested checks', items: ['Connection status', 'Active routines', 'Recent changes'] });
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
      title: 'Live View',
      subtitle: 'Quick local view while live updates reconnect',
      updatedAt: nowIso(),
      source: 'local view',
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

function getTimestampAgeMs(iso: string): number | null {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const age = Date.now() - ts;
  return age >= 0 ? age : 0;
}

function getFreshnessClass(ageMs: number | null): 'fresh' | 'aging' | 'stale' {
  if (ageMs == null) return 'aging';
  if (ageMs >= STALE_DATA_MS) return 'stale';
  if (ageMs >= FRESH_DATA_MS) return 'aging';
  return 'fresh';
}

function formatAge(ageMs: number | null): string {
  if (ageMs == null) return 'unknown age';
  const mins = Math.round(ageMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
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

function extractRunSummary(raw: unknown): RunSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = (raw as { run?: unknown }).run;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const summary = (candidate as { summary?: unknown }).summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  return summary as RunSummary;
}

function extractRunTimeline(raw: unknown): RunTimelineSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = (raw as { run?: unknown }).run;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const run = candidate as { runId?: unknown; summary?: unknown; events?: unknown };
  if (typeof run.runId !== 'string' || !Array.isArray(run.events)) return null;
  return {
    runId: run.runId,
    summary: (run.summary && typeof run.summary === 'object' && !Array.isArray(run.summary)) ? run.summary as RunSummary : null,
    events: run.events as CanonicalRunEvent[]
  };
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
  const badges: string[] = [];

  if (state.runSummary) {
    badges.push(`<span class="source-badge trust-${state.runSummary.trust}">${state.runSummary.trust === 'trusted' ? 'Checked' : 'Please review'}</span>`);
  }

  badges.push(`<span class="source-badge capability-badge backend-${state.backendHealthy ? 'online' : 'offline'}">${state.backendHealthy ? 'Connected' : 'Offline'}</span>`);

  if (!sources.length && !badges.length) {
    els.sourceBadges.innerHTML = '<span class="trust-placeholder">Using saved information</span>';
  } else {
    const sourceBadges = sources.slice(0, 2).map((source) => `<span class="source-badge">${source}</span>`);
    els.sourceBadges.innerHTML = [...badges, ...sourceBadges].join('');
  }

  const screen = isRecord(payload.screen) ? payload.screen : {};
  const timestampCandidate =
    state.runSummary?.updatedAt ||
    (typeof screen.updatedAt === 'string' && screen.updatedAt) ||
    (typeof screen.lastUpdated === 'string' && screen.lastUpdated) ||
    (typeof screen.generatedAt === 'string' && screen.generatedAt) ||
    nowIso();

  const age = getTimestampAgeMs(timestampCandidate);
  const freshness = getFreshnessClass(age);
  els.screenUpdatedAt.dataset.freshness = freshness;
  els.screenUpdatedAt.textContent = `${formatLastUpdated(timestampCandidate)} (${formatAge(age)})`;

  if (freshness === 'stale') {
    badges.push('<span class="source-badge freshness-stale">Needs refresh</span>');
    els.sourceBadges.innerHTML = [...badges, ...sources.map((source) => `<span class="source-badge">${source}</span>`)].join('');
  } else if (freshness === 'aging') {
    badges.push('<span class="source-badge freshness-aging">Slightly out of date</span>');
    els.sourceBadges.innerHTML = [...badges, ...sources.map((source) => `<span class="source-badge">${source}</span>`)].join('');
  }
}

function formatClock() {
  const now = new Date();
  els.time.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  els.date.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function resolveRequestedUiMode(): UiMode {
  const params = new URLSearchParams(window.location.search);
  const modeFromUrl = params.get('mode')?.toLowerCase();
  if (modeFromUrl === 'admin') return 'admin';
  if (modeFromUrl === 'kiosk') return 'kiosk';

  const stored = localStorage.getItem(UI_MODE_STORAGE_KEY);
  return stored === 'admin' ? 'admin' : 'kiosk';
}

function setHudView(view: 'idle' | 'active' | 'alert') {
  els.app.dataset.view = view;
}

function clearIdleViewTimer() {
  if (state.idleViewTimer) {
    window.clearTimeout(state.idleViewTimer);
    state.idleViewTimer = null;
  }
}

function scheduleReturnToIdle() {
  clearIdleViewTimer();
  if (state.uiMode !== 'kiosk') return;
  state.idleViewTimer = window.setTimeout(() => {
    setHudView('idle');
    state.idleViewTimer = null;
  }, KIOSK_IDLE_RETURN_MS);
}

function applyUiMode(mode: UiMode, persist = true) {
  state.uiMode = mode;
  els.app.dataset.mode = mode;
  els.kioskModeToggleBtn.textContent = mode === 'kiosk' ? 'Admin' : 'Kiosk';
  els.kioskModeToggleBtn.setAttribute('aria-label', mode === 'kiosk' ? 'Switch to admin mode' : 'Switch to kiosk mode');

  if (persist) localStorage.setItem(UI_MODE_STORAGE_KEY, mode);

  if (mode === 'kiosk') {
    if (els.profileManagerDialog.open) els.profileManagerDialog.close();
    if (els.rawDialog.open) els.rawDialog.close();
    scheduleReturnToIdle();
  } else {
    clearIdleViewTimer();
    setHudView(els.app.dataset.state === 'error' ? 'alert' : 'active');
  }
}

function setUiState(nextState: string, message?: string) {
  els.app.dataset.state = nextState;
  const isBusy = nextState === 'thinking' || nextState === 'rendering';
  els.renderSurface.setAttribute('aria-busy', isBusy ? 'true' : 'false');

  els.submitBtn.classList.toggle('is-loading', isBusy);
  els.submitBtn.textContent = isBusy ? 'Working…' : 'Update';
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
    els.statusMessage.textContent = message || 'Working…';
    els.statusInfo.style.display = 'inline-flex';
    els.statusInfo.setAttribute('title', message || 'Working on your request. Complex screens may take up to about a minute.');
  } else {
    els.statusInfo.style.display = 'none';
    if (message) els.statusMessage.textContent = message;
  }

  if (message) {
    els.app.setAttribute('aria-label', message);
  }

  if (nextState === 'error') {
    setHudView('alert');
    clearIdleViewTimer();
  } else if (nextState === 'idle') {
    setHudView('idle');
    clearIdleViewTimer();
  } else {
    setHudView('active');
    if (nextState === 'ready') scheduleReturnToIdle();
    else clearIdleViewTimer();
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
  if (message.includes('failed to fetch') || message.includes('networkerror')) return 'We could not reach live updates, so we showed a local draft instead.';
  return 'Live updates are unavailable, so we made a local draft to keep you moving.';
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

function persistCurrentRenderModel() {
  if (!state.lastPayload) return;
  const nextPayload = {
    ...state.lastPayload,
    model: { ...(state.renderState?.model || {}) }
  } as A2UICompatiblePayload;
  state.lastPayload = nextPayload;
  updateActiveProfile((profile) => ({
    ...profile,
    lastPayload: nextPayload,
    updatedAt: nowIso()
  }));
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

  els.profileSelect.innerHTML = '';
  state.profiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = profile.id === state.activeProfileId;
    els.profileSelect.appendChild(option);
  });
  els.profileSelect.disabled = state.isSubmitting;
}

function focusProfileTab(profileId: string) {
  const target = document.getElementById(`profile-tab-${profileId}`) as HTMLButtonElement | null;
  if (target) target.focus();
}

function getProfileIdFromTabId(tabId: string): string {
  return tabId.replace(/^profile-manager-tab-/, '').replace(/^profile-tab-/, '');
}

function handleProfileTabsKeydown(event: KeyboardEvent) {
  const container = event.currentTarget as HTMLElement | null;
  const tabs = Array.from((container || els.profileTabs).querySelectorAll<HTMLButtonElement>('[role="tab"]'));
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
    const tabId = tabs[nextIndex]?.id;
    const profileId = tabId ? getProfileIdFromTabId(tabId) : '';
    if (profileId) {
      switchProfile(profileId);
      focusProfileTab(profileId);
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

function sanitizeActionEventType(value: unknown): string {
  const type = String(value || '').trim().slice(0, 120);
  return type || 'button.click';
}

function sanitizeActionTarget(value: unknown): string | undefined {
  const target = String(value || '').trim().slice(0, 200);
  return target || undefined;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function describeActionRisk(actionPayload: Record<string, unknown>, button: HTMLButtonElement, eventType: string, eventTarget?: string) {
  const joined = [
    eventType,
    eventTarget,
    actionPayload.type,
    actionPayload.kind,
    actionPayload.intent,
    actionPayload.target,
    button.textContent,
    button.getAttribute('aria-label')
  ].map((value) => String(value || '').toLowerCase()).join(' ');

  const destructive = /(delete|remove|destroy|wipe|erase|revoke|disconnect)/.test(joined);
  const auth = /(auth|login|signin|password|passkey|mfa|otp)/.test(joined);
  const purchase = /(purchase|buy|checkout|payment|pay|submit order|book now)/.test(joined);
  const submit = /(submit|send|publish|post|transfer|approve|confirm)/.test(joined);
  const untrusted = state.runSummary?.trust === 'untrusted';

  let riskLabel = '';
  let riskReason = '';

  if (destructive) {
    riskLabel = 'Destructive action';
    riskReason = 'This may remove data or disconnect something important.';
  } else if (purchase) {
    riskLabel = 'Purchase or payment';
    riskReason = 'This may spend money or place an irreversible order.';
  } else if (auth) {
    riskLabel = 'Authentication step';
    riskReason = 'This may expose credentials or hand control into a sensitive session.';
  } else if (submit) {
    riskLabel = 'High-impact submit';
    riskReason = 'This may send, approve, or publish something externally.';
  }

  if (!riskLabel && !untrusted) return null;

  const prompt = state.lastPrompt.trim();
  const actionLabel = button.textContent?.trim() || eventType;
  const conflictNote = untrusted
    ? `The current screen is marked untrusted, so its instruction to “${actionLabel}” should be checked against your original ask${prompt ? `: “${prompt}”` : ''}.`
    : prompt
      ? `Confirm that “${actionLabel}” still matches your original ask: “${prompt}”.`
      : undefined;

  return {
    requiresConfirmation: Boolean(riskLabel || untrusted),
    riskLabel: riskLabel || 'Untrusted instruction',
    riskReason: riskReason || 'This instruction came from an untrusted screen, so it should be reviewed before continuing.',
    conflictNote
  };
}

async function performActionRequest(
  actionButton: HTMLButtonElement,
  previousLabel: string,
  eventType: string,
  actionPayload: Record<string, unknown>,
  eventTarget?: string,
  overrides?: { control?: Record<string, unknown>; resume?: Record<string, unknown>; payload?: Record<string, unknown>; progressMessage?: string }
) {
  const loadingLabel = actionButton.getAttribute('aria-busy') === 'true' ? previousLabel : 'Working…';
  state.isActionSubmitting = true;
  actionButton.disabled = true;
  actionButton.setAttribute('aria-busy', 'true');
  actionButton.textContent = loadingLabel;
  setUiState('thinking', overrides?.progressMessage || 'Running action…');

  const eventId = `evt_ui_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const response = await dispatchA2uiAction({
      version: state.renderState.version || '0.9',
      event: {
        id: eventId,
        type: eventType,
        timestamp: nowIso(),
        ...(eventTarget ? { target: eventTarget } : {}),
        payload: overrides?.payload || actionPayload,
        snapshot: {
          screen: (state.renderState.screen || {}) as unknown,
          model: state.renderState.model as unknown
        },
        provenance: {
          origin: 'user',
          tool: 'clawscreen.ui',
          timestamp: nowIso()
        }
      },
      ...(overrides?.control ? { control: overrides.control } : {}),
      ...(overrides?.resume ? { resume: overrides.resume } : {})
    });

    const responseTimeline = extractRunTimeline(response);
    const responseSummary = responseTimeline?.summary || extractRunSummary(response);
    if (responseTimeline) state.runTimeline = responseTimeline;
    if (responseSummary) state.runSummary = responseSummary;

    const actionArtifact = unwrapA2uiPayload(response);
    const responseTask = response && typeof response === 'object' && !Array.isArray(response) && 'task' in response
      ? (response as { task?: { status?: string; progress_message?: string; input_required?: { reason?: string } } }).task
      : undefined;
    if (response && typeof response === 'object' && !Array.isArray(response) && 'a2ui' in response) {
      renderA2ui(actionArtifact, 'action');
    } else {
      renderA2ui({
        version: state.renderState.version || '0.9',
        screen: {
          title: responseTask?.status === 'paused' ? 'Action paused' : responseTask?.status === 'input_required' ? 'Human review required' : 'Action updated',
          subtitle: responseTask?.progress_message || 'Status changed',
          blocks: [
            {
              type: 'notes',
              title: 'What happened',
              body: responseTask?.input_required?.reason || responseTask?.progress_message || 'The task state changed without a new screen artifact.'
            },
            {
              type: 'card',
              title: 'Next step',
              body: responseTask?.status === 'paused' ? 'Resume when you are ready.' : 'Review the timeline for the full receipt.'
            }
          ]
        }
      }, 'action-status');
    }
  } catch {
    setUiState('error', 'Action could not be completed right now. Please try again.');
  } finally {
    state.isActionSubmitting = false;
    actionButton.disabled = false;
    actionButton.removeAttribute('aria-busy');
    actionButton.textContent = previousLabel;
  }
}

function openApprovalDialog(pending: PendingApproval) {
  state.pendingApproval = pending;
  els.actionApprovalBody.innerHTML = `
    <div class="approval-panel trust-${state.runSummary?.trust || 'trusted'}">
      <p class="approval-pill">${escapeHtml(pending.riskLabel)}</p>
      <h4>${escapeHtml(pending.previousLabel)}</h4>
      <p>${escapeHtml(pending.riskReason)}</p>
      <div class="approval-grid">
        <article>
          <p class="label">You asked</p>
          <p>${escapeHtml(state.lastPrompt || 'No user prompt captured')}</p>
        </article>
        <article>
          <p class="label">The screen is asking to do</p>
          <p>${escapeHtml(pending.previousLabel)}${pending.eventTarget ? ` · ${escapeHtml(pending.eventTarget)}` : ''}</p>
        </article>
      </div>
      ${pending.conflictNote ? `<p class="approval-warning">${escapeHtml(pending.conflictNote)}</p>` : ''}
      <p class="muted">Sensitive actions are logged into the run timeline with your decision.</p>
    </div>
  `;
  els.actionApprovalDialog.showModal();
}

function closeApprovalDialog() {
  state.pendingApproval = null;
  if (els.actionApprovalDialog.open) els.actionApprovalDialog.close();
}

function extractActionAssistContext(snapshot: RunTimelineSnapshot | null, summary: RunSummary | null): ActionAssistContext | null {
  const events = snapshot?.events || [];
  const latestActionEvent = [...events].reverse().find((event) => event.source.channel === 'action');
  if (!latestActionEvent && !summary) return null;

  const latestUiDelta = [...events].reverse().find((event) => event.source.channel === 'action' && event.kind === 'ui_delta');
  const inputRequired = [...events].reverse().find((event) => event.source.channel === 'action' && event.kind === 'input_required');
  const resumed = [...events].reverse().find((event) => event.source.channel === 'action' && event.kind === 'resumed');
  const interrupted = [...events].reverse().find((event) => event.source.channel === 'action' && event.kind === 'interrupted');

  const payload = latestActionEvent?.payload && typeof latestActionEvent.payload === 'object' && !Array.isArray(latestActionEvent.payload)
    ? latestActionEvent.payload as Record<string, unknown>
    : {};

  const resumePayload = resumed?.resume || inputRequired?.inputRequired;
  return {
    taskId: latestUiDelta?.surfaceId || summary?.runId,
    status: summary?.latestStatus || latestActionEvent?.status,
    label: latestActionEvent?.summary || latestActionEvent?.kind,
    target: typeof payload.target === 'string' ? payload.target : latestUiDelta?.surfaceId,
    timestamp: latestActionEvent?.timestamp || summary?.updatedAt,
    interruptId: interrupted?.interrupt?.id || resumed?.resume?.interrupt_id,
    resumeToken: resumed?.resume?.resume_token || inputRequired?.inputRequired?.resume_token,
    provenance: latestActionEvent?.provenance
      ? {
          origin: latestActionEvent.provenance.origin,
          tool: latestActionEvent.provenance.tool,
          confidence: latestActionEvent.provenance.confidence,
          timestamp: latestActionEvent.provenance.timestamp
        }
      : latestActionEvent
        ? {
            origin: latestActionEvent.source.origin,
            tool: latestActionEvent.source.tool,
            timestamp: latestActionEvent.timestamp
          }
        : undefined
  };
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

async function requestA2uiAction(body: Record<string, unknown>, endpoint: string): Promise<unknown> {
  const res = await withTimeout(REQUEST_TIMEOUT_MS, fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain' },
    body: JSON.stringify(body)
  }));

  const contentType = res.headers.get('content-type') || '';
  const parsed = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = typeof parsed === 'object' && parsed && 'error' in parsed
      ? String((parsed as { error?: { message?: string } }).error?.message || `Action failed with ${res.status}`)
      : `Action failed with ${res.status}`;
    throw new Error(message);
  }
  return parsed;
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

async function dispatchA2uiAction(body: Record<string, unknown>): Promise<unknown> {
  const failures: string[] = [];
  for (const endpoint of A2UI_ACTION_ENDPOINT_CANDIDATES) {
    try {
      return await requestA2uiAction(body, endpoint);
    } catch (err) {
      failures.push(`${endpoint}: ${(err as Error).message}`);
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

function getRenderedCards(): HTMLElement[] {
  return Array.from(els.renderSurface.querySelectorAll<HTMLElement>('.scene-card'));
}

function focusCardByIndex(index: number) {
  const cards = getRenderedCards();
  if (!cards.length) return;
  const bounded = Math.max(0, Math.min(index, cards.length - 1));
  cards.forEach((card, cardIndex) => {
    card.tabIndex = cardIndex === bounded ? 0 : -1;
    card.dataset.cardIndex = String(cardIndex);
  });
  cards[bounded].focus();
}

function enableCardKeyboardNavigation() {
  const cards = getRenderedCards();
  cards.forEach((card, index) => {
    card.dataset.cardIndex = String(index);
    card.tabIndex = index === 0 ? 0 : -1;
  });
}

function syncRenderSurface(nodesToRender: unknown[]) {
  if (!nodesToRender.length) {
    els.renderSurface.innerHTML = '<article class="scene-card size-large empty-card" tabindex="0"><h3>No blocks returned</h3><p class="muted">Try a more specific prompt to generate a richer layout.</p></article>';
    enableCardKeyboardNavigation();
    return;
  }

  const existing = Array.from(els.renderSurface.children) as HTMLElement[];

  nodesToRender.forEach((node, index) => {
    const html = renderNode(node, state.renderState.model);
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
      article.dataset.cardIndex = String(index);
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
    current.dataset.cardIndex = String(index);
    if (current.innerHTML !== html) current.innerHTML = html;
  });

  for (let i = existing.length - 1; i >= nodesToRender.length; i -= 1) {
    existing[i].remove();
  }

  enableCardKeyboardNavigation();
}

function renderA2ui(payload: unknown, source: string) {
  if (/local|offline|startup|profile-switch/.test(source) && source !== 'startup-profile' && source !== 'startup-lkg') {
    state.runSummary = null;
    state.runTimeline = null;
  }
  const normalized = normalizeA2uiPayload(payload, state.renderState);
  if (!isSafePayload(normalized.payload)) throw new Error('Payload failed safety checks');

  setUiState('rendering', 'Building your screen now…');
  const composedPayload = composeHudPayload(normalized.payload, {
    prompt: state.lastPrompt,
    trust: state.runSummary?.trust || 'trusted',
    eventCount: state.runSummary?.eventCount,
    actionAssist: extractActionAssistContext(state.runTimeline, state.runSummary)
  });

  const screen = composedPayload.screen || {};
  const title = screen.title || screen.name || 'Dynamic Screen';
  const subtitle = screen.subtitle || `Generated from prompt at ${new Date().toLocaleTimeString()}`;

  els.title.textContent = title;
  els.subtitle.textContent = subtitle;

  const blocks = asArray(screen.blocks || screen.children || screen.content || screen.items);
  const nodesToRender = blocks.length ? blocks : [screen];
  syncRenderSurface(nodesToRender);

  state.renderState = normalized.renderState;
  state.lastPayload = composedPayload;
  persistLkg(composedPayload);
  refreshTrustMeta(normalized.payload);

  const shouldPersistProfilePayload = source !== 'profile-switch-empty' && source !== 'startup-offline-fallback';
  if (shouldPersistProfilePayload) {
    updateActiveProfile((profile) => ({
      ...profile,
      lastPrompt: state.lastPrompt,
      lastPayload: composedPayload,
      updatedAt: nowIso()
    }));
    renderProfileTabs();
  }

  setUiState('ready', `Screen ready. Showing ${nodesToRender.length} section${nodesToRender.length === 1 ? '' : 's'}.`);
}

function formatTimelineTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderRunTimeline(snapshot: RunTimelineSnapshot) {
  const replay = replayRunEvents(snapshot.events);
  const summary = snapshot.summary || replay.summary;
  const title = replay.payload?.screen?.title || state.lastPayload?.screen?.title || 'No visible screen';
  const transcriptPreview = replay.transcript.slice(-2);

  els.timelineSummary.innerHTML = `
    <div class="timeline-summary-grid">
      <article class="timeline-stat-card">
        <p class="label">Run</p>
        <strong>${summary?.runId || snapshot.runId}</strong>
        <p class="muted">${summary?.eventCount || snapshot.events.length} events · ${summary?.sourceLabel || 'Unknown source'}</p>
      </article>
      <article class="timeline-stat-card">
        <p class="label">Status</p>
        <strong>${summary?.latestStatus || replay.latestStatus || 'unknown'}</strong>
        <p class="muted">${summary?.trust === 'untrusted' ? 'Manual review suggested' : 'Trusted path'}</p>
      </article>
      <article class="timeline-stat-card">
        <p class="label">Visible outcome</p>
        <strong>${title}</strong>
        <p class="muted">${replay.interrupts.length} interrupts · ${replay.handoffs.length} handoffs · ${replay.approvals.length} approvals</p>
      </article>
    </div>
  `;

  els.timelineReplay.innerHTML = `
    <article class="timeline-replay-card">
      <div>
        <p class="label">Replay snapshot</p>
        <h4>${title}</h4>
        <p class="muted">${replay.latestNarrative || 'No narrative text was captured for this run.'}</p>
      </div>
      <ul class="timeline-replay-list">
        ${transcriptPreview.length ? transcriptPreview.map((text) => `<li>${text}</li>`).join('') : '<li>No narrative transcript chunks</li>'}
      </ul>
    </article>
  `;

  els.timelineEvents.innerHTML = snapshot.events.map((event) => {
    const provenance = event.provenance
      ? `${event.provenance.origin || 'unknown'} · ${event.provenance.tool || 'unknown tool'}`
      : `${event.source.origin} · ${event.source.tool || event.source.label}`;
    const detail = event.kind === 'text_chunk'
      ? (event.text || event.summary)
      : event.kind === 'ui_delta'
        ? (event.ui?.messages?.find((message) => message.type === 'surfaceUpdate' && 'screen' in message)?.screen?.title || 'UI updated')
        : event.kind === 'input_required'
          ? (event.inputRequired?.reason || event.summary)
          : event.kind === 'interrupted'
            ? (event.interrupt?.reason || event.summary)
            : event.summary;
    return `
      <article class="timeline-event-card trust-${event.trust}">
        <div class="timeline-event-topline">
          <span class="timeline-kind">${event.kind.replace(/_/g, ' ')}</span>
          <span class="timeline-time">${formatTimelineTimestamp(event.timestamp)}</span>
        </div>
        <p class="timeline-event-detail">${detail}</p>
        <div class="timeline-event-meta">
          <span>${event.status || 'n/a'}</span>
          <span>${provenance}</span>
        </div>
      </article>
    `;
  }).join('');
}

async function showRunTimeline() {
  const snapshot = state.runTimeline;
  const runId = snapshot?.runId || state.runSummary?.runId;
  if (!runId) {
    setUiState('error', 'No replayable run is available yet. Update the screen first.');
    return;
  }

  try {
    const response = await withTimeout(10000, fetch(`/a2ui/runs/${encodeURIComponent(runId)}`, { headers: { Accept: 'application/json' } }));
    if (!response.ok) throw new Error(`Run timeline responded ${response.status}`);
    const payload = await response.json();
    const refreshed = extractRunTimeline(payload) || snapshot;
    if (!refreshed) throw new Error('Timeline payload missing run events');
    state.runTimeline = refreshed;
    if (refreshed.summary) state.runSummary = refreshed.summary;
    renderRunTimeline(refreshed);
    els.timelineDialog.showModal();
  } catch (error) {
    setUiState('error', 'Run timeline is unavailable right now. Try again after the next refresh.');
  }
}

function showRawPayload() {
  if (!state.lastPayload) return;
  els.rawOutput.textContent = JSON.stringify(state.lastPayload, null, 2);
  els.rawDialog.showModal();
}

async function checkBackendHealth() {
  const failures: string[] = [];
  let healthy = false;

  for (const endpoint of HEALTH_ENDPOINT_CANDIDATES) {
    try {
      const res = await withTimeout(5000, fetch(endpoint, { headers: { Accept: 'application/json' } }));
      if (res.ok) {
        healthy = true;
        break;
      }
      failures.push(`${endpoint} -> ${res.status}`);
    } catch (err) {
      failures.push(`${endpoint} -> ${(err as Error).message}`);
    }
  }

  const previous = state.backendHealthy;
  state.backendHealthy = healthy;

  if (previous !== healthy) {
    if (!healthy && !state.isSubmitting) {
      setUiState('error', 'Connection lost. Showing your most recent saved view.');
    } else if (healthy && !state.isSubmitting && els.app.dataset.state === 'error') {
      setUiState('ready', 'Connection restored. Live updates are available.');
    }
  }

  if (!healthy && failures.length) {
    els.statusInfo.style.display = 'inline-flex';
    els.statusInfo.setAttribute('title', failures.slice(0, 2).join(' | '));
  }

  if (state.lastPayload) refreshTrustMeta(state.lastPayload);
}

function startHealthPolling() {
  if (state.healthPollTimer) {
    window.clearInterval(state.healthPollTimer);
    state.healthPollTimer = null;
  }

  checkBackendHealth().catch(() => { /* ignore startup probe errors */ });
  state.healthPollTimer = window.setInterval(() => {
    checkBackendHealth().catch(() => { /* ignore poll errors */ });
  }, HEALTH_POLL_INTERVAL_MS);
}

function setBusyControls(isBusy: boolean) {
  els.submitBtn.disabled = isBusy;
  els.retryBtn.disabled = isBusy;
  els.openProfileManagerBtn.disabled = isBusy;
  els.showTimelineBtn.disabled = isBusy;
  els.profileSelect.disabled = isBusy;
  els.saveProfileBtn.disabled = isBusy;
  els.renameProfileBtn.disabled = isBusy;
  els.deleteProfileBtn.disabled = isBusy;
  els.refreshProfileBtn.disabled = isBusy;
  els.autoRefreshEnabled.disabled = isBusy;
  els.autoRefreshInterval.disabled = isBusy;
  renderProfileTabs();
}

function rerenderFromCurrentState(source = 'local-binding') {
  if (!state.lastPayload || !isSafePayload(state.lastPayload)) return;
  renderA2ui(state.lastPayload, source);
}

async function submitPrompt(prompt: string, source = 'prompt') {
  if (state.isSubmitting) return;

  const trimmed = (prompt || '').trim();
  if (!trimmed) {
    setUiState('error', 'Tell me what you want to see first. Example: “What are my top 3 priorities today?”');
    els.promptInput.focus();
    return;
  }

  const normalizedPrompt = trimmed.slice(0, MAX_PROMPT_LENGTH);
  state.lastPrompt = normalizedPrompt;
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    setUiState('thinking', `Your request was very long, so we shortened it a bit before updating the screen.`);
  }

  state.lastError = null;
  state.isSubmitting = true;
  setBusyControls(true);
  setUiState('thinking', 'Got it — building your screen now.');

  try {
    renderLoadingSkeleton();
    const payload = await generateA2ui(normalizedPrompt, {
      onStatus: (statusText) => {
        const cleanStatus = String(statusText || '').trim();
        if (cleanStatus) {
          setUiState('thinking', `Update: ${cleanStatus}`);
          return;
        }
        setUiState('thinking', 'Still working… complex requests can take about a minute.');
      },
      onPartial: (partialPayload) => {
        try {
          state.runTimeline = extractRunTimeline(partialPayload);
          state.runSummary = state.runTimeline?.summary || extractRunSummary(partialPayload);
          renderA2ui(unwrapA2uiPayload(partialPayload), 'partial');
          setUiState('rendering', 'Got an early update. Finishing your full screen…');
        } catch { /* ignore partial render failures */ }
      }
    });
    state.runTimeline = extractRunTimeline(payload);
    state.runSummary = state.runTimeline?.summary || extractRunSummary(payload);
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
        setUiState('error', 'Couldn’t refresh right now. Restored your last working view.');
        return;
      } catch {
        // continue to offline fallback
      }
    }

    try {
      renderA2ui(offlineFallbackPayload, 'offline-fallback');
      setUiState('error', 'Live updates are unavailable right now. Showing your saved view.');
    } catch {
      setUiState('error', 'Something unexpected failed. Please choose Try again in a moment.');
    }
  } finally {
    state.isSubmitting = false;
    setBusyControls(false);
  }
}

function wire() {
  let unlockHoldTimer: number | null = null;

  const clearUnlockTimer = () => {
    if (unlockHoldTimer) {
      window.clearTimeout(unlockHoldTimer);
      unlockHoldTimer = null;
    }
  };

  els.kioskModeToggleBtn.addEventListener('click', () => {
    applyUiMode(state.uiMode === 'kiosk' ? 'admin' : 'kiosk');
    setUiState('ready', state.uiMode === 'kiosk' ? 'Kiosk mode enabled.' : 'Admin controls unlocked.');
  });

  els.kioskUnlockZone.addEventListener('pointerdown', () => {
    if (state.uiMode !== 'kiosk') return;
    clearUnlockTimer();
    unlockHoldTimer = window.setTimeout(() => {
      applyUiMode('admin');
      setUiState('ready', 'Admin controls unlocked. Use the Kiosk button to lock again.');
      unlockHoldTimer = null;
    }, KIOSK_UNLOCK_HOLD_MS);
  });

  ['pointerup', 'pointerleave', 'pointercancel'].forEach((eventName) => {
    els.kioskUnlockZone.addEventListener(eventName, clearUnlockTimer);
  });

  els.profileTabs.addEventListener('keydown', handleProfileTabsKeydown);
  els.profileManagerTabs.addEventListener('keydown', handleProfileTabsKeydown);

  const updateBoundValue = (binding: string, value: unknown) => {
    if (!binding) return;
    state.renderState.model = {
      ...state.renderState.model,
      [binding]: value as JsonValue
    } as Record<string, JsonValue>;
    persistCurrentRenderModel();
  };

  els.renderSurface.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
    if (!target) return;
    const binding = target.dataset.bind;
    if (!binding) return;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      updateBoundValue(binding, target.checked);
      return;
    }
    updateBoundValue(binding, target.value);
  });

  els.renderSurface.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const choice = target.closest('.choice-item') as HTMLButtonElement | null;
    if (choice) {
      const binding = choice.dataset.bind || '';
      const value = choice.dataset.choiceValue || '';
      const multi = choice.dataset.multi === 'true';
      const current = state.renderState.model[binding];
      if (multi) {
        const list = Array.isArray(current) ? [...current] : [];
        const index = list.findIndex((item) => String(item).toLowerCase() === value.toLowerCase());
        if (index >= 0) list.splice(index, 1); else list.push(value);
        updateBoundValue(binding, list);
      } else {
        updateBoundValue(binding, value);
      }
      rerenderFromCurrentState('local-binding');
      return;
    }

    const actionButton = target.closest('.ui-button[data-a2ui-action]') as HTMLButtonElement | null;
    if (actionButton && !actionButton.disabled && !state.isActionSubmitting) {
      let actionPayload: Record<string, unknown> = {};
      try {
        actionPayload = actionButton.dataset.a2uiAction ? JSON.parse(actionButton.dataset.a2uiAction) as Record<string, unknown> : {};
      } catch {
        setUiState('error', 'This action could not be run safely.');
        return;
      }

      const previousLabel = actionButton.textContent || 'Run';
      const eventType = sanitizeActionEventType(actionButton.dataset.actionType || actionPayload.type || actionPayload.kind);
      const eventTarget = sanitizeActionTarget(actionButton.dataset.actionTarget || actionPayload.target);
      const controlOverride = isRecord(actionPayload.control) ? actionPayload.control : undefined;
      const resumeOverride = isRecord(actionPayload.resume) ? actionPayload.resume : undefined;
      const payloadWithoutOverrides = { ...actionPayload };
      delete payloadWithoutOverrides.control;
      delete payloadWithoutOverrides.resume;
      const risk = controlOverride ? null : describeActionRisk(actionPayload, actionButton, eventType, eventTarget);

      if (risk?.requiresConfirmation) {
        openApprovalDialog({
          button: actionButton,
          actionPayload,
          eventType,
          eventTarget,
          previousLabel,
          riskLabel: risk.riskLabel,
          riskReason: risk.riskReason,
          conflictNote: risk.conflictNote
        });
        return;
      }

      await performActionRequest(actionButton, previousLabel, eventType, payloadWithoutOverrides, eventTarget, {
        ...(controlOverride ? { control: controlOverride } : {}),
        ...(resumeOverride ? { resume: resumeOverride } : {})
      });
    }
  });

  els.renderSurface.addEventListener('click', (event) => {
    const card = (event.target as HTMLElement | null)?.closest('.scene-card') as HTMLElement | null;
    if (!card) return;
    const index = Number(card.dataset.cardIndex);
    if (!Number.isFinite(index)) return;
    focusCardByIndex(index);
  });

  els.renderSurface.addEventListener('keydown', (event) => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !active.classList.contains('scene-card')) return;
    const index = Number(active.dataset.cardIndex);
    if (!Number.isFinite(index)) return;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusCardByIndex(index + 1);
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusCardByIndex(index - 1);
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusCardByIndex(0);
    }

    if (event.key === 'End') {
      event.preventDefault();
      const cards = getRenderedCards();
      focusCardByIndex(cards.length - 1);
    }
  });

  els.openProfileManagerBtn.addEventListener('click', () => {
    if (state.isSubmitting) return;
    els.profileManagerDialog.showModal();
  });

  els.profileSelect.addEventListener('change', () => {
    const nextId = els.profileSelect.value;
    if (nextId) switchProfile(nextId);
  });

  els.profileManagerCloseBtn.addEventListener('click', () => {
    els.profileManagerDialog.close();
  });

  els.showTimelineBtn.addEventListener('click', () => {
    showRunTimeline().catch(() => {
      setUiState('error', 'Run timeline is unavailable right now.');
    });
  });
  els.timelineCloseBtn.addEventListener('click', () => els.timelineDialog.close());
  els.actionApprovalCloseBtn.addEventListener('click', closeApprovalDialog);
  els.actionApprovalDeclineBtn.addEventListener('click', async () => {
    const pending = state.pendingApproval;
    closeApprovalDialog();
    if (!pending) return;
    await performActionRequest(
      pending.button,
      pending.previousLabel,
      pending.eventType,
      {
        ...pending.actionPayload,
        safety: {
          confirmation: { decision: 'declined', reason: 'user_cancelled_before_submit' },
          conflictNote: pending.conflictNote || pending.riskReason
        }
      },
      pending.eventTarget,
      {
        control: { signal: 'takeover', takeover_reason: 'user_declined_high_impact_action' },
        progressMessage: 'Action canceled. Waiting for human decision.'
      }
    );
  });
  els.actionApprovalPauseBtn.addEventListener('click', async () => {
    const pending = state.pendingApproval;
    closeApprovalDialog();
    if (!pending) return;
    await performActionRequest(
      pending.button,
      pending.previousLabel,
      pending.eventType,
      {
        ...pending.actionPayload,
        safety: {
          confirmation: { decision: 'paused', reason: 'user_requested_pause_for_review' },
          conflictNote: pending.conflictNote || pending.riskReason
        }
      },
      pending.eventTarget,
      {
        control: { signal: 'pause' },
        progressMessage: 'Action paused for review.'
      }
    );
  });
  els.actionApprovalConfirmBtn.addEventListener('click', async () => {
    const pending = state.pendingApproval;
    closeApprovalDialog();
    if (!pending) return;
    await performActionRequest(
      pending.button,
      pending.previousLabel,
      pending.eventType,
      {
        ...pending.actionPayload,
        safety: {
          confirmation: { decision: 'approved', reason: 'user_confirmed_after_review' },
          conflictNote: pending.conflictNote || pending.riskReason,
          userIntent: state.lastPrompt || ''
        }
      },
      pending.eventTarget,
      {
        progressMessage: 'Confirmed. Running high-impact action…'
      }
    );
  });

  els.submitBtn.addEventListener('click', () => submitPrompt(els.promptInput.value, 'prompt'));
  els.promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitPrompt(els.promptInput.value, 'prompt');
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      submitPrompt(els.promptInput.value, 'shortcut');
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      applyUiMode(state.uiMode === 'kiosk' ? 'admin' : 'kiosk');
      setUiState('ready', state.uiMode === 'kiosk' ? 'Kiosk mode enabled.' : 'Admin controls unlocked.');
      return;
    }

    if (state.uiMode === 'admin' && event.key === '/' && document.activeElement !== els.promptInput) {
      const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
      if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        event.preventDefault();
        els.promptInput.focus();
      }
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
    const renamedInput = window.prompt('Rename this screen', active.name);
    if (renamedInput == null) {
      setUiState('ready', 'Rename canceled.');
      return;
    }
    const renamed = sanitizeProfileName(renamedInput);
    updateActiveProfile((profile) => ({ ...profile, name: renamed, updatedAt: nowIso() }));
    renderProfileTabs();
    setUiState('ready', `Screen renamed to “${renamed}”.`);
  });

  els.deleteProfileBtn.addEventListener('click', () => {
    if (state.profiles.length <= 1) {
      setUiState('error', 'You need at least one saved screen.');
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

  state.uiMode = resolveRequestedUiMode();
  applyUiMode(state.uiMode, false);

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
  startHealthPolling();
  setUiState('idle', state.uiMode === 'kiosk'
    ? 'Display mode is on. Press and hold the clock to open controls.'
    : 'Ready when you are — ask a question and tap Update.');
}

start();
