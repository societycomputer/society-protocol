import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { LatentSpaceEngine, type LatentCollaborationConfig } from '../../src/latent-space.js';

// Mock dependencies
function createMockIdentity() {
    return {
        did: 'did:key:test-agent-1',
        name: 'TestAgent',
        publicKey: new Uint8Array(32),
        secretKey: new Uint8Array(64),
    };
}

function createMockStorage() {
    return {};
}

function createMockRooms() {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        isJoined: vi.fn().mockReturnValue(true),
        joinRoom: vi.fn().mockResolvedValue(undefined),
    });
}

describe('LatentSpaceEngine', () => {
    let engine: LatentSpaceEngine;
    let identity: any;
    let storage: any;
    let rooms: any;

    beforeEach(() => {
        identity = createMockIdentity();
        storage = createMockStorage();
        rooms = createMockRooms();
        engine = new LatentSpaceEngine(identity, storage, rooms, {
            maxThoughtsPerRoom: 10,
            thoughtTtlMs: 60_000,
        });
    });

    describe('shareThought', () => {
        it('shares a thought and stores it in working memory', async () => {
            const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);
            const thought = await engine.shareThought('room-1', embedding, {
                semanticLabel: 'test thought',
                confidence: 0.9,
                architecture: 'qwen-4b',
            });

            expect(thought.id).toMatch(/^lt_/);
            expect(thought.sourceDid).toBe('did:key:test-agent-1');
            expect(thought.dimensions).toBe(4);
            expect(thought.semanticLabel).toBe('test thought');
            expect(thought.confidence).toBe(0.9);
            expect(thought.sourceArchitecture).toBe('qwen-4b');

            // Should broadcast via rooms
            expect(rooms.sendMessage).toHaveBeenCalledWith(
                'room-1',
                expect.objectContaining({
                    thought_id: thought.id,
                    semantic_label: 'test thought',
                }),
                'latent.thought'
            );

            // Should be in working memory
            const state = engine.getCollectiveState('room-1');
            expect(state).toBeDefined();
            expect(state!.thoughts).toHaveLength(1);
        });

        it('accepts number array as embedding', async () => {
            const thought = await engine.shareThought('room-1', [0.5, 0.6], {
                semanticLabel: 'array thought',
            });
            expect(thought.dimensions).toBe(2);
        });
    });

    describe('queryThoughts', () => {
        it('returns thoughts ranked by cosine similarity', async () => {
            // Share multiple thoughts with different embeddings
            await engine.shareThought('room-1', new Float32Array([1, 0, 0, 0]), {
                semanticLabel: 'thought-A',
                confidence: 0.9,
            });
            await engine.shareThought('room-1', new Float32Array([0, 1, 0, 0]), {
                semanticLabel: 'thought-B',
                confidence: 0.9,
            });
            await engine.shareThought('room-1', new Float32Array([0.9, 0.1, 0, 0]), {
                semanticLabel: 'thought-C',
                confidence: 0.9,
            });

            // Query with embedding similar to thought-A
            const results = engine.queryThoughts(
                'room-1',
                new Float32Array([1, 0, 0, 0]),
                { topK: 2 }
            );

            expect(results).toHaveLength(2);
            // thought-A or thought-C should be most similar
            expect(results[0].thought.semanticLabel).toMatch(/thought-[AC]/);
            expect(results[0].similarity).toBeGreaterThan(0.5);
        });

        it('filters by chain ID', async () => {
            await engine.shareThought('room-1', new Float32Array([1, 0]), {
                semanticLabel: 'chain-A',
                chainId: 'chain_1',
            });
            await engine.shareThought('room-1', new Float32Array([0, 1]), {
                semanticLabel: 'chain-B',
                chainId: 'chain_2',
            });

            const results = engine.queryThoughts(
                'room-1',
                new Float32Array([1, 0]),
                { chainId: 'chain_1' }
            );

            expect(results).toHaveLength(1);
            expect(results[0].thought.semanticLabel).toBe('chain-A');
        });
    });

    describe('mergeThoughts', () => {
        it('merges thoughts with confidence-weighted average', async () => {
            const t1 = await engine.shareThought('room-1', new Float32Array([1, 0]), {
                semanticLabel: 'a',
                confidence: 1.0,
            });
            const t2 = await engine.shareThought('room-1', new Float32Array([0, 1]), {
                semanticLabel: 'b',
                confidence: 1.0,
            });

            const state = engine.getCollectiveState('room-1');
            const merged = engine.mergeThoughts(state!.thoughts);

            expect(merged).not.toBeNull();
            // Both equally weighted and recent, so should be ~[0.5, 0.5]
            expect(merged![0]).toBeGreaterThan(0.3);
            expect(merged![1]).toBeGreaterThan(0.3);
        });

        it('returns null for empty thoughts', () => {
            expect(engine.mergeThoughts([])).toBeNull();
        });
    });

    describe('architecture', () => {
        it('announces and tracks architecture', async () => {
            await engine.announceArchitecture('room-1', {
                architecture: 'qwen3-8b',
                hiddenDimension: 4096,
                vocabSize: 151936,
                numLayers: 32,
                supportsKvTransfer: true,
            });

            // Simulated announcement from another agent
            rooms.emit('latent:architecture', 'room-1', {
                from: { did: 'did:key:other-agent', name: 'Other' },
                ts: Date.now(),
                body: {
                    architecture: 'qwen3-8b',
                    hidden_dimension: 4096,
                    vocab_size: 151936,
                    num_layers: 32,
                    supports_kv_transfer: true,
                },
            });

            const canTransfer = engine.canDirectTransfer('room-1', identity.did, 'did:key:other-agent');
            expect(canTransfer).toBe(true);
        });

        it('detects incompatible architectures', async () => {
            await engine.announceArchitecture('room-1', {
                architecture: 'qwen3-8b',
                hiddenDimension: 4096,
                vocabSize: 151936,
                numLayers: 32,
                supportsKvTransfer: true,
            });

            rooms.emit('latent:architecture', 'room-1', {
                from: { did: 'did:key:other-agent', name: 'Other' },
                ts: Date.now(),
                body: {
                    architecture: 'llama3-70b',
                    hidden_dimension: 8192,
                    vocab_size: 128256,
                    num_layers: 80,
                    supports_kv_transfer: true,
                },
            });

            const canTransfer = engine.canDirectTransfer('room-1', identity.did, 'did:key:other-agent');
            expect(canTransfer).toBe(false);
        });
    });

    describe('getStats', () => {
        it('returns accurate statistics', async () => {
            await engine.shareThought('room-1', new Float32Array([1, 0]), {
                semanticLabel: 'a',
                confidence: 0.8,
                architecture: 'qwen3-4b',
                latentDepth: 5,
            });
            await engine.shareThought('room-1', new Float32Array([0, 1]), {
                semanticLabel: 'b',
                confidence: 0.9,
                architecture: 'qwen3-4b',
                latentDepth: 10,
            });

            const stats = engine.getStats('room-1');
            expect(stats.thoughtCount).toBe(2);
            expect(stats.uniqueAgents).toBe(1);
            expect(stats.architectures).toContain('qwen3-4b');
            expect(stats.avgConfidence).toBeCloseTo(0.85, 1);
            expect(stats.avgLatentDepth).toBe(7.5);
        });

        it('returns zeros for unknown room', () => {
            const stats = engine.getStats('unknown-room');
            expect(stats.thoughtCount).toBe(0);
            expect(stats.uniqueAgents).toBe(0);
        });
    });

    describe('eviction', () => {
        it('evicts thoughts when over limit', async () => {
            const config: Partial<LatentCollaborationConfig> = {
                maxThoughtsPerRoom: 3,
                thoughtTtlMs: 60_000,
            };
            const smallEngine = new LatentSpaceEngine(identity, storage, rooms, config);

            for (let i = 0; i < 5; i++) {
                await smallEngine.shareThought('room-1', new Float32Array([i, 0]), {
                    semanticLabel: `thought-${i}`,
                });
            }

            const state = smallEngine.getCollectiveState('room-1');
            // Should evict down to maxThoughtsPerRoom
            expect(state!.thoughts).toHaveLength(3);
        });
    });
});
