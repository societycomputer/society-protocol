/**
 * Society Protocol — Proactive Swarm Controller
 *
 * Advanced swarm coordination layer inspired by:
 * - DRAMA (arXiv:2508.04332): Monitor agent + event-driven reallocation
 * - SwarmSys (arXiv:2510.10047): Pheromone-inspired explorer/worker/validator roles
 * - TDAG (arXiv:2402.10178): Dynamic task decomposition with skill libraries
 * - SECP (arXiv:2602.02170): Self-evolving coordination with formal invariants
 * - Google ADK: Bidirectional streaming + session management
 *
 * Provides:
 * - Time-range scheduling (run swarm within specific time windows)
 * - Real-time event-driven coordination (not just timer-based cadence)
 * - Worker health monitoring with heartbeat + auto-reallocation
 * - Dynamic role assignment (explorer/worker/validator from SwarmSys)
 * - Pheromone-inspired affinity scoring for task-agent matching
 * - Mission lifecycle with start/pause/resume/stop + time bounds
 */

import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import type { Storage } from '../storage.js';
import type { RoomManager } from '../rooms.js';
import type { SwarmWorkerProfile, MissionInfo } from './types.js';
import type { P2PSwarmRegistry } from './swarm-registry.js';

// ─── Types ───────────────────────────────────────────────────────

export type SwarmRole = 'explorer' | 'worker' | 'validator';

export interface TimeWindow {
    /** Start time (ISO 8601 or epoch ms) */
    startAt: number;
    /** End time (ISO 8601 or epoch ms) */
    endAt: number;
    /** Timezone (IANA, e.g. 'America/Sao_Paulo') */
    timezone?: string;
    /** Recurrence pattern */
    recurrence?: RecurrencePattern;
}

export interface RecurrencePattern {
    /** Recurrence type */
    type: 'daily' | 'weekly' | 'interval';
    /** For 'interval': repeat every N ms */
    intervalMs?: number;
    /** For 'weekly': day numbers (0=Sun, 1=Mon, ..., 6=Sat) */
    daysOfWeek?: number[];
    /** For 'daily'/'weekly': start time as "HH:MM" */
    startTime?: string;
    /** For 'daily'/'weekly': end time as "HH:MM" */
    endTime?: string;
    /** Maximum number of occurrences (undefined = infinite) */
    maxOccurrences?: number;
}

export interface SwarmAgentProfile extends SwarmWorkerProfile {
    /** Current role in the swarm */
    role: SwarmRole;
    /** Affinity scores for different task types (pheromone-inspired) */
    affinityScores: Map<string, number>;
    /** Epsilon for exploration-exploitation balance */
    explorationEpsilon: number;
    /** Consecutive successful tasks */
    successStreak: number;
    /** Availability window */
    availabilityWindow?: TimeWindow;
}

export interface SwarmEvent {
    id: string;
    type: SwarmEventType;
    missionId: string;
    roomId: string;
    timestamp: number;
    data: Record<string, unknown>;
}

export type SwarmEventType =
    | 'worker:joined'
    | 'worker:left'
    | 'worker:failed'
    | 'worker:overloaded'
    | 'task:completed'
    | 'task:failed'
    | 'task:timeout'
    | 'mission:window:opened'
    | 'mission:window:closed'
    | 'reallocation:triggered'
    | 'role:changed'
    | 'consensus:reached';

export interface SwarmControllerConfig {
    /** Heartbeat interval for liveness checks (ms) */
    heartbeatIntervalMs: number;
    /** Max time without heartbeat before marking unhealthy (ms) */
    heartbeatTimeoutMs: number;
    /** Reallocation cooldown after a reallocation event (ms) */
    reallocationCooldownMs: number;
    /** Min workers for explorer role */
    minExplorers: number;
    /** Min workers for validator role */
    minValidators: number;
    /** Affinity decay factor per tick (0-1) */
    affinityDecay: number;
    /** Affinity boost on successful task completion */
    affinityBoost: number;
    /** Base epsilon for exploration */
    baseEpsilon: number;
    /** Enable time-window scheduling */
    enableTimeWindows: boolean;
    /** Fixed-time consensus bound (ms) — max time to reach consensus */
    consensusBoundMs: number;
}

