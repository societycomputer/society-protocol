/**
 * Society Protocol - Module Integration Layer v1.0
 * 
 * Integrações entre módulos:
 * - Federation ↔ Rooms (salas pertencem a federações)
 * - Knowledge ↔ CoC (CoCs geram knowledge automaticamente)
 * - Skills ↔ Runtime (execução multi-runtime)
 * - Security ↔ All (segurança em todos os pontos)
 */

import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import {
    type FederationEngine,
    type Federation,
    type FederationPeering,
    type FederationPeeringPolicy
} from './federation.js';
import { type RoomManager } from './rooms.js';
import { type KnowledgePool, type KnowledgeCard, type KnowledgeSpace } from './knowledge.js';
import { type CocEngine, type CocChain, type CocStep } from './coc.js';
import { type SkillsEngine } from './skills/engine.js';
import { type SecurityManager, type SecurityContext } from './security.js';
import { type Storage } from './storage.js';
import { type Identity } from './identity.js';
import { type SwpEnvelope } from './swp.js';
import { type PersonaVaultEngine, type PersonaSyncDelta } from './persona/index.js';
import { type CotStreamEngine, type CotInsight } from './cot-stream.js';

// ─── Types ───────────────────────────────────────────────────────

export interface IntegrationConfig {
    autoIndexCoC: boolean;           // Indexar CoCs automaticamente
    autoCreateKnowledgeSpace: boolean; // Criar space por federation
    enforceFederationACLs: boolean;  // Aplicar ACLs de federação nas rooms
    autoCompressMessages: boolean;   // Comprimir mensagens automaticamente
    maxKnowledgeCardSize: number;    // Tamanho máximo para cards
}

export interface FederationRoom {
    roomId: string;
    federationId: string;
    policies: string[];
    requiresInvitation: boolean;
    memberCount: number;
}

export interface CoCKnowledgeBinding {
    cocId: string;
    knowledgeSpaceId: string;
    autoIndexSteps: boolean;
    indexArtifacts: boolean;
    indexDecisions: boolean;
}

export interface MeshBridgeRules {
    allowedTypes: string[];
    maxRatePerMinute: number;
    privacyMode: 'metadata-only' | 'summary' | 'full';
}

export interface FederationMeshBridge {
    id: string;
    peeringId: string;
    localFederationId: string;
    localRoomId: string;
    remoteRoomId: string;
    rules: MeshBridgeRules;
    status: 'active' | 'closed';
    eventsIn: number;
    eventsOut: number;
    createdAt: number;
    updatedAt: number;
    lastSyncAt?: number;
}

// ─── Integration Engine ──────────────────────────────────────────

class IntegrationEngine extends EventEmitter {
    private config: IntegrationConfig;
    private federationRooms = new Map<string, FederationRoom[]>(); // federationId -> rooms
    private cocKnowledgeBindings = new Map<string, CoCKnowledgeBinding>();
    private meshBridges = new Map<string, FederationMeshBridge>();
    private bridgeRateLimits = new Map<string, { windowStartedAt: number; count: number }>();
    private personaVault?: PersonaVaultEngine;
    private personaHooksBound = false;
    private cotStream?: CotStreamEngine;
    private cotHooksBound = false;
    
    constructor(
        private storage: Storage,
        private identity: Identity,
        private federationEngine: FederationEngine,
        private roomManager: RoomManager,
        private knowledgePool: KnowledgePool,
        private cocEngine: CocEngine,
        private skillsEngine: SkillsEngine,
        private securityManager: SecurityManager,
        config?: Partial<IntegrationConfig>
    ) {
        super();
        this.config = {
            autoIndexCoC: true,
            autoCreateKnowledgeSpace: true,
            enforceFederationACLs: true,
            autoCompressMessages: true,
            maxKnowledgeCardSize: 10000,
            ...config
        };

        this.loadFromStorage();
        this.setupHooks();
    }

    attachPersonaVault(engine: PersonaVaultEngine): void {
        this.personaVault = engine;
        if (this.personaHooksBound) return;
        this.personaHooksBound = true;

        const publishDelta = async (
            operations: Array<{ type: any; payload: Record<string, unknown> }>,
            vaultId?: string
        ) => {
            const resolvedVaultId = vaultId || this.storage.getPersonaVaults?.(this.identity.did)?.[0]?.id;
            if (!resolvedVaultId) return;
            const delta = this.personaVault!.buildSyncDelta({
                vaultId: resolvedVaultId,
                operations,
            });
            const rooms = this.roomManager.getJoinedRooms?.() || [];
            await Promise.all(
                rooms.map((roomId) =>
                    this.roomManager.sendMessage(
                        roomId,
                        delta as unknown as Record<string, unknown>,
                        'persona.sync.delta'
                    )
                )
            );
        };

        engine.on('persona:memory:added', (node: any) => {
            publishDelta([{ type: 'node_upsert', payload: node }], node.vaultId).catch(() => {});
        });
        engine.on('persona:memory:updated', (node: any) => {
            publishDelta([{ type: 'node_upsert', payload: node }], node.vaultId).catch(() => {});
        });
        engine.on('persona:memory:deleted', (evt: any) => {
            publishDelta([{ type: 'node_delete', payload: { nodeId: evt.nodeId } }], evt.vaultId).catch(() => {});
        });
        engine.on('persona:edge:upserted', (edge: any) => {
            publishDelta([{ type: 'edge_upsert', payload: edge }], edge.vaultId).catch(() => {});
        });
        engine.on('persona:capability:revoked', (evt: any) => {
            publishDelta([{ type: 'capability_revoke', payload: { tokenId: evt.tokenId, reason: evt.reason } }]).catch(() => {});
        });
        engine.on('persona:capability:attenuated', (cap: any) => {
            publishDelta([{ type: 'capability_attenuate', payload: { tokenId: cap.parentTokenId, caveatsPatch: cap.caveats } }], cap.vaultId).catch(() => {});
        });
        engine.on('persona:claim:issued', (claim: any) => {
            publishDelta([{ type: 'claim_upsert', payload: claim }], claim.vaultId).catch(() => {});
        });
        engine.on('persona:claim:revoked', (evt: any) => {
            publishDelta([{ type: 'claim_revoke', payload: { claimId: evt.claimId } }]).catch(() => {});
        });
        engine.on('persona:zkp:generated', (proof: any) => {
            publishDelta([{ type: 'zkp_proof_upsert', payload: proof }], proof.vaultId).catch(() => {});
        });
    }

