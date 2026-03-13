/**
 * Society Protocol — JavaScript/TypeScript SDK
 * 
 * SDK oficial para integração com Society Protocol.
 * Facilita a criação de agents e integração em aplicações existentes.
 */

import { EventEmitter } from 'events';
import { generateIdentity, restoreIdentity, type Identity } from '../identity.js';
import { Storage } from '../storage.js';
import { P2PNode } from '../p2p.js';
import { RoomManager } from '../rooms.js';
import { CocEngine, type CocChain } from '../coc.js';
import { ReputationEngine, type ReputationScore } from '../reputation.js';
import { Planner, type PlannerProvider } from '../planner.js';
import { CapsuleExporter } from '../capsules.js';
import { FederationEngine, type FederationPeeringPolicy, type FederationPeeringStatus } from '../federation.js';
import { KnowledgePool } from '../knowledge.js';
import { SkillsEngine } from '../skills/engine.js';
import { SecurityManager } from '../security.js';
import { InputValidator } from '../prompt-guard.js';
import { IntegrationEngine, type MeshBridgeRules } from '../integration.js';
import { listTemplates, type Template } from '../templates.js';
import type { CocDagNode, Artifact, AdapterCapabilities, AdapterHeartbeatBody, AdapterProfile } from '../swp.js';
import { ProactiveMissionEngine } from '../proactive/engine.js';
import type {
    MissionInfo,
    ProactiveMissionSpec,
    ResearchWorkerConfig,
    SwarmStatus,
    SwarmWorkerAnnouncement,
    SwarmWorkerProfile,
} from '../proactive/types.js';
import {
    PersonaVaultEngine,
    type AddMemoryInput,
    type CapabilityCaveats,
    type UpdateMemoryInput,
    type MemoryQueryInput,
    type GraphQueryInput,
    type UpdatePreferenceInput,
    type IssueCapabilityInput,
    type IssueClaimInput,
    type GenerateZkProofInput,
    type VerifyZkProofInput,
    type ZkCircuitId,
    type ZkProofBundle,
    type ExportSubgraphInput,
    type PersonaSyncDelta,
    type PersonaDomain,
} from '../persona/index.js';

// ─── Types ──────────────────────────────────────────────────────

export interface SDKConfig {
    identity?: {
        name: string;
        did?: string;
        privateKeyHex?: string;
    };
    storage?: {
        path?: string;
    };
    network?: {
        bootstrap?: string[];
        port?: number;
        enableGossipsub?: boolean;
        enableDht?: boolean;
        enableMdns?: boolean;
    };
    planner?: {
        provider?: PlannerProvider;
        apiKey?: string;
        enableCache?: boolean;
    };
    proactive?: {
        enableLeadership?: boolean;
        autoRestoreMissions?: boolean;
        leaseTtlMs?: number;
        leaseRenewIntervalMs?: number;
    };
}

export interface SummonOptions {
    goal: string;
    roomId: string;
    template?: string;
    priority?: 'low' | 'normal' | 'high' | 'critical';
    onStep?: (step: StepInfo) => void;
    onComplete?: (chain: ChainInfo) => void;
}

export interface StepInfo {
    id: string;
    chainId: string;
    kind: string;
    title: string;
    status: string;
    assignee?: string;
}

export interface ChainInfo {
    id: string;
    goal: string;
    status: string;
    steps: StepInfo[];
}

export interface PeerInfo {
    did: string;
    name: string;
    status: string;
    reputation?: number;
    specialties?: string[];
}

// ─── SocietyClient ──────────────────────────────────────────────

export class SocietyClient extends EventEmitter {
    private identity!: Identity;
    private storage!: Storage;
    private p2p!: P2PNode;
    private rooms!: RoomManager;
    private coc!: CocEngine;
    private reputation!: ReputationEngine;
    private planner!: Planner;
    private exporter!: CapsuleExporter;
    private federation!: FederationEngine;
    private knowledge!: KnowledgePool;
    private skills!: SkillsEngine;
    private security!: SecurityManager;
    private integration!: IntegrationEngine;
    private persona!: PersonaVaultEngine;
    private proactive!: ProactiveMissionEngine;
    private researchWorker?: { start(): Promise<void>; stop(): Promise<void> };
    private config: SDKConfig;
    private connected = false;

    constructor(config: SDKConfig = {}) {
        super();
        this.config = config;
    }

    // ─── Lifecycle ────────────────────────────────────────────────

    async connect(): Promise<void> {
        if (this.connected) return;

        try {
            // Initialize storage
            this.storage = new Storage(
                this.config.storage?.path
                    ? { dbPath: this.config.storage.path }
                    : undefined
            );

            // Initialize or restore identity
            if (this.config.identity?.did && this.config.identity?.privateKeyHex) {
                this.identity = restoreIdentity(
                    this.config.identity.privateKeyHex,
                    this.config.identity.name
                );
            } else {
                const existing = this.storage.getIdentity();
                if (existing) {
                    this.identity = restoreIdentity(
                        existing.private_key_hex,
                        this.config.identity?.name || existing.display_name
                    );
                } else {
                    this.identity = generateIdentity(
                        this.config.identity?.name || 'Anonymous'
                    );
                    const privHex = Buffer.from(this.identity.privateKey).toString('hex');
                    const pubHex = Buffer.from(this.identity.publicKey).toString('hex');
                    this.storage.saveIdentity(
                        this.identity.did,
                        privHex,
                        pubHex,
                        this.identity.displayName
                    );
                }
            }

            // Initialize reputation
            this.reputation = new ReputationEngine(this.storage);

            // Initialize P2P
            this.p2p = new P2PNode();
            await this.p2p.start({
                port: this.config.network?.port,
                bootstrapAddrs: this.config.network?.bootstrap,
                enableGossipsub: this.config.network?.enableGossipsub ?? true,
                enableDht: this.config.network?.enableDht ?? true,
                enableMdns: this.config.network?.enableMdns ?? true,
            });

            // Initialize rooms
            this.rooms = new RoomManager(this.identity, this.p2p, this.storage);

            // Initialize CoC
            this.coc = new CocEngine(this.identity, this.rooms, this.storage, this.reputation);

            // Initialize federation + integration stack
            this.federation = new FederationEngine(this.storage, this.identity);
            this.knowledge = new KnowledgePool(this.storage, this.identity);
            this.skills = new SkillsEngine(this.storage, this.identity);
            this.security = new SecurityManager(this.identity);
            this.integration = new IntegrationEngine(
                this.storage,
                this.identity,
                this.federation,
                this.rooms,
                this.knowledge,
                this.coc,
                this.skills,
                this.security
            );
            this.persona = new PersonaVaultEngine(this.storage, this.identity.did, {
                defaultVaultName: `${this.identity.displayName} Persona Vault`,
            });
            this.integration.attachPersonaVault(this.persona);

            // Initialize planner
            this.planner = new Planner({
                provider: this.config.planner?.provider,
                apiKey: this.config.planner?.apiKey,
                enableCache: this.config.planner?.enableCache ?? true,
            });

            // Initialize exporter
            this.exporter = new CapsuleExporter(this.coc, this.storage);
            this.proactive = new ProactiveMissionEngine(
                this.identity,
                this.storage,
                this.rooms,
                this.coc,
                this.planner,
                this.knowledge,
                undefined,
                undefined,
                {
                    enableLeadership: this.config.proactive?.enableLeadership ?? false,
                    autoRestoreMissions: this.config.proactive?.autoRestoreMissions ?? false,
                    leaseTtlMs: this.config.proactive?.leaseTtlMs,
                    leaseRenewIntervalMs: this.config.proactive?.leaseRenewIntervalMs,
                }
            );

            // Initialize prompt injection guard and wire to all engines
            const validator = new InputValidator({}, this.security.audit);
            this.coc.setValidator(validator);
            this.knowledge.setValidator(validator);
            this.rooms.setValidator(validator);

            // Setup event forwarding
            this.setupEventForwarding();

            this.connected = true;
            this.emit('connected');
        } catch (err) {
            // Clean up partially-initialized resources to prevent leaks
            await this.p2p?.stop?.().catch(() => {});
            this.rooms?.destroy?.();
            this.storage?.close?.();
            this.connected = false;
            throw err;
        }
    }

