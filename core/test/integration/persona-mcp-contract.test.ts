import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SocietyMCPServer } from '../../src/mcp/server.js';

describe('Persona MCP contract e2e JSON-RPC', () => {
    let mcpServer: SocietyMCPServer;
    let rpcClient: Client;
    let clientMock: any;

    beforeEach(async () => {
        clientMock = {
            getIdentity: vi.fn(() => ({ did: 'did:key:test', name: 'tester' })),
            getPeerId: vi.fn(() => 'peer_test'),
            getMultiaddrs: vi.fn(() => []),
            getJoinedRooms: vi.fn(() => []),
            getCapabilities: vi.fn(() => ['persona-vault']),
            joinRoom: vi.fn(async () => undefined),
            leaveRoom: vi.fn(async () => undefined),
            getPeers: vi.fn(async () => []),
            createPeering: vi.fn(async () => ({ id: 'peer_1' })),
            listPeerings: vi.fn(() => []),
            openBridge: vi.fn(async () => ({ id: 'bridge_1' })),
            listBridges: vi.fn(() => []),
            summon: vi.fn(async () => ({ chainId: 'c1' })),
            listChains: vi.fn(() => []),
            getChain: vi.fn(() => undefined),
            getPendingSteps: vi.fn(() => []),
            submitStep: vi.fn(async () => undefined),
            reviewStep: vi.fn(async () => undefined),
            cancelChain: vi.fn(async () => undefined),
            getReputation: vi.fn(() => ({ score: 0 })),
            sendMessage: vi.fn(async () => undefined),
            listTemplates: vi.fn(() => []),
            exportCapsule: vi.fn(async () => ({ ok: true })),
            addMemory: vi.fn(async (input) => ({ id: 'mem_1', ...input })),
            queryMemories: vi.fn(async () => ({ nodes: [] })),
            queryGraph: vi.fn(async () => ({ nodes: [], edges: [], hyperEdges: [] })),
            updatePreference: vi.fn(async (input) => ({ id: 'pref_1', ...input })),
            issueCapability: vi.fn(async (input) => ({ id: 'cap_1', ...input })),
            revokeCapability: vi.fn(async () => undefined),
            attenuateCapability: vi.fn(async () => ({ id: 'cap_child', parentTokenId: 'cap_1' })),
            shareSubgraph: vi.fn(async () => ({ vaultId: 'vault_1', nodes: [], edges: [], hyperEdges: [] })),
            getPersonaProfile: vi.fn(async () => ({ vaultId: 'vault_1' })),
            issuePersonaClaim: vi.fn(async (input) => ({ id: 'claim_1', ...input })),
            generatePersonaZkProof: vi.fn(async () => ({
                id: 'zkp_1',
                vaultId: 'vault_1',
                circuitId: 'age_over_18',
                proof: 'bb1.fake.sig',
                publicInputs: {},
                claimIds: [],
                createdAt: Date.now(),
                proofSystem: 'noir-bb',
            })),
            verifyPersonaZkProof: vi.fn(async () => ({ valid: true, circuitId: 'age_over_18' })),
            verifyPersonaAccessLog: vi.fn(async (input) => ({ logId: input.logId, valid: true })),
            runPersonaRetentionSweep: vi.fn(async () => ({ scanned: 10, deleted: 2 })),
            listPersonaCapabilities: vi.fn(async () => []),
            getPersonaCapability: vi.fn(async () => undefined),
            getPersonaClaim: vi.fn(async (claimId) => ({ id: claimId, schema: 'domain-membership' })),
            listPersonaZkCircuits: vi.fn(() => [
                {
                    circuitId: 'age_over_18',
                    publicInputs: ['minAge', 'referenceDate', 'subjectDid'],
                    privateInputs: ['dob'],
                    active: true,
                },
            ]),
            getPersonaZkProof: vi.fn((proofId) => ({ id: proofId, circuitId: 'age_over_18' }),
            ),
        };

        mcpServer = new SocietyMCPServer({ client: clientMock });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await mcpServer.connect(serverTransport);
        rpcClient = new Client({ name: 'persona-mcp-contract-client', version: '1.0.0' });
        await rpcClient.connect(clientTransport);
    });

    afterEach(async () => {
        await rpcClient?.close();
        await mcpServer?.stop();
    });

    it('supports tools/list and tools/call via JSON-RPC transport', async () => {
        const tools = await rpcClient.listTools();
        const names = (tools.tools || []).map((tool: any) => tool.name);
        expect(names).toContain('persona_verify_access_log');
        expect(names).toContain('persona_run_retention_sweep');

        const call = await rpcClient.callTool({
            name: 'persona_verify_access_log',
            arguments: { log_id: 7 },
        });
        const text = (call.content?.[0] as any)?.text || '';
        expect(text).toContain('"valid": true');
        expect(clientMock.verifyPersonaAccessLog).toHaveBeenCalledWith({
            logId: 7,
            capabilityToken: undefined,
            zkpProofs: undefined,
        });
    });

    it('supports resources/list/read and prompts/list/get via JSON-RPC transport', async () => {
        const resources = await rpcClient.listResources();
        const uris = (resources.resources || []).map((resource: any) => resource.uri);
        expect(uris).toContain('persona://zkp/circuits');
        expect(uris).toContain('persona://claims/{claim_id}');

        const claim = await rpcClient.readResource({ uri: 'persona://claims/claim_abc' });
        const claimText = (claim.contents?.[0] as any)?.text || '';
        expect(claimText).toContain('claim_abc');

        const prompts = await rpcClient.listPrompts();
        const promptNames = (prompts.prompts || []).map((prompt: any) => prompt.name);
        expect(promptNames).toContain('persona_zkp_challenge');

        const prompt = await rpcClient.getPrompt({
            name: 'persona_zkp_challenge',
            arguments: { circuit_id: 'age_over_18' },
        });
        expect(prompt.description || '').toContain('ZKP challenge');
    });

    it('enforces read-only mode for persona_run_retention_sweep', async () => {
        const readonlyServer = new SocietyMCPServer({ client: clientMock, enableReadOnly: true });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await readonlyServer.connect(serverTransport);
        const readonlyClient = new Client({ name: 'persona-mcp-readonly-client', version: '1.0.0' });
        await readonlyClient.connect(clientTransport);

        try {
            const result = await readonlyClient.callTool({
                name: 'persona_run_retention_sweep',
                arguments: { dry_run: true },
            });
            const text = (result.content?.[0] as any)?.text || '';
            expect(result.isError).toBe(true);
            expect(text).toContain('read-only');
        } finally {
            await readonlyClient.close();
            await readonlyServer.stop();
        }
    });
});
