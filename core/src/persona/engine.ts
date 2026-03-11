import { EventEmitter } from 'events';
import crypto from 'crypto';
import * as Automerge from '@automerge/automerge';
import { ulid } from 'ulid';
import type { Storage } from '../storage.js';
import { publicKeyFromDid, verify as verifySignature } from '../identity.js';
import { DOMAIN_POLICIES, getDomainPolicy, redactByDomainOperation } from './domains.js';
import { PersonaLifecycle, type LifecycleState } from './lifecycle.js';
import { PersonaCapabilityManager } from './capabilities.js';
import { PersonaEmbeddingService } from './embeddings.js';
import { computePersonalizedPageRank, rankMemories } from './retrieval.js';
import { createPersonaDelta, mergeDomainDoc, mergeEdgeWeighted, mergeNodeLww } from './sync.js';
import { PersonaZkpEngine } from './zkp/engine.js';
import type {
    AddMemoryInput,
    CapabilityCaveats,
    CapabilityToken,
    CapabilityValidationInput,
    CapabilityValidationResult,
    ExportSubgraphInput,
    GenerateZkProofInput,
    GraphQueryInput,
    GraphQueryResult,
    IssueClaimInput,
    IssueCapabilityInput,
    LinkMemoryInput,
    MemoryQueryInput,
    MemoryQueryResult,
    PersonaClaim,
    PersonaEdge,
    PersonaHyperEdge,
    PersonaNode,
    PersonaSyncDelta,
    PersonaVault,
    PortableSubgraph,
    RunRetentionSweepInput,
    RunRetentionSweepResult,
    SyncApplyResult,
    VerifyPersonaAccessLogInput,
    VerifyPersonaAccessLogResult,
    VerifyZkProofInput,
    UpdateMemoryInput,
    UpdatePreferenceInput,
    ZkProofBundle,
    ZkVerifyResult,
} from './types.js';

export interface PersonaEngineConfig {
    defaultVaultName?: string;
    encryptionKey?: string;
    shortTermWindow?: number;
    emaAlpha?: number;
    onnxModelPath?: string;
}

interface EncryptedPayload {
    enc: true;
    iv: string;
    tag: string;
    data: string;
}

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
    const v = value as EncryptedPayload;
    return !!v && v.enc === true && typeof v.iv === 'string' && typeof v.tag === 'string' && typeof v.data === 'string';
}

export class PersonaVaultEngine extends EventEmitter {
    private capabilityManager: PersonaCapabilityManager;
    private lifecycle: PersonaLifecycle;
    private embeddings: PersonaEmbeddingService;
    private zkp: PersonaZkpEngine;
    private encryptionKey: Buffer;
    private claimSigningSecret: Buffer;
    private graphRankCache = new Map<string, Map<string, number>>();

    constructor(
        private storage: Storage,
        private identityDid: string,
        config: PersonaEngineConfig = {}
    ) {
        super();
        this.capabilityManager = new PersonaCapabilityManager(storage);
        this.lifecycle = new PersonaLifecycle(config.shortTermWindow ?? 50, config.emaAlpha ?? 0.15);
        this.embeddings = new PersonaEmbeddingService({ onnxModelPath: config.onnxModelPath });
        this.zkp = new PersonaZkpEngine(storage, identityDid);

        const rawKey =
            config.encryptionKey ||
            process.env.SOCIETY_PERSONA_FIELD_KEY ||
            crypto.createHash('sha256').update(`persona:${identityDid}`).digest('hex');
        this.encryptionKey = crypto.createHash('sha256').update(rawKey).digest();
        this.claimSigningSecret = crypto.createHash('sha256').update(`persona-claim:${rawKey}`).digest();

        if (config.defaultVaultName !== undefined) {
            this.ensureDefaultVault(config.defaultVaultName).catch(() => {});
        }
    }

    async createVault(input: { name: string; ownerDid?: string }): Promise<PersonaVault> {
        const now = Date.now();
        const vault: PersonaVault = {
            id: `vault_${ulid()}`,
            ownerDid: input.ownerDid || this.identityDid,
            name: input.name,
            createdAt: now,
            updatedAt: now,
            settings: {
                shortTermWindow: 50,
                emaAlpha: 0.15,
                maxShareResults: 200,
            },
        };

        this.storage.savePersonaVault?.(vault);
        this.emit('persona:vault:created', vault);
        return vault;
    }

    async addMemory(input: AddMemoryInput): Promise<PersonaNode> {
        const vaultId = await this.resolveVaultId(input.vaultId);
        const now = Date.now();
        const policy = getDomainPolicy(input.domain);

        const rawContent = input.content;
        const content = policy.sensitive ? '[ENCRYPTED]' : rawContent;
        const metadata: Record<string, unknown> = { ...(input.metadata || {}) };
        if (policy.sensitive) {
            metadata.encryptedContent = this.encrypt(rawContent);
        }

        const node: PersonaNode = {
            id: `pmem_${ulid()}`,
            vaultId,
            domain: input.domain,
            type: input.type,
            title: input.title,
            content,
            tags: input.tags || [],
            confidence: input.confidence ?? 0.8,
            source: input.source || { type: 'sdk', actorDid: this.identityDid },
            metadata,
            validFrom: input.validFrom,
            validTo: input.validTo,
            createdAt: now,
            updatedAt: now,
        };

        this.storage.upsertPersonaNode?.(node);
        await this.indexEmbedding(node);
        this.upsertLocalDomainDoc(vaultId, node.domain, {
            [node.id]: { title: node.title, updatedAt: node.updatedAt, deletedAt: node.deletedAt ?? null },
        });

        this.bumpLifecycle(vaultId, node);
        this.emit('persona:memory:added', node);
        return this.inflateNode(node);
    }

