/**
 * Society Protocol - Knowledge Pool System v1.0
 * 
 * Sistema de conhecimento compartilhado:
 * - Knowledge Cards (unidades de conhecimento)
 * - Spaces compartilhados (repositórios de conhecimento)
 * - CRDT para convergência sem conflitos
 * - Knowledge Graph descentralizado
 * - Links semânticos entre conhecimentos
 */

import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import { type Storage } from './storage.js';
import { type Identity } from './identity.js';
import type { InputValidator } from './prompt-guard.js';

// ─── Types ───────────────────────────────────────────────────────

export type KnowledgeId = string;
export type SpaceId = string;
export type LinkType = 'relates-to' | 'supports' | 'contradicts' | 'extends' | 'depends-on' | 'part-of' | 'replicates' | 'cites';

export type KnowledgeType = 
    | 'concept'        // Conceito abstrato
    | 'fact'           // Fato verificável
    | 'insight'        // Insight/Descoberta
    | 'sop'            // Standard Operating Procedure
    | 'decision'       // Decisão tomada
    | 'evidence'       // Evidência/prova
    | 'hypothesis'     // Hipótese
    | 'paper'          // Paper científico
    | 'dataset'        // Dataset científico
    | 'claim'          // Claim científico extraído
    | 'finding'        // Achado/síntese
    | 'code'           // Código/Algoritmo
    | 'document'       // Documento
    | 'conversation';  // Transcrição de conversa

export type PrivacyLevel = 'public' | 'federation' | 'room' | 'private';

export interface KnowledgeCard {
    id: KnowledgeId;
    spaceId: SpaceId;
    
    // Conteúdo
    type: KnowledgeType;
    title: string;
    summary: string;
    content: string;
    contentFormat: 'markdown' | 'json' | 'code' | 'plain';
    
    // Metadados
    author: string;              // DID
    createdAt: number;
    updatedAt: number;
    version: number;
    
    // Categorização
    tags: string[];
    domain: string[];            // ['medicine', 'cardiology']
    entities: string[];          // Entidades mencionadas
    
    // Proveniência
    source?: {
        type: 'coc' | 'chat' | 'document' | 'web' | 'manual';
        id?: string;             // ID da fonte (ex: CoC ID)
        url?: string;
        context?: string;        // Contexto de onde veio
    };
    
    // Qualidade/Validação
    confidence: number;          // 0-1
    verificationStatus: 'unverified' | 'verified' | 'disputed' | 'deprecated';
    verifiedBy?: string[];       // DIDs que verificaram
    verifications: Verification[];
    
    // Uso
    usage: {
        views: number;
        citations: number;
        applications: number;    // Quantas vezes foi usado em CoCs
        lastAccessed: number;
    };
    
    // Privacidade
    privacy: PrivacyLevel;
    allowedReaders?: string[];   // DIDs (se private)
    
    // CRDT
    crdt: {
        hlc: HybridLogicalClock; // Para ordenação causal
        vectorClock: Record<string, number>;
        tombstone: boolean;      // Se foi deletado
    };
}

export interface Verification {
    verifier: string;            // DID
    timestamp: number;
    method: 'manual' | 'automated' | 'consensus';
    confidence: number;
    notes?: string;
}

export interface KnowledgeLink {
    id: string;
    source: KnowledgeId;
    target: KnowledgeId;
    type: LinkType;
    strength: number;            // 0-1, força da relação
    createdBy: string;
    createdAt: number;
    evidence?: string;           // Evidência da relação
}

export interface KnowledgeSpace {
    id: SpaceId;
    name: string;
    description: string;
    
    // Ownership
    owner: string;               // DID
    federationId?: string;       // Se pertence a uma federação
    roomId?: string;             // Se é de uma room específica
    
    // Configuração
    type: 'personal' | 'team' | 'federation' | 'public';
    privacy: PrivacyLevel;
    
    // Estrutura
    cards: Set<KnowledgeId>;
    links: KnowledgeLink[];
    subspaces: SpaceId[];
    
    // Metadados
    createdAt: number;
    updatedAt: number;
    tags: string[];
    
    // Stats
    stats: {
        cardCount: number;
        linkCount: number;
        contributorCount: number;
        lastActivity: number;
    };
    
    // Políticas
    policies: {
        allowPublicRead: boolean;
        allowPublicWrite: boolean;
        requireVerification: boolean;
        autoArchiveDays?: number;
    };
}

// CRDT - Hybrid Logical Clock
export interface HybridLogicalClock {
    wallTime: number;            // Timestamp físico
    logical: number;             // Contador lógico
    nodeId: string;              // ID do nó
}

// Inconsciente Coletivo - Contexto Compartilhado
export interface CollectiveUnconscious {
    id: string;
    spaceId: SpaceId;
    
    // Memória de curto prazo (conversa ativa)
    workingMemory: {
        recentMessages: string[];    // IDs das últimas mensagens
        activeTopics: string[];      // Tópicos sendo discutidos
        participants: string[];      // DIDs ativos
        contextWindow: string;       // Contexto atual (resumido)
    };
    
    // Memória de longo prazo (conhecimento acumulado)
    longTermMemory: {
        keyConcepts: KnowledgeId[];   // Conceitos importantes
        recurringThemes: string[];    // Temas recorrentes
        learnedPatterns: string[];    // Padrões aprendidos
        agentModels: Record<string, AgentModel>; // Modelos dos agentes
    };
    
    // Estado compartilhado
    sharedState: {
        goals: string[];              // Objetivos atuais
        plans: string[];              // Planos em execução
        decisions: string[];          // Decisões recentes
        openQuestions: string[];      // Perguntas em aberto
    };
    
    // Metadados
    lastUpdate: number;
    coherence: number;                // Quão coerente está o contexto (0-1)
}

export interface AgentModel {
    did: string;
    name: string;
    
    // Capabilities observadas
    observedCapabilities: string[];
    
    // Estilo de comunicação
    communicationStyle: {
        formality: number;           // 0-1 (informal-formal)
        verbosity: number;           // 0-1 (conciso-verbose)
        responseTime: number;        // média em ms
    };
    
    // Histórico de interações
    interactions: {
        total: number;
        successful: number;
        lastInteraction: number;
    };
    
    // Relacionamento
    relationship: {
        trust: number;               // 0-1
        familiarity: number;         // 0-1
        collaborationHistory: string[]; // IDs de CoCs juntos
    };
    
    // Modelo mental
    expertise: Record<string, number>; // Domínio -> nível (0-1)
    preferences: Record<string, any>;
}

// ─── CRDT Utilities ──────────────────────────────────────────────