export const DEFAULT_SWARM_CONTROLLER_CONFIG: SwarmControllerConfig = {
    heartbeatIntervalMs: 10_000,
    heartbeatTimeoutMs: 30_000,
    reallocationCooldownMs: 15_000,
    minExplorers: 1,
    minValidators: 1,
    affinityDecay: 0.95,
    affinityBoost: 0.15,
    baseEpsilon: 0.25,
    enableTimeWindows: true,
    consensusBoundMs: 60_000,
};

// ─── Swarm Controller ───────────────────────────────────────────

export class SwarmController extends EventEmitter {
    private config: SwarmControllerConfig;
    private agents = new Map<string, SwarmAgentProfile>();
    private eventLog: SwarmEvent[] = [];
    private missionWindows = new Map<string, TimeWindow>();
    private windowTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private monitorTimer?: ReturnType<typeof setInterval>;
    private lastReallocationAt = 0;

    constructor(
        private storage: Storage,
        private rooms: RoomManager,
        private registry: P2PSwarmRegistry,
        config: Partial<SwarmControllerConfig> = {}
    ) {
        super();
        this.config = { ...DEFAULT_SWARM_CONTROLLER_CONFIG, ...config };
    }

    /**
     * Start the swarm controller's monitor loop.
     * Acts as the DRAMA Monitor agent — detects state changes and triggers reallocation.
     */
    start(): void {
        if (this.monitorTimer) return;
        this.monitorTimer = setInterval(() => {
            this.monitorTick();
        }, this.config.heartbeatIntervalMs);
        this.monitorTimer.unref?.();
    }

    /**
     * Stop the swarm controller.
     */
    stop(): void {
        if (this.monitorTimer) {
            clearInterval(this.monitorTimer);
            this.monitorTimer = undefined;
        }
        for (const timer of this.windowTimers.values()) {
            clearTimeout(timer);
        }
        this.windowTimers.clear();
    }

    /**
     * Register a time window for a mission.
     * The swarm will only be active during this window.
     */
    setMissionTimeWindow(missionId: string, window: TimeWindow): void {
        this.missionWindows.set(missionId, window);
        this.scheduleWindowEvents(missionId, window);
        this.emitEvent({
            type: 'mission:window:opened',
            missionId,
            roomId: '',
            data: { startAt: window.startAt, endAt: window.endAt, recurrence: window.recurrence },
        });
    }

    /**
     * Remove a mission's time window.
     */
    removeMissionTimeWindow(missionId: string): void {
        this.missionWindows.delete(missionId);
        const timer = this.windowTimers.get(missionId);
        if (timer) {
            clearTimeout(timer);
            this.windowTimers.delete(missionId);
        }
    }

    /**
     * Check if a mission is currently within its time window.
     */
    isMissionInWindow(missionId: string): boolean {
        const window = this.missionWindows.get(missionId);
        if (!window) return true; // No window = always active

        const now = Date.now();
        if (window.recurrence) {
            return this.isInRecurringWindow(now, window);
        }
        return now >= window.startAt && now <= window.endAt;
    }

    /**
     * Register an agent with the swarm controller.
     */
    registerAgent(worker: SwarmWorkerProfile, role?: SwarmRole): SwarmAgentProfile {
        const agent: SwarmAgentProfile = {
            ...worker,
            role: role || this.inferRole(worker),
            affinityScores: new Map(),
            explorationEpsilon: this.config.baseEpsilon,
            successStreak: 0,
        };
        this.agents.set(worker.did, agent);
        this.emitEvent({
            type: 'worker:joined',
            missionId: '',
            roomId: worker.roomId,
            data: { did: worker.did, role: agent.role },
        });
        return agent;
    }

