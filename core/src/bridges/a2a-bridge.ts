/**
 * Society Protocol — A2A (Agent-to-Agent) Bridge
 *
 * Implements Google's Agent-to-Agent protocol bridge,
 * enabling interoperability between A2A-compliant agents
 * and Society Protocol's P2P network.
 *
 * A2A spec: Agent Card, Tasks, Streaming, Push Notifications
 *
 * - Inbound: A2A task requests → Society CoC chains
 * - Outbound: Society chains → A2A task responses
 */

import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import type { Storage } from '../storage.js';
import type { RoomManager } from '../rooms.js';
import type { CocEngine } from '../coc.js';
import type { KnowledgePool } from '../knowledge.js';
import type { Identity } from '../identity.js';

// ─── A2A Protocol Types ─────────────────────────────────────────

export interface A2AAgentCard {
    name: string;
    description: string;
    url: string;
    version: string;
    capabilities: A2ACapabilities;
    skills: A2ASkill[];
    defaultInputModes: string[];
    defaultOutputModes: string[];
}

export interface A2ACapabilities {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
}

export interface A2ASkill {
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples?: string[];
}

export type A2ATaskState =
    | 'submitted'
    | 'working'
    | 'input-required'
    | 'completed'
    | 'canceled'
    | 'failed'
    | 'unknown';

export interface A2AMessage {
    role: 'user' | 'agent';
    parts: A2APart[];
}

export interface A2ATextPart {
    type: 'text';
    text: string;
}

export interface A2AFilePart {
    type: 'file';
    file: { name: string; mimeType: string; bytes?: string; uri?: string };
}

export interface A2ADataPart {
    type: 'data';
    data: Record<string, unknown>;
}

export type A2APart = A2ATextPart | A2AFilePart | A2ADataPart;

export interface A2ATask {
    id: string;
    sessionId: string;
    status: { state: A2ATaskState; message?: A2AMessage };
    history?: A2AMessage[];
    artifacts?: A2AArtifact[];
    metadata?: Record<string, unknown>;
}

export interface A2AArtifact {
    name: string;
    description?: string;
    parts: A2APart[];
    index?: number;
}

export interface A2ATaskSendParams {
    id: string;
    sessionId?: string;
    message: A2AMessage;
    acceptedOutputModes?: string[];
    metadata?: Record<string, unknown>;
}

// ─── Bridge Config ──────────────────────────────────────────────

export interface A2ABridgeConfig {
    identity: Identity;
    storage: Storage;
    rooms: RoomManager;
    coc: CocEngine;
    knowledge: KnowledgePool;
    /** Default room for incoming A2A tasks */
    defaultRoom: string;
    /** Skills exposed to A2A agents */
    exposedSkills?: A2ASkill[];
    /** Base URL for this agent's A2A endpoint */
    baseUrl?: string;
}

// ─── Task Mapping ───────────────────────────────────────────────

interface TaskMapping {
    a2aTaskId: string;
    chainId: string;
    roomId: string;
    sessionId: string;
    state: A2ATaskState;
    history: A2AMessage[];
    artifacts: A2AArtifact[];
    createdAt: number;
}

// ─── A2A Bridge ─────────────────────────────────────────────────

export class A2ABridge extends EventEmitter {
    private identity: Identity;
    private storage: Storage;
    private rooms: RoomManager;
    private coc: CocEngine;
    private knowledge: KnowledgePool;
    private defaultRoom: string;
    private exposedSkills: A2ASkill[];
    private baseUrl: string;
    private taskMappings = new Map<string, TaskMapping>();

    constructor(config: A2ABridgeConfig) {
        super();
        this.identity = config.identity;
        this.storage = config.storage;
        this.rooms = config.rooms;
        this.coc = config.coc;
        this.knowledge = config.knowledge;
        this.defaultRoom = config.defaultRoom;
        this.exposedSkills = config.exposedSkills ?? [];
        this.baseUrl = config.baseUrl ?? 'http://localhost:8080';

        this.setupCocListeners();
    }

    // ─── Agent Card ──────────────────────────────────────────────

    getAgentCard(): A2AAgentCard {
        return {
            name: this.identity.displayName,
            description: 'Society Protocol agent — P2P multi-agent collaboration',
            url: this.baseUrl,
            version: '1.0.0',
            capabilities: {
                streaming: true,
                pushNotifications: false,
                stateTransitionHistory: true,
            },
            skills: this.exposedSkills.length > 0
                ? this.exposedSkills
                : this.getDefaultSkills(),
            defaultInputModes: ['text/plain', 'application/json'],
            defaultOutputModes: ['text/plain', 'application/json'],
        };
    }

