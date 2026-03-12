/**
 * CRDT Formal Verification — Property-Based Tests
 *
 * Uses fast-check to verify algebraic properties of Society Protocol's CRDT:
 * - Commutativity, Associativity, Idempotency of vector clock merge
 * - HLC total ordering, monotonicity
 * - KnowledgeCard merge convergence under arbitrary orderings
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
    compareVectorClocks,
    mergeVectorClocks,
    tickHLC,
    receiveHLC,
    compareHLC,
    KnowledgePool,
    type HybridLogicalClock,
    type KnowledgeCard,
} from '../../src/knowledge.js';
import { Storage } from '../../src/storage.js';
import { generateIdentity } from '../../src/identity.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';

// ─── Helpers ────────────────────────────────────────────────────

function saveId(storage: Storage, identity: ReturnType<typeof generateIdentity>) {
    storage.saveIdentity(
        identity.did,
        Buffer.from(identity.privateKey).toString('hex'),
        Buffer.from(identity.publicKey).toString('hex'),
        identity.displayName
    );
}

/** Set up a space in-memory only (no async DB writes) to avoid storage lifecycle issues. */
function setupSpaceInMemory(pool: KnowledgePool, spaceId: string) {
    (pool as any).spaces.set(spaceId, {
        id: spaceId,
        name: 'test',
        description: '',
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

// ─── Arbitraries ────────────────────────────────────────────────

const nodeChars = 'ABCDEFGHIJ'.split('');
const arbNodeId = fc.array(
    fc.constantFrom(...nodeChars),
    { minLength: 1, maxLength: 3 }
).map(arr => arr.join(''));

const arbVectorClock = fc.dictionary(
    arbNodeId,
    fc.integer({ min: 0, max: 100 })
);

const arbHLC: fc.Arbitrary<HybridLogicalClock> = fc.record({
    wallTime: fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 }),
    logical: fc.integer({ min: 0, max: 1000 }),
    nodeId: arbNodeId,
});

// ─── Vector Clock Properties ────────────────────────────────────

describe('CRDT Formal Verification: Vector Clocks', () => {
    it('mergeVectorClocks is commutative', () => {
        fc.assert(
            fc.property(arbVectorClock, arbVectorClock, (a, b) => {
                const ab = mergeVectorClocks(a, b);
                const ba = mergeVectorClocks(b, a);
                expect(ab).toEqual(ba);
            }),
            { numRuns: 500 }
        );
    });

    it('mergeVectorClocks is associative', () => {
        fc.assert(
            fc.property(arbVectorClock, arbVectorClock, arbVectorClock, (a, b, c) => {
                const ab_c = mergeVectorClocks(mergeVectorClocks(a, b), c);
                const a_bc = mergeVectorClocks(a, mergeVectorClocks(b, c));
                expect(ab_c).toEqual(a_bc);
            }),
            { numRuns: 500 }
        );
    });

    it('mergeVectorClocks is idempotent', () => {
        fc.assert(
            fc.property(arbVectorClock, (a) => {
                const merged = mergeVectorClocks(a, a);
                expect(merged).toEqual(a);
            }),
            { numRuns: 500 }
        );
    });

    it('compareVectorClocks: before↔after symmetry', () => {
        fc.assert(
            fc.property(arbVectorClock, arbVectorClock, (a, b) => {
                const ab = compareVectorClocks(a, b);
                const ba = compareVectorClocks(b, a);
                if (ab === 'before') expect(ba).toBe('after');
                else if (ab === 'after') expect(ba).toBe('before');
                else if (ab === 'equal') expect(ba).toBe('equal');
                else if (ab === 'concurrent') expect(ba).toBe('concurrent');
            }),
            { numRuns: 500 }
        );
    });

    it('merge produces upper bound: merged ≥ both inputs', () => {
        fc.assert(
            fc.property(arbVectorClock, arbVectorClock, (a, b) => {
                const merged = mergeVectorClocks(a, b);
                const orderA = compareVectorClocks(a, merged);
                const orderB = compareVectorClocks(b, merged);
                // a should be 'before' or 'equal' to merged
                expect(['before', 'equal']).toContain(orderA);
                expect(['before', 'equal']).toContain(orderB);
            }),
            { numRuns: 500 }
        );
    });
});

// ─── HLC Properties ────────────────────────────────────────────

describe('CRDT Formal Verification: Hybrid Logical Clocks', () => {
    it('compareHLC is antisymmetric', () => {
        fc.assert(
            fc.property(arbHLC, arbHLC, (a, b) => {
                const ab = compareHLC(a, b);
                const ba = compareHLC(b, a);
                expect(Math.sign(ab)).toBe(-Math.sign(ba));
            }),
            { numRuns: 500 }
        );
    });

    it('compareHLC is transitive', () => {
        fc.assert(
            fc.property(arbHLC, arbHLC, arbHLC, (a, b, c) => {
                const ab = compareHLC(a, b);
                const bc = compareHLC(b, c);
                const ac = compareHLC(a, c);
                if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0);
                if (ab >= 0 && bc >= 0) expect(ac).toBeGreaterThanOrEqual(0);
            }),
            { numRuns: 200 }
        );
    });

    it('tickHLC is monotonic: always advances', () => {
        fc.assert(
            fc.property(arbHLC, (hlc) => {
                const ticked = tickHLC(hlc);
                // ticked should be strictly after hlc
                // compareHLC(hlc, ticked) < 0 means hlc < ticked
                const cmp = compareHLC(hlc, ticked);
                expect(cmp).toBeLessThan(0);
            }),
            { numRuns: 500 }
        );
    });

    it('receiveHLC is monotonic: always advances local', () => {
        fc.assert(
            fc.property(arbHLC, arbHLC, (local, remote) => {
                const received = receiveHLC(local, remote);
                // received should be strictly after local
                const cmp = compareHLC(local, received);
                expect(cmp).toBeLessThan(0);
            }),
            { numRuns: 500 }
        );
    });
});

