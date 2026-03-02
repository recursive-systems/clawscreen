import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalToCompatiblePayload, toCanonicalEnvelope } from '../shared/a2ui.js';
import { createActionResponseEnvelope, validateActionRequestEnvelope } from '../shared/actionEnvelope.js';
import { coerceTrustedComponentType } from '../shared/trustedComponents.js';
import { createOpenClawGateway, getOpenClawGatewayConfigFromEnv } from './adapters/openclawGateway.js';

const PORT = Number(process.env.A2UI_PORT || 18841);
const HOST = process.env.A2UI_HOST || '0.0.0.0';

const gateway = createOpenClawGateway(getOpenClawGatewayConfigFromEnv());
const GATEWAY_SESSION_KEY = gateway.config.sessionKey;
const GATEWAY_RESPONSE_TIMEOUT_MS = gateway.config.responseTimeoutMs;

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(
  cors({
    origin: true,
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'clawscreen-a2ui-bridge', provider: 'openclaw-gateway', gatewaySessionKey: GATEWAY_SESSION_KEY });
});

app.post('/a2ui/generate', async (req: Request, res: Response) => {
  const prompt = String(req.body?.prompt || '').trim();
  const context = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};
  const wantsStream = String(req.headers.accept || '').includes('text/event-stream');

  if (!prompt) {
    return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'Missing required field: prompt (string)' } });
  }

  if (!wantsStream) {
    try {
      const normalized = await generateViaOpenClawGateway({ prompt, context });
      return res.json({ ok: true, provider: 'openclaw-gateway', a2ui: normalized });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown generation error';
      const isGatewayConfigIssue = /OPENCLAW_GATEWAY_|gateway call failed|openclaw\s+gateway\s+call/i.test(message);
      return res.status(isGatewayConfigIssue ? 503 : 500).json({
        ok: false,
        error: { code: isGatewayConfigIssue ? 'gateway_unavailable' : 'generation_failed', message }
      });
    }
  }

  // SSE streaming mode
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('status', { text: 'Sending to model…' });

  try {
    const normalized = await generateViaOpenClawGateway(
      { prompt, context },
      (status) => sendEvent('status', { text: status }),
      (partial) => sendEvent('partial', { ok: true, provider: 'openclaw-gateway', a2ui: partial })
    );
    sendEvent('result', { ok: true, provider: 'openclaw-gateway', a2ui: normalized });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown generation error';
    sendEvent('error', { message });
  }

  res.end();
});

app.post('/a2ui/action', async (req: Request, res: Response) => {
  const validated = validateActionRequestEnvelope(req.body);
  if (!validated.ok) {
    return res.status(400).json({ ok: false, error: { code: 'bad_request', message: validated.error } });
  }

  const { version, event } = validated.value;
  const targetText = event.target ? `Target: ${event.target}` : 'No explicit target';

  const response = createActionResponseEnvelope({
    version,
    taskId: `task_${randomUUID().slice(0, 8)}`,
    output: {
      version,
      screen: {
        title: event.type === 'button.click' ? 'Action processed' : 'Event processed',
        subtitle: `event_id=${event.id}`,
        blocks: [
          { type: 'text', title: 'Type', text: event.type },
          { type: 'text', title: 'Target', text: targetText },
          { type: 'text', title: 'Timestamp', text: event.timestamp }
        ]
      }
    }
  });

  return res.json(response);
});

const clientDistPath = path.resolve(process.cwd(), 'dist/client');
app.use(express.static(clientDistPath));
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`[clawscreen] listening on http://${HOST}:${PORT}`);
  console.log(`[clawscreen] gateway session key: ${GATEWAY_SESSION_KEY}`);
});

type GenerateInput = { prompt: string; context: Record<string, unknown> };
type Block = {
  type: string;
  title?: string;
  text?: string;
  items?: string[];
  value?: string;
  delta?: string;
  children?: Block[];
  src?: string;
  url?: string;
  alt?: string;
  caption?: string;
  icon?: string;
};
type Normalized = { version: string; screen: { title: string; subtitle: string; blocks: Block[] } };

type ProgressCallbacks = {
  onStatus?: (status: string) => void;
  onPartial?: (partial: Normalized) => void;
};

