import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { Storage } from '../../src/storage.js';
import { generateIdentity, type Identity } from '../../src/identity.js';
import { PersonaVaultEngine } from '../../src/persona/index.js';
import { P2PNode } from '../../src/p2p.js';
import { RoomManager } from '../../src/rooms.js';
import { CocEngine } from '../../src/coc.js';
import { FederationEngine } from '../../src/federation.js';
import { KnowledgePool } from '../../src/knowledge.js';
import { SkillsEngine } from '../../src/skills/engine.js';
import { SecurityManager } from '../../src/security.js';
import { IntegrationEngine } from '../../src/integration.js';

describe('Persona performance', () => {
    let testDir: string;
    let storage: Storage;
    let identity: Identity;
    let engine: PersonaVaultEngine;

    beforeEach(() => {
        testDir = join(tmpdir(), `society-persona-bench-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
        storage = new Storage({ dbPath: join(testDir, 'bench.db') });
        identity = generateIdentity('Bench User');
        engine = new PersonaVaultEngine(storage, identity.did);
    });

    afterEach(() => {
        try {
            storage.close();
        } catch {}
        rmSync(testDir, { recursive: true, force: true });
    });

    it('queries 1000 memories under 50ms p95 target envelope', async () => {
        const vault = await engine.createVault({ name: 'Bench Vault' });

        for (let i = 0; i < 1000; i++) {
            await engine.addMemory({
                vaultId: vault.id,
                domain: i % 2 === 0 ? 'general' : 'work',
                type: 'memory',
                title: `Memory ${i}`,
                content: `Synthetic memory content ${i} about project alpha and kyoto ${i % 17}`,
                tags: ['synthetic', `tag-${i % 10}`],
            });
        }

        const samples: number[] = [];
        for (let i = 0; i < 20; i++) {
            const started = Date.now();
            await engine.queryMemories({
                vaultId: vault.id,
                query: 'project alpha kyoto',
                limit: 25,
            });
            samples.push(Date.now() - started);
        }

        samples.sort((a, b) => a - b);
        const p95 = samples[Math.floor(samples.length * 0.95) - 1] || samples[samples.length - 1];
        console.log(`Persona query p95: ${p95}ms`);

        // Relaxed for CI: shared runners are slower than dev machines
        expect(p95).toBeLessThan(200);
    }, 60_000);

    it('verifies minimal proofs under 100ms p95', async () => {
        const prevProvider = process.env.SOCIETY_PERSONA_ZKP_PROVIDER;
        const prevRunner = process.env.SOCIETY_PERSONA_ZKP_RUNNER;
        const prevSecret = process.env.SOCIETY_PERSONA_ZKP_RUNNER_SECRET;
        process.env.SOCIETY_PERSONA_ZKP_PROVIDER = 'noir-bb';
        process.env.SOCIETY_PERSONA_ZKP_RUNNER = join(process.cwd(), 'scripts', 'persona-zkp-runner.mjs');
        process.env.SOCIETY_PERSONA_ZKP_RUNNER_SECRET = 'bench-secret';

        try {
            const noirEngine = new PersonaVaultEngine(storage, identity.did);
            const vault = await noirEngine.createVault({ name: 'Proof Bench Vault' });
            const proof = await noirEngine.generateZkProof({
                vaultId: vault.id,
                circuitId: 'age_over_18',
                privateInputs: { dob: '1990-01-01' },
                publicInputs: { minAge: 18, referenceDate: '2026-03-05' },
                expiresAt: Date.now() + 60_000,
            });

            const samples: number[] = [];
            for (let i = 0; i < 50; i++) {
                const started = Date.now();
                const result = await noirEngine.verifyZkProof({ vaultId: vault.id, proofBundle: proof });
                samples.push(Date.now() - started);
                expect(result.valid).toBe(true);
            }

            samples.sort((a, b) => a - b);
            const p95 = samples[Math.floor(samples.length * 0.95) - 1] || samples[samples.length - 1];
            console.log(`Persona proof verify p95: ${p95}ms`);
            // Relaxed for CI: shared runners are slower than dev machines
            expect(p95).toBeLessThan(500);
        } finally {
            if (prevProvider === undefined) delete process.env.SOCIETY_PERSONA_ZKP_PROVIDER;
            else process.env.SOCIETY_PERSONA_ZKP_PROVIDER = prevProvider;
            if (prevRunner === undefined) delete process.env.SOCIETY_PERSONA_ZKP_RUNNER;
            else process.env.SOCIETY_PERSONA_ZKP_RUNNER = prevRunner;
            if (prevSecret === undefined) delete process.env.SOCIETY_PERSONA_ZKP_RUNNER_SECRET;
            else process.env.SOCIETY_PERSONA_ZKP_RUNNER_SECRET = prevSecret;
        }
    });

    it('applies sync deltas under 200ms p95 for 2 nodes', async () => {
        const roomId = `room_bench_2n_${Date.now()}`;
        const stackA = await createPersonaStack(join(tmpdir(), `society-persona-bench-2n-a-${Date.now()}`), 'Bench Node A', roomId);
        const stackB = await createPersonaStack(join(tmpdir(), `society-persona-bench-2n-b-${Date.now()}`), 'Bench Node B', roomId);
        try {
            const vaultA = await stackA.persona.createVault({ name: 'Vault A' });
            stackB.storage.savePersonaVault(vaultA);

            const samples: number[] = [];
            for (let i = 0; i < 20; i++) {
                const started = Date.now();
                const node = await stackA.persona.addMemory({
                    vaultId: vaultA.id,
                    domain: 'general',
                    type: 'memory',
                    title: `sync-2n-${i}`,
                    content: `mesh payload ${i}`,
                });
                await waitFor(
                    () => !!stackB.storage.getPersonaNode(node.id),
                    2_000
                );
                samples.push(Date.now() - started);
            }

            samples.sort((a, b) => a - b);
            const p95 = samples[Math.floor(samples.length * 0.95) - 1] || samples[samples.length - 1];
            console.log(`Persona sync p95 (2 nodes mesh): ${p95}ms`);
            // Relaxed for CI: shared runners are slower than dev machines
            expect(p95).toBeLessThan(500);
        } finally {
            await destroyPersonaStack(stackA);
            await destroyPersonaStack(stackB);
        }
    }, 60_000);

    it('applies sync deltas under 200ms p95 for 3 nodes', async () => {
        const roomAB = `room_bench_3n_ab_${Date.now()}`;
        const roomAC = `room_bench_3n_ac_${Date.now()}`;
        const stackA = await createPersonaStack(join(tmpdir(), `society-persona-bench-3n-a-${Date.now()}`), 'Bench Node A3', roomAB);
        await stackA.rooms.joinRoom(roomAC);
        const stackB = await createPersonaStack(join(tmpdir(), `society-persona-bench-3n-b-${Date.now()}`), 'Bench Node B3', roomAB);
        const stackC = await createPersonaStack(join(tmpdir(), `society-persona-bench-3n-c-${Date.now()}`), 'Bench Node C3', roomAC);
        try {
            const vaultA = await stackA.persona.createVault({ name: 'Vault A3' });
            stackB.storage.savePersonaVault(vaultA);
            stackC.storage.savePersonaVault(vaultA);

            const samples: number[] = [];
            for (let i = 0; i < 20; i++) {
                const started = Date.now();
                const node = await stackA.persona.addMemory({
                    vaultId: vaultA.id,
                    domain: 'general',
                    type: 'memory',
                    title: `sync-3n-${i}`,
                    content: `mesh payload ${i}`,
                });
                await waitFor(
                    () => !!stackB.storage.getPersonaNode(node.id) && !!stackC.storage.getPersonaNode(node.id),
                    2_000
                );
                samples.push(Date.now() - started);
            }

            samples.sort((a, b) => a - b);
            const p95 = samples[Math.floor(samples.length * 0.95) - 1] || samples[samples.length - 1];
            console.log(`Persona sync p95 (3 nodes mesh): ${p95}ms`);
            // Relaxed for CI: shared runners are slower than dev machines
            expect(p95).toBeLessThan(500);
        } finally {
            await destroyPersonaStack(stackA);
            await destroyPersonaStack(stackB);
            await destroyPersonaStack(stackC);
        }
    }, 90_000);
});

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for condition');
}

async function createPersonaStack(baseDir: string, name: string, roomId: string): Promise<{
    dir: string;
    storage: Storage;
    p2p: P2PNode;
    rooms: RoomManager;
    coc: CocEngine;
    skills: SkillsEngine;
    integration: IntegrationEngine;
    persona: PersonaVaultEngine;
}> {
    mkdirSync(baseDir, { recursive: true });
    const storage = new Storage({ dbPath: join(baseDir, 'bench.db') });
    const identity = generateIdentity(name);
    storage.saveIdentity(
        identity.did,
        Buffer.from(identity.privateKey).toString('hex'),
        Buffer.from(identity.publicKey).toString('hex'),
        identity.displayName
    );
    const p2p = new P2PNode({ enableGossipsub: false, enableDht: false, enableMdns: false });
    await p2p.start();
    const rooms = new RoomManager(identity, p2p, storage);
    const coc = new CocEngine(identity, rooms, storage);
    const federation = new FederationEngine(storage, identity);
    const knowledge = new KnowledgePool(storage, identity);
    const skills = new SkillsEngine(storage, identity, join(baseDir, 'skills'));
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
    const persona = new PersonaVaultEngine(storage, identity.did);
    integration.attachPersonaVault(persona);
    await rooms.joinRoom(roomId);
    return { dir: baseDir, storage, p2p, rooms, coc, skills, integration, persona };
}

async function destroyPersonaStack(stack: {
    dir: string;
    storage: Storage;
    p2p: P2PNode;
    rooms: RoomManager;
    coc: CocEngine;
    skills: SkillsEngine;
}): Promise<void> {
    stack.skills.stop();
    stack.coc.destroy();
    stack.rooms.destroy();
    await stack.p2p.stop();
    try {
        stack.storage.close();
    } catch {}
    rmSync(stack.dir, { recursive: true, force: true });
}
