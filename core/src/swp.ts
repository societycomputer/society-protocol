/**
 * Society Wire Protocol (SWP) v1.0 — State of the Art
 *
 * Every message on the Society network is wrapped in an SWP envelope:
 * - Signed with the sender's Ed25519 key
 * - Includes TTL for expiration
 * - ULID for unique, time-sortable IDs
 * - Replay protection via (from.did, id) dedup
 * - Optional end-to-end encryption
 */

import { ulid } from 'ulid';
import {
    type Identity,
    deepCanonicalJson,
    sign,
    verify,
    publicKeyFromDid,
} from './identity.js';

// ─── Constants ──────────────────────────────────────────────────

export const SWP_VERSION = 'swp/1.0';
export const DEFAULT_TTL_MS = 600_000; // 10 minutes
export const MAX_PAYLOAD_BYTES = 64 * 1024; // 64KB

// ─── Message Types ───────────────────────────────────────────────

export type MessageType =
    // Presence
    | 'presence.heartbeat'
    | 'presence.capabilities_update'
    | 'presence.status_change'
    // Chat
    | 'chat.msg'
    | 'chat.reaction'
    | 'chat.edit'
    | 'chat.delete'
    // CoC Core
    | 'coc.open'
    | 'coc.plan'
    | 'coc.assign'
    | 'coc.submit'
    | 'coc.review'
    | 'coc.merge'
    | 'coc.close'
    | 'coc.handoff'
    | 'coc.feedback'
    | 'coc.cancel'
    // Adapters
    | 'adapter.register'
    | 'adapter.offer'
    | 'adapter.heartbeat'
    | 'adapter.capabilities'
    // Missions
    | 'mission.start'
    | 'mission.pause'
    | 'mission.resume'
    | 'mission.stop'
    | 'mission.checkpoint'
    | 'mission.alert'
    // Capsules
    | 'capsule.publish'
    | 'capsule.import'
    | 'capsule.request'
    // Federation Mesh
    | 'federation.peer.request'
    | 'federation.peer.accept'
    | 'federation.peer.reject'
    | 'federation.peer.revoke'
    | 'federation.bridge.open'
    | 'federation.bridge.close'
    | 'federation.bridge.sync'
    // Persona Vault
    | 'persona.memory.upsert'
    | 'persona.memory.delete'
    | 'persona.edge.upsert'
    | 'persona.claim.upsert'
    | 'persona.claim.revoke'
    | 'persona.zkp.proof'
    | 'persona.preference.update'
    | 'persona.sync.delta'
    | 'persona.sync.ack'
    | 'persona.capability.revoke'
    | 'persona.capability.attenuate'
    // Latent Space Collaboration
    | 'latent.thought'
    | 'latent.architecture'
    | 'latent.query'
    | 'latent.merge'
    // Swarm Controller
    | 'swarm.role.assign'
    | 'swarm.reallocation'
    | 'swarm.window.open'
    | 'swarm.window.close'
    | 'swarm.affinity.update'
    // Chain-of-Thought Streaming
    | 'cot.stream.start'
    | 'cot.stream.token'
    | 'cot.stream.insight'
    | 'cot.stream.question'
    | 'cot.stream.answer'
    | 'cot.stream.branch'
    | 'cot.stream.merge'
    | 'cot.stream.end'
    // Security
    | 'security.key_exchange'
    // Knowledge Exchange
    | 'knowledge.context_sync'
    | 'knowledge.sync'
    // Artifact Transfer
    | 'artifact.offer'
    | 'artifact.request'
    | 'artifact.block'
    // Identity Proofs (Schnorr PoK)
    | 'identity.proof'
    // System
    | 'system.ping'
    | 'system.pong'
    | 'system.error';

// ─── Envelope Structure ─────────────────────────────────────────

export interface SwpSender {
    did: string;
    name: string;
}

export interface SwpEnvelope {
    v: string;
    id: string;
    t: MessageType;
    room: string;
    from: SwpSender;
    ts: number;
    ttl: number;
    body: Record<string, unknown>;
    sig: string;
    // Optional encryption
    enc?: {
        algorithm: 'x25519-xsalsa20-poly1305';
        ephemeral_public_key: string;
        nonce: string;
    };
}

// ─── Body Types ─────────────────────────────────────────────────