    /**
     * Update agent affinity after task completion (pheromone-inspired).
     * SwarmSys: Validated contributions reinforce agent-task compatibility.
     */
    recordTaskOutcome(
        agentDid: string,
        taskType: string,
        success: boolean
    ): void {
        const agent = this.agents.get(agentDid);
        if (!agent) return;

        const currentAffinity = agent.affinityScores.get(taskType) || 0.5;

        if (success) {
            // Boost affinity
            agent.affinityScores.set(
                taskType,
                Math.min(1, currentAffinity + this.config.affinityBoost)
            );
            agent.successStreak++;
            // Reduce epsilon for high-performing agents (exploit more)
            agent.explorationEpsilon = Math.max(
                0.1,
                this.config.baseEpsilon - agent.successStreak * 0.02
            );
        } else {
            // Reduce affinity
            agent.affinityScores.set(
                taskType,
                Math.max(0, currentAffinity - this.config.affinityBoost * 0.5)
            );
            agent.successStreak = 0;
            // Increase epsilon for struggling agents (explore more)
            agent.explorationEpsilon = Math.min(
                0.4,
                this.config.baseEpsilon + 0.1
            );
        }

        this.emitEvent({
            type: success ? 'task:completed' : 'task:failed',
            missionId: '',
            roomId: agent.roomId,
            data: { agentDid, taskType, success, newAffinity: agent.affinityScores.get(taskType) },
        });
    }

    /**
     * Select the best agent for a task using affinity-based matching.
     * Combines SwarmSys pheromone matching with epsilon-greedy exploration.
     */
    selectAgent(
        taskType: string,
        requirements: { capabilities?: string[]; minReputation?: number } = {}
    ): SwarmAgentProfile | null {
        const candidates = [...this.agents.values()].filter((a) => {
            if (a.health === 'unhealthy') return false;
            if (a.role === 'validator') return false; // Validators don't do tasks
            if (requirements.capabilities?.length) {
                const hasCaps = requirements.capabilities.every(
                    (cap) => a.capabilities.includes(cap) || a.specialties.includes(cap)
                );
                if (!hasCaps) return false;
            }
            return true;
        });

        if (candidates.length === 0) return null;

        // Epsilon-greedy: explore with probability epsilon
        const explorer = candidates[0]; // Use first agent's epsilon as reference
        if (Math.random() < (explorer?.explorationEpsilon || this.config.baseEpsilon)) {
            // Random selection (exploration)
            return candidates[Math.floor(Math.random() * candidates.length)];
        }

        // Greedy selection based on affinity + load score
        let best: SwarmAgentProfile | null = null;
        let bestScore = -Infinity;

        for (const agent of candidates) {
            const affinity = agent.affinityScores.get(taskType) || 0.5;
            const loadPenalty = agent.load * 30;
            const healthBonus = agent.health === 'healthy' ? 50 : 20;
            const streakBonus = Math.min(agent.successStreak * 2, 20);

            const score = affinity * 100 + healthBonus - loadPenalty + streakBonus;

            if (score > bestScore) {
                bestScore = score;
                best = agent;
            }
        }

        return best;
    }

    /**
     * Dynamically reassign roles based on current swarm state.
     * Ensures minimum explorers and validators are maintained.
     */
    rebalanceRoles(): { changes: Array<{ did: string; from: SwarmRole; to: SwarmRole }> } {
        const agents = [...this.agents.values()].filter((a) => a.health !== 'unhealthy');
        const changes: Array<{ did: string; from: SwarmRole; to: SwarmRole }> = [];

        const explorers = agents.filter((a) => a.role === 'explorer');
        const validators = agents.filter((a) => a.role === 'validator');
        const workers = agents.filter((a) => a.role === 'worker');

        // Ensure minimum explorers
        if (explorers.length < this.config.minExplorers && workers.length > 1) {
            const toPromote = workers
                .sort((a, b) => (b.explorationEpsilon || 0) - (a.explorationEpsilon || 0))
                .slice(0, this.config.minExplorers - explorers.length);

            for (const agent of toPromote) {
                const oldRole = agent.role;
                agent.role = 'explorer';
                changes.push({ did: agent.did, from: oldRole, to: 'explorer' });
            }
        }

        // Ensure minimum validators
        if (validators.length < this.config.minValidators && workers.length > 1) {
            const toPromote = workers
                .filter((a) => !changes.some((c) => c.did === a.did))
                .sort((a, b) => (b.successRate || 0) - (a.successRate || 0))
                .slice(0, this.config.minValidators - validators.length);

            for (const agent of toPromote) {
                const oldRole = agent.role;
                agent.role = 'validator';
                changes.push({ did: agent.did, from: oldRole, to: 'validator' });
            }
        }

        for (const change of changes) {
            this.emitEvent({
                type: 'role:changed',
                missionId: '',
                roomId: this.agents.get(change.did)?.roomId || '',
                data: change,
            });
        }

        return { changes };
    }

