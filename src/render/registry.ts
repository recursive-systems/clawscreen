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

function humanizeMessageText(text: string): string {
  const t = String(text || '').trim();
  if (!t) return t;

  if (/source missing:|missing source:|node required|no paired nodes available|fetch failed/i.test(t)) {
    return 'Some live information is unavailable right now.';
  }

  if (/no connected calendar|calendar\/tasks source missing/i.test(t)) {
    return 'Calendar or task data is not connected yet in this environment.';
  }

  return t;
}

function renderPrimitive(value: unknown): string {
  if (value == null) return '<span class="muted">—</span>';
  if (typeof value === 'string') return escapeHtml(humanizeMessageText(value));
  if (['number', 'boolean'].includes(typeof value)) return escapeHtml(value);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const label = obj.label || obj.title || obj.name;
    const detail = obj.text || obj.value || obj.summary || obj.description || obj.body || obj.content;
    if (label && detail) return `${escapeHtml(label)}: ${escapeHtml(detail)}`;
    if (label) return escapeHtml(label);
    if (detail) return escapeHtml(detail);
  }
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

function sanitizeInputValue(value: unknown, maxLength = 200): string {
  return normalizeText(value).slice(0, maxLength);
}

function sanitizeVariant(value: unknown, allowed: string[], fallback: string): string {
  const v = normalizeText(value).toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

function sanitizeActionPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '{}';
  try {
    const cleaned = JSON.stringify(payload, (_key, val) => {
      if (typeof val === 'string') return sanitizeInputValue(val, 200);
      if (typeof val === 'number' || typeof val === 'boolean' || val == null) return val;
      if (Array.isArray(val)) return val.slice(0, 20);
      if (typeof val === 'object') return val;
      return undefined;
    });
    return cleaned || '{}';
  } catch {
    return '{}';
  }
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
    const template = normalizeText(node.template || node.itemTemplate || '');
    const content = items.map((item) => {
      if (template && typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        const rendered = template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key) => escapeHtml(String(obj[key] ?? '')));
        return `<li>${rendered}</li>`;
      }
      return `<li>${renderPrimitive(item)}</li>`;
    }).join('');
    return `<section class="generic-block type-list">${title ? `<h3>${escapeHtml(title)}</h3>` : ''}<ul>${content}</ul></section>`;
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
  },
  choicepicker: (node) => {
    const title = normalizeText(node.title || node.label || 'Choose one');
    const items = asArray(node.items || node.options || node.choices || node.values);
    const selected = sanitizeInputValue(node.selected || node.value || '', 100).toLowerCase();
    const optionsHtml = items.map((item, idx) => {
      const label = typeof item === 'string' ? item : sanitizeInputValue((item as Record<string, unknown>)?.label || (item as Record<string, unknown>)?.title || item, 120);
      const normalized = label.toLowerCase();
      const active = selected && selected === normalized;
      return `<button type="button" class="choice-item${active ? ' is-selected' : ''}" aria-pressed="${active ? 'true' : 'false'}" data-choice-index="${idx}">${escapeHtml(label || `Option ${idx + 1}`)}</button>`;
    }).join('');
    return `<section class="generic-block type-choicepicker">${title ? `<h3>${escapeHtml(title)}</h3>` : ''}<div class="choice-grid">${optionsHtml || '<p class="muted">No options</p>'}</div></section>`;
  },
  datetimeinput: (node) => {
    const title = normalizeText(node.title || node.label || 'Choose date and time');
    const value = sanitizeInputValue(node.value || node.defaultValue || '', 40);
    const min = sanitizeInputValue(node.min || '', 40);
    const max = sanitizeInputValue(node.max || '', 40);
    const hint = normalizeText(node.hint || node.helperText || node.description || '');
    return `<section class="generic-block type-datetime"><h3>${escapeHtml(title)}</h3><input class="ui-input" type="datetime-local" value="${escapeHtml(value)}" ${min ? `min="${escapeHtml(min)}"` : ''} ${max ? `max="${escapeHtml(max)}"` : ''} />${hint ? `<p class="muted">${escapeHtml(hint)}</p>` : ''}</section>`;
  },
  textfield: (node) => {
    const title = normalizeText(node.title || node.label || 'Input');
    const variant = sanitizeVariant(node.variant || node.format, ['short', 'long', 'date-like'], 'short');
    const value = sanitizeInputValue(node.value || node.defaultValue || '', variant === 'long' ? 500 : 160);
    const placeholder = sanitizeInputValue(node.placeholder || '', 120);
    const required = Boolean(node.required);
    const validation = normalizeText(node.validationMessage || node.validation || node.error || '');
    if (variant === 'long') {
      return `<section class="generic-block type-textfield"><h3>${escapeHtml(title)}</h3><textarea class="ui-input" rows="4" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''}>${escapeHtml(value)}</textarea>${validation ? `<p class="muted">${escapeHtml(validation)}</p>` : ''}</section>`;
    }
    const inputType = variant === 'date-like' ? 'date' : 'text';
    return `<section class="generic-block type-textfield"><h3>${escapeHtml(title)}</h3><input class="ui-input" type="${inputType}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''} />${validation ? `<p class="muted">${escapeHtml(validation)}</p>` : ''}</section>`;
  },
  button: (node) => {
    const label = normalizeText(node.label || node.title || node.text || 'Continue');
    const variant = sanitizeVariant(node.variant || node.style, ['primary', 'secondary', 'destructive'], 'primary');
    const loading = Boolean(node.loading);
    const disabled = Boolean(node.disabled) || loading;
    const actionPayload = sanitizeActionPayload(node.action || node.payload || null);
    return `<section class="generic-block type-button"><button type="button" class="ui-button ${variant}" data-action='${escapeHtml(actionPayload)}' ${disabled ? 'disabled' : ''}>${loading ? 'Working…' : escapeHtml(label)}</button></section>`;
  },
  tabs: (node) => {
    const title = normalizeText(node.title || node.label || 'Sections');
    const tabs = asArray(node.items || node.tabs || node.children || node.values);
    const active = sanitizeInputValue(node.active || node.value || '', 100).toLowerCase();
    const pills = tabs.map((item, idx) => {
      const label = typeof item === 'string'
        ? sanitizeInputValue(item, 80)
        : sanitizeInputValue((item as Record<string, unknown>)?.label || (item as Record<string, unknown>)?.title || `Tab ${idx + 1}`, 80);
      const isActive = active ? active === label.toLowerCase() : idx === 0;
      return `<button type="button" class="tab-pill${isActive ? ' is-active' : ''}" aria-pressed="${isActive ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
    }).join('');
    return `<section class="generic-block type-tabs">${title ? `<h3>${escapeHtml(title)}</h3>` : ''}<div class="tab-pills">${pills || '<p class="muted">No tabs</p>'}</div></section>`;
  },
  slider: (node) => {
    const title = normalizeText(node.title || node.label || 'Adjust value');
    const minRaw = Number(node.min ?? 0);
    const maxRaw = Number(node.max ?? 100);
    const min = Number.isFinite(minRaw) ? minRaw : 0;
    const max = Number.isFinite(maxRaw) ? maxRaw : 100;
    const valueRaw = Number(node.value ?? min);
    const value = Number.isFinite(valueRaw) ? Math.min(Math.max(valueRaw, min), max) : min;
    const stepRaw = Number(node.step ?? 1);
    const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : 1;
    return `<section class="generic-block type-slider"><h3>${escapeHtml(title)}</h3><input class="ui-slider" type="range" min="${min}" max="${max}" step="${step}" value="${value}" /><p class="muted">Current value: ${escapeHtml(value)}</p></section>`;
  },
  checkbox: (node) => {
    const label = normalizeText(node.label || node.title || 'Enable');
    const checked = Boolean(node.checked ?? node.value);
    const hint = normalizeText(node.hint || node.helperText || '');
    return `<section class="generic-block type-checkbox"><label class="ui-checkbox"><input type="checkbox" ${checked ? 'checked' : ''} /><span>${escapeHtml(label)}</span></label>${hint ? `<p class="muted">${escapeHtml(hint)}</p>` : ''}</section>`;
  },
  modal: (node) => {
    const title = normalizeText(node.title || node.label || 'Confirmation');
    const body = normalizeText(node.body || node.text || node.content || 'Please review before continuing.');
    const primary = normalizeText(node.primaryLabel || node.confirmLabel || 'Confirm');
    const secondary = normalizeText(node.secondaryLabel || node.cancelLabel || 'Cancel');
    return `<section class="generic-block type-modal"><div class="modal-shell"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p><div class="modal-actions"><button type="button" class="ui-button secondary">${escapeHtml(secondary)}</button><button type="button" class="ui-button primary">${escapeHtml(primary)}</button></div></div></section>`;
  }
};

function renderUnsupported(node: A2UIBlock): string {
  const type = normalizeText(node.type || node.kind || node.component || 'unknown');
  return `<section class="generic-block type-unsupported"><p class="muted">Unsupported component type: ${escapeHtml(type || 'unknown')}</p></section>`;
}

export function renderNode(node: unknown): string {
  if (node == null) return '';
  if (['string', 'number', 'boolean'].includes(typeof node)) return `<p>${renderPrimitive(node)}</p>`;

  const block = node as A2UIBlock;
  const rawType = String(block.type || block.kind || block.component || 'unknown').toLowerCase();
  const trustedType = toTrustedComponentType(rawType);
  if (trustedType === 'unknown') return renderUnsupported(block);
  return trustedComponentRegistry[trustedType](block);
}
