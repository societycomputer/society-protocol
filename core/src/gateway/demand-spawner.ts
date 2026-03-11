/**
 * Society Protocol — Demand-Driven Agent Spawner
 *
 * Inspired by:
 * - AutoAgents (arXiv:2309.17288): Dynamic role generation per task
 * - MaAS (arXiv:2502.04180): Per-query architecture sampling from supernet
 * - IoA (arXiv:2505.07176): Ephemeral team assembly + dissolution
 * - DyLAN (arXiv:2310.02170): Agent importance scoring for selection
 *
 * Given a request, the DemandSpawner:
 * 1. Uses CapabilityRouter to determine roles needed
 * 2. Tries to select existing agents from the SwarmController pool
 * 3. Spawns ephemeral agents (Ollama, HTTP, Docker) for missing roles
 * 4. Opens a Chain of Collaboration for the team
 * 5. Monitors execution and collects results
 * 6. Dissolves ephemeral agents when done
 */

import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import { spawn, type ChildProcess } from 'child_process';
import type { Storage } from '../storage.js';
import type { Identity } from '../identity.js';
import type { RoomManager } from '../rooms.js';
import type { CocEngine } from '../coc.js';
import { SwarmController, type SwarmAgentProfile } from '../proactive/swarm-controller.js';
import type { SwarmWorkerProfile } from '../proactive/types.js';
import type { P2PSwarmRegistry } from '../proactive/swarm-registry.js';
import { CapabilityRouter, type IncomingRequest, type RoleSpec, type RoutingDecision } from './capability-router.js';

// ─── Types ───────────────────────────────────────────────────────

export type SpawnRuntime = 'ollama' | 'http' | 'docker' | 'process';

export interface SpawnConfig {
    /** Default runtime for ephemeral agents */
    defaultRuntime: SpawnRuntime;
    /** Ollama base URL */
    ollamaUrl: string;
    /** Ollama model for spawned agents */
    ollamaModel: string;
    /** Max concurrent spawned agents */
    maxSpawnedAgents: number;
    /** Timeout for spawned agent tasks (ms) */
    taskTimeoutMs: number;
    /** Whether to auto-dissolve agents after task completion */
    autoDissolvе: boolean;
    /** Room to use for spawned swarms */
    defaultRoom: string;
}

export const DEFAULT_SPAWN_CONFIG: SpawnConfig = {
    defaultRuntime: 'ollama',
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen3:1.7b',
    maxSpawnedAgents: 8,
    taskTimeoutMs: 120_000,
    autoDissolvе: true,
    defaultRoom: 'swarm-lobby',
};

export interface SpawnedAgent {
    id: string;
    role: RoleSpec;
    runtime: SpawnRuntime;
    did: string;
    status: 'spawning' | 'ready' | 'working' | 'done' | 'failed' | 'dissolved';
    process?: ChildProcess;
    endpoint?: string;
    createdAt: number;
    dissolvedAt?: number;
}

export interface SpawnedTeam {
    teamId: string;
    request: IncomingRequest;
    routing: RoutingDecision;
    agents: SpawnedAgent[];
    chainId?: string;
    roomId: string;
    status: 'assembling' | 'working' | 'completed' | 'failed' | 'dissolved';
    results: Map<string, any>;
    createdAt: number;
    completedAt?: number;
}

export interface SpawnResult {
    teamId: string;
    chainId: string;
    status: 'completed' | 'failed';
    results: Record<string, any>;
    agents: Array<{ id: string; role: string; runtime: SpawnRuntime; status: string }>;
    durationMs: number;
}

// ─── Demand Spawner ──────────────────────────────────────────────

export class DemandSpawner extends EventEmitter {
    private config: SpawnConfig;
    private router: CapabilityRouter;
    private swarm: SwarmController;
    private teams = new Map<string, SpawnedTeam>();
    private spawnedAgents = new Map<string, SpawnedAgent>();

    constructor(
        private storage: Storage,
        private rooms: RoomManager,
        private coc: CocEngine,
        registry: P2PSwarmRegistry,
        config: Partial<SpawnConfig> = {},
        private identity?: Identity,
    ) {
        super();
        this.config = { ...DEFAULT_SPAWN_CONFIG, ...config };
        this.router = new CapabilityRouter();
        this.swarm = new SwarmController(storage, rooms, registry);
    }