    /**
     * Get the current swarm status with roles and affinity info.
     */
    getSwarmStatus(): {
        agents: Array<{
            did: string;
            role: SwarmRole;
            health: string;
            load: number;
            affinities: Record<string, number>;
            epsilon: number;
            successStreak: number;
        }>;
        roleDistribution: Record<SwarmRole, number>;
        activeMissions: number;
        activeWindows: Array<{ missionId: string; inWindow: boolean; window: TimeWindow }>;
        recentEvents: SwarmEvent[];
    } {
        const agents = [...this.agents.values()].map((a) => ({
            did: a.did,
            role: a.role,
            health: a.health,
            load: a.load,
            affinities: Object.fromEntries(a.affinityScores),
            epsilon: a.explorationEpsilon,
            successStreak: a.successStreak,
        }));

        const roleDistribution: Record<SwarmRole, number> = {
            explorer: agents.filter((a) => a.role === 'explorer').length,
            worker: agents.filter((a) => a.role === 'worker').length,
            validator: agents.filter((a) => a.role === 'validator').length,
        };

        const activeWindows = [...this.missionWindows.entries()].map(([missionId, window]) => ({
            missionId,
            inWindow: this.isMissionInWindow(missionId),
            window,
        }));

        return {
            agents,
            roleDistribution,
            activeMissions: activeWindows.filter((w) => w.inWindow).length,
            activeWindows,
            recentEvents: this.eventLog.slice(-20),
        };
    }

    /**
     * Get recent events (useful for real-time UIs).
     */
    getEvents(since?: number, limit = 50): SwarmEvent[] {
        let events = this.eventLog;
        if (since) {
            events = events.filter((e) => e.timestamp > since);
        }
        return events.slice(-limit);
    }

    // ─── Private: Monitor ───────────────────────────────────────

    private monitorTick(): void {
        const now = Date.now();
        let stateChanged = false;

        // Check heartbeats (DRAMA Monitor agent)
        for (const agent of this.agents.values()) {
            const timeSinceLastSeen = now - (agent.lastSeen || 0);
            if (timeSinceLastSeen > this.config.heartbeatTimeoutMs && agent.health !== 'unhealthy') {
                agent.health = 'unhealthy';
                stateChanged = true;
                this.emitEvent({
                    type: 'worker:failed',
                    missionId: '',
                    roomId: agent.roomId,
                    data: { did: agent.did, reason: 'heartbeat_timeout', lastSeen: agent.lastSeen },
                });
            }

            // Check overload
            if (agent.load >= 0.95 && agent.health === 'healthy') {
                this.emitEvent({
                    type: 'worker:overloaded',
                    missionId: '',
                    roomId: agent.roomId,
                    data: { did: agent.did, load: agent.load },
                });
            }
        }

        // Decay affinities
        for (const agent of this.agents.values()) {
            for (const [taskType, affinity] of agent.affinityScores) {
                agent.affinityScores.set(taskType, affinity * this.config.affinityDecay);
            }
        }

        // Check time windows
        if (this.config.enableTimeWindows) {
            for (const [missionId, window] of this.missionWindows) {
                const inWindow = this.isMissionInWindow(missionId);
                // Could trigger mission pause/resume here
                if (!inWindow && now > window.endAt && !window.recurrence) {
                    this.emitEvent({
                        type: 'mission:window:closed',
                        missionId,
                        roomId: '',
                        data: { endAt: window.endAt },
                    });
                    this.missionWindows.delete(missionId);
                }
            }
        }

        // DRAMA: Trigger reallocation only on significant state changes
        if (stateChanged && now - this.lastReallocationAt > this.config.reallocationCooldownMs) {
            this.lastReallocationAt = now;
            this.rebalanceRoles();
            this.emitEvent({
                type: 'reallocation:triggered',
                missionId: '',
                roomId: '',
                data: { reason: 'state_change' },
            });
            this.emit('reallocation', this.getSwarmStatus());
        }
    }

    // ─── Private: Time Windows ──────────────────────────────────