    async disconnect(): Promise<void> {
        if (!this.connected) return;

        this.skills?.stop?.();
        await this.researchWorker?.stop?.();
        this.proactive?.destroy?.();
        this.coc.destroy();
        this.rooms.destroy();
        await this.p2p.stop();
        this.storage.close();

        this.connected = false;
        this.emit('disconnected');
    }

    private setupEventForwarding(): void {
        // Forward CoC events
        this.coc.on('chain:opened', (id, goal) =>
            this.emit('chain:opened', { id, goal })
        );
        this.coc.on('chain:completed', (id) =>
            this.emit('chain:completed', { id })
        );
        this.coc.on('step:unlocked', (chainId, stepId, step) =>
            this.emit('step:unlocked', { chainId, stepId, step })
        );
        this.coc.on('step:assigned', (chainId, stepId, assignee) =>
            this.emit('step:assigned', { chainId, stepId, assignee })
        );

        // Forward room events
        this.rooms.on('chat:message', (roomId, envelope) =>
            this.emit('message', { roomId, from: envelope.from, body: envelope.body })
        );
        this.rooms.on('mission:event', (roomId, envelope) =>
            this.emit('mission:event', { roomId, envelope })
        );
        this.persona.on('persona:memory:added', (node) => this.emit('persona:memory:added', node));
        this.persona.on('persona:memory:updated', (node) => this.emit('persona:memory:updated', node));
        this.persona.on('persona:memory:deleted', (evt) => this.emit('persona:memory:deleted', evt));
    }

    // ─── Room Operations ──────────────────────────────────────────

    async joinRoom(roomId: string, displayName?: string): Promise<void> {
        this.ensureConnected();
        await this.rooms.joinRoom(roomId, displayName);
        this.emit('room:joined', { roomId });
    }

    async leaveRoom(roomId: string): Promise<void> {
        this.ensureConnected();
        await this.rooms.leaveRoom(roomId);
        this.emit('room:left', { roomId });
    }

    getJoinedRooms(): string[] {
        this.ensureConnected();
        return this.rooms.getJoinedRooms();
    }

    // ─── Messaging ────────────────────────────────────────────────

    async sendMessage(
        roomId: string,
        message: string,
        replyTo?: string
    ): Promise<void> {
        this.ensureConnected();
        await this.rooms.sendChatMessage(roomId, message, {
            replyTo,
            formatting: 'plain',
        });
    }

    // ─── Collaboration (CoC) ──────────────────────────────────────

    async summon(options: SummonOptions): Promise<ChainInfo> {
        this.ensureConnected();

        let dag: CocDagNode[];

        if (options.template) {
            const { getTemplate } = await import('../templates.js');
            const template = getTemplate(options.template);
            dag = template.generate(options.goal);
        } else {
            const plan = await this.planner.generatePlan(options.goal);
            dag = plan.dag;
        }

        const chainId = await this.coc.openChain(options.roomId, options.goal, {
            priority: options.priority || 'normal',
            templateId: options.template,
        });

        await this.coc.publishPlan(options.roomId, chainId, dag);

        // Setup listeners if callbacks provided
        if (options.onStep || options.onComplete) {
            this.setupChainListeners(chainId, options);
        }

        return this.getChain(chainId);
    }

    private setupChainListeners(
        chainId: string,
        options: SummonOptions
    ): void {
        if (options.onStep) {
            this.coc.on('step:unlocked', (cid, stepId, step) => {
                if (cid === chainId) {
                    options.onStep!({
                        id: stepId,
                        chainId: cid,
                        kind: step.kind,
                        title: step.title,
                        status: 'unlocked',
                    });
                }
            });
        }

        if (options.onComplete) {
            this.coc.on('chain:completed', (cid) => {
                if (cid === chainId) {
                    this.getChain(chainId).then((chain) => {
                        options.onComplete!({
                            id: chain.id,
                            goal: chain.goal,
                            status: chain.status,
                            steps: chain.steps,
                        });
                    });
                }
            });
        }
    }

    async listChains(roomId: string): Promise<ChainInfo[]> {
        this.ensureConnected();
        const chains = this.coc.getActiveChains().filter((c) => c.room_id === roomId);
        return chains.map((c) => ({
            id: c.chain_id,
            goal: c.goal,
            status: c.status,
            steps: c.steps.map((s) => ({
                id: s.step_id,
                chainId: c.chain_id,
                kind: s.kind,
                title: s.title,
                status: s.status,
                assignee: s.assignee_did || undefined,
            })),
        }));
    }

    async getChain(chainId: string): Promise<ChainInfo> {
        this.ensureConnected();
        const chain = this.coc.getChain(chainId);
        if (!chain) throw new Error(`Chain not found: ${chainId}`);

        return {
            id: chain.chain_id,
            goal: chain.goal,
            status: chain.status,
            steps: chain.steps.map((s) => ({
                id: s.step_id,
                chainId: chain.chain_id,
                kind: s.kind,
                title: s.title,
                status: s.status,
                assignee: s.assignee_did || undefined,
            })),
        };
    }

