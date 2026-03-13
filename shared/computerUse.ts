export type HarnessActionType = 'click' | 'type' | 'scroll' | 'wait' | 'screenshot' | 'zoom';

export type HarnessAction = {
  type: HarnessActionType;
  x?: number;
  y?: number;
  text?: string;
  deltaY?: number;
  durationMs?: number;
  zoomLevel?: number;
};

export type HarnessScreenshotRequest = {
  mode: 'current' | 'after_actions';
  purpose?: string;
};

export type ProviderTurn = {
  provider: string;
  toolVersion?: string;
  domain?: string;
  terminal?: boolean;
  turn?: unknown;
};

export type HarnessCapabilities = {
  screenshot: boolean;
  actions: HarnessActionType[];
  maxActionsPerTurn: number;
  optionalActions?: HarnessActionType[];
  toolVersion?: string;
};

export type NegotiatedHarnessCapabilities = HarnessCapabilities & {
  downgradedActions: HarnessActionType[];
  unsupportedActions: HarnessActionType[];
};

export type HarnessSafetyPolicy = {
  allowedDomains: string[];
  allowedActions: HarnessActionType[];
  confirmationActions: HarnessActionType[];
};

export type SafetyDecision = {
  action: HarnessAction;
  decision: 'allow' | 'confirm' | 'block';
  reason: string;
};

export type ActionExecutionRecord = {
  index: number;
  action: HarnessAction;
  mapped?: HarnessAction;
};

