import { A2UIBlock } from '../../shared/a2ui';
import { TrustedComponentType, toTrustedComponentType } from '../../shared/trustedComponents';

const RESERVED_KEYS = new Set([
  'type',
  'kind',
  'component',
  'title',
  'label',
  'children',
  'blocks',
  'items',
  'content',
  'body',
  'text',
  'value',
  'values',
  'metric',
  'number',
  'delta',
  'icon',
  'token',
  'alt',
  'caption',
  'url',
  'src',
  'image',
  'href'
]);

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

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim();
}

function sanitizeUrl(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, '');
  if (/^(javascript|data):/i.test(compact)) return null;

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) {
    try {
      const protocol = new URL(raw).protocol.toLowerCase();
      if (protocol !== 'http:' && protocol !== 'https:') return null;
    } catch {
      return null;
    }
  }

  return raw;
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
  const primaryText = node.text || node.body || node.content || node.value;
  const children = normalizeChildren(node);
  const details = Object.fromEntries(Object.entries(node).filter(([k]) => !RESERVED_KEYS.has(k)));
  const childHtml = children.map((child) => `<div class="node-child">${renderNode(child)}</div>`).join('');
  const bodyHtml = primaryText ? `<p>${renderPrimitive(primaryText)}</p>` : '';
  const detailsHtml = Object.keys(details).length ? renderKeyValueTable(details) : '';
  return `<section class="generic-block ${typeClass}">${title ? `<h3>${escapeHtml(title)}</h3>` : ''}${bodyHtml}${childHtml}${detailsHtml}</section>`;
}

type BlockRenderer = (node: A2UIBlock) => string;

export const trustedComponentRegistry: Record<TrustedComponentType, BlockRenderer> = {
  text: (node) => `<p>${escapeHtml(node.text || node.value || node.content || '')}</p>`,
  list: (node) => {
    const items = asArray(node.items || node.values || node.children);
    const title = node.title || node.label;
    return `<section class="generic-block type-list">${title ? `<h3>${escapeHtml(title)}</h3>` : ''}<ul>${items.map((item) => `<li>${renderPrimitive(item)}</li>`).join('')}</ul></section>`;
  },
  metric: (node) => {
    return `<section class="generic-block metric"><p class="metric-label">${escapeHtml(node.label || node.title || 'Metric')}</p><p class="metric-value">${renderPrimitive(node.value ?? node.metric ?? node.number)}</p>${node.delta ? `<p class="metric-delta">${escapeHtml(node.delta)}</p>` : ''}</section>`;
  },
  card: (node) => renderGenericSection(node, 'type-card'),
  notes: (node) => renderGenericSection(node, 'type-notes'),
  divider: () => '<hr class="divider" />',
  image: (node) => {
    const src = sanitizeUrl(node.src || node.url || node.image || node.href || node.value || node.content);
    if (!src) return `<section class="generic-block type-image"><p class="muted">Image unavailable</p></section>`;

    const alt = normalizeText(node.alt || node.label || node.title);
    const caption = normalizeText(node.caption || node.text || node.body);
    return `<figure class="generic-block type-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer" />${caption ? `<figcaption class="muted">${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
  },
  icon: (node) => {
    const token = normalizeText(node.icon || node.token || node.value || node.text || node.label || node.title) || 'icon';
    return `<section class="generic-block type-icon"><p><span class="chip">${escapeHtml(token)}</span></p></section>`;
  },
  row: (node) => {
    const children = normalizeChildren(node);
    const childHtml = children.map((child) => `<div class="node-child">${renderNode(child)}</div>`).join('');
    return `<section class="generic-block type-row">${childHtml}</section>`;
  },
  column: (node) => {
    const children = normalizeChildren(node);
    const childHtml = children.map((child) => `<div class="node-child">${renderNode(child)}</div>`).join('');
    return `<section class="generic-block type-column">${childHtml}</section>`;
  },
  section: (node) => {
    const title = node.title || node.label || null;
    const body = normalizeText(node.body || node.text || node.content || node.value);
    const children = normalizeChildren(node);
    const childHtml = children.map((child) => `<div class="node-child">${renderNode(child)}</div>`).join('');
    return `<section class="generic-block type-section">${title ? `<h3>${escapeHtml(title)}</h3>` : ''}${body ? `<p>${escapeHtml(body)}</p>` : ''}${childHtml}</section>`;
  }
};

function renderUnsupported(node: A2UIBlock): string {
  const type = normalizeText(node.type || node.kind || node.component || 'unknown');
  return `<section class="generic-block type-unsupported"><p class="muted">Unsupported component type: ${escapeHtml(type || 'unknown')}</p></section>`;
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
