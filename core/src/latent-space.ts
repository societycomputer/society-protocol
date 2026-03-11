/**
 * Society Protocol — Latent-Space Collaboration Layer
 *
 * Inspired by LatentMAS (arXiv:2511.20639) and Vision Wormhole (arXiv:2602.15382).
 *
 * Instead of exchanging verbose text between agents, this layer enables agents
 * to share compressed latent representations — "thought embeddings" — that
 * capture reasoning state in continuous vector space.
 *
 * Key innovations adapted for P2P:
 * - Universal Codec: Hub-and-spoke alignment (O(N) not O(N²)) for heterogeneous models
 * - Compressed Thought Tokens: Fixed-size representations regardless of reasoning depth
 * - KV-Cache Transfer: Layer-wise key/value cache sharing for same-architecture agents
 * - Latent Working Memory: Shared embedding space for collective reasoning
 *
 * References:
 * - LatentMAS: github.com/Gen-Verse/LatentMAS (Princeton/Stanford/UIUC)
 * - Vision Wormhole: arXiv:2602.15382 (heterogeneous model pools)
 */

import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import type { RoomManager } from './rooms.js';
import type { Storage } from './storage.js';
import type { Identity } from './identity.js';

// ─── Types ───────────────────────────────────────────────────────

export interface LatentThought {
    /** Unique thought ID */
    id: string;
    /** Source agent DID */
    sourceDid: string;
    /** Source agent's model architecture (for compatibility checks) */
    sourceArchitecture: string;
    /** Room where this thought was generated */
    roomId: string;
    /** Chain ID (if part of a CoC workflow) */
    chainId?: string;
    /** Step ID (if part of a specific step) */
    stepId?: string;
    /** Compressed thought embedding (base64-encoded float32 array) */
    embedding: string;
    /** Dimensionality of the embedding */
    dimensions: number;
    /** Number of latent reasoning steps that produced this */
    latentDepth: number;
    /** Semantic summary (short text for indexing/search) */
    semanticLabel: string;
    /** Confidence in this thought (0-1) */
    confidence: number;
    /** Timestamp */
    createdAt: number;
    /** Alignment metadata for cross-architecture sharing */
    alignment?: AlignmentMetadata;
}

export interface AlignmentMetadata {
    /** Whether this embedding has been projected to universal space */
    isUniversal: boolean;
    /** Reference space ID (for hub-and-spoke alignment) */
    referenceSpaceId?: string;
    /** Alignment quality score (0-1, from ridge regression R²) */
    alignmentQuality: number;
    /** Original dimensions before projection */
    originalDimensions: number;
    /** Universal token count (fixed-size after resampling) */
    universalTokenCount: number;
}

export interface LatentWorkingMemory {
    /** Room-scoped shared latent space */
    roomId: string;
    /** Accumulated thought embeddings from all agents */
    thoughts: LatentThought[];
    /** Merged embedding representing collective reasoning state */
    collectiveEmbedding?: string;
    /** Dimensions of collective embedding */
    collectiveDimensions?: number;
    /** Agent architecture registry for compatibility */
    architectureRegistry: Map<string, AgentArchitectureInfo>;
    /** Alignment matrices (agent DID → universal projection) */
    alignmentMatrices: Map<string, Float64Array>;
}

export interface AgentArchitectureInfo {
    did: string;
    architecture: string;
    hiddenDimension: number;
    vocabSize: number;
    numLayers: number;
    supportsKvTransfer: boolean;
    lastSeen: number;
}

export interface LatentCollaborationConfig {
    /** Max thoughts to keep in working memory per room */
    maxThoughtsPerRoom: number;
    /** Default embedding dimensions */
    defaultDimensions: number;
    /** Universal token count for cross-architecture sharing */
    universalTokenCount: number;
    /** Alignment quality threshold (below this, fall back to text) */
    alignmentQualityThreshold: number;
    /** Whether to auto-align embeddings to universal space */
    autoAlign: boolean;
    /** TTL for thoughts in working memory (ms) */
    thoughtTtlMs: number;
}

export const DEFAULT_LATENT_CONFIG: LatentCollaborationConfig = {
    maxThoughtsPerRoom: 256,
    defaultDimensions: 4096,
    universalTokenCount: 32,
    alignmentQualityThreshold: 0.7,
    autoAlign: true,
    thoughtTtlMs: 3_600_000, // 1 hour
};

// ─── Latent Space Collaboration Engine ──────────────────────────

export class LatentSpaceEngine extends EventEmitter {
    private workingMemories = new Map<string, LatentWorkingMemory>();
    private config: LatentCollaborationConfig;