export type VectorClockOrder = 'before' | 'after' | 'concurrent' | 'equal';

/**
 * Compare two vector clocks for causal ordering.
 * Returns:
 *   'before'     — a causally precedes b (a < b)
 *   'after'      — a causally follows b (a > b)
 *   'concurrent' — neither precedes the other
 *   'equal'      — identical clocks
 */
export function compareVectorClocks(
    a: Record<string, number>,
    b: Record<string, number>
): VectorClockOrder {
    const allNodes = new Set([...Object.keys(a), ...Object.keys(b)]);
    let aLess = false;
    let bLess = false;

    for (const node of allNodes) {
        const va = a[node] || 0;
        const vb = b[node] || 0;
        if (va < vb) aLess = true;
        if (va > vb) bLess = true;
        if (aLess && bLess) return 'concurrent';
    }

    if (!aLess && !bLess) return 'equal';
    if (aLess && !bLess) return 'before';
    return 'after';
}

/**
 * Merge two vector clocks by taking component-wise maximum.
 */
export function mergeVectorClocks(
    a: Record<string, number>,
    b: Record<string, number>
): Record<string, number> {
    const merged: Record<string, number> = { ...a };
    for (const [node, count] of Object.entries(b)) {
        merged[node] = Math.max(merged[node] || 0, count);
    }
    return merged;
}

/**
 * Advance HLC for a local event (Kulkarni et al. 2014, §3.1).
 * l' = max(l.wallTime, pt) ; c' = (l' == l.wallTime) ? l.logical + 1 : 0
 */
export function tickHLC(current: HybridLogicalClock): HybridLogicalClock {
    const pt = Date.now();
    if (pt > current.wallTime) {
        return { wallTime: pt, logical: 0, nodeId: current.nodeId };
    }
    return { wallTime: current.wallTime, logical: current.logical + 1, nodeId: current.nodeId };
}

/**
 * Receive HLC from a remote message (Kulkarni et al. 2014, §3.2).
 * Merges local and remote clocks to maintain causal ordering.
 */
export function receiveHLC(
    local: HybridLogicalClock,
    remote: HybridLogicalClock
): HybridLogicalClock {
    const pt = Date.now();
    const maxWall = Math.max(local.wallTime, remote.wallTime, pt);

    let logical: number;
    if (maxWall === local.wallTime && maxWall === remote.wallTime) {
        logical = Math.max(local.logical, remote.logical) + 1;
    } else if (maxWall === local.wallTime) {
        logical = local.logical + 1;
    } else if (maxWall === remote.wallTime) {
        logical = remote.logical + 1;
    } else {
        logical = 0; // pt is strictly greater
    }

    return { wallTime: maxWall, logical, nodeId: local.nodeId };
}

/**
 * Compare two HLCs for total ordering.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 * Tie-breaking: wallTime → logical → nodeId (lexicographic).
 */
export function compareHLC(a: HybridLogicalClock, b: HybridLogicalClock): number {
    if (a.wallTime !== b.wallTime) return a.wallTime - b.wallTime;
    if (a.logical !== b.logical) return a.logical - b.logical;
    return a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0;
}

// ─── Knowledge Pool Engine ───────────────────────────────────────

export interface ChatMessage {
    id: string;
    sender: string;       // DID or friendly name
    senderName?: string;
    content: string;
    timestamp: number;
    roomId?: string;
}

export interface ContextCompactionConfig {
    compactAfterMessages: number;  // Auto-compact after N messages (default 20)
    maxRecentMessages: number;     // Keep last N raw messages (default 40)
    ollamaUrl?: string;            // Ollama endpoint for summarization
    ollamaModel?: string;          // Model for summarization (default qwen3:1.7b)
}

const DEFAULT_COMPACTION_CONFIG: ContextCompactionConfig = {
    compactAfterMessages: 20,
    maxRecentMessages: 40,
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen3:1.7b',
};

export class KnowledgePool extends EventEmitter {
    private cards = new Map<KnowledgeId, KnowledgeCard>();
    private spaces = new Map<SpaceId, KnowledgeSpace>();
    private links: KnowledgeLink[] = [];
    private collectiveUnconscious = new Map<SpaceId, CollectiveUnconscious>();

    // Índices para busca
    private tagIndex = new Map<string, Set<KnowledgeId>>();
    private authorIndex = new Map<string, Set<KnowledgeId>>();
    private typeIndex = new Map<KnowledgeType, Set<KnowledgeId>>();
    // Link indexes for O(1) graph traversal (fixes N+1 query)
    private linksBySource = new Map<KnowledgeId, KnowledgeLink[]>();
    private linksByTarget = new Map<KnowledgeId, KnowledgeLink[]>();

    // Chat message buffers per space (for auto-compaction)
    private chatBuffers = new Map<string, ChatMessage[]>();
    private compactionConfig: ContextCompactionConfig;
    private compacting = new Set<string>(); // spaces currently compacting

    private validator?: InputValidator;

    constructor(
        private storage: Storage,
        private identity: Identity,
        compactionConfig?: Partial<ContextCompactionConfig>
    ) {
        super();
        this.compactionConfig = { ...DEFAULT_COMPACTION_CONFIG, ...compactionConfig };
        this.loadFromStorage();
    }

    setValidator(validator: InputValidator): void {
        this.validator = validator;
    }

    // ─── Space Management ────────────────────────────────────────

    async createSpace(
        name: string,
        description: string,
        type: KnowledgeSpace['type'] = 'team',
        privacy: PrivacyLevel = 'room'
    ): Promise<KnowledgeSpace> {
        const id = `space_${ulid()}`;
        const now = Date.now();
        
        const space: KnowledgeSpace = {
            id,
            name,
            description,
            owner: this.identity.did,
            type,
            privacy,
            cards: new Set(),
            links: [],
            subspaces: [],
            createdAt: now,
            updatedAt: now,
            tags: [],
            stats: {
                cardCount: 0,
                linkCount: 0,
                contributorCount: 1,
                lastActivity: now
            },
            policies: {
                allowPublicRead: type === 'public',
                allowPublicWrite: false,
                requireVerification: type === 'public',
                autoArchiveDays: type === 'personal' ? undefined : 365
            }
        };

        this.spaces.set(id, space);
        
        // Criar inconsciente coletivo para o space
        await this.createCollectiveUnconscious(id);
        
        await this.saveSpace(space);
        this.emit('space:created', space);
        
        return space;
    }

    // ─── Knowledge Card CRUD ─────────────────────────────────────

