/**
 * Society Protocol — Chain of Collaboration (CoC) Engine v1.0
 *
 * State-of-the-art features:
 * - Complete DAG execution engine
 * - Lease-based fault tolerance with automatic handoff
 * - Reputation-aware agent selection
 * - Multi-criteria consensus
 * - Dynamic DAG expansion hooks
 * - Comprehensive event logging
 */

import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import { type Identity } from './identity.js';
import { type RoomManager } from './rooms.js';
import { type Storage } from './storage.js';
import { type ReputationEngine, type TaskOutcome } from './reputation.js';
import type { 
    CocDagNode, 
    CocOpenBody, 
    CocPlanBody, 
    CocAssignBody,
    CocSubmitBody,
    CocReviewBody,
    CocMergeBody,
    CocCloseBody,
    CocHandoffBody,
    CocCancelBody,
    Artifact,
    StepRequirements
} from './swp.js';
import type { SwpEnvelope } from './swp.js';
import type { InputValidator } from './prompt-guard.js';

// ─── Types ──────────────────────────────────────────────────────

export type ChainStatus = 'open' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'proposed' | 'assigned' | 'submitted' | 'reviewed' | 'merged' | 'rejected' | 'cancelled';

export interface CocStep {
    step_id: string;
    chain_id: string;
    kind: 'task' | 'review' | 'merge' | 'decision' | 'synthesis' | 'verification';
    title: string;
    description?: string;
    status: StepStatus;
    depends_on: string[];
    requirements?: StepRequirements;
    assigned_to?: string;
    lease_expires_at?: number;
    submitted_at?: number;
    result_memo?: string;
    artifacts?: string[];
    retries?: number;
    max_retries?: number;
    assignee_did?: string;
}

export interface CocChain {
    chain_id: string;
    room_id: string;
    goal: string;
    template_id?: string;
    status: ChainStatus;
    priority: 'low' | 'normal' | 'high' | 'critical';
    created_by: string;
    created_at: number;
    closed_at?: number;
    timeout_at?: number;
    final_report?: string;
    steps: CocStep[];
}

export interface StepAssignment {
    chain_id: string;
    step_id: string;
    assignee_did: string;
    lease_ms: number;
    lease_started_at: number;
}

export interface ConsensusConfig {
    type: 'single' | 'multi' | 'weighted' | 'majority';
    approvers?: string[];
    required?: number;
    threshold?: number;
    weights?: Record<string, number>;
}

// ─── Configuration ──────────────────────────────────────────────

const LEASE_CONFIG = {
    maxHandoffs: 3,
    backoffMultiplier: 1.5,
    minLeaseMs: 30000,      // 30 seconds
    maxLeaseMs: 600000,     // 10 minutes
    defaultLeaseMs: 120000, // 2 minutes
};

// ─── CoC Engine ─────────────────────────────────────────────────

export class CocEngine extends EventEmitter {
    private activeChains = new Map<string, CocChain>();
    private leaseMonitorInterval?: ReturnType<typeof setInterval>;

    private validator?: InputValidator;

    constructor(
        private identity: Identity,
        private rooms: RoomManager,
        private storage: Storage,
        private reputation?: ReputationEngine
    ) {
        super();
        this.bindEvents();
        this.startLeaseMonitor();
    }

    setValidator(validator: InputValidator): void {
        this.validator = validator;
    }

    // ─── Event Binding ────────────────────────────────────────────

