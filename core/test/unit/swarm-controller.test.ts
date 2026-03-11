import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { SwarmController, type SwarmControllerConfig, type TimeWindow } from '../../src/proactive/swarm-controller.js';
import type { SwarmWorkerProfile } from '../../src/proactive/types.js';

function createMockStorage() {
    return {};
}

function createMockRooms() {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        isJoined: vi.fn().mockReturnValue(true),
    });
}

function createMockRegistry() {
    return {
        getWorkers: vi.fn().mockReturnValue([]),
        bind: vi.fn(),
    };
}

function createWorker(overrides: Partial<SwarmWorkerProfile> = {}): SwarmWorkerProfile {
    return {
        did: `did:key:worker-${Math.random().toString(36).slice(2, 6)}`,
        hostId: 'host-1',
        roomId: 'room-1',
        runtime: 'custom',
        specialties: [],
        capabilities: ['research', 'analysis'],
        kinds: ['task'],
        maxConcurrency: 3,
        load: 0.2,
        health: 'healthy',
        lastSeen: Date.now(),
        ...overrides,
    };
}

describe('SwarmController', () => {
    let controller: SwarmController;
    let storage: any;
    let rooms: any;
    let registry: any;

    beforeEach(() => {
        storage = createMockStorage();
        rooms = createMockRooms();
        registry = createMockRegistry();
        controller = new SwarmController(storage, rooms, registry, {
            heartbeatIntervalMs: 100_000, // Don't auto-tick in tests
            heartbeatTimeoutMs: 30_000,
            reallocationCooldownMs: 1_000,
        });
    });

    afterEach(() => {
        controller.destroy();
    });

    describe('registerAgent', () => {
        it('registers an agent with inferred role', () => {
            const worker = createWorker({ kinds: ['task'] });
            const agent = controller.registerAgent(worker);

            expect(agent.role).toBe('worker');
            expect(agent.affinityScores).toBeDefined();
            expect(agent.explorationEpsilon).toBeGreaterThan(0);
        });

        it('infers validator role for review-capable agents', () => {
            const worker = createWorker({ kinds: ['review', 'verification'] });
            const agent = controller.registerAgent(worker);
            expect(agent.role).toBe('validator');
        });

        it('infers explorer role for synthesis agents', () => {
            const worker = createWorker({ kinds: ['synthesis'], specialties: ['planning'] });
            const agent = controller.registerAgent(worker);
            expect(agent.role).toBe('explorer');
        });

        it('allows explicit role override', () => {
            const worker = createWorker({ kinds: ['task'] });
            const agent = controller.registerAgent(worker, 'explorer');
            expect(agent.role).toBe('explorer');
        });
    });

    describe('recordTaskOutcome', () => {
        it('boosts affinity on success', () => {
            const worker = createWorker();
            controller.registerAgent(worker);

            controller.recordTaskOutcome(worker.did, 'research', true);
            controller.recordTaskOutcome(worker.did, 'research', true);

            const status = controller.getSwarmStatus();
            const agent = status.agents.find((a) => a.did === worker.did);
            expect(agent!.affinities['research']).toBeGreaterThan(0.5);
            expect(agent!.successStreak).toBe(2);
        });

        it('reduces affinity on failure', () => {
            const worker = createWorker();
            controller.registerAgent(worker);

            // First succeed to build affinity
            controller.recordTaskOutcome(worker.did, 'research', true);
            controller.recordTaskOutcome(worker.did, 'research', true);

            // Then fail
            controller.recordTaskOutcome(worker.did, 'research', false);

            const status = controller.getSwarmStatus();
            const agent = status.agents.find((a) => a.did === worker.did);
            expect(agent!.successStreak).toBe(0);
        });

        it('adjusts epsilon based on performance', () => {
            const worker = createWorker();
            const agent = controller.registerAgent(worker);
            const initialEpsilon = agent.explorationEpsilon;

            // Success reduces epsilon (exploit more)
            controller.recordTaskOutcome(worker.did, 'research', true);
            controller.recordTaskOutcome(worker.did, 'research', true);
            controller.recordTaskOutcome(worker.did, 'research', true);

            const status = controller.getSwarmStatus();
            const updated = status.agents.find((a) => a.did === worker.did);
            expect(updated!.epsilon).toBeLessThan(initialEpsilon);
        });
    });

    describe('selectAgent', () => {
        it('selects best agent by affinity', () => {
            const worker1 = createWorker({ did: 'did:key:w1' });
            const worker2 = createWorker({ did: 'did:key:w2' });
            controller.registerAgent(worker1);
            controller.registerAgent(worker2);

            // Build w1's affinity for research
            controller.recordTaskOutcome('did:key:w1', 'research', true);
            controller.recordTaskOutcome('did:key:w1', 'research', true);
            controller.recordTaskOutcome('did:key:w1', 'research', true);

            // Mock Math.random to force greedy selection (not exploration)
            const mockRandom = vi.spyOn(Math, 'random').mockReturnValue(0.99);

            const selected = controller.selectAgent('research');
            expect(selected).not.toBeNull();
            expect(selected!.did).toBe('did:key:w1');

            mockRandom.mockRestore();
        });

        it('filters by capabilities', () => {
            const worker1 = createWorker({ did: 'did:key:w1', capabilities: ['python'] });
            const worker2 = createWorker({ did: 'did:key:w2', capabilities: ['rust'] });
            controller.registerAgent(worker1);
            controller.registerAgent(worker2);

            vi.spyOn(Math, 'random').mockReturnValue(0.99);

            const selected = controller.selectAgent('coding', { capabilities: ['rust'] });
            expect(selected).not.toBeNull();
            expect(selected!.did).toBe('did:key:w2');

            vi.restoreAllMocks();
        });

        it('returns null when no candidates', () => {
            const selected = controller.selectAgent('research');
            expect(selected).toBeNull();
        });

        it('excludes validators from task selection', () => {
            const worker = createWorker({ did: 'did:key:w1' });
            controller.registerAgent(worker, 'validator');

            vi.spyOn(Math, 'random').mockReturnValue(0.99);
            const selected = controller.selectAgent('research');
            expect(selected).toBeNull();
            vi.restoreAllMocks();
        });
    });

    describe('rebalanceRoles', () => {
        it('promotes workers to explorer when needed', () => {
            // Register only workers, no explorers
            for (let i = 0; i < 4; i++) {
                controller.registerAgent(createWorker(), 'worker');
            }

            const result = controller.rebalanceRoles();
            expect(result.changes.length).toBeGreaterThan(0);
            expect(result.changes.some((c) => c.to === 'explorer')).toBe(true);
        });

        it('promotes workers to validator when needed', () => {
            for (let i = 0; i < 4; i++) {
                controller.registerAgent(createWorker({ successRate: 0.9 }), 'worker');
            }

            const result = controller.rebalanceRoles();
            expect(result.changes.some((c) => c.to === 'validator')).toBe(true);
        });
    });

    describe('time windows', () => {
        it('detects when mission is within time window', () => {
            const now = Date.now();
            controller.setMissionTimeWindow('mission-1', {
                startAt: now - 1000,
                endAt: now + 60_000,
            });

            expect(controller.isMissionInWindow('mission-1')).toBe(true);
        });

        it('detects when mission is outside time window', () => {
            const now = Date.now();
            controller.setMissionTimeWindow('mission-1', {
                startAt: now + 60_000,
                endAt: now + 120_000,
            });

            expect(controller.isMissionInWindow('mission-1')).toBe(false);
        });

        it('returns true for missions without windows', () => {
            expect(controller.isMissionInWindow('no-window')).toBe(true);
        });

        it('handles daily recurrence', () => {
            const now = new Date();
            const currentHour = now.getHours();
            const currentMin = now.getMinutes();

            controller.setMissionTimeWindow('mission-daily', {
                startAt: now.getTime() - 3600_000,
                endAt: now.getTime() + 3600_000,
                recurrence: {
                    type: 'daily',
                    startTime: `${String(currentHour - 1).padStart(2, '0')}:00`,
                    endTime: `${String(currentHour + 1).padStart(2, '0')}:59`,
                },
            });

            expect(controller.isMissionInWindow('mission-daily')).toBe(true);
        });

        it('removes time window', () => {
            controller.setMissionTimeWindow('mission-1', {
                startAt: Date.now() - 1000,
                endAt: Date.now() + 60_000,
            });

            controller.removeMissionTimeWindow('mission-1');
            // Should default to true (no window = always active)
            expect(controller.isMissionInWindow('mission-1')).toBe(true);
        });
    });

    describe('getSwarmStatus', () => {
        it('returns comprehensive status', () => {
            controller.registerAgent(createWorker(), 'worker');
            controller.registerAgent(createWorker(), 'explorer');
            controller.registerAgent(createWorker(), 'validator');

            controller.setMissionTimeWindow('m1', {
                startAt: Date.now() - 1000,
                endAt: Date.now() + 60_000,
            });

            const status = controller.getSwarmStatus();
            expect(status.agents).toHaveLength(3);
            expect(status.roleDistribution.worker).toBe(1);
            expect(status.roleDistribution.explorer).toBe(1);
            expect(status.roleDistribution.validator).toBe(1);
            expect(status.activeWindows).toHaveLength(1);
            expect(status.activeWindows[0].inWindow).toBe(true);
        });
    });

    describe('events', () => {
        it('emits events for agent registration', () => {
            const events: any[] = [];
            controller.on('event', (e: any) => events.push(e));

            controller.registerAgent(createWorker());
            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('worker:joined');
        });

        it('emits events for task outcomes', () => {
            const worker = createWorker();
            controller.registerAgent(worker);

            const events: any[] = [];
            controller.on('event', (e: any) => events.push(e));

            controller.recordTaskOutcome(worker.did, 'research', true);
            expect(events.some((e) => e.type === 'task:completed')).toBe(true);
        });

        it('returns recent events via getEvents', () => {
            const worker = createWorker();
            controller.registerAgent(worker);
            controller.recordTaskOutcome(worker.did, 'research', true);
            controller.recordTaskOutcome(worker.did, 'analysis', false);

            const events = controller.getEvents();
            expect(events.length).toBeGreaterThanOrEqual(3); // joined + completed + failed
        });
    });
});
