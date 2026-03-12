import { A2UIBlock, A2UICompatiblePayload, JsonValue } from '../../shared/a2ui';

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

type HudComposeContext = {
  prompt?: string;
  trust?: 'trusted' | 'untrusted';
  eventCount?: number;
  actionAssist?: ActionAssistContext | null;
};

const asArray = <T>(value: T | T[] | null | undefined): T[] => (Array.isArray(value) ? value : value == null ? [] : [value]);

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!value) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function compactText(value: string, max = 160): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function blockTitle(block: A2UIBlock): string {
  return compactText(toText(block.title || block.label || block.type || ''));
}

function blockPrimaryText(block: A2UIBlock): string {
  return compactText(toText(block.text || block.body || block.content || block.value || ''));
}

function itemToText(item: unknown): string {
  if (typeof item === 'string') return compactText(item, 120);
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  const record = asRecord(item);
  const head = toText(record.title || record.label || record.name || '');
  const body = toText(record.text || record.body || record.value || record.summary || record.description || '');
  if (head && body) return compactText(`${head}: ${body}`, 140);
  if (head) return compactText(head, 120);
  if (body) return compactText(body, 120);
  return compactText(toText(item), 120);
}

function normalizeItems(items: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of items) {
    const text = itemToText(entry);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= 8) break;
  }
  return out;
}

function flattenBlocks(screen: Record<string, unknown>): A2UIBlock[] {
  const queue = asArray(screen.blocks || screen.children || screen.content || screen.items) as A2UIBlock[];
  const out: A2UIBlock[] = [];

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    out.push(node);
    const nested = asArray((node as Record<string, unknown>).children || (node as Record<string, unknown>).blocks || (node as Record<string, unknown>).content || (node as Record<string, unknown>).items);
    for (const child of nested) {
      if (child && typeof child === 'object') queue.push(child as A2UIBlock);
    }
  }

  return out;
}

function findListByHint(blocks: A2UIBlock[], hint: RegExp): string[] {
  for (const block of blocks) {
    const type = toText(block.type).toLowerCase();
    if (type && type !== 'list') continue;
    const title = blockTitle(block);
    if (!hint.test(title)) continue;
    const items = normalizeItems(asArray(block.items || block.values || block.children || block.content));
    if (items.length) return items;
  }
  return [];
}

function collectLists(blocks: A2UIBlock[]): string[][] {
  const lists: string[][] = [];
  for (const block of blocks) {
    const type = toText(block.type).toLowerCase();
    if (type && type !== 'list') continue;
    const items = normalizeItems(asArray(block.items || block.values || block.children || block.content));
    if (items.length) lists.push(items);
  }
  return lists;
}

function deriveSummary(blocks: A2UIBlock[], fallbackPrompt: string): string {
  for (const block of blocks) {
    const primary = blockPrimaryText(block);
    if (primary) return primary;
  }

  if (fallbackPrompt.trim()) return compactText(`Focus: ${fallbackPrompt}`, 180);
  return 'Ambient control surface is active. Ask for a brief, priorities, or system status.';
}

function derivePriorities(blocks: A2UIBlock[], prompt: string): string[] {
  const direct = findListByHint(blocks, /(priority|priorities|top|focus|next)/i);
  if (direct.length) return direct.slice(0, 5);

  const lists = collectLists(blocks);
  if (lists.length) return lists[0].slice(0, 5);

  const lower = prompt.toLowerCase();
  if (/(leave|departure|before i leave|before leaving)/.test(lower)) {
    return ['Departure time and travel buffer', 'Critical message or approval to send', 'One blocker to clear before leaving'];
  }

  if (/(status|overview|dashboard|system)/.test(lower)) {
    return ['Review service health and alerts', 'Validate active automations', 'Check latest failures and retries'];
  }

  return ['Pick one must-do outcome', 'Remove one non-essential task', 'Start a focused 25-minute block'];
}

function deriveTimeline(blocks: A2UIBlock[]): string[] {
  const direct = findListByHint(blocks, /(timeline|schedule|today|upcoming|next up|agenda|now)/i);
  if (direct.length) return direct.slice(0, 6);

  const lists = collectLists(blocks);
  if (lists.length > 1) return lists[1].slice(0, 6);

  return ['Now: short system check', 'Soon: resolve top blocker', 'Later: capture follow-ups and handoff'];
}

function deriveAlerts(blocks: A2UIBlock[], trust: 'trusted' | 'untrusted'): string[] {
  const direct = findListByHint(blocks, /(alert|risk|warning|attention|blocker|incident)/i);
  const alerts = direct.length ? direct.slice(0, 5) : ['No critical alerts reported by current payload'];
  if (trust === 'untrusted' && !alerts.some((entry) => /trust/i.test(entry))) {
    alerts.unshift('Trust warning: source path marked untrusted');
  }
  return alerts.slice(0, 5);
}

function deriveQuickActions(blocks: A2UIBlock[]): A2UIBlock[] {
  const existing: A2UIBlock[] = [];
  for (const block of blocks) {
    const type = toText(block.type).toLowerCase();
    if (type !== 'button') continue;
    existing.push({
      ...block,
      type: 'button',
      variant: (block as Record<string, unknown>).variant || 'secondary'
    });
    if (existing.length >= 4) break;
  }

  if (existing.length) return existing;

  return [
    {
      type: 'button',
      label: 'Refresh now',
      variant: 'primary',
      action: { type: 'refresh.request', target: 'hud' }
    },
    {
      type: 'button',
      label: 'Show blockers',
      variant: 'secondary',
      action: { type: 'view.switch', target: 'alerts' }
    },
    {
      type: 'button',
      label: 'Plan next 30 min',
      variant: 'secondary',
      action: { type: 'focus.plan', target: 'next_30' }
    }
  ];
}