    /**
     * Handle an incoming request end-to-end:
     * Route → Select/Spawn → Execute → Collect → Dissolve
     */
    async handleRequest(request: IncomingRequest): Promise<SpawnResult> {
        const teamId = `team_${ulid()}`;
        const routing = this.router.route(request);
        const roomId = request.roomId || this.config.defaultRoom;

        this.emit('request:routed', { teamId, routing });

        // Ensure room exists — use identity DID to satisfy FK constraints
        const creatorDid = request.callerDid || this.identity?.did || 'system';
        this.storage.createRoom(roomId, roomId, creatorDid);

        const team: SpawnedTeam = {
            teamId,
            request,
            routing,
            agents: [],
            roomId,
            status: 'assembling',
            results: new Map(),
            createdAt: Date.now(),
        };
        this.teams.set(teamId, team);

        try {
            // 1. Resolve or spawn agents for each role
            const agents = await this.assembleTeam(team, routing);
            team.agents = agents;

            this.emit('team:assembled', {
                teamId,
                agentCount: agents.length,
                roles: agents.map(a => a.role.role),
            });

            // 2. Open Chain of Collaboration
            const chainId = await this.openChain(team, routing);
            team.chainId = chainId;
            team.status = 'working';

            // 3. Execute tasks via agents
            const results = await this.executeTeam(team);
            team.results = results;
            team.status = 'completed';
            team.completedAt = Date.now();

            this.emit('team:completed', { teamId, chainId });

            // 4. Dissolve ephemeral agents
            await this.dissolveTeam(team);

            return {
                teamId,
                chainId,
                status: 'completed',
                results: Object.fromEntries(results),
                agents: agents.map(a => ({
                    id: a.id,
                    role: a.role.role,
                    runtime: a.runtime,
                    status: a.status,
                })),
                durationMs: Date.now() - team.createdAt,
            };
        } catch (error) {
            team.status = 'failed';
            team.completedAt = Date.now();
            await this.dissolveTeam(team);

            this.emit('team:failed', {
                teamId,
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                teamId,
                chainId: team.chainId || '',
                status: 'failed',
                results: { error: error instanceof Error ? error.message : String(error) },
                agents: team.agents.map(a => ({
                    id: a.id,
                    role: a.role.role,
                    runtime: a.runtime,
                    status: a.status,
                })),
                durationMs: Date.now() - team.createdAt,
            };
        }
    }

    /**
     * Assemble a team by selecting existing agents or spawning new ones.
     */
    private async assembleTeam(
        team: SpawnedTeam,
        routing: RoutingDecision
    ): Promise<SpawnedAgent[]> {
        const agents: SpawnedAgent[] = [];

        for (const role of routing.roles) {
            // Try to find existing agent in swarm
            const existing = this.swarm.selectAgent(role.taskType, {
                capabilities: role.capabilities,
            });

            if (existing) {
                agents.push(this.wrapExistingAgent(existing, role));
                this.emit('agent:selected', {
                    teamId: team.teamId,
                    did: existing.did,
                    role: role.role,
                    source: 'pool',
                });
            } else {
                // Spawn ephemeral agent
                const spawned = await this.spawnAgent(team, role);
                agents.push(spawned);
                this.emit('agent:spawned', {
                    teamId: team.teamId,
                    agentId: spawned.id,
                    role: role.role,
                    runtime: spawned.runtime,
                    source: 'spawned',
                });
            }

            if (agents.length >= routing.maxAgents) break;
        }

        return agents;
    }

    /**
     * Wrap an existing swarm agent as a SpawnedAgent.
     */
    private wrapExistingAgent(agent: SwarmAgentProfile, role: RoleSpec): SpawnedAgent {
        return {
            id: `agent_${ulid()}`,
            role,
            runtime: 'http', // Existing agents are accessed via protocol
            did: agent.did,
            status: 'ready',
            createdAt: Date.now(),
        };
    }

    /**
     * Spawn an ephemeral agent for a role.
     */
    private async spawnAgent(team: SpawnedTeam, role: RoleSpec): Promise<SpawnedAgent> {
        if (this.spawnedAgents.size >= this.config.maxSpawnedAgents) {
            throw new Error(`Max spawned agents (${this.config.maxSpawnedAgents}) reached`);
        }

        const agentId = `agent_${ulid()}`;
        const did = `did:key:spawned-${agentId}`;

        const agent: SpawnedAgent = {
            id: agentId,
            role,
            runtime: this.config.defaultRuntime,
            did,
            status: 'spawning',
            createdAt: Date.now(),
        };

        // Register with swarm
        const profile: SwarmWorkerProfile = {
            did,
            hostId: `host_${agentId}`,
            roomId: team.roomId,
            runtime: this.config.defaultRuntime === 'process' ? 'custom' : this.config.defaultRuntime as any,
            specialties: role.specialties,
            capabilities: role.capabilities,
            kinds: [role.kind],
            maxConcurrency: 1,
            load: 0,
            health: 'healthy',
            displayName: `${role.role}-${agentId.slice(-6)}`,
            lastSeen: Date.now(),
        };

        this.swarm.registerAgent(profile);
        agent.status = 'ready';
        this.spawnedAgents.set(agentId, agent);

        return agent;
    }

    /**
     * Open a Chain of Collaboration for the team.
     */
    private async openChain(team: SpawnedTeam, routing: RoutingDecision): Promise<string> {
        const chainId = `coc_${ulid()}`;

        this.storage.createChain(
            chainId,
            team.roomId,
            team.request.goal,
            null,
            team.request.callerDid || 'system',
            team.request.priority || 'normal'
        );

        // Create steps for each role
        for (let i = 0; i < team.agents.length; i++) {
            const agent = team.agents[i];
            const stepId = `step_${ulid()}`;

            this.storage.createStep(
                stepId,
                chainId,
                agent.role.kind,
                agent.role.role,
                `${agent.role.taskType} task for ${agent.role.role}`,
                i > 0 ? [`step_${team.agents[i - 1].id}`] : [],
            );
        }

        return chainId;
    }

    /**
     * Execute the team's tasks using Ollama or other runtimes.
     */
    private async executeTeam(team: SpawnedTeam): Promise<Map<string, any>> {
        const results = new Map<string, any>();

        // Get steps for the chain
        const chain = this.storage.getChain(team.chainId!);
        if (!chain) throw new Error(`Chain ${team.chainId} not found`);

        const steps = this.storage.getChainSteps(team.chainId!);

        // Execute steps - sequentially for now (parallel for independent steps later)
        let previousResult = '';
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const agent = team.agents[i];
            if (!agent) continue;

            agent.status = 'working';
            this.emit('agent:working', {
                teamId: team.teamId,
                agentId: agent.id,
                stepId: step.step_id,
            });

            try {
                const result = await this.executeAgentTask(
                    agent,
                    team.request.goal,
                    step,
                    previousResult
                );

                results.set(agent.role.role, result);
                previousResult = typeof result === 'string' ? result : JSON.stringify(result);
                agent.status = 'done';

                // Record success in swarm
                this.swarm.recordTaskOutcome(agent.did, agent.role.taskType, true);

                this.emit('agent:done', {
                    teamId: team.teamId,
                    agentId: agent.id,
                    role: agent.role.role,
                });
            } catch (error) {
                agent.status = 'failed';
                this.swarm.recordTaskOutcome(agent.did, agent.role.taskType, false);
                results.set(agent.role.role, {
                    error: error instanceof Error ? error.message : String(error),
                });

                this.emit('agent:failed', {
                    teamId: team.teamId,
                    agentId: agent.id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return results;
    }

    /**
     * Execute a single agent's task against Ollama or other runtime.
     */
    private async executeAgentTask(
        agent: SpawnedAgent,
        goal: string,
        step: any,
        previousContext: string
    ): Promise<string> {
        const prompt = this.buildAgentPrompt(agent, goal, step, previousContext);

        switch (agent.runtime) {
            case 'ollama':
                return this.callOllama(prompt);
            case 'http':
                return this.callHttp(agent, prompt);
            default:
                return this.callOllama(prompt);
        }
    }

    /**
     * Build a prompt for an agent based on its role and context.
     */
    private buildAgentPrompt(
        agent: SpawnedAgent,
        goal: string,
        step: any,
        previousContext: string
    ): string {
        const parts = [
            `You are a specialized AI agent with the role: ${agent.role.role}`,
            `Your task type: ${agent.role.taskType}`,
            `Your capabilities: ${agent.role.capabilities.join(', ')}`,
            '',
            `## Goal`,
            goal,
            '',
            `## Your Step`,
            `Title: ${step.title || agent.role.role}`,
            `Kind: ${step.kind || agent.role.kind}`,
        ];

        if (previousContext) {
            parts.push('', '## Previous Context (from other agents)', previousContext);
        }

        parts.push(
            '',
            '## Instructions',
            `Complete your part of the task. Be specific and concise.`,
            `Focus on your role as ${agent.role.role}.`,
            `Respond with your findings/results directly.`
        );

        return parts.join('\n');
    }

    /**
     * Call Ollama API to execute a task.
     */
    private async callOllama(prompt: string): Promise<string> {
        const response = await fetch(`${this.config.ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.config.ollamaModel,
                prompt,
                stream: false,
            }),
            signal: AbortSignal.timeout(this.config.taskTimeoutMs),
        });

        if (!response.ok) {
            throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as any;
        return data?.response || '';
    }

    /**
     * Call an HTTP endpoint for existing agents.
     */
    private async callHttp(agent: SpawnedAgent, prompt: string): Promise<string> {
        if (!agent.endpoint) {
            // Fallback to Ollama for agents without endpoints
            return this.callOllama(prompt);
        }

        const response = await fetch(agent.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, role: agent.role.role }),
            signal: AbortSignal.timeout(this.config.taskTimeoutMs),
        });

        if (!response.ok) {
            throw new Error(`HTTP agent error: ${response.status}`);
        }

        const data = await response.json() as any;
        return data?.result || data?.response || JSON.stringify(data);
    }

    /**
     * Dissolve ephemeral agents after task completion.
     * IoA-inspired: ephemeral teams are assembled and dissolved per request.
     */
    private async dissolveTeam(team: SpawnedTeam): Promise<void> {
        for (const agent of team.agents) {
            if (this.spawnedAgents.has(agent.id)) {
                agent.status = 'dissolved';
                agent.dissolvedAt = Date.now();

                // Kill process if any
                if (agent.process) {
                    agent.process.kill('SIGTERM');
                }

                this.spawnedAgents.delete(agent.id);
                this.emit('agent:dissolved', {
                    teamId: team.teamId,
                    agentId: agent.id,
                    role: agent.role.role,
                    lifespan: Date.now() - agent.createdAt,
                });
            }
        }

        team.status = 'dissolved';
    }

    // ─── Public API ──────────────────────────────────────────────

    /** Get the capability router instance */
    getRouter(): CapabilityRouter {
        return this.router;
    }

    /** Get the swarm controller instance */
    getSwarm(): SwarmController {
        return this.swarm;
    }

    /** Get active teams */
    getActiveTeams(): SpawnedTeam[] {
        return [...this.teams.values()].filter(t =>
            t.status === 'assembling' || t.status === 'working'
        );
    }

    /** Get team by ID */
    getTeam(teamId: string): SpawnedTeam | undefined {
        return this.teams.get(teamId);
    }

    /** Get all spawned agents */
    getSpawnedAgents(): SpawnedAgent[] {
        return [...this.spawnedAgents.values()];
    }

    /** Get spawn config */
    getConfig(): SpawnConfig {
        return { ...this.config };
    }

    /** Update spawn config */
    updateConfig(updates: Partial<SpawnConfig>): void {
        Object.assign(this.config, updates);
    }

    /** Clean up */
    destroy(): void {
        for (const agent of this.spawnedAgents.values()) {
            if (agent.process) {
                agent.process.kill('SIGTERM');
            }
        }
        this.spawnedAgents.clear();
        this.teams.clear();
        this.swarm.destroy();
        this.removeAllListeners();
    }
}