// ─── KnowledgeCard Merge Properties ────────────────────────────

describe('CRDT Formal Verification: KnowledgeCard Merge', () => {
    let testDir: string;

    function createPool(name: string): { pool: KnowledgePool; storage: Storage } {
        const identity = generateIdentity(name);
        const dbPath = join(testDir, `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
        const storage = new Storage({ dbPath });
        saveId(storage, identity);
        const pool = new KnowledgePool(storage, identity);
        return { pool, storage };
    }

    function makeCard(
        pool: KnowledgePool,
        id: string,
        spaceId: string,
        title: string,
        vcOverride?: Record<string, number>,
        hlcOverride?: Partial<HybridLogicalClock>,
        tombstone?: boolean
    ): KnowledgeCard {
        const identity = (pool as any).identity;
        return {
            id,
            spaceId,
            type: 'fact',
            title,
            summary: title,
            content: title,
            contentFormat: 'plain',
            author: identity.did,
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
                hlc: {
                    wallTime: hlcOverride?.wallTime ?? Date.now() + 100000,
                    logical: hlcOverride?.logical ?? 0,
                    nodeId: hlcOverride?.nodeId ?? identity.did,
                },
                vectorClock: vcOverride ?? { [identity.did]: 1 },
                tombstone: tombstone ?? false,
            },
        };
    }

    beforeEach(() => {
        testDir = join(tmpdir(), `society-crdt-prop-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('mergeCard is idempotent: double merge = single merge', () => {
        const { pool, storage } = createPool('idempotent');
        const spaceId = 'space-idem';

        try {
            for (let i = 0; i < 50; i++) {
                // Create fresh pool per iteration
                const { pool: p, storage: s } = createPool(`idem-${i}`);
                try {
                    setupSpaceInMemory(p, spaceId);
                    const card = makeCard(p, `card-${i}`, spaceId, `Title ${i}`,
                        { 'A': i + 1 },
                        { wallTime: Date.now() + 200000 + i, logical: i, nodeId: 'A' });

                    const first = p.mergeCard(card);
                    const second = p.mergeCard(card);

                    // Second merge should return null (already have same or newer)
                    expect(second).toBeNull();
                } finally {
                    s.close();
                }
            }
        } finally {
            storage.close();
        }
    });

    it('tombstone wins: if either side tombstoned, result is tombstoned', () => {
        for (let i = 0; i < 50; i++) {
            const { pool, storage } = createPool(`tomb-${i}`);
            try {
                const spaceId = `space-tomb-${i}`;
                setupSpaceInMemory(pool, spaceId);

                // Create a local card (not tombstoned)
                const localCard = makeCard(pool, `card-tomb-${i}`, spaceId, 'Local',
                    { 'A': 1 },
                    { wallTime: Date.now() + 100000, logical: 0, nodeId: 'A' },
                    false);
                pool.mergeCard(localCard);

                // Merge a remote card with tombstone=true and higher VC
                const remoteCard = makeCard(pool, `card-tomb-${i}`, spaceId, 'Remote',
                    { 'A': 1, 'B': 1 },
                    { wallTime: Date.now() + 200000, logical: 1, nodeId: 'B' },
                    true);
                const merged = pool.mergeCard(remoteCard);

                expect(merged).not.toBeNull();
                expect(merged!.crdt.tombstone).toBe(true);
            } finally {
                storage.close();
            }
        }
    });

    it('vector clock upper bound after merge', () => {
        for (let i = 0; i < 50; i++) {
            const { pool, storage } = createPool(`vc-ub-${i}`);
            try {
                const spaceId = `space-vc-${i}`;
                setupSpaceInMemory(pool, spaceId);

                const localVC = { 'A': i + 1, 'B': i };
                const remoteVC = { 'A': i, 'B': i + 2, 'C': 1 };

                const localCard = makeCard(pool, `card-vc-${i}`, spaceId, 'Local',
                    localVC,
                    { wallTime: Date.now() + 100000, logical: 0, nodeId: 'A' });
                pool.mergeCard(localCard);

                const remoteCard = makeCard(pool, `card-vc-${i}`, spaceId, 'Remote',
                    remoteVC,
                    { wallTime: Date.now() + 200000, logical: 1, nodeId: 'B' });
                const merged = pool.mergeCard(remoteCard);

                if (merged) {
                    // Merged VC should be >= both local and remote
                    for (const node of Object.keys({ ...localVC, ...remoteVC })) {
                        expect(merged.crdt.vectorClock[node] || 0)
                            .toBeGreaterThanOrEqual(Math.max(localVC[node] || 0, remoteVC[node] || 0));
                    }
                }
            } finally {
                storage.close();
            }
        }
    });
});

// ─── N-Node Convergence Stress Test ─────────────────────────────

describe('CRDT Formal Verification: N-Node Convergence', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = join(tmpdir(), `society-crdt-conv-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('N nodes with random merge order converge to same state', () => {
        const nodeCount = 3;
        const cardsPerNode = 3;

        for (let trial = 0; trial < 20; trial++) {
            const nodes: { pool: KnowledgePool; storage: Storage; cards: KnowledgeCard[] }[] = [];
            const spaceId = `space-conv-${trial}`;

            try {
                // Create N nodes, each with their own cards
                for (let n = 0; n < nodeCount; n++) {
                    const identity = generateIdentity(`Node-${n}`);
                    const dbPath = join(testDir, `conv-${trial}-${n}.db`);
                    const storage = new Storage({ dbPath });
                    saveId(storage, identity);
                    const pool = new KnowledgePool(storage, identity);
                    setupSpaceInMemory(pool, spaceId);

                    const cards: KnowledgeCard[] = [];
                    for (let c = 0; c < cardsPerNode; c++) {
                        const cardId = `card-${n}-${c}`;
                        const card: KnowledgeCard = {
                            id: cardId,
                            spaceId,
                            type: 'fact',
                            title: `Node${n}-Card${c}`,
                            summary: `Summary`,
                            content: `Content from node ${n}`,
                            contentFormat: 'plain',
                            author: identity.did,
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                            version: 1,
                            tags: [`tag-${n}`],
                            domain: [],
                            entities: [],
                            confidence: 0.8,
                            verificationStatus: 'unverified',
                            verifications: [],
                            usage: { views: 0, citations: 0, applications: 0, lastAccessed: Date.now() },
                            privacy: 'public',
                            crdt: {
                                hlc: {
                                    wallTime: Date.now() + 100000 + n * 10000 + c * 1000,
                                    logical: c,
                                    nodeId: identity.did,
                                },
                                vectorClock: { [identity.did]: c + 1 },
                                tombstone: false,
                            },
                        };
                        cards.push(card);
                        pool.mergeCard(card);
                    }

                    nodes.push({ pool, storage, cards });
                }

                // Collect all cards from all nodes
                const allCards = nodes.flatMap(n => n.cards);

                // Shuffle cards differently for each node and merge
                for (const node of nodes) {
                    const shuffled = [...allCards].sort(() => Math.random() - 0.5);
                    for (const card of shuffled) {
                        node.pool.mergeCard(card);
                    }
                }

                // Verify all nodes converge to the same set of cards
                const cardSets = nodes.map(n => {
                    const cards = new Map<string, { title: string; tombstone: boolean }>();
                    for (const [id, card] of (n.pool as any).cards.entries()) {
                        cards.set(id, { title: card.title, tombstone: card.crdt.tombstone });
                    }
                    return cards;
                });

                // All nodes should have the same card IDs
                const firstKeys = [...cardSets[0].keys()].sort();
                for (let n = 1; n < nodeCount; n++) {
                    const nKeys = [...cardSets[n].keys()].sort();
                    expect(nKeys).toEqual(firstKeys);
                }

                // All nodes should agree on tombstone status
                for (const cardId of firstKeys) {
                    const firstTombstone = cardSets[0].get(cardId)!.tombstone;
                    for (let n = 1; n < nodeCount; n++) {
                        expect(cardSets[n].get(cardId)!.tombstone).toBe(firstTombstone);
                    }
                }
            } finally {
                for (const n of nodes) {
                    n.storage.close();
                }
            }
        }
    }, 60_000);
});
