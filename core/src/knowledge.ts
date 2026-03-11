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

// ─── Knowledge Pool Engine ───────────────────────────────────────

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
    
    constructor(
        private storage: Storage,
        private identity: Identity
    ) {
        super();
        this.loadFromStorage();
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

        // CRDT: Incrementar versão e atualizar clocks
        card.version++;
        card.updatedAt = Date.now();
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

    // ─── Private Helpers ─────────────────────────────────────────

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