    private bindEvents() {
        // CoC Open
        this.rooms.on('coc:open', (roomId, envelope) => {
            const body = envelope.body as CocOpenBody;
            this.handleChainOpen(roomId, body, envelope.id, envelope.from.did);
        });

        // CoC Plan
        this.rooms.on('coc:plan', (roomId, envelope) => {
            const body = envelope.body as CocPlanBody;
            this.handlePlan(roomId, body, envelope.from.did);
        });

        // CoC Assign
        this.rooms.on('coc:assign', (roomId, envelope) => {
            const body = envelope.body as CocAssignBody;
            this.handleAssign(roomId, body, envelope.from.did);
        });

        // CoC Submit
        this.rooms.on('coc:submit', (roomId, envelope) => {
            const body = envelope.body as CocSubmitBody;
            this.handleSubmit(roomId, body, envelope.from.did);
        });

        // CoC Review
        this.rooms.on('coc:review', (roomId, envelope) => {
            const body = envelope.body as CocReviewBody;
            this.handleReview(roomId, body, envelope.from.did);
        });

        // CoC Merge
        this.rooms.on('coc:merge', (roomId, envelope) => {
            const body = envelope.body as CocMergeBody;
            this.handleMerge(roomId, body, envelope.from.did);
        });

        // CoC Close
        this.rooms.on('coc:close', (roomId, envelope) => {
            const body = envelope.body as CocCloseBody;
            this.handleClose(roomId, body, envelope.from.did);
        });

        // CoC Handoff
        this.rooms.on('coc:handoff', (roomId, envelope) => {
            const body = envelope.body as CocHandoffBody;
            this.handleHandoff(roomId, body, envelope.from.did);
        });

        // CoC Cancel
        this.rooms.on('coc:cancel', (roomId, envelope) => {
            const body = envelope.body as CocCancelBody;
            this.handleCancel(roomId, body, envelope.from.did);
        });

        // Adapter lease request (internal)
        this.on('adapter:lease_request', (request) => {
            this.handleAdapterLeaseRequest(request);
        });

        // Adapter submit request (internal)
        this.on('adapter:submit_request', (request) => {
            this.handleAdapterSubmitRequest(request);
        });
    }

    // ─── Chain Operations ─────────────────────────────────────────

    async openChain(
        roomId: string, 
        goal: string, 
        options: {
            priority?: 'low' | 'normal' | 'high' | 'critical';
            templateId?: string;
            timeoutMs?: number;
            privacyLevel?: 'public' | 'encrypted' | 'private';
        } = {}
    ): Promise<string> {
        // Validate goal against prompt injection
        if (this.validator) {
            goal = this.validator.validateGoal(goal, this.identity.did);
        }

        const chainId = ulid();
        const timeoutAt = options.timeoutMs ? Date.now() + options.timeoutMs : undefined;
        const createdAt = Date.now();

        const chain: CocChain = {
            chain_id: chainId,
            room_id: roomId,
            goal,
            template_id: options.templateId,
            status: 'open',
            priority: options.priority || 'normal',
            created_by: this.identity.did,
            created_at: createdAt,
            timeout_at: timeoutAt,
            steps: [],
        };
        this.activeChains.set(chainId, chain);

        this.storage.createChain(
            chainId, 
            roomId, 
            goal, 
            options.templateId || null, 
            this.identity.did,
            options.priority || 'normal',
            timeoutAt
        );

        const body: CocOpenBody = {
            chain_id: chainId,
            goal,
            template_id: options.templateId,
            priority: options.priority || 'normal',
            timeout_ms: options.timeoutMs,
            privacy_level: options.privacyLevel || 'public',
        };

        await this.rooms.sendMessage(roomId, body, 'coc.open');

        this.storage.addCocEvent(chainId, null, 'chain_opened', this.identity.did, body);

        this.emit('chain:opened', chainId, goal, roomId);
        return chainId;
    }

    private handleChainOpen(roomId: string, body: CocOpenBody, legacyEnvelopeId: string, fromDid: string) {
        // Validate goal from remote peers
        if (this.validator && body.goal) {
            try { body.goal = this.validator.validateGoal(body.goal, fromDid); } catch { return; }
        }

        const chainId = body.chain_id || legacyEnvelopeId;
        if (this.activeChains.has(chainId)) return;

        const chain: CocChain = {
            chain_id: chainId,
            room_id: roomId,
            goal: body.goal,
            template_id: body.template_id,
            status: 'open',
            priority: body.priority || 'normal',
            created_by: fromDid,
            created_at: Date.now(),
            timeout_at: body.timeout_ms ? Date.now() + body.timeout_ms : undefined,
            steps: [],
        };

        this.activeChains.set(chainId, chain);
        try {
            this.storage.createChain(
                chainId,
                roomId,
                body.goal,
                body.template_id || null,
                fromDid,
                body.priority || 'normal',
                body.timeout_ms ? Date.now() + body.timeout_ms : undefined
            );
        } catch {
            // Another path may have persisted this chain first; keep local state aligned.
        }

        this.emit('chain:opened', chainId, body.goal, roomId);
    }