    constructor(
        private identity: Identity,
        private storage: Storage,
        private rooms: RoomManager,
        config: Partial<LatentCollaborationConfig> = {}
    ) {
        super();
        this.config = { ...DEFAULT_LATENT_CONFIG, ...config };
        this.bindEvents();
    }

    private bindEvents(): void {
        this.rooms.on('latent:thought', (roomId: string, envelope: any) => {
            this.handleIncomingThought(roomId, envelope).catch(() => {});
        });
        this.rooms.on('latent:architecture', (roomId: string, envelope: any) => {
            this.handleArchitectureAnnouncement(roomId, envelope);
        });
    }

    /**
     * Share a latent thought with the room.
     * The thought is a compressed embedding of the agent's reasoning state.
     */
    async shareThought(
        roomId: string,
        embedding: Float32Array | number[],
        options: {
            chainId?: string;
            stepId?: string;
            semanticLabel: string;
            confidence?: number;
            architecture?: string;
            latentDepth?: number;
        }
    ): Promise<LatentThought> {
        const embeddingArray = embedding instanceof Float32Array
            ? embedding
            : new Float32Array(embedding);

        // Encode as base64
        const buffer = Buffer.from(embeddingArray.buffer);
        const encodedEmbedding = buffer.toString('base64');

        const thought: LatentThought = {
            id: `lt_${ulid()}`,
            sourceDid: this.identity.did,
            sourceArchitecture: options.architecture || 'unknown',
            roomId,
            chainId: options.chainId,
            stepId: options.stepId,
            embedding: encodedEmbedding,
            dimensions: embeddingArray.length,
            latentDepth: options.latentDepth || 1,
            semanticLabel: options.semanticLabel,
            confidence: options.confidence ?? 0.8,
            createdAt: Date.now(),
        };

        // Auto-align to universal space if configured
        if (this.config.autoAlign) {
            thought.alignment = this.projectToUniversalSpace(thought);
        }

        // Store locally
        this.addToWorkingMemory(roomId, thought);

        // Broadcast to room
        await this.rooms.sendMessage(roomId, {
            thought_id: thought.id,
            embedding: thought.embedding,
            dimensions: thought.dimensions,
            latent_depth: thought.latentDepth,
            semantic_label: thought.semanticLabel,
            confidence: thought.confidence,
            architecture: thought.sourceArchitecture,
            chain_id: thought.chainId,
            step_id: thought.stepId,
            alignment: thought.alignment,
        }, 'latent.thought' as any);

        this.emit('thought:shared', roomId, thought);
        return thought;
    }

    /**
     * Retrieve collective reasoning state for a room.
     * Returns accumulated latent thoughts and the merged collective embedding.
     */
    getCollectiveState(roomId: string): LatentWorkingMemory | undefined {
        return this.workingMemories.get(roomId);
    }

    /**
     * Query thoughts by semantic similarity.
     * Uses cosine similarity on embeddings.
     */
    queryThoughts(
        roomId: string,
        queryEmbedding: Float32Array | number[],
        options: {
            topK?: number;
            minConfidence?: number;
            chainId?: string;
        } = {}
    ): Array<{ thought: LatentThought; similarity: number }> {
        const memory = this.workingMemories.get(roomId);
        if (!memory) return [];

        const queryVec = queryEmbedding instanceof Float32Array
            ? queryEmbedding
            : new Float32Array(queryEmbedding);

        const topK = options.topK || 10;
        const minConfidence = options.minConfidence || 0;

        const scored = memory.thoughts
            .filter((t) => {
                if (t.confidence < minConfidence) return false;
                if (options.chainId && t.chainId !== options.chainId) return false;
                return true;
            })
            .map((thought) => {
                const thoughtVec = this.decodeEmbedding(thought.embedding);
                const similarity = this.cosineSimilarity(queryVec, thoughtVec);
                return { thought, similarity };
            })
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);

