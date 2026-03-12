/**
 * Society Protocol - Context Compression & Optimization v1.0
 * 
 * Sistema de otimização de contexto e comunicações:
 * - Compressão de mensagens (LZ4, Zstd)
 * - Summarização inteligente de contexto
 * - Sliding window com relevância
 * - Semantic chunking
 * - Deduplicação de conteúdo
 * - Priorização de mensagens
 */

import { createHash } from 'crypto';
import { type SwpEnvelope } from './swp.js';

// ─── Types ───────────────────────────────────────────────────────

export interface CompressionConfig {
    algorithm: 'lz4' | 'zstd' | 'gzip' | 'none';
    level: number;  // 1-9 (quanto maior, mais compressão, mais lento)
    threshold: number;  // Tamanho mínimo para comprimir (bytes)
}

export interface ContextWindow {
    messages: Array<{
        id: string;
        timestamp: number;
        role: 'system' | 'user' | 'assistant';
        content: string;
        tokens: number;
        relevance: number;  // 0-1, calculado dinamicamente
        compressed: boolean;
        summary?: string;
    }>;
    totalTokens: number;
    maxTokens: number;
    compressed: boolean;
}

export interface SemanticChunk {
    id: string;
    content: string;
    tokens: number;
    embeddings?: number[];  // Vetor semântico (se disponível)
    entities: string[];
    topics: string[];
    timestamp: number;
    importance: number;
}

export interface SummaryResult {
    originalLength: number;
    summaryLength: number;
    compressionRatio: number;
    keyPoints: string[];
    entities: string[];
    sentiment: 'positive' | 'negative' | 'neutral';
}

// ─── Message Compression ─────────────────────────────────────────

export class MessageCompressor {
    private config: CompressionConfig;

    constructor(config?: Partial<CompressionConfig>) {
        this.config = {
            algorithm: config?.algorithm || 'zstd',
            level: config?.level || 3,
            threshold: config?.threshold || 1024  // 1KB
        };
    }

    async compress(data: Uint8Array): Promise<Uint8Array> {
        if (data.length < this.config.threshold) {
            return data;  // Não comprimir dados pequenos
        }

        switch (this.config.algorithm) {
            case 'lz4':
                return this.compressLZ4(data);
            case 'zstd':
                return this.compressZstd(data);
            case 'gzip':
                return this.compressGzip(data);
            default:
                return data;
        }
    }

    async decompress(data: Uint8Array, algorithm: string): Promise<Uint8Array> {
        switch (algorithm) {
            case 'lz4':
                return this.decompressLZ4(data);
            case 'zstd':
                return this.decompressZstd(data);
            case 'gzip':
                return this.decompressGzip(data);
            default:
                return data;
        }
    }

    private async compressLZ4(data: Uint8Array): Promise<Uint8Array> {
        try {
            const lz4 = await this.dynamicImport('lz4js');
            const compressed = lz4.compress(data);
            return this.packCodecPayload('L4', 1, new Uint8Array(compressed));
        } catch {
            const compressed = await this.compressGzip(data);
            return this.packCodecPayload('L4', 2, compressed);
        }
    }

    private async compressZstd(data: Uint8Array): Promise<Uint8Array> {
        try {
            const zstd = await this.dynamicImport('@bokuweb/zstd-wasm');
            await zstd.init?.();
            const compressed = zstd.compress(data);
            return this.packCodecPayload('ZS', 1, new Uint8Array(compressed));
        } catch {
            const compressed = await this.compressGzip(data);
            return this.packCodecPayload('ZS', 2, compressed);
        }
    }

    private async compressGzip(data: Uint8Array): Promise<Uint8Array> {
        // Usar zlib do Node.js
        const { gzip } = await import('zlib');
        const { promisify } = await import('util');
        const gzipAsync = promisify(gzip);
        
        const compressed = await gzipAsync(Buffer.from(data), {
            level: this.config.level
        });
        
        return new Uint8Array(compressed);
    }

    private async decompressLZ4(data: Uint8Array): Promise<Uint8Array> {
        const { codec, variant, payload } = this.unpackCodecPayload(data);
        if (codec !== 'L4') {
            throw new Error('Invalid LZ4 payload header');
        }

        if (variant === 1) {
            const lz4 = await this.dynamicImport('lz4js');
            return new Uint8Array(lz4.decompress(payload));
        }

        if (variant === 2) {
            return this.decompressGzip(payload);
        }

        throw new Error(`Unsupported LZ4 variant: ${variant}`);
    }