    /**
     * Attach CoT Stream Engine for insight→knowledge auto-indexing
     * and CoC step→stream correlation.
     */
    attachCotStream(engine: CotStreamEngine): void {
        this.cotStream = engine;
        if (this.cotHooksBound) return;
        this.cotHooksBound = true;

        // Hook: CoT insight with high confidence → auto-create knowledge card
        engine.on('insight:received', async (_streamId: string, insight: CotInsight) => {
            if (this.config.autoIndexCoC && insight.confidence >= 0.7) {
                this.emit('cot:insight:indexed', insight);
            }
        });

        // Hook: CoT stream ended → index summary as knowledge
        engine.on('stream:ended', async (streamId: string, status: string, summary: string) => {
            if (status === 'completed' && this.config.autoIndexCoC) {
                const stream = engine.getStream(streamId);
                if (stream?.chain_id) {
                    this.emit('cot:stream:completed', streamId, summary);
                }
            }
        });

        // Hook: CoC step unlocked → notify CoT engine for potential auto-stream
        this.cocEngine.on('step:unlocked', (chainId: string, stepId: string, step: any) => {
            this.emit('cot:step:available', chainId, stepId, step);
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // FEDERATION ↔ ROOMS INTEGRATION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Criar room vinculada a uma federação
     */
    async createFederatedRoom(
        roomId: string,
        name: string,
        federationId: string,
        options?: {
            visibility?: 'public' | 'private';
            requireInvitation?: boolean;
        }
    ): Promise<{ room: any; federationRoom: FederationRoom }> {
        // Verificar se federação existe
        const federation = this.federationEngine.getFederation(federationId);
        if (!federation) {
            throw new Error(`Federation ${federationId} not found`);
        }

        // Verificar permissão de criar room na federação
        const canCreate = this.federationEngine.checkPolicy(
            federation,
            'room:create',
            this.identity.did
        );
        
        if (!canCreate.allowed) {
            throw new Error(`Cannot create room: ${canCreate.reason}`);
        }

        // Criar room no RoomManager (se não existir)
        // Note: RoomManager.createRoom só aceita name, então criamos via storage
        this.storage.createRoom(roomId, name, this.identity.did);
        this.storage.addRoomMember(roomId, this.identity.did, this.identity.displayName);

        // Criar vínculo federation-room
        const federationRoom: FederationRoom = {
            roomId,
            federationId,
            policies: federation.policies.map(p => p.id),
            requiresInvitation: options?.requireInvitation ?? federation.settings.requireInvitation,
            memberCount: 0
        };

        if (!this.federationRooms.has(federationId)) {
            this.federationRooms.set(federationId, []);
        }
        this.federationRooms.get(federationId)!.push(federationRoom);
        this.storage.saveFederationRoom?.(federationId, roomId, federationRoom);

        // Criar knowledge space para a room se configurado
        let knowledgeSpace: KnowledgeSpace | undefined;
        if (this.config.autoCreateKnowledgeSpace) {
            knowledgeSpace = await this.knowledgePool.createSpace(
                `${name} Knowledge`,
                `Shared knowledge for ${name}`,
                'team',
                federation.visibility === 'public' ? 'public' : 'federation'
            );
        }

        // Emitir evento
        this.emit('federation:room:created', { roomId, federationId, knowledgeSpace });

        return {
            room: { room_id: roomId, name },
            federationRoom
        };
    }

    /**
     * Verificar se usuário pode entrar na room (ACL da federação)
     */
    async canJoinRoom(roomId: string, did: string): Promise<{
        allowed: boolean;
        reason?: string;
        requiresInvite?: boolean;
    }> {
        // Encontrar federação da room
        const federationRoom = this.findFederationForRoom(roomId);
        if (!federationRoom) {
            // Room não está em nenhuma federação - livre
            return { allowed: true };
        }

        const federation = this.federationEngine.getFederation(federationRoom.federationId);
        if (!federation) {
            return { allowed: false, reason: 'Federation not found' };
        }

        // Verificar se já é membro da federação
        const isMember = federation.members.has(did);
        if (!isMember) {
            // Verificar se pode entrar na federação
            if (federationRoom.requiresInvitation) {
                return { 
                    allowed: false, 
                    reason: 'Invitation required to join federation',
                    requiresInvite: true
                };
            }

            // Tentar juntar à federação primeiro
            try {
                await this.federationEngine.joinFederation(
                    federationRoom.federationId,
                    did,
                    'Unknown' // Nome será atualizado depois
                );
            } catch (err: any) {
                return { allowed: false, reason: err.message };
            }
        }

        // Verificar políticas específicas da room
        const checkResult = this.federationEngine.checkPolicy(
            federation,
            'room:join',
            did
        );

        return {
            allowed: checkResult.allowed,
            reason: checkResult.reason
        };
    }

    /**
     * Listar rooms de uma federação
     */
    getFederationRooms(federationId: string): FederationRoom[] {
        return this.federationRooms.get(federationId) || [];
    }

    /**
     * Obter federação de uma room
     */
    findFederationForRoom(roomId: string): FederationRoom | undefined {
        for (const rooms of this.federationRooms.values()) {
            const room = rooms.find(r => r.roomId === roomId);
            if (room) return room;
        }
        return undefined;
    }

    // ═══════════════════════════════════════════════════════════════
    // FEDERATION MESH (Peering + Bridge + Sync)
    // ═══════════════════════════════════════════════════════════════

    async openMeshBridge(
        peeringId: string,
        localRoomId: string,
        remoteRoomId: string,
        rules?: Partial<MeshBridgeRules>
    ): Promise<FederationMeshBridge> {
        const peering = this.federationEngine.getPeering(peeringId);
        if (!peering) {
            throw new Error(`Peering ${peeringId} not found`);
        }
        if (peering.status !== 'active') {
            throw new Error(`Peering ${peeringId} is not active`);
        }

        const now = Date.now();
        const bridge: FederationMeshBridge = {
            id: `bridge_${ulid()}`,
            peeringId,
            localFederationId: peering.sourceFederationId,
            localRoomId,
            remoteRoomId,
            rules: this.mergeBridgeRules(peering.policy, rules),
            status: 'active',
            eventsIn: 0,
            eventsOut: 0,
            createdAt: now,
            updatedAt: now
        };

        this.meshBridges.set(bridge.id, bridge);
        this.persistMeshBridge(bridge);
        this.emit('mesh:bridge:opened', bridge);

        return bridge;
    }

    async closeMeshBridge(bridgeId: string): Promise<void> {
        const bridge = this.meshBridges.get(bridgeId);
        if (!bridge) {
            throw new Error(`Bridge ${bridgeId} not found`);
        }

        bridge.status = 'closed';
        bridge.updatedAt = Date.now();
        this.meshBridges.set(bridge.id, bridge);
        this.persistMeshBridge(bridge);
        this.storage.updateFederationBridgeStatus?.(bridge.id, 'closed', bridge.lastSyncAt);

        this.emit('mesh:bridge:closed', bridge);
    }

    listMeshBridges(
        federationId?: string,
        status?: FederationMeshBridge['status']
    ): FederationMeshBridge[] {
        return Array.from(this.meshBridges.values())
            .filter((bridge) => {
                if (federationId && bridge.localFederationId !== federationId) return false;
                if (status && bridge.status !== status) return false;
                return true;
            })
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async publishMeshEvent(
        bridgeId: string,
        envelope: SwpEnvelope
    ): Promise<{ delivered: boolean; reason?: string }> {
        const bridge = this.meshBridges.get(bridgeId);
        if (!bridge) {
            return { delivered: false, reason: `Bridge ${bridgeId} not found` };
        }
        if (bridge.status !== 'active') {
            return { delivered: false, reason: `Bridge ${bridgeId} is not active` };
        }

        const peering = this.federationEngine.getPeering(bridge.peeringId);
        if (!peering || peering.status !== 'active') {
            await this.closeMeshBridge(bridgeId);
            return { delivered: false, reason: `Peering ${bridge.peeringId} is not active` };
        }

        if (envelope.room !== bridge.localRoomId) {
            return { delivered: false, reason: 'Envelope room does not match bridge local room' };
        }

        if (!this.isMessageTypeAllowed(bridge.rules.allowedTypes, envelope.t)) {
            this.storage.appendFederationSyncLog?.({
                bridgeId: bridge.id,
                envelopeId: envelope.id,
                direction: 'out',
                messageType: envelope.t,
                fromFederationId: bridge.localFederationId,
                toFederationId: peering.targetFederationDid,
                status: 'rejected',
                error: `type ${envelope.t} blocked by mesh policy`,
                ts: Date.now()
            });
            return { delivered: false, reason: `Message type ${envelope.t} blocked by mesh policy` };
        }

        if (!this.consumeBridgeRateLimit(bridge)) {
            return { delivered: false, reason: `Rate limit exceeded for bridge ${bridge.id}` };
        }

        if (this.storage.hasFederationSyncLog?.(bridge.id, envelope.id, 'out')) {
            return { delivered: false, reason: 'Duplicate envelope blocked by sync log' };
        }

        const outboundEnvelope = this.applyPrivacyMode(envelope, bridge.rules.privacyMode);
        const payload = {
            bridge_id: bridge.id,
            peering_id: bridge.peeringId,
            source_federation_id: bridge.localFederationId,
            target_federation_did: peering.targetFederationDid,
            direction: 'out' as const,
            cursor: envelope.id,
            envelope: outboundEnvelope
        };

        try {
            await this.roomManager.sendMessage(
                bridge.remoteRoomId,
                payload as unknown as Record<string, unknown>,
                'federation.bridge.sync'
            );

            const now = Date.now();
            bridge.eventsOut += 1;
            bridge.lastSyncAt = now;
            bridge.updatedAt = now;
            this.meshBridges.set(bridge.id, bridge);
            this.persistMeshBridge(bridge);
            this.storage.incrementFederationBridgeCounters?.(bridge.id, 'out', 1, now);
            this.storage.saveFederationSyncCursor?.({
                bridgeId: bridge.id,
                direction: 'out',
                cursorId: envelope.id,
                updatedAt: now
            });
            this.storage.appendFederationSyncLog?.({
                bridgeId: bridge.id,
                envelopeId: envelope.id,
                direction: 'out',
                messageType: envelope.t,
                fromFederationId: bridge.localFederationId,
                toFederationId: peering.targetFederationDid,
                status: 'processed',
                ts: now
            });

            this.emit('mesh:event:published', {
                bridgeId: bridge.id,
                envelopeId: envelope.id,
                messageType: envelope.t
            });

            return { delivered: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.storage.appendFederationSyncLog?.({
                bridgeId: bridge.id,
                envelopeId: envelope.id,
                direction: 'out',
                messageType: envelope.t,
                fromFederationId: bridge.localFederationId,
                toFederationId: peering.targetFederationDid,
                status: 'failed',
                error: message,
                ts: Date.now()
            });
            return { delivered: false, reason: message };
        }
    }

    getMeshStats(federationId?: string): {
        bridgeCount: number;
        activeBridges: number;
        eventsIn: number;
        eventsOut: number;
        lastSyncAt?: number;
    } {
        if (this.storage.getFederationMeshStats) {
            return this.storage.getFederationMeshStats(federationId);
        }

        const bridges = this.listMeshBridges(federationId);
        let eventsIn = 0;
        let eventsOut = 0;
        let lastSyncAt: number | undefined;
        for (const bridge of bridges) {
            eventsIn += bridge.eventsIn;
            eventsOut += bridge.eventsOut;
            if (bridge.lastSyncAt && (!lastSyncAt || bridge.lastSyncAt > lastSyncAt)) {
                lastSyncAt = bridge.lastSyncAt;
            }
        }

        return {
            bridgeCount: bridges.length,
            activeBridges: bridges.filter((bridge) => bridge.status === 'active').length,
            eventsIn,
            eventsOut,
            lastSyncAt
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // KNOWLEDGE ↔ CoC INTEGRATION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Criar CoC vinculado a knowledge space
     */
    async createCoCWithKnowledge(
        roomId: string,
        goal: string,
        options?: {
            knowledgeSpaceId?: string;
            autoIndex?: boolean;
            template?: string;
        }
    ): Promise<{ chainId: string; binding?: CoCKnowledgeBinding }> {
        // Criar CoC
        const chainId = await this.cocEngine.openChain(
            roomId,
            goal,
            { templateId: options?.template }
        );

        // Criar ou usar knowledge space
        let knowledgeSpaceId = options?.knowledgeSpaceId;
        if (!knowledgeSpaceId && this.config.autoCreateKnowledgeSpace) {
            const space = await this.knowledgePool.createSpace(
                `CoC: ${goal.slice(0, 50)}`,
                `Knowledge generated from CoC ${chainId}`,
                'team',
                'room'
            );
            knowledgeSpaceId = space.id;
        }

        // Criar binding
        if (knowledgeSpaceId && (options?.autoIndex ?? this.config.autoIndexCoC)) {
            const binding: CoCKnowledgeBinding = {
                cocId: chainId,
                knowledgeSpaceId,
                autoIndexSteps: true,
                indexArtifacts: true,
                indexDecisions: true
            };
            this.cocKnowledgeBindings.set(chainId, binding);
            
            // Salvar no storage
            this.storage.saveCoCKnowledgeBinding?.(binding);
        }

        this.emit('coc:knowledge:linked', { chainId, knowledgeSpaceId });

        return { chainId, binding: this.cocKnowledgeBindings.get(chainId) };
    }

    /**
     * Indexar step do CoC como knowledge card
     */
    async indexStepAsKnowledge(
        chainId: string,
        stepId: string
    ): Promise<KnowledgeCard | undefined> {
        const binding = this.cocKnowledgeBindings.get(chainId);
        if (!binding || !binding.autoIndexSteps) {
            return undefined;
        }

        // Obter step do CoC
        const step = this.cocEngine.getStep(stepId);
        if (!step) return undefined;

        // Determinar tipo de knowledge
        let knowledgeType: KnowledgeCard['type'] = 'insight';
        if (step.kind === 'decision') knowledgeType = 'decision';
        else if (step.kind === 'synthesis') knowledgeType = 'document';
        else if (step.kind === 'task') knowledgeType = 'code';

        // Criar knowledge card
        const card = await this.knowledgePool.createCard(
            binding.knowledgeSpaceId,
            knowledgeType,
            step.title,
            step.result_memo || 'No content',
            {
                tags: ['coc-generated', step.kind, `chain-${chainId}`],
                source: {
                    type: 'coc',
                    id: chainId,
                    context: `Step ${stepId} in CoC ${chainId}`
                },
                privacy: 'federation'
            }
        );

        // Indexar artifacts se configurado
        if (binding.indexArtifacts && step.artifacts) {
            for (const artifactId of step.artifacts) {
                await this.linkArtifactToKnowledge(artifactId, card.id);
            }
        }

        this.emit('coc:step:indexed', { chainId, stepId, cardId: card.id });

        return card;
    }

    /**
     * Indexar decisão do CoC
     */
    async indexDecision(
        chainId: string,
        decision: string,
        rationale: string
    ): Promise<KnowledgeCard | undefined> {
        const binding = this.cocKnowledgeBindings.get(chainId);
        if (!binding || !binding.indexDecisions) {
            return undefined;
        }

        const card = await this.knowledgePool.createCard(
            binding.knowledgeSpaceId,
            'decision',
            `Decision: ${decision.slice(0, 100)}`,
            rationale,
            {
                tags: ['coc-decision', `chain-${chainId}`],
                source: { type: 'coc', id: chainId },
                privacy: 'federation'
            }
        );

        return card;
    }

    /**
     * Linkar artifact a knowledge card
     */
    private async linkArtifactToKnowledge(
        artifactId: string,
        knowledgeCardId: string
    ): Promise<void> {
        // Criar link no knowledge graph
        await this.knowledgePool.linkCards(
            knowledgeCardId,
            artifactId as any, // Artifact como pseudo-card
            'depends-on',
            0.9
        );
    }

    /**
     * Query knowledge relacionado a CoC
     */
    async queryKnowledgeForCoC(
        chainId: string,
        query: string
    ): Promise<KnowledgeCard[]> {
        const binding = this.cocKnowledgeBindings.get(chainId);
        if (!binding) {
            // Buscar em todos os spaces
            return this.knowledgePool.queryCards({ query });
        }

        return this.knowledgePool.queryCards({
            spaceId: binding.knowledgeSpaceId,
            query
        });
    }

    /**
     * Obter contexto de conhecimento para CoC
     */
    async getKnowledgeContextForCoC(chainId: string): Promise<string> {
        const binding = this.cocKnowledgeBindings.get(chainId);
        if (!binding) return '';

        // Obter collective unconscious do space
        const cu = this.knowledgePool.getCollectiveUnconscious(binding.knowledgeSpaceId);
        if (!cu) return '';

        return this.knowledgePool.getSharedContext(binding.knowledgeSpaceId);
    }

    // ═══════════════════════════════════════════════════════════════
    // SKILLS ↔ RUNTIME INTEGRATION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Executar skill com acesso a todos os módulos
     */
    async executeIntegratedSkill(
        skillId: string,
        inputs: Record<string, any>,
        context?: {
            roomId?: string;
            federationId?: string;
        }
    ): Promise<any> {
        // Criar contexto de segurança
        const securityContext: SecurityContext = {
            identity: this.identity,
            permissions: [], // Será preenchido baseado na skill
            sessionId: `session_${Date.now()}`,
            mfaVerified: false,
            reputation: 0,
            trustTier: 'bronze'
        };

        // Verificar permissões
        const resource = `skill:${skillId}`;
        const allowed = await this.securityManager.checkAccess(
            securityContext,
            resource,
            'execute'
        );

        if (!allowed) {
            throw new Error('Permission denied to execute skill');
        }

        // Enriquecer inputs com contexto
        const enrichedInputs = await this.enrichSkillInputs(inputs, context);

        // Executar skill
        const result = await this.skillsEngine.executeSkill(
            skillId,
            enrichedInputs,
            context ? {
                room: context.roomId,
                federation: context.federationId
            } : undefined
        );

        // Auditar
        await this.securityManager.audit.log({
            type: 'action',
            severity: 'info',
            actor: this.identity.did,
            resource,
            action: 'execute',
            result: result.status === 'completed' ? 'success' : 'failure',
            details: { skillId, inputs: Object.keys(inputs) }
        });

        return result;
    }

    /**
     * Enriquecer inputs de skill com contexto do sistema
     */
    private async enrichSkillInputs(
        inputs: Record<string, any>,
        context?: { roomId?: string; federationId?: string }
    ): Promise<Record<string, any>> {
        const enriched = { ...inputs };

        // Adicionar contexto compartilhado se room especificada
        if (context?.roomId && inputs.use_shared_context !== false) {
            const federationRoom = this.findFederationForRoom(context.roomId);
            if (federationRoom) {
                const knowledgeContext = await this.knowledgePool.getSharedContext(
                    federationRoom.roomId
                );
                enriched._sharedContext = knowledgeContext;
            }
        }

        // Adicionar info da federação
        if (context?.federationId) {
            const federation = this.federationEngine.getFederation(context.federationId);
            if (federation) {
                enriched._federation = {
                    name: federation.name,
                    policies: federation.policies.map(p => p.name)
                };
            }
        }

        return enriched;
    }

    // ═══════════════════════════════════════════════════════════════
    // SECURITY INTEGRATION (todos os módulos)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Processar envelope com segurança completa
     */
    async processSecureEnvelope(envelope: SwpEnvelope): Promise<{
        allowed: boolean;
        envelope?: SwpEnvelope;
        reason?: string;
    }> {
        // 1. Verificar ameaças
        const threatCheck = this.securityManager.threats.analyzeEnvelope(envelope);
        if (threatCheck.threat && threatCheck.severity === 'critical') {
            return { allowed: false, reason: 'Threat detected' };
        }

        // 2. Verificar ACL da federação/room
        if (this.config.enforceFederationACLs) {
            const federationRoom = this.findFederationForRoom(envelope.room);
            if (federationRoom) {
                const federation = this.federationEngine.getFederation(federationRoom.federationId);
                if (federation) {
                    const check = this.federationEngine.checkPolicy(
                        federation,
                        'message:send',
                        envelope.from.did
                    );
                    if (!check.allowed) {
                        return { allowed: false, reason: check.reason };
                    }
                }
            }
        }

        // 3. Processar com security manager
        return this.securityManager.processIncoming(envelope);
    }

    /**
     * Comprimir mensagem se configurado
     */
    async compressMessageIfNeeded(data: Uint8Array): Promise<{
        data: Uint8Array;
        compressed: boolean;
        algorithm?: string;
    }> {
        if (!this.config.autoCompressMessages || data.length < 1024) {
            return { data, compressed: false };
        }

        // Usar compressor do módulo de compression
        const { MessageCompressor } = await import('./compression.js');
        const compressor = new MessageCompressor({ algorithm: 'zstd' });
        
        const compressed = await compressor.compress(data);
        const stats = compressor.getCompressionStats(data.length, compressed.length);

        if (stats.savingsPercent > 20) {
            return { data: compressed, compressed: true, algorithm: 'zstd' };
        }

        return { data, compressed: false };
    }

    // ═══════════════════════════════════════════════════════════════
    // HOOKS SETUP
    // ═══════════════════════════════════════════════════════════════

    private setupHooks(): void {
        // Hook: CoC step completed → Indexar como knowledge
        this.cocEngine.on('step:submitted', async (chainId: string, stepId: string) => {
            if (this.config.autoIndexCoC) {
                try {
                    await this.indexStepAsKnowledge(chainId, stepId);
                } catch (err) {
                    console.error('Failed to index step:', err);
                }
            }
        });

        // Hook: CoC completed → Indexar decisões
        this.cocEngine.on('chain:completed', async (chainId: string) => {
            const binding = this.cocKnowledgeBindings.get(chainId);
            if (binding?.indexDecisions) {
                const chain = this.cocEngine.getChain(chainId);
                if (chain?.final_report) {
                    await this.indexDecision(chainId, 'CoC Completed', chain.final_report);
                }
            }
        });

        // Hook: Knowledge criado → Notificar room
        this.knowledgePool.on('card:created', async (card: KnowledgeCard) => {
            // Notificar room se o card for público/federation
            if (card.privacy !== 'private') {
                this.emit('knowledge:shared', card);
            }
        });

        // Hook: Federation member joined → Adicionar às rooms
        this.federationEngine.on('federation:member:joined', async (federationId: string, member: any) => {
            const rooms = this.getFederationRooms(federationId);
            for (const room of rooms) {
                if (!room.requiresInvitation) {
                    this.storage.addRoomMember(room.roomId, member.did, member.displayName);
                }
            }
        });

        // Hook: Mesh federation events routed by RoomManager
        this.roomManager.on('federation:event', async (_roomId: string, envelope: SwpEnvelope) => {
            try {
                await this.handleMeshEnvelope(envelope);
            } catch (err) {
                console.warn('[integration] Failed to handle mesh envelope:', (err as Error).message);
            }
        });

        this.roomManager.on('persona:event', async (roomId: string, envelope: SwpEnvelope) => {
            try {
                await this.handlePersonaEnvelope(roomId, envelope);
            } catch (err) {
                console.warn('[integration] Failed to handle persona envelope:', (err as Error).message);
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // UTILS
    // ═══════════════════════════════════════════════════════════════

    private loadFromStorage(): void {
        // Federation rooms
        const federations = this.storage.getFederations?.() || [];
        for (const federation of federations) {
            const rooms = this.storage.getFederationRooms?.(federation.id) || [];
            if (rooms.length > 0) {
                this.federationRooms.set(federation.id, rooms);
            }
        }

        // CoC knowledge bindings
        try {
            const bindings = this.storage.query(
                'SELECT coc_id, knowledge_space_id, auto_index_steps, index_artifacts, index_decisions FROM coc_knowledge_bindings'
            );
            for (const row of bindings) {
                this.cocKnowledgeBindings.set(row.coc_id, {
                    cocId: row.coc_id,
                    knowledgeSpaceId: row.knowledge_space_id,
                    autoIndexSteps: !!row.auto_index_steps,
                    indexArtifacts: !!row.index_artifacts,
                    indexDecisions: !!row.index_decisions
                });
            }
        } catch {
            // Optional table may not exist in early schemas
        }

        // Mesh bridges
        const bridges = this.storage.listFederationBridges?.() || [];
        for (const row of bridges) {
            const bridge: FederationMeshBridge = {
                id: row.bridgeId,
                peeringId: row.peeringId,
                localFederationId: row.localFederationId,
                localRoomId: row.localRoomId,
                remoteRoomId: row.remoteRoomId,
                rules: this.mergeBridgeRules(undefined, row.rules as Partial<MeshBridgeRules>),
                status: row.status,
                eventsIn: row.eventsIn,
                eventsOut: row.eventsOut,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                lastSyncAt: row.lastSyncAt
            };
            this.meshBridges.set(bridge.id, bridge);
        }
    }

    private persistMeshBridge(bridge: FederationMeshBridge): void {
        this.storage.saveFederationBridge?.({
            bridgeId: bridge.id,
            peeringId: bridge.peeringId,
            localFederationId: bridge.localFederationId,
            localRoomId: bridge.localRoomId,
            remoteRoomId: bridge.remoteRoomId,
            rules: bridge.rules as unknown as Record<string, unknown>,
            status: bridge.status,
            eventsIn: bridge.eventsIn,
            eventsOut: bridge.eventsOut,
            lastSyncAt: bridge.lastSyncAt,
            createdAt: bridge.createdAt,
            updatedAt: bridge.updatedAt
        });
    }

    private mergeBridgeRules(
        policy?: Partial<FederationPeeringPolicy>,
        rules?: Partial<MeshBridgeRules>
    ): MeshBridgeRules {
        const allowedTypes = rules?.allowedTypes?.length
            ? rules.allowedTypes
            : policy?.allowedTypes?.length
                ? policy.allowedTypes
                : ['chat.msg', 'coc.open', 'coc.plan', 'coc.submit', 'federation.bridge.sync', 'persona.sync.delta', 'persona.capability.revoke'];

        const maxRatePerMinute = Number(rules?.maxRatePerMinute ?? policy?.maxRatePerMinute ?? 200);

        return {
            allowedTypes,
            maxRatePerMinute:
                Number.isFinite(maxRatePerMinute) && maxRatePerMinute > 0
                    ? Math.floor(maxRatePerMinute)
                    : 200,
            privacyMode: rules?.privacyMode || policy?.privacyMode || 'summary'
        };
    }

    private isMessageTypeAllowed(allowed: string[], messageType: string): boolean {
        return allowed.some((pattern) => this.matchesMessageTypePattern(pattern, messageType));
    }

    private matchesMessageTypePattern(pattern: string, messageType: string): boolean {
        if (pattern === '*') return true;
        if (pattern.endsWith('*')) {
            return messageType.startsWith(pattern.slice(0, -1));
        }
        return pattern === messageType;
    }

    private consumeBridgeRateLimit(bridge: FederationMeshBridge): boolean {
        const now = Date.now();
        const current = this.bridgeRateLimits.get(bridge.id);
        if (!current || now - current.windowStartedAt >= 60_000) {
            this.bridgeRateLimits.set(bridge.id, { windowStartedAt: now, count: 1 });
            return true;
        }

        if (current.count >= bridge.rules.maxRatePerMinute) {
            return false;
        }

        current.count += 1;
        this.bridgeRateLimits.set(bridge.id, current);
        return true;
    }

    private applyPrivacyMode(
        envelope: SwpEnvelope,
        mode: MeshBridgeRules['privacyMode']
    ): SwpEnvelope {
        if (mode === 'full') {
            return envelope;
        }

        if (mode === 'metadata-only') {
            return {
                ...envelope,
                body: {
                    redacted: true,
                    original_type: envelope.t,
                    original_id: envelope.id,
                    original_ts: envelope.ts
                }
            };
        }

        const body = envelope.body as Record<string, unknown>;
        if (envelope.t === 'chat.msg') {
            const text = typeof body.text === 'string' ? body.text : '';
            return {
                ...envelope,
                body: {
                    summary: text.length > 180 ? `${text.slice(0, 180)}...` : text,
                    has_attachments: Array.isArray(body.attachments) && body.attachments.length > 0
                }
            };
        }

        if (envelope.t.startsWith('coc.')) {
            return {
                ...envelope,
                body: {
                    chain_id: body.chain_id,
                    step_id: body.step_id,
                    status: body.status,
                    kind: body.kind
                }
            };
        }

        return envelope;
    }

    private async handleMeshEnvelope(envelope: SwpEnvelope): Promise<void> {
        if (envelope.t === 'federation.peer.revoke') {
            const body = envelope.body as { peering_id?: string };
            if (body.peering_id) {
                for (const bridge of this.meshBridges.values()) {
                    if (bridge.peeringId === body.peering_id && bridge.status === 'active') {
                        await this.closeMeshBridge(bridge.id);
                    }
                }
            }
            return;
        }

        if (envelope.t !== 'federation.bridge.sync') {
            return;
        }

        const body = envelope.body as {
            bridge_id?: string;
            peering_id?: string;
            source_federation_id?: string;
            target_federation_did?: string;
            envelope?: SwpEnvelope;
            cursor?: string;
        };

        if (!body.bridge_id) {
            return;
        }

        const bridge = this.meshBridges.get(body.bridge_id);
        if (!bridge || bridge.status !== 'active') {
            return;
        }

        const innerEnvelope = body.envelope || envelope;
        const envelopeId = innerEnvelope.id || body.cursor || envelope.id;
        const messageType = innerEnvelope.t || 'federation.bridge.sync';

        if (this.storage.hasFederationSyncLog?.(bridge.id, envelopeId, 'in')) {
            return;
        }

        if (!this.isMessageTypeAllowed(bridge.rules.allowedTypes, messageType)) {
            this.storage.appendFederationSyncLog?.({
                bridgeId: bridge.id,
                envelopeId,
                direction: 'in',
                messageType,
                fromFederationId: body.source_federation_id,
                toFederationId: bridge.localFederationId,
                status: 'rejected',
                error: `type ${messageType} blocked by mesh policy`,
                ts: Date.now()
            });
            return;
        }

        const now = Date.now();
        bridge.eventsIn += 1;
        bridge.lastSyncAt = now;
        bridge.updatedAt = now;
        this.meshBridges.set(bridge.id, bridge);
        this.persistMeshBridge(bridge);
        this.storage.incrementFederationBridgeCounters?.(bridge.id, 'in', 1, now);
        this.storage.saveFederationSyncCursor?.({
            bridgeId: bridge.id,
            direction: 'in',
            cursorId: envelopeId,
            updatedAt: now
        });
        this.storage.appendFederationSyncLog?.({
            bridgeId: bridge.id,
            envelopeId,
            direction: 'in',
            messageType,
            fromFederationId: body.source_federation_id,
            toFederationId: bridge.localFederationId,
            status: 'processed',
            ts: now
        });

        this.emit('mesh:event:received', {
            bridgeId: bridge.id,
            envelope: innerEnvelope,
            messageType
        });
    }

    private async handlePersonaEnvelope(roomId: string, envelope: SwpEnvelope): Promise<void> {
        if (!this.personaVault) return;

        if (envelope.t === 'persona.sync.delta') {
            const body = envelope.body as unknown as PersonaSyncDelta;
            const result = await this.personaVault.applySyncDelta(body);
            this.emit('persona:sync:applied', {
                roomId,
                deltaId: body.id,
                applied: result.applied,
                ignored: result.ignored
            });

            await this.roomManager.sendMessage(
                roomId,
                {
                    delta_id: body.id,
                    vault_id: body.vaultId,
                    applied: result.applied,
                    ignored: result.ignored,
                    cursor: result.cursor,
                    need_snapshot: result.applied === 0 && result.ignored > 0
                },
                'persona.sync.ack'
            );
            return;
        }

        if (envelope.t === 'persona.preference.update') {
            const body = envelope.body as {
                vault_id?: string;
                vaultId?: string;
                node?: Record<string, unknown>;
                node_id?: string;
                key?: string;
                value?: unknown;
                confidence?: number;
                domain?: string;
                tags?: string[];
            };

            const fallbackVaultId = this.storage.getPersonaVaults?.(this.identity.did)?.[0]?.id;
            const vaultId = body.vault_id || body.vaultId || fallbackVaultId;
            if (!vaultId) return;

            const node =
                body.node ||
                (body.key
                    ? {
                          id: body.node_id || `pref_${envelope.id}`,
                          vaultId,
                          domain: body.domain || 'preferences',
                          type: 'preference',
                          title: body.key,
                          content: JSON.stringify(body.value),
                          tags: body.tags || ['preference'],
                          confidence: body.confidence ?? 0.9,
                          source: { type: 'sync', actorDid: envelope.from.did },
                          metadata: { key: body.key, value: body.value },
                          createdAt: envelope.ts,
                          updatedAt: envelope.ts,
                      }
                    : undefined);

            if (!node) return;
            await this.personaVault.applySyncDelta({
                id: `delta_${envelope.id}`,
                vaultId,
                fromDid: envelope.from.did,
                operations: [{ type: 'node_upsert', payload: node }],
                vectorClock: { [envelope.from.did]: 1 },
                createdAt: envelope.ts,
            });
            return;
        }

        if (envelope.t === 'persona.sync.ack') {
            const body = envelope.body as {
                need_snapshot?: boolean;
                vault_id?: string;
                cursor?: string;
                reason?: string;
            };
            if (body.need_snapshot && body.vault_id) {
                const snapshot = await this.personaVault.exportSubgraph({
                    vaultId: body.vault_id,
                    includeNeighbors: true,
                });
                const delta = this.personaVault.buildSyncDelta({
                    vaultId: snapshot.vaultId,
                    operations: snapshot.nodes.map((node) => ({
                        type: 'node_upsert' as const,
                        payload: node as unknown as Record<string, unknown>,
                    })),
                    cursor: body.cursor,
                });
                await this.roomManager.sendMessage(roomId, delta as unknown as Record<string, unknown>, 'persona.sync.delta');
            }
            return;
        }

        if (envelope.t === 'persona.capability.revoke') {
            const body = envelope.body as { token_id?: string; reason?: string };
            if (body.token_id) {
                await this.personaVault.revokeCapability(body.token_id, body.reason || 'remote-revoke');
            }
            return;
        }

        if (envelope.t === 'persona.capability.attenuate') {
            const body = envelope.body as { token_id?: string; caveats_patch?: Record<string, unknown> };
            if (body.token_id) {
                await this.personaVault.attenuateCapability({
                    tokenId: body.token_id,
                    caveatsPatch: (body.caveats_patch || {}) as any,
                });
            }
            return;
        }

        if (envelope.t === 'persona.memory.upsert') {
            const body = envelope.body as any;
            await this.personaVault.applySyncDelta({
                id: `delta_${envelope.id}`,
                vaultId: body.vaultId,
                fromDid: envelope.from.did,
                operations: [{ type: 'node_upsert', payload: body.node }],
                vectorClock: body.vectorClock || { [envelope.from.did]: 1 },
                createdAt: envelope.ts,
            });
            return;
        }

        if (envelope.t === 'persona.claim.upsert') {
            const body = envelope.body as any;
            await this.personaVault.applySyncDelta({
                id: `delta_${envelope.id}`,
                vaultId: body.vaultId,
                fromDid: envelope.from.did,
                operations: [{ type: 'claim_upsert', payload: body.claim }],
                vectorClock: body.vectorClock || { [envelope.from.did]: 1 },
                createdAt: envelope.ts,
            });
            return;
        }

        if (envelope.t === 'persona.claim.revoke') {
            const body = envelope.body as any;
            await this.personaVault.applySyncDelta({
                id: `delta_${envelope.id}`,
                vaultId: body.vaultId,
                fromDid: envelope.from.did,
                operations: [{ type: 'claim_revoke', payload: { claimId: body.claimId } }],
                vectorClock: body.vectorClock || { [envelope.from.did]: 1 },
                createdAt: envelope.ts,
            });
            return;
        }

        if (envelope.t === 'persona.zkp.proof') {
            const body = envelope.body as any;
            await this.personaVault.applySyncDelta({
                id: `delta_${envelope.id}`,
                vaultId: body.vaultId,
                fromDid: envelope.from.did,
                operations: [{ type: 'zkp_proof_upsert', payload: body.proof }],
                vectorClock: body.vectorClock || { [envelope.from.did]: 1 },
                createdAt: envelope.ts,
            });
            return;
        }

        if (envelope.t === 'persona.edge.upsert') {
            const body = envelope.body as any;
            await this.personaVault.applySyncDelta({
                id: `delta_${envelope.id}`,
                vaultId: body.vaultId,
                fromDid: envelope.from.did,
                operations: [{ type: 'edge_upsert', payload: body.edge }],
                vectorClock: body.vectorClock || { [envelope.from.did]: 1 },
                createdAt: envelope.ts,
            });
            return;
        }

        if (envelope.t === 'persona.memory.delete') {
            const body = envelope.body as any;
            await this.personaVault.applySyncDelta({
                id: `delta_${envelope.id}`,
                vaultId: body.vaultId,
                fromDid: envelope.from.did,
                operations: [{ type: 'node_delete', payload: { nodeId: body.nodeId } }],
                vectorClock: body.vectorClock || { [envelope.from.did]: 1 },
                createdAt: envelope.ts,
            });
            return;
        }
    }

    /**
     * Obter estatísticas de integração
     */
    getStats(): {
        federationRooms: number;
        cocKnowledgeBindings: number;
        indexedSteps: number;
    } {
        let totalRooms = 0;
        for (const rooms of this.federationRooms.values()) {
            totalRooms += rooms.length;
        }

        return {
            federationRooms: totalRooms,
            cocKnowledgeBindings: this.cocKnowledgeBindings.size,
            indexedSteps: 0 // TODO: contar do storage
        };
    }
}

// ═══════════════════════════════════════════════════════════════
// DECORATORS (para facilitar uso)
// ═══════════════════════════════════════════════════════════════

/**
 * Decorator: Aplicar ACL da federação em método
 */
export function requireFederationPermission(
    resource: string,
    action: 'read' | 'write' | 'execute' | 'admin'
) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;

        descriptor.value = async function (...args: any[]) {
            // Verificação de permissão seria feita aqui
            // usando o integrationEngine da instância
            return originalMethod.apply(this, args);
        };

        return descriptor;
    };
}

// Types already exported via 'export interface'
export { IntegrationEngine };
export default IntegrationEngine;