    async createCard(
        spaceId: SpaceId,
        type: KnowledgeType,
        title: string,
        content: string,
        options?: {
            summary?: string;
            tags?: string[];
            domain?: string[];
            source?: KnowledgeCard['source'];
            privacy?: PrivacyLevel;
            confidence?: number;
        }
    ): Promise<KnowledgeCard> {
        const space = this.spaces.get(spaceId);
        if (!space) throw new Error('Space not found');

        // Validate against prompt injection
        if (this.validator) {
            title = this.validator.validateTitle(title);
            content = this.validator.validateContent(content);
        }

        const id = `know_${ulid()}`;
        const now = Date.now();

        const card: KnowledgeCard = {
            id,
            spaceId,
            type,
            title,
            summary: options?.summary || this.generateSummary(content),
            content,
            contentFormat: 'markdown',
            author: this.identity.did,
            createdAt: now,
            updatedAt: now,
            version: 1,
            tags: options?.tags || [],
            domain: options?.domain || [],
            entities: this.extractEntities(content),
            source: options?.source,
            confidence: options?.confidence || 0.8,
            verificationStatus: 'unverified',
            verifications: [],
            usage: {
                views: 0,
                citations: 0,
                applications: 0,
                lastAccessed: now
            },
            privacy: options?.privacy || space.privacy,
            crdt: {
                hlc: { wallTime: now, logical: 0, nodeId: this.identity.did },
                vectorClock: { [this.identity.did]: 1 },
                tombstone: false
            }
        };

        this.cards.set(id, card);
        space.cards.add(id);
        space.stats.cardCount++;
        space.stats.lastActivity = now;
        
        // Indexar
        this.indexCard(card);
        
        // Atualizar inconsciente coletivo
        await this.updateCollectiveUnconscious(spaceId, card);
        
        await this.saveCard(card);
        await this.saveSpace(space);
        
        this.emit('card:created', card);
        
        return card;
    }

    async updateCard(
        id: KnowledgeId,
        updates: Partial<Pick<KnowledgeCard, 'title' | 'content' | 'tags' | 'confidence'>>
    ): Promise<KnowledgeCard> {
        const card = this.cards.get(id);
        if (!card) throw new Error('Card not found');

        // Verificar permissão
        if (card.author !== this.identity.did) {
            // TODO: Verificar permissões de edição
            throw new Error('No permission to edit');
        }

        // CRDT: Advance HLC (Kulkarni et al. 2014) and increment vector clock
        card.version++;
        card.updatedAt = Date.now();
        card.crdt.hlc = tickHLC(card.crdt.hlc);
        card.crdt.vectorClock[this.identity.did] =
            (card.crdt.vectorClock[this.identity.did] || 0) + 1;
        
        // Aplicar updates
        if (updates.title) card.title = updates.title;
        if (updates.content) {
            card.content = updates.content;
            card.summary = this.generateSummary(updates.content);
            card.entities = this.extractEntities(updates.content);
        }
        if (updates.tags) {
            // Re-indexar tags
            this.removeFromTagIndex(card);
            card.tags = updates.tags;
            this.addToTagIndex(card);
        }
        if (updates.confidence !== undefined) card.confidence = updates.confidence;

        await this.saveCard(card);
        this.emit('card:updated', card);
        
        return card;
    }

    async deleteCard(id: KnowledgeId): Promise<void> {
        const card = this.cards.get(id);
        if (!card) throw new Error('Card not found');

        // Soft delete (tombstone para CRDT)
        card.crdt.tombstone = true;
        card.updatedAt = Date.now();
        
        const space = this.spaces.get(card.spaceId);
        if (space) {
            space.cards.delete(id);
            space.stats.cardCount--;
        }

        this.removeFromIndex(card);
        await this.saveCard(card);
        this.emit('card:deleted', id);
    }

    // ─── CRDT Merge ────────────────────────────────────────────────

    /**
     * Merge a remote knowledge card with the local copy.
     *
     * Algorithm (state-based CRDT with causal metadata):
     * 1. If card is unknown locally → accept remote (new knowledge).
     * 2. Compare vector clocks for causal ordering:
     *    - remote ≤ local  → discard (stale).
     *    - local < remote  → accept remote (strictly newer).
     *    - concurrent      → LWW tie-break on HLC (wallTime, logical, nodeId).
     * 3. Merge vector clocks (component-wise max) regardless of winner.
     * 4. Advance local HLC via receiveHLC to maintain causal consistency.
     * 5. Tombstone wins: if either copy is tombstoned, result is tombstoned.
     *
     * Returns the merged card, or null if the remote was stale.
     */
    mergeCard(remote: KnowledgeCard): KnowledgeCard | null {
        const local = this.cards.get(remote.id);

        // Case 1: New card — accept remote entirely
        if (!local) {
            // Advance our HLC on receipt of remote clock
            const mergedHlc = receiveHLC(
                { wallTime: Date.now(), logical: 0, nodeId: this.identity.did },
                remote.crdt.hlc
            );
            const card: KnowledgeCard = {
                ...remote,
                crdt: {
                    ...remote.crdt,
                    hlc: mergedHlc,
                    vectorClock: { ...remote.crdt.vectorClock }
                }
            };
            this.cards.set(card.id, card);
            const space = this.spaces.get(card.spaceId);
            if (space && !card.crdt.tombstone) {
                space.cards.add(card.id);
                space.stats.cardCount = space.cards.size;
                space.stats.lastActivity = Date.now();
            }
            this.indexCard(card);
            this.saveCard(card);
            this.emit('card:merged', { card, action: 'new' });
            return card;
        }

        // Case 2: Compare vector clocks
        const order = compareVectorClocks(local.crdt.vectorClock, remote.crdt.vectorClock);

        if (order === 'equal' || order === 'after') {
            // Local is same or newer — discard remote
            return null;
        }

        // Determine the winner for content (used when concurrent)
        let winner: KnowledgeCard;
        let action: string;

        if (order === 'before') {
            // Remote is strictly newer — accept remote content
            winner = remote;
            action = 'remote-wins';
        } else {
            // Concurrent — LWW tie-break on HLC
            const hlcCmp = compareHLC(local.crdt.hlc, remote.crdt.hlc);
            winner = hlcCmp >= 0 ? local : remote;
            action = hlcCmp >= 0 ? 'local-wins-concurrent' : 'remote-wins-concurrent';
        }

        // Merge metadata regardless of content winner
        const mergedVectorClock = mergeVectorClocks(
            local.crdt.vectorClock,
            remote.crdt.vectorClock
        );
        const mergedHlc = receiveHLC(local.crdt.hlc, remote.crdt.hlc);
        // Tombstone wins: once deleted, stays deleted
        const tombstone = local.crdt.tombstone || remote.crdt.tombstone;

        // Build merged card
        const merged: KnowledgeCard = {
            ...winner,
            crdt: {
                hlc: mergedHlc,
                vectorClock: mergedVectorClock,
                tombstone
            },
            // Take the higher version
            version: Math.max(local.version, remote.version),
            // Merge usage counters (take max of each)
            usage: {
                views: Math.max(local.usage.views, remote.usage.views),
                citations: Math.max(local.usage.citations, remote.usage.citations),
                applications: Math.max(local.usage.applications, remote.usage.applications),
                lastAccessed: Math.max(local.usage.lastAccessed, remote.usage.lastAccessed)
            },
            // Union verifications (deduplicate by verifier+timestamp)
            verifications: this.mergeVerifications(local.verifications, remote.verifications)
        };

        // Update indexes
        this.removeFromIndex(local);
        this.cards.set(merged.id, merged);
        if (!tombstone) {
            this.indexCard(merged);
        }

        // Handle tombstone side effects
        const space = this.spaces.get(merged.spaceId);
        if (space) {
            if (tombstone) {
                space.cards.delete(merged.id);
            } else {
                space.cards.add(merged.id);
            }
            space.stats.cardCount = space.cards.size;
        }

        this.saveCard(merged);
        this.emit('card:merged', { card: merged, action });
        return merged;
    }

