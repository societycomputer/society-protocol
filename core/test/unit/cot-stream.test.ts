import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CotStreamEngine, type CotStreamConfig } from '../../src/cot-stream.js';
import { generateIdentity, type Identity } from '../../src/identity.js';
import { EventEmitter } from 'events';

// ─── Mocks ──────────────────────────────────────────────────────

class MockRoomManager extends EventEmitter {
    public sentMessages: Array<{ roomId: string; body: any; type: string }> = [];

    async sendMessage(roomId: string, body: any, type: string): Promise<void> {
        this.sentMessages.push({ roomId, body, type });
    }

    getJoinedRooms(): string[] {
        return ['room_1'];
    }
}

class MockKnowledgePool extends EventEmitter {
    public createdCards: any[] = [];

    async createCard(spaceId: string, type: string, title: string, content: string, options?: any): Promise<{ id: string }> {
        const card = { id: `card_${Date.now()}`, spaceId, type, title, content, ...options };
        this.createdCards.push(card);
        return card;
    }

    queryCards(_options: any): any[] {
        return [];
    }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('CotStreamEngine', () => {
    let engine: CotStreamEngine;
    let identity: Identity;
    let rooms: MockRoomManager;
    let knowledge: MockKnowledgePool;

    beforeEach(() => {
        identity = generateIdentity('CoT Test Agent');
        rooms = new MockRoomManager();
        knowledge = new MockKnowledgePool();
        engine = new CotStreamEngine(
            identity,
            rooms as any,
            knowledge as any,
            { batchIntervalMs: 10, maxBufferSize: 5 }
        );
    });

    describe('Stream Lifecycle', () => {
        it('should start a new stream', async () => {
            const streamId = await engine.startStream('room_1', 'Analyze rare disease X');

            expect(streamId).toBeDefined();
            expect(streamId.startsWith('cot_')).toBe(true);

            const stream = engine.getStream(streamId);
            expect(stream).toBeDefined();
            expect(stream!.status).toBe('active');
            expect(stream!.goal).toBe('Analyze rare disease X');
            expect(stream!.owner_did).toBe(identity.did);

            // Should have sent start message
            const startMsg = rooms.sentMessages.find(m => m.type === 'cot.stream.start');
            expect(startMsg).toBeDefined();
            expect(startMsg!.body.stream_id).toBe(streamId);
        });

        it('should end a stream with summary', async () => {
            const streamId = await engine.startStream('room_1', 'Test goal');
            await engine.endStream(streamId, 'completed', 'Found key pattern in data');

            const stream = engine.getStream(streamId);
            expect(stream!.status).toBe('completed');
            expect(stream!.ended_at).toBeDefined();

            const endMsg = rooms.sentMessages.find(m => m.type === 'cot.stream.end');
            expect(endMsg).toBeDefined();
            expect(endMsg!.body.summary).toBe('Found key pattern in data');
        });

        it('should enforce max streams per room', async () => {
            const customEngine = new CotStreamEngine(
                identity,
                rooms as any,
                knowledge as any,
                { maxStreamsPerRoom: 2, batchIntervalMs: 10 }
            );

            await customEngine.startStream('room_1', 'Goal 1');
            await customEngine.startStream('room_1', 'Goal 2');

            await expect(customEngine.startStream('room_1', 'Goal 3'))
                .rejects.toThrow('Max streams');
        });

        it('should track stream with chain_id and step_id', async () => {
            const streamId = await engine.startStream('room_1', 'Solve step', {
                chain_id: 'chain_123',
                step_id: 'step_456',
                model: 'claude-opus',
            });

            const stream = engine.getStream(streamId);
            expect(stream!.chain_id).toBe('chain_123');
            expect(stream!.step_id).toBe('step_456');
            expect(stream!.model).toBe('claude-opus');
        });
    });

    describe('Token Emission', () => {
        it('should emit reasoning tokens', async () => {
            const streamId = await engine.startStream('room_1', 'Reason about X');

            const tokenSpy = vi.fn();
            engine.on('token:emitted', tokenSpy);

            await engine.emitToken(streamId, 'Considering hypothesis A...', 'reasoning');

            expect(tokenSpy).toHaveBeenCalledOnce();
            const [sid, token] = tokenSpy.mock.calls[0];
            expect(sid).toBe(streamId);
            expect(token.token).toBe('Considering hypothesis A...');
            expect(token.token_type).toBe('reasoning');
            expect(token.seq).toBe(1);
        });

        it('should batch tokens and flush', async () => {
            const streamId = await engine.startStream('room_1', 'Batch test');

            // Emit 5 tokens (= maxBufferSize) to trigger flush
            for (let i = 0; i < 5; i++) {
                await engine.emitToken(streamId, `Token ${i}`, 'reasoning');
            }

            // Should have flushed tokens as messages
            const tokenMsgs = rooms.sentMessages.filter(m => m.type === 'cot.stream.token');
            expect(tokenMsgs.length).toBe(5);
        });

        it('should track different token types', async () => {
            const streamId = await engine.startStream('room_1', 'Multi-type');

            await engine.emitToken(streamId, 'I observe...', 'observation');
            await engine.emitToken(streamId, 'What if...', 'hypothesis', { confidence: 0.6 });
            await engine.emitToken(streamId, 'Therefore...', 'conclusion', { confidence: 0.9 });

            const stream = engine.getStream(streamId);
            expect(stream!.token_count).toBe(3);
        });

        it('should reject tokens on inactive streams', async () => {
            const streamId = await engine.startStream('room_1', 'Will end');
            await engine.endStream(streamId, 'completed', 'Done');

            await expect(engine.emitToken(streamId, 'Late token', 'reasoning'))
                .rejects.toThrow('not active');
        });
    });

    describe('Insights', () => {
        it('should publish an insight', async () => {
            const streamId = await engine.startStream('room_1', 'Insight test');

            const insightSpy = vi.fn();
            engine.on('insight:published', insightSpy);

            const insightId = await engine.publishInsight(
                streamId,
                'Gene X linked to Disease Y',
                'Analysis shows strong correlation between Gene X mutations and Disease Y onset',
                'discovery',
                { confidence: 0.85, supporting_evidence: ['paper_1', 'paper_2'] }
            );

            expect(insightId).toBeDefined();
            expect(insightId.startsWith('insight_')).toBe(true);

            const insight = engine.getInsight(insightId);
            expect(insight).toBeDefined();
            expect(insight!.title).toBe('Gene X linked to Disease Y');
            expect(insight!.confidence).toBe(0.85);

            // Should have broadcast
            const msg = rooms.sentMessages.find(m => m.type === 'cot.stream.insight');
            expect(msg).toBeDefined();
        });

        it('should auto-create knowledge card for high-confidence insights', async () => {
            const streamId = await engine.startStream('room_1', 'Auto-card test');

            await engine.publishInsight(
                streamId,
                'Important Finding',
                'This is a significant finding',
                'discovery',
                { confidence: 0.9, auto_create_card: true }
            );

            expect(knowledge.createdCards.length).toBe(1);
            expect(knowledge.createdCards[0].title).toBe('Important Finding');
        });

        it('should NOT auto-create card for low-confidence insights', async () => {
            const streamId = await engine.startStream('room_1', 'Low confidence');

            await engine.publishInsight(
                streamId,
                'Weak Finding',
                'Uncertain observation',
                'pattern',
                { confidence: 0.3 }
            );

            expect(knowledge.createdCards.length).toBe(0);
        });
    });

    describe('Questions & Answers (Socratic Dialogue)', () => {
        it('should ask a question', async () => {
            const streamId = await engine.startStream('room_1', 'Q&A test');

            const questionSpy = vi.fn();
            engine.on('question:asked', questionSpy);

            const qId = await engine.askQuestion(
                streamId,
                'What is the typical onset age for Disease Y?',
                'clarification',
                { context: 'Analyzing rare disease', urgency: 'high' }
            );

            expect(qId).toBeDefined();
            expect(questionSpy).toHaveBeenCalledOnce();

            const question = engine.getQuestion(qId);
            expect(question).toBeDefined();
            expect(question!.answered).toBe(false);
        });

        it('should answer a question', async () => {
            const streamId = await engine.startStream('room_1', 'Answer test');
            const qId = await engine.askQuestion(streamId, 'Age?', 'clarification');

            const answerSpy = vi.fn();
            engine.on('question:answered', answerSpy);

            await engine.answerQuestion(streamId, qId, 'Typically 5-10 years old', {
                confidence: 0.8,
                references: ['pubmed_123'],
            });

            const question = engine.getQuestion(qId);
            expect(question!.answered).toBe(true);
            expect(question!.answers.length).toBe(1);
            expect(question!.answers[0].answer).toBe('Typically 5-10 years old');
        });

        it('should list pending questions for this agent', async () => {
            const streamId = await engine.startStream('room_1', 'Pending Q test');

            await engine.askQuestion(streamId, 'Q1?', 'exploration');
            await engine.askQuestion(streamId, 'Q2?', 'validation', {
                target_did: identity.did,
            });

            const pending = engine.getPendingQuestions();
            expect(pending.length).toBe(2);
        });
    });

    describe('Branching & Merging', () => {
        it('should branch a stream', async () => {
            const parentId = await engine.startStream('room_1', 'Main reasoning');

            const branchSpy = vi.fn();
            engine.on('stream:branched', branchSpy);

            const branchId = await engine.branchStream(
                parentId,
                'What if Gene X is recessive?',
                'Exploring alternative hypothesis'
            );

            expect(branchId).toBeDefined();
            expect(branchSpy).toHaveBeenCalledOnce();

            // Parent should track the branch
            const parent = engine.getStream(parentId);
            expect(parent!.branches).toContain(branchId);

            // Branch should reference parent
            const branch = engine.getStream(branchId);
            expect(branch!.parent_stream_id).toBe(parentId);
        });

        it('should merge multiple branches', async () => {
            const mainId = await engine.startStream('room_1', 'Main');
            const branch1 = await engine.branchStream(mainId, 'Hyp A', 'Test A');
            const branch2 = await engine.branchStream(mainId, 'Hyp B', 'Test B');

            const mergeSpy = vi.fn();
            engine.on('stream:merged', mergeSpy);

            await engine.mergeStreams(
                mainId,
                [branch1, branch2],
                'Both hypotheses partially supported; combined model is strongest',
                0.75
            );

            expect(mergeSpy).toHaveBeenCalledOnce();

            // Branches should be marked as merged
            expect(engine.getStream(branch1)!.status).toBe('merged');
            expect(engine.getStream(branch2)!.status).toBe('merged');
            expect(engine.getStream(branch1)!.merged_into).toBe(mainId);
        });

        it('should build a reasoning tree', async () => {
            const rootId = await engine.startStream('room_1', 'Root');
            const b1 = await engine.branchStream(rootId, 'Branch 1', 'reason');
            const b2 = await engine.branchStream(rootId, 'Branch 2', 'reason');
            const b1a = await engine.branchStream(b1, 'Sub-branch', 'deeper');

            await engine.publishInsight(rootId, 'Root insight', 'content', 'discovery', { confidence: 0.8 });
            await engine.publishInsight(b1, 'Branch insight', 'content', 'pattern', { confidence: 0.7 });

            const tree = engine.getReasoningTree(rootId);
            expect(tree).toBeDefined();
            expect(tree!.branches.length).toBe(3); // b1, b2, b1a
            expect(tree!.insights.length).toBe(2);
            expect(tree!.depth).toBe(2); // root→b1→b1a
        });
    });

    describe('Context Retrieval', () => {
        it('should get reasoning context for a stream', async () => {
            const streamId = await engine.startStream('room_1', 'Context test');

            await engine.emitToken(streamId, 'First thought', 'reasoning');
            await engine.publishInsight(streamId, 'Key finding', 'Details', 'discovery', { confidence: 0.8 });
            await engine.askQuestion(streamId, 'What about X?', 'exploration');

            const context = engine.getReasoningContext(streamId);
            expect(context).toBeDefined();
            expect(context!.goal).toBe('Context test');
            expect(context!.insights.length).toBe(1);
            expect(context!.questions.length).toBe(1);
        });

        it('should get room streams', async () => {
            await engine.startStream('room_1', 'Stream 1');
            await engine.startStream('room_1', 'Stream 2');
            await engine.startStream('room_2', 'Other room');

            const room1Streams = engine.getRoomStreams('room_1');
            expect(room1Streams.length).toBe(2);

            const room2Streams = engine.getRoomStreams('room_2');
            expect(room2Streams.length).toBe(1);
        });

        it('should get chain streams', async () => {
            await engine.startStream('room_1', 'S1', { chain_id: 'chain_A' });
            await engine.startStream('room_1', 'S2', { chain_id: 'chain_A' });
            await engine.startStream('room_1', 'S3', { chain_id: 'chain_B' });

            const chainA = engine.getChainStreams('chain_A');
            expect(chainA.length).toBe(2);
        });
    });

    describe('Remote Event Handling', () => {
        it('should handle remote stream start', async () => {
            const remoteSpy = vi.fn();
            engine.on('stream:remote:started', remoteSpy);

            // Simulate incoming stream start from another agent
            rooms.emit('cot:stream:start', 'room_1', {
                room: 'room_1',
                from: { did: 'did:key:z6MkOther', name: 'Other Agent' },
                body: {
                    stream_id: 'cot_remote_1',
                    goal: 'Remote reasoning',
                    model: 'gpt-4',
                },
            });

            expect(remoteSpy).toHaveBeenCalledOnce();
            const remoteStream = engine.getStream('cot_remote_1');
            expect(remoteStream).toBeDefined();
            expect(remoteStream!.owner_did).toBe('did:key:z6MkOther');
        });

        it('should handle remote tokens', async () => {
            // First create the remote stream
            rooms.emit('cot:stream:start', 'room_1', {
                room: 'room_1',
                from: { did: 'did:key:z6MkOther', name: 'Other' },
                body: { stream_id: 'cot_r2', goal: 'Remote' },
            });

            const tokenSpy = vi.fn();
            engine.on('token:received', tokenSpy);

            rooms.emit('cot:stream:token', 'room_1', {
                room: 'room_1',
                from: { did: 'did:key:z6MkOther', name: 'Other' },
                body: {
                    stream_id: 'cot_r2',
                    seq: 1,
                    token: 'Analyzing data...',
                    token_type: 'reasoning',
                },
            });

            expect(tokenSpy).toHaveBeenCalledOnce();
        });

        it('should handle remote questions and allow answering', async () => {
            rooms.emit('cot:stream:start', 'room_1', {
                room: 'room_1',
                from: { did: 'did:key:z6MkOther', name: 'Other' },
                body: { stream_id: 'cot_r3', goal: 'Remote Q&A' },
            });

            const questionSpy = vi.fn();
            engine.on('question:received', questionSpy);

            rooms.emit('cot:stream:question', 'room_1', {
                room: 'room_1',
                from: { did: 'did:key:z6MkOther', name: 'Other' },
                body: {
                    stream_id: 'cot_r3',
                    question_id: 'q_remote_1',
                    question: 'Can you verify this finding?',
                    question_type: 'validation',
                    context: 'Found pattern in genome data',
                    urgency: 'high',
                },
            });

            expect(questionSpy).toHaveBeenCalledOnce();

            // Answer the remote question
            await engine.answerQuestion('cot_r3', 'q_remote_1', 'Yes, confirmed in our dataset too', {
                confidence: 0.9,
            });

            const q = engine.getQuestion('q_remote_1');
            expect(q!.answered).toBe(true);
        });
    });

    describe('Stats & Cleanup', () => {
        it('should report correct stats', async () => {
            const s1 = await engine.startStream('room_1', 'Active 1');
            const s2 = await engine.startStream('room_1', 'Active 2');
            await engine.endStream(s2, 'completed', 'Done');

            await engine.publishInsight(s1, 'I1', 'C1', 'discovery', { confidence: 0.8 });
            await engine.askQuestion(s1, 'Q?', 'exploration');

            const stats = engine.getStats();
            expect(stats.totalStreams).toBe(2);
            expect(stats.activeStreams).toBe(1);
            expect(stats.totalInsights).toBe(1);
            expect(stats.totalQuestions).toBe(1);
            expect(stats.answeredQuestions).toBe(0);
        });

        it('should clean up on destroy', async () => {
            await engine.startStream('room_1', 'Will be destroyed');
            engine.destroy();

            expect(engine.getActiveStreams().length).toBe(0);
        });
    });
});
