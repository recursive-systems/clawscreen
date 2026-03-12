import type { A2UIBlock, A2UICanonicalEnvelope, A2UICanonicalMessage, A2UIScreen } from '../shared/a2ui.js';
import type { AuthorityApprovalState, AuthorityMetadata, CanonicalRunCapabilities, CanonicalRunEvent, RunEventSource } from '../shared/canonicalRunEvent.js';
import { createCanonicalRunEvent } from '../shared/canonicalRunEvent.js';

type RunAuthorityState = {
  runId: string;
  capabilitySnapshot?: CanonicalRunCapabilities;
  ownersBySurface: Map<string, string>;
};

function cloneBlock(block: A2UIBlock): A2UIBlock {
  return JSON.parse(JSON.stringify(block)) as A2UIBlock;
}

function ownerTypeFromSource(source: RunEventSource): AuthorityMetadata['ownerType'] {
  if (source.origin === 'user') return 'user';
  if (source.origin === 'agent') return 'agent';
  if (source.origin === 'system') return 'system';
  if (source.origin === 'remote') return 'remote';
  return 'unknown';
}

function deriveOwnerId(event: CanonicalRunEvent): string {
  const sessionId = typeof event.provenance?.session_id === 'string' ? event.provenance.session_id.trim() : '';
  const parentTaskId = typeof event.provenance?.parent_task_id === 'string' ? event.provenance.parent_task_id.trim() : '';
  const tool = typeof event.provenance?.tool === 'string' ? event.provenance.tool.trim() : '';
  const sourceTool = typeof event.source.tool === 'string' ? event.source.tool.trim() : '';
  const label = typeof event.source.label === 'string' ? event.source.label.trim() : '';
  return sessionId || parentTaskId || tool || sourceTool || label || 'unknown-owner';
}

function deriveSourceKind(event: CanonicalRunEvent): string {
  if (event.source.channel === 'generate') return 'declarative_ui';
  if (event.source.channel === 'action') return event.ui ? 'action_artifact' : 'action_control';
  if (event.source.channel === 'gateway') return 'gateway';
  if (event.source.channel === 'client') return 'client';
  return 'system';
}

function deriveApprovalState(event: CanonicalRunEvent): AuthorityApprovalState {
  if (event.kind === 'input_required') return 'required';
  if (event.kind === 'text_chunk' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) {
    const payload = event.payload as Record<string, unknown>;
    const decision = typeof payload.confirmationDecision === 'string' ? payload.confirmationDecision : '';
    if (decision === 'approved') return 'approved';
    if (decision === 'declined') return 'declined';
    if (decision === 'paused') return 'paused';
  }
  return 'not_required';
}

function withAuthority(event: CanonicalRunEvent, state: RunAuthorityState, extra: Partial<AuthorityMetadata> = {}): CanonicalRunEvent {
  const surfaceId = event.surfaceId || extra.surfaceId;
  return {
    ...event,
    authority: {
      ownerId: deriveOwnerId(event),
      ownerType: ownerTypeFromSource(event.source),
      sourceKind: deriveSourceKind(event),
      trustLevel: event.trust,
      approvalState: deriveApprovalState(event),
      capabilitySnapshot: state.capabilitySnapshot,
      ...(surfaceId ? { surfaceId } : {}),
      ...extra
    }
  };
}

function collectUnsupportedFromBlocks(blocks: A2UIBlock[], allowed: Set<string>, downgraded: Set<string>): A2UIBlock[] {
  return blocks.map((block) => {
    const next = cloneBlock(block);
    const type = String(next.type || 'card').trim().toLowerCase();

    if (!allowed.has(type) && type !== 'row' && type !== 'column' && type !== 'section') {
      downgraded.add(type || 'unknown');
      return {
        type: 'card',
        title: typeof next.title === 'string' && next.title.trim() ? next.title : 'Downgraded component',
        body: typeof next.text === 'string' && next.text.trim()
          ? next.text
          : typeof next.body === 'string' && next.body.trim()
            ? next.body
            : `Unsupported component "${type || 'unknown'}" was downgraded to a safe card.`
      } satisfies A2UIBlock;
    }

    const nested = Array.isArray(next.children)
      ? next.children.filter((child) => !!child && typeof child === 'object' && !Array.isArray(child)) as A2UIBlock[]
      : null;
    if (nested?.length) next.children = collectUnsupportedFromBlocks(nested, allowed, downgraded) as unknown as typeof next.children;
    return next;
  });
}

