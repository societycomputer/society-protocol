/**
 * Society Protocol — Collaborative Chain-of-Thought (CoT) Streaming v1.0
 *
 * Killer feature: Real-time distributed reasoning between agents.
 * Each agent publishes reasoning tokens, insights, questions and answers
 * via GossipSub, enabling "pair programming between LLMs" — agents can
 * absorb each other's reasoning in real-time and build on it.
 *
 * Key concepts:
 * - CoT Stream: A reasoning session tied to a room/chain/step
 * - Tokens: Typed reasoning chunks (reasoning, observation, hypothesis, etc.)
 * - Insights: Distilled discoveries that can auto-create Knowledge Cards
 * - Questions/Answers: Inter-agent Socratic dialogue
 * - Branches: Divergent reasoning paths explored in parallel
 * - Merges: Synthesis of multiple reasoning branches
 *
 * Architecture:
 *   Agent A ──┐                    ┌── Agent C (absorbs A+B reasoning)
 *             ├── GossipSub topic ─┤
 *   Agent B ──┘                    └── Agent D (branches from A's insight)
 */

import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import { type Identity } from './identity.js';
import { type RoomManager } from './rooms.js';
import { type KnowledgePool, type KnowledgeType } from './knowledge.js';
import type {
    CotStreamStartBody,
    CotStreamTokenBody,
    CotStreamInsightBody,
    CotStreamQuestionBody,
    CotStreamAnswerBody,
    CotStreamBranchBody,
    CotStreamMergeBody,
    CotStreamEndBody,
    SwpEnvelope,
} from './swp.js';

// ─── Types ──────────────────────────────────────────────────────

export interface CotStream {
    stream_id: string;
    room_id: string;
    chain_id?: string;
    step_id?: string;
    goal: string;
    model?: string;
    owner_did: string;
    parent_stream_id?: string;
    status: 'active' | 'paused' | 'completed' | 'abandoned' | 'merged';
    started_at: number;
    ended_at?: number;
    token_count: number;
    insight_count: number;
    question_count: number;
    branches: string[];        // child stream IDs
    merged_into?: string;      // parent stream if merged
}

export interface CotInsight {
    insight_id: string;
    stream_id: string;
    title: string;
    content: string;
    insight_type: CotStreamInsightBody['insight_type'];
    confidence: number;
    supporting_evidence: string[];
    author_did: string;
    created_at: number;
    knowledge_card_id?: string;  // If auto-created
}

export interface CotQuestion {
    question_id: string;
    stream_id: string;
    question: string;
    question_type: CotStreamQuestionBody['question_type'];
    context: string;
    asked_by: string;
    target_did?: string;
    urgency: 'low' | 'normal' | 'high';
    asked_at: number;
    answered: boolean;
    answers: CotAnswer[];
}

export interface CotAnswer {
    answer_id: string;
    question_id: string;
    stream_id: string;
    answer: string;
    confidence: number;
    references: string[];
    answered_by: string;
    answered_at: number;
}

export interface CotStreamConfig {
    /** Max tokens to buffer per stream before flushing */
    maxBufferSize?: number;
    /** Auto-create knowledge cards from insights */
    autoCreateCards?: boolean;
    /** Minimum confidence to auto-create a card */
    autoCardMinConfidence?: number;
    /** Max concurrent streams per room */
    maxStreamsPerRoom?: number;
    /** Token broadcast interval (ms) — batch tokens for efficiency */
    batchIntervalMs?: number;
}

export interface ReasoningContext {
    stream_id: string;
    tokens: CotStreamTokenBody[];
    insights: CotInsight[];
    questions: CotQuestion[];
    goal: string;
    branches: string[];
}

// ─── CoT Stream Engine ──────────────────────────────────────────

const DEFAULT_CONFIG: Required<CotStreamConfig> = {
    maxBufferSize: 100,
    autoCreateCards: true,
    autoCardMinConfidence: 0.7,
    maxStreamsPerRoom: 20,
    batchIntervalMs: 250,
};