async function generateViaOpenClawGateway({ prompt, context }: GenerateInput, onStatus?: (status: string) => void, onPartial?: (partial: Normalized) => void): Promise<Normalized> {
  let feedback = '';

  for (let genAttempt = 1; genAttempt <= 2; genAttempt += 1) {
    const strictPrompt = [
      'You are generating a ClawScreen A2UI response.',
      'SPEED IS CRITICAL. Users are waiting in real-time. Target under 30 seconds total.',
      '- Limit yourself to at most 3 tool calls. Pick the 2-3 most important data sources for the request.',
      '- If a tool call is slow or fails, skip it and note the gap in a block — do NOT retry.',
      '- For simple prompts (greetings, general knowledge, opinions), respond immediately with NO tool calls.',
      '- Only use tools when the user explicitly needs live/personal data (calendar, weather, tasks, etc.).',
      'If the request needs live external/personal data, use available OpenClaw tools first, then answer from tool results.',
      'Prefer freshness over guessing. Do not fabricate missing data.',
      'Return STRICT JSON only. No markdown. No prose.',
      'Output exactly one object with this shape:',
      '{"version":"0.8","screen":{"title":string,"subtitle":string,"blocks":Block[]}}',
      'Allowed block types only: text, list, metric, card, notes, divider, image, icon, row, column, section.',
      '',
      'Design principles — produce visually rich, magazine-style dashboard layouts:',
      '- Lead with a hero image when the topic has a strong visual identity (places, food, nature, architecture, etc.). Use well-known public image URLs (e.g. Unsplash https://images.unsplash.com/..., Wikimedia Commons, official sources).',
      '- Use section/row/column to compose multi-column layouts instead of flat vertical stacks. For example, place two metrics side-by-side in a row, or pair an image with a text summary in a row.',
      '- Each block can have a "size" field ("small", "medium", "large") to control grid width. Use "small" for metrics/icons, "medium" for cards/lists, "large" for hero images and wide sections.',
      '- Prefer variety: mix block types (image + metric + list + card) rather than repeating the same type.',
      '- Use icon blocks for quick visual markers (e.g. weather, status, category symbols).',
      '- Keep text blocks short and scannable. Put detail in lists or cards, not long paragraphs.',
      '',
      'Type-selection rules:',
      '- If the topic is a place, person, food, event, or anything visual: ALWAYS include at least one image block with a real public image URL.',
      '- If content is an image URL/preview, emit type:"image" with src and optional caption/alt (not prose in a card).',
      '- Use row to group related blocks horizontally (e.g. two metrics, an image + description).',
      '- Use column to stack related blocks vertically within a row.',
      '- Use section to group blocks under a heading.',
      '- Use icon for symbolic status markers.',
      'Never include HTML/script tags, javascript: URLs, or inline event handlers.',
      'Each block must be complete:',
      '- list: must include at least one item',
      '- metric: must include value',
      '- image: must include a valid https:// src URL',
      '- card/notes/text: must include non-empty text/body/content',
      'If data is unavailable after attempting tools, state that clearly in a block and include the exact missing source.',
      'Keep response concise and dashboard-oriented.',
      feedback ? `Retry feedback: ${feedback}` : '',
      '',
      'User input payload:',
      JSON.stringify({ prompt, context })
    ]
      .filter(Boolean)
      .join('\n');

    const requestSessionKey = `${GATEWAY_SESSION_KEY}:${randomUUID().slice(0, 8)}`;
    const idempotencyKey = `clawscreen-${randomUUID()}`;

    await gateway.chatSend({
      message: strictPrompt,
      deliver: false,
      idempotencyKey,
      timeoutMs: GATEWAY_RESPONSE_TIMEOUT_MS
    }, requestSessionKey);

    const startedAt = Date.now();
    let pollCount = 0;
    while (Date.now() - startedAt < GATEWAY_RESPONSE_TIMEOUT_MS) {
      await sleep(1500);
      pollCount += 1;
      const history = await gateway.chatHistory(requestSessionKey);
      const messages = Array.isArray((history as any)?.messages) ? (history as any).messages : [];
      if (messages.length <= 1) {
        if (pollCount % 4 === 0) console.log(`[clawscreen] still waiting for response (${Math.round((Date.now() - startedAt) / 1000)}s, ${messages.length} msgs)`);
        continue;
      }

      const lastMsg = messages[messages.length - 1] as any;
      const lastRole = lastMsg?.role;
      const lastStop = lastMsg?.stopReason;
      if (pollCount % 4 === 0 || lastRole === 'assistant') {
        console.log(`[clawscreen] polling: ${messages.length} msgs, last=${lastRole}, stop=${lastStop || 'n/a'} (${Math.round((Date.now() - startedAt) / 1000)}s)`);
      }

      // Emit status update for SSE clients
      if (onStatus) {
        const statusText = describeGatewayProgress(messages);
        if (statusText) onStatus(statusText);
      }

      // Progressive rendering: emit partial screen from tool results every ~10s
      if (onPartial && messages.length >= 3 && pollCount % 7 === 0) {
        const partial = synthesizePartialScreen(messages, prompt);
        if (partial) onPartial(partial);
      }

      // If the model is still doing tool calls, keep waiting
      if (lastRole === 'assistant' && lastStop === 'toolUse') continue;
      if (lastRole === 'toolResult') continue;

      // If the model errored, break out and retry on next attempt
      if (lastRole === 'assistant' && lastStop === 'error') {
        console.warn(`[clawscreen] gateway model returned stopReason=error after ${messages.length} msgs — will retry`);
        if (onStatus) onStatus('Model error, retrying…');
        feedback = 'Previous attempt failed with a model error. Please try again.';
        break;
      }

      const candidate = pickNewestAssistantText(messages);

      const parsed = candidate ? tryParseJson(candidate) || tryParseEmbeddedJson(candidate) : null;
      if (parsed) {
        // Trust boundary: model output is coerced into canonical messages before any rendering shape is used.
        const envelope = toCanonicalEnvelope(parsed);
        const normalized = normalizeA2uiPayload(canonicalToCompatiblePayload(envelope), prompt);
        const issues = getRenderableIssues(normalized);
        if (!issues.length) return normalized;

        feedback = `Previous output failed validation: ${issues.join('; ')}`;
        break;
      }

      // If assistant already terminated but did not produce parseable JSON, fail fast and retry.
      if (lastRole === 'assistant' && lastStop && lastStop !== 'toolUse') {
        feedback = 'Previous response was not valid JSON. Return exactly one valid JSON object only.';
        break;
      }

      // Otherwise keep polling until timeout.
      continue;
    }
  }

  throw new Error(
    `Gateway did not return valid renderable JSON within retries (${GATEWAY_RESPONSE_TIMEOUT_MS}ms per attempt). Check gateway health with: openclaw gateway status`
  );
}