    async updateMemory(nodeId: string, patch: UpdateMemoryInput): Promise<PersonaNode> {
        const current = this.storage.getPersonaNode?.(nodeId) as PersonaNode | undefined;
        if (!current || current.deletedAt) {
            throw new Error(`Persona node not found: ${nodeId}`);
        }

        const policy = getDomainPolicy(current.domain);
        const merged: PersonaNode = {
            ...current,
            title: patch.title ?? current.title,
            content: patch.content !== undefined ? (policy.sensitive ? '[ENCRYPTED]' : patch.content) : current.content,
            tags: patch.tags ?? current.tags,
            confidence: patch.confidence ?? current.confidence,
            metadata: {
                ...current.metadata,
                ...(patch.metadata || {}),
            },
            validFrom: patch.validFrom ?? current.validFrom,
            validTo: patch.validTo ?? current.validTo,
            updatedAt: Date.now(),
        };

        if (policy.sensitive && patch.content !== undefined) {
            merged.metadata = {
                ...merged.metadata,
                encryptedContent: this.encrypt(patch.content),
            };
        }

        this.storage.upsertPersonaNode?.(merged);
        await this.indexEmbedding(merged);
        this.upsertLocalDomainDoc(merged.vaultId, merged.domain, {
            [merged.id]: { title: merged.title, updatedAt: merged.updatedAt, deletedAt: merged.deletedAt ?? null },
        });
        this.bumpLifecycle(merged.vaultId, merged);
        this.emit('persona:memory:updated', merged);
        return this.inflateNode(merged);
    }

    async deleteMemory(nodeId: string, _reason?: string): Promise<void> {
        const current = this.storage.getPersonaNode?.(nodeId) as PersonaNode | undefined;
        if (!current || current.deletedAt) return;
        this.storage.softDeletePersonaNode?.(nodeId, Date.now());
        this.storage.deletePersonaEmbedding?.(nodeId);
        this.upsertLocalDomainDoc(current.vaultId, current.domain, {
            [nodeId]: { deletedAt: Date.now() },
        });
        this.emit('persona:memory:deleted', { nodeId, vaultId: current.vaultId });
    }

    async linkMemories(input: LinkMemoryInput): Promise<PersonaEdge> {
        const source = this.storage.getPersonaNode?.(input.sourceNodeId) as PersonaNode | undefined;
        const target = this.storage.getPersonaNode?.(input.targetNodeId) as PersonaNode | undefined;
        if (!source || !target) {
            throw new Error('Cannot create edge: source or target node not found');
        }

        const edge: PersonaEdge = {
            id: `pedge_${ulid()}`,
            vaultId: input.vaultId || source.vaultId,
            sourceNodeId: input.sourceNodeId,
            targetNodeId: input.targetNodeId,
            type: input.type,
            weight: input.weight ?? 0.8,
            confidence: input.confidence ?? 0.8,
            metadata: input.metadata || {},
            validFrom: input.validFrom,
            validTo: input.validTo,
            updatedAt: Date.now(),
        };

        this.storage.upsertPersonaEdge?.(edge);
        this.emit('persona:edge:upserted', edge);
        return edge;
    }

    async queryMemories(input: MemoryQueryInput): Promise<MemoryQueryResult> {
        const startedAt = Date.now();
        const vaultId = await this.resolveVaultId(input.vaultId);

        const nodes = (this.storage.listPersonaNodes?.(vaultId, {
            includeDeleted: input.includeDeleted,
            domain: input.domain,
            domains: input.domains,
            types: input.types,
            tags: input.tags,
        }) || []) as PersonaNode[];
        const edges = (this.storage.listPersonaEdges?.(vaultId) || []) as PersonaEdge[];

        const hydratedNodes = nodes.map((n) => this.inflateNode(n));
        const graphRank = this.getOrBuildGraphRank(vaultId, hydratedNodes, edges, input);
        let result = rankMemories(hydratedNodes, edges, input, { graphRank });

        // Blend with FTS when query is present.
        if (input.query && input.query.trim()) {
            const fts = (this.storage.searchPersonaNodes?.(vaultId, input.query, input.limit || 20) || []) as Array<{ id: string; score: number }>;
            const ftsMap = new Map(fts.map((r) => [r.id, r.score]));
            const embedding = await this.embeddings.embedText(input.query);
            const vectorRows = (this.storage.searchPersonaVector?.(vaultId, embedding.vector, input.limit || 20) || []) as Array<{ nodeId: string; score: number }>;
            const vectorMap = new Map(vectorRows.map((r) => [r.nodeId, r.score]));
            result = {
                ...result,
                nodes: result.nodes
                    .map((node) => {
                        const lexical = Math.max(node.scoreBreakdown.lexical || 0, ftsMap.get(node.id) || 0);
                        const vector = vectorMap.get(node.id) || 0;
                        const graph = node.scoreBreakdown.graph || 0;
                        const final = 0.4 * lexical + 0.35 * vector + 0.25 * graph;
                        return {
                            ...node,
                            score: final,
                            scoreBreakdown: {
                                lexical,
                                vector,
                                graph,
                                final,
                            },
                        };
                    })
                    .sort((a, b) => b.score - a.score),
            };
        }

        const elapsed = Date.now() - startedAt;
        this.recordMetric('persona.query.latency_ms', elapsed, {
            vaultId,
            domain: input.domain || (input.domains?.join(',') || '*'),
            query: input.query ? 'yes' : 'no',
            resultCount: result.nodes.length,
        });

        return {
            ...result,
            elapsedMs: elapsed,
        };
    }