    private scheduleWindowEvents(missionId: string, window: TimeWindow): void {
        const now = Date.now();

        // Schedule window open
        if (window.startAt > now) {
            const openTimer = setTimeout(() => {
                this.emit('window:opened', missionId);
                this.emitEvent({
                    type: 'mission:window:opened',
                    missionId,
                    roomId: '',
                    data: { startAt: window.startAt },
                });
            }, window.startAt - now);
            openTimer.unref?.();
            this.windowTimers.set(`${missionId}:open`, openTimer);
        }

        // Schedule window close
        if (window.endAt > now) {
            const closeTimer = setTimeout(() => {
                this.emit('window:closed', missionId);
                this.emitEvent({
                    type: 'mission:window:closed',
                    missionId,
                    roomId: '',
                    data: { endAt: window.endAt },
                });

                // Schedule next occurrence if recurring
                if (window.recurrence) {
                    const nextWindow = this.computeNextWindow(window);
                    if (nextWindow) {
                        this.setMissionTimeWindow(missionId, nextWindow);
                    }
                }
            }, window.endAt - now);
            closeTimer.unref?.();
            this.windowTimers.set(`${missionId}:close`, closeTimer);
        }
    }

    private isInRecurringWindow(now: number, window: TimeWindow): boolean {
        const rec = window.recurrence!;

        if (rec.type === 'interval') {
            const elapsed = now - window.startAt;
            const interval = rec.intervalMs || 3_600_000;
            const windowDuration = window.endAt - window.startAt;
            const cyclePosition = elapsed % interval;
            return cyclePosition < windowDuration;
        }

        if (rec.type === 'daily' || rec.type === 'weekly') {
            const date = new Date(now);
            const dayOfWeek = date.getDay();

            if (rec.type === 'weekly' && rec.daysOfWeek) {
                if (!rec.daysOfWeek.includes(dayOfWeek)) return false;
            }

            if (rec.startTime && rec.endTime) {
                const [startH, startM] = rec.startTime.split(':').map(Number);
                const [endH, endM] = rec.endTime.split(':').map(Number);
                const currentMinutes = date.getHours() * 60 + date.getMinutes();
                const startMinutes = startH * 60 + startM;
                const endMinutes = endH * 60 + endM;
                return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
            }
        }

        // Fallback to simple range check
        return now >= window.startAt && now <= window.endAt;
    }

    private computeNextWindow(window: TimeWindow): TimeWindow | null {
        const rec = window.recurrence!;
        if (rec.maxOccurrences !== undefined && rec.maxOccurrences <= 1) return null;

        const duration = window.endAt - window.startAt;
        let nextStart: number;

        if (rec.type === 'interval') {
            nextStart = window.startAt + (rec.intervalMs || 3_600_000);
        } else if (rec.type === 'daily') {
            nextStart = window.startAt + 86_400_000;
        } else if (rec.type === 'weekly') {
            nextStart = window.startAt + 7 * 86_400_000;
        } else {
            return null;
        }

        return {
            startAt: nextStart,
            endAt: nextStart + duration,
            timezone: window.timezone,
            recurrence: {
                ...rec,
                maxOccurrences: rec.maxOccurrences ? rec.maxOccurrences - 1 : undefined,
            },
        };
    }

    // ─── Private: Helpers ───────────────────────────────────────

    private inferRole(worker: SwarmWorkerProfile): SwarmRole {
        if (worker.kinds.includes('verification') || worker.kinds.includes('review')) {
            return 'validator';
        }
        if (worker.kinds.includes('synthesis') || worker.specialties.includes('planning')) {
            return 'explorer';
        }
        return 'worker';
    }

    private emitEvent(event: Omit<SwarmEvent, 'id' | 'timestamp'>): void {
        const full: SwarmEvent = {
            id: `sevt_${ulid()}`,
            timestamp: Date.now(),
            ...event,
        };
        this.eventLog.push(full);
        // Keep last 1000 events
        if (this.eventLog.length > 1000) {
            this.eventLog = this.eventLog.slice(-500);
        }
        this.emit('event', full);
    }

    destroy(): void {
        this.stop();
        this.agents.clear();
        this.eventLog = [];
        this.removeAllListeners();
    }
}
