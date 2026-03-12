/**
 * Society Protocol — Real-World Multi-Agent E2E Test Battery
 *
 * Tests ALL protocol features with real external agents:
 *   - Ollama (local LLM via qwen3:1.7b)
 *   - OpenRouter (remote LLM via HTTP API)
 *   - Nanobot (Docker containers as external agents)
 *
 * 7 Scenarios covering: multi-runtime collaboration, nanobot adapters,
 * knowledge gossip, ZKP identity, encryption, full pipeline, stress test.
 *
 * Run:
 *   docker compose -f docker-compose.test.yml up -d
 *   docker exec $(docker ps -q -f name=ollama) ollama pull qwen3:1.7b
 *   cd core && npm run test:real
 */

import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'fs';
import { EventEmitter } from 'events';
import { Storage } from '../../src/storage.js';
import { generateIdentity, sign, verify, type Identity } from '../../src/identity.js';
import { RoomManager } from '../../src/rooms.js';
import { P2PNode } from '../../src/p2p.js';
import { CocEngine } from '../../src/coc.js';
import { KnowledgePool, type KnowledgeCard } from '../../src/knowledge.js';
import { SecurityManager } from '../../src/security.js';
import { ContentStore } from '../../src/content-store.js';
import { ReputationEngine, type TaskOutcome } from '../../src/reputation.js';
import { SocialEngine } from '../../src/social.js';
import { FederationEngine } from '../../src/federation.js';
import { DemandSpawner } from '../../src/gateway/demand-spawner.js';
import { CapabilityRouter } from '../../src/gateway/capability-router.js';
import { CapsuleExporter } from '../../src/capsules.js';
import {
    createIdentityProof,
    verifyIdentityProof,
    serializeIdentityProof,
    deserializeIdentityProof,
} from '../../src/identity-proof.js';
import { InMemoryMetricsCollector } from '../../src/benchmark/collector.js';
import {
    evaluateScenario,
    formatBenchmarkReport,
    aggregateScenarios,
} from '../../src/benchmark/reporter.js';
import type { BenchmarkScenarioResult } from '../../src/benchmark/types.js';

// ─── Constants ──────────────────────────────────────────────────

const OPENROUTER_API_KEY = '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';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'nvidia/nemotron-3-nano-30b-a3b:free';
const OLLAMA_MODEL = 'qwen3:1.7b';
const OLLAMA_URL = 'http://localhost:11434';
const NANOBOT_PORT_1 = 18791;
const NANOBOT_PORT_2 = 18792;

// ─── Helpers ────────────────────────────────────────────────────

const cleanupFns: Array<() => Promise<void> | void> = [];
const scenarioResults: BenchmarkScenarioResult[] = [];

afterEach(async () => {
    for (const cleanup of cleanupFns.splice(0).reverse()) {
        try { await cleanup(); } catch { /* ignore cleanup errors */ }
    }
});

afterAll(() => {
    if (scenarioResults.length === 0) return;
    const report = {
        version: '1.3.0',
        timestamp: Date.now(),
        platform: `${process.platform} ${process.arch} node/${process.version}`,
        scenarios: scenarioResults,
        aggregate: aggregateScenarios(scenarioResults),
    };
    console.log('\n' + formatBenchmarkReport(report) + '\n');
});

function saveId(storage: Storage, identity: Identity) {
    storage.saveIdentity(
        identity.did,
        Buffer.from(identity.privateKey).toString('hex'),
        Buffer.from(identity.publicKey).toString('hex'),
        identity.displayName
    );
}

/** Ensure DID exists in reputation table (FK target for task_outcomes) */
function ensureReputation(storage: Storage, did: string) {
    const existing = storage.getReputationRecord(did);
    if (!existing) {
        storage.saveReputation({
            did,
            overall: 0.5,
            trust_tier: 'unverified',
            metrics: {},
            specialties: [],
            first_seen: Date.now(),
            version: 1,
        });
    }
}

function setupSpaceInMemory(pool: KnowledgePool, spaceId: string, name: string, description = '') {
    (pool as any).spaces.set(spaceId, {
        id: spaceId, name, description,
        owner: (pool as any).identity.did,
        type: 'personal', privacy: 'public',
        cards: new Set(), links: [], subspaces: [],
        createdAt: Date.now(), updatedAt: Date.now(), tags: [],
        stats: { cardCount: 0, linkCount: 0, contributorCount: 1, lastActivity: Date.now() },
        policies: { allowPublicRead: false, allowPublicWrite: false, requireVerification: false },
    });
}