    private async decompressZstd(data: Uint8Array): Promise<Uint8Array> {
        const { codec, variant, payload } = this.unpackCodecPayload(data);
        if (codec !== 'ZS') {
            throw new Error('Invalid Zstd payload header');
        }

        if (variant === 1) {
            const zstd = await this.dynamicImport('@bokuweb/zstd-wasm');
            await zstd.init?.();
            return new Uint8Array(zstd.decompress(payload));
        }

        if (variant === 2) {
            return this.decompressGzip(payload);
        }

        throw new Error(`Unsupported Zstd variant: ${variant}`);
    }

    private async decompressGzip(data: Uint8Array): Promise<Uint8Array> {
        const { gunzip } = await import('zlib');
        const { promisify } = await import('util');
        const gunzipAsync = promisify(gunzip);
        
        const decompressed = await gunzipAsync(Buffer.from(data));
        return new Uint8Array(decompressed);
    }

    private packCodecPayload(codec: 'L4' | 'ZS', variant: number, payload: Uint8Array): Uint8Array {
        const header = new Uint8Array([
            codec.charCodeAt(0),
            codec.charCodeAt(1),
            variant & 0xff
        ]);
        const result = new Uint8Array(header.length + payload.length);
        result.set(header, 0);
        result.set(payload, header.length);
        return result;
    }

    private unpackCodecPayload(data: Uint8Array): {
        codec: 'L4' | 'ZS';
        variant: number;
        payload: Uint8Array;
    } {
        if (data.length < 4) {
            throw new Error('Invalid compressed payload');
        }
        const codec = String.fromCharCode(data[0], data[1]) as 'L4' | 'ZS';
        return {
            codec,
            variant: data[2],
            payload: data.slice(3)
        };
    }

    private async dynamicImport(moduleName: string): Promise<any> {
        return import(moduleName);
    }

    getCompressionStats(original: number, compressed: number): {
        ratio: number;
        savings: number;
        savingsPercent: number;
    } {
        const savings = original - compressed;
        return {
            ratio: compressed / original,
            savings,
            savingsPercent: (savings / original) * 100
        };
    }
}

// ─── Context Optimizer ───────────────────────────────────────────

export class ContextOptimizer {
    private maxTokens: number;
    private reserveTokens: number;

    constructor(maxTokens: number = 8000, reserveTokens: number = 2000) {
        this.maxTokens = maxTokens;
        this.reserveTokens = reserveTokens;
    }

    /**
     * Otimizar janela de contexto mantendo apenas o mais relevante
     */
    optimizeWindow(window: ContextWindow): ContextWindow {
        if (window.totalTokens <= this.maxTokens - this.reserveTokens) {
            return window;  // Já está otimizado
        }

        // Calcular relevância de cada mensagem
        const scoredMessages = window.messages.map(msg => ({
            ...msg,
            score: this.calculateRelevance(msg, window.messages)
        }));

        // Ordenar por relevância (mantendo ordem cronológica para mensagens similares)
        scoredMessages.sort((a, b) => {
            if (Math.abs(a.score - b.score) < 0.1) {
                return a.timestamp - b.timestamp;
            }
            return b.score - a.score;
        });

        // Selecionar mensagens até atingir o limite
        const selected: any[] = [];
        let tokenCount = 0;

        for (const msg of scoredMessages) {
            if (tokenCount + msg.tokens <= this.maxTokens - this.reserveTokens) {
                selected.push(msg);
                tokenCount += msg.tokens;
            } else if (msg.role === 'system') {
                // Sempre manter mensagens de sistema, comprimindo se necessário
                const compressed = this.compressMessage(msg);
                if (tokenCount + compressed.tokens <= this.maxTokens - this.reserveTokens) {
                    selected.push(compressed);
                    tokenCount += compressed.tokens;
                }
            }
        }

        // Reordenar por timestamp
        selected.sort((a, b) => a.timestamp - b.timestamp);

        return {
            messages: selected,
            totalTokens: tokenCount,
            maxTokens: this.maxTokens,
            compressed: true
        };
    }

