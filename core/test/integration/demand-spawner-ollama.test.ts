/**
 * Society Protocol — Demand-Driven Agent Spawning Integration Test
 *
 * This test connects REAL Ollama agents via Society Protocol's
 * DemandSpawner + CapabilityRouter + SwarmController + SocialEngine.
 *
 * Requirements:
 *   - Ollama running locally (ollama serve)
 *   - Model "qwen3:1.7b" pulled (ollama pull qwen3:1.7b)
 *
 * What it tests (end-to-end):
 *   1. CapabilityRouter analyzes a request and determines complexity/roles
 *   2. DemandSpawner assembles a team of ephemeral Ollama agents
 *   3. Each agent executes its role via real Ollama LLM calls
 *   4. Results are collected and team is dissolved
 *   5. SocialEngine manages profiles, follows, invites, and activity feed
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Storage } from '../../src/storage.js';
import { generateIdentity, type Identity } from '../../src/identity.js';
import { RoomManager } from '../../src/rooms.js';
import { CocEngine } from '../../src/coc.js';
import { ReputationEngine } from '../../src/reputation.js';
import { P2PSwarmRegistry } from '../../src/proactive/swarm-registry.js';
import { CapabilityRouter, type IncomingRequest } from '../../src/gateway/capability-router.js';
import { DemandSpawner } from '../../src/gateway/demand-spawner.js';
import { SocialEngine } from '../../src/social.js';

/** Minimal RoomManager mock that satisfies CocEngine's EventEmitter needs */
function createMockRooms(): any {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
        joinRoom: () => {},
        leaveRoom: () => {},
        publish: () => {},
        getMembers: () => [],
    });
}

// ─── Helpers ────────────────────────────────────────────────────

