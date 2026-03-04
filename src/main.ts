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

const APP_VERSION = 'clawscreen-v1';
const A2UI_ENDPOINT_CANDIDATES = ['/a2ui/generate', `${window.location.protocol}//${window.location.hostname}:18841/a2ui/generate`];
const REQUEST_TIMEOUT_MS = 130_000;
const MAX_RETRIES = 2;
const A2UI_STORAGE_KEY = 'clawscreen.lastKnownGoodA2UI.v1';

type Primitive = string | number | boolean | null | undefined;
type Json = Primitive | Json[] | { [key: string]: Json };

const els = {
  app: document.getElementById('app') as HTMLElement,
  time: document.getElementById('timeDisplay') as HTMLElement,
  date: document.getElementById('dateDisplay') as HTMLElement,
  title: document.getElementById('sceneTitle') as HTMLElement,
  subtitle: document.getElementById('sceneSubtitle') as HTMLElement,
  status: document.getElementById('statusBar') as HTMLElement,
  promptInput: document.getElementById('promptInput') as HTMLInputElement,
  submitBtn: document.getElementById('generateBtn') as HTMLButtonElement,
  retryBtn: document.getElementById('retryBtn') as HTMLButtonElement,
  renderSurface: document.getElementById('sceneCards') as HTMLElement,
  rawDialog: document.getElementById('rawSceneDialog') as HTMLDialogElement,
  rawOutput: document.getElementById('rawSceneOutput') as HTMLElement,
  showRawBtn: document.getElementById('showRawBtn') as HTMLButtonElement,
  rawCloseBtn: document.getElementById('rawCloseBtn') as HTMLButtonElement
};

const state: {
  lastPrompt: string;
  lastPayload: A2UICompatiblePayload | null;
  renderState: A2UIRenderState;
  lastError: Error | null;
} = {
  lastPrompt: 'Show me everything I need before leaving in 20 minutes.',
  lastPayload: null,
  renderState: createInitialRenderState('0.8'),
  lastError: null
};

const offlineFallbackPayload: A2UICompatiblePayload = {
  version: '0.8',
  screen: {
    title: 'Offline Dev Fallback',
    subtitle: 'Gateway unavailable — local payload rendered',
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
      blocks
    }
  };
}

const nowIso = () => new Date().toISOString();

function formatClock() {
  const now = new Date();
  els.time.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  els.date.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function setUiState(nextState: string, message?: string) {
  els.app.dataset.state = nextState;
  els.renderSurface.setAttribute('aria-busy', nextState === 'thinking' || nextState === 'rendering' ? 'true' : 'false');
  if (message) els.status.textContent = message;
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

  setUiState('rendering', 'Building your screen…');
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
  setUiState('ready', `Screen ready. Showing ${nodesToRender.length} section${nodesToRender.length === 1 ? '' : 's'}.`);
}

function showRawPayload() {
  if (!state.lastPayload) return;
  els.rawOutput.textContent = JSON.stringify(state.lastPayload, null, 2);
  els.rawDialog.showModal();
}

async function submitPrompt(prompt: string, source = 'prompt') {
  const trimmed = (prompt || '').trim();
  if (!trimmed) return;

  state.lastPrompt = trimmed;
  state.lastError = null;
  setUiState('thinking', 'Thinking through your request…');

  try {
    renderLoadingSkeleton();
    const payload = await generateA2ui(trimmed, {
      onStatus: (_statusText) => {
        setUiState('thinking', 'Still working on your screen…');
      },
      onPartial: (partialPayload) => {
        try {
          renderA2ui(partialPayload, 'partial');
          setUiState('thinking', 'Updating your screen…');
        } catch { /* ignore partial render failures */ }
      }
    });
    renderA2ui(payload, source);
  } catch (err) {
    state.lastError = err as Error;
    try {
      renderA2ui(heuristicPayloadFromPrompt(trimmed), 'local-heuristic');
      setUiState('ready', 'Live generation is temporarily unavailable, so we built a local version for now.');
      return;
    } catch {
      // continue fallback chain
    }

    const lkg = loadLkg();
    if (lkg && isSafePayload(lkg)) {
      try {
        renderA2ui(lkg, 'last-known-good');
        setUiState('error', 'We hit a snag, so we loaded your last good screen. You can retry anytime.');
        return;
      } catch {
        // continue to offline fallback
      }
    }

    try {
      renderA2ui(offlineFallbackPayload, 'offline-fallback');
      setUiState('error', 'We could not generate live content, so we switched to offline fallback. Please try again.');
    } catch {
      setUiState('error', 'Something went wrong and we could not recover automatically. Please retry.');
    }
  }
}

function wire() {
  els.submitBtn.addEventListener('click', () => submitPrompt(els.promptInput.value, 'prompt'));
  els.promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitPrompt(els.promptInput.value, 'prompt');
    }
  });

  els.retryBtn.addEventListener('click', () => submitPrompt(state.lastPrompt, 'retry'));
  els.showRawBtn.addEventListener('click', showRawPayload);
  els.rawCloseBtn.addEventListener('click', () => els.rawDialog.close());
}

function start() {
  formatClock();
  setInterval(formatClock, 1000);

  wire();
  els.promptInput.value = state.lastPrompt;

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

  setUiState('idle', 'Ready when you are — type what you want to see and press Generate.');
}

start();