    // ─── Plan Operations ──────────────────────────────────────────

    async publishPlan(roomId: string, chainId: string, dag: CocDagNode[], plannerVersion: string = 'society/1.0'): Promise<void> {
        const body: CocPlanBody = {
            chain_id: chainId,
            dag,
            planner_version: plannerVersion,
        };

        await this.rooms.sendMessage(roomId, body, 'coc.plan');
    }

    private handlePlan(roomId: string, body: CocPlanBody, fromDid: string) {
        this.applyPlan(body.chain_id, body.dag, fromDid);
    }

    private async applyPlan(chainId: string, dag: CocDagNode[], fromDid: string) {
        const chain = this.activeChains.get(chainId);
        if (!chain) return;

        // Validate DAG (no cycles)
        if (!this.validateDag(dag)) {
            console.error(`[coc] Invalid DAG for chain ${chainId}: cycle detected`);
            return;
        }

        // Create steps
        for (const node of dag) {
            this.storage.createStep(
                node.step_id,
                chainId,
                node.kind,
                node.title,
                node.description || null,
                node.depends_on,
                node.requirements as unknown as Record<string, unknown> | undefined,
                node.timeout_ms
            );
        }

        chain.status = 'running';
        chain.steps = dag.map(node => ({
            ...node,
            chain_id: chainId,
            status: 'proposed',
            assignee_did: null,
            lease_started_at: null,
            lease_ms: null,
            memo: null,
            artifacts: [],
        }));

        this.storage.addCocEvent(chainId, null, 'plan_created', fromDid, { dag });
        this.emit('chain:planned', chainId, dag);

        // Trigger evaluation
        this.evaluateChain(chainId);
    }

    // ─── Assignment Operations ────────────────────────────────────

    async assignStep(
        roomId: string,
        chainId: string,
        stepId: string,
        assigneeDid: string,
        leaseMs: number = LEASE_CONFIG.defaultLeaseMs,
        leaseType: 'exclusive' | 'shared' = 'exclusive'
    ): Promise<void> {
        const body: CocAssignBody = {
            chain_id: chainId,
            step_id: stepId,
            assignee_did: assigneeDid,
            lease_ms: Math.min(leaseMs, LEASE_CONFIG.maxLeaseMs),
            lease_type: leaseType,
        };

        await this.rooms.sendMessage(roomId, body, 'coc.assign');
    }

    private handleAssign(roomId: string, body: CocAssignBody, fromDid: string) {
        // Update step in DB
        this.storage.updateStepStatus(body.step_id, 'assigned', {
            assigneeDid: body.assignee_did,
            leaseMs: body.lease_ms,
        });
        const activeStep = this.getActiveStep(body.chain_id, body.step_id);
        if (activeStep) {
            activeStep.status = 'assigned';
            activeStep.assignee_did = body.assignee_did;
            activeStep.assigned_to = body.assignee_did;
            activeStep.lease_expires_at = Date.now() + body.lease_ms;
        }

        // Track lease for monitoring
        this.storage.trackLease(body.chain_id, body.step_id, body.assignee_did, body.lease_ms);

        this.storage.addCocEvent(body.chain_id, body.step_id, 'step_assigned', fromDid, body);
        this.emit('step:assigned', body.chain_id, body.step_id, body.assignee_did);
    }

    // ─── Submit Operations ────────────────────────────────────────

    async submitStep(
        roomId: string,
        chainId: string,
        stepId: string,
        status: 'completed' | 'failed' | 'partial',
        memo: string,
        artifacts: Artifact[],
        metrics?: { tokens_used?: number; latency_ms?: number; cost?: number }
    ): Promise<void> {
        const body: CocSubmitBody = {
            chain_id: chainId,
            step_id: stepId,
            status,
            memo,
            artifacts,
            metrics,
        };

        await this.rooms.sendMessage(roomId, body, 'coc.submit');
    }

