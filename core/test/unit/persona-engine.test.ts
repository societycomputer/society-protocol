import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { Storage } from '../../src/storage.js';
import { generateIdentity, type Identity } from '../../src/identity.js';
import { SecurityManager } from '../../src/security.js';
import { PersonaVaultEngine } from '../../src/persona/index.js';

describe('PersonaVaultEngine', () => {
    let testDir: string;
    let storage: Storage;
    let identity: Identity;
    let engine: PersonaVaultEngine;

    beforeEach(() => {
        testDir = join(tmpdir(), `society-persona-test-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
        storage = new Storage({ dbPath: join(testDir, 'test.db') });
        identity = generateIdentity('Persona Tester');
        engine = new PersonaVaultEngine(storage, identity.did, {
            defaultVaultName: 'Test Persona Vault',
        });
    });

    afterEach(() => {
        try {
            storage.close();
        } catch {}
        rmSync(testDir, { recursive: true, force: true });
    });

    it('creates vault and adds/query memories', async () => {
        const vault = await engine.createVault({ name: 'My Vault' });
        const node = await engine.addMemory({
            vaultId: vault.id,
            domain: 'general',
            type: 'memory',
            title: 'Trip to Kyoto',
            content: 'I loved walking in Gion at night',
            tags: ['travel', 'kyoto'],
            confidence: 0.95,
        });

        expect(node.id).toMatch(/^pmem_/);
        const result = await engine.queryMemories({ vaultId: vault.id, query: 'kyoto', limit: 10 });
        expect(result.nodes.length).toBeGreaterThan(0);
        expect(result.nodes[0].title).toContain('Kyoto');
    });

    it('updates and soft deletes memory', async () => {
        const node = await engine.addMemory({
            domain: 'work',
            type: 'event',
            title: 'Project kickoff',
            content: 'Kickoff with Sarah and team',
        });

        const updated = await engine.updateMemory(node.id, {
            content: 'Kickoff with Sarah, team and architecture decisions',
            tags: ['project', 'architecture'],
        });
        expect(updated.content).toContain('architecture');

        await engine.deleteMemory(node.id, 'cleanup');
        const result = await engine.queryMemories({ query: 'kickoff', includeDeleted: false });
        expect(result.nodes.find((n) => n.id === node.id)).toBeUndefined();
    });

    it('stores preferences and graph links', async () => {
        const pref = await engine.updatePreference({
            key: 'theme',
            value: 'dark',
            domain: 'preferences',
        });
        const memory = await engine.addMemory({
            domain: 'general',
            type: 'event',
            title: 'UI settings',
            content: 'Changed app theme to dark mode',
        });

        const edge = await engine.linkMemories({
            sourceNodeId: memory.id,
            targetNodeId: pref.id,
            type: 'preferred_by',
            confidence: 0.9,
        });

        expect(edge.id).toMatch(/^pedge_/);
        const graph = await engine.queryGraph({ rootNodeId: memory.id, maxDepth: 2 });
        expect(graph.nodes.some((n) => n.id === pref.id)).toBe(true);
        expect(graph.edges.some((e) => e.id === edge.id)).toBe(true);
    });

    it('issues, validates and revokes capabilities', async () => {
        const cap = await engine.issueCapability({
            serviceDid: 'did:key:z6MkService',
            scope: 'persona:read',
            caveats: {
                operations: ['read'],
                domains: ['preferences', 'general'],
                expiresAt: Date.now() + 60_000,
            },
        });

        const valid = engine.validateCapability({
            token: cap.token,
            operation: 'read',
            domain: 'preferences',
        });
        expect(valid.allowed).toBe(true);

        await engine.revokeCapability(cap.id, 'manual revoke');
        const revoked = engine.validateCapability({
            token: cap.token,
            operation: 'read',
            domain: 'preferences',
        });
        expect(revoked.allowed).toBe(false);
    });

    it('attenuates capabilities with stricter caveats', async () => {
        const cap = await engine.issueCapability({
            serviceDid: 'did:key:z6MkService',
            scope: 'persona:read',
            caveats: {
                operations: ['read', 'write'],
                domains: ['general', 'work'],
                limit: 50,
            },
        });

        const child = await engine.attenuateCapability({
            tokenId: cap.id,
            caveatsPatch: {
                operations: ['read'],
                domains: ['general'],
                limit: 10,
            },
        });

        expect(child.parentTokenId).toBe(cap.id);
        const allowedRead = engine.validateCapability({
            token: child.token,
            operation: 'read',
            domain: 'general',
        });
        expect(allowedRead.allowed).toBe(true);

        const deniedWrite = engine.validateCapability({
            token: child.token,
            operation: 'write',
            domain: 'general',
        });
        expect(deniedWrite.allowed).toBe(false);
    });

    it('issues/revokes claims and verifies ZKP bundles', async () => {
        const vault = await engine.createVault({ name: 'Claims Vault' });
        const claim = await engine.issueClaim({
            vaultId: vault.id,
            schema: 'domain-membership',
            payload: { domain: 'work', role: 'member' },
        });

        const loaded = await engine.getClaim(claim.id);
        expect(loaded?.schema).toBe('domain-membership');
        expect(loaded?.status).toBe('active');

        const proof = await engine.generateZkProof({
            vaultId: vault.id,
            circuitId: 'domain_membership',
            privateInputs: { membershipClaimSecret: 'secret' },
            publicInputs: { domain: 'work', subjectDid: identity.did },
            claimIds: [claim.id],
            expiresAt: Date.now() + 10_000,
        });
        const verified = await engine.verifyZkProof({ vaultId: vault.id, proofBundle: proof });
        expect(verified.valid).toBe(true);

        const tampered = {
            ...proof,
            publicInputs: { ...proof.publicInputs, domain: 'finance' },
        };
        const tamperedCheck = await engine.verifyZkProof({ vaultId: vault.id, proofBundle: tampered });
        expect(tamperedCheck.valid).toBe(false);

        const expired = await engine.generateZkProof({
            vaultId: vault.id,
            circuitId: 'age_over_18',
            privateInputs: { dob: '1990-01-01' },
            publicInputs: { minAge: 18, referenceDate: '2026-03-05', subjectDid: identity.did },
            expiresAt: Date.now() - 1,
        });
        const expiredCheck = await engine.verifyZkProof({ vaultId: vault.id, proofBundle: expired });
        expect(expiredCheck.valid).toBe(false);

        await engine.revokeClaim(claim.id, 'test revoke');
        const revoked = await engine.getClaim(claim.id);
        expect(revoked?.status).toBe('revoked');
    });

    it('rejects invalid issuer signature for claim', async () => {
        const issuer = generateIdentity('Issuer');
        await expect(
            engine.issueClaim({
                schema: 'employment-attestation',
                payload: { company: 'Acme' },
                issuerDid: issuer.did,
                issuerSignature: 'invalid-signature',
            })
        ).rejects.toThrow();
    });

    it('verifies signed access log and rejects tampered records', async () => {
        const vault = await engine.createVault({ name: 'Audit Vault' });
        const security = new SecurityManager(identity);
        const ts = Date.now();
        const payload = JSON.stringify({
            vaultId: vault.id,
            tokenId: null,
            serviceDid: identity.did,
            operation: 'read',
            resource: 'persona://profile',
            result: 'allowed',
            details: null,
            ts,
        });
        const signature = Buffer.from(
            await security.sign(new TextEncoder().encode(payload))
        ).toString('base64');

        storage.appendPersonaAccessLog({
            vaultId: vault.id,
            serviceDid: identity.did,
            operation: 'read',
            resource: 'persona://profile',
            result: 'allowed',
            ts,
            signature,
            signerDid: identity.did,
            sigAlg: 'ed25519',
        });

        const log = storage.listPersonaAccessLogs(vault.id, 1)[0];
        const verified = await engine.verifyPersonaAccessLog({ logId: log.id! });
        expect(verified.valid).toBe(true);

        (storage as any).db.prepare('UPDATE persona_access_log SET resource = ? WHERE id = ?').run('persona://tampered', log.id);
        const tampered = await engine.verifyPersonaAccessLog({ logId: log.id! });
        expect(tampered.valid).toBe(false);
    });

    it('runs retention sweep with dry-run and deletion modes', async () => {
        const vault = await engine.createVault({ name: 'Retention Vault' });
        const stale = await engine.addMemory({
            vaultId: vault.id,
            domain: 'general',
            type: 'memory',
            title: 'Old memory',
            content: 'To be deleted by retention',
        });

        const oldTs = Date.now() - 4_100 * 24 * 60 * 60 * 1000;
        storage.upsertPersonaNode({
            ...stale,
            createdAt: oldTs,
            updatedAt: oldTs,
        });

        const dryRun = await engine.runRetentionSweep({
            vaultId: vault.id,
            domain: 'general',
            dryRun: true,
        });
        expect(dryRun.scanned).toBeGreaterThan(0);
        expect(dryRun.deleted).toBe(0);

        const execute = await engine.runRetentionSweep({
            vaultId: vault.id,
            domain: 'general',
            dryRun: false,
        });
        expect(execute.deleted).toBeGreaterThan(0);
        const after = await engine.queryMemories({
            vaultId: vault.id,
            query: 'Old memory',
            includeDeleted: false,
        });
        expect(after.nodes.some((n) => n.id === stale.id)).toBe(false);

        const retention = storage.getPersonaRetentionState(vault.id, 'general');
        expect(retention).toBeDefined();
    });

    it('persists graph cache and metrics during retrieval', async () => {
        const vault = await engine.createVault({ name: 'Retrieval Cache Vault' });
        await engine.addMemory({
            vaultId: vault.id,
            domain: 'general',
            type: 'memory',
            title: 'Cache candidate A',
            content: 'Topic graph ranking and retrieval latency',
        });
        await engine.addMemory({
            vaultId: vault.id,
            domain: 'general',
            type: 'memory',
            title: 'Cache candidate B',
            content: 'Another memory for graph score weighting',
        });
        const result = await engine.queryMemories({
            vaultId: vault.id,
            query: 'graph retrieval',
            domain: 'general',
            limit: 10,
        });
        expect(result.nodes.length).toBeGreaterThan(0);

        const nodes = storage.listPersonaNodes(vault.id, { includeDeleted: false, domain: 'general' });
        const edges = storage.listPersonaEdges(vault.id);
        const maxNodeUpdatedAt = nodes.reduce((acc, node) => Math.max(acc, node.updatedAt || 0), 0);
        const maxEdgeUpdatedAt = edges.reduce((acc, edge) => Math.max(acc, edge.updatedAt || 0), 0);
        const version = `${nodes.length}:${edges.length}:${maxNodeUpdatedAt}:${maxEdgeUpdatedAt}`;
        const graphCache = storage.getPersonaGraphCache(vault.id, 'general', version);
        expect(graphCache).toBeDefined();
        expect(Object.keys(graphCache!.ppr).length).toBeGreaterThan(0);

        const latencyMetrics = storage.listPersonaMetrics('persona.query.latency_ms', 5);
        expect(latencyMetrics.length).toBeGreaterThan(0);
    });

    it('applies operation-aware redaction when exporting subgraphs', async () => {
        const vault = await engine.createVault({ name: 'Redaction Vault' });
        const node = await engine.addMemory({
            vaultId: vault.id,
            domain: 'finance',
            type: 'memory',
            title: 'Bank statement',
            content: 'Account 12345, balance 9988',
            metadata: {
                account: '12345',
                balance: 9988,
                card: '4111111111111111',
                iban: 'DE02100100101234567895',
            },
        });

        const exported = await engine.exportSubgraph({
            vaultId: vault.id,
            nodeIds: [node.id],
            redactionOperation: 'export',
        });
        expect(exported.nodes).toHaveLength(1);
        expect(exported.nodes[0].content).toBe('[REDACTED]');
        expect((exported.nodes[0].metadata as any).account).toBe('[REDACTED]');
        expect((exported.nodes[0].metadata as any).iban).toBe('[REDACTED]');
    });
});
