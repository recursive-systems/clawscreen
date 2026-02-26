import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { canonicalToCompatiblePayload, toCanonicalEnvelope } from '../shared/a2ui.js';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.A2UI_PORT || 18841);
const HOST = process.env.A2UI_HOST || '0.0.0.0';

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || '';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const GATEWAY_AGENT_ID = process.env.OPENCLAW_AGENT_ID || 'main';
const GATEWAY_SESSION_KEY = process.env.OPENCLAW_GATEWAY_SESSION_KEY || `agent:${GATEWAY_AGENT_ID}:clawscreen-a2ui`;
const GATEWAY_RPC_TIMEOUT_MS = Number(process.env.OPENCLAW_GATEWAY_RPC_TIMEOUT_MS || 30000);
const GATEWAY_RESPONSE_TIMEOUT_MS = Number(process.env.OPENCLAW_GATEWAY_RESPONSE_TIMEOUT_MS || 45000);

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
  try {
    const prompt = String(req.body?.prompt || '').trim();
    const context = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};

    if (!prompt) {
      return res.status(400).json({ ok: false, error: { code: 'bad_request', message: 'Missing required field: prompt (string)' } });
    }

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
type Block = { type: string; title?: string; text?: string; items?: string[]; value?: string; delta?: string };
type Normalized = { version: string; screen: { title: string; subtitle: string; blocks: Block[] } };

async function generateViaOpenClawGateway({ prompt, context }: GenerateInput): Promise<Normalized> {
  let feedback = '';

  for (let genAttempt = 1; genAttempt <= 2; genAttempt += 1) {
    const strictPrompt = [
      'Return STRICT JSON only. No markdown. No prose.',
      'Output exactly one object with this shape:',
      '{"version":"0.8","screen":{"title":string,"subtitle":string,"blocks":Block[]}}',
      'Allowed block types only: text, list, metric, card, notes, divider.',
      'Never include HTML/script tags, javascript: URLs, or inline event handlers.',
      'Each block must be complete:',
      '- list: must include at least one item',
      '- metric: must include value',
      '- card/notes/text: must include non-empty text/body/content',
      'Keep response concise and dashboard-oriented.',
      feedback ? `Retry feedback: ${feedback}` : '',
      '',
      'User input payload:',
      JSON.stringify({ prompt, context })
    ]
      .filter(Boolean)
      .join('\n');

    const idempotencyKey = `clawscreen-${randomUUID()}`;
    const baseline = await safeHistoryFetch();
    const baselineLength = Array.isArray((baseline as any)?.messages) ? (baseline as any).messages.length : 0;

    await callGateway('chat.send', {
      sessionKey: GATEWAY_SESSION_KEY,
      message: strictPrompt,
      deliver: false,
      idempotencyKey,
      timeoutMs: GATEWAY_RESPONSE_TIMEOUT_MS
    });

    const startedAt = Date.now();
    while (Date.now() - startedAt < GATEWAY_RESPONSE_TIMEOUT_MS) {
      await sleep(900);
      const history = await callGateway('chat.history', { sessionKey: GATEWAY_SESSION_KEY });
      const messages = Array.isArray((history as any)?.messages) ? (history as any).messages : [];
      if (messages.length <= baselineLength) continue;

      const candidate = pickNewestAssistantText(messages.slice(baselineLength));
      if (!candidate) continue;

      const parsed = tryParseJson(candidate);
      if (!parsed) continue;

      // Trust boundary: model output is coerced into canonical messages before any rendering shape is used.
      const envelope = toCanonicalEnvelope(parsed);
      const normalized = normalizeA2uiPayload(canonicalToCompatiblePayload(envelope), prompt);
      const issues = getRenderableIssues(normalized);
      if (!issues.length) return normalized;

      feedback = `Previous output failed validation: ${issues.join('; ')}`;
      break;
    }
  }

  throw new Error(
    `Gateway did not return valid renderable JSON within retries (${GATEWAY_RESPONSE_TIMEOUT_MS}ms per attempt). Check gateway health with: openclaw gateway status`
  );
}

async function safeHistoryFetch(): Promise<Record<string, unknown>> {
  try {
    return await callGateway('chat.history', { sessionKey: GATEWAY_SESSION_KEY });
  } catch {
    return { messages: [] };
  }
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

async function callGateway(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const args = ['gateway', 'call', method, '--json', '--params', JSON.stringify(params), '--timeout', String(GATEWAY_RPC_TIMEOUT_MS)];
  if (GATEWAY_URL) args.push('--url', GATEWAY_URL);
  if (GATEWAY_TOKEN) args.push('--token', GATEWAY_TOKEN);

  try {
    const { stdout, stderr } = await execFileAsync('openclaw', args, {
      maxBuffer: 1024 * 1024 * 2,
      timeout: GATEWAY_RPC_TIMEOUT_MS + 2000
    });

    if (stderr && stderr.trim()) console.warn(`[clawscreen] gateway stderr: ${stderr.trim()}`);
    return JSON.parse(stdout || '{}');
  } catch (error: any) {
    const stderr = error?.stderr ? String(error.stderr).trim() : '';
    const stdout = error?.stdout ? String(error.stdout).trim() : '';
    const details = [stderr, stdout].filter(Boolean).join(' | ');
    throw new Error(`gateway call failed (${method})${details ? `: ${details}` : ''}`);
  }
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
  const type = normalizeType(i.type || i.kind || i.component);
  const block: Block = { type };
  const title = cleanText(i.title || i.label);
  if (title) block.title = title;

  if (type === 'list') {
    const items = Array.isArray(i.items) ? i.items : Array.isArray(i.values) ? i.values : [];
    block.items = items.map((x) => cleanText(x)).filter(Boolean).slice(0, 8);
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

function normalizeType(type: unknown): string {
  const t = String(type || '').toLowerCase();
  if (['text', 'markdown'].includes(t)) return 'text';
  if (['list', 'checklist', 'bullets'].includes(t)) return 'list';
  if (['metric', 'stat', 'kpi'].includes(t)) return 'metric';
  if (['card', 'panel'].includes(t)) return 'card';
  if (['notes', 'note'].includes(t)) return 'notes';
  if (['divider', 'hr'].includes(t)) return 'divider';
  return 'card';
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