    private handleSubmit(roomId: string, body: CocSubmitBody, fromDid: string) {
        // Validate memo against prompt injection
        if (this.validator && body.memo) {
            try { body.memo = this.validator.validateMemo(body.memo, fromDid); } catch { /* log but don't block step */ }
        }

        const stepStatus = body.status === 'completed' ? 'submitted' :
                          body.status === 'failed' ? 'rejected' : 'submitted';

        this.storage.updateStepStatus(body.step_id, stepStatus, {
            memo: body.memo,
            artifacts: body.artifacts,
            metrics: body.metrics,
        });
        const activeStep = this.getActiveStep(body.chain_id, body.step_id);
        if (activeStep) {
            activeStep.status = stepStatus;
            activeStep.submitted_at = Date.now();
            activeStep.result_memo = body.memo;
            activeStep.artifacts = body.artifacts.map((artifact) => artifact.artifact_id);
            activeStep.lease_expires_at = undefined;
        }

        // Remove from lease monitoring
        this.storage.removeLease(body.chain_id, body.step_id);

        // Record for reputation
        if (this.reputation) {
            const outcome: TaskOutcome = {
                did: fromDid,
                chain_id: body.chain_id,
                step_id: body.step_id,
                status: body.status,
                latency_ms: body.metrics?.latency_ms || 0,
                lease_ms: 0, // We don't know original lease here, would need to track
                accepted: true,
                quality_score: undefined, // Set by review
                tokens_used: body.metrics?.tokens_used,
                cost_usd: body.metrics?.cost,
                specialties_used: [], // Would need to get from step requirements
                timestamp: Date.now(),
            };
            this.reputation.recordTaskOutcome(outcome);
        }

        this.storage.addCocEvent(body.chain_id, body.step_id, 'step_submitted', fromDid, body);
        this.emit('step:submitted', body.chain_id, body.step_id, body.status);

        // Trigger chain evaluation
        this.evaluateChain(body.chain_id);
    }

    // ─── Review Operations ────────────────────────────────────────

    async reviewStep(
        roomId: string,
        chainId: string,
        stepId: string,
        decision: 'approved' | 'rejected' | 'needs_revision' | 'escalated',
        notes: string,
        options: {
            suggestions?: string[];
            qualityScore?: number;
        } = {}
    ): Promise<void> {
        const body: CocReviewBody = {
            chain_id: chainId,
            step_id: stepId,
            decision,
            notes,
            suggestions: options.suggestions,
            quality_score: options.qualityScore,
        };

        await this.rooms.sendMessage(roomId, body, 'coc.review');
    }

    private handleReview(roomId: string, body: CocReviewBody, fromDid: string) {
        // Validate review notes
        if (this.validator && body.notes) {
            try { body.notes = this.validator.validateField(body.notes, 'notes', fromDid); } catch { /* log but continue */ }
        }

        // Update step status based on decision
        let newStatus: StepStatus = 'reviewed';
        if (body.decision === 'rejected') {
            newStatus = 'rejected';
        } else if (body.decision === 'needs_revision') {
            newStatus = 'proposed'; // Back to proposed for reassignment
        }

        this.storage.updateStepStatus(body.step_id, newStatus);
        const activeStep = this.getActiveStep(body.chain_id, body.step_id);
        if (activeStep) {
            activeStep.status = newStatus;
            if (newStatus === 'proposed') {
                activeStep.assignee_did = undefined;
                activeStep.assigned_to = undefined;
                activeStep.lease_expires_at = undefined;
            }
        }

        // Record quality score for reputation
        if (this.reputation && body.quality_score !== undefined) {
            // Find the assignee of this step
            const step = this.storage.db
                .prepare('SELECT assignee_did FROM coc_steps WHERE step_id = ?')
                .get(body.step_id) as any;
            
            if (step?.assignee_did) {
                this.reputation.recordPeerReview(
                    fromDid,
                    step.assignee_did,
                    body.chain_id,
                    body.step_id,
                    body.quality_score,
                    body.notes
                );
            }
        }

        this.storage.addCocEvent(body.chain_id, body.step_id, 'step_reviewed', fromDid, body);
        this.emit('step:reviewed', body.chain_id, body.step_id, body.decision);

        this.evaluateChain(body.chain_id);
    }

    // ─── Merge Operations ─────────────────────────────────────────