async function safeHistoryFetch(): Promise<Record<string, unknown>> {
  try {
    return await gateway.chatHistory(GATEWAY_SESSION_KEY);
  } catch {
    return { messages: [] };
  }
}

function synthesizePartialScreen(messages: Array<Record<string, unknown>>, prompt: string): Normalized | null {
  const blocks: Block[] = [];
  const seenTools = new Set<string>();

  for (const msg of messages) {
    const m = msg as any;

    // Extract tool names being called
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c.type === 'toolCall' && c.name) seenTools.add(c.name);
      }
    }

    // Extract summaries from tool results
    if (m.role === 'toolResult' && Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c.type !== 'text' || !c.text) continue;
        const text = String(c.text).trim();
        if (text.length < 20 || text.length > 4000) continue;
        if (c.isError) continue;

        // Try to parse as JSON and extract something meaningful
        try {
          const parsed = JSON.parse(text);
          // Weather-like data
          if (parsed.current || parsed.temperature || parsed.weather) {
            const temp = parsed.current?.temperature_2m || parsed.temperature;
            if (temp != null) {
              blocks.push({ type: 'metric', title: 'Temperature', value: `${temp}°` });
            }
            continue;
          }
          // Calendar/tasks - array of items
          if (Array.isArray(parsed.events || parsed.items || parsed.tasks || parsed.tasklists)) {
            const arr = parsed.events || parsed.items || parsed.tasks || parsed.tasklists;
            if (arr.length) {
              blocks.push({
                type: 'list',
                title: parsed.events ? 'Calendar' : 'Tasks',
                items: arr.slice(0, 5).map((e: any) => cleanText(e.summary || e.title || e.name || JSON.stringify(e).slice(0, 80)))
              });
            }
            continue;
          }
        } catch {
          // Not JSON — use as text snippet if it's short enough
          if (text.length < 300 && !text.includes('Usage:') && !text.includes('Error')) {
            blocks.push({ type: 'text', text: text.slice(0, 200) });
          }
        }
      }
    }
  }

  if (!blocks.length) return null;

  // Add a "still loading" indicator
  const pending = [...seenTools].filter((t) => !['read'].includes(t));
  if (pending.length) {
    blocks.push({ type: 'text', title: 'Still loading…', text: `Gathering more data (${pending.length} sources)` });
  }

  return {
    version: '0.8',
    screen: {
      title: `${prompt.slice(0, 50)}`,
      subtitle: 'Partial — updating as data arrives…',
      blocks: blocks.slice(0, 8)
    }
  };
}

