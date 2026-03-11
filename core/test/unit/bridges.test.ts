/**
 * Tests for MCP Bridge and A2A Bridge
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { MCPBridge, type MCPBridgeConfig } from '../../src/bridges/mcp-bridge.js';
import { A2ABridge, type A2ABridgeConfig, type A2ATaskSendParams } from '../../src/bridges/a2a-bridge.js';
import { generateIdentity } from '../../src/identity.js';

// ─── Mock Factories ──────────────────────────────────────────────

function createMockStorage() {
    return {} as any;
}

function createMockRooms() {
    const rooms = new EventEmitter();
    (rooms as any).joinRoom = vi.fn().mockResolvedValue(undefined);
    (rooms as any).leaveRoom = vi.fn().mockResolvedValue(undefined);
    (rooms as any).sendChatMessage = vi.fn().mockResolvedValue(undefined);
    (rooms as any).getOnlinePeers = vi.fn().mockReturnValue([
        { peer_did: 'did:key:z1', peer_name: 'Agent-1', status: 'online' },
        { peer_did: 'did:key:z2', peer_name: 'Agent-2', status: 'busy' },
    ]);
    (rooms as any).getJoinedRooms = vi.fn().mockReturnValue(['room-1']);
    return rooms as any;
}

function createMockCoc() {
    const coc = new EventEmitter();
    (coc as any).openChain = vi.fn().mockResolvedValue('chain_001');
    (coc as any).publishPlan = vi.fn().mockResolvedValue(undefined);
    (coc as any).submitStep = vi.fn().mockResolvedValue(undefined);
    (coc as any).closeChain = vi.fn().mockResolvedValue(undefined);
    (coc as any).getActiveChains = vi.fn().mockReturnValue([
        {
            chain_id: 'chain_001',
            goal: 'Test collaboration',
            status: 'executing',
            room_id: 'room-1',
            steps: [
                { step_id: 's1', kind: 'task', title: 'Step 1', status: 'proposed' },
                { step_id: 's2', kind: 'review', title: 'Step 2', status: 'proposed' },
            ],
        },
    ]);
    (coc as any).getChain = vi.fn().mockImplementation((chainId: string) => {
        if (chainId === 'chain_001') {
            return {
                chain_id: 'chain_001',
                goal: 'Test collaboration',
                status: 'executing',
                room_id: 'room-1',
                steps: [
                    { step_id: 's1', kind: 'task', title: 'Step 1', status: 'proposed' },
                ],
            };
        }
        return undefined;
    });
    return coc as any;
}

function createMockKnowledge() {
    const kp = new EventEmitter();
    (kp as any).queryCards = vi.fn().mockReturnValue([
        { id: 'k1', title: 'Test Card', domain: 'test', confidence: 0.9 },
    ]);
    return kp as any;
}

// ─── MCP Bridge Tests ────────────────────────────────────────────

describe('MCPBridge', () => {
    let bridge: MCPBridge;
    let identity: ReturnType<typeof generateIdentity>;
    let rooms: ReturnType<typeof createMockRooms>;
    let coc: ReturnType<typeof createMockCoc>;
    let knowledge: ReturnType<typeof createMockKnowledge>;

    beforeEach(() => {
        identity = generateIdentity('MCP-Test');
        rooms = createMockRooms();
        coc = createMockCoc();
        knowledge = createMockKnowledge();

        bridge = new MCPBridge({
            identity,
            storage: createMockStorage(),
            rooms,
            coc,
            knowledge,
        });
    });

    describe('Session Management', () => {
        it('should create a session', () => {
            const session = bridge.createSession('claude-client-1');
            expect(session.sessionId).toBeTruthy();
            expect(session.mcpClientId).toBe('claude-client-1');
            expect(session.joinedRooms.size).toBe(0);
        });

        it('should destroy a session', () => {
            const session = bridge.createSession('client-2');
            bridge.destroySession(session.sessionId);
            expect(bridge.getSession(session.sessionId)).toBeUndefined();
        });

        it('should evict oldest session when max is reached', () => {
            const config: MCPBridgeConfig = {
                identity,
                storage: createMockStorage(),
                rooms,
                coc,
                knowledge,
                maxSessions: 2,
            };
            const b = new MCPBridge(config);
            const s1 = b.createSession('c1');
            const s2 = b.createSession('c2');
            const s3 = b.createSession('c3');

            expect(b.getSession(s1.sessionId)).toBeUndefined();
            expect(b.getSession(s2.sessionId)).toBeDefined();
            expect(b.getSession(s3.sessionId)).toBeDefined();
        });
    });

    describe('Tool Definitions', () => {
        it('should return tool definitions', () => {
            const tools = bridge.getToolDefinitions();
            expect(tools.length).toBeGreaterThanOrEqual(7);
            const names = tools.map(t => t.name);
            expect(names).toContain('society_join_room');
            expect(names).toContain('society_send_message');
            expect(names).toContain('society_open_chain');
            expect(names).toContain('society_submit_step');
            expect(names).toContain('society_list_peers');
            expect(names).toContain('society_search_knowledge');
            expect(names).toContain('society_list_chains');
        });
    });

    describe('Tool Execution', () => {
        it('should fail without session', async () => {
            const result = await bridge.executeTool('nonexistent', {
                name: 'society_list_peers',
                arguments: {},
            });
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Session not found');
        });

        it('should join a room', async () => {
            const session = bridge.createSession('client');
            const result = await bridge.executeTool(session.sessionId, {
                name: 'society_join_room',
                arguments: { room_id: 'research-lab' },
            });
            expect(result.isError).toBeUndefined();
            expect(result.content[0].text).toContain('Joined room');
            expect(rooms.joinRoom).toHaveBeenCalledWith('research-lab');
            expect(session.joinedRooms.has('research-lab')).toBe(true);
        });

        it('should send a message', async () => {
            const session = bridge.createSession('client');
            const result = await bridge.executeTool(session.sessionId, {
                name: 'society_send_message',
                arguments: { room_id: 'room-1', message: 'Hello agents!' },
            });
            expect(result.isError).toBeUndefined();
            expect(rooms.sendChatMessage).toHaveBeenCalledWith(
                'room-1', 'Hello agents!', { formatting: 'plain' }
            );
        });

        it('should open a chain', async () => {
            const session = bridge.createSession('client');
            const result = await bridge.executeTool(session.sessionId, {
                name: 'society_open_chain',
                arguments: { room_id: 'room-1', goal: 'Analyze rare disease data' },
            });
            expect(result.isError).toBeUndefined();
            expect(result.content[0].text).toContain('chain_001');
            expect(coc.openChain).toHaveBeenCalledWith('room-1', 'Analyze rare disease data', {
                priority: 'normal',
            });
        });

        it('should submit a step', async () => {
            const session = bridge.createSession('client');
            const result = await bridge.executeTool(session.sessionId, {
                name: 'society_submit_step',
                arguments: {
                    room_id: 'room-1',
                    chain_id: 'chain_001',
                    step_id: 's1',
                    status: 'completed',
                    memo: 'Analysis done',
                },
            });
            expect(result.isError).toBeUndefined();
            expect(coc.submitStep).toHaveBeenCalled();
        });

        it('should list peers', async () => {
            const session = bridge.createSession('client');
            const result = await bridge.executeTool(session.sessionId, {
                name: 'society_list_peers',
                arguments: {},
            });
            const peers = JSON.parse(result.content[0].text);
            expect(peers).toHaveLength(2);
            expect(peers[0].name).toBe('Agent-1');
        });

        it('should search knowledge', async () => {
            const session = bridge.createSession('client');
            const result = await bridge.executeTool(session.sessionId, {
                name: 'society_search_knowledge',
                arguments: { query: 'rare diseases', limit: 5 },
            });
            const cards = JSON.parse(result.content[0].text);
            expect(cards).toHaveLength(1);
            expect(cards[0].title).toBe('Test Card');
        });

        it('should list chains', async () => {
            const session = bridge.createSession('client');
            const result = await bridge.executeTool(session.sessionId, {
                name: 'society_list_chains',
                arguments: { room_id: 'room-1' },
            });
            const chains = JSON.parse(result.content[0].text);
            expect(chains).toHaveLength(1);
            expect(chains[0].goal).toBe('Test collaboration');
        });

        it('should handle unknown tool', async () => {
            const session = bridge.createSession('client');
            const result = await bridge.executeTool(session.sessionId, {
                name: 'nonexistent_tool',
                arguments: {},
            });
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Unknown tool');
        });
    });

    describe('Resources', () => {
        it('should list resources for a session', async () => {
            const session = bridge.createSession('client');
            await bridge.executeTool(session.sessionId, {
                name: 'society_join_room',
                arguments: { room_id: 'room-1' },
            });

            const resources = bridge.getResources(session.sessionId);
            // Should have room resource + chain resources
            expect(resources.length).toBeGreaterThanOrEqual(1);
            expect(resources.some(r => r.uri.includes('room/room-1'))).toBe(true);
        });

        it('should return empty for unknown session', () => {
            const resources = bridge.getResources('nonexistent');
            expect(resources).toHaveLength(0);
        });
    });

    describe('Stats', () => {
        it('should return stats', async () => {
            const s = bridge.createSession('c1');
            await bridge.executeTool(s.sessionId, {
                name: 'society_join_room',
                arguments: { room_id: 'r1' },
            });
            const stats = bridge.getStats();
            expect(stats.activeSessions).toBe(1);
            expect(stats.totalRooms).toBe(1);
        });
    });

    describe('Cleanup', () => {
        it('should destroy cleanly', () => {
            bridge.createSession('c1');
            bridge.createSession('c2');
            bridge.destroy();
            expect(bridge.getStats().activeSessions).toBe(0);
        });
    });
});

// ─── A2A Bridge Tests ────────────────────────────────────────────

describe('A2ABridge', () => {
    let bridge: A2ABridge;
    let identity: ReturnType<typeof generateIdentity>;
    let coc: ReturnType<typeof createMockCoc>;

    beforeEach(() => {
        identity = generateIdentity('A2A-Test');
        coc = createMockCoc();

        bridge = new A2ABridge({
            identity,
            storage: createMockStorage(),
            rooms: createMockRooms(),
            coc,
            knowledge: createMockKnowledge(),
            defaultRoom: 'default-room',
        });
    });

    describe('Agent Card', () => {
        it('should return a valid agent card', () => {
            const card = bridge.getAgentCard();
            expect(card.name).toBe('A2A-Test');
            expect(card.version).toBe('1.0.0');
            expect(card.capabilities.streaming).toBe(true);
            expect(card.capabilities.stateTransitionHistory).toBe(true);
            expect(card.skills.length).toBeGreaterThan(0);
            expect(card.defaultInputModes).toContain('text/plain');
        });

        it('should use custom skills if provided', () => {
            const customBridge = new A2ABridge({
                identity,
                storage: createMockStorage(),
                rooms: createMockRooms(),
                coc,
                knowledge: createMockKnowledge(),
                defaultRoom: 'room',
                exposedSkills: [
                    { id: 'custom', name: 'Custom', description: 'Custom skill', tags: ['custom'] },
                ],
            });
            const card = customBridge.getAgentCard();
            expect(card.skills).toHaveLength(1);
            expect(card.skills[0].id).toBe('custom');
        });
    });

    describe('Task Send', () => {
        it('should create a task from A2A message', async () => {
            const params: A2ATaskSendParams = {
                id: 'task-001',
                message: {
                    role: 'user',
                    parts: [{ type: 'text', text: 'Research rare disease X' }],
                },
            };

            const task = await bridge.handleTaskSend(params);
            expect(task.id).toBe('task-001');
            expect(task.status.state).toBe('working');
            expect(task.metadata?.chainId).toBe('chain_001');
            expect(coc.openChain).toHaveBeenCalledWith('default-room', 'Research rare disease X', {
                priority: 'normal',
            });
        });

        it('should use custom room from metadata', async () => {
            const params: A2ATaskSendParams = {
                id: 'task-002',
                message: {
                    role: 'user',
                    parts: [{ type: 'text', text: 'Analyze data' }],
                },
                metadata: { room_id: 'custom-room' },
            };

            await bridge.handleTaskSend(params);
            expect(coc.openChain).toHaveBeenCalledWith('custom-room', 'Analyze data', {
                priority: 'normal',
            });
        });

        it('should fail with empty message', async () => {
            const params: A2ATaskSendParams = {
                id: 'task-003',
                message: {
                    role: 'user',
                    parts: [{ type: 'data', data: { x: 1 } }],
                },
            };

            const task = await bridge.handleTaskSend(params);
            expect(task.status.state).toBe('failed');
        });
    });

    describe('Task Get', () => {
        it('should get task status', async () => {
            await bridge.handleTaskSend({
                id: 'task-get-1',
                message: {
                    role: 'user',
                    parts: [{ type: 'text', text: 'Do something' }],
                },
            });

            const task = bridge.getTask('task-get-1');
            expect(task).toBeDefined();
            expect(task!.id).toBe('task-get-1');
            expect(task!.status.state).toBe('working');
        });

        it('should return undefined for unknown task', () => {
            expect(bridge.getTask('nonexistent')).toBeUndefined();
        });
    });

    describe('Task Cancel', () => {
        it('should cancel a task', async () => {
            await bridge.handleTaskSend({
                id: 'task-cancel-1',
                message: {
                    role: 'user',
                    parts: [{ type: 'text', text: 'Cancel me' }],
                },
            });

            const result = await bridge.cancelTask('task-cancel-1');
            expect(result.status.state).toBe('canceled');
            expect(coc.closeChain).toHaveBeenCalled();
        });

        it('should fail canceling unknown task', async () => {
            const result = await bridge.cancelTask('nonexistent');
            expect(result.status.state).toBe('failed');
        });
    });

    describe('JSON-RPC Handler', () => {
        it('should handle tasks/send', async () => {
            const response = await bridge.handleJsonRpc({
                jsonrpc: '2.0',
                id: 1,
                method: 'tasks/send',
                params: {
                    id: 'rpc-task-1',
                    message: {
                        role: 'user',
                        parts: [{ type: 'text', text: 'RPC task' }],
                    },
                } as any,
            });

            expect(response.result).toBeDefined();
            expect((response.result as any).id).toBe('rpc-task-1');
        });

        it('should handle tasks/get', async () => {
            // First create a task
            await bridge.handleTaskSend({
                id: 'rpc-get-1',
                message: {
                    role: 'user',
                    parts: [{ type: 'text', text: 'Get me' }],
                },
            });

            const response = await bridge.handleJsonRpc({
                jsonrpc: '2.0',
                id: 2,
                method: 'tasks/get',
                params: { id: 'rpc-get-1' },
            });

            expect(response.result).toBeDefined();
            expect((response.result as any).id).toBe('rpc-get-1');
        });

        it('should handle tasks/cancel', async () => {
            await bridge.handleTaskSend({
                id: 'rpc-cancel-1',
                message: {
                    role: 'user',
                    parts: [{ type: 'text', text: 'Cancel via RPC' }],
                },
            });

            const response = await bridge.handleJsonRpc({
                jsonrpc: '2.0',
                id: 3,
                method: 'tasks/cancel',
                params: { id: 'rpc-cancel-1' },
            });

            expect(response.result).toBeDefined();
            expect((response.result as any).status.state).toBe('canceled');
        });

        it('should handle agent/authenticatedExtendedCard', async () => {
            const response = await bridge.handleJsonRpc({
                jsonrpc: '2.0',
                id: 4,
                method: 'agent/authenticatedExtendedCard',
            });

            expect(response.result).toBeDefined();
            expect((response.result as any).name).toBe('A2A-Test');
        });

        it('should return error for unknown method', async () => {
            const response = await bridge.handleJsonRpc({
                jsonrpc: '2.0',
                id: 5,
                method: 'unknown/method',
            });

            expect(response.error).toBeDefined();
            expect(response.error!.code).toBe(-32601);
        });

        it('should return error for nonexistent task get', async () => {
            const response = await bridge.handleJsonRpc({
                jsonrpc: '2.0',
                id: 6,
                method: 'tasks/get',
                params: { id: 'nonexistent' },
            });

            expect(response.error).toBeDefined();
            expect(response.error!.code).toBe(-32602);
        });
    });

    describe('Outbound Conversion', () => {
        it('should convert step to A2A message', () => {
            const message = bridge.stepToA2AMessage({
                memo: 'Analysis complete',
                artifacts: [
                    { artifact_type: 'report', content: 'Findings...' },
                ],
            });

            expect(message.role).toBe('agent');
            expect(message.parts.length).toBe(2);
            expect(message.parts[0]).toEqual({ type: 'text', text: 'Analysis complete' });
            expect(message.parts[1].type).toBe('data');
        });

        it('should convert chain to A2A task', async () => {
            await bridge.handleTaskSend({
                id: 'chain-conv-1',
                message: {
                    role: 'user',
                    parts: [{ type: 'text', text: 'Convert me' }],
                },
            });

            const task = bridge.chainToA2ATask('chain_001');
            expect(task).toBeDefined();
            expect(task!.id).toBe('chain-conv-1');
        });

        it('should return undefined for unknown chain', () => {
            expect(bridge.chainToA2ATask('unknown')).toBeUndefined();
        });
    });

    describe('Stats', () => {
        it('should return stats', async () => {
            await bridge.handleTaskSend({
                id: 't1',
                message: { role: 'user', parts: [{ type: 'text', text: 'Task 1' }] },
            });
            await bridge.handleTaskSend({
                id: 't2',
                message: { role: 'user', parts: [{ type: 'text', text: 'Task 2' }] },
            });

            const stats = bridge.getStats();
            expect(stats.activeTasks).toBe(2);
            expect(stats.completedTasks).toBe(0);
        });
    });

    describe('Event Forwarding', () => {
        it('should emit on task creation', async () => {
            const events: any[] = [];
            bridge.on('a2a:task:created', (...args) => events.push(args));

            await bridge.handleTaskSend({
                id: 'evt-1',
                message: { role: 'user', parts: [{ type: 'text', text: 'Event test' }] },
            });

            expect(events).toHaveLength(1);
            expect(events[0][0]).toBe('evt-1');
            expect(events[0][1]).toBe('chain_001');
        });

        it('should update state on chain completion', async () => {
            await bridge.handleTaskSend({
                id: 'comp-1',
                message: { role: 'user', parts: [{ type: 'text', text: 'Complete me' }] },
            });

            // Update mock to reflect completed chain before emitting event
            coc.getChain = vi.fn().mockReturnValue({
                chain_id: 'chain_001',
                goal: 'Complete me',
                status: 'completed',
                room_id: 'default-room',
                steps: [],
            });

            // Simulate chain completion
            coc.emit('chain:completed', 'chain_001');

            const task = bridge.getTask('comp-1');
            expect(task!.status.state).toBe('completed');
        });
    });

    describe('Cleanup', () => {
        it('should destroy cleanly', async () => {
            await bridge.handleTaskSend({
                id: 'd1',
                message: { role: 'user', parts: [{ type: 'text', text: 'Destroy test' }] },
            });
            bridge.destroy();
            expect(bridge.getStats().activeTasks).toBe(0);
        });
    });
});