    private getDefaultSkills(): A2ASkill[] {
        return [
            {
                id: 'collaborate',
                name: 'Multi-Agent Collaboration',
                description: 'Coordinate complex tasks across a P2P network of AI agents',
                tags: ['collaboration', 'p2p', 'multi-agent'],
            },
            {
                id: 'research',
                name: 'Distributed Research',
                description: 'Conduct research using a swarm of specialized agents',
                tags: ['research', 'swarm', 'knowledge'],
            },
            {
                id: 'knowledge_query',
                name: 'Knowledge Pool Query',
                description: 'Search and retrieve from a distributed CRDT knowledge base',
                tags: ['knowledge', 'search', 'crdt'],
            },
        ];
    }

    // ─── Task Send (Inbound) ─────────────────────────────────────

    async handleTaskSend(params: A2ATaskSendParams): Promise<A2ATask> {
        const sessionId = params.sessionId || ulid();

        // Extract text from the message
        const text = params.message.parts
            .filter((p): p is A2ATextPart => p.type === 'text')
            .map(p => p.text)
            .join('\n');

        if (!text) {
            return this.createErrorTask(params.id, sessionId, 'No text content in message');
        }

        // Create a CoC chain from the A2A task
        const roomId = (params.metadata?.room_id as string) || this.defaultRoom;
        const chainId = await this.coc.openChain(roomId, text, {
            priority: 'normal',
        });

        // Create task mapping
        const mapping: TaskMapping = {
            a2aTaskId: params.id,
            chainId,
            roomId,
            sessionId,
            state: 'working',
            history: [params.message],
            artifacts: [],
            createdAt: Date.now(),
        };
        this.taskMappings.set(params.id, mapping);

        this.emit('a2a:task:created', params.id, chainId);

        return {
            id: params.id,
            sessionId,
            status: {
                state: 'working',
                message: {
                    role: 'agent',
                    parts: [{
                        type: 'text',
                        text: `Task accepted. Chain ${chainId} created for: ${text.slice(0, 100)}`,
                    }],
                },
            },
            history: mapping.history,
            metadata: { chainId, roomId },
        };
    }

    // ─── Task Get ────────────────────────────────────────────────

    getTask(taskId: string): A2ATask | undefined {
        const mapping = this.taskMappings.get(taskId);
        if (!mapping) return undefined;

        // Sync state from CoC
        this.syncTaskState(mapping);

        return {
            id: mapping.a2aTaskId,
            sessionId: mapping.sessionId,
            status: {
                state: mapping.state,
                message: this.getStatusMessage(mapping),
            },
            history: mapping.history,
            artifacts: mapping.artifacts,
            metadata: { chainId: mapping.chainId, roomId: mapping.roomId },
        };
    }

    // ─── Task Cancel ─────────────────────────────────────────────

    async cancelTask(taskId: string): Promise<A2ATask> {
        const mapping = this.taskMappings.get(taskId);
        if (!mapping) {
            return this.createErrorTask(taskId, '', 'Task not found');
        }

        await this.coc.closeChain(
            mapping.roomId,
            mapping.chainId,
            'cancelled',
            'Cancelled via A2A'
        );

        mapping.state = 'canceled';

        return {
            id: taskId,
            sessionId: mapping.sessionId,
            status: {
                state: 'canceled',
                message: {
                    role: 'agent',
                    parts: [{ type: 'text', text: 'Task cancelled.' }],
                },
            },
        };
    }

    // ─── JSON-RPC Handler ────────────────────────────────────────

