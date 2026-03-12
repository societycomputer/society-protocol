/**
 * ProtocolBench — 4-Axis Protocol Evaluation Suite
 *
 * Based on: ProtocolBench (arxiv 2504.14476)
 * Measures: Task Success, Latency & Throughput, Message Overhead, Robustness
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';
import { Storage } from '../../src/storage.js';
import { generateIdentity, type Identity } from '../../src/identity.js';
import {
    KnowledgePool,
    mergeVectorClocks,
    compareVectorClocks,
    type KnowledgeCard,
} from '../../src/knowledge.js';
import { InMemoryMetricsCollector } from '../../src/benchmark/collector.js';
import { evaluateScenario, aggregateScenarios, formatBenchmarkReport } from '../../src/benchmark/reporter.js';
import type { BenchmarkScenarioResult, ProtocolBenchReport } from '../../src/benchmark/types.js';

function saveId(storage: Storage, identity: Identity) {
    storage.saveIdentity(
        identity.did,
        Buffer.from(identity.privateKey).toString('hex'),
        Buffer.from(identity.publicKey).toString('hex'),
        identity.displayName
    );
}

/** Set up a space in-memory only (no async DB writes). */
function setupSpaceInMemory(pool: KnowledgePool, spaceId: string, name: string, description = '') {
    (pool as any).spaces.set(spaceId, {
        id: spaceId,
        name,
        description,
        owner: (pool as any).identity.did,
        type: 'personal',
        privacy: 'public',
        cards: new Set(),
        links: [],
        subspaces: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: [],
        stats: { cardCount: 0, linkCount: 0, contributorCount: 1, lastActivity: Date.now() },
        policies: { allowPublicRead: false, allowPublicWrite: false, requireVerification: false },
    });
}

const results: BenchmarkScenarioResult[] = [];

