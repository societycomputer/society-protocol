/**
 * Society Protocol — MCP Bridge
 *
 * Bidirectional bridge allowing external MCP-compatible agents
 * (Claude, Cursor, etc.) to participate in Society Protocol
 * workflows natively.
 *
 * - Inbound: MCP tool calls → Society SWP actions
 * - Outbound: Society events → MCP notifications/resources
 */

import { EventEmitter } from 'events';
import { ulid } from 'ulid';
import type { Storage } from '../storage.js';
import type { RoomManager } from '../rooms.js';
import type { CocEngine } from '../coc.js';
import type { KnowledgePool } from '../knowledge.js';
import type { Identity } from '../identity.js';
import type { CocDagNode, Artifact } from '../swp.js';

// ─── Types ──────────────────────────────────────────────────────

export interface MCPBridgeConfig {
    identity: Identity;
    storage: Storage;
    rooms: RoomManager;
    coc: CocEngine;
    knowledge: KnowledgePool;
    /** Limit concurrent bridge sessions */
    maxSessions?: number;
}

export interface MCPToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export interface MCPToolCall {
    name: string;
    arguments: Record<string, unknown>;
}

export interface MCPToolResult {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}

export interface MCPResource {
    uri: string;
    name: string;
    mimeType: string;
    description?: string;
}

export interface MCPBridgeSession {
    sessionId: string;
    mcpClientId: string;
    adapterId?: string;
    joinedRooms: Set<string>;
    createdAt: number;
    lastActivity: number;
}

// ─── MCP Bridge ─────────────────────────────────────────────────

export class MCPBridge extends EventEmitter {
    private sessions = new Map<string, MCPBridgeSession>();
    private identity: Identity;
    private storage: Storage;
    private rooms: RoomManager;
    private coc: CocEngine;
    private knowledge: KnowledgePool;
    private maxSessions: number;

    constructor(config: MCPBridgeConfig) {
        super();
        this.identity = config.identity;
        this.storage = config.storage;
        this.rooms = config.rooms;
        this.coc = config.coc;
        this.knowledge = config.knowledge;
        this.maxSessions = config.maxSessions ?? 100;

        this.setupEventForwarding();
    }

    // ─── Session Management ──────────────────────────────────────

    createSession(mcpClientId: string): MCPBridgeSession {
        if (this.sessions.size >= this.maxSessions) {
            // Evict oldest session
            let oldest: MCPBridgeSession | undefined;
            for (const s of this.sessions.values()) {
                if (!oldest || s.lastActivity < oldest.lastActivity) oldest = s;
            }
            if (oldest) this.destroySession(oldest.sessionId);
        }

        const session: MCPBridgeSession = {
            sessionId: ulid(),
            mcpClientId,
            joinedRooms: new Set(),
            createdAt: Date.now(),
            lastActivity: Date.now(),
        };
        this.sessions.set(session.sessionId, session);
        this.emit('session:created', session);
        return session;
    }