function deriveMetrics(ctx: HudComposeContext, alertsCount: number): A2UIBlock[] {
  const trust = ctx.trust || 'trusted';
  const eventCount = Number.isFinite(ctx.eventCount) ? Number(ctx.eventCount) : 0;
  return [
    {
      type: 'metric',
      label: 'Trust',
      value: trust === 'trusted' ? 'Trusted' : 'Untrusted',
      delta: trust === 'trusted' ? 'Path verified' : 'Manual review suggested'
    },
    {
      type: 'metric',
      label: 'Run events',
      value: eventCount || 'n/a',
      delta: eventCount > 0 ? 'Live timeline available' : 'No run timeline yet'
    },
    {
      type: 'metric',
      label: 'Alerts',
      value: alertsCount,
      delta: alertsCount > 0 ? 'Review recommended' : 'Clear'
    }
  ];
}

function formatActionStatus(status?: string): string {
  const normalized = compactText(toText(status || ''), 40).toLowerCase();
  if (!normalized) return 'Recent action';
  return normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function deriveActionAssistBlocks(ctx: HudComposeContext): A2UIBlock[] {
  const assist = ctx.actionAssist;
  if (!assist) return [];

  const provenance = assist.provenance || {};
  const detailItems = [
    assist.label ? `Action: ${assist.label}` : '',
    assist.target ? `Target: ${assist.target}` : '',
    assist.status ? `Status: ${formatActionStatus(assist.status)}` : '',
    provenance.origin ? `Initiator: ${provenance.origin}` : '',
    provenance.tool ? `Source: ${provenance.tool}` : '',
    typeof provenance.confidence === 'number' ? `Confidence: ${provenance.confidence.toFixed(2)}` : '',
    assist.timestamp || provenance.timestamp ? `Timestamp: ${assist.timestamp || provenance.timestamp}` : ''
  ].filter(Boolean);

  const controls: A2UIBlock[] = [];
  if (assist.status && ['queued', 'running', 'input_required'].includes(assist.status)) {
    controls.push({
      type: 'button',
      label: 'Pause task',
      variant: 'secondary',
      action: {
        type: 'task.control',
        target: assist.taskId || 'current_task',
        intent: 'pause_task',
        control: { signal: 'pause' }
      }
    });
  }

  if (assist.status === 'paused' || assist.status === 'input_required') {
    if (assist.interruptId || assist.resumeToken) {
      controls.push({
        type: 'button',
        label: 'Resume task',
        variant: 'primary',
        action: {
          type: 'task.resume',
          target: assist.taskId || 'current_task',
          intent: 'resume_task',
          control: { signal: 'resume' },
          resume: {
            ...(assist.interruptId ? { interrupt_id: assist.interruptId } : {}),
            ...(assist.resumeToken ? { resume_token: assist.resumeToken } : {})
          }
        }
      });
    }

    controls.push({
      type: 'button',
      label: 'Take over manually',
      variant: 'destructive',
      action: {
        type: 'task.control',
        target: assist.taskId || 'current_task',
        intent: 'manual_takeover',
        control: { signal: 'takeover', takeover_reason: 'manual_review_requested_from_hud' }
      }
    });
  }

  if (!detailItems.length && !controls.length) return [];

  const blocks: A2UIBlock[] = [];
  if (detailItems.length) {
    blocks.push({
      type: 'list',
      size: 'medium',
      title: 'Action provenance',
      items: detailItems
    });
  }

  if (controls.length) {
    blocks.push({
      type: 'section',
      size: 'large',
      title: 'Human controls',
      children: controls as unknown as JsonValue[]
    });
  }

  return blocks;
}

export function composeHudPayload(payload: A2UICompatiblePayload, ctx: HudComposeContext = {}): A2UICompatiblePayload {
  const record = asRecord(payload);
  const screen = asRecord(record.screen);
  const sourceBlocks = flattenBlocks(screen);

  const prompt = toText(ctx.prompt || '');
  const trust = ctx.trust || 'trusted';

  const summary = deriveSummary(sourceBlocks, prompt);
  const priorities = derivePriorities(sourceBlocks, prompt);
  const timeline = deriveTimeline(sourceBlocks);
  const alerts = deriveAlerts(sourceBlocks, trust);
  const quickActions = deriveQuickActions(sourceBlocks);
  const metrics = deriveMetrics(ctx, alerts[0]?.includes('No critical alerts') ? 0 : alerts.length);
  const actionAssistBlocks = deriveActionAssistBlocks(ctx);

  const imageBlock = sourceBlocks.find((block) => toText(block.type).toLowerCase() === 'image');

  const hudBlocks: A2UIBlock[] = [
    {
      type: 'card',
      size: 'large',
      title: 'Current Focus',
      body: summary
    },
    {
      type: 'list',
      size: 'medium',
      title: 'Priorities',
      items: priorities
    },
    {
      type: 'list',
      size: 'medium',
      title: 'Timeline',
      items: timeline
    },
    {
      type: 'list',
      size: 'medium',
      title: 'Alerts',
      items: alerts
    },
    {
      type: 'row',
      size: 'large',
      children: metrics as unknown as JsonValue[]
    },
    ...actionAssistBlocks,
    {
      type: 'section',
      size: 'large',
      title: 'Quick actions',
      children: quickActions as unknown as JsonValue[]
    }
  ];

  if (imageBlock) {
    hudBlocks.splice(4, 0, { ...imageBlock, type: 'image', size: 'large' });
  }

  return {
    ...payload,
    screen: {
      ...screen,
      title: toText(screen.title || screen.name || 'Ambient HUD'),
      subtitle: toText(screen.subtitle || 'Always-on view optimized for glanceability'),
      blocks: hudBlocks
    }
  };
}