    async submitStep(
        stepId: string,
        result: {
            status: 'completed' | 'failed' | 'partial';
            output: string;
            artifacts?: Artifact[];
        }
    ): Promise<void> {
        this.ensureConnected();

        const step = this.storage.getStepRecord(stepId);
        if (!step) {
            throw new Error(`Step ${stepId} not found`);
        }
        const chain = this.storage.getChain(step.chain_id);
        if (!chain) {
            throw new Error(`Chain not found for step ${stepId}`);
        }

        await this.coc.submitStep(
            chain.room_id,
            step.chain_id,
            stepId,
            result.status,
            result.output,
            result.artifacts || []
        );
    }

    async reviewStep(
        stepId: string,
        decision: 'approved' | 'rejected' | 'needs_revision',
        notes: string
    ): Promise<void> {
        this.ensureConnected();

        const chains = this.coc.getActiveChains();
        const chain = chains.find((c) => c.steps.find((s) => s.step_id === stepId));

        if (!chain) {
            throw new Error(`Step ${stepId} not found`);
        }

        await this.coc.reviewStep(
            chain.room_id,
            chain.chain_id,
            stepId,
            decision,
            notes
        );
    }

    async cancelChain(chainId: string, reason?: string): Promise<void> {
        this.ensureConnected();
        const chain = this.coc.getChain(chainId);
        if (!chain) throw new Error(`Chain not found: ${chainId}`);

        await this.coc.closeChain(
            chain.room_id,
            chainId,
            'cancelled',
            reason || 'Cancelled via SDK'
        );
    }

    async getPendingSteps(): Promise<StepInfo[]> {
        this.ensureConnected();

        const rows = this.storage.getAssignedStepsForDid(this.identity.did);
        return rows.map((step: any) => ({
            id: step.step_id,
            chainId: step.chain_id,
            kind: step.kind,
            title: step.title,
            status: step.status,
        }));
    }

    // ─── Proactive Missions ──────────────────────────────────────

    async startMission(spec: ProactiveMissionSpec): Promise<MissionInfo> {
        this.ensureConnected();
        if (!this.config.proactive?.enableLeadership) {
            throw new Error('Mission leadership is disabled for this client. Set proactive.enableLeadership=true.');
        }
        return this.proactive.startMission(spec);
    }

    async pauseMission(missionId: string): Promise<void> {
        this.ensureConnected();
        await this.proactive.pauseMission(missionId);
    }

    async resumeMission(missionId: string): Promise<void> {
        this.ensureConnected();
        await this.proactive.resumeMission(missionId);
    }

    async stopMission(missionId: string, reason?: string): Promise<void> {
        this.ensureConnected();
        await this.proactive.stopMission(missionId, reason);
    }

    async listMissions(roomId?: string): Promise<MissionInfo[]> {
        this.ensureConnected();
        return this.proactive.listMissions(roomId);
    }

    async getMission(missionId: string): Promise<MissionInfo | undefined> {
        this.ensureConnected();
        return this.proactive.getMission(missionId);
    }

    async getSwarmStatus(roomId?: string): Promise<SwarmStatus> {
        this.ensureConnected();
        return this.proactive.getSwarmStatus(roomId);
    }

    async startResearchWorker(config: ResearchWorkerConfig): Promise<void> {
        this.ensureConnected();
        const { ResearchWorkerNode } = await import('../workers/research-worker.js');
        await this.researchWorker?.stop?.();
        this.researchWorker = new ResearchWorkerNode(this, config);
        await this.researchWorker.start();
    }

    // ─── Reputation ───────────────────────────────────────────────

    async getReputation(did?: string): Promise<ReputationScore> {
        this.ensureConnected();
        const targetDid = did || this.identity.did;
        return this.reputation.getReputation(targetDid);
    }

    // ─── Templates ────────────────────────────────────────────────

    listTemplates(category?: string): Template[] {
        return listTemplates(category as any);
    }

    // ─── Capsules ─────────────────────────────────────────────────

    async exportCapsule(chainId: string, outputPath?: string): Promise<string> {
        this.ensureConnected();
        return this.exporter.export(chainId, outputPath || './');
    }

    // ─── Peers ────────────────────────────────────────────────────

    async getPeers(roomId: string): Promise<PeerInfo[]> {
        this.ensureConnected();
        const peers = this.rooms.getOnlinePeers();
        const result: PeerInfo[] = [];

        for (const peer of peers) {
            const rep = await this.reputation.getReputation(peer.peer_did);
            result.push({
                did: peer.peer_did,
                name: peer.peer_name || 'Unknown',
                status: peer.status,
                reputation: rep.overall,
                specialties: rep.specialties.map((s) => s.specialty),
            });
        }

        return result;
    }

    async announceWorker(roomId: string, profile: SwarmWorkerAnnouncement): Promise<void> {
        this.ensureConnected();
        await this.rooms.publishAdapterRegistration(roomId, profile);
        this.storage.registerAdapter(
            profile.adapter_id,
            profile.runtime,
            profile.display_name,
            profile.specialties || [],
            profile.kinds || [],
            profile.max_concurrency || 1,
            profile.endpoint || '',
            profile.auth_type || 'none',
            {
                ownerDid: profile.owner_did,
                roomId: profile.room_id || roomId,
                missionTags: profile.mission_tags,
                hostId: profile.host_id,
                peerId: profile.peer_id,
                health: 'healthy',
            }
        );
        this.storage.upsertSwarmWorker({
            did: profile.owner_did || this.identity.did,
            peerId: profile.peer_id,
            roomId: profile.room_id || roomId,
            hostId: profile.host_id || profile.peer_id || this.identity.did,
            runtime: profile.runtime === 'nanobot' || profile.runtime === 'docker' || profile.runtime === 'ollama'
                ? profile.runtime
                : 'custom',
            specialties: profile.specialties || [],
            capabilities: profile.capabilities || [],
            kinds: (profile.kinds as SwarmWorkerProfile['kinds']) || ['task'],
            maxConcurrency: profile.max_concurrency || 1,
            load: 0,
            health: 'healthy',
            missionTags: profile.mission_tags || [],
            adapterId: profile.adapter_id,
            displayName: profile.display_name,
            endpoint: profile.endpoint,
            lastSeen: Date.now(),
        });
    }

    async heartbeatWorker(roomId: string, heartbeat: AdapterHeartbeatBody): Promise<void> {
        this.ensureConnected();
        await this.rooms.publishAdapterHeartbeat(roomId, heartbeat);
        this.storage.updateAdapterHeartbeat(
            heartbeat.adapter_id,
            heartbeat.health,
            heartbeat.queue_depth,
            heartbeat.metrics?.success_rate
        );
    }

