import { A2UIBlock } from '../../shared/a2ui';
import { TrustedComponentType, toTrustedComponentType } from '../../shared/trustedComponents';

const RESERVED_KEYS = new Set(['type', 'kind', 'component', 'title', 'label', 'children', 'blocks', 'items', 'content', 'body']);

const asArray = <T>(value: T | T[] | null | undefined): T[] => (Array.isArray(value) ? value : value == null ? [] : [value]);

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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

function renderGenericSection(node: A2UIBlock, typeClass: string): string {
  const title = node.title || node.label || null;
  const children = normalizeChildren(node);
  const details = Object.fromEntries(Object.entries(node).filter(([k]) => !RESERVED_KEYS.has(k)));
  const childHtml = children.map((child) => `<div class="node-child">${renderNode(child)}</div>`).join('');
  const detailsHtml = Object.keys(details).length ? renderKeyValueTable(details) : '';
  return `<section class="generic-block ${typeClass}">${title ? `<h3>${escapeHtml(title)}</h3>` : ''}${childHtml}${detailsHtml}</section>`;
}

type BlockRenderer = (node: A2UIBlock) => string;

export const trustedComponentRegistry: Record<TrustedComponentType, BlockRenderer> = {
  text: (node) => `<p>${escapeHtml(node.text || node.value || node.content || '')}</p>`,
  list: (node) => {
    const items = asArray(node.items || node.values || node.children);
    return `<section class="generic-block"><h3>${escapeHtml(node.title || 'List')}</h3><ul>${items.map((item) => `<li>${renderPrimitive(item)}</li>`).join('')}</ul></section>`;
  },
  metric: (node) => {
    return `<section class="generic-block metric"><h3>${escapeHtml(node.label || node.title || 'Metric')}</h3><p class="metric-value">${renderPrimitive(node.value ?? node.metric ?? node.number)}</p>${node.delta ? `<p class="muted">${escapeHtml(node.delta)}</p>` : ''}</section>`;
  },
  card: (node) => renderGenericSection(node, 'type-card'),
  notes: (node) => renderGenericSection(node, 'type-notes'),
  divider: () => '<hr class="divider" />'
};

function renderUnsupported(node: A2UIBlock): string {
  return renderGenericSection(node, 'type-unsupported');
}

export function renderNode(node: unknown): string {
  if (node == null) return '';
  if (['string', 'number', 'boolean'].includes(typeof node)) return `<p>${escapeHtml(node)}</p>`;

  const block = node as A2UIBlock;
  const rawType = String(block.type || block.kind || block.component || 'unknown').toLowerCase();
  const trustedType = toTrustedComponentType(rawType);
  if (trustedType === 'unknown') return renderUnsupported(block);
  return trustedComponentRegistry[trustedType](block);
}
