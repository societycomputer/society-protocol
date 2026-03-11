import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SocietyMCPServer } from '../../src/mcp/server.js';

type RequestHandler = (request?: any) => Promise<any>;

describe('SocietyMCPServer Persona+ZKP JSON-RPC contract', () => {
    let client: any;
    let server: SocietyMCPServer;
    let handlers: Map<string, RequestHandler>;

    beforeEach(() => {
        client = {
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
            generatePersonaZkProof: vi.fn(async (input) => ({
                id: 'zkp_1',
                vaultId: input.vaultId || 'vault_1',
                circuitId: input.circuitId,
                proof: 'proof',
                publicInputs: input.publicInputs || {},
                claimIds: input.claimIds || [],
                createdAt: Date.now(),
                proofSystem: 'mock-noir-bb',
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
            getPersonaZkProof: vi.fn((proofId) => ({ id: proofId, circuitId: 'age_over_18' })),
        };

        server = new SocietyMCPServer({ client });
        handlers = (server as any).server._requestHandlers as Map<string, RequestHandler>;
    });

    it('supports tools/list and includes Persona+ZKP+Audit tools', async () => {
        const listTools = handlers.get('tools/list');
        expect(listTools).toBeTypeOf('function');
        const response = await listTools!({
            method: 'tools/list',
            params: {},
        });
        const toolNames = (response.tools || []).map((tool: any) => tool.name);
        expect(toolNames).toContain('persona_issue_claim');
        expect(toolNames).toContain('persona_generate_zk_proof');
        expect(toolNames).toContain('persona_verify_zk_proof');
        expect(toolNames).toContain('persona_verify_access_log');
        expect(toolNames).toContain('persona_run_retention_sweep');
    });

    it('routes tools/call for Persona+ZKP extensions', async () => {
        const callTool = handlers.get('tools/call');
        expect(callTool).toBeTypeOf('function');

        await callTool!({
            method: 'tools/call',
            params: {
                name: 'persona_issue_claim',
                arguments: { schema: 'domain-membership', payload: { domain: 'work' } },
            },
        });
        expect(client.issuePersonaClaim).toHaveBeenCalledTimes(1);

        await callTool!({
            method: 'tools/call',
            params: {
                name: 'persona_generate_zk_proof',
                arguments: { circuit_id: 'age_over_18', private_inputs: { dob: '1990-01-01' } },
            },
        });
        expect(client.generatePersonaZkProof).toHaveBeenCalledTimes(1);

        await callTool!({
            method: 'tools/call',
            params: {
                name: 'persona_verify_access_log',
                arguments: { log_id: 42 },
            },
        });
        expect(client.verifyPersonaAccessLog).toHaveBeenCalledWith({ logId: 42, capabilityToken: undefined, zkpProofs: undefined });

        await callTool!({
            method: 'tools/call',
            params: {
                name: 'persona_run_retention_sweep',
                arguments: { dry_run: true, domain: 'work' },
            },
        });
        expect(client.runPersonaRetentionSweep).toHaveBeenCalledWith({
            capabilityToken: undefined,
            zkpProofs: undefined,
            vaultId: undefined,
            domain: 'work',
            dryRun: true,
        });
    });

    it('supports resources/list/read and prompts/list/get in JSON-RPC flow', async () => {
        const listResources = handlers.get('resources/list');
        const readResource = handlers.get('resources/read');
        const listPrompts = handlers.get('prompts/list');
        const getPrompt = handlers.get('prompts/get');

        expect(listResources).toBeTypeOf('function');
        expect(readResource).toBeTypeOf('function');
        expect(listPrompts).toBeTypeOf('function');
        expect(getPrompt).toBeTypeOf('function');

        const resources = await listResources!({
            method: 'resources/list',
            params: {},
        });
        const uris = (resources.resources || []).map((resource: any) => resource.uri);
        expect(uris).toContain('persona://claims/{claim_id}');
        expect(uris).toContain('persona://zkp/circuits');
        expect(uris).toContain('persona://zkp/proofs/{proof_id}');

        const claim = await readResource!({
            method: 'resources/read',
            params: { uri: 'persona://claims/claim_abc' },
        });
        expect(claim.contents[0].text).toContain('claim_abc');

        const prompts = await listPrompts!({
            method: 'prompts/list',
            params: {},
        });
        const promptNames = (prompts.prompts || []).map((prompt: any) => prompt.name);
        expect(promptNames).toContain('persona_zkp_challenge');

        const zkpPrompt = await getPrompt!({
            method: 'prompts/get',
            params: { name: 'persona_zkp_challenge', arguments: { circuit_id: 'age_over_18' } },
        });
        expect(zkpPrompt.description).toContain('ZKP challenge');
        expect(zkpPrompt.messages[0].content.text).toContain('age_over_18');
    });
});