    async updateWorkerCapabilities(
        roomId: string,
        capabilities: AdapterCapabilities & { worker_did?: string }
    ): Promise<void> {
        this.ensureConnected();
        await this.rooms.publishAdapterCapabilities(roomId, capabilities);
    }

    async sendWorkerPresence(
        roomId: string,
        options: {
            status: 'online' | 'busy' | 'running' | 'offline' | 'away';
            load?: number;
            specialties?: string[];
            capabilities?: string[];
        }
    ): Promise<void> {
        this.ensureConnected();
        await this.rooms.sendPresence(roomId, options.status, options);
    }

    async getVisibleWorkers(roomId: string): Promise<SwarmWorkerProfile[]> {
        this.ensureConnected();
        return this.rooms.getVisibleWorkers(roomId) as SwarmWorkerProfile[];
    }

    // ─── Federation ─────────────────────────────────────────────

    async createFederation(
        name: string,
        description: string,
        visibility: 'public' | 'private' | 'invite-only' = 'private',
    ): Promise<any> {
        this.ensureConnected();
        return this.federation.createFederation(name, description, visibility);
    }

    listFederations(): any[] {
        this.ensureConnected();
        return this.federation.getMemberFederations(this.identity.did);
    }

    getFederation(federationId: string): any {
        this.ensureConnected();
        return this.federation.getFederation(federationId);
    }

    async joinFederation(federationId: string): Promise<boolean> {
        this.ensureConnected();
        return this.federation.joinFederation(
            federationId,
            this.identity.did,
            this.identity.displayName,
        );
    }

    // ─── Knowledge ──────────────────────────────────────────────

    async createKnowledgeSpace(
        name: string,
        description: string,
        type: 'personal' | 'team' | 'federation' | 'public' = 'team',
    ): Promise<any> {
        this.ensureConnected();
        return this.knowledge.createSpace(name, description, type);
    }

    async createKnowledgeCard(
        spaceId: string,
        type: string,
        title: string,
        content: string,
        options?: {
            summary?: string;
            tags?: string[];
            domain?: string[];
            confidence?: number;
        },
    ): Promise<any> {
        this.ensureConnected();
        return this.knowledge.createCard(spaceId, type as any, title, content, options);
    }

    queryKnowledgeCards(options: {
        spaceId?: string;
        type?: string;
        tags?: string[];
        query?: string;
        limit?: number;
    }): any[] {
        this.ensureConnected();
        return this.knowledge.queryCards(options as any);
    }

    getKnowledgeGraph(spaceId: string): any {
        this.ensureConnected();
        return this.knowledge.getKnowledgeGraph(spaceId);
    }

    async linkKnowledgeCards(
        sourceId: string,
        targetId: string,
        type: string,
        strength?: number,
    ): Promise<any> {
        this.ensureConnected();
        return this.knowledge.linkCards(sourceId, targetId, type as any, strength);
    }

    // ─── Federation Mesh ─────────────────────────────────────────

    async createPeering(
        sourceFederationId: string,
        targetFederationDid: string,
        policy?: Partial<FederationPeeringPolicy>
    ): Promise<any> {
        this.ensureConnected();
        return this.federation.requestPeering(sourceFederationId, targetFederationDid, policy || {});
    }

    async acceptPeering(peeringId: string, reason?: string): Promise<any> {
        this.ensureConnected();
        return this.federation.respondPeering(peeringId, true, reason);
    }

    async rejectPeering(peeringId: string, reason?: string): Promise<any> {
        this.ensureConnected();
        return this.federation.respondPeering(peeringId, false, reason);
    }

    async revokePeering(peeringId: string, reason?: string): Promise<any> {
        this.ensureConnected();
        return this.federation.revokePeering(peeringId, reason);
    }

    listPeerings(federationId: string, status?: FederationPeeringStatus): any[] {
        this.ensureConnected();
        return this.federation.listPeerings(federationId, status);
    }

    async openBridge(
        peeringId: string,
        localRoomId: string,
        remoteRoomId: string,
        rules?: Partial<MeshBridgeRules>
    ): Promise<any> {
        this.ensureConnected();
        return this.integration.openMeshBridge(peeringId, localRoomId, remoteRoomId, rules);
    }

    async closeBridge(bridgeId: string): Promise<void> {
        this.ensureConnected();
        await this.integration.closeMeshBridge(bridgeId);
    }

    listBridges(federationId?: string): any[] {
        this.ensureConnected();
        return this.integration.listMeshBridges(federationId);
    }

    getMeshStats(federationId?: string): any {
        this.ensureConnected();
        return this.integration.getMeshStats(federationId);
    }

    // ─── Persona Vault ───────────────────────────────────────────

    async createPersonaVault(input: { name: string; ownerDid?: string }): Promise<any> {
        this.ensureConnected();
        return this.persona.createVault(input);
    }

    async addMemory(input: AddMemoryInput & { capabilityToken?: string; zkpProofs?: ZkProofBundle[] }): Promise<any> {
        this.ensureConnected();
        const { capabilityToken, zkpProofs, ...payload } = input;
        const auth = await this.authorizePersonaAccess({
            capabilityToken,
            operation: 'write',
            domain: payload.domain,
            resource: 'persona://memory/*',
            zkpProofs,
        });
        try {
            const node = await this.persona.addMemory(payload);
            await this.auditPersonaAccess({
                vaultId: node.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'write',
                resource: `persona://memory/${node.id}`,
                result: 'allowed',
                details: { domain: node.domain, type: node.type },
            });
            return node;
        } catch (error) {
            await this.auditPersonaAccess({
                vaultId: payload.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'write',
                resource: 'persona://memory/*',
                result: 'denied',
                details: { reason: (error as Error).message },
            });
            throw error;
        }
    }

    async updateMemory(
        nodeId: string,
        patch: UpdateMemoryInput,
        options?: { capabilityToken?: string; domain?: PersonaDomain; zkpProofs?: ZkProofBundle[] }
    ): Promise<any> {
        this.ensureConnected();
        const current = this.storage.getPersonaNode?.(nodeId);
        const domain = options?.domain || current?.domain;
        const auth = await this.authorizePersonaAccess({
            capabilityToken: options?.capabilityToken,
            operation: 'write',
            domain,
            resource: `persona://memory/${nodeId}`,
            appendMutation: true,
            zkpProofs: options?.zkpProofs,
        });
        try {
            const updated = await this.persona.updateMemory(nodeId, patch);
            await this.auditPersonaAccess({
                vaultId: updated.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'write',
                resource: `persona://memory/${nodeId}`,
                result: 'allowed',
                details: { domain: updated.domain, patchKeys: Object.keys(patch || {}) },
            });
            return updated;
        } catch (error) {
            await this.auditPersonaAccess({
                vaultId: current?.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'write',
                resource: `persona://memory/${nodeId}`,
                result: 'denied',
                details: { reason: (error as Error).message },
            });
            throw error;
        }
    }