export interface PresenceBody {
    status: 'online' | 'busy' | 'running' | 'offline' | 'away';
    caps: string[];
    load?: number; // 0.0 - 1.0
    specialties?: string[];
    adapter_endpoint?: string;
    reputation_score?: number;
    peer_id?: string;
}

export interface CapabilitiesUpdateBody {
    added_caps: string[];
    removed_caps: string[];
    new_specialties?: string[];
}

export interface ChatMsgBody {
    text: string;
    reply_to?: string;
    mentions?: string[];
    attachments?: string[]; // Artifact IDs
    formatting?: 'markdown' | 'plain' | 'html';
    encrypted?: boolean;
}

export interface ChatReactionBody {
    message_id: string;
    emoji: string;
    action: 'add' | 'remove';
}

export interface ChatEditBody {
    message_id: string;
    new_text: string;
    edit_timestamp: number;
}

export interface CocOpenBody {
    chain_id?: string;
    goal: string;
    template_id?: string;
    priority?: 'low' | 'normal' | 'high' | 'critical';
    tags?: string[];
    timeout_ms?: number;
    privacy_level?: 'public' | 'encrypted' | 'private';
}

export interface CocDagNode {
    step_id: string;
    kind: 'task' | 'review' | 'merge' | 'decision' | 'synthesis' | 'verification';
    title: string;
    description?: string;
    depends_on: string[];
    requirements?: StepRequirements;
    timeout_ms?: number;
    retries?: number;
    max_retries?: number;
    artifacts_expected?: string[];
}

export interface StepRequirements {
    capabilities: string[];
    min_reputation?: number;
    max_cost?: number;
    required_providers?: string[];
}

export interface CocPlanBody {
    chain_id: string;
    dag: CocDagNode[];
    planner_version: string;
    plan_metadata?: {
        estimated_tokens?: number;
        confidence?: number;
        reasoning?: string;
        approach?: string;
    };
}

export interface CocAssignBody {
    chain_id: string;
    step_id: string;
    assignee_did: string;
    lease_ms: number;
    lease_type: 'exclusive' | 'shared';
    constraints?: {
        max_cost?: number;
        required_providers?: string[];
        deadline?: number;
    };
}

export interface Artifact {
    artifact_id: string;
    artifact_type: string;
    content_hash: string; // Blake3
    size_bytes: number;
    encoding: 'utf8' | 'base64' | 'binary';
    content?: string; // Inline for small artifacts (< 4KB)
    uri?: string; // Reference for large artifacts
    metadata?: Record<string, unknown>;
    provenance?: string[]; // Parent artifact IDs
}

export interface CocSubmitBody {
    chain_id: string;
    step_id: string;
    status: 'completed' | 'failed' | 'partial' | 'cancelled';
    memo: string;
    artifacts: Artifact[];
    metrics?: {
        tokens_used?: number;
        latency_ms?: number;
        cost?: number;
        retries?: number;
    };
}

export interface CocReviewBody {
    chain_id: string;
    step_id: string;
    decision: 'approved' | 'rejected' | 'needs_revision' | 'escalated';
    notes: string;
    suggestions?: string[];
    approval_weight?: number; // For weighted consensus
    quality_score?: number; // 0.0 - 1.0
}

export interface CocMergeBody {
    chain_id: string;
    summary: string;
    outputs: string[]; // Artifact IDs
    quality_score?: number;
    lessons_learned?: string[];
    metrics?: {
        total_steps: number;
        completed_steps: number;
        failed_steps: number;
        total_latency_ms: number;
        total_cost?: number;
    };
}

export interface CocCloseBody {
    chain_id: string;
    reason: 'completed' | 'cancelled' | 'timeout' | 'failed';
    final_report?: string;
}

export interface CocHandoffBody {
    chain_id: string;
    step_id: string;
    previous_assignee: string;
    new_assignee: string;
    reason: 'timeout' | 'failure' | 'load_balancing' | 'capability_mismatch' | 'agent_offline' | 'worker_offline' | 'worker_overloaded' | 'scheduler_rebalance';
    handoff_count: number;
}

export interface CocFeedbackBody {
    chain_id: string;
    step_id: string;
    feedback_type: 'clarification' | 'additional_request' | 'correction' | 'praise';
    message: string;
    priority: 'low' | 'normal' | 'high' | 'critical';
    from_did: string;
}