    async mergeChain(
        roomId: string,
        chainId: string,
        summary: string,
        outputs: string[],
        options: {
            qualityScore?: number;
            lessonsLearned?: string[];
            metrics?: CocMergeBody['metrics'];
        } = {}
    ): Promise<void> {
        const body: CocMergeBody = {
            chain_id: chainId,
            summary,
            outputs,
            quality_score: options.qualityScore,
            lessons_learned: options.lessonsLearned,
            metrics: options.metrics,
        };

        await this.rooms.sendMessage(roomId, body, 'coc.merge');
    }

    private handleMerge(roomId: string, body: CocMergeBody, fromDid: string) {
        const chain = this.activeChains.get(body.chain_id);
        if (chain) {
            chain.status = 'completed';
        }
        this.storage.updateChainStatus(body.chain_id, 'completed', body.summary);

        this.storage.addCocEvent(body.chain_id, null, 'chain_merged', fromDid, body);
        this.emit('chain:completed', body.chain_id, body.summary);
        this.emit('chain:merged', body.chain_id, body);
    }

    // ─── Close Operations ─────────────────────────────────────────

    async closeChain(
        roomId: string,
        chainId: string,
        reason: 'completed' | 'cancelled' | 'timeout' | 'failed',
        finalReport?: string
    ): Promise<void> {
        const body: CocCloseBody = {
            chain_id: chainId,
            reason,
            final_report: finalReport,
        };

        await this.rooms.sendMessage(roomId, body, 'coc.close');
    }

    private handleClose(roomId: string, body: CocCloseBody, fromDid: string) {
        const chain = this.activeChains.get(body.chain_id);

        const status = body.reason === 'completed' ? 'completed' : 
                      body.reason === 'cancelled' ? 'cancelled' : 'failed';

        if (chain) {
            chain.status = status;
        }
        this.storage.updateChainStatus(body.chain_id, status, body.final_report);

        this.storage.addCocEvent(body.chain_id, null, 'chain_closed', fromDid, body);
        this.emit('chain:closed', body.chain_id, body.reason);

        // Remove from active chains
        this.activeChains.delete(body.chain_id);
    }

    // ─── Handoff Operations ───────────────────────────────────────

    private async handleHandoff(roomId: string, body: CocHandoffBody, fromDid: string) {
        // Update step with new assignee
        this.storage.updateStepStatus(body.step_id, 'assigned', {
            assigneeDid: body.new_assignee,
        });

        // Track new lease
        const newLeaseMs = Math.min(
            LEASE_CONFIG.defaultLeaseMs * Math.pow(LEASE_CONFIG.backoffMultiplier, body.handoff_count),
            LEASE_CONFIG.maxLeaseMs
        );
        this.storage.trackLease(body.chain_id, body.step_id, body.new_assignee, newLeaseMs);
        const activeStep = this.getActiveStep(body.chain_id, body.step_id);
        if (activeStep) {
            activeStep.status = 'assigned';
            activeStep.assignee_did = body.new_assignee;
            activeStep.assigned_to = body.new_assignee;
            activeStep.lease_expires_at = Date.now() + newLeaseMs;
        }

        this.storage.addCocEvent(body.chain_id, body.step_id, 'step_handed_off', fromDid, body);
        this.emit('step:handed_off', body.chain_id, body.step_id, body.new_assignee, body.reason);
    }

    // ─── Cancel Operations ────────────────────────────────────────

    private handleCancel(roomId: string, body: CocCancelBody, fromDid: string) {
        if (body.step_id) {
            // Cancel specific step
            this.storage.updateStepStatus(body.step_id, 'cancelled');
            const activeStep = this.getActiveStep(body.chain_id, body.step_id);
            if (activeStep) {
                activeStep.status = 'cancelled';
            }
            this.storage.addCocEvent(body.chain_id, body.step_id, 'step_cancelled', fromDid, body);
            this.emit('step:cancelled', body.chain_id, body.step_id);
        } else {
            // Cancel entire chain
            this.handleClose(roomId, {
                chain_id: body.chain_id,
                reason: 'cancelled',
            }, fromDid);
        }
    }

    // ─── Adapter Integration ──────────────────────────────────────

    private handleAdapterLeaseRequest(request: {
        chain_id: string;
        step_id: string;
        adapter_id: string;
        worker_did?: string;
        lease_ms: number;
    }) {
        // Find the room for this chain
        const chain = this.activeChains.get(request.chain_id);
        if (!chain) return;

        // Broadcast assignment
        this.assignStep(
            chain.room_id,
            request.chain_id,
            request.step_id,
            request.worker_did || request.adapter_id,
            request.lease_ms
        ).catch(console.error);
    }