    async queryGraph(input: GraphQueryInput): Promise<GraphQueryResult> {
        const vaultId = await this.resolveVaultId(input.vaultId);
        const maxDepth = Math.max(1, input.maxDepth || 2);
        const limit = Math.max(1, input.limit || 200);

        const allNodes = (this.storage.listPersonaNodes?.(vaultId, {
            includeDeleted: false,
            domain: input.domain,
        }) || []) as PersonaNode[];
        const allEdges = (this.storage.listPersonaEdges?.(vaultId) || []) as PersonaEdge[];
        const allHyperEdges = (this.storage.listPersonaHyperEdges?.(vaultId) || []) as PersonaHyperEdge[];

        if (!input.rootNodeId) {
            return {
                nodes: allNodes.slice(0, limit).map((n) => this.inflateNode(n)),
                edges: allEdges.slice(0, limit),
                hyperEdges: allHyperEdges.slice(0, limit),
            };
        }

        const visited = new Set<string>([input.rootNodeId]);
        let frontier = new Set<string>([input.rootNodeId]);
        for (let depth = 0; depth < maxDepth; depth++) {
            const next = new Set<string>();
            for (const edge of allEdges) {
                if (edge.deletedAt) continue;
                if (frontier.has(edge.sourceNodeId) && !visited.has(edge.targetNodeId)) {
                    visited.add(edge.targetNodeId);
                    next.add(edge.targetNodeId);
                }
                if (frontier.has(edge.targetNodeId) && !visited.has(edge.sourceNodeId)) {
                    visited.add(edge.sourceNodeId);
                    next.add(edge.sourceNodeId);
                }
            }
            frontier = next;
            if (frontier.size === 0) break;
        }

        const nodes = allNodes.filter((n) => visited.has(n.id)).slice(0, limit).map((n) => this.inflateNode(n));
        const edges = allEdges.filter((e) => visited.has(e.sourceNodeId) && visited.has(e.targetNodeId)).slice(0, limit);
        const hyperEdges = allHyperEdges.filter((h) => h.nodeIds.some((id) => visited.has(id))).slice(0, limit);
        return { nodes, edges, hyperEdges };
    }

    async updatePreference(input: UpdatePreferenceInput): Promise<PersonaNode> {
        const node = await this.addMemory({
            vaultId: input.vaultId,
            domain: input.domain || 'preferences',
            type: 'preference',
            title: input.key,
            content: JSON.stringify(input.value),
            confidence: input.confidence ?? 0.9,
            tags: ['preference', ...(input.tags || [])],
            metadata: { key: input.key, value: input.value },
            source: { type: 'sdk', actorDid: this.identityDid },
        });
        this.emit('persona:preference:updated', node);
        return node;
    }

    async verifyPersonaAccessLog(input: VerifyPersonaAccessLogInput): Promise<VerifyPersonaAccessLogResult> {
        const log = this.storage.getPersonaAccessLog?.(input.logId);
        if (!log) {
            return { logId: input.logId, valid: false, reason: 'Log not found' };
        }
        if (!log.signature) {
            return { logId: input.logId, valid: false, reason: 'Missing signature' };
        }
        if (!log.signerDid) {
            return { logId: input.logId, valid: false, reason: 'Missing signer DID' };
        }
        if (log.sigAlg && log.sigAlg !== 'ed25519') {
            return { logId: input.logId, valid: false, reason: `Unsupported signature algorithm: ${log.sigAlg}` };
        }

        const payload = JSON.stringify({
            vaultId: log.vaultId,
            tokenId: log.tokenId || null,
            serviceDid: log.serviceDid,
            operation: log.operation,
            resource: log.resource,
            result: log.result,
            details: log.details || null,
            ts: log.ts,
        });
        const payloadBase64 = Buffer.from(new TextEncoder().encode(payload)).toString('base64');
        const valid = verifySignature(publicKeyFromDid(log.signerDid), payloadBase64, log.signature);
        if (!valid) {
            return { logId: input.logId, valid: false, reason: 'Invalid signature' };
        }
        return { logId: input.logId, valid: true };
    }

    async runRetentionSweep(input: RunRetentionSweepInput = {}): Promise<RunRetentionSweepResult> {
        const now = Date.now();
        const domains = input.domain
            ? [input.domain]
            : (Object.keys(DOMAIN_POLICIES) as Array<keyof typeof DOMAIN_POLICIES>);

        const vaultIds = input.vaultId
            ? [input.vaultId]
            : (this.storage.getPersonaVaults?.(this.identityDid)?.map((vault: PersonaVault) => vault.id) || []);

        let scanned = 0;
        let deleted = 0;

        for (const vaultId of vaultIds) {
            for (const domain of domains) {
                const policy = getDomainPolicy(domain);
                const cutoff = now - policy.retentionDays * 24 * 60 * 60 * 1000;
                const nodes = (this.storage.listPersonaNodes?.(vaultId, {
                    includeDeleted: false,
                    domain,
                }) || []) as PersonaNode[];
                scanned += nodes.length;
                const stale = nodes.filter((node) => {
                    const ageMarker = node.validTo ?? node.updatedAt ?? node.createdAt;
                    return ageMarker <= cutoff;
                });
                if (!input.dryRun) {
                    for (const node of stale) {
                        this.storage.softDeletePersonaNode?.(node.id, now);
                        this.storage.deletePersonaEmbedding?.(node.id);
                        deleted += 1;
                    }
                }
                this.storage.upsertPersonaRetentionState?.({
                    vaultId,
                    domain,
                    lastCleanupAt: now,
                });
            }
        }

        this.recordMetric('persona.retention.sweep.scanned', scanned, {
            vaultCount: vaultIds.length,
            domainCount: domains.length,
            dryRun: !!input.dryRun,
        });
        this.recordMetric('persona.retention.sweep.deleted', deleted, {
            vaultCount: vaultIds.length,
            domainCount: domains.length,
            dryRun: !!input.dryRun,
        });

        return { scanned, deleted };
    }