    /**
     * Comprimir mensagem mantendo informação essencial
     */
    compressMessage(msg: ContextWindow['messages'][0]): ContextWindow['messages'][0] {
        if (msg.compressed) return msg;

        // Estratégias de compressão baseadas no tipo
        let compressed = msg.content;

        if (msg.content.length > 500) {
            // Remover repetições
            compressed = this.removeRepetitions(compressed);
            
            // Substituir citações longas por referências
            compressed = this.compressQuotes(compressed);
            
            // Resumir se ainda for longo
            if (compressed.length > 1000) {
                compressed = this.summarizeText(compressed, 500);
            }
        }

        // Estimar tokens (regra geral: ~4 chars/token)
        const estimatedTokens = Math.ceil(compressed.length / 4);

        const result: any = {
            ...msg,
            content: compressed,
            tokens: estimatedTokens,
            compressed: true,
            summary: msg.summary || this.extractKeyPoints(msg.content)[0]
        };
        return result;
    }

    /**
     * Criar summary progressivo do contexto
     */
    createProgressiveSummary(messages: ContextWindow['messages']): string {
        // Agrupar mensagens em blocos
        const chunks = this.chunkMessages(messages, 5);
        
        const summaries: string[] = [];
        for (const chunk of chunks) {
            const content = chunk.map(m => m.content).join('\n');
            const summary = this.summarizeText(content, 200);
            summaries.push(summary);
        }

        // Se ainda for muito longo, criar summary de summaries
        if (summaries.join('\n').length > 1000) {
            return this.summarizeText(summaries.join('\n'), 500);
        }

        return summaries.join('\n\n');
    }

    /**
     * Deduplicar mensagens similares
     */
    deduplicateMessages(messages: ContextWindow['messages']): ContextWindow['messages'] {
        const seen = new Map<string, ContextWindow['messages'][0]>();
        const result: ContextWindow['messages'] = [];

        for (const msg of messages) {
            const hash = this.hashContent(msg.content);
            
            if (seen.has(hash)) {
                // Manter a mais recente
                const existing = seen.get(hash)!;
                if (msg.timestamp > existing.timestamp) {
                    const idx = result.indexOf(existing);
                    if (idx !== -1) {
                        result[idx] = msg;
                        seen.set(hash, msg);
                    }
                }
            } else {
                seen.set(hash, msg);
                result.push(msg);
            }
        }

        return result;
    }

    private calculateRelevance(
        msg: ContextWindow['messages'][0],
        allMessages: ContextWindow['messages']
    ): number {
        let score = 0;

        // Recência (mensagens recentes são mais importantes)
        const now = Date.now();
        const age = now - msg.timestamp;
        const recencyScore = Math.exp(-age / (1000 * 60 * 60));  // Decaimento por hora
        score += recencyScore * 0.3;

        // Tipo de mensagem
        if (msg.role === 'system') score += 1.0;
        else if (msg.role === 'user') score += 0.8;
        else score += 0.6;

        // Conteúdo específico (se tiver entidades ou é acionável)
        if (msg.content.includes('?')) score += 0.1;  // Perguntas
        if (msg.content.includes('TODO') || msg.content.includes('ACTION')) score += 0.2;
        if (msg.content.includes('DECISION') || msg.content.includes('CONCLUSION')) score += 0.3;

        // Relevância já calculada (pode ter vindo de processamento anterior)
        score += msg.relevance * 0.5;

        // Tamanho (mensagens muito longas são penalizadas levemente)
        if (msg.tokens > 500) score -= 0.1;

        return Math.max(0, Math.min(1, score));
    }

    private removeRepetitions(text: string): string {
        // Remover sentenças repetidas
        const sentences = text.split(/[.!?]+/);
        const unique = new Set<string>();
        const result: string[] = [];

        for (const sentence of sentences) {
            const trimmed = sentence.trim();
            if (trimmed.length < 5) continue;
            
            const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ');
            if (!unique.has(normalized)) {
                unique.add(normalized);
                result.push(trimmed);
            }
        }

        return result.join('. ') + '.';
    }