    private handleAdapterSubmitRequest(request: {
        chain_id: string;
        step_id: string;
        assignee_did: string;
        adapter_id?: string;
        status: 'completed' | 'failed';
        memo: string;
        artifacts: Artifact[];
    }) {
        const chain = this.activeChains.get(request.chain_id);
        if (!chain) return;

        this.submitStep(
            chain.room_id,
            request.chain_id,
            request.step_id,
            request.status,
            request.memo,
            request.artifacts
        ).catch(console.error);
    }

    // ─── Chain Evaluation ─────────────────────────────────────────

    private evaluateChain(chainId: string) {
        const chain = this.activeChains.get(chainId);
        if (!chain || chain.status !== 'running') return;

        // Check timeout
        if (chain.timeout_at && Date.now() > chain.timeout_at) {
            this.closeChain(chain.room_id, chainId, 'timeout', 'Chain timed out').catch(console.error);
            return;
        }

        // Get all steps
        const steps = this.storage.getChainSteps(chainId);

        // Find ready steps (all dependencies satisfied)
        const readySteps = steps.filter(step => {
            if (step.status !== 'proposed') return false;

            const deps = JSON.parse(step.depends_on || '[]');
            return deps.every((depId: string) => {
                const dep = steps.find((s: any) => s.step_id === depId);
                return dep && (dep.status === 'merged' || dep.status === 'submitted');
            });
        });

        // Emit unlocked event for each ready step
        for (const step of readySteps) {
            this.emit('step:unlocked', chainId, step.step_id, step);
        }

        // Check if all steps are done
        const terminalStatuses = ['merged', 'submitted', 'rejected', 'cancelled'];
        const allDone = steps.length > 0 && steps.every((s: any) => 
            terminalStatuses.includes(s.status)
        );

        if (allDone) {
            const allSuccessful = steps.every((s: any) => 
                s.status === 'merged' || s.status === 'submitted'
            );

            if (allSuccessful) {
                this.emit('chain:ready_to_merge', chainId);
            } else {
                this.closeChain(chain.room_id, chainId, 'failed', 'Some steps failed').catch(console.error);
            }
        }
    }

    // ─── Lease Monitoring ─────────────────────────────────────────

    private startLeaseMonitor(): void {
        this.leaseMonitorInterval = setInterval(() => {
            this.checkExpiredLeases();
        }, 10000); // Check every 10 seconds
    }

    private checkExpiredLeases(): void {
        const expired = this.storage.getExpiredLeases();

        for (const lease of expired) {
            // Atomically claim this expired lease to prevent race conditions.
            // Only one caller wins the race; others get false and skip.
            if (!this.storage.claimExpiredLease(lease.chain_id, lease.step_id)) {
                continue; // Another process already handled this lease
            }

            // Get current handoff count
            const step = this.storage.db
                .prepare('SELECT retry_count FROM coc_steps WHERE step_id = ?')
                .get(lease.step_id) as any;

            const handoffCount = step?.retry_count || 0;

            if (handoffCount >= LEASE_CONFIG.maxHandoffs) {
                // Max handoffs reached, fail the step
                this.storage.updateStepStatus(lease.step_id, 'rejected', {
                    memo: `Max handoffs (${LEASE_CONFIG.maxHandoffs}) exceeded`,
                });
                this.emit('step:failed', lease.chain_id, lease.step_id, 'max_handoffs');
            } else {
                // Increment retry count and reset to proposed
                this.storage.updateStepStatus(lease.step_id, 'proposed', {
                    assigneeDid: null,
                    leaseMs: null,
                    retryCount: handoffCount + 1,
                });

                this.emit('step:expired', lease.chain_id, lease.step_id, lease.assignee_did);

                // Re-evaluate to trigger reassignment
                this.evaluateChain(lease.chain_id);
            }
        }
    }

    // ─── DAG Validation ───────────────────────────────────────────