    async issueCapability(input: IssueCapabilityInput) {
        const vaultId = await this.resolveVaultId(input.vaultId);
        const cap = this.capabilityManager.issue({ ...input, vaultId });
        this.emit('persona:capability:issued', cap);
        return cap;
    }

    async attenuateCapability(input: { tokenId: string; caveatsPatch: Partial<CapabilityCaveats> }): Promise<CapabilityToken> {
        const cap = this.capabilityManager.attenuate(input.tokenId, input.caveatsPatch);
        this.emit('persona:capability:attenuated', cap);
        return cap;
    }

    async revokeCapability(tokenId: string, reason: string): Promise<void> {
        this.capabilityManager.revoke(tokenId, reason);
        this.emit('persona:capability:revoked', { tokenId, reason });
    }

    validateCapability(input: CapabilityValidationInput): CapabilityValidationResult {
        return this.capabilityManager.validate(input);
    }

    async issueClaim(input: IssueClaimInput): Promise<PersonaClaim> {
        const vaultId = await this.resolveVaultId(input.vaultId);
        const now = Date.now();
        const subjectDid = input.subjectDid || this.identityDid;
        const payloadEnc = this.encrypt(JSON.stringify(input.payload));
        const payloadForSig = JSON.stringify({
            vaultId,
            subjectDid,
            issuerDid: input.issuerDid || this.identityDid,
            schema: input.schema,
            payload: input.payload,
            issuedAt: now,
            expiresAt: input.expiresAt,
        });

        if (input.issuerDid && input.issuerSignature) {
            const ok = verifySignature(
                publicKeyFromDid(input.issuerDid),
                payloadForSig,
                input.issuerSignature
            );
            if (!ok) {
                throw new Error('Invalid issuer signature for claim');
            }
        }

        const signature = crypto
            .createHmac('sha256', this.claimSigningSecret)
            .update(payloadForSig)
            .digest('base64url');

        const claim: PersonaClaim = {
            id: `claim_${ulid()}`,
            vaultId,
            subjectDid,
            issuerDid: input.issuerDid || this.identityDid,
            schema: input.schema,
            payload: input.payload,
            status: 'active',
            issuedAt: now,
            expiresAt: input.expiresAt,
            signature,
        };

        this.storage.savePersonaClaim?.({
            id: claim.id,
            vaultId: claim.vaultId,
            subjectDid: claim.subjectDid,
            issuerDid: claim.issuerDid,
            schema: claim.schema,
            payloadEnc: JSON.stringify(payloadEnc),
            status: claim.status,
            issuedAt: claim.issuedAt,
            expiresAt: claim.expiresAt,
            signature: claim.signature,
        });
        this.emit('persona:claim:issued', claim);
        return claim;
    }

    async revokeClaim(claimId: string, _reason: string): Promise<void> {
        this.storage.updatePersonaClaimStatus?.(claimId, 'revoked');
        this.emit('persona:claim:revoked', { claimId });
    }

    async generateZkProof(input: GenerateZkProofInput): Promise<ZkProofBundle> {
        const vaultId = await this.resolveVaultId(input.vaultId);
        const bundle = this.zkp.generateProof(vaultId, input);
        this.emit('persona:zkp:generated', bundle);
        return bundle;
    }

    async verifyZkProof(input: VerifyZkProofInput): Promise<ZkVerifyResult> {
        const startedAt = Date.now();
        const result = this.zkp.verifyProof(input);
        this.recordMetric('persona.zkp.verify.latency_ms', Date.now() - startedAt, {
            circuitId: result.circuitId,
            valid: result.valid,
        });
        this.emit('persona:zkp:verified', result);
        return result;
    }