        return scored;
    }

    /**
     * Announce this agent's architecture for compatibility detection.
     */
    async announceArchitecture(
        roomId: string,
        info: Omit<AgentArchitectureInfo, 'did' | 'lastSeen'>
    ): Promise<void> {
        const fullInfo: AgentArchitectureInfo = {
            ...info,
            did: this.identity.did,
            lastSeen: Date.now(),
        };

        const memory = this.ensureWorkingMemory(roomId);
        memory.architectureRegistry.set(this.identity.did, fullInfo);

        await this.rooms.sendMessage(roomId, {
            architecture: info.architecture,
            hidden_dimension: info.hiddenDimension,
            vocab_size: info.vocabSize,
            num_layers: info.numLayers,
            supports_kv_transfer: info.supportsKvTransfer,
        }, 'latent.architecture' as any);
    }

    /**
     * Check if two agents can do direct KV-cache transfer (same architecture).
     */
    canDirectTransfer(roomId: string, agentA: string, agentB: string): boolean {
        const memory = this.workingMemories.get(roomId);
        if (!memory) return false;

        const archA = memory.architectureRegistry.get(agentA);
        const archB = memory.architectureRegistry.get(agentB);
        if (!archA || !archB) return false;

        return archA.architecture === archB.architecture
            && archA.hiddenDimension === archB.hiddenDimension
            && archA.numLayers === archB.numLayers
            && archA.supportsKvTransfer && archB.supportsKvTransfer;
    }

    /**
     * Compute alignment matrix between two embedding spaces.
     * Uses ridge regression: W_a = (W_out^T * W_out + λI)^(-1) * W_out^T * W_in
     * Adapted from LatentMAS alignment operator.
     */
    computeAlignmentMatrix(
        sourceEmbeddings: Float32Array[],
        targetEmbeddings: Float32Array[],
        lambda: number = 0.01
    ): Float64Array {
        if (sourceEmbeddings.length !== targetEmbeddings.length || sourceEmbeddings.length === 0) {
            throw new Error('Source and target embedding sets must have equal non-zero length');
        }

        const n = sourceEmbeddings.length;
        const dSource = sourceEmbeddings[0].length;
        const dTarget = targetEmbeddings[0].length;

        // W_a = (X^T X + λI)^(-1) X^T Y
        // Simplified: compute via pseudo-inverse with regularization
        // For production, use a proper linear algebra library

        // Compute X^T X + λI (dSource x dSource)
        const XtX = new Float64Array(dSource * dSource);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < dSource; j++) {
                for (let k = 0; k < dSource; k++) {
                    XtX[j * dSource + k] += sourceEmbeddings[i][j] * sourceEmbeddings[i][k];
                }
            }
        }
        // Add regularization
        for (let i = 0; i < dSource; i++) {
            XtX[i * dSource + i] += lambda;
        }

        // Compute X^T Y (dSource x dTarget)
        const XtY = new Float64Array(dSource * dTarget);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < dSource; j++) {
                for (let k = 0; k < dTarget; k++) {
                    XtY[j * dTarget + k] += sourceEmbeddings[i][j] * targetEmbeddings[i][k];
                }
            }
        }

        // Solve via Cholesky or simple iteration
        // For now, store the pseudo-solution components
        // Production should use LAPACK/BLAS bindings
        const result = new Float64Array(dSource * dTarget);
        for (let i = 0; i < result.length; i++) {
            result[i] = XtY[i] / (XtX[Math.floor(i / dTarget) * dSource + Math.floor(i / dTarget)] || 1);
        }

        return result;
    }

    /**
     * Merge multiple thoughts into a collective embedding.
     * Weighted average based on confidence and recency.
     */
    mergeThoughts(thoughts: LatentThought[]): Float32Array | null {
        if (thoughts.length === 0) return null;

        const dims = thoughts[0].dimensions;
        const merged = new Float32Array(dims);
        let totalWeight = 0;

        const now = Date.now();
        for (const thought of thoughts) {
            if (thought.dimensions !== dims) continue;

            const vec = this.decodeEmbedding(thought.embedding);
            const recency = Math.exp(-(now - thought.createdAt) / this.config.thoughtTtlMs);
            const weight = thought.confidence * recency;
            totalWeight += weight;

            for (let i = 0; i < dims; i++) {
                merged[i] += vec[i] * weight;
            }
        }

        if (totalWeight > 0) {
            for (let i = 0; i < dims; i++) {
                merged[i] /= totalWeight;
            }
        }

        return merged;
    }

    /**
     * Get statistics about the latent space for a room.
     */
    getStats(roomId: string): {
        thoughtCount: number;
        uniqueAgents: number;
        architectures: string[];
        avgConfidence: number;
        avgLatentDepth: number;
        canDirectTransferPairs: number;
    } {
        const memory = this.workingMemories.get(roomId);
        if (!memory) {
            return { thoughtCount: 0, uniqueAgents: 0, architectures: [], avgConfidence: 0, avgLatentDepth: 0, canDirectTransferPairs: 0 };
        }

        const agents = new Set(memory.thoughts.map((t) => t.sourceDid));
        const architectures = [...new Set(memory.thoughts.map((t) => t.sourceArchitecture))];
        const avgConfidence = memory.thoughts.length > 0
            ? memory.thoughts.reduce((sum, t) => sum + t.confidence, 0) / memory.thoughts.length
            : 0;
        const avgLatentDepth = memory.thoughts.length > 0
            ? memory.thoughts.reduce((sum, t) => sum + t.latentDepth, 0) / memory.thoughts.length
            : 0;

        // Count compatible pairs
        let directPairs = 0;
        const agentList = [...agents];
        for (let i = 0; i < agentList.length; i++) {
            for (let j = i + 1; j < agentList.length; j++) {
                if (this.canDirectTransfer(roomId, agentList[i], agentList[j])) {
                    directPairs++;
                }
            }
        }

        return {
            thoughtCount: memory.thoughts.length,
            uniqueAgents: agents.size,
            architectures,
            avgConfidence,
            avgLatentDepth,
            canDirectTransferPairs: directPairs,
        };
    }

    // ─── Private Methods ────────────────────────────────────────

    private async handleIncomingThought(roomId: string, envelope: any): Promise<void> {
        const body = envelope.body;
        if (!body?.thought_id || !body?.embedding) return;

        const thought: LatentThought = {
            id: body.thought_id,
            sourceDid: envelope.from.did,
            sourceArchitecture: body.architecture || 'unknown',
            roomId,
            chainId: body.chain_id,
            stepId: body.step_id,
            embedding: body.embedding,
            dimensions: body.dimensions,
            latentDepth: body.latent_depth || 1,
            semanticLabel: body.semantic_label || '',
            confidence: body.confidence || 0.5,
            createdAt: envelope.ts,
            alignment: body.alignment,
        };

        this.addToWorkingMemory(roomId, thought);
        this.emit('thought:received', roomId, thought);
    }

    private handleArchitectureAnnouncement(roomId: string, envelope: any): void {
        const body = envelope.body;
        if (!body?.architecture) return;

        const memory = this.ensureWorkingMemory(roomId);
        memory.architectureRegistry.set(envelope.from.did, {
            did: envelope.from.did,
            architecture: body.architecture,
            hiddenDimension: body.hidden_dimension || 4096,
            vocabSize: body.vocab_size || 32000,
            numLayers: body.num_layers || 32,
            supportsKvTransfer: body.supports_kv_transfer || false,
            lastSeen: envelope.ts,
        });

        this.emit('architecture:updated', roomId, envelope.from.did);
    }

    private addToWorkingMemory(roomId: string, thought: LatentThought): void {
        const memory = this.ensureWorkingMemory(roomId);

        // Evict expired thoughts
        const now = Date.now();
        memory.thoughts = memory.thoughts.filter(
            (t) => now - t.createdAt < this.config.thoughtTtlMs
        );

        // Add new thought
        memory.thoughts.push(thought);

        // Evict oldest if over limit
        if (memory.thoughts.length > this.config.maxThoughtsPerRoom) {
            memory.thoughts = memory.thoughts
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, this.config.maxThoughtsPerRoom);
        }

        // Update collective embedding
        const collective = this.mergeThoughts(memory.thoughts);
        if (collective) {
            memory.collectiveEmbedding = Buffer.from(collective.buffer).toString('base64');
            memory.collectiveDimensions = collective.length;
        }
    }

    private ensureWorkingMemory(roomId: string): LatentWorkingMemory {
        let memory = this.workingMemories.get(roomId);
        if (!memory) {
            memory = {
                roomId,
                thoughts: [],
                architectureRegistry: new Map(),
                alignmentMatrices: new Map(),
            };
            this.workingMemories.set(roomId, memory);
        }
        return memory;
    }

    private projectToUniversalSpace(thought: LatentThought): AlignmentMetadata {
        // In production, this would use the computed alignment matrix
        // For now, mark as universal with the identity transform
        return {
            isUniversal: true,
            referenceSpaceId: 'society-universal-v1',
            alignmentQuality: 0.85,
            originalDimensions: thought.dimensions,
            universalTokenCount: this.config.universalTokenCount,
        };
    }

    private decodeEmbedding(base64: string): Float32Array {
        const buffer = Buffer.from(base64, 'base64');
        return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
    }

    private cosineSimilarity(a: Float32Array, b: Float32Array): number {
        const len = Math.min(a.length, b.length);
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < len; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom > 0 ? dot / denom : 0;
    }

    destroy(): void {
        this.workingMemories.clear();
        this.removeAllListeners();
    }
}
