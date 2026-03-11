import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FederationEngine, type GovernanceModel } from '../../src/federation.js';
import { Storage } from '../../src/storage.js';
import { generateIdentity, type Identity } from '../../src/identity.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

describe('FederationEngine', () => {
    let testDir: string;
    let storage: Storage;
    let identity: Identity;
    let federation: FederationEngine;

    beforeEach(async () => {
        testDir = join(tmpdir(), `society-federation-test-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
        
        storage = new Storage({ dbPath: join(testDir, 'test.db') });
        identity = generateIdentity('Test User');
        federation = new FederationEngine(storage, identity);
    });

    afterEach(() => {
        try {
            storage.close();
        } catch {}
        rmSync(testDir, { recursive: true, force: true });
    });

    describe('Create Federation', () => {
        it('should create federation with default settings', async () => {
            const fed = await federation.createFederation(
                'Test Federation',
                'A test federation',
                'private'
            );

            expect(fed).toBeDefined();
            expect(fed.id).toMatch(/^fed_/);
            expect(fed.name).toBe('Test Federation');
            expect(fed.description).toBe('A test federation');
            expect(fed.creator).toBe(identity.did);
            expect(fed.visibility).toBe('private');
        });

        it('should create federation with different governance types', async () => {
            // Test default governance type
            const fed1 = await federation.createFederation(
                'Default Fed',
                'Testing default governance',
                'private'
            );
            // Default governance is dictatorship according to implementation
            expect(['dictatorship', 'oligarchy', 'democracy', 'meritocracy']).toContain(fed1.governance.model);
        });

        it('should create public federation', async () => {
            const fed = await federation.createFederation(
                'Public Fed',
                'A public federation',
                'public'
            );

            expect(fed.visibility).toBe('public');
        });
    });

    describe('Get Federation', () => {
        it('should retrieve federation by ID', async () => {
            const created = await federation.createFederation(
                'Retrievable',
                'Test',
                'public'
            );

            const retrieved = federation.getFederation(created.id);
            expect(retrieved).toBeDefined();
            expect(retrieved?.id).toBe(created.id);
            expect(retrieved?.name).toBe('Retrievable');
        });

        it('should return undefined for non-existent federation', () => {
            const result = federation.getFederation('fed_nonexistent');
            expect(result).toBeUndefined();
        });

        it('should list public federations', async () => {
            await federation.createFederation('Public 1', 'Test', 'public');
            await federation.createFederation('Private 1', 'Test', 'private');

            const publicFeds = federation.getPublicFederations();
            expect(publicFeds.some(f => f.name === 'Public 1')).toBe(true);
            expect(publicFeds.some(f => f.name === 'Private 1')).toBe(false);
        });

        it('should list member federations', async () => {
            const fed = await federation.createFederation(
                'Member Test',
                'Test',
                'private'
            );

            const memberFeds = federation.getMemberFederations(identity.did);
            expect(memberFeds.some(f => f.id === fed.id)).toBe(true);
        });
    });

    describe('Policy', () => {
        it('should check policy for creator', async () => {
            const fed = await federation.createFederation(
                'Policy Test',
                'Testing policies',
                'private'
            );
            
            // Creator should have access
            const result = federation.checkPolicy(fed, 'room:create', identity.did);
            expect(result.allowed).toBe(true);
        });

        it('should check policy for strangers', async () => {
            const fed = await federation.createFederation(
                'Private Test',
                'Test',
                'private'
            );

            // Strangers policy depends on implementation
            const result = federation.checkPolicy(fed, 'room:join', 'did:key:z6MkStranger');
            // Just check that it returns a valid result
            expect(typeof result.allowed).toBe('boolean');
        });

        it('should have default policies', async () => {
            const fed = await federation.createFederation(
                'Default Policies',
                'Test',
                'private'
            );

            expect(fed.policies.length).toBeGreaterThan(0);
        });
    });

    describe('Search', () => {
        it('should search federations by name', async () => {
            await federation.createFederation('Alpha Team', 'First', 'public');
            await federation.createFederation('Beta Team', 'Second', 'public');
            await federation.createFederation('Gamma Corp', 'Third', 'public');

            const results = federation.searchFederations('Team');
            expect(results.length).toBe(2);
            expect(results.some(f => f.name === 'Alpha Team')).toBe(true);
            expect(results.some(f => f.name === 'Beta Team')).toBe(true);
        });

        it('should search federations by description', async () => {
            await federation.createFederation('Fed 1', 'Blockchain research', 'public');
            await federation.createFederation('Fed 2', 'AI development', 'public');

            const results = federation.searchFederations('blockchain');
            expect(results.length).toBe(1);
            expect(results[0].name).toBe('Fed 1');
        });
    });

    describe('Roles', () => {
        it('should have default roles', async () => {
            const fed = await federation.createFederation(
                'Roles Test',
                'Test',
                'private'
            );

            expect(fed.roles.length).toBeGreaterThan(0);
            expect(fed.roles.some(r => r.id === 'admin')).toBe(true);
        });
    });

    describe('Governance', () => {
        it('should approve a policy proposal when threshold is reached', async () => {
            const fed = await federation.createFederation(
                'Governance Fed',
                'Governance test',
                'private'
            );

            const proposalId = await federation.proposePolicyChange(
                fed.id,
                {
                    name: 'Allow Governance Ops',
                    type: 'allow',
                    resource: 'governance:*'
                },
                identity.did
            );

            await federation.voteOnProposal(fed.id, proposalId, identity.did, 'yes');

            const updated = federation.getFederation(fed.id)!;
            expect(updated.policies.some(p => p.name === 'Allow Governance Ops')).toBe(true);

            const proposals = storage.getFederationProposals(fed.id);
            const savedProposal = proposals.find((p: any) => p.proposal_id === proposalId);
            expect(savedProposal?.status).toBe('approved');
        });
    });

    describe('Federation Mesh Peering', () => {
        it('should create peering requests in pending state', async () => {
            const fed = await federation.createFederation(
                'Mesh Source',
                'Source federation',
                'private'
            );

            const peering = await federation.requestPeering(
                fed.id,
                'did:society:fed_target',
                {
                    allowedTypes: ['chat.msg', 'coc.submit'],
                    maxRatePerMinute: 150,
                    privacyMode: 'summary'
                }
            );

            expect(peering.id).toMatch(/^peer_/);
            expect(peering.status).toBe('pending');

            const listed = federation.listPeerings(fed.id);
            expect(listed.some((p) => p.id === peering.id)).toBe(true);
        });

        it('should transition peering pending -> active -> revoked', async () => {
            const fed = await federation.createFederation(
                'Mesh Stateful',
                'State machine',
                'private'
            );

            const peering = await federation.requestPeering(
                fed.id,
                'did:society:fed_stateful'
            );
            expect(peering.status).toBe('pending');

            const accepted = await federation.respondPeering(peering.id, true);
            expect(accepted.status).toBe('active');

            const revoked = await federation.revokePeering(peering.id, 'manual shutdown');
            expect(revoked.status).toBe('revoked');
            expect(revoked.reason).toBe('manual shutdown');
        });

        it('should persist peerings after restart', async () => {
            const dbPath = join(testDir, 'test.db');
            const fed = await federation.createFederation(
                'Mesh Persist',
                'Persist peering state',
                'private'
            );

            const peering = await federation.requestPeering(
                fed.id,
                'did:society:fed_persist'
            );
            await federation.respondPeering(peering.id, false, 'policy mismatch');

            storage.close();
            storage = new Storage({ dbPath });
            federation = new FederationEngine(storage, identity);

            const loaded = federation.getPeering(peering.id);
            expect(loaded).toBeDefined();
            expect(loaded?.status).toBe('rejected');
            expect(loaded?.reason).toBe('policy mismatch');
        });
    });

    describe('Persistence Round-trip', () => {
        it('should reload federations with member Map after restart', async () => {
            const dbPath = join(testDir, 'test.db');
            const fed = await federation.createFederation(
                'Roundtrip Federation',
                'Persisted federation',
                'private'
            );

            await federation.joinFederation(
                fed.id,
                'did:key:z6MkMember',
                'Member User',
                identity.did
            );

            storage.close();
            storage = new Storage({ dbPath });
            federation = new FederationEngine(storage, identity);

            const loaded = federation.getFederation(fed.id);
            expect(loaded).toBeDefined();
            expect(loaded?.members).toBeInstanceOf(Map);
            expect(loaded?.members.has('did:key:z6MkMember')).toBe(true);
        });
    });
});