    async applySyncDelta(delta: PersonaSyncDelta): Promise<SyncApplyResult> {
        const startedAt = Date.now();
        const vaultId = await this.resolveVaultId(delta.vaultId);
        if (vaultId !== delta.vaultId) {
            const result = { applied: 0, ignored: delta.operations.length, cursor: delta.id };
            this.recordMetric('persona.sync.apply.latency_ms', Date.now() - startedAt, {
                vaultId: delta.vaultId,
                applied: result.applied,
                ignored: result.ignored,
                reason: 'vault-mismatch',
            });
            return result;
        }

        if (this.storage.hasPersonaSyncApplied?.(delta.fromDid, delta.id)) {
            const result = { applied: 0, ignored: delta.operations.length, cursor: delta.id };
            this.recordMetric('persona.sync.apply.latency_ms', Date.now() - startedAt, {
                vaultId: delta.vaultId,
                applied: result.applied,
                ignored: result.ignored,
                reason: 'delta-already-applied',
            });
            return result;
        }

        const requiredProofs = new Set<string>();
        for (const op of delta.operations) {
            if (
                op.type === 'node_upsert' ||
                op.type === 'node_delete' ||
                op.type === 'edge_upsert' ||
                op.type === 'edge_delete' ||
                op.type === 'claim_upsert'
            ) {
                const payload = op.payload as Record<string, unknown>;
                const nestedNode =
                    payload.node && typeof payload.node === 'object'
                        ? (payload.node as Record<string, unknown>)
                        : undefined;
                const domainRaw =
                    (typeof payload.domain === 'string' ? payload.domain : undefined) ||
                    (nestedNode && typeof nestedNode.domain === 'string' ? nestedNode.domain : '') ||
                    '';
                const domain = String(domainRaw).toLowerCase();
                if (domain === 'health' || domain === 'finance' || domain === 'identity') {
                    requiredProofs.add('domain_membership');
                }
            }
            if (op.type === 'capability_revoke' || op.type === 'capability_attenuate') {
                requiredProofs.add('capability_possession');
            }
        }
        if (requiredProofs.size > 0) {
            const proofs = delta.proofs || [];
            for (const required of requiredProofs) {
                const found = proofs.find((p) => p.circuitId === required);
                if (!found) {
                    const result = {
                        applied: 0,
                        ignored: delta.operations.length,
                        cursor: delta.id,
                    };
                    this.recordMetric('persona.sync.apply.latency_ms', Date.now() - startedAt, {
                        vaultId: delta.vaultId,
                        applied: result.applied,
                        ignored: result.ignored,
                        reason: 'missing-proof',
                    });
                    return result;
                }
                const verified = await this.verifyZkProof({
                    vaultId: delta.vaultId,
                    proofBundle: found,
                });
                if (!verified.valid) {
                    const result = {
                        applied: 0,
                        ignored: delta.operations.length,
                        cursor: delta.id,
                    };
                    this.recordMetric('persona.sync.apply.latency_ms', Date.now() - startedAt, {
                        vaultId: delta.vaultId,
                        applied: result.applied,
                        ignored: result.ignored,
                        reason: 'invalid-proof',
                    });
                    return result;
                }
            }
        }

        let applied = 0;
        let ignored = 0;

        for (const op of delta.operations) {
            switch (op.type) {
                case 'node_upsert': {
                    const incoming = op.payload as unknown as PersonaNode;
                    const local = this.storage.getPersonaNode?.(incoming.id) as PersonaNode | undefined;
                    const merged = mergeNodeLww(local, incoming);
                    this.storage.upsertPersonaNode?.(merged);
                    await this.indexEmbedding(merged);
                    this.mergeCrdtDomainDoc({
                        vaultId: merged.vaultId,
                        domain: merged.domain,
                        patch: {
                            nodes: {
                                [merged.id]: {
                                    id: merged.id,
                                    title: merged.title,
                                    updatedAt: merged.updatedAt,
                                    deletedAt: merged.deletedAt ?? null,
                                },
                            },
                        },
                        clock: delta.vectorClock,
                    });
                    applied += 1;
                    break;
                }
                case 'node_delete': {
                    const nodeId = String(op.payload.nodeId || '');
                    if (!nodeId) {
                        ignored += 1;
                        break;
                    }
                    const existing = this.storage.getPersonaNode?.(nodeId) as PersonaNode | undefined;
                    this.storage.softDeletePersonaNode?.(nodeId, Date.now());
                    this.storage.deletePersonaEmbedding?.(nodeId);
                    if (existing) {
                        this.mergeCrdtDomainDoc({
                            vaultId: existing.vaultId,
                            domain: existing.domain,
                            patch: {
                                nodes: {
                                    [nodeId]: {
                                        id: nodeId,
                                        deletedAt: Date.now(),
                                    },
                                },
                            },
                            clock: delta.vectorClock,
                        });
                    }
                    applied += 1;
                    break;
                }
                case 'edge_upsert': {
                    const incoming = op.payload as unknown as PersonaEdge;
                    const local = this.storage.getPersonaEdge?.(incoming.id) as PersonaEdge | undefined;
                    const merged = mergeEdgeWeighted(local, incoming);
                    this.storage.upsertPersonaEdge?.(merged);
                    const sourceNode = this.storage.getPersonaNode?.(merged.sourceNodeId) as PersonaNode | undefined;
                    this.mergeCrdtDomainDoc({
                        vaultId: merged.vaultId,
                        domain: sourceNode?.domain || 'general',
                        patch: {
                            edges: {
                                [merged.id]: {
                                    id: merged.id,
                                    sourceNodeId: merged.sourceNodeId,
                                    targetNodeId: merged.targetNodeId,
                                    confidence: merged.confidence,
                                    weight: merged.weight,
                                    updatedAt: merged.updatedAt,
                                },
                            },
                        },
                        clock: delta.vectorClock,
                    });
                    applied += 1;
                    break;
                }
                case 'edge_delete': {
                    const edgeId = String(op.payload.edgeId || '');
                    if (!edgeId) {
                        ignored += 1;
                        break;
                    }
                    const existing = this.storage.getPersonaEdge?.(edgeId) as PersonaEdge | undefined;
                    this.storage.softDeletePersonaEdge?.(edgeId, Date.now());
                    if (existing) {
                        const sourceNode = this.storage.getPersonaNode?.(existing.sourceNodeId) as PersonaNode | undefined;
                        this.mergeCrdtDomainDoc({
                            vaultId: existing.vaultId,
                            domain: sourceNode?.domain || 'general',
                            patch: {
                                edges: {
                                    [edgeId]: {
                                        id: edgeId,
                                        deletedAt: Date.now(),
                                    },
                                },
                            },
                            clock: delta.vectorClock,
                        });
                    }
                    applied += 1;
                    break;
                }
                case 'capability_revoke': {
                    const tokenId = String(op.payload.tokenId || '');
                    const reason = String(op.payload.reason || 'sync-revocation');
                    if (!tokenId) {
                        ignored += 1;
                        break;
                    }
                    this.storage.updatePersonaCapabilityStatus?.(tokenId, 'revoked', reason, Date.now());
                    applied += 1;
                    break;
                }
                case 'capability_attenuate': {
                    const tokenId = String(op.payload.tokenId || '');
                    const caveatsPatch = (op.payload.caveatsPatch || {}) as Partial<CapabilityCaveats>;
                    if (!tokenId) {
                        ignored += 1;
                        break;
                    }
                    this.capabilityManager.attenuate(tokenId, caveatsPatch);
                    applied += 1;
                    break;
                }
                case 'claim_upsert': {
                    const claim = op.payload as unknown as PersonaClaim;
                    if (!claim?.id) {
                        ignored += 1;
                        break;
                    }
                    this.storage.savePersonaClaim?.({
                        id: claim.id,
                        vaultId: claim.vaultId,
                        subjectDid: claim.subjectDid,
                        issuerDid: claim.issuerDid,
                        schema: claim.schema,
                        payloadEnc: JSON.stringify(this.encrypt(JSON.stringify(claim.payload || {}))),
                        status: claim.status,
                        issuedAt: claim.issuedAt,
                        expiresAt: claim.expiresAt,
                        revokedAt: claim.revokedAt,
                        signature: claim.signature,
                    });
                    this.mergeCrdtDomainDoc({
                        vaultId: claim.vaultId,
                        domain: 'identity',
                        patch: {
                            claims: {
                                [claim.id]: {
                                    id: claim.id,
                                    schema: claim.schema,
                                    status: claim.status,
                                    updatedAt: claim.issuedAt,
                                },
                            },
                        },
                        clock: delta.vectorClock,
                    });
                    applied += 1;
                    break;
                }
                case 'claim_revoke': {
                    const claimId = String(op.payload.claimId || '');
                    if (!claimId) {
                        ignored += 1;
                        break;
                    }
                    this.storage.updatePersonaClaimStatus?.(claimId, 'revoked');
                    this.mergeCrdtDomainDoc({
                        vaultId: delta.vaultId,
                        domain: 'identity',
                        patch: {
                            claims: {
                                [claimId]: {
                                    id: claimId,
                                    status: 'revoked',
                                    updatedAt: Date.now(),
                                },
                            },
                        },
                        clock: delta.vectorClock,
                    });
                    applied += 1;
                    break;
                }
                case 'zkp_proof_upsert': {
                    const proof = op.payload as unknown as ZkProofBundle;
                    if (!proof?.id) {
                        ignored += 1;
                        break;
                    }
                    this.storage.savePersonaZkpProof?.({
                        id: proof.id,
                        vaultId: proof.vaultId,
                        circuitId: proof.circuitId,
                        proofBlob: proof.proof,
                        publicInputs: proof.publicInputs || {},
                        claimIds: proof.claimIds || [],
                        createdAt: proof.createdAt,
                        expiresAt: proof.expiresAt,
                    });
                    applied += 1;
                    break;
                }
                default:
                    ignored += 1;
                    break;
            }
        }

        this.storage.savePersonaSyncState?.({
            peerDid: delta.fromDid,
            vaultId: delta.vaultId,
            cursorId: delta.id,
            clock: delta.vectorClock,
            updatedAt: Date.now(),
        });
        this.storage.markPersonaSyncApplied?.(delta.fromDid, delta.id, delta.vaultId);

        const result = { applied, ignored, cursor: delta.id };
        this.recordMetric('persona.sync.apply.latency_ms', Date.now() - startedAt, {
            vaultId: delta.vaultId,
            applied,
            ignored,
            operationCount: delta.operations.length,
        });
        return result;
    }

