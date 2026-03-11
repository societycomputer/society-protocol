import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { Storage } from '../../src/storage.js';
import { generateIdentity, type Identity } from '../../src/identity.js';
import { PersonaVaultEngine, type PersonaNode } from '../../src/persona/index.js';

describe('Persona sync integration', () => {
    let testDir: string;
    let storageA: Storage;
    let storageB: Storage;
    let identityA: Identity;
    let identityB: Identity;
    let engineA: PersonaVaultEngine;
    let engineB: PersonaVaultEngine;

    beforeEach(() => {
        testDir = join(tmpdir(), `society-persona-sync-test-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });

        storageA = new Storage({ dbPath: join(testDir, 'a.db') });
        storageB = new Storage({ dbPath: join(testDir, 'b.db') });
        identityA = generateIdentity('Node A');
        identityB = generateIdentity('Node B');
        engineA = new PersonaVaultEngine(storageA, identityA.did);
        engineB = new PersonaVaultEngine(storageB, identityB.did);
    });

    afterEach(() => {
        try {
            storageA.close();
            storageB.close();
        } catch {}
        rmSync(testDir, { recursive: true, force: true });
    });

    it('applies sync delta with node upserts', async () => {
        const vault = await engineA.createVault({ name: 'Shared Vault' });
        const node = await engineA.addMemory({
            vaultId: vault.id,
            domain: 'general',
            type: 'memory',
            title: 'Shared memory',
            content: 'Memory from node A',
            tags: ['sync'],
        });

        const delta = engineA.buildSyncDelta({
            vaultId: vault.id,
            operations: [{ type: 'node_upsert', payload: node as unknown as Record<string, unknown> }],
        });

        const result = await engineB.applySyncDelta(delta);
        expect(result.applied).toBe(1);

        const query = await engineB.queryMemories({ vaultId: vault.id, query: 'Shared memory', limit: 5 });
        expect(query.nodes.some((n) => n.title === 'Shared memory')).toBe(true);
    });

    it('resolves node conflict with LWW', async () => {
        const vault = await engineA.createVault({ name: 'Conflict Vault' });
        const base = await engineA.addMemory({
            vaultId: vault.id,
            domain: 'work',
            type: 'event',
            title: 'Meeting',
            content: 'Initial content',
        });

        const older: PersonaNode = {
            ...base,
            content: 'Older',
            updatedAt: base.updatedAt - 10,
        };
        const newer: PersonaNode = {
            ...base,
            content: 'Newer',
            updatedAt: base.updatedAt + 10,
        };

        await engineB.applySyncDelta(
            engineA.buildSyncDelta({
                vaultId: vault.id,
                operations: [{ type: 'node_upsert', payload: older as unknown as Record<string, unknown> }],
            })
        );
        await engineB.applySyncDelta(
            engineA.buildSyncDelta({
                vaultId: vault.id,
                operations: [{ type: 'node_upsert', payload: newer as unknown as Record<string, unknown> }],
            })
        );

        const query = await engineB.queryMemories({ vaultId: vault.id, query: 'Meeting', limit: 5 });
        const winner = query.nodes.find((n) => n.id === base.id);
        expect(winner?.content).toBe('Newer');
    });

    it('blocks sensitive sync without proof and accepts with valid proof', async () => {
        const vault = await engineA.createVault({ name: 'Sensitive Vault' });
        const node = await engineA.addMemory({
            vaultId: vault.id,
            domain: 'health',
            type: 'memory',
            title: 'Lab result',
            content: 'Private marker value',
        });

        const withoutProof = engineA.buildSyncDelta({
            vaultId: vault.id,
            operations: [{ type: 'node_upsert', payload: node as unknown as Record<string, unknown> }],
        });
        const blocked = await engineB.applySyncDelta(withoutProof);
        expect(blocked.applied).toBe(0);
        expect(blocked.ignored).toBe(1);

        const proof = await engineA.generateZkProof({
            vaultId: vault.id,
            circuitId: 'domain_membership',
            privateInputs: { membershipClaimSecret: 'sync-secret' },
            publicInputs: { domain: 'health', subjectDid: identityA.did },
            expiresAt: Date.now() + 10_000,
        });
        const withProof = engineA.buildSyncDelta({
            vaultId: vault.id,
            operations: [{ type: 'node_upsert', payload: node as unknown as Record<string, unknown> }],
            proofs: [proof],
        });
        const accepted = await engineB.applySyncDelta(withProof);
        expect(accepted.applied).toBe(1);
        expect(accepted.ignored).toBe(0);
    });

    it('converges deterministic edge confidence merge across 3 peers', async () => {
        const storageC = new Storage({ dbPath: join(testDir, 'c.db') });
        const identityC = generateIdentity('Node C');
        const engineC = new PersonaVaultEngine(storageC, identityC.did);
        try {
            const vault = await engineA.createVault({ name: 'Edge Merge Vault' });
            storageB.savePersonaVault(vault);
            storageC.savePersonaVault(vault);

            const source = await engineA.addMemory({
                vaultId: vault.id,
                domain: 'work',
                type: 'entity',
                title: 'Project Atlas',
                content: 'Source node',
            });
            const target = await engineA.addMemory({
                vaultId: vault.id,
                domain: 'work',
                type: 'entity',
                title: 'Risk Model',
                content: 'Target node',
            });
            const baseEdge = await engineA.linkMemories({
                vaultId: vault.id,
                sourceNodeId: source.id,
                targetNodeId: target.id,
                type: 'related_to',
                weight: 0.5,
                confidence: 0.5,
            });

            const seedNodesDelta = engineA.buildSyncDelta({
                vaultId: vault.id,
                operations: [
                    { type: 'node_upsert', payload: source as unknown as Record<string, unknown> },
                    { type: 'node_upsert', payload: target as unknown as Record<string, unknown> },
                ],
            });
            await engineB.applySyncDelta(seedNodesDelta);
            await engineC.applySyncDelta(seedNodesDelta);
            const seedEdgeDelta = engineA.buildSyncDelta({
                vaultId: vault.id,
                operations: [{ type: 'edge_upsert', payload: baseEdge as unknown as Record<string, unknown> }],
            });
            await engineB.applySyncDelta(seedEdgeDelta);
            await engineC.applySyncDelta(seedEdgeDelta);

            const updateFromB = {
                ...baseEdge,
                weight: 0.9,
                confidence: 0.9,
                updatedAt: baseEdge.updatedAt + 10,
            };
            const updateFromC = {
                ...baseEdge,
                weight: 0.2,
                confidence: 0.4,
                updatedAt: baseEdge.updatedAt + 20,
            };

            const deltaB = engineB.buildSyncDelta({
                vaultId: vault.id,
                operations: [{ type: 'edge_upsert', payload: updateFromB as unknown as Record<string, unknown> }],
            });
            const deltaC = engineC.buildSyncDelta({
                vaultId: vault.id,
                operations: [{ type: 'edge_upsert', payload: updateFromC as unknown as Record<string, unknown> }],
            });

            const engines = [engineA, engineB, engineC];
            for (const peer of engines) {
                await peer.applySyncDelta(deltaB);
                await peer.applySyncDelta(deltaC);
            }

            const edgeA = storageA.getPersonaEdge(baseEdge.id);
            const edgeB = storageB.getPersonaEdge(baseEdge.id);
            const edgeC = storageC.getPersonaEdge(baseEdge.id);
            expect(edgeA).toBeDefined();
            expect(edgeB).toBeDefined();
            expect(edgeC).toBeDefined();
            expect(edgeA.confidence).toBeCloseTo(edgeB.confidence, 6);
            expect(edgeB.confidence).toBeCloseTo(edgeC.confidence, 6);
            expect(edgeA.weight).toBeCloseTo(edgeB.weight, 6);
            expect(edgeB.weight).toBeCloseTo(edgeC.weight, 6);
        } finally {
            storageC.close();
        }
    });
});