    async deleteMemory(
        nodeId: string,
        reason?: string,
        options?: { capabilityToken?: string; domain?: PersonaDomain; zkpProofs?: ZkProofBundle[] }
    ): Promise<void> {
        this.ensureConnected();
        const current = this.storage.getPersonaNode?.(nodeId);
        const domain = options?.domain || current?.domain;
        const auth = await this.authorizePersonaAccess({
            capabilityToken: options?.capabilityToken,
            operation: 'delete',
            domain,
            resource: `persona://memory/${nodeId}`,
            appendMutation: true,
            zkpProofs: options?.zkpProofs,
        });
        try {
            await this.persona.deleteMemory(nodeId, reason);
            await this.auditPersonaAccess({
                vaultId: current?.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'delete',
                resource: `persona://memory/${nodeId}`,
                result: 'allowed',
                details: reason ? { reason } : undefined,
            });
        } catch (error) {
            await this.auditPersonaAccess({
                vaultId: current?.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'delete',
                resource: `persona://memory/${nodeId}`,
                result: 'denied',
                details: { reason: (error as Error).message },
            });
            throw error;
        }
    }

    async queryMemories(input: MemoryQueryInput & { capabilityToken?: string; zkpProofs?: ZkProofBundle[] }): Promise<any> {
        this.ensureConnected();
        const { capabilityToken, zkpProofs, ...payload } = input;
        const auth = await this.authorizePersonaAccess({
            capabilityToken,
            operation: 'read',
            domain: payload.domain,
            resource: 'persona://memory/*',
            requestedLimit: payload.limit,
            zkpProofs,
        });

        const scoped: MemoryQueryInput = { ...payload };
        if (auth.limit !== undefined) {
            scoped.limit = Math.min(scoped.limit ?? auth.limit, auth.limit);
        }
        if (auth.domains?.length) {
            if (scoped.domain && !auth.domains.includes(scoped.domain)) {
                throw new Error(`Capability denied: domain ${scoped.domain} not allowed`);
            }
            if (!scoped.domain) {
                const existing = new Set(scoped.domains || []);
                for (const d of auth.domains) existing.add(d);
                scoped.domains = Array.from(existing);
            }
        }

        try {
            const result = await this.persona.queryMemories(scoped);
            const vaultId = result.nodes[0]?.vaultId || scoped.vaultId;
            await this.auditPersonaAccess({
                vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'read',
                resource: 'persona://memory/*',
                result: 'allowed',
                details: {
                    query: scoped.query,
                    domain: scoped.domain,
                    domains: scoped.domains,
                    returned: result.nodes.length,
                },
            });
            return result;
        } catch (error) {
            await this.auditPersonaAccess({
                vaultId: scoped.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'read',
                resource: 'persona://memory/*',
                result: 'denied',
                details: { reason: (error as Error).message },
            });
            throw error;
        }
    }

    async queryGraph(input: GraphQueryInput & { capabilityToken?: string; zkpProofs?: ZkProofBundle[] }): Promise<any> {
        this.ensureConnected();
        const { capabilityToken, zkpProofs, ...payload } = input;
        const auth = await this.authorizePersonaAccess({
            capabilityToken,
            operation: 'read',
            domain: payload.domain,
            resource: payload.domain ? `persona://graph/${payload.domain}` : 'persona://graph/*',
            requestedLimit: payload.limit,
            zkpProofs,
        });

        const scoped: GraphQueryInput = { ...payload };
        if (auth.limit !== undefined) {
            scoped.limit = Math.min(scoped.limit ?? auth.limit, auth.limit);
        }
        if (auth.domains?.length && scoped.domain && !auth.domains.includes(scoped.domain)) {
            throw new Error(`Capability denied: domain ${scoped.domain} not allowed`);
        }

        try {
            const graph = await this.persona.queryGraph(scoped);
            let result = graph;
            if (auth.domains?.length) {
                const allowedNodes = graph.nodes.filter((node) => auth.domains!.includes(node.domain));
                const allowedIds = new Set(allowedNodes.map((node) => node.id));
                result = {
                    ...graph,
                    nodes: allowedNodes,
                    edges: graph.edges.filter(
                        (edge) => allowedIds.has(edge.sourceNodeId) && allowedIds.has(edge.targetNodeId)
                    ),
                    hyperEdges: graph.hyperEdges.filter((edge) => edge.nodeIds.some((id) => allowedIds.has(id))),
                };
            }

            await this.auditPersonaAccess({
                vaultId: result.nodes[0]?.vaultId || scoped.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'read',
                resource: scoped.domain ? `persona://graph/${scoped.domain}` : 'persona://graph/*',
                result: 'allowed',
                details: { returnedNodes: result.nodes.length },
            });
            return result;
        } catch (error) {
            await this.auditPersonaAccess({
                vaultId: scoped.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'read',
                resource: scoped.domain ? `persona://graph/${scoped.domain}` : 'persona://graph/*',
                result: 'denied',
                details: { reason: (error as Error).message },
            });
            throw error;
        }
    }

    async updatePreference(input: UpdatePreferenceInput & { capabilityToken?: string; zkpProofs?: ZkProofBundle[] }): Promise<any> {
        this.ensureConnected();
        const { capabilityToken, zkpProofs, ...payload } = input;
        const domain = payload.domain || 'preferences';
        const auth = await this.authorizePersonaAccess({
            capabilityToken,
            operation: 'write',
            domain,
            resource: `persona://preferences/${domain}`,
            zkpProofs,
        });
        try {
            const node = await this.persona.updatePreference(payload);
            await this.auditPersonaAccess({
                vaultId: node.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'write',
                resource: `persona://preferences/${domain}`,
                result: 'allowed',
                details: { key: payload.key },
            });
            return node;
        } catch (error) {
            await this.auditPersonaAccess({
                vaultId: payload.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'write',
                resource: `persona://preferences/${domain}`,
                result: 'denied',
                details: { reason: (error as Error).message },
            });
            throw error;
        }
    }

    async issueCapability(input: IssueCapabilityInput & { capabilityToken?: string; zkpProofs?: ZkProofBundle[] }): Promise<any> {
        this.ensureConnected();
        const { capabilityToken, zkpProofs, ...payload } = input;
        const auth = await this.authorizePersonaAccess({
            capabilityToken,
            operation: 'write',
            domain: payload.caveats.domains?.[0],
            resource: 'persona://capabilities/*',
            appendMutation: true,
            zkpProofs,
        });
        try {
            const token = await this.persona.issueCapability(payload);
            await this.auditPersonaAccess({
                vaultId: token.vaultId,
                tokenId: auth.tokenId || token.id,
                serviceDid: auth.serviceDid,
                operation: 'share',
                resource: `persona://capabilities/${token.id}`,
                result: 'allowed',
                details: { scope: token.scope, serviceDid: token.serviceDid },
            });
            return token;
        } catch (error) {
            await this.auditPersonaAccess({
                vaultId: payload.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'share',
                resource: 'persona://capabilities/*',
                result: 'denied',
                details: { reason: (error as Error).message },
            });
            throw error;
        }
    }

