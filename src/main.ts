import './styles.css';
import {
  A2UIBlock,
  A2UICanonicalEnvelope,
  A2UICompatiblePayload,
  canonicalToCompatiblePayload,
  toCanonicalEnvelope
} from '../shared/a2ui';

const APP_VERSION = 'clawscreen-v1';
const A2UI_ENDPOINT_CANDIDATES = ['/a2ui/generate', `${window.location.protocol}//${window.location.hostname}:18841/a2ui/generate`];
const REQUEST_TIMEOUT_MS = 10_000;
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
  stateBadge: document.getElementById('stateBadge') as HTMLElement,
  promptInput: document.getElementById('promptInput') as HTMLInputElement,
  submitBtn: document.getElementById('generateBtn') as HTMLButtonElement,
  retryBtn: document.getElementById('retryBtn') as HTMLButtonElement,
  renderSurface: document.getElementById('sceneCards') as HTMLElement,
  rawDialog: document.getElementById('rawSceneDialog') as HTMLDialogElement,
  rawOutput: document.getElementById('rawSceneOutput') as HTMLElement,
  showRawBtn: document.getElementById('showRawBtn') as HTMLButtonElement,
  rawCloseBtn: document.getElementById('rawCloseBtn') as HTMLButtonElement
};

const state: { lastPrompt: string; lastPayload: A2UICompatiblePayload | null; lastError: Error | null } = {
  lastPrompt: 'Show me everything I need before leaving in 20 minutes.',
  lastPayload: null,
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
  const labels: Record<string, string> = { idle: 'Idle', thinking: 'Thinking…', rendering: 'Rendering…', ready: 'Ready', error: 'Error' };
  els.stateBadge.textContent = labels[nextState] || nextState;
  if (message) els.status.textContent = message;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function normalizeA2uiPayload(raw: unknown): { envelope: A2UICanonicalEnvelope; payload: A2UICompatiblePayload } {
  if (raw == null) throw new Error('Empty A2UI payload');

  let normalizedRaw: unknown = raw;
  if (typeof normalizedRaw === 'string') {
    const asJson = tryParseJson(normalizedRaw);
    if (asJson) normalizedRaw = asJson;
    else {
      const asJsonl = parseJsonLines(normalizedRaw);
      if (!asJsonl) throw new Error('Unparseable A2UI string payload');
      normalizedRaw = { version: '0.8', screen: { title: 'A2UI Stream', blocks: asJsonl as A2UIBlock[] } };
    }
  } else if (Array.isArray(normalizedRaw)) {
    normalizedRaw = { version: '0.8', screen: { title: 'A2UI Output', blocks: normalizedRaw as A2UIBlock[] } };
  }

  // Trust boundary: all network payload variants are coerced into canonical messages first.
  const envelope = toCanonicalEnvelope(normalizedRaw);
  const payload = canonicalToCompatiblePayload(envelope);
  return { envelope, payload };
}

function withTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then((res) => { clearTimeout(timeout); resolve(res); }).catch((err) => { clearTimeout(timeout); reject(err); });
  });
}

