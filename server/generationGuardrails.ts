export type GuardrailBlock = {
  type: string;
  title?: string;
  label?: string;
  text?: string;
  body?: string;
  items?: string[];
  value?: string;
  delta?: string;
  size?: 'small' | 'medium' | 'large';
  children?: GuardrailBlock[];
};

export type GuardrailNormalized = {
  version: string;
  screen: {
    title: string;
    subtitle: string;
    blocks: GuardrailBlock[];
  };
};

export type GuardrailResult = {
  normalized: GuardrailNormalized;
  repaired: boolean;
  issues: string[];
  repairNotes: string[];
};

type SceneIntent = 'departure' | 'status' | 'focus' | 'brief';

const MAX_BLOCKS = 10;
const MAX_TEXT = 180;
const MAX_ITEM = 120;

function cleanText(value: unknown, max = MAX_TEXT): string {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cloneBlock(block: GuardrailBlock): GuardrailBlock {
  return {
    ...block,
    title: cleanText(block.title, 80),
    label: cleanText(block.label, 80),
    text: cleanText(block.text, MAX_TEXT),
    body: cleanText(block.body, MAX_TEXT),
    value: cleanText(block.value, 80),
    delta: cleanText(block.delta, 80),
    items: Array.isArray(block.items) ? block.items.map((item) => cleanText(item, MAX_ITEM)).filter(Boolean).slice(0, 8) : undefined,
    children: Array.isArray(block.children) ? block.children.map(cloneBlock).slice(0, 6) : undefined
  };
}

function normalizeSizeForType(type: string): 'small' | 'medium' | 'large' {
  if (type === 'metric' || type === 'icon') return 'small';
  if (type === 'row' || type === 'column' || type === 'section' || type === 'image') return 'large';
  if (type === 'card' || type === 'text' || type === 'notes') return 'large';
  return 'medium';
}

function hasListWithTitle(blocks: GuardrailBlock[], hint: RegExp): boolean {
  return blocks.some((block) => block.type === 'list' && hint.test(cleanText(block.title || block.label, 80).toLowerCase()));
}

function classifyIntent(prompt: string): SceneIntent {
  const lower = prompt.toLowerCase();
  if (/(leave|departure|before leaving|before i leave|commute)/.test(lower)) return 'departure';
  if (/(status|overview|system|health|dashboard|incident)/.test(lower)) return 'status';
  if (/(focus|deep work|priorities|plan)/.test(lower)) return 'focus';
  return 'brief';
}

function defaultPriorities(intent: SceneIntent): string[] {
  if (intent === 'departure') return ['Confirm departure time and route buffer', 'Send one critical update', 'Clear one blocker before leaving'];
  if (intent === 'status') return ['Review health and active incidents', 'Check failed runs and retries', 'Confirm next operator action'];
  if (intent === 'focus') return ['Pick one must-do outcome', 'Remove one non-essential task', 'Start a 25-minute focus block'];
  return ['Identify top 3 outcomes for today', 'Address the highest-risk item', 'Commit a concrete next step'];
}

function defaultTimeline(intent: SceneIntent): string[] {
  if (intent === 'departure') return ['Now: quick readiness check', 'Soon: finalize handoff and depart', 'Later: follow-up on pending items'];
  if (intent === 'status') return ['Now: health snapshot', 'Soon: resolve highest-impact issue', 'Later: verify recovery and document'];
  return ['Now: choose immediate next step', 'Soon: execute focused work', 'Later: review outcomes and adjust'];
}

function defaultAlerts(intent: SceneIntent): string[] {
  if (intent === 'status') return ['No critical incidents reported', 'Monitor warning-level signals', 'Escalate only if impact increases'];
  if (intent === 'departure') return ['Watch for schedule slips before departure', 'Pending approvals may block handoff', 'Travel or weather delays can change timing'];
  return ['No critical alerts reported by current payload'];
}

function validateBlocks(blocks: GuardrailBlock[]): string[] {
  const issues: string[] = [];
  if (!blocks.length) issues.push('screen.blocks is empty');

  blocks.forEach((block, idx) => {
    if (!block.type) issues.push(`block[${idx}] missing type`);
    if (block.type === 'list' && (!Array.isArray(block.items) || !block.items.length)) issues.push(`block[${idx}] list has no items`);
    if (block.type === 'metric' && !cleanText(block.value)) issues.push(`block[${idx}] metric has no value`);
    if ((block.type === 'text' || block.type === 'card' || block.type === 'notes') && !cleanText(block.text || block.body)) {
      issues.push(`block[${idx}] ${block.type} has no text`);
    }
  });

  if (!hasListWithTitle(blocks, /priorit/)) issues.push('missing priorities list');
  if (!hasListWithTitle(blocks, /timeline|agenda|schedule|next/)) issues.push('missing timeline list');
  if (!hasListWithTitle(blocks, /alert|risk|warning|attention/)) issues.push('missing alerts list');
  if (!blocks.some((block) => block.type === 'metric')) issues.push('missing metric block');
  if (blocks.length > MAX_BLOCKS) issues.push(`too many blocks (${blocks.length})`);

  return issues;
}

function ensureList(blocks: GuardrailBlock[], title: string, items: string[], hint: RegExp, notes: string[]) {
  if (hasListWithTitle(blocks, hint)) return;
  blocks.push({ type: 'list', title, size: 'medium', items });
  notes.push(`added ${title.toLowerCase()} list`);
}

function ensureMetric(blocks: GuardrailBlock[], notes: string[]) {
  if (blocks.some((block) => block.type === 'metric')) return;
  blocks.push({ type: 'metric', title: 'Status', value: 'Nominal', delta: 'Auto-repaired output', size: 'small' });
  notes.push('added default metric');
}

function prioritizeAndTrim(blocks: GuardrailBlock[]): GuardrailBlock[] {
  if (blocks.length <= MAX_BLOCKS) return blocks;

  const picks: GuardrailBlock[] = [];
  const seen = new Set<number>();

  const pickFirst = (predicate: (block: GuardrailBlock) => boolean) => {
    const index = blocks.findIndex((block) => predicate(block));
    if (index >= 0 && !seen.has(index)) {
      picks.push(blocks[index]);
      seen.add(index);
    }
  };

  pickFirst((block) => ['card', 'text', 'notes'].includes(block.type));
  pickFirst((block) => block.type === 'list' && /priorit/i.test(cleanText(block.title || block.label, 80)));
  pickFirst((block) => block.type === 'list' && /timeline|agenda|schedule|next/i.test(cleanText(block.title || block.label, 80)));
  pickFirst((block) => block.type === 'list' && /alert|risk|warning|attention/i.test(cleanText(block.title || block.label, 80)));
  pickFirst((block) => block.type === 'metric');

  for (let i = 0; i < blocks.length && picks.length < MAX_BLOCKS; i += 1) {
    if (seen.has(i)) continue;
    picks.push(blocks[i]);
    seen.add(i);
  }

  return picks.slice(0, MAX_BLOCKS);
}

function ensureSummary(blocks: GuardrailBlock[], prompt: string, notes: string[]) {
  const summary = blocks.find((block) => block.type === 'card' || block.type === 'text' || block.type === 'notes');
  if (summary && cleanText(summary.text || summary.body)) return;
  blocks.unshift({
    type: 'card',
    title: 'Current Focus',
    body: cleanText(prompt, MAX_TEXT) || 'Ambient HUD active. Request a brief or priorities update.',
    size: 'large'
  });
  notes.push('added fallback summary card');
}

function repairBlock(block: GuardrailBlock): GuardrailBlock {
  const repaired = cloneBlock(block);
  const text = cleanText(repaired.text || repaired.body);

  if (!repaired.type) repaired.type = 'card';
  if (!repaired.size) repaired.size = normalizeSizeForType(repaired.type);

  if (repaired.type === 'list' && (!repaired.items || !repaired.items.length)) {
    repaired.items = ['Details unavailable'];
  }

  if (repaired.type === 'metric' && !cleanText(repaired.value)) {
    repaired.value = 'n/a';
  }

  if ((repaired.type === 'text' || repaired.type === 'card' || repaired.type === 'notes') && !text) {
    repaired.text = 'Details unavailable right now.';
  }

  if (Array.isArray(repaired.children) && repaired.children.length) {
    repaired.children = repaired.children.map((child) => repairBlock(child));
  }

  return repaired;
}

export function applyGenerationGuardrails(normalized: GuardrailNormalized, prompt: string): GuardrailResult {
  const intent = classifyIntent(prompt || '');
  const notes: string[] = [];

  const baseBlocks = Array.isArray(normalized?.screen?.blocks)
    ? normalized.screen.blocks.map((block) => repairBlock(block)).slice(0, MAX_BLOCKS)
    : [];

  if (Array.isArray(normalized?.screen?.blocks) && normalized.screen.blocks.length > MAX_BLOCKS) {
    notes.push(`trimmed blocks to ${MAX_BLOCKS}`);
  }

  ensureSummary(baseBlocks, prompt, notes);
  ensureList(baseBlocks, 'Priorities', defaultPriorities(intent), /priorit/i, notes);
  ensureList(baseBlocks, 'Timeline', defaultTimeline(intent), /timeline|agenda|schedule|next/i, notes);
  ensureList(baseBlocks, 'Alerts', defaultAlerts(intent), /alert|risk|warning|attention/i, notes);
  ensureMetric(baseBlocks, notes);

  const repairedBlocks = prioritizeAndTrim(baseBlocks).map((block) => repairBlock(block));
  const repaired: GuardrailNormalized = {
    version: cleanText(normalized?.version || '0.8', 12) || '0.8',
    screen: {
      title: cleanText(normalized?.screen?.title || 'HUD Screen', 80) || 'HUD Screen',
      subtitle: cleanText(normalized?.screen?.subtitle || 'Generated with server guardrails', 140) || 'Generated with server guardrails',
      blocks: repairedBlocks
    }
  };

  const issues = validateBlocks(repaired.screen.blocks);
  return {
    normalized: repaired,
    repaired: notes.length > 0,
    issues,
    repairNotes: notes
  };
}