    async attenuateCapability(
        tokenId: string,
        caveatsPatch: Partial<CapabilityCaveats>,
        options?: { capabilityToken?: string; zkpProofs?: ZkProofBundle[] }
    ): Promise<any> {
        this.ensureConnected();
        const auth = await this.authorizePersonaAccess({
            capabilityToken: options?.capabilityToken,
            operation: 'write',
            resource: `persona://capabilities/${tokenId}`,
            appendMutation: true,
            zkpProofs: options?.zkpProofs,
        });
        try {
            const token = await this.persona.attenuateCapability({ tokenId, caveatsPatch });
            await this.auditPersonaAccess({
                vaultId: token.vaultId,
                tokenId: auth.tokenId || token.id,
                serviceDid: auth.serviceDid,
                operation: 'share',
                resource: `persona://capabilities/${token.id}`,
                result: 'allowed',
                details: { parentTokenId: token.parentTokenId },
            });
            return token;
        } catch (error) {
            await this.auditPersonaAccess({
                tokenId: auth.tokenId || tokenId,
                serviceDid: auth.serviceDid,
                operation: 'share',
                resource: `persona://capabilities/${tokenId}`,
                result: 'denied',
                details: { reason: (error as Error).message },
            });
            throw error;
        }
    }

    async revokeCapability(
        tokenId: string,
        reason: string,
        options?: { capabilityToken?: string; zkpProofs?: ZkProofBundle[] }
    ): Promise<void> {
        this.ensureConnected();
        const auth = await this.authorizePersonaAccess({
            capabilityToken: options?.capabilityToken,
            operation: 'write',
            resource: `persona://capabilities/${tokenId}`,
            appendMutation: true,
            zkpProofs: options?.zkpProofs,
        });
        try {
            await this.persona.revokeCapability(tokenId, reason);
            await this.auditPersonaAccess({
                tokenId: auth.tokenId || tokenId,
                serviceDid: auth.serviceDid,
                operation: 'revoke',
                resource: `persona://capabilities/${tokenId}`,
                result: 'allowed',
                details: { reason },
            });
        } catch (error) {
            await this.auditPersonaAccess({
                tokenId: auth.tokenId || tokenId,
                serviceDid: auth.serviceDid,
                operation: 'revoke',
                resource: `persona://capabilities/${tokenId}`,
                result: 'denied',
                details: { reason: (error as Error).message },
            });
            throw error;
        }
    }

    async shareSubgraph(input: ExportSubgraphInput & { capabilityToken?: string; zkpProofs?: ZkProofBundle[] }): Promise<any> {
        this.ensureConnected();
        const { capabilityToken, zkpProofs, ...payload } = input;
        const domain = payload.domain;
        const auth = await this.authorizePersonaAccess({
            capabilityToken,
            operation: 'share',
            domain,
            resource: domain ? `persona://graph/${domain}` : 'persona://graph/*',
            requestedLimit: 1000,
            zkpProofs,
        });
        try {
            const redacted = await this.persona.exportSubgraph({
                ...payload,
                redactionOperation: 'share',
            });
            if (auth.limit !== undefined && redacted.nodes.length > auth.limit) {
                const kept = redacted.nodes.slice(0, auth.limit);
                const keptIds = new Set(kept.map((node) => node.id));
                redacted.nodes = kept;
                redacted.edges = redacted.edges.filter(
                    (edge) => keptIds.has(edge.sourceNodeId) && keptIds.has(edge.targetNodeId)
                );
                redacted.hyperEdges = redacted.hyperEdges.filter((edge) =>
                    edge.nodeIds.some((id) => keptIds.has(id))
                );
            }
            await this.auditPersonaAccess({
                vaultId: redacted.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'share',
                resource: domain ? `persona://graph/${domain}` : 'persona://graph/*',
                result: 'allowed',
                details: { nodes: redacted.nodes.length, domain },
            });
            return redacted;
        } catch (error) {
            await this.auditPersonaAccess({
                vaultId: payload.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'share',
                resource: domain ? `persona://graph/${domain}` : 'persona://graph/*',
                result: 'denied',
                details: { reason: (error as Error).message },
            });
            throw error;
        }
    }

    async getPersonaProfile(vaultId?: string, options?: { capabilityToken?: string; zkpProofs?: ZkProofBundle[] }): Promise<any> {
        this.ensureConnected();
        const auth = await this.authorizePersonaAccess({
            capabilityToken: options?.capabilityToken,
            operation: 'read',
            resource: 'persona://profile',
            zkpProofs: options?.zkpProofs,
        });
        try {
            const profile = { ...(await this.persona.getProfile(vaultId)) } as Record<string, unknown>;
            if (auth.domains?.length) {
                const preferences = Array.isArray(profile.preferences) ? profile.preferences : [];
                const identity = Array.isArray(profile.identity) ? profile.identity : [];
                profile.preferences = auth.domains.includes('preferences') ? preferences : [];
                profile.identity = identity.filter((entry: any) =>
                    auth.domains!.includes(entry?.domain as PersonaDomain)
                );
            }
            await this.auditPersonaAccess({
                vaultId: typeof profile.vaultId === 'string' ? profile.vaultId : vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'read',
                resource: 'persona://profile',
                result: 'allowed',
            });
            return profile;
        } catch (error) {
            await this.auditPersonaAccess({
                vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'read',
                resource: 'persona://profile',
                result: 'denied',
                details: { reason: (error as Error).message },
            });
            throw error;
        }
    }

    async listPersonaCapabilities(vaultId?: string): Promise<any[]> {
        this.ensureConnected();
        const resolvedVaultId = vaultId || this.storage.getPersonaVaults?.(this.identity.did)?.[0]?.id;
        if (!resolvedVaultId) return [];
        return this.storage.listPersonaCapabilities?.(resolvedVaultId) || [];
    }

    async getPersonaCapability(tokenId: string, vaultId?: string): Promise<any | undefined> {
        const all = await this.listPersonaCapabilities(vaultId);
        return all.find((item) => item.id === tokenId);
    }