    destroySession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        this.sessions.delete(sessionId);
        this.emit('session:destroyed', sessionId);
    }

    getSession(sessionId: string): MCPBridgeSession | undefined {
        return this.sessions.get(sessionId);
    }

    // ─── Tool Definitions ────────────────────────────────────────

    getToolDefinitions(): MCPToolDefinition[] {
        return [
            {
                name: 'society_join_room',
                description: 'Join a Society Protocol room to collaborate with agents',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: { type: 'string', description: 'Room identifier' },
                    },
                    required: ['room_id'],
                },
            },
            {
                name: 'society_send_message',
                description: 'Send a message to a Society room',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: { type: 'string', description: 'Room ID' },
                        message: { type: 'string', description: 'Message text' },
                    },
                    required: ['room_id', 'message'],
                },
            },
            {
                name: 'society_open_chain',
                description: 'Start a Chain of Collaboration workflow with a goal',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: { type: 'string', description: 'Room for the chain' },
                        goal: { type: 'string', description: 'Goal to achieve' },
                        priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
                    },
                    required: ['room_id', 'goal'],
                },
            },
            {
                name: 'society_submit_step',
                description: 'Submit results for an assigned step in a CoC chain',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: { type: 'string' },
                        chain_id: { type: 'string' },
                        step_id: { type: 'string' },
                        status: { type: 'string', enum: ['completed', 'failed', 'partial'] },
                        memo: { type: 'string', description: 'Output text' },
                    },
                    required: ['room_id', 'chain_id', 'step_id', 'status', 'memo'],
                },
            },
            {
                name: 'society_list_peers',
                description: 'List online peers in the network',
                inputSchema: { type: 'object', properties: {} },
            },
            {
                name: 'society_search_knowledge',
                description: 'Search the distributed knowledge pool',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Search query' },
                        limit: { type: 'number', description: 'Max results' },
                    },
                    required: ['query'],
                },
            },
            {
                name: 'society_list_chains',
                description: 'List active CoC chains in a room',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: { type: 'string' },
                    },
                    required: ['room_id'],
                },
            },
        ];
    }

    // ─── Tool Execution ──────────────────────────────────────────

    async executeTool(
        sessionId: string,
        call: MCPToolCall
    ): Promise<MCPToolResult> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return this.errorResult('Session not found. Create a session first.');
        }

        session.lastActivity = Date.now();

        try {
            switch (call.name) {
                case 'society_join_room':
                    return await this.handleJoinRoom(session, call.arguments);
                case 'society_send_message':
                    return await this.handleSendMessage(session, call.arguments);
                case 'society_open_chain':
                    return await this.handleOpenChain(session, call.arguments);
                case 'society_submit_step':
                    return await this.handleSubmitStep(session, call.arguments);
                case 'society_list_peers':
                    return this.handleListPeers();
                case 'society_search_knowledge':
                    return this.handleSearchKnowledge(call.arguments);
                case 'society_list_chains':
                    return this.handleListChains(call.arguments);
                default:
                    return this.errorResult(`Unknown tool: ${call.name}`);
            }
        } catch (err) {
            return this.errorResult(`Tool execution failed: ${(err as Error).message}`);
        }
    }

    // ─── Resource Listing ────────────────────────────────────────

    getResources(sessionId: string): MCPResource[] {
        const session = this.sessions.get(sessionId);
        if (!session) return [];

        const resources: MCPResource[] = [];

        // Rooms as resources
        for (const roomId of session.joinedRooms) {
            resources.push({
                uri: `society://room/${roomId}`,
                name: `Room: ${roomId}`,
                mimeType: 'application/json',
                description: `Society Protocol room ${roomId}`,
            });
        }

        // Active chains as resources
        const chains = this.coc.getActiveChains();
        for (const chain of chains) {
            resources.push({
                uri: `society://chain/${chain.chain_id}`,
                name: `Chain: ${chain.goal.slice(0, 50)}`,
                mimeType: 'application/json',
                description: `CoC chain ${chain.chain_id} — ${chain.status}`,
            });
        }

        return resources;
    }

    // ─── Tool Handlers ───────────────────────────────────────────

    private async handleJoinRoom(
        session: MCPBridgeSession,
        args: Record<string, unknown>
    ): Promise<MCPToolResult> {
        const roomId = args.room_id as string;
        if (!roomId) return this.errorResult('room_id is required');

        await this.rooms.joinRoom(roomId);
        session.joinedRooms.add(roomId);
        this.emit('mcp:room:joined', session.sessionId, roomId);

        return this.textResult(`Joined room ${roomId} successfully.`);
    }

    private async handleSendMessage(
        session: MCPBridgeSession,
        args: Record<string, unknown>
    ): Promise<MCPToolResult> {
        const roomId = args.room_id as string;
        const message = args.message as string;
        if (!roomId || !message) return this.errorResult('room_id and message are required');

        await this.rooms.sendChatMessage(roomId, message, { formatting: 'plain' });
        return this.textResult(`Message sent to room ${roomId}.`);
    }

    private async handleOpenChain(
        session: MCPBridgeSession,
        args: Record<string, unknown>
    ): Promise<MCPToolResult> {
        const roomId = args.room_id as string;
        const goal = args.goal as string;
        const priority = (args.priority as string) || 'normal';
        if (!roomId || !goal) return this.errorResult('room_id and goal are required');

        const chainId = await this.coc.openChain(roomId, goal, {
            priority: priority as 'low' | 'normal' | 'high' | 'critical',
        });

        this.emit('mcp:chain:opened', session.sessionId, chainId, goal);

        return this.textResult(
            `Chain opened: ${chainId}\nGoal: ${goal}\nPriority: ${priority}`
        );
    }

    private async handleSubmitStep(
        session: MCPBridgeSession,
        args: Record<string, unknown>
    ): Promise<MCPToolResult> {
        const roomId = args.room_id as string;
        const chainId = args.chain_id as string;
        const stepId = args.step_id as string;
        const status = args.status as 'completed' | 'failed' | 'partial';
        const memo = args.memo as string;

        if (!roomId || !chainId || !stepId || !status || !memo) {
            return this.errorResult('room_id, chain_id, step_id, status, and memo are required');
        }

        await this.coc.submitStep(roomId, chainId, stepId, status, memo, []);
        return this.textResult(
            `Step ${stepId} submitted with status: ${status}`
        );
    }

    private handleListPeers(): MCPToolResult {
        const peers = this.rooms.getOnlinePeers();
        const peerList = peers.map(p => ({
            did: p.peer_did,
            name: p.peer_name || 'Unknown',
            status: p.status,
        }));
        return this.textResult(JSON.stringify(peerList, null, 2));
    }

    private handleSearchKnowledge(args: Record<string, unknown>): MCPToolResult {
        const query = args.query as string;
        const limit = (args.limit as number) || 10;
        if (!query) return this.errorResult('query is required');

        const cards = this.knowledge.queryCards({ query, limit });
        const results = cards.map(c => ({
            id: c.id,
            title: c.title,
            domain: c.domain,
            confidence: c.confidence,
        }));
        return this.textResult(JSON.stringify(results, null, 2));
    }

    private handleListChains(args: Record<string, unknown>): MCPToolResult {
        const roomId = args.room_id as string;
        if (!roomId) return this.errorResult('room_id is required');

        const chains = this.coc.getActiveChains().filter(c => c.room_id === roomId);
        const list = chains.map(c => ({
            chain_id: c.chain_id,
            goal: c.goal,
            status: c.status,
            steps: c.steps.length,
        }));
        return this.textResult(JSON.stringify(list, null, 2));
    }

    // ─── Event Forwarding ────────────────────────────────────────

    private setupEventForwarding(): void {
        this.coc.on('step:unlocked', (chainId: string, stepId: string, step: any) => {
            this.emit('mcp:notification', {
                method: 'society/stepUnlocked',
                params: { chainId, stepId, kind: step.kind, title: step.title },
            });
        });

        this.coc.on('chain:completed', (chainId: string) => {
            this.emit('mcp:notification', {
                method: 'society/chainCompleted',
                params: { chainId },
            });
        });

        this.rooms.on('chat:message', (roomId: string, envelope: any) => {
            this.emit('mcp:notification', {
                method: 'society/chatMessage',
                params: {
                    roomId,
                    from: envelope.from,
                    text: envelope.body?.text,
                },
            });
        });
    }

    // ─── Helpers ─────────────────────────────────────────────────

    private textResult(text: string): MCPToolResult {
        return { content: [{ type: 'text', text }] };
    }

    private errorResult(message: string): MCPToolResult {
        return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }

    // ─── Stats ───────────────────────────────────────────────────

    getStats(): { activeSessions: number; totalRooms: number } {
        let totalRooms = 0;
        for (const s of this.sessions.values()) {
            totalRooms += s.joinedRooms.size;
        }
        return { activeSessions: this.sessions.size, totalRooms };
    }

    destroy(): void {
        for (const sessionId of this.sessions.keys()) {
            this.destroySession(sessionId);
        }
        this.removeAllListeners();
    }
}