    async exportSubgraph(input: ExportSubgraphInput): Promise<PortableSubgraph> {
        const redactionOperation = input.redactionOperation || 'export';
        const graph = await this.queryGraph({
            vaultId: input.vaultId,
            domain: input.domain,
            rootNodeId: input.nodeIds?.[0],
            maxDepth: input.includeNeighbors ? 2 : 1,
            limit: 1000,
        });

        if (!input.nodeIds?.length) {
            return {
                vaultId: graph.nodes[0]?.vaultId || (await this.resolveVaultId(input.vaultId)),
                exportedAt: Date.now(),
                nodes: graph.nodes.map((node) => redactByDomainOperation(node.domain, node, redactionOperation)),
                edges: graph.edges,
                hyperEdges: graph.hyperEdges,
            };
        }

        const selected = new Set(input.nodeIds);
        const nodes = graph.nodes
            .filter((n) => selected.has(n.id))
            .map((node) => redactByDomainOperation(node.domain, node, redactionOperation));
        const edges = graph.edges.filter((e) => selected.has(e.sourceNodeId) || selected.has(e.targetNodeId));
        const hyperEdges = graph.hyperEdges.filter((h) => h.nodeIds.some((id) => selected.has(id)));
        return {
            vaultId: await this.resolveVaultId(input.vaultId),
            exportedAt: Date.now(),
            nodes,
            edges,
            hyperEdges,
        };
    }

