const APP_VERSION = 'a2ui-prompt-to-screen-v1';
const A2UI_ENDPOINT_CANDIDATES = [
  '/a2ui/generate',
  `${window.location.protocol}//${window.location.hostname}:18841/a2ui/generate`,
  '/__openclaw__/gateway/a2ui/generate',
  '/__openclaw__/canvas/a2ui/generate',
  '/__openclaw__/canvas/scene/generate'
];
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const A2UI_STORAGE_KEY = 'clawscreen.lastKnownGoodA2UI.v1';

const DEMO_PROMPTS = [
  'Give me a calm morning command center with only top priorities.',
  'Show me everything I need before leaving in 20 minutes.',
  'I’m stressed. Simplify my day into 3 actions.',
  'Family evening mode: dinner, pickups, tomorrow prep.',
  'Show a concise executive dashboard for today.'
];

const els = {
  app: document.getElementById('app'),
  time: document.getElementById('timeDisplay'),
  date: document.getElementById('dateDisplay'),
  title: document.getElementById('sceneTitle'),
  subtitle: document.getElementById('sceneSubtitle'),
  status: document.getElementById('statusBar'),
  stateBadge: document.getElementById('stateBadge'),
  promptInput: document.getElementById('promptInput'),
  submitBtn: document.getElementById('generateBtn'),
  retryBtn: document.getElementById('retryBtn'),
  demoSelect: document.getElementById('demoIntentSelect'),
  demoRunBtn: document.getElementById('useDemoIntentBtn'),
  renderSurface: document.getElementById('sceneCards'),
  rawDialog: document.getElementById('rawSceneDialog'),
  rawOutput: document.getElementById('rawSceneOutput'),
  showRawBtn: document.getElementById('showRawBtn'),
  rawCloseBtn: document.getElementById('rawCloseBtn')
};

const state = {
  lastPrompt: DEMO_PROMPTS[0],
  lastPayload: null,
  lastError: null
};

const offlineFallbackPayload = {
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
          'Submit any demo prompt to confirm dynamic payload changes',
          'Use “Show Raw” to inspect returned payload'
        ]
      }
    ]
  }
};