export type NormalizedHarnessTurn = {
  provider: string;
  toolVersion?: string;
  domain?: string;
  kind: 'screenshot_request' | 'action_batch' | 'terminal';
  screenshot?: HarnessScreenshotRequest;
  actions: HarnessAction[];
  replay: ActionExecutionRecord[];
  terminal: boolean;
  capabilityNegotiation?: NegotiatedHarnessCapabilities;
  safety: {
    policy: HarnessSafetyPolicy;
    decisions: SafetyDecision[];
    requiresConfirmation: boolean;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function toNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function normalizeActionType(value: unknown): HarnessActionType | null {
  const text = toText(value).toLowerCase();
  if (!text) return null;
  if (text === 'click' || text === 'left_click' || text === 'tap') return 'click';
  if (text === 'type' || text === 'input' || text === 'enter_text') return 'type';
  if (text === 'scroll' || text === 'wheel') return 'scroll';
  if (text === 'wait' || text === 'pause') return 'wait';
  if (text === 'screenshot' || text === 'capture') return 'screenshot';
  if (text === 'zoom' || text === 'pinch') return 'zoom';
  return null;
}

function normalizeAction(value: unknown): HarnessAction | null {
  const record = asRecord(value);
  if (!record) return null;
  const type = normalizeActionType(record.type || record.kind || record.action);
  if (!type) return null;
  return {
    type,
    ...(toNumber(record.x) != null ? { x: toNumber(record.x) } : {}),
    ...(toNumber(record.y) != null ? { y: toNumber(record.y) } : {}),
    ...(toText(record.text) ? { text: toText(record.text).slice(0, 1000) } : {}),
    ...(toNumber(record.deltaY) != null ? { deltaY: toNumber(record.deltaY) } : {}),
    ...(toNumber(record.durationMs) != null ? { durationMs: toNumber(record.durationMs) } : {}),
    ...(toNumber(record.zoomLevel) != null ? { zoomLevel: toNumber(record.zoomLevel) } : {})
  };
}

function detectProviderActions(turn: unknown): HarnessAction[] {
  const record = asRecord(turn);
  if (!record) return [];
  const arrays = [record.actions, record.action_batch, record.steps, record.calls].filter(Array.isArray) as unknown[][];
  for (const arr of arrays) {
    const actions = arr.map(normalizeAction).filter(Boolean) as HarnessAction[];
    if (actions.length) return actions;
  }
  const single = normalizeAction(record);
  return single ? [single] : [];
}

function detectScreenshot(turn: unknown): HarnessScreenshotRequest | undefined {
  const record = asRecord(turn);
  if (!record) return undefined;
  const mode = toText(record.mode || record.phase || record.when).toLowerCase();
  const purpose = toText(record.purpose || record.reason || record.goal);
  if (normalizeActionType(record.type || record.kind || record.action) === 'screenshot') {
    return { mode: mode === 'after_actions' ? 'after_actions' : 'current', ...(purpose ? { purpose } : {}) };
  }
  if (record.screenshot === true || record.capture === true || toText(record.request) === 'screenshot') {
    return { mode: mode === 'after_actions' ? 'after_actions' : 'current', ...(purpose ? { purpose } : {}) };
  }
  return undefined;
}

export function negotiateHarnessCapabilities(requested: HarnessCapabilities, supported: HarnessCapabilities): NegotiatedHarnessCapabilities {
  const requestedActions = Array.isArray(requested.actions) ? requested.actions : [];
  const supportedActions = new Set(Array.isArray(supported.actions) ? supported.actions : []);
  const optionalActions = new Set(Array.isArray(supported.optionalActions) ? supported.optionalActions : []);
  const downgradedActions: HarnessActionType[] = [];
  const unsupportedActions: HarnessActionType[] = [];

  for (const action of requestedActions) {
    if (supportedActions.has(action)) continue;
    if (optionalActions.has(action)) downgradedActions.push(action);
    else unsupportedActions.push(action);
  }

  return {
    screenshot: requested.screenshot && supported.screenshot,
    actions: requestedActions.filter((action) => supportedActions.has(action)),
    maxActionsPerTurn: Math.min(requested.maxActionsPerTurn, supported.maxActionsPerTurn),
    optionalActions: Array.from(optionalActions),
    toolVersion: supported.toolVersion || requested.toolVersion,
    downgradedActions,
    unsupportedActions
  };
}

export function remapCoordinates(args: {
  x: number;
  y: number;
  from: { width: number; height: number };
  to: { width: number; height: number };
}): { x: number; y: number } {
  const scaleX = args.to.width / args.from.width;
  const scaleY = args.to.height / args.from.height;
  return {
    x: Math.round(args.x * scaleX),
    y: Math.round(args.y * scaleY)
  };
}

export function remapActionBatch(actions: HarnessAction[], from: { width: number; height: number }, to: { width: number; height: number }): ActionExecutionRecord[] {
  return actions.map((action, index) => {
    if (action.type !== 'click' || typeof action.x !== 'number' || typeof action.y !== 'number') {
      return { index, action };
    }
    const mapped = remapCoordinates({ x: action.x, y: action.y, from, to });
    return { index, action, mapped: { ...action, ...mapped } };
  });
}

export function evaluateSafety(actions: HarnessAction[], domain: string | undefined, policy: HarnessSafetyPolicy): { decisions: SafetyDecision[]; requiresConfirmation: boolean } {
  const host = toText(domain).toLowerCase();
  const allowedDomains = new Set(policy.allowedDomains.map((entry) => entry.toLowerCase()));
  const allowedActions = new Set(policy.allowedActions);
  const confirmationActions = new Set(policy.confirmationActions);

  const decisions = actions.map((action) => {
    if (host && allowedDomains.size && !allowedDomains.has(host)) {
      return { action, decision: 'block' as const, reason: `Domain ${host} is outside policy` };
    }
    if (!allowedActions.has(action.type)) {
      return { action, decision: 'block' as const, reason: `Action ${action.type} is not allowed` };
    }
    if (confirmationActions.has(action.type)) {
      return { action, decision: 'confirm' as const, reason: `Action ${action.type} requires human confirmation` };
    }
    return { action, decision: 'allow' as const, reason: 'Action allowed by policy' };
  });

  return {
    decisions,
    requiresConfirmation: decisions.some((decision) => decision.decision === 'confirm' || decision.decision === 'block')
  };
}

export function detectTerminalState(turn: unknown): boolean {
  const record = asRecord(turn);
  if (!record) return false;
  if (record.terminal === true || record.done === true || record.completed === true) return true;
  const status = toText(record.status || record.state).toLowerCase();
  return ['completed', 'done', 'finished', 'terminal', 'failed'].includes(status);
}

export function normalizeHarnessTurn(
  input: ProviderTurn,
  options?: {
    requestedCapabilities?: HarnessCapabilities;
    supportedCapabilities?: HarnessCapabilities;
    safetyPolicy?: HarnessSafetyPolicy;
    coordinateSpace?: { from: { width: number; height: number }; to: { width: number; height: number } };
  }
): NormalizedHarnessTurn {
  const requestedCapabilities = options?.requestedCapabilities || {
    screenshot: true,
    actions: ['click', 'type', 'scroll', 'wait', 'screenshot', 'zoom'],
    maxActionsPerTurn: 6,
    toolVersion: input.toolVersion
  };
  const supportedCapabilities = options?.supportedCapabilities || {
    screenshot: true,
    actions: ['click', 'type', 'scroll', 'wait', 'screenshot'],
    optionalActions: ['zoom'],
    maxActionsPerTurn: 6,
    toolVersion: 'clawscreen-harness-v1'
  };
  const safetyPolicy = options?.safetyPolicy || {
    allowedDomains: input.domain ? [input.domain] : [],
    allowedActions: ['click', 'type', 'scroll', 'wait', 'screenshot'],
    confirmationActions: ['click', 'type']
  };

  const actions = detectProviderActions(input.turn);
  const screenshot = detectScreenshot(input.turn);
  const terminal = input.terminal === true || detectTerminalState(input.turn);
  const capabilityNegotiation = negotiateHarnessCapabilities(requestedCapabilities, supportedCapabilities);

  const effectiveActions: HarnessAction[] = actions
    .filter((action) => capabilityNegotiation.actions.includes(action.type) || (action.type === 'zoom' && capabilityNegotiation.downgradedActions.includes('zoom')))
    .slice(0, capabilityNegotiation.maxActionsPerTurn)
    .map((action): HarnessAction => action.type === 'zoom' && capabilityNegotiation.downgradedActions.includes('zoom')
      ? { type: 'scroll', deltaY: -240 }
      : action);

  const replay = options?.coordinateSpace
    ? remapActionBatch(effectiveActions, options.coordinateSpace.from, options.coordinateSpace.to)
    : effectiveActions.map((action, index) => ({ index, action }));

  const safety = evaluateSafety(effectiveActions, input.domain, safetyPolicy);
  const kind = terminal ? 'terminal' : screenshot && !effectiveActions.length ? 'screenshot_request' : 'action_batch';

  return {
    provider: input.provider,
    ...(input.toolVersion ? { toolVersion: input.toolVersion } : {}),
    ...(input.domain ? { domain: input.domain } : {}),
    kind,
    ...(screenshot ? { screenshot } : {}),
    actions: effectiveActions,
    replay,
    terminal,
    capabilityNegotiation,
    safety: {
      policy: safetyPolicy,
      decisions: safety.decisions,
      requiresConfirmation: safety.requiresConfirmation
    }
  };
}
