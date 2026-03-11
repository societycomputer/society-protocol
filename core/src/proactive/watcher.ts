/**
 * Proactive Watcher — Inner Thoughts Pipeline
 *
 * Based on: Inner Thoughts (arxiv 2501.00383, CHI 2025)
 * 5-stage pipeline: Trigger → Retrieval → Formation → Evaluation → Participation
 *
 * Watches room conversations and proactively contributes when the agent
 * has relevant knowledge or expertise.
 */

import { EventEmitter } from 'events';
import type { RoomManager } from '../rooms.js';
import type { KnowledgePool, ChatMessage } from '../knowledge.js';
import type { Identity } from '../identity.js';
import type { SwpEnvelope } from '../swp.js';

// ─── Types ───────────────────────────────────────────────────────

export interface ProactiveWatcherConfig {
    level: 0 | 1 | 2;              // off / moderate / aggressive
    throttleMs: number;              // min interval between interventions (default 30s)
    relevanceThreshold: number;      // 0-1 (default 0.6)
    specialties: string[];           // agent's areas of expertise
    ollamaUrl: string;
    ollamaModel: string;
}

export interface ProactiveDecision {
    shouldRespond: boolean;
    relevanceScore: number;
    response?: string;
    reasoning?: string;
    triggeredBy?: string;            // keyword or topic that triggered
}

const DEFAULT_CONFIG: ProactiveWatcherConfig = {
    level: 1,
    throttleMs: 30_000,
    relevanceThreshold: 0.6,
    specialties: [],
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen3:1.7b',
};

// ─── ProactiveWatcher ────────────────────────────────────────────

export class ProactiveWatcher extends EventEmitter {
    private config: ProactiveWatcherConfig;
    private lastResponse = new Map<string, number>(); // roomId → timestamp
    private watching = false;
    private identity: Identity;
    private rooms?: RoomManager;
    private knowledge?: KnowledgePool;