    async issuePersonaClaim(input: IssueClaimInput & { capabilityToken?: string; zkpProofs?: ZkProofBundle[] }): Promise<any> {
        this.ensureConnected();
        const { capabilityToken, zkpProofs, ...payload } = input;
        const auth = await this.authorizePersonaAccess({
            capabilityToken,
            operation: 'write',
            resource: 'persona://claims/*',
            zkpProofs,
        });
        const claim = await this.persona.issueClaim(payload);
        await this.auditPersonaAccess({
            vaultId: claim.vaultId,
            tokenId: auth.tokenId,
            serviceDid: auth.serviceDid,
            operation: 'write',
            resource: `persona://claims/${claim.id}`,
            result: 'allowed',
            details: { schema: claim.schema },
        });
        return claim;
    }

    async revokePersonaClaim(
        claimId: string,
        reason: string,
        options?: { capabilityToken?: string; zkpProofs?: ZkProofBundle[] }
    ): Promise<void> {
        this.ensureConnected();
        const auth = await this.authorizePersonaAccess({
            capabilityToken: options?.capabilityToken,
            operation: 'delete',
            resource: `persona://claims/${claimId}`,
            zkpProofs: options?.zkpProofs,
        });
        await this.persona.revokeClaim(claimId, reason);
        await this.auditPersonaAccess({
            tokenId: auth.tokenId,
            serviceDid: auth.serviceDid,
            operation: 'delete',
            resource: `persona://claims/${claimId}`,
            result: 'allowed',
            details: { reason },
        });
    }

    async generatePersonaZkProof(
        input: GenerateZkProofInput & { capabilityToken?: string }
    ): Promise<any> {
        this.ensureConnected();
        const { capabilityToken, ...payload } = input;
        const auth = await this.authorizePersonaAccess({
            capabilityToken,
            operation: 'read',
            resource: 'persona://zkp/proofs/*',
        });
        const bundle = await this.persona.generateZkProof(payload);
        await this.auditPersonaAccess({
            vaultId: bundle.vaultId,
            tokenId: auth.tokenId,
            serviceDid: auth.serviceDid,
            operation: 'read',
            resource: `persona://zkp/proofs/${bundle.id}`,
            result: 'allowed',
            details: { circuit: bundle.circuitId },
        });
        return bundle;
    }

    async verifyPersonaZkProof(
        input: VerifyZkProofInput & { capabilityToken?: string }
    ): Promise<any> {
        this.ensureConnected();
        const { capabilityToken, ...payload } = input;
        const auth = await this.authorizePersonaAccess({
            capabilityToken,
            operation: 'read',
            resource: 'persona://zkp/proofs/*',
        });
        const result = await this.persona.verifyZkProof(payload);
        await this.auditPersonaAccess({
            vaultId: payload.vaultId || payload.proofBundle.vaultId,
            tokenId: auth.tokenId,
            serviceDid: auth.serviceDid,
            operation: 'read',
            resource: `persona://zkp/proofs/${payload.proofBundle.id}`,
            result: result.valid ? 'allowed' : 'denied',
            details: { circuit: result.circuitId, reason: result.reason },
        });
        return result;
    }

    async listPersonaClaims(vaultId?: string, includeRevoked = false): Promise<any[]> {
        this.ensureConnected();
        return this.persona.listClaims(vaultId, includeRevoked);
    }

    async getPersonaClaim(claimId: string): Promise<any> {
        this.ensureConnected();
        return this.persona.getClaim(claimId);
    }

    listPersonaZkCircuits(): any[] {
        this.ensureConnected();
        return this.persona.listZkCircuits();
    }

    listPersonaZkProofs(vaultId?: string): any[] {
        this.ensureConnected();
        return this.persona.listZkProofs(vaultId);
    }

    getPersonaZkProof(proofId: string): any | undefined {
        this.ensureConnected();
        return this.persona.getZkProof(proofId);
    }

    async verifyPersonaAccessLog(
        input: { logId: number; capabilityToken?: string; zkpProofs?: ZkProofBundle[] }
    ): Promise<{ logId: number; valid: boolean; reason?: string }> {
        this.ensureConnected();
        const auth = await this.authorizePersonaAccess({
            capabilityToken: input.capabilityToken,
            operation: 'read',
            resource: `persona://audit/log/${input.logId}`,
            zkpProofs: input.zkpProofs,
        });
        const result = await this.persona.verifyPersonaAccessLog({ logId: input.logId });
        await this.auditPersonaAccess({
            tokenId: auth.tokenId,
            serviceDid: auth.serviceDid,
            operation: 'read',
            resource: `persona://audit/log/${input.logId}`,
            result: result.valid ? 'allowed' : 'denied',
            details: result.reason ? { reason: result.reason } : undefined,
        });
        return result;
    }

    async runPersonaRetentionSweep(
        input: { vaultId?: string; domain?: PersonaDomain; dryRun?: boolean; capabilityToken?: string; zkpProofs?: ZkProofBundle[] } = {}
    ): Promise<{ scanned: number; deleted: number }> {
        this.ensureConnected();
        const auth = await this.authorizePersonaAccess({
            capabilityToken: input.capabilityToken,
            operation: 'delete',
            domain: input.domain,
            resource: 'persona://retention/sweep',
            zkpProofs: input.zkpProofs,
        });
        const result = await this.persona.runRetentionSweep({
            vaultId: input.vaultId,
            domain: input.domain,
            dryRun: input.dryRun,
        });
        await this.auditPersonaAccess({
            vaultId: input.vaultId,
            tokenId: auth.tokenId,
            serviceDid: auth.serviceDid,
            operation: 'delete',
            resource: 'persona://retention/sweep',
            result: 'allowed',
            details: { dryRun: !!input.dryRun, scanned: result.scanned, deleted: result.deleted },
        });
        return result;
    }

    async applyPersonaSyncDelta(delta: PersonaSyncDelta, options?: { capabilityToken?: string; zkpProofs?: ZkProofBundle[] }): Promise<any> {
        this.ensureConnected();
        const auth = await this.authorizePersonaAccess({
            capabilityToken: options?.capabilityToken,
            operation: 'write',
            resource: 'persona://sync/delta',
            zkpProofs: options?.zkpProofs || delta.proofs,
        });
        try {
            const result = await this.persona.applySyncDelta(delta);
            await this.auditPersonaAccess({
                vaultId: delta.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'write',
                resource: 'persona://sync/delta',
                result: 'allowed',
                details: { applied: result.applied, ignored: result.ignored },
            });
            return result;
        } catch (error) {
            await this.auditPersonaAccess({
                vaultId: delta.vaultId,
                tokenId: auth.tokenId,
                serviceDid: auth.serviceDid,
                operation: 'write',
                resource: 'persona://sync/delta',
                result: 'denied',
                details: { reason: (error as Error).message },
            });
            throw error;
        }
    }