    async getProfile(vaultId?: string): Promise<Record<string, unknown>> {
        const resolvedVaultId = await this.resolveVaultId(vaultId);
        const prefs = await this.queryMemories({
            vaultId: resolvedVaultId,
            domain: 'preferences',
            limit: 50,
        });
        const identity = await this.queryMemories({
            vaultId: resolvedVaultId,
            domain: 'identity',
            limit: 50,
        });

        return {
            vaultId: resolvedVaultId,
            did: this.identityDid,
            preferences: prefs.nodes.map((n) => ({ key: n.title, value: n.content })),
            identity: identity.nodes.map((n) => redactByDomainOperation(n.domain, n, 'read')),
            generatedAt: Date.now(),
        };
    }

    async listClaims(vaultId?: string, includeRevoked = false): Promise<PersonaClaim[]> {
        const resolvedVaultId = await this.resolveVaultId(vaultId);
        const claims = this.storage.listPersonaClaims?.(resolvedVaultId, { includeRevoked }) || [];
        return claims.map((record: any) => this.inflateClaim(record));
    }

    async getClaim(claimId: string): Promise<PersonaClaim | undefined> {
        const record = this.storage.getPersonaClaim?.(claimId);
        if (!record) return undefined;
        return this.inflateClaim(record);
    }

    listZkProofs(vaultId?: string): ZkProofBundle[] {
        const resolvedVaultId = vaultId || this.storage.getPersonaVaults?.(this.identityDid)?.[0]?.id;
        if (!resolvedVaultId) return [];
        const rows = this.storage.listPersonaZkpProofs?.(resolvedVaultId) || [];
        return rows.map((row: any) => ({
            id: row.id,
            vaultId: row.vaultId,
            circuitId: row.circuitId,
            proof: row.proofBlob,
            publicInputs: row.publicInputs || {},
            claimIds: row.claimIds || [],
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            proofSystem: this.detectProofSystem(row.proofBlob),
        }));
    }

    getZkProof(proofId: string): ZkProofBundle | undefined {
        const row = this.storage.getPersonaZkpProof?.(proofId);
        if (!row) return undefined;
        return {
            id: row.id,
            vaultId: row.vaultId,
            circuitId: row.circuitId as any,
            proof: row.proofBlob,
            publicInputs: row.publicInputs || {},
            claimIds: row.claimIds || [],
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            proofSystem: this.detectProofSystem(row.proofBlob),
        };
    }

    listZkCircuits(): any[] {
        return this.zkp.listCircuits();
    }

    buildSyncDelta(input: {
        vaultId: string;
        operations: Array<{
            type:
                | 'node_upsert'
                | 'node_delete'
                | 'edge_upsert'
                | 'edge_delete'
                | 'capability_revoke'
                | 'capability_attenuate'
                | 'claim_upsert'
                | 'claim_revoke'
                | 'zkp_proof_upsert';
            payload: Record<string, unknown>;
        }>;
        cursor?: string;
        proofs?: ZkProofBundle[];
    }): PersonaSyncDelta {
        const state = this.storage.getPersonaSyncState?.(this.identityDid, input.vaultId);
        const clock = { ...(state?.clock || {}), [this.identityDid]: ((state?.clock?.[this.identityDid] || 0) + 1) };
        return createPersonaDelta({
            vaultId: input.vaultId,
            fromDid: this.identityDid,
            operations: input.operations,
            vectorClock: clock,
            cursor: input.cursor,
            proofs: input.proofs,
        });
    }

    private async resolveVaultId(vaultId?: string): Promise<string> {
        if (vaultId) return vaultId;

        const existing = this.storage.getPersonaVaults?.(this.identityDid) || [];
        if (existing.length > 0) {
            return existing[0].id;
        }

        const created = await this.createVault({ name: 'Persona Vault', ownerDid: this.identityDid });
        return created.id;
    }

    private async ensureDefaultVault(name: string): Promise<void> {
        const existing = this.storage.getPersonaVaults?.(this.identityDid) || [];
        if (existing.length > 0) return;
        await this.createVault({ name, ownerDid: this.identityDid });
    }

    private bumpLifecycle(vaultId: string, node: PersonaNode): void {
        const vault = this.storage.getPersonaVault?.(vaultId);
        const state = (vault?.lifecycle as unknown as LifecycleState | undefined) || undefined;
        const domainPolicy = getDomainPolicy(node.domain);
        const next = this.lifecycle.update(state, node, {
            shortTermWindow: domainPolicy.pamu.shortTermWindow,
            emaAlpha: domainPolicy.pamu.emaAlpha,
            promoteThreshold: domainPolicy.pamu.promoteThreshold,
        });
        if (vault) {
            this.storage.savePersonaVault?.({
                ...vault,
                lifecycle: next,
                updatedAt: Date.now(),
            });
        }
    }

    private async indexEmbedding(node: PersonaNode): Promise<void> {
        const embedding = await this.embeddings.embedText(`${node.title}\n${node.content}\n${(node.tags || []).join(' ')}`);
        const existing = this.storage.getPersonaEmbedding?.(node.id);
        const rowId = existing?.vecRowId || this.nextVectorRowId(node.id);
        this.storage.upsertPersonaVector?.(rowId, embedding.vector);
        this.storage.upsertPersonaEmbedding?.({
            nodeId: node.id,
            vaultId: node.vaultId,
            model: embedding.model,
            dim: embedding.dim,
            vecRowId: rowId,
            vector: embedding.vector,
            updatedAt: Date.now(),
        });
    }

    private nextVectorRowId(seed: string): number {
        const digest = crypto.createHash('sha256').update(seed).digest();
        const value = digest.readUInt32BE(0);
        return Math.max(1, value);
    }