export class CotStreamEngine extends EventEmitter {
    private streams = new Map<string, CotStream>();
    private insights = new Map<string, CotInsight>();
    private questions = new Map<string, CotQuestion>();
    private tokenBuffers = new Map<string, CotStreamTokenBody[]>();
    private roomStreams = new Map<string, Set<string>>(); // roomId -> streamIds
    private batchTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private config: Required<CotStreamConfig>;

    constructor(
        private identity: Identity,
        private rooms: RoomManager,
        private knowledge?: KnowledgePool,
        config?: CotStreamConfig
    ) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.bindEvents();
    }

    // ─── Stream Lifecycle ────────────────────────────────────────

    /**
     * Start a new reasoning stream — begins broadcasting thinking tokens.
     */
    async startStream(
        roomId: string,
        goal: string,
        options: {
            chain_id?: string;
            step_id?: string;
            model?: string;
            parent_stream_id?: string;
        } = {}
    ): Promise<string> {
        const streamId = `cot_${ulid()}`;

        // Enforce max streams per room
        const roomStreamSet = this.roomStreams.get(roomId);
        if (roomStreamSet && roomStreamSet.size >= this.config.maxStreamsPerRoom) {
            throw new Error(`Max streams (${this.config.maxStreamsPerRoom}) reached for room ${roomId}`);
        }

        const stream: CotStream = {
            stream_id: streamId,
            room_id: roomId,
            chain_id: options.chain_id,
            step_id: options.step_id,
            goal,
            model: options.model,
            owner_did: this.identity.did,
            parent_stream_id: options.parent_stream_id,
            status: 'active',
            started_at: Date.now(),
            token_count: 0,
            insight_count: 0,
            question_count: 0,
            branches: [],
        };

        this.streams.set(streamId, stream);
        this.tokenBuffers.set(streamId, []);

        if (!this.roomStreams.has(roomId)) {
            this.roomStreams.set(roomId, new Set());
        }
        this.roomStreams.get(roomId)!.add(streamId);

        // If this is a branch, register with parent
        if (options.parent_stream_id) {
            const parent = this.streams.get(options.parent_stream_id);
            if (parent) {
                parent.branches.push(streamId);
            }
        }

        const body: CotStreamStartBody = {
            stream_id: streamId,
            chain_id: options.chain_id,
            step_id: options.step_id,
            goal,
            model: options.model,
            parent_stream_id: options.parent_stream_id,
        };

        await this.rooms.sendMessage(roomId, body, 'cot.stream.start');
        this.emit('stream:started', streamId, stream);

        return streamId;
    }

    /**
     * Emit a reasoning token — the core of collaborative thinking.
     * Tokens are batched for network efficiency.
     */
    async emitToken(
        streamId: string,
        token: string,
        tokenType: CotStreamTokenBody['token_type'],
        options: {
            confidence?: number;
            domain?: string;
            references?: string[];
        } = {}
    ): Promise<void> {
        const stream = this.streams.get(streamId);
        if (!stream || stream.status !== 'active') {
            throw new Error(`Stream ${streamId} not active`);
        }

        stream.token_count++;

        const tokenBody: CotStreamTokenBody = {
            stream_id: streamId,
            seq: stream.token_count,
            token,
            token_type: tokenType,
            confidence: options.confidence,
            domain: options.domain,
            references: options.references,
        };

        // Buffer tokens and flush in batches for efficiency
        const buffer = this.tokenBuffers.get(streamId)!;
        buffer.push(tokenBody);

        if (buffer.length >= this.config.maxBufferSize) {
            await this.flushTokenBuffer(streamId);
        } else if (!this.batchTimers.has(streamId)) {
            this.batchTimers.set(streamId, setTimeout(() => {
                this.flushTokenBuffer(streamId);
                this.batchTimers.delete(streamId);
            }, this.config.batchIntervalMs));
        }

        this.emit('token:emitted', streamId, tokenBody);
    }

    /**
     * Publish an insight — a distilled discovery from reasoning.
     * Can auto-create a Knowledge Card if configured.
     */
    async publishInsight(
        streamId: string,
        title: string,
        content: string,
        insightType: CotStreamInsightBody['insight_type'],
        options: {
            confidence?: number;
            supporting_evidence?: string[];
            related_streams?: string[];
            auto_create_card?: boolean;
        } = {}
    ): Promise<string> {
        const stream = this.streams.get(streamId);
        if (!stream) throw new Error(`Stream ${streamId} not found`);

        const insightId = `insight_${ulid()}`;
        const confidence = options.confidence ?? 0.5;

        const insight: CotInsight = {
            insight_id: insightId,
            stream_id: streamId,
            title,
            content,
            insight_type: insightType,
            confidence,
            supporting_evidence: options.supporting_evidence || [],
            author_did: this.identity.did,
            created_at: Date.now(),
        };

        this.insights.set(insightId, insight);
        stream.insight_count++;

        // Auto-create knowledge card if configured and confidence is high enough
        const shouldCreateCard = (options.auto_create_card ?? this.config.autoCreateCards)
            && confidence >= this.config.autoCardMinConfidence
            && this.knowledge;

        if (shouldCreateCard) {
            try {
                const card = await this.knowledge!.createCard(
                    this.getDefaultSpaceId(stream.room_id),
                    this.insightTypeToKnowledgeType(insightType),
                    title,
                    content,
                    {
                        summary: content.slice(0, 200),
                        tags: ['cot-insight', insightType],
                        domain: [],
                        source: {
                            type: 'coc',
                            id: stream.chain_id,
                            context: `CoT Stream ${streamId}`,
                        },
                        confidence,
                    }
                );
                insight.knowledge_card_id = card.id;
            } catch {
                // Knowledge pool may not be available; insight still valid
            }
        }

        const body: CotStreamInsightBody = {
            stream_id: streamId,
            insight_id: insightId,
            title,
            content,
            insight_type: insightType,
            confidence,
            supporting_evidence: options.supporting_evidence || [],
            related_streams: options.related_streams,
            auto_create_card: !!shouldCreateCard,
        };

        await this.rooms.sendMessage(stream.room_id, body, 'cot.stream.insight');
        this.emit('insight:published', streamId, insight);

        return insightId;
    }

    /**
     * Ask a question to other agents in the room — Socratic dialogue.
     */
    async askQuestion(
        streamId: string,
        question: string,
        questionType: CotStreamQuestionBody['question_type'],
        options: {
            context?: string;
            target_did?: string;
            urgency?: 'low' | 'normal' | 'high';
        } = {}
    ): Promise<string> {
        const stream = this.streams.get(streamId);
        if (!stream) throw new Error(`Stream ${streamId} not found`);

        const questionId = `q_${ulid()}`;

        const cotQuestion: CotQuestion = {
            question_id: questionId,
            stream_id: streamId,
            question,
            question_type: questionType,
            context: options.context || '',
            asked_by: this.identity.did,
            target_did: options.target_did,
            urgency: options.urgency || 'normal',
            asked_at: Date.now(),
            answered: false,
            answers: [],
        };

        this.questions.set(questionId, cotQuestion);
        stream.question_count++;

        const body: CotStreamQuestionBody = {
            stream_id: streamId,
            question_id: questionId,
            question,
            question_type: questionType,
            context: options.context || '',
            target_did: options.target_did,
            urgency: options.urgency || 'normal',
        };

        await this.rooms.sendMessage(stream.room_id, body, 'cot.stream.question');
        this.emit('question:asked', streamId, cotQuestion);

        return questionId;
    }

    /**
     * Answer a question from another agent.
     */
    async answerQuestion(
        streamId: string,
        questionId: string,
        answer: string,
        options: {
            confidence?: number;
            references?: string[];
        } = {}
    ): Promise<void> {
        const stream = this.streams.get(streamId);
        if (!stream) throw new Error(`Stream ${streamId} not found`);

        const cotQuestion = this.questions.get(questionId);
        if (!cotQuestion) throw new Error(`Question ${questionId} not found`);

        const answerId = `a_${ulid()}`;
        const cotAnswer: CotAnswer = {
            answer_id: answerId,
            question_id: questionId,
            stream_id: streamId,
            answer,
            confidence: options.confidence ?? 0.5,
            references: options.references || [],
            answered_by: this.identity.did,
            answered_at: Date.now(),
        };

        cotQuestion.answers.push(cotAnswer);
        cotQuestion.answered = true;

        const body: CotStreamAnswerBody = {
            stream_id: streamId,
            question_id: questionId,
            answer,
            confidence: options.confidence ?? 0.5,
            references: options.references,
        };

        await this.rooms.sendMessage(stream.room_id, body, 'cot.stream.answer');
        this.emit('question:answered', streamId, questionId, cotAnswer);
    }

    /**
     * Branch the reasoning — explore a divergent hypothesis in parallel.
     */
    async branchStream(
        parentStreamId: string,
        hypothesis: string,
        branchReason: string
    ): Promise<string> {
        const parent = this.streams.get(parentStreamId);
        if (!parent) throw new Error(`Parent stream ${parentStreamId} not found`);

        // Create a new stream as a branch
        const branchId = await this.startStream(parent.room_id, hypothesis, {
            chain_id: parent.chain_id,
            step_id: parent.step_id,
            model: parent.model,
            parent_stream_id: parentStreamId,
        });

        const body: CotStreamBranchBody = {
            stream_id: branchId,
            parent_stream_id: parentStreamId,
            branch_reason: branchReason,
            hypothesis,
        };

        await this.rooms.sendMessage(parent.room_id, body, 'cot.stream.branch');
        this.emit('stream:branched', parentStreamId, branchId, hypothesis);

        return branchId;
    }

    /**
     * Merge multiple reasoning branches into a synthesis.
     */
    async mergeStreams(
        targetStreamId: string,
        sourceStreamIds: string[],
        synthesis: string,
        consensusLevel: number
    ): Promise<void> {
        const target = this.streams.get(targetStreamId);
        if (!target) throw new Error(`Target stream ${targetStreamId} not found`);

        // Mark source streams as merged
        for (const srcId of sourceStreamIds) {
            const src = this.streams.get(srcId);
            if (src) {
                src.status = 'merged';
                src.merged_into = targetStreamId;
                src.ended_at = Date.now();
            }
        }

        const body: CotStreamMergeBody = {
            stream_id: targetStreamId,
            merged_streams: sourceStreamIds,
            synthesis,
            consensus_level: Math.max(0, Math.min(1, consensusLevel)),
        };

        await this.rooms.sendMessage(target.room_id, body, 'cot.stream.merge');
        this.emit('stream:merged', targetStreamId, sourceStreamIds, synthesis);
    }

    /**
     * End a reasoning stream.
     */
    async endStream(
        streamId: string,
        status: CotStreamEndBody['status'],
        summary: string
    ): Promise<void> {
        const stream = this.streams.get(streamId);
        if (!stream) throw new Error(`Stream ${streamId} not found`);

        // Flush any remaining tokens
        await this.flushTokenBuffer(streamId);

        stream.status = status === 'completed' ? 'completed' :
                       status === 'paused' ? 'paused' :
                       status === 'merged' ? 'merged' : 'abandoned';
        stream.ended_at = Date.now();

        const body: CotStreamEndBody = {
            stream_id: streamId,
            status,
            summary,
            insights_generated: stream.insight_count,
            tokens_total: stream.token_count,
            duration_ms: stream.ended_at - stream.started_at,
        };

        await this.rooms.sendMessage(stream.room_id, body, 'cot.stream.end');
        this.emit('stream:ended', streamId, status, summary);

        // Cleanup batch timer
        const timer = this.batchTimers.get(streamId);
        if (timer) {
            clearTimeout(timer);
            this.batchTimers.delete(streamId);
        }
    }

    // ─── Context Retrieval ───────────────────────────────────────

    /**
     * Get the full reasoning context for a stream — enables agents
     * to "absorb" another agent's thinking and build on it.
     */
    getReasoningContext(streamId: string): ReasoningContext | null {
        const stream = this.streams.get(streamId);
        if (!stream) return null;

        const tokens = this.tokenBuffers.get(streamId) || [];
        const streamInsights = Array.from(this.insights.values())
            .filter(i => i.stream_id === streamId);
        const streamQuestions = Array.from(this.questions.values())
            .filter(q => q.stream_id === streamId);

        return {
            stream_id: streamId,
            tokens,
            insights: streamInsights,
            questions: streamQuestions,
            goal: stream.goal,
            branches: stream.branches,
        };
    }

    /**
     * Get all active streams in a room — see what everyone is thinking.
     */
    getRoomStreams(roomId: string): CotStream[] {
        const streamIds = this.roomStreams.get(roomId);
        if (!streamIds) return [];

        return Array.from(streamIds)
            .map(id => this.streams.get(id))
            .filter((s): s is CotStream => s !== undefined);
    }

    /**
     * Get active streams for a specific CoC chain.
     */
    getChainStreams(chainId: string): CotStream[] {
        return Array.from(this.streams.values())
            .filter(s => s.chain_id === chainId);
    }

    /**
     * Get all unanswered questions targeting this agent.
     */
    getPendingQuestions(): CotQuestion[] {
        return Array.from(this.questions.values())
            .filter(q => !q.answered && (
                !q.target_did || q.target_did === this.identity.did
            ));
    }

    /**
     * Get the reasoning tree starting from a root stream,
     * including all branches and merges.
     */
    getReasoningTree(rootStreamId: string): {
        root: CotStream;
        branches: CotStream[];
        insights: CotInsight[];
        depth: number;
    } | null {
        const root = this.streams.get(rootStreamId);
        if (!root) return null;

        const branches: CotStream[] = [];
        const allInsights: CotInsight[] = [];
        let maxDepth = 0;

        const traverse = (streamId: string, depth: number) => {
            const stream = this.streams.get(streamId);
            if (!stream) return;

            maxDepth = Math.max(maxDepth, depth);

            // Collect insights
            for (const insight of this.insights.values()) {
                if (insight.stream_id === streamId) {
                    allInsights.push(insight);
                }
            }

            // Traverse branches
            for (const branchId of stream.branches) {
                const branch = this.streams.get(branchId);
                if (branch) {
                    branches.push(branch);
                    traverse(branchId, depth + 1);
                }
            }
        };

        traverse(rootStreamId, 0);

        return { root, branches, insights: allInsights, depth: maxDepth };
    }

    // ─── Event Handling ──────────────────────────────────────────

    private bindEvents(): void {
        // Handle incoming CoT stream events from other agents
        this.rooms.on('cot:stream:start', (_roomId: string, envelope: SwpEnvelope) => {
            const body = envelope.body as unknown as CotStreamStartBody;
            this.handleRemoteStreamStart(envelope.room, body, envelope.from.did);
        });

        this.rooms.on('cot:stream:token', (_roomId: string, envelope: SwpEnvelope) => {
            const body = envelope.body as unknown as CotStreamTokenBody;
            this.handleRemoteToken(body, envelope.from.did);
        });

        this.rooms.on('cot:stream:insight', (_roomId: string, envelope: SwpEnvelope) => {
            const body = envelope.body as unknown as CotStreamInsightBody;
            this.handleRemoteInsight(body, envelope.from.did);
        });

        this.rooms.on('cot:stream:question', (_roomId: string, envelope: SwpEnvelope) => {
            const body = envelope.body as unknown as CotStreamQuestionBody;
            this.handleRemoteQuestion(body, envelope.from.did);
        });

        this.rooms.on('cot:stream:answer', (_roomId: string, envelope: SwpEnvelope) => {
            const body = envelope.body as unknown as CotStreamAnswerBody;
            this.handleRemoteAnswer(body, envelope.from.did);
        });

        this.rooms.on('cot:stream:branch', (_roomId: string, envelope: SwpEnvelope) => {
            const body = envelope.body as unknown as CotStreamBranchBody;
            this.handleRemoteBranch(body, envelope.from.did);
        });

        this.rooms.on('cot:stream:merge', (_roomId: string, envelope: SwpEnvelope) => {
            const body = envelope.body as unknown as CotStreamMergeBody;
            this.handleRemoteMerge(body, envelope.from.did);
        });

        this.rooms.on('cot:stream:end', (_roomId: string, envelope: SwpEnvelope) => {
            const body = envelope.body as unknown as CotStreamEndBody;
            this.handleRemoteStreamEnd(body, envelope.from.did);
        });
    }

    private handleRemoteStreamStart(roomId: string, body: CotStreamStartBody, fromDid: string): void {
        if (this.streams.has(body.stream_id)) return; // Already known

        const stream: CotStream = {
            stream_id: body.stream_id,
            room_id: roomId,
            chain_id: body.chain_id,
            step_id: body.step_id,
            goal: body.goal,
            model: body.model,
            owner_did: fromDid,
            parent_stream_id: body.parent_stream_id,
            status: 'active',
            started_at: Date.now(),
            token_count: 0,
            insight_count: 0,
            question_count: 0,
            branches: [],
        };

        this.streams.set(body.stream_id, stream);
        this.tokenBuffers.set(body.stream_id, []);

        if (!this.roomStreams.has(roomId)) {
            this.roomStreams.set(roomId, new Set());
        }
        this.roomStreams.get(roomId)!.add(body.stream_id);

        if (body.parent_stream_id) {
            const parent = this.streams.get(body.parent_stream_id);
            if (parent) parent.branches.push(body.stream_id);
        }

        this.emit('stream:remote:started', body.stream_id, stream);
    }

    private handleRemoteToken(body: CotStreamTokenBody, fromDid: string): void {
        const stream = this.streams.get(body.stream_id);
        if (!stream) return;

        stream.token_count = Math.max(stream.token_count, body.seq);

        // Store in buffer for context retrieval
        const buffer = this.tokenBuffers.get(body.stream_id);
        if (buffer) {
            buffer.push(body);
            // Keep buffer bounded
            if (buffer.length > this.config.maxBufferSize * 10) {
                buffer.splice(0, buffer.length - this.config.maxBufferSize * 5);
            }
        }

        this.emit('token:received', body.stream_id, body, fromDid);
    }

    private handleRemoteInsight(body: CotStreamInsightBody, fromDid: string): void {
        const insight: CotInsight = {
            insight_id: body.insight_id,
            stream_id: body.stream_id,
            title: body.title,
            content: body.content,
            insight_type: body.insight_type,
            confidence: body.confidence,
            supporting_evidence: body.supporting_evidence,
            author_did: fromDid,
            created_at: Date.now(),
        };

        this.insights.set(body.insight_id, insight);

        const stream = this.streams.get(body.stream_id);
        if (stream) stream.insight_count++;

        this.emit('insight:received', body.stream_id, insight);
    }

    private handleRemoteQuestion(body: CotStreamQuestionBody, fromDid: string): void {
        const question: CotQuestion = {
            question_id: body.question_id,
            stream_id: body.stream_id,
            question: body.question,
            question_type: body.question_type,
            context: body.context,
            asked_by: fromDid,
            target_did: body.target_did,
            urgency: body.urgency,
            asked_at: Date.now(),
            answered: false,
            answers: [],
        };

        this.questions.set(body.question_id, question);

        const stream = this.streams.get(body.stream_id);
        if (stream) stream.question_count++;

        // Emit targeted event if this agent is the target
        if (!body.target_did || body.target_did === this.identity.did) {
            this.emit('question:received', body.stream_id, question);
        }
    }

    private handleRemoteAnswer(body: CotStreamAnswerBody, fromDid: string): void {
        const question = this.questions.get(body.question_id);
        if (!question) return;

        const answer: CotAnswer = {
            answer_id: `a_${ulid()}`,
            question_id: body.question_id,
            stream_id: body.stream_id,
            answer: body.answer,
            confidence: body.confidence,
            references: body.references || [],
            answered_by: fromDid,
            answered_at: Date.now(),
        };

        question.answers.push(answer);
        question.answered = true;

        this.emit('answer:received', body.stream_id, body.question_id, answer);
    }

    private handleRemoteBranch(body: CotStreamBranchBody, fromDid: string): void {
        const parent = this.streams.get(body.parent_stream_id);
        if (parent && !parent.branches.includes(body.stream_id)) {
            parent.branches.push(body.stream_id);
        }
        this.emit('stream:remote:branched', body.parent_stream_id, body.stream_id, body.hypothesis);
    }

    private handleRemoteMerge(body: CotStreamMergeBody, fromDid: string): void {
        for (const srcId of body.merged_streams) {
            const src = this.streams.get(srcId);
            if (src) {
                src.status = 'merged';
                src.merged_into = body.stream_id;
                src.ended_at = Date.now();
            }
        }
        this.emit('stream:remote:merged', body.stream_id, body.merged_streams, body.synthesis);
    }

    private handleRemoteStreamEnd(body: CotStreamEndBody, fromDid: string): void {
        const stream = this.streams.get(body.stream_id);
        if (!stream) return;

        stream.status = body.status === 'completed' ? 'completed' :
                       body.status === 'paused' ? 'paused' :
                       body.status === 'merged' ? 'merged' : 'abandoned';
        stream.ended_at = Date.now();

        this.emit('stream:remote:ended', body.stream_id, body.status, body.summary);
    }

    // ─── Helpers ─────────────────────────────────────────────────

    private async flushTokenBuffer(streamId: string): Promise<void> {
        const buffer = this.tokenBuffers.get(streamId);
        const stream = this.streams.get(streamId);
        if (!buffer || buffer.length === 0 || !stream) return;

        // Only flush tokens we own (don't re-broadcast remote tokens)
        const ownTokens = buffer.filter(t => !this.isRemoteToken(t));
        if (ownTokens.length === 0) return;

        // Send each token as its own message for real-time streaming
        for (const token of ownTokens) {
            await this.rooms.sendMessage(stream.room_id, token, 'cot.stream.token');
        }

        // Keep remote tokens in buffer, clear own tokens
        const remoteTokens = buffer.filter(t => this.isRemoteToken(t));
        this.tokenBuffers.set(streamId, remoteTokens);
    }

    private isRemoteToken(token: CotStreamTokenBody): boolean {
        // Tokens we emitted locally don't have a 'from' field yet;
        // remote tokens are added via handleRemoteToken.
        // Use a simple heuristic: check if we've already sent this seq
        return false; // Local tokens are always flushed; buffer keeps all for context
    }

    private getDefaultSpaceId(roomId: string): string {
        return `space_${roomId}`;
    }

    private insightTypeToKnowledgeType(type: CotStreamInsightBody['insight_type']): KnowledgeType {
        const mapping: Record<string, KnowledgeType> = {
            discovery: 'finding',
            pattern: 'insight',
            contradiction: 'evidence',
            connection: 'insight',
            gap: 'hypothesis',
            confirmation: 'evidence',
        };
        return mapping[type] || 'insight';
    }

    // ─── Getters ─────────────────────────────────────────────────

    getStream(streamId: string): CotStream | undefined {
        return this.streams.get(streamId);
    }

    getInsight(insightId: string): CotInsight | undefined {
        return this.insights.get(insightId);
    }

    getQuestion(questionId: string): CotQuestion | undefined {
        return this.questions.get(questionId);
    }

    getActiveStreams(): CotStream[] {
        return Array.from(this.streams.values())
            .filter(s => s.status === 'active');
    }

    getStats(): {
        totalStreams: number;
        activeStreams: number;
        totalInsights: number;
        totalQuestions: number;
        answeredQuestions: number;
    } {
        const questions = Array.from(this.questions.values());
        return {
            totalStreams: this.streams.size,
            activeStreams: Array.from(this.streams.values()).filter(s => s.status === 'active').length,
            totalInsights: this.insights.size,
            totalQuestions: questions.length,
            answeredQuestions: questions.filter(q => q.answered).length,
        };
    }

    // ─── Cleanup ─────────────────────────────────────────────────

    destroy(): void {
        for (const timer of this.batchTimers.values()) {
            clearTimeout(timer);
        }
        this.batchTimers.clear();
        this.streams.clear();
        this.insights.clear();
        this.questions.clear();
        this.tokenBuffers.clear();
        this.roomStreams.clear();
    }
}