    constructor(
        identity: Identity,
        config?: Partial<ProactiveWatcherConfig>
    ) {
        super();
        this.identity = identity;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Start watching room conversations.
     */
    watch(rooms: RoomManager, knowledge?: KnowledgePool): void {
        if (this.watching) return;

        this.rooms = rooms;
        this.knowledge = knowledge;
        this.watching = true;

        rooms.on('chat:message', (roomId: string, envelope: SwpEnvelope) => {
            if (this.config.level === 0) return;
            this.handleMessage(roomId, envelope).catch(() => {});
        });

        this.emit('watcher:started', { level: this.config.level });
    }

    /**
     * Stop watching.
     */
    stop(): void {
        this.watching = false;
        this.emit('watcher:stopped');
    }

    /**
     * Update proactivity level at runtime.
     */
    setLevel(level: 0 | 1 | 2): void {
        this.config.level = level;
        this.emit('watcher:level-changed', { level });
    }

    getLevel(): number {
        return this.config.level;
    }

    /**
     * Set agent specialties for relevance matching.
     */
    setSpecialties(specialties: string[]): void {
        this.config.specialties = specialties;
    }

    // ─── Internal Pipeline ──────────────────────────────────────

    private async handleMessage(roomId: string, envelope: SwpEnvelope): Promise<void> {
        // Never respond to own messages
        if (envelope.from.did === this.identity.did) return;

        // Never respond to system messages (presence, etc.)
        if (envelope.t !== 'chat.msg') return;

        const body = envelope.body as unknown as { text: string };
        if (!body.text) return;

        // Throttle: respect minimum interval
        const lastTime = this.lastResponse.get(roomId) || 0;
        if (Date.now() - lastTime < this.config.throttleMs) return;

        // Run the 5-stage pipeline
        const decision = await this.evaluate(roomId, body.text, envelope.from.name || envelope.from.did);

        if (decision.shouldRespond && decision.response) {
            // Send the response
            try {
                await this.rooms!.sendChatMessage(roomId, decision.response);
                this.lastResponse.set(roomId, Date.now());
                this.emit('watcher:responded', {
                    roomId,
                    relevanceScore: decision.relevanceScore,
                    triggeredBy: decision.triggeredBy,
                });
            } catch (err) {
                this.emit('watcher:error', { error: err, roomId });
            }
        }
    }

    /**
     * 5-stage Inner Thoughts pipeline:
     * 1. Trigger: keyword/tag match against specialties
     * 2. Retrieval: search local knowledge for relevant context
     * 3. Formation: generate potential response via Ollama
     * 4. Evaluation: score relevance + helpfulness (0-1)
     * 5. Participation: decide whether to respond
     */
    async evaluate(roomId: string, messageText: string, senderName: string): Promise<ProactiveDecision> {
        // Stage 1: TRIGGER — quick keyword check
        const trigger = this.checkTrigger(messageText);
        if (!trigger.triggered && this.config.level < 2) {
            return { shouldRespond: false, relevanceScore: 0 };
        }

        // Stage 2: RETRIEVAL — gather relevant knowledge
        const context = this.retrieveContext(roomId);

        // Stage 3 + 4: FORMATION + EVALUATION — generate and score via Ollama
        try {
            const response = await this.callOllama(
                `You are a proactive AI agent in a multi-agent collaboration room.
Your specialties: ${this.config.specialties.join(', ') || 'general knowledge'}

A message was sent by ${senderName}:
"${messageText}"

${context ? `Room context:\n${context}\n` : ''}
${trigger.matchedKeywords.length > 0 ? `Triggered by keywords: ${trigger.matchedKeywords.join(', ')}\n` : ''}

Decide whether you should proactively respond. Consider:
- Is this within your expertise?
- Can you add genuine value?
- Is a response welcome, or would it be noise?

Respond with JSON:
{
  "shouldRespond": boolean,
  "relevanceScore": 0.0-1.0,
  "response": "your response text if shouldRespond is true",
  "reasoning": "brief explanation of your decision"
}

IMPORTANT: Only respond if you can truly add value. If unsure, set shouldRespond to false.
Respond ONLY with valid JSON, no markdown.`
            );

            const parsed = this.parseJsonResponse(response);
            if (!parsed) {
                return { shouldRespond: false, relevanceScore: 0 };
            }

            const threshold = this.config.level === 2
                ? this.config.relevanceThreshold * 0.7  // More aggressive
                : this.config.relevanceThreshold;

            const relevanceScore = typeof parsed.relevanceScore === 'number'
                ? Math.max(0, Math.min(1, parsed.relevanceScore))
                : 0;

            return {
                shouldRespond: parsed.shouldRespond === true && relevanceScore >= threshold,
                relevanceScore,
                response: parsed.response,
                reasoning: parsed.reasoning,
                triggeredBy: trigger.matchedKeywords[0],
            };
        } catch {
            // Ollama unavailable
            return { shouldRespond: false, relevanceScore: 0 };
        }
    }

    // ─── Stage Helpers ──────────────────────────────────────────

    /**
     * Stage 1: Trigger detection.
     * Quick keyword/pattern matching against agent specialties.
     */
    private checkTrigger(text: string): { triggered: boolean; matchedKeywords: string[] } {
        const lower = text.toLowerCase();
        const matched: string[] = [];

        // Check against specialties
        for (const specialty of this.config.specialties) {
            const words = specialty.toLowerCase().split(/\s+/);
            for (const word of words) {
                if (word.length > 2 && lower.includes(word)) {
                    matched.push(specialty);
                    break;
                }
            }
        }

        // Check for question patterns — only boost if a specialty already matched
        const isQuestion = /\?$|^(how|what|why|when|where|who|can|could|should|would|is|are|do|does)\b/i.test(text.trim());
        if (isQuestion && matched.length > 0) {
            matched.push('question-detected');
        }

        // Check for help/request patterns
        if (/\b(help|assist|need|looking for|anyone know|any idea)\b/i.test(text)) {
            matched.push('help-request');
        }

        return { triggered: matched.length > 0, matchedKeywords: matched };
    }

    /**
     * Stage 2: Retrieve relevant context from knowledge pool.
     */
    private retrieveContext(roomId: string): string {
        if (!this.knowledge) return '';

        // Get shared context from CollectiveUnconscious
        const sharedCtx = this.knowledge.getSharedContext(roomId);
        if (sharedCtx) return sharedCtx;

        return '';
    }

    // ─── Utilities ──────────────────────────────────────────────

    private async callOllama(prompt: string): Promise<string> {
        const url = `${this.config.ollamaUrl}/api/generate`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.config.ollamaModel,
                prompt,
                stream: false,
                options: { temperature: 0.5, num_predict: 512 },
            }),
        });

        if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
        const json = await res.json() as { response: string };
        return json.response;
    }

    private parseJsonResponse(text: string): any {
        let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        try {
            return JSON.parse(cleaned);
        } catch {
            const match = cleaned.match(/\{[\s\S]*\}/);
            if (match) {
                try { return JSON.parse(match[0]); } catch { /* ignore */ }
            }
            return null;
        }
    }
}