    private compressQuotes(text: string): string {
        // Substituir citações longas por [Quote: hash]
        const quoteRegex = /(["'])(.{100,})\1/g;
        return text.replace(quoteRegex, (match, quote, content) => {
            const hash = createHash('md5').update(content).digest('hex').slice(0, 8);
            return `[Quote: ${hash}]`;
        });
    }

    private summarizeText(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;

        // Estratégia simples: primeira e última sentença + meio resumido
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
        
        if (sentences.length <= 3) {
            return text.slice(0, maxLength) + '...';
        }

        const first = sentences[0].trim();
        const last = sentences[sentences.length - 1].trim();
        const middle = sentences.slice(1, -1)
            .map(s => s.trim())
            .filter(s => s.length > 20)
            .slice(0, 3)
            .join('. ');

        const summary = `${first}. ${middle}... ${last}.`;
        
        if (summary.length > maxLength) {
            return summary.slice(0, maxLength - 3) + '...';
        }

        return summary;
    }

    private extractKeyPoints(text: string): string[] {
        const points: string[] = [];
        const lines = text.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            // Bullet points
            if (trimmed.match(/^[-•*]\s+/)) {
                points.push(trimmed.replace(/^[-•*]\s+/, ''));
            }
            // Números
            else if (trimmed.match(/^\d+[.)]\s+/)) {
                points.push(trimmed.replace(/^\d+[.)]\s+/, ''));
            }
            // Frases importantes (conclusões, ações)
            else if (trimmed.match(/^(Conclusion|Action|Decision|Key|Important):/i)) {
                points.push(trimmed);
            }
        }

        return points.length > 0 ? points : [text.slice(0, 100) + '...'];
    }

    private chunkMessages(
        messages: ContextWindow['messages'],
        chunkSize: number
    ): ContextWindow['messages'][] {
        const chunks: ContextWindow['messages'][] = [];
        for (let i = 0; i < messages.length; i += chunkSize) {
            chunks.push(messages.slice(i, i + chunkSize));
        }
        return chunks;
    }

    private hashContent(content: string): string {
        return createHash('md5').update(content).digest('hex');
    }
}

// ─── Semantic Chunker ────────────────────────────────────────────

export class SemanticChunker {
    private maxChunkSize: number;
    private overlap: number;

    constructor(maxChunkSize: number = 500, overlap: number = 50) {
        this.maxChunkSize = maxChunkSize;
        this.overlap = overlap;
    }

    /**
     * Dividir texto em chunks semânticos
     */
    chunk(text: string): SemanticChunk[] {
        // Primeiro, dividir por parágrafos
        const paragraphs = text.split('\n\n').filter(p => p.trim());
        
        const chunks: SemanticChunk[] = [];
        let currentChunk = '';

        for (const paragraph of paragraphs) {
            if (currentChunk.length + paragraph.length > this.maxChunkSize) {
                // Salvar chunk atual
                if (currentChunk) {
                    chunks.push(this.createChunk(currentChunk));
                }
                
                // Começar novo chunk com overlap
                const words = currentChunk.split(' ');
                const overlapText = words.slice(-this.overlap).join(' ');
                currentChunk = overlapText + '\n\n' + paragraph;
            } else {
                currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
            }
        }

        if (currentChunk) {
            chunks.push(this.createChunk(currentChunk));
        }

        return chunks;
    }

    /**
     * Mesclar chunks similares
     */
    mergeSimilarChunks(chunks: SemanticChunk[], threshold: number = 0.8): SemanticChunk[] {
        const merged: SemanticChunk[] = [];
        let current = chunks[0];

        for (let i = 1; i < chunks.length; i++) {
            const similarity = this.calculateSimilarity(current, chunks[i]);
            
            if (similarity > threshold && 
                current.content.length + chunks[i].content.length <= this.maxChunkSize * 1.5) {
                // Mesclar
                current = this.mergeTwoChunks(current, chunks[i]);
            } else {
                merged.push(current);
                current = chunks[i];
            }
        }

        if (current) merged.push(current);
        return merged;
    }

    private createChunk(content: string): SemanticChunk {
        const entities = this.extractEntities(content);
        const topics = this.extractTopics(content);
        
        return {
            id: `chunk_${createHash('md5').update(content).digest('hex').slice(0, 8)}`,
            content: content.trim(),
            tokens: Math.ceil(content.length / 4),  // Estimativa
            entities,
            topics,
            timestamp: Date.now(),
            importance: this.calculateImportance(content, entities, topics)
        };
    }