export interface CocCancelBody {
    chain_id: string;
    step_id?: string; // If omitted, cancel entire chain
    reason: string;
    cancelled_by: string;
}

export interface AdapterCapabilities {
    specialties?: string[];
    kinds?: string[];
    max_concurrency?: number;
    capabilities?: string[];
    mission_tags?: string[];
    room_id?: string;
}

export interface AdapterProfile {
    adapter_id: string;
    runtime: 'claude-code' | 'nanobot' | 'ollama' | 'openai' | 'custom' | 'docker';
    version: string;
    display_name: string;
    description?: string;
    specialties: string[];
    kinds: string[];
    max_concurrency: number;
    endpoint: string;
    auth_type: 'none' | 'token' | 'mtls';
    pricing?: {
        per_token?: number;
        per_request?: number;
        currency: 'USD';
    };
    capabilities?: string[];
    owner_did?: string;
    room_id?: string;
    peer_id?: string;
    host_id?: string;
    mission_tags?: string[];
}

export interface AdapterRegisterBody {
    profile: AdapterProfile;
}

export interface AdapterOfferBody {
    adapter_id: string;
    available_kinds: string[];
    current_load: number; // 0.0 - 1.0
    estimated_wait_ms: number;
    active_tasks: number;
    worker_did?: string;
    room_id?: string;
}

export interface AdapterHeartbeatBody {
    adapter_id: string;
    active_tasks: number;
    queue_depth: number;
    health: 'healthy' | 'degraded' | 'unhealthy';
    worker_did?: string;
    room_id?: string;
    metrics?: {
        avg_task_duration_ms?: number;
        success_rate?: number;
    };
}

export interface MissionStartBody {
    mission_id: string;
    goal: string;
    template_id?: string;
    cadence_ms: number;
}

export interface MissionPauseBody {
    mission_id: string;
}

export interface MissionResumeBody {
    mission_id: string;
}

export interface MissionStopBody {
    mission_id: string;
    reason?: string;
}

export interface MissionCheckpointBody {
    mission_id: string;
    checkpoint_id: string;
    summary: string;
}

export interface MissionAlertBody {
    mission_id: string;
    level: 'info' | 'warning' | 'critical';
    message: string;
}

export interface CapsulePublishBody {
    capsule_id: string;
    title: string;
    description: string;
    chain_id: string;
    room_id: string;
    tags: string[];
    content_hash: string;
    pointers: {
        ipfs_cid?: string;
        url?: string;
        magnet?: string;
    };
}

export interface CapsuleImportBody {
    capsule_id: string;
    import_mode: 'resume' | 'fork' | 'reference';
}

export interface FederationPeeringPolicyBody {
    allowed_types: string[];
    max_rate: number;
    privacy_mode: 'metadata-only' | 'summary' | 'full';
    allowed_rooms?: string[];
    blocked_rooms?: string[];
}

export interface FederationPeerRequestBody {
    peering_id: string;
    source_federation_id: string;
    source_federation_did: string;
    target_federation_did: string;
    requested_by: string;
    policy: FederationPeeringPolicyBody;
}

export interface FederationPeerAcceptBody {
    peering_id: string;
    accepted_by: string;
    reason?: string;
}

export interface FederationPeerRejectBody {
    peering_id: string;
    rejected_by: string;
    reason?: string;
}

export interface FederationPeerRevokeBody {
    peering_id: string;
    revoked_by: string;
    reason?: string;
}

export interface FederationBridgeOpenBody {
    bridge_id: string;
    peering_id: string;
    local_federation_id: string;
    local_room_id: string;
    remote_room_id: string;
    rules: FederationPeeringPolicyBody;
}

export interface FederationBridgeCloseBody {
    bridge_id: string;
    peering_id: string;
    reason?: string;
}

export interface FederationBridgeSyncBody {
    bridge_id: string;
    peering_id: string;
    source_federation_id: string;
    target_federation_did: string;
    direction: 'in' | 'out';
    cursor?: string;
    envelope: SwpEnvelope;
}

// ─── Validation Result ──────────────────────────────────────────

export interface ValidationResult {
    valid: boolean;
    error?: string;
    code?: 'invalid_version' | 'expired' | 'oversized' | 'invalid_signature' | 'replay_detected';
}

// ─── Chain-of-Thought Streaming Bodies ──────────────────────────