const TOOL_LABELS: Record<string, string> = {
  web_fetch: 'Fetching web data',
  web_search: 'Searching the web',
  read: 'Reading files',
  exec: 'Running a command',
  process: 'Processing data',
  search: 'Searching'
};

function describeGatewayProgress(messages: Array<Record<string, unknown>>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i] as any;
    if (msg?.role === 'assistant') {
      const content = Array.isArray(msg.content) ? msg.content : [];
      const toolCalls = content.filter((c: any) => c?.type === 'toolCall');
      if (toolCalls.length) {
        const unique = [...new Set(toolCalls.map((c: any) => TOOL_LABELS[c.name] || c.name))];
        return unique.slice(0, 2).join(', ');
      }
      const thinking = content.find((c: any) => c?.type === 'thinking');
      if (thinking?.thinking) {
        const snippet = String(thinking.thinking).slice(0, 60).replace(/\n/g, ' ').trim();
        return snippet || 'Thinking…';
      }
      return 'Generating response…';
    }
  }
  return 'Waiting for model…';
}

function pickNewestAssistantText(messages: Array<Record<string, unknown>>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== 'assistant') continue;
    const text = extractTextFromMessage(msg);
    if (text) return text;
  }
  return '';
}

function extractTextFromMessage(msg: Record<string, unknown>): string {
  const chunks = Array.isArray(msg?.content) ? msg.content : [];
  const parts = chunks
    .filter((c: any) => c?.type === 'text' && typeof c?.text === 'string')
    .map((c: any) => c.text.trim())
    .filter(Boolean);

  if (!parts.length) return '';
  return parts.join('\n').replace(/^```json\s*/i, '').replace(/^```/i, '').replace(/```$/, '').trim();
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function tryParseEmbeddedJson(value: string): unknown | null {
  const text = String(value || '').trim();
  if (!text) return null;

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;

  const slice = text.slice(first, last + 1);
  return tryParseJson(slice);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeA2uiPayload(raw: Record<string, unknown>, fallbackPrompt = 'Generated screen'): Normalized {
  const payload = (raw?.a2ui ?? raw?.payload ?? raw) as any;
  const version = typeof payload?.version === 'string' ? payload.version : '0.8';
  const screenIn = payload?.screen && typeof payload.screen === 'object' ? payload.screen : payload;

  const title = cleanText(screenIn?.title) || `HUD: ${fallbackPrompt.slice(0, 60)}`;
  const subtitle = cleanText(screenIn?.subtitle) || 'Generated by OpenClaw gateway bridge';

  const sourceBlocks = Array.isArray(screenIn?.blocks)
    ? screenIn.blocks
    : Array.isArray(screenIn?.children)
      ? screenIn.children
      : Array.isArray(screenIn?.items)
        ? screenIn.items
        : [];

  const blocks = sourceBlocks.map(normalizeBlock).filter(Boolean).slice(0, 12) as Block[];
  if (!blocks.length) {
    blocks.push({ type: 'text', title: 'Summary', text: cleanText(fallbackPrompt) || 'No content returned by model.' });
  }

  return { version, screen: { title, subtitle, blocks } };
}

function normalizeBlock(input: unknown): Block | null {
  if (input == null) return null;
  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') return { type: 'text', text: cleanText(input) };
  if (typeof input !== 'object') return null;

  const i = input as Record<string, any>;
  const type = coerceTrustedComponentType(i.type || i.kind || i.component, 'card');
  const block: Block = { type };
  const title = cleanText(i.title || i.label);
  if (title) block.title = title;

  if (type === 'list') {
    const items = Array.isArray(i.items) ? i.items : Array.isArray(i.values) ? i.values : [];
    block.items = items.map((x) => flattenListItem(x)).filter(Boolean).slice(0, 8);
    if (!block.items.length) return null;
    return block;
  }

  if (type === 'metric') {
    const value = cleanText(i.value ?? i.metric ?? i.number ?? i.text);
    if (!value) return null;
    block.value = value;
    const delta = cleanText(i.delta);
    if (delta) block.delta = delta;
    return block;
  }

  if (type === 'divider') return block;

  if (type === 'image') {
    const src = cleanUrl(i.src || i.url || i.image || i.href || i.value || i.content);
    if (!src) return null;
    block.src = src;
    const alt = cleanText(i.alt || i.label || i.title);
    const caption = cleanText(i.caption || i.text || i.body);
    if (alt) block.alt = alt;
    if (caption) block.caption = caption;
    return block;
  }

  if (type === 'icon') {
    const icon = cleanText(i.icon || i.token || i.value || i.text || i.label || i.title);
    if (!icon) return null;
    block.icon = icon;
    return block;
  }

  if (type === 'row' || type === 'column' || type === 'section') {
    const childrenSource = Array.isArray(i.children)
      ? i.children
      : Array.isArray(i.blocks)
        ? i.blocks
        : Array.isArray(i.items)
          ? i.items
          : [];

    const children = childrenSource.map((child: unknown) => normalizeBlock(child)).filter(Boolean) as Block[];
    if (children.length) block.children = children;

    const text = cleanText(i.text || i.body || i.content || i.value);
    if (text) block.text = text;

    if (!block.title && !block.text && !block.children?.length) return null;
    return block;
  }

  const text = cleanText(i.text || i.body || i.content || i.value);
  if (text) block.text = text;
  if (!block.title && !block.text) return null;
  return block;
}

function getRenderableIssues(a2ui: Normalized): string[] {
  const blocks = Array.isArray(a2ui?.screen?.blocks) ? a2ui.screen.blocks : [];
  const issues: string[] = [];
  if (!blocks.length) issues.push('screen.blocks is empty');

  blocks.forEach((b, idx) => {
    const t = String(b?.type || 'card');
    if (t === 'list' && (!Array.isArray(b.items) || !b.items.length)) issues.push(`block[${idx}] list has no items`);
    if (t === 'metric' && !cleanText(b.value)) issues.push(`block[${idx}] metric has no value`);
    if ((t === 'card' || t === 'notes' || t === 'text') && !cleanText(b.text)) issues.push(`block[${idx}] ${t} has no text`);
  });

  return issues;
}

function flattenListItem(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'object') return cleanText(value);
  const obj = value as Record<string, unknown>;
  const label = cleanText(obj.label || obj.title || obj.name);
  const detail = cleanText(obj.text || obj.value || obj.summary || obj.description || obj.body || obj.content);
  if (label && detail) return `${label}: ${detail}`;
  if (label) return label;
  if (detail) return detail;
  // Last resort: join all string values
  const parts = Object.values(obj).filter((v) => typeof v === 'string' && v.trim()).map((v) => cleanText(v));
  return parts.join(' — ') || cleanText(JSON.stringify(value));
}

function cleanText(value: unknown): string {
  if (value == null) return '';
  const text = String(value)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim();
  return text.slice(0, 300);
}

function cleanUrl(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return '';

  const compact = raw.replace(/\s+/g, '');
  if (/^(javascript|data):/i.test(compact)) return '';

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) {
    try {
      const protocol = new URL(raw).protocol.toLowerCase();
      if (protocol !== 'http:' && protocol !== 'https:') return '';
    } catch {
      return '';
    }
  }

  return raw.slice(0, 1024);
}