    private extractEntities(text: string): string[] {
        const entities = new Set<string>();
        
        // Nomes próprios (capitalizados)
        const properNouns = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
        if (properNouns) {
            properNouns.forEach(e => entities.add(e));
        }

        // Emails
        const emails = text.match(/\b[\w.-]+@[\w.-]+\.\w+\b/g);
        if (emails) {
            emails.forEach(e => entities.add(e));
        }

        // URLs
        const urls = text.match(/https?:\/\/[^\s]+/g);
        if (urls) {
            urls.forEach(u => entities.add(u));
        }

        return Array.from(entities).slice(0, 20);
    }

    private extractTopics(text: string): string[] {
        const topics = new Set<string>();
        
        // Hashtags
        const hashtags = text.match(/#[\w-]+/g);
        if (hashtags) {
            hashtags.forEach(h => topics.add(h.slice(1)));
        }

        // Palavras-chave (em maiúsculas ou negrito)
        const keywords = text.match(/\*\*([\w\s]+)\*\*|\b([A-Z]{2,})\b/g);
        if (keywords) {
            keywords.forEach(k => topics.add(k.replace(/\*\*/g, '').trim()));
        }

        return Array.from(topics).slice(0, 10);
    }

    private calculateImportance(content: string, entities: string[], topics: string[]): number {
        let score = 0.5;  // Base

        // Mais entidades = mais importante
        score += Math.min(0.2, entities.length * 0.01);

        // Tópicos explícitos
        score += Math.min(0.2, topics.length * 0.02);

        // Palavras indicativas
        const indicators = ['important', 'critical', 'key', 'main', 'essential', 'crucial'];
        const lower = content.toLowerCase();
        for (const indicator of indicators) {
            if (lower.includes(indicator)) score += 0.05;
        }

        // Perguntas são importantes
        if (content.includes('?')) score += 0.05;

        return Math.min(1, score);
    }

    private calculateSimilarity(a: SemanticChunk, b: SemanticChunk): number {
        // Similaridade baseada em entidades e tópicos compartilhados
        const sharedEntities = a.entities.filter(e => b.entities.includes(e));
        const sharedTopics = a.topics.filter(t => b.topics.includes(t));

        const entitySim = sharedEntities.length / Math.max(a.entities.length, b.entities.length, 1);
        const topicSim = sharedTopics.length / Math.max(a.topics.length, b.topics.length, 1);

        return (entitySim * 0.6) + (topicSim * 0.4);
    }

    private mergeTwoChunks(a: SemanticChunk, b: SemanticChunk): SemanticChunk {
        const content = a.content + '\n\n' + b.content;
        const entities = [...new Set([...a.entities, ...b.entities])];
        const topics = [...new Set([...a.topics, ...b.topics])];

        return {
            id: `merged_${a.id}_${b.id}`,
            content,
            tokens: a.tokens + b.tokens,
            entities,
            topics,
            timestamp: Math.max(a.timestamp, b.timestamp),
            importance: Math.max(a.importance, b.importance)
        };
    }
}

// ─── Message Prioritizer ─────────────────────────────────────────

export class MessagePrioritizer {
    /**
     * Priorizar mensagens para entrega
     */
    prioritize(messages: SwpEnvelope[]): SwpEnvelope[] {
        return messages
            .map(msg => ({
                msg,
                priority: this.calculatePriority(msg)
            }))
            .sort((a, b) => b.priority - a.priority)
            .map(p => p.msg);
    }

    private calculatePriority(msg: SwpEnvelope): number {
        let priority = 0;

        // Tipo de mensagem
        switch (msg.t) {
            case 'coc.handoff':
            case 'coc.cancel':
                priority += 100;
                break;
            case 'coc.assign':
            case 'coc.submit':
                priority += 50;
                break;
            case 'chat.msg':
                priority += 10;
                break;
            case 'presence.heartbeat':
                priority += 1;
                break;
            default:
                priority += 5;
        }

        // TTL (mensagens com TTL curto são mais urgentes)
        const age = Date.now() - msg.ts;
        const ttlRemaining = msg.ttl - age;
        if (ttlRemaining < 60000) priority += 20;  // Menos de 1 min

        return priority;
    }
}

// Classes already exported via 'export class'