    private upsertLocalDomainDoc(
        vaultId: string,
        domain: string,
        entries: Record<string, unknown>
    ): void {
        const docId = `crdt_${vaultId}_${domain}`;
        const current = this.storage.getPersonaCrdtDoc?.(docId);
        const data = { ...(current?.data || {}), ...entries };
        const clock = { ...(current?.clock || {}) };
        clock[this.identityDid] = (clock[this.identityDid] || 0) + 1;
        this.storage.upsertPersonaCrdtDoc?.({
            docId,
            vaultId,
            domain,
            data,
            clock,
            updatedAt: Date.now(),
        });
    }

    private mergeCrdtDomainDoc(input: {
        vaultId: string;
        domain: string;
        patch: Record<string, unknown>;
        clock?: Record<string, number>;
    }): void {
        const docId = `crdt_${input.vaultId}_${input.domain}`;
        const current = this.storage.getPersonaCrdtDoc?.(docId);
        const currentDoc = current?.data
            ? Automerge.from<Record<string, any>>(current.data as Record<string, any>)
            : undefined;
        const merged = mergeDomainDoc(currentDoc, input.patch as Record<string, any>);
        const mergedClock: Record<string, number> = { ...(current?.clock || {}) };
        for (const [did, counter] of Object.entries(input.clock || {})) {
            mergedClock[did] = Math.max(mergedClock[did] || 0, counter);
        }
        this.storage.upsertPersonaCrdtDoc?.({
            docId,
            vaultId: input.vaultId,
            domain: input.domain,
            data: JSON.parse(JSON.stringify(merged)),
            clock: mergedClock,
            updatedAt: Date.now(),
        });
    }

    private recordMetric(metric: string, value: number, labels?: Record<string, unknown>): void {
        if (!Number.isFinite(value)) return;
        try {
            this.storage.appendPersonaMetric?.({
                ts: Date.now(),
                metric,
                value,
                labels,
            });
        } catch {
            // Metrics should never break core flows.
        }
    }

    private getOrBuildGraphRank(
        vaultId: string,
        nodes: PersonaNode[],
        edges: PersonaEdge[],
        query: MemoryQueryInput
    ): Map<string, number> {
        const domainScope = query.domain
            ? query.domain
            : query.domains?.length
            ? [...query.domains].sort().join(',')
            : '*';
        const maxNodeUpdatedAt = nodes.reduce((acc, node) => Math.max(acc, node.updatedAt || 0), 0);
        const maxEdgeUpdatedAt = edges.reduce((acc, edge) => Math.max(acc, edge.updatedAt || 0), 0);
        const version = `${nodes.length}:${edges.length}:${maxNodeUpdatedAt}:${maxEdgeUpdatedAt}`;
        const key = `${vaultId}:${domainScope}:${version}`;
        const cached = this.graphRankCache.get(key);
        if (cached) {
            return cached;
        }

        const persisted = this.storage.getPersonaGraphCache?.(vaultId, domainScope, version);
        if (persisted?.ppr) {
            const fromStorage = new Map<string, number>();
            for (const [nodeId, score] of Object.entries(persisted.ppr)) {
                fromStorage.set(nodeId, Number(score) || 0);
            }
            this.graphRankCache.set(key, fromStorage);
            return fromStorage;
        }

        const built = computePersonalizedPageRank(nodes, edges);
        this.graphRankCache.set(key, built);
        this.storage.upsertPersonaGraphCache?.({
            vaultId,
            domain: domainScope,
            graphVersion: version,
            ppr: Object.fromEntries(Array.from(built.entries()).map(([k, v]) => [k, Number(v || 0)])),
            updatedAt: Date.now(),
        });
        this.storage.prunePersonaGraphCache?.(vaultId, domainScope, 8);
        if (this.graphRankCache.size > 128) {
            const first = this.graphRankCache.keys().next().value;
            if (first) this.graphRankCache.delete(first);
        }
        return built;
    }

    private inflateNode(node: PersonaNode): PersonaNode {
        const policy = getDomainPolicy(node.domain);
        if (!policy.sensitive) return node;

        const encrypted = node.metadata?.encryptedContent;
        if (!isEncryptedPayload(encrypted)) {
            return node;
        }

        try {
            const decrypted = this.decrypt(encrypted);
            return {
                ...node,
                content: decrypted,
            };
        } catch {
            return node;
        }
    }

    private encrypt(plaintext: string): EncryptedPayload {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return {
            enc: true,
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
            data: encrypted.toString('base64'),
        };
    }

    private decrypt(payload: EncryptedPayload): string {
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            this.encryptionKey,
            Buffer.from(payload.iv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(payload.data, 'base64')),
            decipher.final(),
        ]);
        return decrypted.toString('utf8');
    }

    private inflateClaim(record: any): PersonaClaim {
        let payload: Record<string, unknown> = {};
        try {
            const encrypted = JSON.parse(record.payloadEnc);
            if (isEncryptedPayload(encrypted)) {
                payload = JSON.parse(this.decrypt(encrypted));
            }
        } catch {
            payload = {};
        }
        return {
            id: record.id,
            vaultId: record.vaultId,
            subjectDid: record.subjectDid,
            issuerDid: record.issuerDid,
            schema: record.schema,
            payload,
            status: record.status,
            issuedAt: record.issuedAt,
            expiresAt: record.expiresAt,
            revokedAt: record.revokedAt,
            signature: record.signature,
        };
    }

    private detectProofSystem(proof: string): 'noir-bb' | 'mock-noir-bb' {
        return String(proof || '').startsWith('bb1.') ? 'noir-bb' : 'mock-noir-bb';
    }
}

export default PersonaVaultEngine;