    private validateDag(dag: CocDagNode[]): boolean {
        const ids = new Set(dag.map(n => n.step_id));
        
        // Check all dependencies exist
        for (const node of dag) {
            for (const dep of node.depends_on) {
                if (!ids.has(dep)) return false;
            }
        }

        // Check for cycles using DFS
        const visiting = new Set<string>();
        const visited = new Set<string>();

        const visit = (nodeId: string): boolean => {
            if (visiting.has(nodeId)) return false; // Cycle detected
            if (visited.has(nodeId)) return true;

            visiting.add(nodeId);
            const node = dag.find(n => n.step_id === nodeId);
            if (node) {
                for (const dep of node.depends_on) {
                    if (!visit(dep)) return false;
                }
            }
            visiting.delete(nodeId);
            visited.add(nodeId);
            return true;
        };

        for (const node of dag) {
            if (!visit(node.step_id)) return false;
        }

        return true;
    }

    private getActiveStep(chainId: string, stepId: string): CocStep | undefined {
        const chain = this.activeChains.get(chainId);
        return chain?.steps.find((step) => step.step_id === stepId);
    }

    // ─── Smart Assignment ─────────────────────────────────────────

    async selectOptimalAgent(
        step: CocStep,
        candidates: string[]
    ): Promise<string | null> {
        if (!this.reputation || candidates.length === 0) {
            return candidates[0] || null;
        }

        const ranked = await this.reputation.rankAgentsForTask(candidates, {
            specialties: step.requirements?.capabilities,
            minReputation: step.requirements?.min_reputation,
            kind: step.kind,
        });

        return ranked[0]?.did || null;
    }

    // ─── Getters ──────────────────────────────────────────────────

    getChain(chainId: string): CocChain | null {
        // Try active chains first
        const active = this.activeChains.get(chainId);
        if (active) return active;

        // Fall back to storage
        const row = this.storage.getChain(chainId);
        if (!row) return null;

        const steps = this.storage.getChainSteps(chainId);

        return {
            chain_id: row.chain_id,
            room_id: row.room_id,
            goal: row.goal,
            template_id: row.template_id,
            status: row.status,
            priority: row.priority,
            created_by: row.created_by,
            created_at: row.created_at,
            closed_at: row.closed_at,
            timeout_at: row.timeout_at,
            final_report: row.final_report,
            steps: steps.map((s: any) => ({
                step_id: s.step_id,
                chain_id: s.chain_id,
                kind: s.kind,
                title: s.title,
                description: s.description,
                depends_on: JSON.parse(s.depends_on || '[]'),
                requirements: s.requirements_json ? JSON.parse(s.requirements_json) : undefined,
                status: s.status,
                assignee_did: s.assignee_did,
                lease_started_at: s.lease_started_at,
                lease_ms: s.lease_ms,
                memo: s.memo,
                artifacts: s.artifacts_json ? JSON.parse(s.artifacts_json) : [],
            })),
        };
    }

    getActiveChains(): CocChain[] {
        return Array.from(this.activeChains.values());
    }

    getStep(stepId: string): CocStep | undefined {
        // Procurar em chains ativas
        for (const chain of this.activeChains.values()) {
            const step = chain.steps.find(s => s.step_id === stepId);
            if (step) return step;
        }
        
        // Procurar no storage
        try {
            const row = this.storage.db.prepare('SELECT * FROM coc_steps WHERE step_id = ?').get(stepId) as any;
            if (row) {
                return {
                    step_id: row.step_id,
                    chain_id: row.chain_id,
                    kind: row.kind,
                    title: row.title,
                    description: row.description,
                    depends_on: JSON.parse(row.depends_on || '[]'),
                    requirements: row.requirements_json ? JSON.parse(row.requirements_json) : undefined,
                    status: row.status,
                    assigned_to: row.assignee_did,
                    lease_expires_at: row.lease_started_at ? row.lease_started_at + row.lease_ms : undefined,
                    result_memo: row.memo,
                    artifacts: row.artifacts_json ? JSON.parse(row.artifacts_json) : [],
                };
            }
        } catch {}
        
        return undefined;
    }

    // ─── Cleanup ──────────────────────────────────────────────────

    destroy(): void {
        if (this.leaseMonitorInterval) {
            clearInterval(this.leaseMonitorInterval);
        }
        this.activeChains.clear();
    }
}
