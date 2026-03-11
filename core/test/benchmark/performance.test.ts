import { describe, it, expect } from 'vitest';
import { Storage } from '../../src/storage.js';
import { generateIdentity } from '../../src/identity.js';
import { FederationEngine } from '../../src/federation.js';
import { KnowledgePool } from '../../src/knowledge.js';
import { SecurityManager } from '../../src/security.js';
import { P2PNode } from '../../src/p2p.js';
import { RoomManager } from '../../src/rooms.js';
import { CocEngine } from '../../src/coc.js';
import { SkillsEngine } from '../../src/skills/engine.js';
import { IntegrationEngine } from '../../src/integration.js';
import { createEnvelope } from '../../src/swp.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

describe('Performance Benchmarks', () => {
    let testDir: string;

    beforeAll(() => {
        testDir = join(tmpdir(), `society-benchmark-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
    });

    afterAll(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    describe('Storage Performance', () => {
        it('should write 10000 items', async () => {
            const storage = new Storage({ dbPath: join(testDir, 'perf-storage.db') });
            
            const start = Date.now();
            
            storage.transaction(() => {
                for (let i = 0; i < 10000; i++) {
                    storage.set(`key-${i}`, {
                        index: i,
                        data: 'x'.repeat(100),
                        timestamp: Date.now()
                    });
                }
            });
            
            const elapsed = Date.now() - start;
            const opsPerSecond = 10000 / (elapsed / 1000);
            
            console.log(`\nStorage Write:`);
            console.log(`  10000 writes in ${elapsed}ms`);
            console.log(`  ${Math.round(opsPerSecond)} ops/sec`);
            
            expect(elapsed).toBeLessThan(5000);
            expect(opsPerSecond).toBeGreaterThan(1000);
        });

        it('should read 10000 items', async () => {
            const storage = new Storage({ dbPath: join(testDir, 'perf-read.db') });
            
            // Setup
            storage.transaction(() => {
                for (let i = 0; i < 10000; i++) {
                    storage.set(`read-${i}`, { index: i });
                }
            });
            
            // Benchmark
            const start = Date.now();
            for (let i = 0; i < 10000; i++) {
                storage.get(`read-${i}`);
            }
            const elapsed = Date.now() - start;
            const opsPerSecond = 10000 / (elapsed / 1000);
            
            console.log(`\nStorage Read:`);
            console.log(`  10000 reads in ${elapsed}ms`);
            console.log(`  ${Math.round(opsPerSecond)} ops/sec`);
            
            expect(elapsed).toBeLessThan(3000);
            expect(opsPerSecond).toBeGreaterThan(3000);
        });
    });

    describe('Crypto Performance', () => {
        it('should sign 1000 messages', async () => {
            const storage = new Storage({ dbPath: join(testDir, 'perf-crypto.db') });
            const identity = generateIdentity('Benchmark');
            const security = new SecurityManager(identity);
            
            const message = new TextEncoder().encode('Benchmark message');
            
            const start = Date.now();
            for (let i = 0; i < 1000; i++) {
                await security.sign(message);
            }
            const elapsed = Date.now() - start;
            const opsPerSecond = 1000 / (elapsed / 1000);
            
            console.log(`\nCrypto Sign:`);
            console.log(`  1000 signs in ${elapsed}ms`);
            console.log(`  ${Math.round(opsPerSecond)} ops/sec`);
            console.log(`  ${elapsed / 1000}ms per operation`);
            
            // Baseline for JS crypto - will be much faster with Rust WASM
            expect(elapsed).toBeLessThan(10000);
        });

        it('should verify 1000 signatures', async () => {
            const storage = new Storage({ dbPath: join(testDir, 'perf-verify.db') });
            const identity = generateIdentity('Benchmark');
            const security = new SecurityManager(identity);
            
            const message = new TextEncoder().encode('Benchmark message');
            const signature = await security.sign(message);
            
            const start = Date.now();
            for (let i = 0; i < 1000; i++) {
                await security.verify(message, signature, identity.publicKey);
            }
            const elapsed = Date.now() - start;
            const opsPerSecond = 1000 / (elapsed / 1000);
            
            console.log(`\nCrypto Verify:`);
            console.log(`  1000 verifies in ${elapsed}ms`);
            console.log(`  ${Math.round(opsPerSecond)} ops/sec`);
        });

        it('should encrypt/decrypt 100 messages', async () => {
            const storage = new Storage({ dbPath: join(testDir, 'perf-encrypt.db') });
            const identity = generateIdentity('Benchmark');
            const recipientIdentity = generateIdentity('Recipient');
            const security = new SecurityManager(identity);
            const recipientSecurity = new SecurityManager(recipientIdentity);

            const recipientKeyPair = await recipientSecurity.generateKeyPair(recipientIdentity.did);
            const recipientPublicKey = new Uint8Array(
                await crypto.subtle.exportKey('raw', recipientKeyPair.publicKey)
            );
            
            const plaintext = new TextEncoder().encode('Secret message for encryption benchmark');
            
            const start = Date.now();
            for (let i = 0; i < 100; i++) {
                const encrypted = await security.encrypt(plaintext, recipientPublicKey);
                await recipientSecurity.decrypt(encrypted);
            }
            const elapsed = Date.now() - start;
            const opsPerSecond = 100 / (elapsed / 1000);
            
            console.log(`\nCrypto Encrypt/Decrypt:`);
            console.log(`  100 cycles in ${elapsed}ms`);
            console.log(`  ${Math.round(opsPerSecond)} ops/sec`);
        });
    });

    describe('Federation Performance', () => {
        it('should create 100 federations', async () => {
            const storage = new Storage({ dbPath: join(testDir, 'perf-fed.db') });
            const identity = generateIdentity('Benchmark');
            const federation = new FederationEngine(storage, identity);
            
            const start = Date.now();
            for (let i = 0; i < 100; i++) {
                await federation.createFederation(
                    `Federation ${i}`,
                    `Description ${i}`,
                    'public'
                );
            }
            const elapsed = Date.now() - start;
            const opsPerSecond = 100 / (elapsed / 1000);
            
            console.log(`\nFederation Create:`);
            console.log(`  100 federations in ${elapsed}ms`);
            console.log(`  ${Math.round(opsPerSecond)} ops/sec`);
            
            expect(elapsed).toBeLessThan(5000);
        });
    });

    describe('Knowledge Performance', () => {
        it('should create 1000 knowledge cards', async () => {
            const storage = new Storage({ dbPath: join(testDir, 'perf-know.db') });
            const identity = generateIdentity('Benchmark');
            const knowledge = new KnowledgePool(storage, identity);
            
            const space = await knowledge.createSpace('Benchmark', 'Test', 'team', 'room');
            
            const start = Date.now();
            for (let i = 0; i < 1000; i++) {
                await knowledge.createCard(
                    space.id,
                    'fact',
                    `Card ${i}`,
                    `Content for card ${i} with some additional text to make it realistic`
                );
            }
            const elapsed = Date.now() - start;
            const opsPerSecond = 1000 / (elapsed / 1000);
            
            console.log(`\nKnowledge Create:`);
            console.log(`  1000 cards in ${elapsed}ms`);
            console.log(`  ${Math.round(opsPerSecond)} ops/sec`);
            
            expect(elapsed).toBeLessThan(10000);
        });
    });

    describe('Federation Mesh Performance', () => {
        it('should relay bridged events with stable latency', async () => {
            const storage = new Storage({ dbPath: join(testDir, 'perf-mesh.db') });
            const identity = generateIdentity('Mesh Bench');
            const p2p = new P2PNode({ enableGossipsub: false, enableDht: false, enableMdns: false });
            const rooms = new RoomManager(identity, p2p, storage);
            const coc = new CocEngine(identity, rooms, storage);
            const federation = new FederationEngine(storage, identity);
            const knowledge = new KnowledgePool(storage, identity);
            const skills = new SkillsEngine(storage, identity, join(testDir, 'skills'));
            const security = new SecurityManager(identity);
            const integration = new IntegrationEngine(
                storage,
                identity,
                federation,
                rooms,
                knowledge,
                coc,
                skills,
                security
            );

            // Avoid network side effects in benchmark: capture bridge send path only.
            (rooms as any).sendMessage = async () => ({ ok: true });

            const fed = await federation.createFederation('Bench Fed', 'mesh benchmark', 'private');
            const peering = await federation.requestPeering(fed.id, 'did:society:fed-bench-remote');
            await federation.respondPeering(peering.id, true);
            const bridge = await integration.openMeshBridge(
                peering.id,
                'mesh-local-room',
                'mesh-remote-room',
                {
                    allowedTypes: ['chat.msg'],
                    maxRatePerMinute: 10_000,
                    privacyMode: 'summary'
                }
            );

            const iterations = 500;
            const latencies: number[] = [];
            const startedAt = Date.now();

            for (let i = 0; i < iterations; i++) {
                const envelope = createEnvelope(identity, 'chat.msg', 'mesh-local-room', {
                    text: `mesh event ${i}`
                });
                const t0 = performance.now();
                const result = await integration.publishMeshEvent(bridge.id, envelope);
                const t1 = performance.now();
                if (!result.delivered) {
                    throw new Error(`Mesh publish failed on iteration ${i}: ${result.reason}`);
                }
                latencies.push(t1 - t0);
            }

            const elapsed = Date.now() - startedAt;
            latencies.sort((a, b) => a - b);
            const p50 = latencies[Math.floor(latencies.length * 0.5)];
            const p95 = latencies[Math.floor(latencies.length * 0.95)];
            const throughput = iterations / (elapsed / 1000);

            console.log(`\nMesh Bridge:`);
            console.log(`  ${iterations} events in ${elapsed}ms`);
            console.log(`  p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);
            console.log(`  throughput=${Math.round(throughput)} events/sec`);

            expect(throughput).toBeGreaterThan(100);
            expect(p95).toBeLessThan(50);

            skills.stop();
            coc.destroy();
            rooms.destroy();
            storage.close();
        });
    });

    describe('Memory Usage', () => {
        it('should report memory baseline', async () => {
            if (global.gc) global.gc();
            
            const baseline = process.memoryUsage();
            console.log(`\nMemory Baseline:`);
            console.log(`  RSS: ${Math.round(baseline.rss / 1024 / 1024)}MB`);
            console.log(`  Heap Used: ${Math.round(baseline.heapUsed / 1024 / 1024)}MB`);
            console.log(`  Heap Total: ${Math.round(baseline.heapTotal / 1024 / 1024)}MB`);
            
            expect(baseline.rss).toBeLessThan(500 * 1024 * 1024); // < 500MB
        });
    });
});