export interface CotStreamStartBody {
    stream_id: string;
    chain_id?: string;
    step_id?: string;
    goal: string;
    model?: string;
    parent_stream_id?: string;  // For branched reasoning
}

export interface CotStreamTokenBody {
    stream_id: string;
    seq: number;               // Sequence number for ordering
    token: string;             // Reasoning token/chunk
    token_type: 'reasoning' | 'observation' | 'hypothesis' | 'conclusion' | 'evidence' | 'critique';
    confidence?: number;       // 0-1
    domain?: string;           // e.g. 'cardiology', 'genetics'
    references?: string[];     // Knowledge card IDs or URLs
}

export interface CotStreamInsightBody {
    stream_id: string;
    insight_id: string;
    title: string;
    content: string;
    insight_type: 'discovery' | 'pattern' | 'contradiction' | 'connection' | 'gap' | 'confirmation';
    confidence: number;
    supporting_evidence: string[];
    related_streams?: string[];
    auto_create_card?: boolean;  // Auto-create knowledge card
}

export interface CotStreamQuestionBody {
    stream_id: string;
    question_id: string;
    question: string;
    question_type: 'clarification' | 'exploration' | 'validation' | 'critique' | 'suggestion';
    context: string;
    target_did?: string;       // Specific agent to answer
    urgency: 'low' | 'normal' | 'high';
}

export interface CotStreamAnswerBody {
    stream_id: string;
    question_id: string;
    answer: string;
    confidence: number;
    references?: string[];
}

export interface CotStreamBranchBody {
    stream_id: string;
    parent_stream_id: string;
    branch_reason: string;
    hypothesis: string;
}

export interface CotStreamMergeBody {
    stream_id: string;
    merged_streams: string[];
    synthesis: string;
    consensus_level: number;    // 0-1, how much the streams agree
}

export interface CotStreamEndBody {
    stream_id: string;
    status: 'completed' | 'paused' | 'abandoned' | 'merged';
    summary: string;
    insights_generated: number;
    tokens_total: number;
    duration_ms: number;
}

// ─── Envelope Creation ──────────────────────────────────────────

export function createEnvelope(
    identity: Identity,
    type: MessageType,
    room: string,
    body: Record<string, unknown>,
    ttl: number = DEFAULT_TTL_MS
): SwpEnvelope {
    // Normalize payload before signing so signature input matches serialized wire payload.
    const normalizedBody = JSON.parse(JSON.stringify(body ?? {})) as Record<string, unknown>;
    const envelope: Omit<SwpEnvelope, 'sig'> = {
        v: SWP_VERSION,
        id: ulid(),
        t: type,
        room,
        from: { did: identity.did, name: identity.displayName },
        ts: Date.now(),
        ttl,
        body: normalizedBody,
    };

    const canonical = deepCanonicalJson(envelope);
    const sig = sign(identity, canonical);

    return { ...envelope, sig };
}

// ─── Replay Protection ───────────────────────────────────────────

export class ReplayCache {
    private cache = new Map<string, number>();
    private maxSize: number;
    private ttlMs: number;
    private cleanupInterval: ReturnType<typeof setInterval>;

    constructor(maxSize: number = 100000, ttlMs: number = 24 * 60 * 60 * 1000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        // Periodic cleanup every 5 minutes
        this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
        // Do not keep the process alive just for cache housekeeping.
        this.cleanupInterval.unref?.();
    }

    private cleanup(): void {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, timestamp] of this.cache) {
            if (now - timestamp > this.ttlMs) {
                this.cache.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`[replay-cache] Cleaned ${cleaned} expired entries`);
        }
    }

    /**
     * Check if message is a replay
     * @returns true if replay detected, false if new message
     */
    check(envelope: SwpEnvelope): boolean {
        const key = `${envelope.from.did}:${envelope.id}`;
        
        if (this.cache.has(key)) {
            return true; // Replay detected
        }

        // Add to cache
        this.cache.set(key, Date.now());

        // Prevent unbounded growth
        if (this.cache.size > this.maxSize) {
            // Remove oldest 10% of entries
            const entries = Array.from(this.cache.entries());
            entries.sort((a, b) => a[1] - b[1]);
            const toRemove = Math.floor(this.maxSize * 0.1);
            for (let i = 0; i < toRemove; i++) {
                this.cache.delete(entries[i][0]);
            }
        }

        return false;
    }

    get size(): number {
        return this.cache.size;
    }

    clear(): void {
        this.cache.clear();
    }
}