async function requestA2ui(prompt: string, endpoint: string): Promise<unknown> {
  const requestBody = {
    prompt,
    input: prompt,
    request: prompt,
    schemaVersion: '0.8',
    context: { now: nowIso(), appVersion: APP_VERSION, previousSummary: state.lastPayload?.screen?.title || null }
  };

  const res = await withTimeout(REQUEST_TIMEOUT_MS, fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain' },
    body: JSON.stringify(requestBody)
  }));

  if (!res.ok) throw new Error(`${endpoint} responded ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

async function generateA2ui(prompt: string): Promise<unknown> {
  const failures: string[] = [];
  for (const endpoint of A2UI_ENDPOINT_CANDIDATES) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        return await requestA2ui(prompt, endpoint);
      } catch (err) {
        failures.push(`${endpoint} attempt ${attempt}: ${(err as Error).message}`);
      }
    }
  }
  throw new Error(failures.join(' | '));
}

const asArray = <T>(value: T | T[] | null | undefined): T[] => (Array.isArray(value) ? value : value == null ? [] : [value]);

function renderPrimitive(value: unknown): string {
  if (value == null) return '<span class="muted">—</span>';
  if (['string', 'number', 'boolean'].includes(typeof value)) return escapeHtml(value);
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function renderKeyValueTable(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj || {});
  if (!entries.length) return '';
  return `<dl class="kv-table">${entries.map(([key, val]) => `<dt>${escapeHtml(key)}</dt><dd>${renderPrimitive(val)}</dd>`).join('')}</dl>`;
}

function normalizeChildren(node: A2UIBlock): unknown[] {
  return asArray(node?.children || node?.blocks || node?.items || node?.content || node?.body) as unknown[];
}

function renderNode(node: unknown): string {
  if (node == null) return '';
  if (['string', 'number', 'boolean'].includes(typeof node)) return `<p>${escapeHtml(node)}</p>`;

  const n = node as A2UIBlock;
  const type = String(n.type || n.kind || n.component || 'unknown').toLowerCase();
  if (type === 'text' || type === 'markdown') return `<p>${escapeHtml(n.text || n.value || n.content || '')}</p>`;
  if (type === 'list') {
    const items = asArray(n.items || n.values || n.children);
    return `<section class="generic-block"><h3>${escapeHtml(n.title || 'List')}</h3><ul>${items.map((item) => `<li>${renderPrimitive(item)}</li>`).join('')}</ul></section>`;
  }
  if (type === 'metric' || type === 'stat') {
    return `<section class="generic-block metric"><h3>${escapeHtml(n.label || n.title || 'Metric')}</h3><p class="metric-value">${renderPrimitive(n.value ?? n.metric ?? n.number)}</p>${n.delta ? `<p class="muted">${escapeHtml(n.delta)}</p>` : ''}</section>`;
  }
  if (type === 'divider') return '<hr class="divider" />';

  const title = n.title || n.label || null;
  const children = normalizeChildren(n);
  const reserved = new Set(['type', 'kind', 'component', 'title', 'label', 'children', 'blocks', 'items', 'content', 'body']);
  const details = Object.fromEntries(Object.entries(n).filter(([k]) => !reserved.has(k)));
  const childHtml = children.map((child) => `<div class="node-child">${renderNode(child)}</div>`).join('');
  const detailsHtml = Object.keys(details).length ? renderKeyValueTable(details) : '';

  return `<section class="generic-block type-${escapeHtml(type)}">${title ? `<h3>${escapeHtml(title)}</h3>` : ''}${childHtml}${detailsHtml}</section>`;
}

function renderA2ui(payload: unknown, source: string) {
  const normalized = normalizeA2uiPayload(payload);
  if (!isSafePayload(normalized.payload)) throw new Error('Payload failed safety checks');

  setUiState('rendering', 'Rendering A2UI…');
  const screen = normalized.payload.screen || {};
  const title = screen.title || screen.name || 'Dynamic Screen';
  const subtitle = screen.subtitle || `Generated from prompt at ${new Date().toLocaleTimeString()}`;

  els.title.textContent = title;
  els.subtitle.textContent = subtitle;
  els.renderSurface.innerHTML = '';

  const blocks = asArray(screen.blocks || screen.children || screen.content || screen.items);
  const nodesToRender = blocks.length ? blocks : [screen];

  nodesToRender.forEach((node) => {
    const article = document.createElement('article');
    article.className = 'scene-card size-large';
    article.innerHTML = renderNode(node);
    els.renderSurface.appendChild(article);
  });

  // Compatibility adapter output remains the rendering contract in phase 1.
  state.lastPayload = normalized.payload;
  persistLkg(normalized.payload);
  setUiState('ready', `Rendered ${nodesToRender.length} block(s) from ${source} (${APP_VERSION})`);
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
  setUiState('thinking', 'Thinking… generating A2UI payload');

  try {
    const payload = await generateA2ui(trimmed);
    renderA2ui(payload, source);
  } catch (err) {
    state.lastError = err as Error;
    try {
      renderA2ui(heuristicPayloadFromPrompt(trimmed), 'local-heuristic');
      setUiState('ready', `Gateway generation unavailable; rendered dynamic local interpretation. (${(err as Error).message})`);
      return;
    } catch {
      // continue fallback chain
    }

    const lkg = loadLkg();
    if (lkg && isSafePayload(lkg)) {
      try {
        renderA2ui(lkg, 'last-known-good');
        setUiState('error', `Generation failed, showing last known good. Retry available. (${(err as Error).message})`);
        return;
      } catch {
        // continue to offline fallback
      }
    }

    try {
      renderA2ui(offlineFallbackPayload, 'offline-fallback');
      setUiState('error', `Generation failed, using offline fallback. Retry available. (${(err as Error).message})`);
    } catch {
      setUiState('error', `Generation failed and fallback render failed. (${(err as Error).message})`);
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

  setUiState('idle', 'Ready. Enter a prompt and press Generate.');
}

start();