function downgradeEnvelopeForCapabilities(envelope: A2UICanonicalEnvelope, capabilities?: CanonicalRunCapabilities): { envelope: A2UICanonicalEnvelope; downgraded: string[] } {
  if (!capabilities?.components?.length) return { envelope, downgraded: [] };
  const allowed = new Set(capabilities.components.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean));
  const downgraded = new Set<string>();

  const messages = envelope.messages.map((message): A2UICanonicalMessage => {
    if (message.type !== 'surfaceUpdate') return message;
    const screen: A2UIScreen = {
      ...message.screen,
      ...(Array.isArray(message.screen.blocks)
        ? { blocks: collectUnsupportedFromBlocks(message.screen.blocks, allowed, downgraded) }
        : {}),
      ...(Array.isArray(message.screen.children)
        ? { children: collectUnsupportedFromBlocks(message.screen.children, allowed, downgraded) }
        : {})
    };
    return { ...message, screen };
  });

  return {
    envelope: { ...envelope, messages },
    downgraded: Array.from(downgraded)
  };
}

export function createRunAuthorityStore() {
  const stateByRun = new Map<string, RunAuthorityState>();

  const ensureState = (runId: string): RunAuthorityState => {
    const existing = stateByRun.get(runId);
    if (existing) return existing;
    const created: RunAuthorityState = { runId, ownersBySurface: new Map<string, string>() };
    stateByRun.set(runId, created);
    return created;
  };

  const applyEvent = (runId: string, event: CanonicalRunEvent): CanonicalRunEvent[] => {
    const state = ensureState(runId);
    if (event.capabilities) state.capabilitySnapshot = event.capabilities;

    const output: CanonicalRunEvent[] = [];
    const actorId = deriveOwnerId(event);

    if (event.kind === 'ui_delta' && event.ui) {
      const surfaceId = event.surfaceId || 'primary';
      const currentOwner = state.ownersBySurface.get(surfaceId);

      if (!currentOwner) {
        state.ownersBySurface.set(surfaceId, actorId);
        output.push(withAuthority(createCanonicalRunEvent({
          runId,
          timestamp: event.timestamp,
          kind: 'authority_transfer',
          trust: event.trust,
          source: event.source,
          summary: `Surface ${surfaceId} ownership assigned to ${actorId}`,
          status: event.status,
          surfaceId,
          provenance: event.provenance,
          payload: { surfaceId, from: null, to: actorId }
        }), state, { decision: 'transferred', reason: 'initial surface claim', surfaceId }));
      } else if (currentOwner !== actorId) {
        output.push(withAuthority(createCanonicalRunEvent({
          runId,
          timestamp: event.timestamp,
          kind: 'errored',
          trust: event.trust,
          source: event.source,
          summary: `Unauthorized surface mutation rejected for ${surfaceId}`,
          status: 'errored',
          surfaceId,
          provenance: event.provenance,
          error: { code: 'surface_authority_violation', message: `Surface ${surfaceId} is owned by ${currentOwner}; ${actorId} is not allowed to mutate it.` },
          payload: { surfaceId, ownerId: currentOwner, actorId }
        }), state, { decision: 'rejected', reason: 'surface owner mismatch', surfaceId }));
        return output;
      }

      const downgraded = downgradeEnvelopeForCapabilities(event.ui, state.capabilitySnapshot || event.capabilities);
      if (downgraded.downgraded.length) {
        output.push(withAuthority(createCanonicalRunEvent({
          runId,
          timestamp: event.timestamp,
          kind: 'downgrade',
          trust: event.trust,
          source: event.source,
          summary: `Downgraded unsupported components for ${surfaceId}: ${downgraded.downgraded.join(', ')}`,
          status: event.status,
          surfaceId,
          provenance: event.provenance,
          payload: { surfaceId, unsupportedComponents: downgraded.downgraded }
        }), state, { decision: 'downgraded', reason: 'capability mismatch', surfaceId }));
      }

      output.push(withAuthority({ ...event, ui: downgraded.envelope }, state, { decision: downgraded.downgraded.length ? 'downgraded' : 'accepted', surfaceId }));
      return output;
    }

    if (event.kind === 'completed' && event.source.channel === 'action') {
      output.push(withAuthority(createCanonicalRunEvent({
        runId,
        timestamp: event.timestamp,
        kind: 'action_executed',
        trust: event.trust,
        source: event.source,
        summary: event.summary || 'Action execution recorded',
        status: event.status,
        provenance: event.provenance,
        payload: { terminalStatus: event.status }
      }), state, { decision: 'accepted', reason: 'executed action result recorded' }));
    }

    output.push(withAuthority(event, state, { decision: 'accepted' }));
    return output;
  };

  return { applyEvent };
}
