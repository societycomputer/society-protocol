import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';
import { Storage } from '../../src/storage.js';
import { SwarmScheduler } from '../../src/proactive/scheduler.js';

describe('Proactive Mission Stack', () => {
    let testDir: string;
    let storage: Storage;

    beforeEach(() => {
        testDir = join(tmpdir(), `society-proactive-test-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
        storage = new Storage({ dbPath: join(testDir, 'test.db') });
    });

    afterEach(() => {
        try {
            storage.close();
        } catch {}
        rmSync(testDir, { recursive: true, force: true });
    });

    it('creates proactive mission tables', () => {
        const tables = storage.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
        const names = tables.map((entry) => entry.name);
        expect(names).toContain('proactive_missions');
        expect(names).toContain('mission_runs');
        expect(names).toContain('mission_checkpoints');
        expect(names).toContain('mission_events');
        expect(names).toContain('mission_leases');
        expect(names).toContain('swarm_workers');
        expect(names).toContain('research_artifacts');
    });

    it('stores and restores proactive missions', () => {
        storage.createMission({
            missionId: 'mission_test',
            roomId: 'lab',
            goal: 'Track scientific progress',
            missionType: 'scientific_research',
            templateId: 'literature_review_continuous',
            mode: 'continuous',
            status: 'active',
            leaderDid: 'did:key:test',
            cadenceMs: 300000,
            policy: { autonomy: 'semiautonomous' },
            research: { sources: ['arxiv'] },
            knowledge: { autoIndex: true },
            activeChainIds: ['chain_1'],
            lastTickAt: Date.now(),
            nextTickAt: Date.now() + 300000,
        });

        const mission = storage.getMission('mission_test');
        expect(mission).toBeDefined();
        expect(mission?.goal).toBe('Track scientific progress');
        expect(mission?.activeChainIds).toEqual(['chain_1']);
    });

    it('acquires and renews mission leadership lease with single holder semantics', () => {
        const missionId = 'mission_lease_test';
        const now = 1_000_000;
        const ttlMs = 45_000;

        expect(storage.acquireMissionLease(missionId, 'leader-a', 'did:key:a', ttlMs, now)).toBe(true);
        expect(storage.acquireMissionLease(missionId, 'leader-b', 'did:key:b', ttlMs, now + 1_000)).toBe(false);
        expect(storage.renewMissionLease(missionId, 'leader-a', 'did:key:a', ttlMs, now + 10_000)).toBe(true);
        expect(storage.acquireMissionLease(missionId, 'leader-b', 'did:key:b', ttlMs, now + ttlMs + 20_000)).toBe(true);
    });

    it('finds missions by exact chain id without substring collisions', () => {
        storage.createMission({
            missionId: 'mission_alpha',
            roomId: 'lab',
            goal: 'alpha',
            missionType: 'scientific_research',
            templateId: 'literature_review_continuous',
            mode: 'continuous',
            status: 'active',
            leaderDid: 'did:key:a',
            cadenceMs: 300000,
            policy: {},
            research: {},
            knowledge: {},
            activeChainIds: ['chain_123'],
        });

        storage.createMission({
            missionId: 'mission_beta',
            roomId: 'lab',
            goal: 'beta',
            missionType: 'scientific_research',
            templateId: 'literature_review_continuous',
            mode: 'continuous',
            status: 'active',
            leaderDid: 'did:key:b',
            cadenceMs: 300000,
            policy: {},
            research: {},
            knowledge: {},
            activeChainIds: ['xchain_123x'],
        });

        const exact = storage.findMissionByChain('chain_123');
        expect(exact?.missionId).toBe('mission_alpha');
    });

    it('selects the healthiest capable worker', () => {
        const scheduler = new SwarmScheduler();
        const decision = scheduler.selectWorker(
            [
                {
                    did: 'did:key:slow',
                    hostId: 'host-a',
                    roomId: 'lab',
                    runtime: 'nanobot',
                    specialties: ['research'],
                    capabilities: ['research', 'academic-search'],
                    kinds: ['task'],
                    maxConcurrency: 1,
                    load: 0.9,
                    health: 'degraded',
                    queueDepth: 8,
                    successRate: 0.6,
                },
                {
                    did: 'did:key:fast',
                    hostId: 'host-b',
                    roomId: 'lab',
                    runtime: 'nanobot',
                    specialties: ['research', 'triage'],
                    capabilities: ['research', 'academic-search', 'triage'],
                    kinds: ['task', 'review'],
                    maxConcurrency: 2,
                    load: 0.1,
                    health: 'healthy',
                    queueDepth: 0,
                    successRate: 0.95,
                },
            ],
            {
                kind: 'task',
                requirements: {
                    capabilities: ['research', 'academic-search'],
                },
            }
        );

        expect(decision).toBeTruthy();
        expect(decision?.worker.did).toBe('did:key:fast');
    });
});
