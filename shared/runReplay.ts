import type { A2UICompatiblePayload, A2UIRenderState } from './a2ui.js';
import { applyCanonicalMessages, canonicalToCompatiblePayload, createInitialRenderState } from './a2ui.js';
import type { CanonicalRunEvent, CanonicalRunSummary } from './canonicalRunEvent.js';
import { summarizeRun } from './canonicalRunEvent.js';

export type ReplayApproval = {
  eventId: string;
  label: string;
  timestamp: string;
  trusted: boolean;
};

export type ReplayVisibleState = {
  summary: CanonicalRunSummary | null;
  renderState: A2UIRenderState;
  payload: A2UICompatiblePayload | null;
  transcript: string[];
  latestStatus: string;
  latestNarrative: string;
  interrupts: Array<{ eventId: string; reason: string; timestamp: string }>;
  handoffs: Array<{ eventId: string; reason: string; timestamp: string }>;
  approvals: ReplayApproval[];
};

function normalizeSummary(text: unknown): string {
  return String(text || '').trim();
}

function inferApprovalLabel(event: CanonicalRunEvent): string | null {
  const summary = normalizeSummary(event.summary).toLowerCase();
  const interruptReason = normalizeSummary(event.interrupt?.reason).toLowerCase();
  const requiredReason = normalizeSummary(event.inputRequired?.reason).toLowerCase();
  const candidates = [summary, interruptReason, requiredReason].filter(Boolean);
  const matched = candidates.find((value) => /(approval|confirm|payment|submit|delete|auth|login|mfa|takeover)/.test(value));
  if (!matched) return null;
  return normalizeSummary(event.summary) || normalizeSummary(event.inputRequired?.reason) || normalizeSummary(event.interrupt?.reason) || 'Human approval required';
}

export function replayRunEvents(events: CanonicalRunEvent[]): ReplayVisibleState {
  const summary = summarizeRun(events);
  let renderState = createInitialRenderState(summary?.capabilities ? '0.9' : undefined);
  let latestStatus = summary?.latestStatus || 'idle';
  let latestNarrative = '';
  const transcript: string[] = [];
  const interrupts: ReplayVisibleState['interrupts'] = [];
  const handoffs: ReplayVisibleState['handoffs'] = [];
  const approvals: ReplayApproval[] = [];

  for (const event of events) {
    if (event.ui?.messages?.length) {
      renderState = applyCanonicalMessages(event.ui.messages, renderState);
    }

    if (event.kind === 'text_chunk' && event.text) {
      const text = normalizeSummary(event.text);
      if (text) {
        transcript.push(text);
        latestNarrative = text;
      }
    }

    if (event.status) latestStatus = event.status;

    if (event.kind === 'interrupted' && event.interrupt?.reason) {
      interrupts.push({ eventId: event.eventId, reason: event.interrupt.reason, timestamp: event.timestamp });
    }

    if (event.kind === 'handoff_requested' || event.kind === 'input_required') {
      const reason = normalizeSummary(event.inputRequired?.reason) || normalizeSummary(event.summary) || 'Human handoff requested';
      handoffs.push({ eventId: event.eventId, reason, timestamp: event.timestamp });
    }

    const approvalLabel = inferApprovalLabel(event);
    if (approvalLabel) {
      approvals.push({
        eventId: event.eventId,
        label: approvalLabel,
        timestamp: event.timestamp,
        trusted: event.trust === 'trusted'
      });
    }
  }

  return {
    summary,
    renderState,
    payload: renderState.screen ? canonicalToCompatiblePayload({ version: renderState.version, messages: [{ type: 'beginRendering', version: renderState.version }, { type: 'surfaceUpdate', version: renderState.version, screen: renderState.screen }] }) : null,
    transcript,
    latestStatus,
    latestNarrative,
    interrupts,
    handoffs,
    approvals
  };
}