// Global replay cache instance
export const globalReplayCache = new ReplayCache();

// ─── Envelope Validation ────────────────────────────────────────

export interface ValidationOptions {
    skipReplayCheck?: boolean;
    replayCache?: ReplayCache;
}

export function validateEnvelope(envelope: SwpEnvelope, options?: ValidationOptions): ValidationResult {
    // 1. Version check
    if (envelope.v !== SWP_VERSION) {
        return {
            valid: false,
            error: `Unsupported version: ${envelope.v}, expected: ${SWP_VERSION}`,
            code: 'invalid_version'
        };
    }

    // 2. TTL check
    const now = Date.now();
    if (now - envelope.ts > envelope.ttl) {
        return {
            valid: false,
            error: 'Envelope expired (TTL exceeded)',
            code: 'expired'
        };
    }

    // 3. Payload size check
    const payloadSize = new TextEncoder().encode(JSON.stringify(envelope)).length;
    if (payloadSize > MAX_PAYLOAD_BYTES) {
        return {
            valid: false,
            error: `Payload too large: ${payloadSize} bytes (max ${MAX_PAYLOAD_BYTES})`,
            code: 'oversized'
        };
    }

    // 4. Signature verification
    try {
        const { sig, ...withoutSig } = envelope;
        const canonical = deepCanonicalJson(withoutSig);
        const publicKey = publicKeyFromDid(envelope.from.did);
        const isValid = verify(publicKey, canonical, sig);
        if (!isValid) {
            return {
                valid: false,
                error: 'Invalid signature',
                code: 'invalid_signature'
            };
        }
    } catch (err) {
        return {
            valid: false,
            error: `Signature verification failed: ${(err as Error).message}`,
            code: 'invalid_signature'
        };
    }

    // 5. Replay protection
    if (!options?.skipReplayCheck) {
        const cache = options?.replayCache || globalReplayCache;
        if (cache.check(envelope)) {
            return {
                valid: false,
                error: 'Replay detected: message already processed',
                code: 'replay_detected'
            };
        }
    }

    return { valid: true };
}

// ─── Serialization ──────────────────────────────────────────────

export function serializeEnvelope(envelope: SwpEnvelope): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(envelope));
}

export function deserializeEnvelope(data: Uint8Array): SwpEnvelope {
    const json = new TextDecoder().decode(data);
    return JSON.parse(json) as SwpEnvelope;
}

// ─── Utility Functions ──────────────────────────────────────────

export function isCocMessage(type: MessageType): boolean {
    return type.startsWith('coc.');
}

export function isPresenceMessage(type: MessageType): boolean {
    return type.startsWith('presence.');
}

export function isAdapterMessage(type: MessageType): boolean {
    return type.startsWith('adapter.');
}

export function isFederationMessage(type: MessageType): boolean {
    return type.startsWith('federation.');
}

export function isPersonaMessage(type: MessageType): boolean {
    return type.startsWith('persona.');
}

export function isMissionMessage(type: MessageType): boolean {
    return type.startsWith('mission.');
}

export function getMessagePriority(type: MessageType): 'high' | 'normal' | 'low' {
    switch (type) {
        case 'coc.handoff':
        case 'coc.cancel':
        case 'federation.peer.revoke':
        case 'federation.bridge.close':
        case 'persona.capability.revoke':
        case 'persona.claim.revoke':
        case 'system.error':
            return 'high';
        case 'chat.msg':
        case 'coc.assign':
        case 'coc.submit':
        case 'federation.peer.request':
        case 'federation.peer.accept':
        case 'federation.peer.reject':
        case 'federation.bridge.open':
        case 'federation.bridge.sync':
        case 'persona.memory.upsert':
        case 'persona.memory.delete':
        case 'persona.edge.upsert':
        case 'persona.claim.upsert':
        case 'persona.zkp.proof':
        case 'persona.preference.update':
        case 'persona.sync.delta':
        case 'persona.sync.ack':
        case 'persona.capability.attenuate':
        case 'mission.start':
        case 'mission.pause':
        case 'mission.resume':
        case 'mission.stop':
        case 'mission.checkpoint':
        case 'mission.alert':
            return 'normal';
        case 'presence.heartbeat':
        case 'adapter.heartbeat':
            return 'low';
        default:
            return 'normal';
    }
}