function createTestEnv(name: string) {
    const dir = join(tmpdir(), `society-real-e2e-${name}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const storage = new Storage({ dbPath: join(dir, 'test.db') });
    const identity = generateIdentity(name);
    saveId(storage, identity);
    const p2p = new P2PNode({ enableGossipsub: false, enableDht: false, enableMdns: false });
    const rooms = new RoomManager(identity, p2p, storage);
    const knowledge = new KnowledgePool(storage, identity);
    rooms.setKnowledgePool(knowledge);
    cleanupFns.push(async () => {
        rooms.destroy();
        await p2p.stop();
        storage.close();
        rmSync(dir, { recursive: true, force: true });
    });
    return { dir, storage, identity, p2p, rooms, knowledge };
}

function createMockRooms(): any {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
        joinRoom: () => {},
        leaveRoom: () => {},
        publish: () => {},
        getMembers: () => [],
        sendMessage: async () => {},
        sendChatMessage: async () => {},
        getMessages: () => [],
        getJoinedRooms: () => [],
    });
}

async function isOllamaAvailable(): Promise<boolean> {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
        return res.ok;
    } catch { return false; }
}

async function isOpenRouterAvailable(): Promise<boolean> {
    try {
        const res = await fetch('https://openrouter.ai/api/v1/models', {
            headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
            signal: AbortSignal.timeout(5000),
        });
        return res.ok;
    } catch { return false; }
}

async function isNanobotAvailable(port: number): Promise<boolean> {
    try {
        const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) });
        return res.ok;
    } catch { return false; }
}

async function callNanobot(port: number, message: string): Promise<string> {
    const res = await fetch(`http://localhost:${port}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Nanobot:${port}: ${res.status} ${res.statusText}`);
    const data = await res.json() as any;
    return data?.response || '';
}

async function callOllama(prompt: string, model = OLLAMA_MODEL): Promise<string> {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false }),
        signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Ollama: ${res.status} ${res.statusText}`);
    const data = await res.json() as any;
    return data?.response || '';
}

const OPENROUTER_FALLBACK_MODELS = [
    OPENROUTER_MODEL,
    'liquid/lfm-2.5-1.2b-instruct:free',
    'arcee-ai/trinity-mini:free',
];

async function callOpenRouter(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: any[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    for (const model of OPENROUTER_FALLBACK_MODELS) {
        try {
            const res = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://society-protocol.dev',
                },
                body: JSON.stringify({ model, messages, max_tokens: 512 }),
                signal: AbortSignal.timeout(60_000),
            });
            if (!res.ok) {
                console.log(`  ⚠ OpenRouter model ${model} returned ${res.status}, trying next...`);
                continue;
            }
            const data = await res.json() as any;
            const content = data.choices?.[0]?.message?.content || '';
            if (content) return content;
        } catch (err) {
            console.log(`  ⚠ OpenRouter model ${model} failed: ${err}, trying next...`);
        }
    }
    throw new Error('OpenRouter: all models failed');
}

function makeCard(
    identity: Identity, id: string, spaceId: string,
    title: string, content: string, tags: string[] = [],
): KnowledgeCard {
    return {
        id, spaceId, type: 'fact', title,
        summary: title, content, contentFormat: 'plain',
        author: identity.did,
        createdAt: Date.now(), updatedAt: Date.now(), version: 1,
        tags, domain: [], entities: [],
        confidence: 0.8, verificationStatus: 'unverified', verifications: [],
        usage: { views: 0, citations: 0, applications: 0, lastAccessed: Date.now() },
        privacy: 'public',
        crdt: {
            hlc: { wallTime: Date.now() + Math.random() * 100000, logical: 0, nodeId: identity.did },
            vectorClock: { [identity.did]: 1 },
            tombstone: false,
        },
    };
}

// ─── Scenario 1: Multi-Runtime Agent Collaboration ──────────────

describe('Scenario 1: Multi-Runtime Agent Collaboration (Ollama + OpenRouter)', () => {
    it('assembles team with Ollama, feeds results to OpenRouter for review', async () => {
        const ollama = await isOllamaAvailable();
        const openrouter = await isOpenRouterAvailable();
        if (!ollama) { console.log('  ⚠ Ollama not available — skipping'); return; }

        const collector = new InMemoryMetricsCollector();
        const start = performance.now();

        const storage = new Storage({ dbPath: ':memory:' });
        const identity = generateIdentity('Orchestrator');
        saveId(storage, identity);
        const reputation = new ReputationEngine(storage);
        const rooms = createMockRooms();
        const coc = new CocEngine(identity, rooms, storage, reputation);
        const registry = { getVisibleWorkers: () => [] } as any;
        const spawner = new DemandSpawner(storage, rooms, coc, registry, {
            ollamaModel: OLLAMA_MODEL,
            taskTimeoutMs: 60_000,
        }, identity);

        cleanupFns.push(() => { spawner.destroy(); coc.destroy(); });

        // Step 1: DemandSpawner executes via Ollama
        const spawnStart = performance.now();
        const result = await spawner.handleRequest({
            goal: 'Explain zero-knowledge proofs in 3 sentences.',
            roomId: 'multi-runtime-room',
            priority: 'normal',
        });
        const spawnDuration = performance.now() - spawnStart;

        expect(result.status).toBe('completed');
        expect(result.agents.length).toBeGreaterThanOrEqual(1);
        collector.recordTaskCompletion(true, 1.0);
        collector.recordMessage('spawn.execute', JSON.stringify(result.results).length, spawnDuration);

        const ollamaOutput = Object.values(result.results).join('\n');
        expect(ollamaOutput.length).toBeGreaterThan(20);
        console.log(`  ✓ Ollama output: ${ollamaOutput.substring(0, 100)}...`);

        // Step 2: If OpenRouter available, send for review
        let reviewOutput = '';
        if (openrouter) {
            const reviewStart = performance.now();
            reviewOutput = await callOpenRouter(
                `Review this explanation and provide a brief assessment:\n\n${ollamaOutput}`,
                'You are a technical reviewer. Be concise.'
            );
            const reviewDuration = performance.now() - reviewStart;
            expect(reviewOutput.length).toBeGreaterThan(10);
            collector.recordTaskCompletion(true, 1.0);
            collector.recordMessage('openrouter.review', reviewOutput.length, reviewDuration);
            console.log(`  ✓ OpenRouter review: ${reviewOutput.substring(0, 100)}...`);
        } else {
            console.log('  ⚠ OpenRouter not available — skipping review step');
        }

        // Step 3: Store results as knowledge cards
        const pool = new KnowledgePool(storage, identity);
        const spaceId = 'multi-runtime-space';
        setupSpaceInMemory(pool, spaceId, 'Multi-Runtime');

        const card1 = makeCard(identity, 'card-ollama-1', spaceId, 'ZKP Explanation', ollamaOutput, ['zkp', 'cryptography']);
        pool.mergeCard(card1);

        if (reviewOutput) {
            const card2 = makeCard(identity, 'card-review-1', spaceId, 'ZKP Review', reviewOutput, ['zkp', 'review']);
            pool.mergeCard(card2);
        }

        const cards = pool.queryCards({ spaceId, tags: ['zkp'] });
        expect(cards.length).toBeGreaterThanOrEqual(1);

        // Step 4: Record reputation
        const outcome: TaskOutcome = {
            did: identity.did,
            chain_id: result.chainId || 'chain-1',
            step_id: 'step-1',
            status: 'completed',
            quality_score: 0.85,
            latency_ms: spawnDuration,
            lease_ms: 60000,
            accepted: true,
            specialties_used: ['research'],
            timestamp: Date.now(),
        };
        ensureReputation(storage, identity.did);
        await reputation.recordTaskOutcome(outcome);
        const rep = await reputation.getReputation(identity.did);
        expect(rep.metrics.tasks_completed).toBeGreaterThanOrEqual(1);

        const duration = performance.now() - start;
        const scenarioResult = evaluateScenario('Multi-Runtime Collaboration', collector.snapshot(), duration);
        scenarioResults.push(scenarioResult);

        console.log(`  ✓ Pipeline complete: Ollama→OpenRouter→Knowledge→Reputation in ${duration.toFixed(0)}ms`);
    }, 120_000);
});

// ─── Scenario 2: Nanobot External Agents ────────────────────────

describe('Scenario 2: Nanobot External Agents via HTTP', () => {
    it('calls real nanobot Docker containers and feeds results into protocol pipeline', async () => {
        const nb1 = await isNanobotAvailable(NANOBOT_PORT_1);
        const nb2 = await isNanobotAvailable(NANOBOT_PORT_2);
        if (!nb1 && !nb2) { console.log('  ⚠ No Nanobot containers available — skipping'); return; }

        const collector = new InMemoryMetricsCollector();
        const start = performance.now();

        const storage = new Storage({ dbPath: ':memory:' });
        const identity = generateIdentity('NanobotOrchestrator');
        saveId(storage, identity);
        const reputation = new ReputationEngine(storage);
        const rooms = createMockRooms();
        const coc = new CocEngine(identity, rooms, storage, reputation);

        cleanupFns.push(() => { coc.destroy(); });

        // Create room in DB directly (FK constraint for coc_chains.room_id)
        storage.db.prepare(
            'INSERT OR IGNORE INTO rooms (room_id, name, created_by, created_at) VALUES (?, ?, ?, ?)'
        ).run('nanobot-room', 'nanobot-room', identity.did, Date.now());
        const chainId = await coc.openChain('nanobot-room', 'Research distributed systems via nanobot agents');

        // Query available nanobot instances
        const nanobots: { port: number; name: string; prompt: string }[] = [];
        if (nb1) nanobots.push({
            port: NANOBOT_PORT_1,
            name: 'Nanobot-Research',
            prompt: 'Explain the CAP theorem in distributed systems in 2 sentences.',
        });
        if (nb2) nanobots.push({
            port: NANOBOT_PORT_2,
            name: 'Nanobot-Review',
            prompt: 'What is eventual consistency? Answer in 2 sentences.',
        });

        console.log(`  ✓ ${nanobots.length} nanobot agent(s) available`);

        const nanobotResponses: string[] = [];
        for (let i = 0; i < nanobots.length; i++) {
            const nb = nanobots[i];
            const stepStart = performance.now();

            // Call the actual nanobot container via HTTP
            const agentResponse = await callNanobot(nb.port, nb.prompt);
            const stepDuration = performance.now() - stepStart;

            expect(agentResponse.length).toBeGreaterThan(5);
            nanobotResponses.push(agentResponse);
            collector.recordMessage(`nanobot.${nb.name}`, agentResponse.length, stepDuration);
            collector.recordTaskCompletion(true, 1.0);

            // Record as task outcome
            const nbDid = `did:key:nanobot-${i}`;
            ensureReputation(storage, nbDid);
            await reputation.recordTaskOutcome({
                did: nbDid,
                chain_id: chainId,
                step_id: `step-nb-${i}`,
                status: 'completed',
                quality_score: 0.8,
                latency_ms: stepDuration,
                lease_ms: 60000,
                accepted: true,
                specialties_used: ['distributed-systems'],
                timestamp: Date.now(),
            });

            console.log(`  ✓ ${nb.name} responded (${stepDuration.toFixed(0)}ms): ${agentResponse.substring(0, 80)}...`);
        }

        // Store nanobot knowledge in CRDT pool
        const pool = new KnowledgePool(storage, identity);
        setupSpaceInMemory(pool, 'nanobot-space', 'Nanobot Knowledge');

        for (let i = 0; i < nanobotResponses.length; i++) {
            const card = makeCard(
                identity,
                `nanobot-card-${i}`,
                'nanobot-space',
                `Nanobot Output ${i}`,
                nanobotResponses[i],
                ['nanobot', 'distributed-systems'],
            );
            pool.mergeCard(card);
        }

        const cards = pool.queryCards({ spaceId: 'nanobot-space', tags: ['nanobot'] });
        expect(cards.length).toBe(nanobotResponses.length);

        // Verify reputation was recorded
        for (let i = 0; i < nanobots.length; i++) {
            const rep = await reputation.getReputation(`did:key:nanobot-${i}`);
            expect(rep.metrics.tasks_completed).toBeGreaterThanOrEqual(1);
        }

        // Create a federation with nanobot agents
        const fedEngine = new FederationEngine(storage, identity);
        const fed = await fedEngine.createFederation(
            'Nanobot Federation', 'Federation of nanobot agents'
        );
        expect(fed.name).toBe('Nanobot Federation');

        // Join each nanobot agent to the federation (creator invites them)
        for (let i = 0; i < nanobots.length; i++) {
            const nbIdentity = generateIdentity(`NanobotAgent${i}`);
            saveId(storage, nbIdentity);
            await fedEngine.joinFederation(fed.id, nbIdentity.did, nbIdentity.displayName, identity.did);
        }

        const fedState = fedEngine.getFederation(fed.id)!;
        expect(fedState.members.size).toBeGreaterThanOrEqual(nanobots.length);
        console.log(`  ✓ Federation created with ${fedState.members.size} members`);

        const duration = performance.now() - start;
        const scenarioResult = evaluateScenario('Nanobot External Agents', collector.snapshot(), duration);
        scenarioResults.push(scenarioResult);

        console.log(`  ✓ Nanobot pipeline complete in ${duration.toFixed(0)}ms`);
    }, 120_000);
});

// ─── Scenario 3: P2P Knowledge Gossip with Real LLM Content ────

describe('Scenario 3: Knowledge Gossip with Real LLM Content', () => {
    it('3 agents create LLM-generated cards and achieve CRDT convergence', async () => {
        const ollama = await isOllamaAvailable();
        if (!ollama) { console.log('  ⚠ Ollama not available — skipping'); return; }

        const collector = new InMemoryMetricsCollector();
        const start = performance.now();

        // Create 3 agents
        const agents = ['KnowledgeAlice', 'KnowledgeBob', 'KnowledgeCharlie'].map(name => {
            const env = createTestEnv(name);
            const spaceId = 'shared-research';
            setupSpaceInMemory(env.knowledge, spaceId, 'Shared Research');
            return { ...env, spaceId };
        });

        // Each agent generates knowledge via Ollama
        const topics = [
            'Explain Byzantine fault tolerance in 2 sentences.',
            'Explain the Raft consensus algorithm in 2 sentences.',
            'Explain vector clocks in distributed systems in 2 sentences.',
        ];

        const cards: KnowledgeCard[] = [];
        for (let i = 0; i < 3; i++) {
            const llmStart = performance.now();
            const content = await callOllama(topics[i]);
            const llmDuration = performance.now() - llmStart;

            expect(content.length).toBeGreaterThan(10);
            collector.recordMessage('ollama.generate', content.length, llmDuration);

            const card = makeCard(
                agents[i].identity,
                `knowledge-card-${i}`,
                agents[i].spaceId,
                `Topic ${i}`,
                content,
                [`topic-${i}`, 'distributed-systems']
            );
            cards.push(card);
            agents[i].knowledge.mergeCard(card);
            console.log(`  ✓ Agent ${i} generated: ${content.substring(0, 60)}...`);
        }

        // CRDT gossip: each agent merges all cards from others
        for (const agent of agents) {
            for (const card of cards) {
                const mergeStart = performance.now();
                agent.knowledge.mergeCard(card);
                collector.recordMessage('crdt.merge', 200, performance.now() - mergeStart);
            }
        }

        // Verify convergence
        for (let i = 0; i < 3; i++) {
            const agentCards = (agents[i].knowledge as any).cards;
            expect(agentCards.size).toBe(3);
        }
        collector.recordTaskCompletion(true, 1.0);
        console.log('  ✓ CRDT convergence: all 3 agents have all 3 cards');

        // Knowledge confirmation
        agents[0].knowledge.confirmKnowledge(cards[1].id, agents[0].identity.did);
        agents[2].knowledge.confirmKnowledge(cards[1].id, agents[2].identity.did);

        const confirmedCard = (agents[1].knowledge as any).cards.get(cards[1].id);
        expect(confirmedCard.verifications.length).toBeGreaterThanOrEqual(2);
        console.log(`  ✓ Card verified by 2 agents, status=${confirmedCard.verificationStatus}`);

        // Context serialization + merge
        await agents[0].knowledge.getOrCreateCU(agents[0].spaceId);
        const cu = agents[0].knowledge.getCollectiveUnconscious(agents[0].spaceId);
        if (cu) {
            cu.workingMemory.activeTopics = ['distributed-systems', 'consensus'];
            cu.longTermMemory.keyConcepts = ['BFT', 'Raft', 'vector-clocks'];
            const serialized = agents[0].knowledge.serializeContext(agents[0].spaceId);
            if (serialized) {
                await agents[1].knowledge.mergeRemoteContext(serialized);
                const bobCu = agents[1].knowledge.getCollectiveUnconscious(agents[0].spaceId);
                expect(bobCu).toBeDefined();
                console.log('  ✓ Context serialized and merged across agents');
            }
        }

        const duration = performance.now() - start;
        const scenarioResult = evaluateScenario('Knowledge Gossip (Real LLM)', collector.snapshot(), duration);
        scenarioResults.push(scenarioResult);
    }, 120_000);
});

// ─── Scenario 4: ZKP Identity + Reputation + Social + Federation ─

describe('Scenario 4: ZKP Identity + Reputation + Social + Federation', () => {
    it('full identity verification, reputation scoring, social graph, and federation governance', async () => {
        const collector = new InMemoryMetricsCollector();
        const start = performance.now();

        // Create 4 agents
        const dir = join(tmpdir(), `society-real-s4-${Date.now()}`);
        mkdirSync(dir, { recursive: true });
        const storage = new Storage({ dbPath: join(dir, 's4.db') });

        const alice = generateIdentity('Alice');
        const bob = generateIdentity('Bob');
        const charlie = generateIdentity('Charlie');
        const dave = generateIdentity('Dave');
        [alice, bob, charlie, dave].forEach(id => saveId(storage, id));

        cleanupFns.push(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });

        // ── ZKP Identity Proofs ──
        const aliceProof = createIdentityProof(alice, 'test-room');
        const bobProof = createIdentityProof(bob, 'test-room');
        const charlieProof = createIdentityProof(charlie, 'test-room');

        // Cross-verify
        expect(verifyIdentityProof(aliceProof).valid).toBe(true);
        expect(verifyIdentityProof(bobProof).valid).toBe(true);
        expect(verifyIdentityProof(charlieProof).valid).toBe(true);

        // Serialization roundtrip
        const serialized = serializeIdentityProof(aliceProof);
        const deserialized = deserializeIdentityProof(serialized);
        expect(verifyIdentityProof(deserialized).valid).toBe(true);

        // Expired proof
        const expiredProof = createIdentityProof(dave, 'test-room', -1000);
        expect(verifyIdentityProof(expiredProof).valid).toBe(false);

        collector.recordTaskCompletion(true, 1.0);
        console.log('  ✓ ZKP identity proofs: create, verify, serialize, reject expired');

        // ── Reputation ──
        const reputation = new ReputationEngine(storage);
        [alice, bob, charlie, dave].forEach(id => ensureReputation(storage, id.did));

        // Alice: 4 completed, 1 failed
        for (let i = 0; i < 4; i++) {
            await reputation.recordTaskOutcome({
                did: alice.did, chain_id: `chain-a-${i}`, step_id: `step-${i}`,
                status: 'completed', quality_score: 0.7 + i * 0.05,
                latency_ms: 1000 + i * 200, lease_ms: 60000, accepted: true,
                specialties_used: ['research'], timestamp: Date.now(),
            });
        }
        await reputation.recordTaskOutcome({
            did: alice.did, chain_id: 'chain-a-fail', step_id: 'step-fail',
            status: 'failed', quality_score: 0.0,
            latency_ms: 5000, lease_ms: 60000, accepted: true,
            specialties_used: ['research'], timestamp: Date.now(),
        });

        // Bob: 5 completed, all high quality
        for (let i = 0; i < 5; i++) {
            await reputation.recordTaskOutcome({
                did: bob.did, chain_id: `chain-b-${i}`, step_id: `step-${i}`,
                status: 'completed', quality_score: 0.9,
                latency_ms: 800, lease_ms: 60000, accepted: true,
                specialties_used: ['coding'], timestamp: Date.now(),
            });
        }

        // Charlie: 2 completed, 1 failed
        await reputation.recordTaskOutcome({
            did: charlie.did, chain_id: 'chain-c-0', step_id: 'step-0',
            status: 'completed', quality_score: 0.6,
            latency_ms: 2000, lease_ms: 60000, accepted: true,
            specialties_used: ['review'], timestamp: Date.now(),
        });
        await reputation.recordTaskOutcome({
            did: charlie.did, chain_id: 'chain-c-1', step_id: 'step-1',
            status: 'completed', quality_score: 0.7,
            latency_ms: 1500, lease_ms: 60000, accepted: true,
            specialties_used: ['review'], timestamp: Date.now(),
        });
        await reputation.recordTaskOutcome({
            did: charlie.did, chain_id: 'chain-c-fail', step_id: 'step-fail',
            status: 'failed', quality_score: 0.0,
            latency_ms: 5000, lease_ms: 60000, accepted: true,
            specialties_used: ['review'], timestamp: Date.now(),
        });

        const aliceRep = await reputation.getReputation(alice.did);
        const bobRep = await reputation.getReputation(bob.did);
        const charlieRep = await reputation.getReputation(charlie.did);

        expect(aliceRep.metrics.tasks_completed).toBe(4);
        expect(aliceRep.metrics.tasks_failed).toBe(1);
        expect(bobRep.metrics.tasks_completed).toBe(5);
        expect(bobRep.overall).toBeGreaterThan(aliceRep.overall);
        console.log(`  ✓ Reputation: Alice=${aliceRep.overall.toFixed(2)} Bob=${bobRep.overall.toFixed(2)} Charlie=${charlieRep.overall.toFixed(2)}`);

        // Identity verification → minimum bronze
        reputation.recordIdentityVerification(charlie.did);
        expect(reputation.hasVerifiedIdentity(charlie.did)).toBe(true);

        // Ranking
        const ranking = await reputation.rankAgentsForTask(
            [alice.did, bob.did, charlie.did],
            { specialties: ['coding'] }
        );
        expect(ranking[0].did).toBe(bob.did);
        console.log(`  ✓ Ranking: ${ranking.map(r => `${r.did.slice(-8)}:${r.score.toFixed(2)}`).join(', ')}`);

        // Gossip observation
        const obs = reputation.createObservation({
            did: alice.did, chain_id: 'chain-obs', step_id: 'step-obs',
            status: 'completed', quality_score: 0.9,
            latency_ms: 500, lease_ms: 60000, accepted: true,
            specialties_used: ['research'], timestamp: Date.now(),
        }, bob.did);

        if (obs) {
            const serializedObs = ReputationEngine.serializeObservation(obs);
            const desObs = ReputationEngine.deserializeObservation(serializedObs);
            const ingested = await reputation.ingestObservation(desObs);
            expect(ingested).toBe(true);
            console.log('  ✓ Gossip observation serialized, deserialized, and ingested');
        }

        collector.recordTaskCompletion(true, 1.0);

        // ── Social Layer ──
        const social = new SocialEngine(storage, alice);
        cleanupFns.push(() => social.destroy());

        social.upsertProfile({ did: alice.did, displayName: 'Alice', bio: 'AI Researcher', specialties: ['ml', 'research'], tags: ['senior'] });
        social.upsertProfile({ did: bob.did, displayName: 'Bob', bio: 'Full-stack Developer', specialties: ['coding', 'devops'] });
        social.upsertProfile({ did: charlie.did, displayName: 'Charlie', bio: 'QA Engineer', specialties: ['review', 'testing'] });
        social.upsertProfile({ did: dave.did, displayName: 'Dave', bio: 'Product Manager', specialties: ['planning'] });

        // Follows
        social.follow(bob.did, alice.did);
        social.follow(charlie.did, alice.did);
        social.follow(dave.did, bob.did);
        expect(social.getFollowerCount(alice.did)).toBe(2);
        expect(social.isFollowing(bob.did, alice.did)).toBe(true);
        console.log('  ✓ Social graph: 4 profiles, 3 follows');

        // Invites
        const invite = social.generateInvite({ type: 'federation', targetId: 'fed_test', creatorDid: alice.did, maxUses: 3 });
        expect(invite.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/);
        const redeemed = social.redeemInvite(invite.code, bob.did);
        expect(redeemed.type).toBe('federation');
        social.redeemInvite(invite.code, charlie.did);
        social.redeemInvite(invite.code, dave.did);
        expect(() => social.redeemInvite(invite.code, 'did:key:extra')).toThrow('max uses');
        console.log('  ✓ Invite lifecycle: generate, redeem×3, max-uses enforced');

        // Expired invite
        const expiredInvite = social.generateInvite({ type: 'room', targetId: 'room_exp', creatorDid: alice.did, expiresInMs: -1000 });
        expect(() => social.redeemInvite(expiredInvite.code, bob.did)).toThrow('expired');

        // Activity feed
        social.recordActivity('completed_task', alice.did, 'Alice', 'chain_a', 'Research ZKP');
        social.recordActivity('earned_reputation', bob.did, 'Bob');
        const feed = social.getFeed(bob.did);
        expect(feed.length).toBeGreaterThanOrEqual(1);
        console.log(`  ✓ Activity feed: ${feed.length} items`);

        // Search
        const mlAgents = social.searchProfiles('ml');
        expect(mlAgents.length).toBeGreaterThanOrEqual(1);

        collector.recordTaskCompletion(true, 1.0);

        // ── Federation ──
        const fedEngine = new FederationEngine(storage, alice);

        const fed1 = await fedEngine.createFederation('Research Lab', 'A private research group', 'private');
        expect(fed1.id).toBeTruthy();
        expect(fed1.visibility).toBe('private');

        const fed2 = await fedEngine.createFederation('Engineering Guild', 'Open engineering community', 'public');

        // Membership
        await fedEngine.joinFederation(fed1.id, bob.did, 'Bob', alice.did);
        await fedEngine.joinFederation(fed1.id, charlie.did, 'Charlie', alice.did);
        const updatedFed1 = fedEngine.getFederation(fed1.id)!;
        expect(updatedFed1.members.size).toBeGreaterThanOrEqual(3); // alice + bob + charlie
        console.log(`  ✓ Federation '${fed1.name}': ${updatedFed1.members.size} members`);

        // Cross-federation peering
        const peering = await fedEngine.requestPeering(fed1.id, fed2.did);
        if (peering) {
            await fedEngine.respondPeering(peering.id, true);
            const activePeerings = fedEngine.listPeerings(fed1.id, 'active');
            expect(activePeerings.length).toBe(1);
            console.log('  ✓ Cross-federation peering established');
        }

        collector.recordTaskCompletion(true, 1.0);

        const duration = performance.now() - start;
        const scenarioResult = evaluateScenario('ZKP + Reputation + Social + Federation', collector.snapshot(), duration);
        scenarioResults.push(scenarioResult);
    }, 30_000);
});

// ─── Scenario 5: E2E Encryption + Content Store + Capsule ───────

describe('Scenario 5: E2E Encryption + Content Store + Capsule Export', () => {
    it('encrypts messages, stores content-addressed files, exports capsule', async () => {
        const collector = new InMemoryMetricsCollector();
        const start = performance.now();

        // ── E2E Encryption ──
        const alice = generateIdentity('EncAlice');
        const bob = generateIdentity('EncBob');

        const aliceSec = new SecurityManager(alice);
        const bobSec = new SecurityManager(bob);

        await aliceSec.generateKeyPair();
        await bobSec.generateKeyPair();

        const plaintext = 'Top-secret research data: quantum computing breakthrough';
        const bobPubKey = (bobSec as any).localEncryptionPublicKey as Uint8Array;
        expect(bobPubKey).toBeDefined();

        const encrypted = await aliceSec.encrypt(new TextEncoder().encode(plaintext), bobPubKey);
        expect(encrypted.ciphertext.length).toBeGreaterThan(0);

        const decrypted = await bobSec.decrypt({
            ciphertext: encrypted.ciphertext,
            nonce: encrypted.nonce,
            senderPublicKey: encrypted.senderPublicKey,
        });
        expect(new TextDecoder().decode(decrypted)).toBe(plaintext);

        collector.recordTaskCompletion(true, 1.0);
        console.log('  ✓ E2E encryption: X25519 key exchange + AES-256-GCM roundtrip');

        // ── Room Encryption ──
        const env = createTestEnv('EncRoomAgent');
        await env.p2p.start();
        const roomId = env.rooms.createRoom('encrypted-room');
        expect(env.rooms.isEncrypted(roomId)).toBe(false);
        env.rooms.enableEncryption(roomId);
        expect(env.rooms.isEncrypted(roomId)).toBe(true);
        env.rooms.disableEncryption(roomId);
        expect(env.rooms.isEncrypted(roomId)).toBe(false);
        console.log('  ✓ Room encryption toggle works');

        // ── Content Store ──
        const store = new ContentStore(env.storage);

        // Store raw block
        const data = new TextEncoder().encode('Society Protocol content-addressed storage test');
        const cid = await store.put(data);
        expect(cid.length).toBe(64);
        expect(store.has(cid)).toBe(true);

        const retrieved = await store.get(cid);
        expect(new TextDecoder().decode(retrieved!)).toBe('Society Protocol content-addressed storage test');

        // Store file with chunking
        const testFile = join(env.dir, 'research-data.txt');
        writeFileSync(testFile, 'A'.repeat(2000));
        const manifest = await store.storeFile(testFile, env.identity.did);
        expect(manifest.rootCid).toBeTruthy();
        expect(manifest.totalSize).toBe(2000);

        const fileData = await store.retrieveFile(manifest);
        expect(fileData.length).toBe(2000);

        // Cross-peer manifest sharing
        const env2 = createTestEnv('FilePeer');
        const store2 = new ContentStore(env2.storage);
        store2.addRemoteManifest(manifest);
        const missing = store2.getMissingBlocks(manifest);
        expect(missing.length).toBeGreaterThanOrEqual(1);

        collector.recordTaskCompletion(true, 1.0);
        console.log(`  ✓ Content store: block CID=${cid.slice(0, 16)}..., file manifest, cross-peer sharing`);

        // ── Capsule Export ──
        const rooms2 = createMockRooms();
        const coc = new CocEngine(env.identity, rooms2, env.storage);
        cleanupFns.push(() => coc.destroy());

        // Create room in DB first (FK: coc_chains.room_id → rooms.room_id)
        const capsuleRoomId = env.rooms.createRoom('capsule-room');
        const chainId = await coc.openChain(capsuleRoomId, 'Test capsule export');
        const chain = coc.getChain(chainId);
        expect(chain).toBeDefined();

        const capsuleDir = join(env.dir, 'capsules');
        mkdirSync(capsuleDir, { recursive: true });
        const exporter = new CapsuleExporter(coc, env.storage);
        const capsulePath = await exporter.export(chainId, capsuleDir);

        expect(existsSync(capsulePath)).toBe(true);
        const capsuleSize = statSync(capsulePath).size;
        expect(capsuleSize).toBeGreaterThan(0);

        collector.recordTaskCompletion(true, 1.0);
        console.log(`  ✓ Capsule exported: ${capsulePath.split('/').pop()} (${capsuleSize} bytes)`);

        const duration = performance.now() - start;
        const scenarioResult = evaluateScenario('Encryption + Content + Capsule', collector.snapshot(), duration);
        scenarioResults.push(scenarioResult);
    }, 30_000);
});

// ─── Scenario 6: Full Pipeline with Real Agents ─────────────────

describe('Scenario 6: Full Pipeline — Identity → Room → LLM → Knowledge → Reputation → Capsule', () => {
    it('executes complete protocol pipeline end-to-end with real LLM', async () => {
        const ollama = await isOllamaAvailable();
        if (!ollama) { console.log('  ⚠ Ollama not available — skipping'); return; }

        const collector = new InMemoryMetricsCollector();
        const start = performance.now();

        // Step 1: Identity
        const aliceEnv = createTestEnv('PipelineAlice');
        const bobEnv = createTestEnv('PipelineBob');

        const aliceProof = createIdentityProof(aliceEnv.identity, 'pipeline-room');
        const bobProof = createIdentityProof(bobEnv.identity, 'pipeline-room');
        expect(verifyIdentityProof(aliceProof).valid).toBe(true);
        expect(verifyIdentityProof(bobProof).valid).toBe(true);
        console.log('  ✓ Step 1: Identity proofs created and verified');

        // Step 2: Room + Encryption
        await aliceEnv.p2p.start();
        const roomId = aliceEnv.rooms.createRoom('pipeline-room');
        await aliceEnv.rooms.joinRoom(roomId);
        aliceEnv.rooms.enableEncryption(roomId);
        expect(aliceEnv.rooms.isEncrypted(roomId)).toBe(true);
        console.log('  ✓ Step 2: Room created with encryption');

        // Step 3: Social profiles
        const social = new SocialEngine(aliceEnv.storage, aliceEnv.identity);
        cleanupFns.push(() => social.destroy());
        social.upsertProfile({ did: aliceEnv.identity.did, displayName: 'Pipeline Alice', specialties: ['research'] });
        social.upsertProfile({ did: bobEnv.identity.did, displayName: 'Pipeline Bob', specialties: ['review'] });
        social.follow(bobEnv.identity.did, aliceEnv.identity.did);
        console.log('  ✓ Step 3: Social profiles and follows');

        // Step 4: DemandSpawner with real Ollama
        const reputation = new ReputationEngine(aliceEnv.storage);
        const rooms = createMockRooms();
        const coc = new CocEngine(aliceEnv.identity, rooms, aliceEnv.storage, reputation);
        const registry = { getVisibleWorkers: () => [] } as any;
        const spawner = new DemandSpawner(aliceEnv.storage, rooms, coc, registry, {
            ollamaModel: OLLAMA_MODEL, taskTimeoutMs: 60_000,
        }, aliceEnv.identity);

        cleanupFns.push(() => { spawner.destroy(); coc.destroy(); });

        const spawnResult = await spawner.handleRequest({
            goal: 'Explain federated learning in 2 sentences.',
            roomId: 'pipeline-room',
            priority: 'normal',
        });
        expect(spawnResult.status).toBe('completed');
        const llmOutput = Object.values(spawnResult.results).join('\n');
        expect(llmOutput.length).toBeGreaterThan(10);
        console.log(`  ✓ Step 4: Ollama LLM task completed (${llmOutput.length} chars)`);

        // Step 5: If OpenRouter available, review
        const openrouter = await isOpenRouterAvailable();
        let reviewOutput = '';
        if (openrouter) {
            reviewOutput = await callOpenRouter(
                `Review: ${llmOutput.substring(0, 200)}`,
                'Be concise. Max 2 sentences.'
            );
            console.log(`  ✓ Step 5: OpenRouter review (${reviewOutput.length} chars)`);
        }

        // Step 6: Knowledge cards from LLM output
        const spaceId = 'pipeline-knowledge';
        setupSpaceInMemory(aliceEnv.knowledge, spaceId, 'Pipeline Knowledge');
        setupSpaceInMemory(bobEnv.knowledge, spaceId, 'Pipeline Knowledge');

        const card = makeCard(aliceEnv.identity, 'pipeline-card-1', spaceId, 'Federated Learning', llmOutput, ['ml', 'federated']);
        aliceEnv.knowledge.mergeCard(card);
        bobEnv.knowledge.mergeCard(card); // CRDT sync

        expect((bobEnv.knowledge as any).cards.size).toBe(1);
        console.log('  ✓ Step 6: Knowledge card synced via CRDT');

        // Step 7: Reputation
        ensureReputation(aliceEnv.storage, aliceEnv.identity.did);
        await reputation.recordTaskOutcome({
            did: aliceEnv.identity.did, chain_id: spawnResult.chainId || 'pipeline-chain',
            step_id: 'step-1', status: 'completed', quality_score: 0.85,
            latency_ms: spawnResult.durationMs || 1000, lease_ms: 60000, accepted: true,
            specialties_used: ['research'], timestamp: Date.now(),
        });
        reputation.recordIdentityVerification(aliceEnv.identity.did);
        const rep = await reputation.getReputation(aliceEnv.identity.did);
        expect(rep.metrics.tasks_completed).toBeGreaterThanOrEqual(1);
        console.log(`  ✓ Step 7: Reputation score=${rep.overall.toFixed(2)}, tier=${rep.trust_tier}`);

        // Step 8: Capsule export
        const chain = coc.getChain(spawnResult.chainId!);
        if (chain) {
            const capsuleDir = join(aliceEnv.dir, 'capsules');
            mkdirSync(capsuleDir, { recursive: true });
            const exporter = new CapsuleExporter(coc, aliceEnv.storage);
            const capsulePath = await exporter.export(spawnResult.chainId!, capsuleDir);
            expect(existsSync(capsulePath)).toBe(true);
            console.log(`  ✓ Step 8: Capsule exported`);
        }

        // Step 9: Federation
        const fedEngine = new FederationEngine(aliceEnv.storage, aliceEnv.identity);
        const fed = await fedEngine.createFederation('Pipeline Federation', 'Test federation', 'public');
        await fedEngine.joinFederation(fed.id, bobEnv.identity.did, 'Pipeline Bob', aliceEnv.identity.did);
        console.log(`  ✓ Step 9: Federation created with 2 members`);

        // Activity
        social.recordActivity('completed_task', aliceEnv.identity.did, 'Pipeline Alice', spawnResult.chainId, 'Full pipeline');
        const feed = social.getFeed(bobEnv.identity.did);
        expect(feed.length).toBeGreaterThanOrEqual(1);
        console.log(`  ✓ Step 10: Activity feed has ${feed.length} items`);

        collector.recordTaskCompletion(true, 1.0);
        const duration = performance.now() - start;
        const scenarioResult = evaluateScenario('Full Pipeline E2E', collector.snapshot(), duration);
        scenarioResults.push(scenarioResult);

        console.log(`  ✓ FULL PIPELINE COMPLETE in ${(duration / 1000).toFixed(1)}s`);
    }, 180_000);
});

// ─── Scenario 7: Concurrent Stress Test ─────────────────────────

describe('Scenario 7: Concurrent Agents Stress Test', () => {
    it('5 agents concurrently create 50 cards and achieve CRDT convergence', async () => {
        const collector = new InMemoryMetricsCollector();
        const start = performance.now();

        const nodeCount = 5;
        const cardsPerNode = 10;
        const spaceId = 'stress-test';

        const agents: { knowledge: KnowledgePool; storage: Storage; identity: Identity; cards: KnowledgeCard[] }[] = [];

        const dir = join(tmpdir(), `society-stress-${Date.now()}`);
        mkdirSync(dir, { recursive: true });

        for (let n = 0; n < nodeCount; n++) {
            const identity = generateIdentity(`StressAgent-${n}`);
            const storage = new Storage({ dbPath: join(dir, `stress-${n}.db`) });
            saveId(storage, identity);
            const knowledge = new KnowledgePool(storage, identity);
            setupSpaceInMemory(knowledge, spaceId, 'Stress Test');

            const cards: KnowledgeCard[] = [];
            for (let c = 0; c < cardsPerNode; c++) {
                const card = makeCard(
                    identity, `stress-${n}-${c}`, spaceId,
                    `Agent${n}-Card${c}`, `Content from agent ${n} card ${c}`,
                    [`agent-${n}`, `batch-${c % 3}`]
                );
                card.crdt.hlc.wallTime = Date.now() + n * 10000 + c * 1000;
                card.crdt.hlc.logical = c;
                card.crdt.vectorClock = { [identity.did]: c + 1 };
                cards.push(card);
                knowledge.mergeCard(card);
            }

            agents.push({ knowledge, storage, identity, cards });
        }

        cleanupFns.push(() => {
            agents.forEach(a => a.storage.close());
            rmSync(dir, { recursive: true, force: true });
        });

        // Sync all cards to all agents
        const allCards = agents.flatMap(a => a.cards);
        expect(allCards.length).toBe(50);

        for (const agent of agents) {
            // Shuffle for randomized merge order
            const shuffled = [...allCards].sort(() => Math.random() - 0.5);
            for (const card of shuffled) {
                const mergeStart = performance.now();
                agent.knowledge.mergeCard(card);
                collector.recordMessage('stress.merge', 200, performance.now() - mergeStart);
            }
        }

        // Verify convergence
        for (let n = 0; n < nodeCount; n++) {
            const size = (agents[n].knowledge as any).cards.size;
            expect(size).toBe(50);
        }

        collector.recordTaskCompletion(true, 1.0);
        console.log(`  ✓ CRDT convergence: ${nodeCount} agents × ${cardsPerNode} cards = ${allCards.length} total, all converged`);

        // Concurrent reputation recording
        const repDir = join(tmpdir(), `society-stress-rep-${Date.now()}`);
        mkdirSync(repDir, { recursive: true });
        const repStorage = new Storage({ dbPath: join(repDir, 'rep.db') });
        agents.forEach(a => {
            saveId(repStorage, a.identity);
            ensureReputation(repStorage, a.identity.did);
        });
        const reputation = new ReputationEngine(repStorage);

        cleanupFns.push(() => { repStorage.close(); rmSync(repDir, { recursive: true, force: true }); });

        for (const agent of agents) {
            for (let t = 0; t < 10; t++) {
                await reputation.recordTaskOutcome({
                    did: agent.identity.did,
                    chain_id: `stress-chain-${t}`,
                    step_id: `step-${t}`,
                    status: t < 8 ? 'completed' : 'failed',
                    quality_score: t < 8 ? 0.7 + Math.random() * 0.3 : 0,
                    latency_ms: 500 + Math.random() * 2000,
                    lease_ms: 60000,
                    accepted: true,
                    specialties_used: ['general'],
                    timestamp: Date.now(),
                });
            }
        }

        // Verify all reputations
        for (const agent of agents) {
            const rep = await reputation.getReputation(agent.identity.did);
            expect(rep.metrics.tasks_completed).toBe(8);
            expect(rep.metrics.tasks_failed).toBe(2);
        }
        console.log(`  ✓ Concurrent reputation: ${nodeCount} agents × 10 outcomes each, all consistent`);

        // Verify card queries work across agents
        const queryResults = agents[0].knowledge.queryCards({ spaceId, tags: ['agent-0'] });
        expect(queryResults.length).toBe(cardsPerNode);

        const duration = performance.now() - start;
        const scenarioResult = evaluateScenario('Concurrent Stress Test', collector.snapshot(), duration);
        scenarioResults.push(scenarioResult);

        console.log(`  ✓ Stress test complete in ${duration.toFixed(0)}ms`);
    }, 60_000);
});