    async handleJsonRpc(request: {
        jsonrpc: string;
        id: string | number;
        method: string;
        params?: Record<string, unknown>;
    }): Promise<{
        jsonrpc: string;
        id: string | number;
        result?: unknown;
        error?: { code: number; message: string };
    }> {
        const { id, method, params } = request;

        try {
            switch (method) {
                case 'tasks/send':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: await this.handleTaskSend(params as unknown as A2ATaskSendParams),
                    };
                case 'tasks/get':
                    const task = this.getTask(params?.id as string);
                    if (!task) {
                        return {
                            jsonrpc: '2.0',
                            id,
                            error: { code: -32602, message: 'Task not found' },
                        };
                    }
                    return { jsonrpc: '2.0', id, result: task };
                case 'tasks/cancel':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: await this.cancelTask(params?.id as string),
                    };
                case 'agent/authenticatedExtendedCard':
                    return { jsonrpc: '2.0', id, result: this.getAgentCard() };
                default:
                    return {
                        jsonrpc: '2.0',
                        id,
                        error: { code: -32601, message: `Method not found: ${method}` },
                    };
            }
        } catch (err) {
            return {
                jsonrpc: '2.0',
                id,
                error: { code: -32603, message: (err as Error).message },
            };
        }
    }

    // ─── Outbound: Society → A2A ─────────────────────────────────

    /**
     * Convert a completed Society chain into an A2A task response.
     */
    chainToA2ATask(chainId: string): A2ATask | undefined {
        // Find mapping by chainId
        let mapping: TaskMapping | undefined;
        for (const m of this.taskMappings.values()) {
            if (m.chainId === chainId) { mapping = m; break; }
        }
        if (!mapping) return undefined;

        this.syncTaskState(mapping);
        return this.getTask(mapping.a2aTaskId);
    }

    /**
     * Create A2A message from Society step output.
     */
    stepToA2AMessage(stepOutput: {
        memo: string;
        artifacts?: Array<{ artifact_type: string; content?: string }>;
    }): A2AMessage {
        const parts: A2APart[] = [{ type: 'text', text: stepOutput.memo }];

        if (stepOutput.artifacts) {
            for (const art of stepOutput.artifacts) {
                if (art.content) {
                    parts.push({
                        type: 'data',
                        data: { artifact_type: art.artifact_type, content: art.content },
                    });
                }
            }
        }

        return { role: 'agent', parts };
    }

    // ─── Internal Helpers ────────────────────────────────────────

    private syncTaskState(mapping: TaskMapping): void {
        const chain = this.coc.getChain(mapping.chainId);
        if (!chain) {
            mapping.state = 'unknown';
            return;
        }

        switch (chain.status) {
            case 'open':
            case 'running':
                mapping.state = 'working';
                break;
            case 'completed':
                mapping.state = 'completed';
                break;
            case 'failed':
                mapping.state = 'failed';
                break;
            default:
                mapping.state = 'working';
        }
    }

    private getStatusMessage(mapping: TaskMapping): A2AMessage {
        const chain = this.coc.getChain(mapping.chainId);
        const text = chain
            ? `Chain ${mapping.chainId}: ${chain.status} (${chain.steps?.length || 0} steps)`
            : `Chain ${mapping.chainId}: status unknown`;

        return {
            role: 'agent',
            parts: [{ type: 'text', text }],
        };
    }

    private createErrorTask(taskId: string, sessionId: string, error: string): A2ATask {
        return {
            id: taskId,
            sessionId,
            status: {
                state: 'failed',
                message: {
                    role: 'agent',
                    parts: [{ type: 'text', text: `Error: ${error}` }],
                },
            },
        };
    }

    private setupCocListeners(): void {
        this.coc.on('chain:completed', (chainId: string) => {
            for (const mapping of this.taskMappings.values()) {
                if (mapping.chainId === chainId) {
                    mapping.state = 'completed';
                    this.emit('a2a:task:completed', mapping.a2aTaskId, chainId);
                    break;
                }
            }
        });

        this.coc.on('step:submitted', (chainId: string, stepId: string, submission: any) => {
            for (const mapping of this.taskMappings.values()) {
                if (mapping.chainId === chainId && submission) {
                    const message = this.stepToA2AMessage(submission);
                    mapping.history.push(message);

                    if (submission.artifacts) {
                        for (const art of submission.artifacts) {
                            mapping.artifacts.push({
                                name: art.artifact_type || 'output',
                                parts: [{ type: 'text', text: art.content || '' }],
                            });
                        }
                    }
                    break;
                }
            }
        });
    }

    // ─── Stats ───────────────────────────────────────────────────

    getStats(): {
        activeTasks: number;
        completedTasks: number;
        failedTasks: number;
    } {
        let completed = 0, failed = 0;
        for (const m of this.taskMappings.values()) {
            if (m.state === 'completed') completed++;
            if (m.state === 'failed') failed++;
        }
        return {
            activeTasks: this.taskMappings.size - completed - failed,
            completedTasks: completed,
            failedTasks: failed,
        };
    }

    destroy(): void {
        this.taskMappings.clear();
        this.removeAllListeners();
    }
}