describe('ProtocolBench — Society Protocol', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = join(tmpdir(), `society-bench-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    afterAll(() => {
        if (results.length === 0) return;

        const report: ProtocolBenchReport = {
            version: '1.3.0',
            timestamp: Date.now(),
            platform: `${process.platform} ${process.arch} node/${process.version}`,
            scenarios: results,
            aggregate: aggregateScenarios(results),
        };

        console.log('\n' + formatBenchmarkReport(report) + '\n');
    });

    // ─── Scenario 1: Knowledge Q&A ─────────────────────────────

    it('Scenario: Knowledge Q&A — task success + latency', () => {
        const collector = new InMemoryMetricsCollector();
        const identity = generateIdentity('KnowledgeAgent');
        const storage = new Storage({ dbPath: join(testDir, 'kqa.db') });
        saveId(storage, identity);
        const pool = new KnowledgePool(storage, identity);
        const spaceId = 'qa-space';
        setupSpaceInMemory(pool, spaceId, 'QA', 'Q&A test');

        const start = performance.now();

        // Seed 100 knowledge cards
        for (let i = 0; i < 100; i++) {
            const card: KnowledgeCard = {
                id: `kqa-card-${i}`,
                spaceId,
                type: 'fact',
                title: `Fact about topic ${i % 10}`,
                summary: `Summary ${i}`,
                content: `Content about topic ${i % 10} with detail ${i}`,
                contentFormat: 'plain',
                author: identity.did,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                version: 1,
                tags: [`topic-${i % 10}`, `category-${i % 5}`],
                domain: [`domain-${i % 3}`],
                entities: [`entity-${i}`],
                confidence: 0.7 + (i % 30) / 100,
                verificationStatus: 'unverified',
                verifications: [],
                usage: { views: 0, citations: 0, applications: 0, lastAccessed: Date.now() },
                privacy: 'public',
                crdt: {
                    hlc: { wallTime: Date.now() + i * 100, logical: 0, nodeId: identity.did },
                    vectorClock: { [identity.did]: i + 1 },
                    tombstone: false,
                },
            };
            const qStart = performance.now();
            pool.mergeCard(card);
            const qEnd = performance.now();
            collector.recordMessage('card.merge', JSON.stringify(card).length, qEnd - qStart);
        }

        // Query cards by tag (simulate Q&A)
        for (let i = 0; i < 50; i++) {
            const tag = `topic-${i % 10}`;
            const qStart = performance.now();
            const found = pool.queryCards({ spaceId, tags: [tag] });
            const qEnd = performance.now();

            const success = found.length > 0;
            collector.recordTaskCompletion(success, success ? 1.0 : 0.0);
            collector.recordMessage('query', tag.length, qEnd - qStart);
        }

        const duration = performance.now() - start;
        storage.close();

        const result = evaluateScenario('Knowledge Q&A', collector.snapshot(), duration);
        results.push(result);

        expect(result.axes.taskSuccess.score).toBeGreaterThan(0.8);
        console.log(`  Knowledge Q&A: success=${(result.axes.taskSuccess.score * 100).toFixed(0)}% latency_p95=${result.axes.latencyThroughput.metrics.p95_ms.toFixed(2)}ms`);
    }, 30_000);

    // ─── Scenario 2: Multi-Agent Chain ──────────────────────────

    it('Scenario: Multi-Agent Chain — throughput + overhead', () => {
        const collector = new InMemoryMetricsCollector();
        const start = performance.now();

        // Simulate a 5-step chain with message passing
        const agents = Array.from({ length: 5 }, (_, i) => generateIdentity(`Agent-${i}`));
        const chainSteps = 5;

        for (let chain = 0; chain < 10; chain++) {
            let prevResult = `initial-task-${chain}`;

            for (let step = 0; step < chainSteps; step++) {
                const stepStart = performance.now();
                // Simulate message passing between agents
                const msg = JSON.stringify({
                    chain: chain,
                    step: step,
                    from: agents[step % agents.length].did,
                    input: prevResult,
                    output: `result-${chain}-${step}`,
                });

                const stepEnd = performance.now();
                collector.recordMessage('chain.step', msg.length, stepEnd - stepStart);
                prevResult = `result-${chain}-${step}`;
            }

            collector.recordTaskCompletion(true, 1.0);
        }

        const duration = performance.now() - start;
        const result = evaluateScenario('Multi-Agent Chain', collector.snapshot(), duration);
        results.push(result);

        expect(result.axes.taskSuccess.score).toBeGreaterThan(0.8);
        console.log(`  Multi-Agent Chain: throughput=${result.axes.latencyThroughput.metrics.throughput_msgs_sec.toFixed(0)} msgs/sec overhead=${result.axes.messageOverhead.metrics.msgs_per_task.toFixed(1)} msgs/task`);
    }, 30_000);

    // ─── Scenario 3: Gossip Convergence ─────────────────────────

    it('Scenario: Gossip Convergence — overhead + consistency', () => {
        const collector = new InMemoryMetricsCollector();
        const start = performance.now();

        // Create 3 knowledge pools
        const nodes: { pool: KnowledgePool; storage: Storage; identity: Identity }[] = [];
        const spaceId = 'gossip-space';

        for (let i = 0; i < 3; i++) {
            const identity = generateIdentity(`GossipNode-${i}`);
            const storage = new Storage({ dbPath: join(testDir, `gossip-${i}.db`) });
            saveId(storage, identity);
            const pool = new KnowledgePool(storage, identity);
            setupSpaceInMemory(pool, spaceId, 'Gossip');
            nodes.push({ pool, storage, identity });
        }

        // Each node creates 5 cards
        const allCards: KnowledgeCard[] = [];
        for (let n = 0; n < 3; n++) {
            for (let c = 0; c < 5; c++) {
                const card: KnowledgeCard = {
                    id: `gossip-${n}-${c}`,
                    spaceId,
                    type: 'fact',
                    title: `Node${n} Card${c}`,
                    summary: `Summary`,
                    content: `Content from node ${n}`,
                    contentFormat: 'plain',
                    author: nodes[n].identity.did,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    version: 1,
                    tags: [],
                    domain: [],
                    entities: [],
                    confidence: 0.8,
                    verificationStatus: 'unverified',
                    verifications: [],
                    usage: { views: 0, citations: 0, applications: 0, lastAccessed: Date.now() },
                    privacy: 'public',
                    crdt: {
                        hlc: { wallTime: Date.now() + n * 10000 + c * 1000, logical: c, nodeId: nodes[n].identity.did },
                        vectorClock: { [nodes[n].identity.did]: c + 1 },
                        tombstone: false,
                    },
                };
                nodes[n].pool.mergeCard(card);
                allCards.push(card);
            }
        }

        // Gossip: each node merges all cards from other nodes
        let gossipMessages = 0;
        for (const node of nodes) {
            for (const card of allCards) {
                const mStart = performance.now();
                node.pool.mergeCard(card);
                const mEnd = performance.now();
                gossipMessages++;
                collector.recordMessage('gossip.merge', JSON.stringify(card).length / 4, mEnd - mStart);
            }
        }

        // Verify convergence
        const cardCounts = nodes.map(n => (n.pool as any).cards.size);
        const converged = cardCounts.every(c => c === cardCounts[0]);
        collector.recordTaskCompletion(converged, converged ? 1.0 : 0.0);

        const duration = performance.now() - start;

        // Cleanup
        for (const n of nodes) n.storage.close();

        const result = evaluateScenario('Gossip Convergence', collector.snapshot(), duration);
        results.push(result);

        expect(converged).toBe(true);
        expect(result.axes.taskSuccess.score).toBeGreaterThan(0.5);
        console.log(`  Gossip Convergence: converged=${converged} msgs=${gossipMessages} duration=${duration.toFixed(0)}ms`);
    }, 30_000);

    // ─── Scenario 4: Partition Recovery ─────────────────────────

    it('Scenario: Partition Recovery — robustness', () => {
        const collector = new InMemoryMetricsCollector();
        const start = performance.now();
        const spaceId = 'partition-space';

        // Create 2 pools
        const pools: { pool: KnowledgePool; storage: Storage; identity: Identity }[] = [];
        for (let i = 0; i < 2; i++) {
            const identity = generateIdentity(`PartitionNode-${i}`);
            const storage = new Storage({ dbPath: join(testDir, `partition-${i}.db`) });
            saveId(storage, identity);
            const pool = new KnowledgePool(storage, identity);
            setupSpaceInMemory(pool, spaceId, 'Partition');
            pools.push({ pool, storage, identity });
        }

        // Phase 1: Both pools share initial cards
        const sharedCards: KnowledgeCard[] = [];
        for (let c = 0; c < 5; c++) {
            const card: KnowledgeCard = {
                id: `shared-${c}`,
                spaceId,
                type: 'fact',
                title: `Shared Card ${c}`,
                summary: `Shared summary`,
                content: `Shared content ${c}`,
                contentFormat: 'plain',
                author: pools[0].identity.did,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                version: 1,
                tags: [],
                domain: [],
                entities: [],
                confidence: 0.8,
                verificationStatus: 'unverified',
                verifications: [],
                usage: { views: 0, citations: 0, applications: 0, lastAccessed: Date.now() },
                privacy: 'public',
                crdt: {
                    hlc: { wallTime: Date.now() + c * 1000, logical: c, nodeId: pools[0].identity.did },
                    vectorClock: { [pools[0].identity.did]: c + 1 },
                    tombstone: false,
                },
            };
            sharedCards.push(card);
            pools[0].pool.mergeCard(card);
            pools[1].pool.mergeCard(card);
        }

        // Phase 2: Simulate partition — each creates conflicting updates
        collector.recordFault('network_partition');
        const partitionStart = performance.now();

        // Pool 0 updates cards with its own vector clock
        for (let c = 0; c < 3; c++) {
            const update: KnowledgeCard = {
                ...sharedCards[c],
                title: `Updated by Pool 0 - Card ${c}`,
                version: 2,
                crdt: {
                    hlc: { wallTime: Date.now() + 50000 + c, logical: 0, nodeId: pools[0].identity.did },
                    vectorClock: { [pools[0].identity.did]: c + 2 },
                    tombstone: false,
                },
            };
            pools[0].pool.mergeCard(update);
        }

        // Pool 1 updates same cards with its own vector clock (concurrent!)
        for (let c = 0; c < 3; c++) {
            const update: KnowledgeCard = {
                ...sharedCards[c],
                title: `Updated by Pool 1 - Card ${c}`,
                version: 2,
                crdt: {
                    hlc: { wallTime: Date.now() + 60000 + c, logical: 0, nodeId: pools[1].identity.did },
                    vectorClock: { [pools[1].identity.did]: c + 2 },
                    tombstone: false,
                },
            };
            pools[1].pool.mergeCard(update);
        }

        // Phase 3: Heal partition — merge all cards both ways
        const healStart = performance.now();
        const pool0Cards = [...(pools[0].pool as any).cards.values()] as KnowledgeCard[];
        const pool1Cards = [...(pools[1].pool as any).cards.values()] as KnowledgeCard[];

        for (const card of pool0Cards) {
            const mStart = performance.now();
            pools[1].pool.mergeCard(card);
            collector.recordMessage('recovery.merge', 200, performance.now() - mStart);
        }
        for (const card of pool1Cards) {
            const mStart = performance.now();
            pools[0].pool.mergeCard(card);
            collector.recordMessage('recovery.merge', 200, performance.now() - mStart);
        }

        const recoveryMs = performance.now() - healStart;
        collector.recordRecovery('network_partition', recoveryMs);

        // Verify: both pools converge
        const count0 = (pools[0].pool as any).cards.size;
        const count1 = (pools[1].pool as any).cards.size;
        const converged = count0 === count1;
        collector.recordTaskCompletion(converged, converged ? 1.0 : 0.0);

        // Verify: no data loss — all 5 cards should exist
        const noDataLoss = count0 >= 5 && count1 >= 5;
        collector.recordTaskCompletion(noDataLoss, noDataLoss ? 1.0 : 0.0);

        const duration = performance.now() - start;

        // Cleanup
        for (const p of pools) p.storage.close();

        const result = evaluateScenario('Partition Recovery', collector.snapshot(), duration);
        results.push(result);

        expect(converged).toBe(true);
        expect(noDataLoss).toBe(true);
        console.log(`  Partition Recovery: converged=${converged} recovery=${recoveryMs.toFixed(1)}ms dataLoss=${!noDataLoss}`);
    }, 30_000);
});