    /**
     * Merge verification arrays, deduplicating by (verifier, timestamp).
     */
    private mergeVerifications(a: Verification[], b: Verification[]): Verification[] {
        const seen = new Set<string>();
        const merged: Verification[] = [];
        for (const v of [...a, ...b]) {
            const key = `${v.verifier}:${v.timestamp}`;
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(v);
            }
        }
        return merged;
    }

    /**
     * Serialize a card for network transmission (GossipSub).
     */
    serializeCard(card: KnowledgeCard): Uint8Array {
        return new TextEncoder().encode(JSON.stringify(card));
    }

    /**
     * Deserialize a card received from the network.
     */
    deserializeCard(data: Uint8Array): KnowledgeCard {
        const raw = JSON.parse(new TextDecoder().decode(data));
        return this.normalizeCard(raw);
    }

    /**
     * Handle incoming knowledge sync message from GossipSub.
     * Deserializes, merges, and emits sync events.
     */
    handleSyncMessage(data: Uint8Array, from: string): void {
        try {
            const remote = this.deserializeCard(data);
            const result = this.mergeCard(remote);
            if (result) {
                this.emit('sync:merged', { card: result, from });
            }
        } catch (err) {
            this.emit('sync:error', { error: err, from });
        }
    }

    /**
     * Get all cards that have been modified since a given timestamp.
     * Used for anti-entropy sync (periodic full-state exchange).
     */
    getModifiedSince(since: number): KnowledgeCard[] {
        return Array.from(this.cards.values())
            .filter(c => c.updatedAt > since);
    }

    async linkCards(
        sourceId: KnowledgeId,
        targetId: KnowledgeId,
        type: LinkType,
        strength: number = 0.5,
        evidence?: string
    ): Promise<KnowledgeLink> {
        // Verificar se cards existem
        if (!this.cards.has(sourceId) || !this.cards.has(targetId)) {
            throw new Error('Source or target card not found');
        }

        const link: KnowledgeLink = {
            id: `link_${ulid()}`,
            source: sourceId,
            target: targetId,
            type,
            strength: Math.max(0, Math.min(1, strength)),
            createdBy: this.identity.did,
            createdAt: Date.now(),
            evidence
        };

        this.links.push(link);
        this.indexLink(link);

        const space = this.spaces.get(this.cards.get(sourceId)!.spaceId);
        if (space) {
            space.links.push(link);
            space.stats.linkCount++;
        }

        await this.saveLink(link);
        this.emit('link:created', link);
        
        return link;
    }

    // ─── Knowledge Graph Queries ─────────────────────────────────

    queryCards(options: {
        spaceId?: SpaceId;
        type?: KnowledgeType;
        tags?: string[];
        author?: string;
        domain?: string[];
        query?: string;          // Full-text search
        verificationStatus?: KnowledgeCard['verificationStatus'];
        privacy?: PrivacyLevel;
        limit?: number;
        offset?: number;
        sortBy?: 'relevance' | 'confidence' | 'created' | 'usage';
    }): KnowledgeCard[] {
        let results = Array.from(this.cards.values())
            .filter(c => !c.crdt.tombstone);

        // Aplicar filtros
        if (options.spaceId) {
            results = results.filter(c => c.spaceId === options.spaceId);
        }
        if (options.type) {
            results = results.filter(c => c.type === options.type);
        }
        if (options.tags?.length) {
            results = results.filter(c => 
                options.tags!.some(tag => c.tags.includes(tag))
            );
        }
        if (options.author) {
            results = results.filter(c => c.author === options.author);
        }
        if (options.domain?.length) {
            results = results.filter(c => 
                options.domain!.some(d => c.domain.includes(d))
            );
        }
        if (options.verificationStatus) {
            results = results.filter(c => 
                c.verificationStatus === options.verificationStatus
            );
        }
        if (options.privacy) {
            results = results.filter(c => c.privacy === options.privacy);
        }

        // Full-text search simples
        if (options.query) {
            const q = options.query.toLowerCase();
            results = results.filter(c => 
                c.title.toLowerCase().includes(q) ||
                c.summary.toLowerCase().includes(q) ||
                c.content.toLowerCase().includes(q) ||
                c.tags.some(t => t.toLowerCase().includes(q))
            );
        }

        // Sorting
        switch (options.sortBy) {
            case 'confidence':
                results.sort((a, b) => b.confidence - a.confidence);
                break;
            case 'created':
                results.sort((a, b) => b.createdAt - a.createdAt);
                break;
            case 'usage':
                results.sort((a, b) => b.usage.applications - a.usage.applications);
                break;
            default:
                // relevance - combina vários fatores
                results.sort((a, b) => 
                    (b.confidence * b.usage.applications) - 
                    (a.confidence * a.usage.applications)
                );
        }

        // Pagination
        const offset = options.offset || 0;
        const limit = options.limit || 50;
        return results.slice(offset, offset + limit);
    }

    getRelatedCards(cardId: KnowledgeId, depth: number = 1): KnowledgeCard[] {
        const related = new Set<KnowledgeId>();
        let currentLevel = [cardId];
        const processed = new Set<KnowledgeId>();

        for (let d = 0; d < depth && currentLevel.length > 0; d++) {
            const nextLevel: KnowledgeId[] = [];
            for (const current of currentLevel) {
                if (processed.has(current)) continue;
                processed.add(current);

                // O(1) lookup via indexed maps instead of O(n) filter
                const outLinks = this.linksBySource.get(current) || [];
                const inLinks = this.linksByTarget.get(current) || [];

                for (const link of outLinks) {
                    if (!processed.has(link.target)) {
                        related.add(link.target);
                        nextLevel.push(link.target);
                    }
                }
                for (const link of inLinks) {
                    if (!processed.has(link.source)) {
                        related.add(link.source);
                        nextLevel.push(link.source);
                    }
                }
            }
            currentLevel = nextLevel;
        }

        return Array.from(related)
            .map(id => this.cards.get(id))
            .filter((c): c is KnowledgeCard => c !== undefined && !c.crdt.tombstone);
    }

    private indexLink(link: KnowledgeLink): void {
        if (!this.linksBySource.has(link.source)) {
            this.linksBySource.set(link.source, []);
        }
        this.linksBySource.get(link.source)!.push(link);

        if (!this.linksByTarget.has(link.target)) {
            this.linksByTarget.set(link.target, []);
        }
        this.linksByTarget.get(link.target)!.push(link);
    }

    getKnowledgeGraph(spaceId: SpaceId): {
        nodes: KnowledgeCard[];
        links: KnowledgeLink[];
    } {
        const space = this.spaces.get(spaceId);
        if (!space) return { nodes: [], links: [] };

        const nodes = Array.from(space.cards)
            .map(id => this.cards.get(id))
            .filter((c): c is KnowledgeCard => c !== undefined && !c.crdt.tombstone);

        return { nodes, links: space.links };
    }

    // ─── Collective Unconscious ──────────────────────────────────

    private async createCollectiveUnconscious(spaceId: SpaceId): Promise<CollectiveUnconscious> {
        const cu: CollectiveUnconscious = {
            id: `cu_${spaceId}`,
            spaceId,
            workingMemory: {
                recentMessages: [],
                activeTopics: [],
                participants: [],
                contextWindow: ''
            },
            longTermMemory: {
                keyConcepts: [],
                recurringThemes: [],
                learnedPatterns: [],
                agentModels: {}
            },
            sharedState: {
                goals: [],
                plans: [],
                decisions: [],
                openQuestions: []
            },
            lastUpdate: Date.now(),
            coherence: 1.0
        };

        this.collectiveUnconscious.set(spaceId, cu);
        return cu;
    }

    private async updateCollectiveUnconscious(
        spaceId: SpaceId,
        card: KnowledgeCard
    ): Promise<void> {
        const cu = this.collectiveUnconscious.get(spaceId);
        if (!cu) return;

        // Atualizar memória de longo prazo
        if (card.type === 'concept' || card.type === 'insight') {
            cu.longTermMemory.keyConcepts.push(card.id);
        }

        if (card.type === 'decision') {
            cu.sharedState.decisions.push(card.title);
        }

        // Extrair tópicos
        cu.workingMemory.activeTopics = [...card.tags, ...card.domain];
        
        // Atualizar timestamp
        cu.lastUpdate = Date.now();
        
        // Simplificar: gerar context window
        cu.workingMemory.contextWindow = await this.generateContextWindow(spaceId);

        await this.saveCollectiveUnconscious(cu);
        this.emit('collective:updated', cu);
    }

    async updateWorkingMemory(
        spaceId: SpaceId,
        update: Partial<CollectiveUnconscious['workingMemory']>
    ): Promise<void> {
        const cu = this.collectiveUnconscious.get(spaceId);
        if (!cu) throw new Error('Collective unconscious not found');

        Object.assign(cu.workingMemory, update);
        cu.lastUpdate = Date.now();
        
        await this.saveCollectiveUnconscious(cu);
    }

    getCollectiveUnconscious(spaceId: SpaceId): CollectiveUnconscious | undefined {
        return this.collectiveUnconscious.get(spaceId);
    }

    getSharedContext(spaceId: SpaceId): string {
        const cu = this.collectiveUnconscious.get(spaceId);
        if (!cu) return '';

        return `
# Contexto Compartilhado (Inconsciente Coletivo)

## Tópicos Ativos
${cu.workingMemory.activeTopics.join(', ')}

## Conceitos-Chave
${cu.longTermMemory.keyConcepts.slice(0, 10).join(', ')}

## Objetivos Atuais
${cu.sharedState.goals.join('\n')}

## Decisões Recentes
${cu.sharedState.decisions.slice(-5).join('\n')}

## Contexto da Conversa
${cu.workingMemory.contextWindow}
        `.trim();
    }

    // ─── Conversational Knowledge Exchange ─────────────────────

    /**
     * Get or create CollectiveUnconscious for a space/room.
     * Public so rooms can initialize knowledge tracking.
     */
    async getOrCreateCU(spaceId: SpaceId): Promise<CollectiveUnconscious> {
        const existing = this.collectiveUnconscious.get(spaceId);
        if (existing) return existing;
        return this.createCollectiveUnconscious(spaceId);
    }

    /**
     * Ingest a chat message into the collaborative context.
     * Called by RoomManager when chat messages are received.
     * Triggers auto-compaction when buffer exceeds threshold.
     */
    async ingestChatMessage(spaceId: SpaceId, msg: ChatMessage): Promise<void> {
        const cu = await this.getOrCreateCU(spaceId);

        // Add to raw buffer
        if (!this.chatBuffers.has(spaceId)) {
            this.chatBuffers.set(spaceId, []);
        }
        const buffer = this.chatBuffers.get(spaceId)!;
        buffer.push(msg);

        // Update working memory
        const senderLabel = msg.senderName || msg.sender.slice(0, 16);
        cu.workingMemory.recentMessages.push(
            `[${senderLabel}]: ${msg.content}`
        );

        // Track participants
        if (!cu.workingMemory.participants.includes(msg.sender)) {
            cu.workingMemory.participants.push(msg.sender);
        }

        // Trim recent messages to max
        const max = this.compactionConfig.maxRecentMessages;
        if (cu.workingMemory.recentMessages.length > max) {
            cu.workingMemory.recentMessages = cu.workingMemory.recentMessages.slice(-max);
        }

        cu.lastUpdate = Date.now();

        // Auto-compact when buffer reaches threshold
        if (buffer.length >= this.compactionConfig.compactAfterMessages && !this.compacting.has(spaceId)) {
            this.compacting.add(spaceId);
            this.compactContext(spaceId).finally(() => this.compacting.delete(spaceId));
        }

        this.emit('chat:ingested', { spaceId, msg });
    }

    /**
     * Compact the conversation context using Ollama.
     * Summarizes recent messages into a dense context window,
     * extracts key concepts, decisions, and open questions.
     */
    async compactContext(spaceId: SpaceId): Promise<void> {
        const cu = this.collectiveUnconscious.get(spaceId);
        if (!cu) return;

        const buffer = this.chatBuffers.get(spaceId) || [];
        if (buffer.length === 0) return;

        // Build conversation transcript
        const transcript = buffer.map(m => {
            const name = m.senderName || m.sender.slice(0, 16);
            return `${name}: ${m.content}`;
        }).join('\n');

        const previousContext = cu.workingMemory.contextWindow || '';

        try {
            const response = await this.callOllama(
                `You are a context compactor for a multi-agent conversation system.

Given the previous context summary and new conversation messages, produce a COMPACT updated context.

PREVIOUS CONTEXT:
${previousContext || '(none)'}

NEW MESSAGES:
${transcript}

Produce a JSON response with these fields:
- "contextSummary": A concise summary of the conversation state (max 500 chars)
- "activeTopics": Array of topic strings currently being discussed
- "keyConcepts": Array of key facts/concepts established
- "decisions": Array of decisions made (if any)
- "openQuestions": Array of unresolved questions
- "recurringThemes": Array of recurring themes

Respond ONLY with valid JSON, no markdown.`
            );

            const parsed = this.parseJsonResponse(response);
            if (parsed) {
                cu.workingMemory.contextWindow = parsed.contextSummary || previousContext;
                cu.workingMemory.activeTopics = parsed.activeTopics || cu.workingMemory.activeTopics;

                if (parsed.keyConcepts?.length) {
                    for (const concept of parsed.keyConcepts) {
                        if (!cu.longTermMemory.keyConcepts.includes(concept)) {
                            cu.longTermMemory.keyConcepts.push(concept);
                        }
                    }
                    // Keep bounded
                    cu.longTermMemory.keyConcepts = cu.longTermMemory.keyConcepts.slice(-50);
                }

                if (parsed.decisions?.length) {
                    cu.sharedState.decisions.push(...parsed.decisions);
                    cu.sharedState.decisions = cu.sharedState.decisions.slice(-20);
                }

                if (parsed.openQuestions?.length) {
                    cu.sharedState.openQuestions = parsed.openQuestions;
                }

                if (parsed.recurringThemes?.length) {
                    cu.longTermMemory.recurringThemes = parsed.recurringThemes;
                }
            }
        } catch {
            // Ollama unavailable — use simple text compaction
            cu.workingMemory.contextWindow = this.simpleCompact(previousContext, transcript);
        }

        // Clear the buffer after compaction
        this.chatBuffers.set(spaceId, []);
        cu.lastUpdate = Date.now();
        cu.coherence = Math.min(1.0, cu.coherence + 0.05);

        await this.saveCollectiveUnconscious(cu);
        this.emit('context:compacted', { spaceId, cu });
    }

    /**
     * Serialize the collaborative context for sharing with peers.
     * Used by knowledge.context_sync SWP messages.
     */
    serializeContext(spaceId: SpaceId): Uint8Array | null {
        const cu = this.collectiveUnconscious.get(spaceId);
        if (!cu) return null;

        const payload = {
            spaceId,
            contextWindow: cu.workingMemory.contextWindow,
            activeTopics: cu.workingMemory.activeTopics,
            keyConcepts: cu.longTermMemory.keyConcepts,
            recurringThemes: cu.longTermMemory.recurringThemes,
            decisions: cu.sharedState.decisions,
            openQuestions: cu.sharedState.openQuestions,
            lastUpdate: cu.lastUpdate,
        };

        return new TextEncoder().encode(JSON.stringify(payload));
    }

    /**
     * Merge a remote context sync into the local CollectiveUnconscious.
     * Takes the union of topics, concepts, decisions, etc.
     */
    async mergeRemoteContext(data: Uint8Array): Promise<void> {
        try {
            const remote = JSON.parse(new TextDecoder().decode(data));
            const cu = await this.getOrCreateCU(remote.spaceId);

            // Merge context window: keep longer/newer
            if (remote.lastUpdate > cu.lastUpdate && remote.contextWindow) {
                cu.workingMemory.contextWindow = remote.contextWindow;
            }

            // Union active topics
            if (remote.activeTopics?.length) {
                const topics = new Set([...cu.workingMemory.activeTopics, ...remote.activeTopics]);
                cu.workingMemory.activeTopics = Array.from(topics).slice(-20);
            }

            // Union key concepts
            if (remote.keyConcepts?.length) {
                const concepts = new Set([...cu.longTermMemory.keyConcepts, ...remote.keyConcepts]);
                cu.longTermMemory.keyConcepts = Array.from(concepts).slice(-50);
            }

            // Union recurring themes
            if (remote.recurringThemes?.length) {
                const themes = new Set([...cu.longTermMemory.recurringThemes, ...remote.recurringThemes]);
                cu.longTermMemory.recurringThemes = Array.from(themes);
            }

            // Union decisions
            if (remote.decisions?.length) {
                const decisions = new Set([...cu.sharedState.decisions, ...remote.decisions]);
                cu.sharedState.decisions = Array.from(decisions).slice(-20);
            }

            // Merge open questions
            if (remote.openQuestions?.length) {
                const questions = new Set([...cu.sharedState.openQuestions, ...remote.openQuestions]);
                cu.sharedState.openQuestions = Array.from(questions);
            }

            cu.lastUpdate = Math.max(cu.lastUpdate, remote.lastUpdate);
            await this.saveCollectiveUnconscious(cu);
            this.emit('context:synced', { spaceId: remote.spaceId });
        } catch (err) {
            this.emit('context:sync-error', { error: err });
        }
    }

    /**
     * Get the chat message buffer for a space (for inspection/testing).
     */
    getChatBuffer(spaceId: SpaceId): ChatMessage[] {
        return this.chatBuffers.get(spaceId) || [];
    }

    // ─── Knowledge Gossip Sync ───────────────────────────────────

    /**
     * Get top knowledge cards for gossip broadcast to peers.
     * Returns cards sorted by confidence * usage, most valuable first.
     */
    getGossipPayload(spaceId: SpaceId, limit = 10): KnowledgeCard[] {
        return this.queryCards({
            spaceId,
            sortBy: 'relevance',
            limit,
        });
    }

    /**
     * Apply knowledge decay to all cards.
     * Cards not reinforced lose confidence over time.
     * Should be called periodically (e.g., daily).
     *
     * @param decayRate - fraction of confidence lost per call (default 0.05 = 5%)
     */
    applyKnowledgeDecay(decayRate = 0.05): number {
        let decayed = 0;
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;

        for (const card of this.cards.values()) {
            if (card.crdt.tombstone) continue;

            const daysSinceAccess = (now - card.usage.lastAccessed) / dayMs;
            if (daysSinceAccess < 1) continue; // Skip recently accessed

            const oldConfidence = card.confidence;
            card.confidence = Math.max(0.1, card.confidence * (1 - decayRate));

            if (card.confidence !== oldConfidence) {
                card.updatedAt = now;
                this.saveCard(card);
                decayed++;
            }
        }

        this.emit('knowledge:decay', { decayed, decayRate });
        return decayed;
    }

    /**
     * Boost confidence when multiple agents confirm the same fact.
     * If 2+ agents have verified a card, boost by confirmationBoost.
     *
     * @param cardId - card to boost
     * @param verifierDid - DID of the confirming agent
     * @param boostAmount - confidence boost (default 0.2 = 20%)
     */
    confirmKnowledge(cardId: KnowledgeId, verifierDid: string, boostAmount = 0.2): KnowledgeCard | null {
        const card = this.cards.get(cardId);
        if (!card || card.crdt.tombstone) return null;

        // Add verification if not already present
        const alreadyVerified = card.verifications.some(v => v.verifier === verifierDid);
        if (!alreadyVerified) {
            card.verifications.push({
                verifier: verifierDid,
                timestamp: Date.now(),
                method: 'consensus',
                confidence: card.confidence + boostAmount,
            });
        }

        // Boost confidence based on number of unique verifiers
        const uniqueVerifiers = new Set(card.verifications.map(v => v.verifier));
        if (uniqueVerifiers.size >= 2) {
            card.confidence = Math.min(1.0, card.confidence + boostAmount);
            card.verificationStatus = 'verified';
        }

        card.updatedAt = Date.now();
        card.crdt.hlc = tickHLC(card.crdt.hlc);
        card.crdt.vectorClock[this.identity.did] =
            (card.crdt.vectorClock[this.identity.did] || 0) + 1;

        this.saveCard(card);
        this.emit('knowledge:confirmed', { cardId, verifier: verifierDid, confidence: card.confidence });
        return card;
    }

    /**
     * Distill lessons learned from a completed CoC chain.
     * Creates knowledge cards from the chain's experience.
     *
     * @param chainId - ID of the completed chain
     * @param summary - chain summary/final report
     * @param goal - original chain goal
     * @param spaceId - space to store knowledge in
     * @param participants - DIDs of participating agents
     */
    async distillChainExperience(
        chainId: string,
        summary: string,
        goal: string,
        spaceId: SpaceId,
        participants: string[]
    ): Promise<KnowledgeCard[]> {
        const space = this.spaces.get(spaceId);
        if (!space) return [];

        const cards: KnowledgeCard[] = [];

        try {
            const response = await this.callOllama(
                `You are a knowledge extractor for a multi-agent collaboration system.

A collaborative chain (goal: "${goal}") has completed. Extract the key lessons learned.

CHAIN SUMMARY:
${summary}

PARTICIPANTS: ${participants.length} agents

Produce a JSON array of knowledge items to store. Each item should have:
- "type": one of "insight", "decision", "sop", "finding"
- "title": concise title (max 80 chars)
- "content": detailed description
- "tags": array of relevant tags
- "confidence": 0-1 confidence score

Respond ONLY with a valid JSON array.`
            );

            const parsed = this.parseJsonResponse(response);
            const items = Array.isArray(parsed) ? parsed : (parsed?.items || []);

            for (const item of items.slice(0, 5)) {
                if (!item.title || !item.content) continue;
                const card = await this.createCard(spaceId, item.type || 'insight', item.title, item.content, {
                    tags: item.tags || [],
                    source: { type: 'coc', id: chainId, context: goal },
                    confidence: item.confidence || 0.7,
                });
                cards.push(card);
            }
        } catch {
            // Ollama unavailable — create a single summary card
            const card = await this.createCard(spaceId, 'finding', `Chain ${chainId.slice(0, 8)}: ${goal}`, summary, {
                tags: ['chain-distill', 'auto-extracted'],
                source: { type: 'coc', id: chainId, context: goal },
                confidence: 0.6,
            });
            cards.push(card);
        }

        this.emit('knowledge:distilled', { chainId, cardCount: cards.length });
        return cards;
    }

    /**
     * Extract knowledge from a batch of chat messages.
     * Used for periodic knowledge extraction from conversations.
     */
    async extractFromConversation(
        spaceId: SpaceId,
        messages: ChatMessage[]
    ): Promise<KnowledgeCard[]> {
        const space = this.spaces.get(spaceId);
        if (!space || messages.length === 0) return [];

        const transcript = messages.map(m => {
            const name = m.senderName || m.sender.slice(0, 16);
            return `${name}: ${m.content}`;
        }).join('\n');

        const cards: KnowledgeCard[] = [];

        try {
            const response = await this.callOllama(
                `You are a knowledge extractor. Extract key facts and insights from this conversation.

CONVERSATION:
${transcript}

Extract structured knowledge items as a JSON array. Each item:
- "type": "fact" | "insight" | "decision" | "hypothesis"
- "title": concise title
- "content": the knowledge content
- "tags": relevant tags
- "confidence": 0-1

Only extract genuinely useful knowledge. Skip small talk or trivial messages.
Respond ONLY with a valid JSON array. Return empty array [] if nothing useful.`
            );

            const parsed = this.parseJsonResponse(response);
            const items = Array.isArray(parsed) ? parsed : [];

            for (const item of items.slice(0, 5)) {
                if (!item.title || !item.content) continue;
                const card = await this.createCard(spaceId, item.type || 'fact', item.title, item.content, {
                    tags: [...(item.tags || []), 'auto-extracted', 'chat'],
                    source: { type: 'chat', context: spaceId },
                    confidence: item.confidence || 0.6,
                });
                cards.push(card);
            }
        } catch {
            // Ollama unavailable — skip extraction
        }

        this.emit('knowledge:extracted', { spaceId, cardCount: cards.length });
        return cards;
    }

    // ─── Private Helpers ─────────────────────────────────────────

    /**
     * Simple text-based compaction when Ollama is unavailable.
     * Keeps last few lines of previous context + summary of new transcript.
     */
    private simpleCompact(previousContext: string, newTranscript: string): string {
        const prevLines = previousContext ? previousContext.split('\n').slice(-5).join('\n') : '';
        const newLines = newTranscript.split('\n');
        const summary = newLines.length > 10
            ? `[${newLines.length} messages exchanged covering: ${newLines.slice(0, 3).join('; ')}...]`
            : newLines.join('\n');

        return [prevLines, summary].filter(Boolean).join('\n---\n').slice(-2000);
    }

    /**
     * Call Ollama for context summarization.
     */
    private async callOllama(prompt: string): Promise<string> {
        const url = `${this.compactionConfig.ollamaUrl}/api/generate`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.compactionConfig.ollamaModel,
                prompt,
                stream: false,
                options: { temperature: 0.3, num_predict: 1024 },
            }),
        });

        if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
        const json = await res.json() as { response: string };
        return json.response;
    }

    /**
     * Parse JSON from LLM response (handles markdown code blocks).
     */
    private parseJsonResponse(text: string): any {
        // Strip thinking tags if present
        let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        // Strip markdown code blocks
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        try {
            return JSON.parse(cleaned);
        } catch {
            // Try to extract JSON object
            const match = cleaned.match(/\{[\s\S]*\}/);
            if (match) {
                try { return JSON.parse(match[0]); } catch { /* ignore */ }
            }
            return null;
        }
    }

    private generateSummary(content: string, maxLength: number = 200): string {
        // Remover markdown
        const plain = content
            .replace(/[#*`\[\]()]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        if (plain.length <= maxLength) return plain;
        return plain.substring(0, maxLength) + '...';
    }

    private extractEntities(content: string): string[] {
        // Simples: extrair palavras capitalizadas como entidades
        const entities = new Set<string>();
        const matches = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
        if (matches) {
            matches.forEach(e => entities.add(e));
        }
        return Array.from(entities).slice(0, 20);
    }

    private async generateContextWindow(spaceId: SpaceId): Promise<string> {
        // Pegar cards mais relevantes do space
        const cards = this.queryCards({
            spaceId,
            sortBy: 'usage',
            limit: 10
        });

        return cards
            .map(c => `- ${c.title}: ${c.summary}`)
            .join('\n');
    }

    private indexCard(card: KnowledgeCard): void {
        // Tags
        this.addToTagIndex(card);
        
        // Author
        if (!this.authorIndex.has(card.author)) {
            this.authorIndex.set(card.author, new Set());
        }
        this.authorIndex.get(card.author)!.add(card.id);
        
        // Type
        if (!this.typeIndex.has(card.type)) {
            this.typeIndex.set(card.type, new Set());
        }
        this.typeIndex.get(card.type)!.add(card.id);
    }

    private addToTagIndex(card: KnowledgeCard): void {
        for (const tag of card.tags) {
            if (!this.tagIndex.has(tag)) {
                this.tagIndex.set(tag, new Set());
            }
            this.tagIndex.get(tag)!.add(card.id);
        }
    }

    private removeFromTagIndex(card: KnowledgeCard): void {
        for (const tag of card.tags) {
            this.tagIndex.get(tag)?.delete(card.id);
        }
    }

    private removeFromIndex(card: KnowledgeCard): void {
        this.removeFromTagIndex(card);
        this.authorIndex.get(card.author)?.delete(card.id);
        this.typeIndex.get(card.type)?.delete(card.id);
    }

    private async saveCard(card: KnowledgeCard): Promise<void> {
        this.storage.saveKnowledgeCard?.(card);
    }

    private async saveSpace(space: KnowledgeSpace): Promise<void> {
        this.storage.saveKnowledgeSpace?.(space);
    }

    private async saveLink(link: KnowledgeLink): Promise<void> {
        this.storage.saveKnowledgeLink?.(link);
    }

    private async saveCollectiveUnconscious(cu: CollectiveUnconscious): Promise<void> {
        this.storage.saveCollectiveUnconscious?.(cu);
    }

    private loadFromStorage(): void {
        const spaces = this.storage.getKnowledgeSpaces?.() || [];
        for (const rawSpace of spaces) {
            const space = this.normalizeSpace(rawSpace);
            this.spaces.set(space.id, space);
        }

        const cards = this.storage.getKnowledgeCards?.() || [];
        for (const rawCard of cards) {
            const card = this.normalizeCard(rawCard);
            this.cards.set(card.id, card);
            this.indexCard(card);

            const space = this.spaces.get(card.spaceId);
            if (space) {
                space.cards.add(card.id);
                space.stats.cardCount = Math.max(space.stats.cardCount, space.cards.size);
            }
        }

        const links = this.storage.getKnowledgeLinks?.() || [];
        this.links = links.map((link: any) => this.normalizeLink(link));
        // Rebuild link indexes for O(1) graph traversal
        this.linksBySource.clear();
        this.linksByTarget.clear();
        for (const link of this.links) {
            this.indexLink(link);
            const sourceCard = this.cards.get(link.source);
            if (!sourceCard) continue;
            const space = this.spaces.get(sourceCard.spaceId);
            if (!space) continue;
            space.links.push(link);
            space.stats.linkCount = space.links.length;
        }

        const collectiveStates = this.storage.getCollectiveUnconscious?.() || [];
        for (const state of collectiveStates) {
            if (state?.spaceId) {
                this.collectiveUnconscious.set(state.spaceId, state);
            }
        }
    }

    private normalizeSpace(rawSpace: any): KnowledgeSpace {
        const cards = rawSpace.cards instanceof Set
            ? rawSpace.cards
            : new Set(Array.isArray(rawSpace.cards) ? rawSpace.cards : []);

        return {
            ...rawSpace,
            cards,
            links: [],
            subspaces: Array.isArray(rawSpace.subspaces) ? rawSpace.subspaces : [],
            stats: {
                cardCount: rawSpace.stats?.cardCount ?? cards.size,
                linkCount: rawSpace.stats?.linkCount ?? 0,
                contributorCount: rawSpace.stats?.contributorCount ?? 1,
                lastActivity: rawSpace.stats?.lastActivity ?? rawSpace.updatedAt ?? Date.now()
            }
        };
    }

    private normalizeCard(rawCard: any): KnowledgeCard {
        const now = Date.now();
        return {
            ...rawCard,
            tags: Array.isArray(rawCard.tags) ? rawCard.tags : [],
            domain: Array.isArray(rawCard.domain) ? rawCard.domain : [],
            entities: Array.isArray(rawCard.entities) ? rawCard.entities : [],
            verifications: Array.isArray(rawCard.verifications) ? rawCard.verifications : [],
            crdt: rawCard.crdt || {
                hlc: { wallTime: now, logical: 0, nodeId: this.identity.did },
                vectorClock: { [this.identity.did]: 1 },
                tombstone: false
            }
        } as KnowledgeCard;
    }

    private normalizeLink(rawLink: any): KnowledgeLink {
        return {
            ...rawLink,
            strength: typeof rawLink.strength === 'number' ? rawLink.strength : 0.5
        } as KnowledgeLink;
    }
}

// Classes already exported via 'export class'