async function isOllamaAvailable(): Promise<boolean> {
    try {
        const res = await fetch('http://localhost:11434/api/tags');
        return res.ok;
    } catch {
        return false;
    }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('CapabilityRouter', () => {
    let router: CapabilityRouter;

    beforeEach(() => {
        router = new CapabilityRouter();
    });

    it('routes simple tasks as single-agent', () => {
        const decision = router.route({
            goal: 'Summarize this text',
        });
        expect(decision.mode).toBe('single-agent');
        expect(decision.complexity).toBeLessThan(0.3);
        expect(decision.roles.length).toBeGreaterThanOrEqual(1);
    });

    it('routes medium tasks to pool selection', () => {
        const decision = router.route({
            goal: 'Research and analyze the latest papers on multi-agent systems, then write a report',
        });
        expect(decision.complexity).toBeGreaterThan(0.3);
        expect(decision.roles.length).toBeGreaterThanOrEqual(2);
        expect(decision.roles.some(r => r.role === 'researcher')).toBe(true);
        expect(decision.roles.some(r => r.role === 'writer')).toBe(true);
    });

    it('routes complex tasks to spawn-team', () => {
        const decision = router.route({
            goal: 'Design and implement a distributed database architecture with benchmarks, code review, and comprehensive testing. Also analyze performance metrics and create documentation.',
            priority: 'critical',
            requiredCapabilities: ['code-generation', 'data-analysis'],
        });
        expect(decision.mode).toBe('spawn-team');
        expect(decision.complexity).toBeGreaterThan(0.6);
        expect(decision.roles.length).toBeGreaterThanOrEqual(3);
    });

    it('detects multiple roles from request text', () => {
        const decision = router.route({
            goal: 'Research this topic, write code to process data, review the results, and synthesize a final report',
        });
        const roleNames = decision.roles.map(r => r.role);
        expect(roleNames).toContain('researcher');
        expect(roleNames).toContain('coder');
        expect(roleNames).toContain('reviewer');
    });

    it('adds reviewer role for high-complexity tasks', () => {
        const decision = router.route({
            goal: 'Design a complex distributed system architecture with code implementation and performance benchmarks',
            priority: 'critical',
        });
        expect(decision.roles.some(r => r.kind === 'review')).toBe(true);
    });
});

describe('SocialEngine', () => {
    let storage: Storage;
    let identity: Identity;
    let social: SocialEngine;

    beforeEach(() => {
        storage = new Storage({ dbPath: ':memory:' });
        identity = generateIdentity('Alice');
        social = new SocialEngine(storage, identity);
    });

    afterEach(() => {
        social.destroy();
    });

    it('creates and retrieves agent profiles', () => {
        const profile = social.upsertProfile({
            did: identity.did,
            displayName: 'Alice',
            bio: 'AI researcher',
            specialties: ['machine-learning', 'nlp'],
            tags: ['researcher'],
        });

        expect(profile.displayName).toBe('Alice');
        expect(profile.bio).toBe('AI researcher');
        expect(profile.specialties).toContain('machine-learning');

        const retrieved = social.getProfile(identity.did);
        expect(retrieved?.displayName).toBe('Alice');
    });

    it('searches profiles by name and specialty', () => {
        social.upsertProfile({ did: 'did:key:1', displayName: 'Alice', specialties: ['ml'] });
        social.upsertProfile({ did: 'did:key:2', displayName: 'Bob', specialties: ['frontend'] });
        social.upsertProfile({ did: 'did:key:3', displayName: 'Charlie', specialties: ['ml', 'nlp'] });

        const mlAgents = social.searchProfiles('ml');
        expect(mlAgents.length).toBe(2);
        expect(mlAgents.map(p => p.displayName)).toContain('Alice');
        expect(mlAgents.map(p => p.displayName)).toContain('Charlie');
    });

    it('follows and unfollows agents', () => {
        const alice = 'did:key:alice';
        const bob = 'did:key:bob';

        social.upsertProfile({ did: alice, displayName: 'Alice' });
        social.upsertProfile({ did: bob, displayName: 'Bob' });

        // Follow
        social.follow(alice, bob);
        expect(social.isFollowing(alice, bob)).toBe(true);
        expect(social.getFollowerCount(bob)).toBe(1);
        expect(social.getFollowingCount(alice)).toBe(1);

        const following = social.getFollowing(alice);
        expect(following.length).toBe(1);
        expect(following[0].displayName).toBe('Bob');

        const followers = social.getFollowers(bob);
        expect(followers.length).toBe(1);
        expect(followers[0].displayName).toBe('Alice');

        // Unfollow
        social.unfollow(alice, bob);
        expect(social.isFollowing(alice, bob)).toBe(false);
        expect(social.getFollowerCount(bob)).toBe(0);
    });

    it('prevents self-follow', () => {
        expect(() => social.follow('did:key:a', 'did:key:a')).toThrow('Cannot follow yourself');
    });

    it('generates and redeems invite codes', () => {
        const invite = social.generateInvite({
            type: 'federation',
            targetId: 'fed_123',
            creatorDid: identity.did,
            maxUses: 3,
        });

        expect(invite.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/);
        expect(invite.type).toBe('federation');
        expect(invite.maxUses).toBe(3);
        expect(invite.usedCount).toBe(0);

        // Redeem
        const result = social.redeemInvite(invite.code, 'did:key:bob');
        expect(result.type).toBe('federation');
        expect(result.targetId).toBe('fed_123');

        // Check used count
        const updated = social.getInvite(invite.code);
        expect(updated?.usedCount).toBe(1);

        // Redeem 2 more times
        social.redeemInvite(invite.code, 'did:key:charlie');
        social.redeemInvite(invite.code, 'did:key:dave');

        // Should fail on 4th use
        expect(() => social.redeemInvite(invite.code, 'did:key:eve')).toThrow('max uses');
    });

    it('handles invite expiration', () => {
        const invite = social.generateInvite({
            type: 'room',
            targetId: 'room_test',
            creatorDid: identity.did,
            expiresInMs: -1000, // Already expired
        });

        expect(() => social.redeemInvite(invite.code, 'did:key:bob')).toThrow('expired');
    });

    it('revokes invite codes', () => {
        const invite = social.generateInvite({
            type: 'federation',
            targetId: 'fed_456',
            creatorDid: identity.did,
        });

        social.revokeInvite(invite.code, identity.did);
        expect(() => social.redeemInvite(invite.code, 'did:key:bob')).toThrow('Invalid');
    });

    it('tracks activity feed', () => {
        const alice = 'did:key:alice';
        const bob = 'did:key:bob';

        social.upsertProfile({ did: alice, displayName: 'Alice' });
        social.upsertProfile({ did: bob, displayName: 'Bob' });

        social.follow(alice, bob);

        // Bob does some activities
        social.recordActivity('completed_task', bob, 'Bob', 'chain_1', 'Build API');
        social.recordActivity('earned_reputation', bob, 'Bob');

        // Alice's feed should show Bob's activities
        const feed = social.getFeed(alice);
        expect(feed.length).toBeGreaterThanOrEqual(2);
        expect(feed.some(a => a.type === 'completed_task')).toBe(true);
    });

    it('persists data across instances', () => {
        social.upsertProfile({ did: 'did:key:test', displayName: 'Test' });
        social.follow('did:key:a', 'did:key:test');

        // Create new SocialEngine on same storage
        const social2 = new SocialEngine(storage, identity);
        expect(social2.getProfile('did:key:test')?.displayName).toBe('Test');
        expect(social2.isFollowing('did:key:a', 'did:key:test')).toBe(true);
        social2.destroy();
    });
});

describe('DemandSpawner + Ollama (Real LLM)', () => {
    let storage: Storage;
    let identity: Identity;
    let rooms: RoomManager;
    let coc: CocEngine;
    let reputation: ReputationEngine;
    let registry: P2PSwarmRegistry;
    let spawner: DemandSpawner;

    beforeEach(async () => {
        storage = new Storage({ dbPath: ':memory:' });
        identity = generateIdentity('Orchestrator');
        // Save identity to satisfy FK constraints
        const privHex = Buffer.from(identity.privateKey).toString('hex');
        const pubHex = Buffer.from(identity.publicKey).toString('hex');
        storage.saveIdentity(identity.did, privHex, pubHex, identity.displayName);
        reputation = new ReputationEngine(storage);
        rooms = createMockRooms();
        coc = new CocEngine(identity, rooms, storage, reputation);
        registry = { getVisibleWorkers: () => [] } as any;
        spawner = new DemandSpawner(storage, rooms, coc, registry, {
            ollamaModel: 'qwen3:1.7b',
            taskTimeoutMs: 60_000,
        }, identity);
    });

    afterEach(() => {
        spawner?.destroy();
    });

    it('assembles and executes a single-agent task via Ollama', async () => {
        const available = await isOllamaAvailable();
        if (!available) {
            console.log('⚠️  Skipping: Ollama not available');
            return;
        }

        const events: string[] = [];
        spawner.on('request:routed', () => events.push('routed'));
        spawner.on('team:assembled', () => events.push('assembled'));
        spawner.on('agent:spawned', () => events.push('spawned'));
        spawner.on('agent:working', () => events.push('working'));
        spawner.on('agent:done', () => events.push('done'));
        spawner.on('team:completed', () => events.push('completed'));

        const result = await spawner.handleRequest({
            goal: 'What is 2+2? Answer in one word.',
            roomId: 'test-room',
        });

        expect(result.status).toBe('completed');
        expect(result.teamId).toBeTruthy();
        expect(result.chainId).toBeTruthy();
        expect(result.agents.length).toBeGreaterThanOrEqual(1);
        expect(result.durationMs).toBeGreaterThan(0);

        // Check events fired
        expect(events).toContain('routed');
        expect(events).toContain('assembled');
        expect(events).toContain('completed');

        // Check result contains LLM response
        const values = Object.values(result.results);
        expect(values.length).toBeGreaterThan(0);
        const responseText = JSON.stringify(values);
        expect(responseText.length).toBeGreaterThan(0);

        console.log('✅ Single-agent result:', JSON.stringify(result.results, null, 2));
    }, 120_000);

    it('spawns multi-agent swarm for complex research task', async () => {
        const available = await isOllamaAvailable();
        if (!available) {
            console.log('⚠️  Skipping: Ollama not available');
            return;
        }

        const result = await spawner.handleRequest({
            goal: 'Research the concept of distributed consensus algorithms. Then write a brief code example in pseudocode. Finally review the code for correctness.',
            roomId: 'research-room',
            priority: 'high',
        });

        expect(result.status).toBe('completed');
        expect(result.agents.length).toBeGreaterThanOrEqual(2);

        // Should have multiple roles
        const roles = result.agents.map(a => a.role);
        expect(roles.length).toBeGreaterThanOrEqual(2);

        console.log('✅ Multi-agent swarm result:');
        console.log('  Agents:', result.agents.map(a => `${a.role} (${a.runtime})`).join(', '));
        console.log('  Duration:', result.durationMs, 'ms');
        for (const [role, res] of Object.entries(result.results)) {
            const preview = typeof res === 'string' ? res.slice(0, 100) : JSON.stringify(res).slice(0, 100);
            console.log(`  ${role}: ${preview}...`);
        }
    }, 300_000);
});

describe('Full E2E: Social + DemandSpawner + Ollama', () => {
    it('complete workflow: profiles → follow → invite → spawn team → activity feed', async () => {
        const available = await isOllamaAvailable();
        if (!available) {
            console.log('⚠️  Skipping: Ollama not available');
            return;
        }

        // 1. Setup
        const storage = new Storage({ dbPath: ':memory:' });
        const alice = generateIdentity('Alice');
        const bob = generateIdentity('Bob');
        // Save identities for FK constraints
        storage.saveIdentity(alice.did, Buffer.from(alice.privateKey).toString('hex'),
            Buffer.from(alice.publicKey).toString('hex'), alice.displayName);
        storage.saveIdentity(bob.did, Buffer.from(bob.privateKey).toString('hex'),
            Buffer.from(bob.publicKey).toString('hex'), bob.displayName);
        const social = new SocialEngine(storage, alice);
        const reputation = new ReputationEngine(storage);
        const rooms = createMockRooms();
        const coc = new CocEngine(alice, rooms, storage, reputation);
        const registry = { getVisibleWorkers: () => [] } as any;
        const spawner = new DemandSpawner(storage, rooms, coc, registry, {
            ollamaModel: 'qwen3:1.7b',
            taskTimeoutMs: 60_000,
        }, alice);

        // 2. Create profiles
        social.upsertProfile({
            did: alice.did,
            displayName: 'Alice',
            bio: 'AI Researcher & Orchestrator',
            specialties: ['machine-learning', 'distributed-systems'],
            tags: ['researcher', 'leader'],
        });

        social.upsertProfile({
            did: bob.did,
            displayName: 'Bob',
            bio: 'Full-stack Developer',
            specialties: ['typescript', 'rust', 'api-design'],
            tags: ['coder', 'reviewer'],
        });

        // 3. Bob follows Alice
        social.follow(bob.did, alice.did);
        expect(social.isFollowing(bob.did, alice.did)).toBe(true);

        // 4. Alice creates invite for federation
        const invite = social.generateInvite({
            type: 'federation',
            targetId: 'fed_research',
            creatorDid: alice.did,
            maxUses: 10,
            role: 'member',
        });

        // 5. Bob redeems invite
        const redemption = social.redeemInvite(invite.code, bob.did);
        expect(redemption.type).toBe('federation');
        expect(redemption.targetId).toBe('fed_research');

        // 6. Alice spawns a team via DemandSpawner
        social.recordActivity('started_mission', alice.did, 'Alice', 'mission_1', 'Research AI safety');

        const result = await spawner.handleRequest({
            goal: 'Explain what AI safety means in one sentence.',
            roomId: 'research-room',
            callerDid: alice.did,
        });

        expect(result.status).toBe('completed');

        // 7. Record task completion in social
        social.recordActivity('completed_task', alice.did, 'Alice', result.chainId, 'AI Safety Research');

        // 8. Check Bob's feed (follows Alice)
        const bobFeed = social.getFeed(bob.did);
        expect(bobFeed.some(a => a.type === 'started_mission')).toBe(true);
        expect(bobFeed.some(a => a.type === 'completed_task')).toBe(true);

        // 9. Check global feed
        const globalFeed = social.getGlobalFeed();
        expect(globalFeed.length).toBeGreaterThan(0);

        console.log('✅ Full E2E passed!');
        console.log('  Profiles:', social.listProfiles().map(p => p.displayName));
        console.log('  Alice followers:', social.getFollowerCount(alice.did));
        console.log('  Invite used:', social.getInvite(invite.code)?.usedCount, '/', invite.maxUses);
        console.log('  Bob feed items:', bobFeed.length);
        console.log('  Team result:', result.status, '— agents:', result.agents.length);

        spawner.destroy();
        social.destroy();
    }, 120_000);
});