    // ─── Identity ─────────────────────────────────────────────────

    getIdentity(): { did: string; name: string } {
        return {
            did: this.identity.did,
            name: this.identity.displayName,
        };
    }

    getPeerId(): string {
        this.ensureConnected();
        return this.p2p.getPeerId();
    }

    getMultiaddrs(): string[] {
        this.ensureConnected();
        return this.p2p.getMultiaddrs();
    }

    getP2PNode(): P2PNode {
        this.ensureConnected();
        return this.p2p;
    }

    getCapabilities(): string[] {
        return ['chat', 'coc', 'plan', 'reputation', 'persona-vault', 'missions', 'swarm'];
    }

    // ─── Helpers ──────────────────────────────────────────────────

    private ensureConnected(): void {
        if (!this.connected) {
            throw new Error('Client not connected. Call connect() first.');
        }
    }

    private async authorizePersonaAccess(input: {
        capabilityToken?: string;
        operation: 'read' | 'write' | 'delete' | 'share';
        domain?: PersonaDomain;
        resource: string;
        requestedLimit?: number;
        appendMutation?: boolean;
        zkpProofs?: ZkProofBundle[];
    }): Promise<{ tokenId?: string; serviceDid: string; domains?: PersonaDomain[]; limit?: number }> {
        if (!input.capabilityToken) {
            return {
                serviceDid: this.identity.did,
            };
        }

        const validation = this.persona.validateCapability({
            token: input.capabilityToken,
            operation: input.operation,
            domain: input.domain,
            resource: input.resource,
        });
        if (!validation.allowed || !validation.capability) {
            throw new Error(`Capability denied: ${validation.reason || 'unknown reason'}`);
        }

        if (input.appendMutation && validation.capability.caveats.appendOnly) {
            throw new Error('Capability denied: append-only token cannot mutate existing data');
        }

        const requiredProofs = validation.capability.caveats.requireProofs || [];
        if (requiredProofs.length > 0) {
            const provided = input.zkpProofs || [];
            for (const circuitId of requiredProofs) {
                const proof = provided.find((item) => item.circuitId === circuitId);
                if (!proof) {
                    throw new Error(`Capability denied: missing required ZKP proof (${circuitId})`);
                }
                const verified = await this.persona.verifyZkProof({
                    vaultId: validation.capability.vaultId,
                    proofBundle: proof,
                });
                if (!verified.valid) {
                    throw new Error(
                        `Capability denied: invalid ZKP proof (${circuitId})${verified.reason ? `: ${verified.reason}` : ''}`
                    );
                }
            }
        }

        return {
            tokenId: validation.capability.id,
            serviceDid: validation.capability.serviceDid,
            domains: validation.capability.caveats.domains,
            limit: validation.capability.caveats.limit,
        };
    }

    private async auditPersonaAccess(entry: {
        vaultId?: string;
        tokenId?: string;
        serviceDid: string;
        operation: string;
        resource: string;
        result: 'allowed' | 'denied';
        details?: Record<string, unknown>;
    }): Promise<void> {
        const resolvedVaultId =
            entry.vaultId ||
            this.storage.getPersonaVaults?.(this.identity.did)?.[0]?.id;
        if (!resolvedVaultId) return;

        const ts = Date.now();
        const body = JSON.stringify({
            vaultId: resolvedVaultId,
            tokenId: entry.tokenId || null,
            serviceDid: entry.serviceDid,
            operation: entry.operation,
            resource: entry.resource,
            result: entry.result,
            details: entry.details || null,
            ts,
        });
        const signatureBytes = await this.security.sign(new TextEncoder().encode(body));
        const signature = Buffer.from(signatureBytes).toString('base64');

        this.storage.appendPersonaAccessLog?.({
            vaultId: resolvedVaultId,
            tokenId: entry.tokenId,
            serviceDid: entry.serviceDid,
            operation: entry.operation,
            resource: entry.resource,
            result: entry.result,
            details: entry.details,
            ts,
            signature,
            signerDid: this.identity.did,
            sigAlg: 'ed25519',
        });
    }
}

// ─── Factory Function ───────────────────────────────────────────

export async function createClient(config?: SDKConfig): Promise<SocietyClient> {
    const client = new SocietyClient(config);
    await client.connect();
    return client;
}

// ─── Simple Entry Point (Progressive Disclosure) ────────────────
//
// Inspired by Tailscale's simplicity and SwiftUI's progressive disclosure.
// The simplest possible way to join the Society network.
//
// Level 1: const agent = await society()
// Level 2: const agent = await society({ name: 'Alice' })
// Level 3: const agent = await society({ name: 'Alice', room: 'research' })
// Level 4: const agent = await society({ name: 'Alice', join: 'ABC-123-XYZ' })
// Level 5: Full SDKConfig via createClient()

export interface SimpleConfig {
    /** Display name for your agent */
    name?: string;
    /** Room to auto-join (default: 'lobby') */
    room?: string;
    /** Invite code to join a friend's network */
    join?: string;
    /** Bootstrap address to connect to a remote network */
    connect?: string;
    /** Capabilities this agent offers */
    capabilities?: string[];
}

export async function society(config?: SimpleConfig | string): Promise<SocietyClient> {
    // Allow: society('Alice') as shorthand
    const opts: SimpleConfig = typeof config === 'string'
        ? { name: config }
        : config || {};

    const name = opts.name || `Agent-${Math.random().toString(36).slice(2, 6)}`;
    const room = opts.room || 'lobby';

    const sdkConfig: SDKConfig = {
        identity: { name },
        network: {
            enableGossipsub: true,
            enableDht: true,
        },
    };

    // If connecting to a remote network
    if (opts.connect) {
        sdkConfig.network!.bootstrap = [opts.connect];
    }

    const client = await createClient(sdkConfig);
    await client.joinRoom(room);

    // If capabilities are provided, announce as worker
    if (opts.capabilities?.length) {
        const peerId = client.getPeerId();
        await client.announceWorker(room, {
            owner_did: client.getIdentity().did,
            room_id: room,
            adapter_id: `adapter_${peerId?.slice(-8) || 'local'}`,
            runtime: 'custom',
            display_name: name,
            specialties: opts.capabilities,
            kinds: ['execute'],
            max_concurrency: 1,
            version: '1.0.0',
            endpoint: '',
            auth_type: 'none',
        });
    }

    return client;
}

// ─── React Hook (para integração frontend) ──────────────────────

export function useSociety(config?: SDKConfig) {
    // Esta seria uma implementação React hook
    // Deixada como referência para implementação futura
    return {
        client: null as SocietyClient | null,
        connected: false,
        chains: [] as ChainInfo[],
        connect: async () => {},
        disconnect: async () => {},
    };
}