function heuristicPayloadFromPrompt(prompt) {
  const p = String(prompt || '').trim();
  const lower = p.toLowerCase();
  const blocks = [];

  blocks.push({
    type: 'summary',
    title: 'Your request',
    text: p
  });

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

  if (/family|evening|tomorrow/.test(lower)) {
    blocks.push({
      type: 'list',
      title: 'Family planning lane',
      items: ['Pickups / logistics', 'Dinner + bedtime timing', 'Tomorrow morning prep items']
    });
  }

  if (/executive|overview|system|status|openclaw/.test(lower)) {
    blocks.push({
      type: 'metric',
      title: 'System snapshot',
      label: 'Mode',
      value: 'Prototype / Prompt-to-Screen'
    });
    blocks.push({
      type: 'list',
      title: 'Suggested checks',
      items: ['Gateway health', 'Active automations', 'Recent updates or failures']
    });
  }

  if (blocks.length === 1) {
    blocks.push({
      type: 'notes',
      title: 'Interpreted intent',
      body: 'No fixed template matched, so this screen is intentionally generic and generated from your request.'
    });
    blocks.push({
      type: 'list',
      title: 'Next step suggestions',
      items: ['Ask for a specific output format', 'Ask for only what matters now', 'Ask for a comparison or summary']
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

function nowIso() {
  return new Date().toISOString();
}

function formatClock() {
  const now = new Date();
  els.time.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  els.date.textContent = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
}

function setUiState(nextState, message) {
  els.app.dataset.state = nextState;
  const labels = {
    idle: 'Idle',
    thinking: 'Thinking…',
    rendering: 'Rendering…',
    ready: 'Ready',
    error: 'Error'
  };
  els.stateBadge.textContent = labels[nextState] || nextState;
  if (message) els.status.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function persistLkg(payload) {
  localStorage.setItem(A2UI_STORAGE_KEY, JSON.stringify(payload));
}

function loadLkg() {
  try {
    const raw = localStorage.getItem(A2UI_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isSafePayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const serialized = JSON.stringify(payload);
  if (serialized.length > 300_000) return false;
  if (/<script|javascript:|onerror=|onload=/i.test(serialized)) return false;
  return true;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseJsonLines(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const objects = lines.map((line) => tryParseJson(line)).filter(Boolean);
  return objects.length ? objects : null;
}

function normalizeA2uiPayload(raw) {
  const payload = raw?.a2ui ?? raw?.payload ?? raw;

  if (payload == null) {
    throw new Error('Empty A2UI payload');
  }

  if (typeof payload === 'string') {
    const asJson = tryParseJson(payload);
    if (asJson) return normalizeA2uiPayload(asJson);

    const asJsonl = parseJsonLines(payload);
    if (asJsonl) return { version: '0.8', screen: { title: 'A2UI Stream', blocks: asJsonl } };

    throw new Error('Unparseable A2UI string payload');
  }

  if (Array.isArray(payload)) {
    return { version: '0.8', screen: { title: 'A2UI Output', blocks: payload } };
  }

  if (Array.isArray(payload.ops)) {
    const setScreen = payload.ops.find((op) => op?.value?.blocks || op?.value?.children || op?.value?.content);
    if (setScreen) {
      return {
        version: payload.version || '0.8',
        screen: setScreen.value
      };
    }
  }

  if (payload.screen) {
    return {
      version: payload.version || '0.8',
      screen: payload.screen
    };
  }

  if (payload.blocks || payload.children || payload.content) {
    return {
      version: payload.version || '0.8',
      screen: payload
    };
  }

  return {
    version: payload.version || '0.8',
    screen: {
      title: payload.title || 'A2UI Output',
      blocks: [payload]
    }
  };
}

function withTimeout(ms, promise) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise
      .then((res) => {
        clearTimeout(timeout);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

async function requestA2ui(prompt, endpoint) {
  const requestBody = {
    prompt,
    input: prompt,
    request: prompt,
    schemaVersion: '0.8',
    context: {
      now: nowIso(),
      appVersion: APP_VERSION,
      previousSummary: state.lastPayload?.screen?.title || null
    }
  };

  const res = await withTimeout(
    REQUEST_TIMEOUT_MS,
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain'
      },
      body: JSON.stringify(requestBody)
    })
  );

  if (!res.ok) {
    throw new Error(`${endpoint} responded ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await res.json();
  }

  return await res.text();
}

async function generateA2ui(prompt) {
  const failures = [];

  for (const endpoint of A2UI_ENDPOINT_CANDIDATES) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        return await requestA2ui(prompt, endpoint);
      } catch (err) {
        failures.push(`${endpoint} attempt ${attempt}: ${err.message}`);
      }
    }
  }

  throw new Error(failures.join(' | '));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function renderPrimitive(value) {
  if (value == null) return '<span class="muted">—</span>';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return escapeHtml(value);
  }
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function renderKeyValueTable(obj) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return '';
  return `<dl class="kv-table">${entries
    .map(([key, val]) => `<dt>${escapeHtml(key)}</dt><dd>${renderPrimitive(val)}</dd>`)
    .join('')}</dl>`;
}

function normalizeChildren(node) {
  return asArray(node?.children || node?.blocks || node?.items || node?.content || node?.body);
}

function renderNode(node) {
  if (node == null) return '';

  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    return `<p>${escapeHtml(node)}</p>`;
  }

  const type = String(node.type || node.kind || node.component || 'unknown').toLowerCase();

  if (type === 'text' || type === 'markdown') {
    return `<p>${escapeHtml(node.text || node.value || node.content || '')}</p>`;
  }

  if (type === 'list') {
    const items = asArray(node.items || node.values || node.children);
    return `<section class="generic-block"><h3>${escapeHtml(node.title || 'List')}</h3><ul>${items
      .map((item) => `<li>${renderPrimitive(item)}</li>`)
      .join('')}</ul></section>`;
  }

  if (type === 'metric' || type === 'stat') {
    return `<section class="generic-block metric"><h3>${escapeHtml(node.label || node.title || 'Metric')}</h3><p class="metric-value">${renderPrimitive(node.value ?? node.metric ?? node.number)}</p>${node.delta ? `<p class="muted">${escapeHtml(node.delta)}</p>` : ''}</section>`;
  }

  if (type === 'divider') {
    return '<hr class="divider" />';
  }

  const title = node.title || node.label || null;
  const children = normalizeChildren(node);
  const reserved = new Set(['type', 'kind', 'component', 'title', 'label', 'children', 'blocks', 'items', 'content', 'body']);
  const details = Object.fromEntries(Object.entries(node).filter(([k]) => !reserved.has(k)));

  const childHtml = children.map((child) => `<div class="node-child">${renderNode(child)}</div>`).join('');
  const detailsHtml = Object.keys(details).length ? renderKeyValueTable(details) : '';

  return `
    <section class="generic-block type-${escapeHtml(type)}">
      ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
      ${childHtml}
      ${detailsHtml}
    </section>
  `;
}

function renderA2ui(payload, source) {
  const normalized = normalizeA2uiPayload(payload);
  if (!isSafePayload(normalized)) {
    throw new Error('Payload failed safety checks');
  }

  setUiState('rendering', 'Rendering A2UI…');

  const screen = normalized.screen || {};
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

  state.lastPayload = normalized;
  persistLkg(normalized);
  setUiState('ready', `Rendered ${nodesToRender.length} block(s) from ${source} (${APP_VERSION})`);
}

function showRawPayload() {
  if (!state.lastPayload) return;
  els.rawOutput.textContent = JSON.stringify(state.lastPayload, null, 2);
  els.rawDialog.showModal();
}

async function submitPrompt(prompt, source = 'prompt') {
  const trimmed = (prompt || '').trim();
  if (!trimmed) return;

  state.lastPrompt = trimmed;
  state.lastError = null;
  setUiState('thinking', 'Thinking… generating A2UI payload');

  try {
    const payload = await generateA2ui(trimmed);
    renderA2ui(payload, source);
  } catch (err) {
    state.lastError = err;

    try {
      const heuristic = heuristicPayloadFromPrompt(trimmed);
      renderA2ui(heuristic, 'local-heuristic');
      setUiState('ready', `Gateway generation unavailable; rendered dynamic local interpretation. (${err.message})`);
      return;
    } catch {
      // continue fallback chain
    }

    const lkg = loadLkg();
    if (lkg && isSafePayload(lkg)) {
      try {
        renderA2ui(lkg, 'last-known-good');
        setUiState('error', `Generation failed, showing last known good. Retry available. (${err.message})`);
        return;
      } catch {
        // continue to offline fallback
      }
    }

    try {
      renderA2ui(offlineFallbackPayload, 'offline-fallback');
      setUiState('error', `Generation failed, using offline fallback. Retry available. (${err.message})`);
    } catch {
      setUiState('error', `Generation failed and fallback render failed. (${err.message})`);
    }
  }
}

function setupDemoPrompts() {
  DEMO_PROMPTS.forEach((prompt) => {
    const option = document.createElement('option');
    option.value = prompt;
    option.textContent = prompt;
    els.demoSelect.appendChild(option);
  });
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

  els.demoRunBtn.addEventListener('click', () => {
    const selected = els.demoSelect.value;
    els.promptInput.value = selected;
    submitPrompt(selected, 'demo');
  });

  els.showRawBtn.addEventListener('click', showRawPayload);
  els.rawCloseBtn.addEventListener('click', () => els.rawDialog.close());
}

function start() {
  formatClock();
  setInterval(formatClock, 1000);

  setupDemoPrompts();
  wire();

  els.promptInput.value = DEMO_PROMPTS[0];

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
