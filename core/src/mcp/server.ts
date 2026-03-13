/**
 * Society Protocol — MCP (Model Context Protocol) Server
 * 
 * Permite que agentes compatíveis com MCP (Claude, Cursor, etc)
 * usem Society Protocol nativamente.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema,
    Prompt,
    Resource,
    Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { type SocietyClient } from '../sdk/client.js';
import { InputValidator, InputValidationError } from '../prompt-guard.js';

export interface MCPServerConfig {
    client: SocietyClient;
    enableReadOnly?: boolean;
}

export class SocietyMCPServer {
    private server: Server;
    private client: SocietyClient;
    private validator: InputValidator;
    private enableReadOnly: boolean;

    constructor(config: MCPServerConfig) {
        this.client = config.client;
        this.enableReadOnly = config.enableReadOnly ?? false;
        this.validator = new InputValidator();

        this.server = new Server(
            {
                name: 'society',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                    resources: {},
                    prompts: {},
                },
            }
        );

        this.registerToolHandlers();
        this.registerResourceHandlers();
        this.registerPromptHandlers();
    }

    private registerToolHandlers(): void {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: this.getTools(),
        }));

        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            try {
                const result = await this.handleToolCall(name, args);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${(error as Error).message}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }

    private registerResourceHandlers(): void {
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
            resources: this.getResources(),
        }));

        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const uri = request.params?.uri;
            const resource = await this.handleReadResource(uri);
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(resource, null, 2),
                    },
                ],
            };
        });
    }

    private registerPromptHandlers(): void {
        this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
            prompts: this.getPrompts(),
        }));

        this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
            const prompt = await this.handleGetPrompt(
                request.params?.name,
                request.params?.arguments || {}
            );
            return {
                description: prompt.description,
                messages: prompt.messages,
            };
        });
    }

    private getTools(): Tool[] {
        const tools: Tool[] = [
            {
                name: 'society_get_status',
                description: 'Get current Society node status including identity, connected peers, and joined rooms',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'society_join_room',
                description: 'Join a Society collaboration room to participate in multi-agent workflows',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: {
                            type: 'string',
                            description: 'Unique identifier for the room',
                        },
                        display_name: {
                            type: 'string',
                            description: 'Display name to use in this room (optional)',
                        },
                    },
                    required: ['room_id'],
                },
            },
            {
                name: 'society_leave_room',
                description: 'Leave a Society room',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: {
                            type: 'string',
                            description: 'Room to leave',
                        },
                    },
                    required: ['room_id'],
                },
            },
            {
                name: 'society_list_rooms',
                description: 'List all rooms currently joined',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'society_get_peers',
                description: 'Get list of connected peers in a room',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: {
                            type: 'string',
                            description: 'Room to get peers from',
                        },
                    },
                    required: ['room_id'],
                },
            },
            {
                name: 'society_request_peering',
                description: 'Request peering between a local federation and a remote federation DID with trust policy',
                inputSchema: {
                    type: 'object',
                    properties: {
                        source_federation_id: {
                            type: 'string',
                            description: 'Local federation ID that will initiate peering',
                        },
                        target_federation_did: {
                            type: 'string',
                            description: 'Remote federation DID (did:society:...)',
                        },
                        policy: {
                            type: 'object',
                            description: 'Optional trust policy (allowedTypes, maxRatePerMinute, privacyMode)',
                        },
                    },
                    required: ['source_federation_id', 'target_federation_did'],
                },
            },
            {
                name: 'society_list_peerings',
                description: 'List peering requests and active peerings for a federation',
                inputSchema: {
                    type: 'object',
                    properties: {
                        federation_id: {
                            type: 'string',
                            description: 'Federation ID',
                        },
                        status: {
                            type: 'string',
                            enum: ['pending', 'active', 'rejected', 'revoked'],
                            description: 'Optional status filter',
                        },
                    },
                    required: ['federation_id'],
                },
            },
            {
                name: 'society_open_bridge',
                description: 'Open a mesh bridge between local and remote rooms through an active peering',
                inputSchema: {
                    type: 'object',
                    properties: {
                        peering_id: {
                            type: 'string',
                            description: 'Active peering ID',
                        },
                        local_room_id: {
                            type: 'string',
                            description: 'Local room ID',
                        },
                        remote_room_id: {
                            type: 'string',
                            description: 'Remote room ID',
                        },
                        rules: {
                            type: 'object',
                            description: 'Optional bridge rules override',
                        },
                    },
                    required: ['peering_id', 'local_room_id', 'remote_room_id'],
                },
            },
            {
                name: 'society_list_bridges',
                description: 'List federation mesh bridges and metrics',
                inputSchema: {
                    type: 'object',
                    properties: {
                        federation_id: {
                            type: 'string',
                            description: 'Optional federation ID filter',
                        },
                    },
                },
            },
            {
                name: 'society_summon',
                description: 'Start a new collaborative chain (workflow) with AI-generated or template-based plan',
                inputSchema: {
                    type: 'object',
                    properties: {
                        goal: {
                            type: 'string',
                            description: 'High-level goal or objective for the collaboration',
                        },
                        room_id: {
                            type: 'string',
                            description: 'Room to create the chain in',
                        },
                        template: {
                            type: 'string',
                            description: 'Optional template to use (e.g., "software_feature", "research_swarm")',
                        },
                        priority: {
                            type: 'string',
                            enum: ['low', 'normal', 'high', 'critical'],
                            description: 'Priority level for this collaboration',
                        },
                    },
                    required: ['goal', 'room_id'],
                },
            },
            {
                name: 'society_start_mission',
                description: 'Start a proactive scientific research mission with swarm workers',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: { type: 'string', description: 'Mission room' },
                        goal: { type: 'string', description: 'Research goal' },
                        template: {
                            type: 'string',
                            enum: ['literature_review_continuous', 'hypothesis_swarm', 'research_monitor'],
                            description: 'Mission template',
                        },
                        cadence_ms: { type: 'number', description: 'Mission cadence in milliseconds' },
                    },
                    required: ['goal', 'room_id'],
                },
            },
            {
                name: 'society_pause_mission',
                description: 'Pause a proactive mission',
                inputSchema: {
                    type: 'object',
                    properties: {
                        mission_id: { type: 'string', description: 'Mission ID' },
                    },
                    required: ['mission_id'],
                },
            },
            {
                name: 'society_resume_mission',
                description: 'Resume a proactive mission',
                inputSchema: {
                    type: 'object',
                    properties: {
                        mission_id: { type: 'string', description: 'Mission ID' },
                    },
                    required: ['mission_id'],
                },
            },
            {
                name: 'society_stop_mission',
                description: 'Stop a proactive mission',
                inputSchema: {
                    type: 'object',
                    properties: {
                        mission_id: { type: 'string', description: 'Mission ID' },
                        reason: { type: 'string', description: 'Optional reason' },
                    },
                    required: ['mission_id'],
                },
            },
            {
                name: 'society_list_missions',
                description: 'List proactive missions',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: { type: 'string', description: 'Optional room filter' },
                    },
                },
            },
            {
                name: 'society_get_swarm_status',
                description: 'Get worker visibility and capacity in the swarm',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: { type: 'string', description: 'Optional room filter' },
                    },
                },
            },
            {
                name: 'society_start_research_swarm',
                description: 'Start this node as a research worker for a room',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: { type: 'string', description: 'Mission room' },
                        host_id: { type: 'string', description: 'Worker host identifier' },
                        runtime: { type: 'string', enum: ['nanobot', 'docker', 'ollama', 'custom'] },
                        specialties: { type: 'array', items: { type: 'string' } },
                        capabilities: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['room_id', 'host_id', 'runtime'],
                },
            },
            {
                name: 'society_list_chains',
                description: 'List active collaboration chains in a room',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: {
                            type: 'string',
                            description: 'Room to list chains from',
                        },
                        status: {
                            type: 'string',
                            enum: ['all', 'open', 'running', 'completed'],
                            description: 'Filter by chain status',
                        },
                    },
                    required: ['room_id'],
                },
            },
            {
                name: 'society_get_chain',
                description: 'Get detailed information about a specific chain including all steps and their status',
                inputSchema: {
                    type: 'object',
                    properties: {
                        chain_id: {
                            type: 'string',
                            description: 'ID of the chain to get',
                        },
                    },
                    required: ['chain_id'],
                },
            },
            {
                name: 'society_get_pending_steps',
                description: 'Get steps assigned to this agent that are ready to work on',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'society_submit_step',
                description: 'Submit work result for a step you are assigned to',
                inputSchema: {
                    type: 'object',
                    properties: {
                        step_id: {
                            type: 'string',
                            description: 'ID of the step to submit',
                        },
                        status: {
                            type: 'string',
                            enum: ['completed', 'failed', 'partial'],
                            description: 'Completion status of the step',
                        },
                        result: {
                            type: 'string',
                            description: 'Detailed result, output, or explanation of the work done',
                        },
                        artifacts: {
                            type: 'array',
                            description: 'Optional list of artifact references (file paths, URLs)',
                            items: {
                                type: 'string',
                            },
                        },
                    },
                    required: ['step_id', 'status', 'result'],
                },
            },
            {
                name: 'society_review_step',
                description: 'Review a step that is pending approval',
                inputSchema: {
                    type: 'object',
                    properties: {
                        step_id: {
                            type: 'string',
                            description: 'ID of the step to review',
                        },
                        decision: {
                            type: 'string',
                            enum: ['approved', 'rejected', 'needs_revision'],
                            description: 'Review decision',
                        },
                        notes: {
                            type: 'string',
                            description: 'Review notes and feedback',
                        },
                    },
                    required: ['step_id', 'decision', 'notes'],
                },
            },
            {
                name: 'society_cancel_chain',
                description: 'Cancel an active chain',
                inputSchema: {
                    type: 'object',
                    properties: {
                        chain_id: {
                            type: 'string',
                            description: 'ID of the chain to cancel',
                        },
                        reason: {
                            type: 'string',
                            description: 'Reason for cancellation',
                        },
                    },
                    required: ['chain_id'],
                },
            },
            {
                name: 'society_get_reputation',
                description: 'Get reputation score for an agent (or yourself if no DID provided)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        did: {
                            type: 'string',
                            description: 'DID of the agent (optional, defaults to self)',
                        },
                    },
                },
            },
            {
                name: 'society_send_message',
                description: 'Send a chat message to a room',
                inputSchema: {
                    type: 'object',
                    properties: {
                        room_id: {
                            type: 'string',
                            description: 'Room to send message to',
                        },
                        message: {
                            type: 'string',
                            description: 'Message content',
                        },
                        reply_to: {
                            type: 'string',
                            description: 'Message ID to reply to (optional)',
                        },
                    },
                    required: ['room_id', 'message'],
                },
            },
            {
                name: 'society_list_templates',
                description: 'List available collaboration templates',
                inputSchema: {
                    type: 'object',
                    properties: {
                        category: {
                            type: 'string',
                            description: 'Filter by category (software, research, creative, medical, business)',
                        },
                    },
                },
            },
            {
                name: 'society_export_capsule',
                description: 'Export a completed chain as a portable capsule',
                inputSchema: {
                    type: 'object',
                    properties: {
                        chain_id: {
                            type: 'string',
                            description: 'Chain to export',
                        },
                        output_path: {
                            type: 'string',
                            description: 'Directory to save the capsule',
                        },
                    },
                    required: ['chain_id'],
                },
            },
            {
                name: 'persona_add_memory',
                description: 'Add memory to Persona Vault',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        zkp_proofs: { type: 'array', items: { type: 'object' } },
                        vault_id: { type: 'string' },
                        domain: { type: 'string' },
                        type: { type: 'string' },
                        title: { type: 'string' },
                        content: { type: 'string' },
                        tags: { type: 'array', items: { type: 'string' } },
                        confidence: { type: 'number' },
                    },
                    required: ['domain', 'type', 'title', 'content'],
                },
            },
            {
                name: 'persona_search_memories',
                description: 'Search memories using hybrid lexical+graph retrieval',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        zkp_proofs: { type: 'array', items: { type: 'object' } },
                        vault_id: { type: 'string' },
                        query: { type: 'string' },
                        domain: { type: 'string' },
                        limit: { type: 'number' },
                    },
                },
            },
            {
                name: 'persona_query_graph',
                description: 'Query Persona Vault graph',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        zkp_proofs: { type: 'array', items: { type: 'object' } },
                        vault_id: { type: 'string' },
                        root_node_id: { type: 'string' },
                        domain: { type: 'string' },
                        max_depth: { type: 'number' },
                        limit: { type: 'number' },
                    },
                },
            },
            {
                name: 'persona_update_preference',
                description: 'Update user preference in Persona Vault',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        zkp_proofs: { type: 'array', items: { type: 'object' } },
                        vault_id: { type: 'string' },
                        key: { type: 'string' },
                        value: {},
                        confidence: { type: 'number' },
                        domain: { type: 'string' },
                    },
                    required: ['key', 'value'],
                },
            },
            {
                name: 'persona_issue_capability',
                description: 'Issue attenuable capability token for Persona Vault access',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        zkp_proofs: { type: 'array', items: { type: 'object' } },
                        vault_id: { type: 'string' },
                        service_did: { type: 'string' },
                        scope: { type: 'string' },
                        caveats: { type: 'object' },
                    },
                    required: ['service_did', 'scope', 'caveats'],
                },
            },
            {
                name: 'persona_revoke_capability',
                description: 'Revoke previously issued capability token',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        zkp_proofs: { type: 'array', items: { type: 'object' } },
                        token_id: { type: 'string' },
                        reason: { type: 'string' },
                    },
                    required: ['token_id', 'reason'],
                },
            },
            {
                name: 'persona_attenuate_capability',
                description: 'Attenuate an existing capability token caveat set',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        zkp_proofs: { type: 'array', items: { type: 'object' } },
                        token_id: { type: 'string' },
                        caveats_patch: { type: 'object' },
                    },
                    required: ['token_id', 'caveats_patch'],
                },
            },
            {
                name: 'persona_issue_claim',
                description: 'Issue a Persona claim (self-claim or issuer-claim)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        zkp_proofs: { type: 'array', items: { type: 'object' } },
                        vault_id: { type: 'string' },
                        schema: { type: 'string' },
                        payload: { type: 'object' },
                        subject_did: { type: 'string' },
                        issuer_did: { type: 'string' },
                        issuer_signature: { type: 'string' },
                        expires_at: { type: 'number' },
                    },
                    required: ['schema', 'payload'],
                },
            },
            {
                name: 'persona_generate_zk_proof',
                description: 'Generate a ZKP bundle for a supported Persona circuit',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        vault_id: { type: 'string' },
                        circuit_id: { type: 'string' },
                        private_inputs: { type: 'object' },
                        public_inputs: { type: 'object' },
                        claim_ids: { type: 'array', items: { type: 'string' } },
                        expires_at: { type: 'number' },
                    },
                    required: ['circuit_id', 'private_inputs'],
                },
            },
            {
                name: 'persona_verify_zk_proof',
                description: 'Verify a ZKP bundle for a supported Persona circuit',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        vault_id: { type: 'string' },
                        proof_bundle: { type: 'object' },
                    },
                    required: ['proof_bundle'],
                },
            },
            {
                name: 'persona_share_subgraph',
                description: 'Export a portable subgraph from Persona Vault',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        zkp_proofs: { type: 'array', items: { type: 'object' } },
                        vault_id: { type: 'string' },
                        domain: { type: 'string' },
                        node_ids: { type: 'array', items: { type: 'string' } },
                        include_neighbors: { type: 'boolean' },
                    },
                },
            },
            {
                name: 'persona_get_profile',
                description: 'Get current Persona profile snapshot',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        zkp_proofs: { type: 'array', items: { type: 'object' } },
                        vault_id: { type: 'string' },
                    },
                },
            },
            {
                name: 'persona_verify_access_log',
                description: 'Verify signature integrity of one persona access log entry',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        zkp_proofs: { type: 'array', items: { type: 'object' } },
                        log_id: { type: 'number' },
                    },
                    required: ['log_id'],
                },
            },
            {
                name: 'persona_run_retention_sweep',
                description: 'Run retention cleanup sweep by vault/domain (supports dry-run)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        capability_token: { type: 'string' },
                        zkp_proofs: { type: 'array', items: { type: 'object' } },
                        vault_id: { type: 'string' },
                        domain: { type: 'string' },
                        dry_run: { type: 'boolean' },
                    },
                },
            },
        ];

        if (this.enableReadOnly) {
            // Filter to only read-only operations
            return tools.filter(t =>
                ['society_get_status', 'society_list_rooms', 'society_get_peers',
                 'society_list_chains', 'society_get_chain', 'society_get_pending_steps',
                 'society_get_reputation', 'society_list_templates',
                 'society_list_peerings', 'society_list_bridges',
                 'persona_search_memories', 'persona_query_graph', 'persona_get_profile',
                 'persona_verify_zk_proof', 'persona_verify_access_log'].includes(t.name)
            );
        }

        return tools;
    }

    private getResources(): Resource[] {
        return [
            {
                uri: 'persona://profile',
                name: 'Persona Profile',
                description: 'Current profile snapshot from Persona Vault',
                mimeType: 'application/json',
            },
            {
                uri: 'persona://memory/{id}',
                name: 'Persona Memory by ID',
                description: 'Single memory resource by id',
                mimeType: 'application/json',
            },
            {
                uri: 'persona://preferences/{category}',
                name: 'Persona Preferences by Category',
                description: 'Preference subset by category',
                mimeType: 'application/json',
            },
            {
                uri: 'persona://graph/{domain}',
                name: 'Persona Graph by Domain',
                description: 'Graph view scoped to domain',
                mimeType: 'application/json',
            },
            {
                uri: 'persona://capabilities/{token_id}',
                name: 'Persona Capability by Token',
                description: 'Capability token metadata',
                mimeType: 'application/json',
            },
            {
                uri: 'persona://capabilities/active',
                name: 'Persona Active Capabilities',
                description: 'List active capability grants',
                mimeType: 'application/json',
            },
            {
                uri: 'persona://claims/{claim_id}',
                name: 'Persona Claim by ID',
                description: 'Claim metadata and status by claim id',
                mimeType: 'application/json',
            },
            {
                uri: 'persona://zkp/circuits',
                name: 'Persona ZKP Circuits',
                description: 'Supported ZKP circuits and metadata',
                mimeType: 'application/json',
            },
            {
                uri: 'persona://zkp/proofs/{proof_id}',
                name: 'Persona ZKP Proof by ID',
                description: 'Generated proof bundle metadata',
                mimeType: 'application/json',
            },
        ];
    }

    private getPrompts(): Prompt[] {
        return [
            {
                name: 'persona_context',
                description: 'Generate assistant context from Persona Vault profile',
                arguments: [{ name: 'vault_id', description: 'Optional vault id', required: false }],
            },
            {
                name: 'persona_preferences_snapshot',
                description: 'Generate concise preference summary for personalization',
                arguments: [{ name: 'vault_id', description: 'Optional vault id', required: false }],
            },
            {
                name: 'persona_memory_digest',
                description: 'Generate top memory digest for a query',
                arguments: [
                    { name: 'query', description: 'Query text', required: false },
                    { name: 'vault_id', description: 'Optional vault id', required: false },
                ],
            },
            {
                name: 'persona_zkp_challenge',
                description: 'Generate a challenge prompt for proving persona claims with ZKP',
                arguments: [
                    { name: 'circuit_id', description: 'ZKP circuit id', required: true },
                    { name: 'vault_id', description: 'Optional vault id', required: false },
                ],
            },
        ];
    }

    private validateToolArgs(name: string, args: any): any {
        if (!args) return args;
        try {
            switch (name) {
                case 'society_summon':
                case 'society_start_mission':
                    if (args.goal) args.goal = this.validator.validateGoal(args.goal);
                    break;
                case 'society_submit_step':
                    if (args.result) args.result = this.validator.validateOutput(args.result);
                    break;
                case 'society_send_message':
                    if (args.message) args.message = this.validator.validateMessage(args.message);
                    break;
                case 'society_review_step':
                    if (args.notes) args.notes = this.validator.validateField(args.notes, 'notes');
                    break;
                case 'persona_add_memory':
                    if (args.content) args.content = this.validator.validateContent(args.content);
                    if (args.title) args.title = this.validator.validateTitle(args.title);
                    break;
                case 'society_create_knowledge':
                    if (args.content) args.content = this.validator.validateContent(args.content);
                    if (args.title) args.title = this.validator.validateTitle(args.title);
                    break;
            }
        } catch (e) {
            if (e instanceof InputValidationError) throw e;
        }
        return args;
    }

    private async handleToolCall(name: string, args: any): Promise<any> {
        args = this.validateToolArgs(name, args);
        switch (name) {
            case 'society_get_status':
                return this.handleGetStatus();
            case 'society_join_room':
                return this.handleJoinRoom(args);
            case 'society_leave_room':
                return this.handleLeaveRoom(args);
            case 'society_list_rooms':
                return this.handleListRooms();
            case 'society_get_peers':
                return this.handleGetPeers(args);
            case 'society_request_peering':
                return this.handleRequestPeering(args);
            case 'society_list_peerings':
                return this.handleListPeerings(args);
            case 'society_open_bridge':
                return this.handleOpenBridge(args);
            case 'society_list_bridges':
                return this.handleListBridges(args);
            case 'society_summon':
                return this.handleSummon(args);
            case 'society_start_mission':
                return this.handleStartMission(args);
            case 'society_pause_mission':
                return this.handlePauseMission(args);
            case 'society_resume_mission':
                return this.handleResumeMission(args);
            case 'society_stop_mission':
                return this.handleStopMission(args);
            case 'society_list_missions':
                return this.handleListMissions(args);
            case 'society_get_swarm_status':
                return this.handleGetSwarmStatus(args);
            case 'society_start_research_swarm':
                return this.handleStartResearchSwarm(args);
            case 'society_list_chains':
                return this.handleListChains(args);
            case 'society_get_chain':
                return this.handleGetChain(args);
            case 'society_get_pending_steps':
                return this.handleGetPendingSteps();
            case 'society_submit_step':
                return this.handleSubmitStep(args);
            case 'society_review_step':
                return this.handleReviewStep(args);
            case 'society_cancel_chain':
                return this.handleCancelChain(args);
            case 'society_get_reputation':
                return this.handleGetReputation(args);
            case 'society_send_message':
                return this.handleSendMessage(args);
            case 'society_list_templates':
                return this.handleListTemplates(args);
            case 'society_export_capsule':
                return this.handleExportCapsule(args);
            case 'persona_add_memory':
                return this.handlePersonaAddMemory(args);
            case 'persona_search_memories':
                return this.handlePersonaSearchMemories(args);
            case 'persona_query_graph':
                return this.handlePersonaQueryGraph(args);
            case 'persona_update_preference':
                return this.handlePersonaUpdatePreference(args);
            case 'persona_issue_capability':
                return this.handlePersonaIssueCapability(args);
            case 'persona_revoke_capability':
                return this.handlePersonaRevokeCapability(args);
            case 'persona_attenuate_capability':
                return this.handlePersonaAttenuateCapability(args);
            case 'persona_issue_claim':
                return this.handlePersonaIssueClaim(args);
            case 'persona_generate_zk_proof':
                return this.handlePersonaGenerateZkProof(args);
            case 'persona_verify_zk_proof':
                return this.handlePersonaVerifyZkProof(args);
            case 'persona_share_subgraph':
                return this.handlePersonaShareSubgraph(args);
            case 'persona_get_profile':
                return this.handlePersonaGetProfile(args);
            case 'persona_verify_access_log':
                return this.handlePersonaVerifyAccessLog(args);
            case 'persona_run_retention_sweep':
                return this.handlePersonaRunRetentionSweep(args);
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    // ─── Tool Handlers ────────────────────────────────────────────

    private async handleGetStatus(): Promise<any> {
        return {
            identity: this.client.getIdentity(),
            network: {
                peer_id: this.client.getPeerId(),
                addresses: this.client.getMultiaddrs(),
            },
            rooms: this.client.getJoinedRooms(),
            capabilities: this.client.getCapabilities(),
        };
    }

    private async handleJoinRoom(args: any): Promise<any> {
        await this.client.joinRoom(args.room_id);
        return { success: true, room_id: args.room_id };
    }

    private async handleLeaveRoom(args: any): Promise<any> {
        await this.client.leaveRoom(args.room_id);
        return { success: true, room_id: args.room_id };
    }

    private async handleListRooms(): Promise<any> {
        return { rooms: this.client.getJoinedRooms() };
    }

    private async handleGetPeers(args: any): Promise<any> {
        const peers = await this.client.getPeers(args.room_id);
        return { room_id: args.room_id, peers };
    }

    private async handleRequestPeering(args: any): Promise<any> {
        const peering = await this.client.createPeering(
            args.source_federation_id,
            args.target_federation_did,
            args.policy
        );
        return { peering };
    }

    private async handleListPeerings(args: any): Promise<any> {
        const peerings = this.client.listPeerings(args.federation_id, args.status);
        return { peerings };
    }

    private async handleOpenBridge(args: any): Promise<any> {
        const bridge = await this.client.openBridge(
            args.peering_id,
            args.local_room_id,
            args.remote_room_id,
            args.rules
        );
        return { bridge };
    }

    private async handleListBridges(args: any): Promise<any> {
        const bridges = this.client.listBridges(args.federation_id);
        const stats = this.client.getMeshStats(args.federation_id);
        return { bridges, stats };
    }

    private async handleSummon(args: any): Promise<any> {
        const chain = await this.client.summon({
            goal: args.goal,
            roomId: args.room_id,
            template: args.template,
            priority: args.priority,
        });
        return { chain_id: chain.id, steps: chain.steps.length };
    }

    private async handleStartMission(args: any): Promise<any> {
        const mission = await this.client.startMission({
            roomId: args.room_id,
            goal: args.goal,
            missionType: 'scientific_research',
            templateId: args.template,
            mode: 'continuous',
            cadenceMs: args.cadence_ms || 300000,
            policy: {
                autonomy: 'semiautonomous',
                approvalGates: ['publish', 'external_write', 'costly_action'],
                swarm: {
                    minWorkers: 2,
                    maxWorkers: 12,
                    targetUtilization: 0.7,
                    leaseMs: 120000,
                    rebalanceIntervalMs: 30000,
                },
                retry: {
                    maxStepRetries: 3,
                    maxMissionReplans: 20,
                    cooldownMs: 60000,
                },
            },
            research: {
                sources: ['arxiv', 'pubmed', 'crossref', 'semantic-scholar', 'web'],
                subdomainsPerCycle: 4,
                requireDualReview: true,
                requireCitationExtraction: true,
                requireContradictionScan: true,
                synthesisIntervalMs: args.cadence_ms || 300000,
            },
            knowledge: {
                autoIndex: true,
            },
        });
        return { mission };
    }

    private async handlePauseMission(args: any): Promise<any> {
        await this.client.pauseMission(args.mission_id);
        return { success: true, mission_id: args.mission_id };
    }

    private async handleResumeMission(args: any): Promise<any> {
        await this.client.resumeMission(args.mission_id);
        return { success: true, mission_id: args.mission_id };
    }

    private async handleStopMission(args: any): Promise<any> {
        await this.client.stopMission(args.mission_id, args.reason);
        return { success: true, mission_id: args.mission_id };
    }

    private async handleListMissions(args: any): Promise<any> {
        const missions = await this.client.listMissions(args.room_id);
        return { missions };
    }

    private async handleGetSwarmStatus(args: any): Promise<any> {
        const swarm = await this.client.getSwarmStatus(args.room_id);
        return { swarm };
    }

    private async handleStartResearchSwarm(args: any): Promise<any> {
        await this.client.startResearchWorker({
            roomId: args.room_id,
            hostId: args.host_id,
            runtime: args.runtime,
            specialties: args.specialties || [],
            capabilities: args.capabilities || [],
        });
        return { success: true, room_id: args.room_id, host_id: args.host_id };
    }

    private async handleListChains(args: any): Promise<any> {
        const chains = await this.client.listChains(args.room_id);
        return { chains };
    }

    private async handleGetChain(args: any): Promise<any> {
        const chain = await this.client.getChain(args.chain_id);
        return { chain };
    }

    private async handleGetPendingSteps(): Promise<any> {
        const steps = await this.client.getPendingSteps();
        return { steps, count: steps.length };
    }

    private async handleSubmitStep(args: any): Promise<any> {
        await this.client.submitStep(args.step_id, {
            status: args.status,
            output: args.result,
            artifacts: args.artifacts,
        });
        return { success: true, step_id: args.step_id };
    }

    private async handleReviewStep(args: any): Promise<any> {
        await this.client.reviewStep(args.step_id, args.decision, args.notes);
        return { success: true, step_id: args.step_id };
    }

    private async handleCancelChain(args: any): Promise<any> {
        await this.client.cancelChain(args.chain_id, args.reason);
        return { success: true, chain_id: args.chain_id };
    }

    private async handleGetReputation(args: any): Promise<any> {
        const did = args.did || this.client.getIdentity().did;
        const rep = await this.client.getReputation(did);
        return { did, reputation: rep };
    }

    private async handleSendMessage(args: any): Promise<any> {
        await this.client.sendMessage(args.room_id, args.message, args.reply_to);
        return { success: true };
    }

    private async handleListTemplates(args: any): Promise<any> {
        const templates = this.client.listTemplates(args.category);
        return { templates };
    }

    private async handleExportCapsule(args: any): Promise<any> {
        const path = await this.client.exportCapsule(args.chain_id, args.output_path);
        return { success: true, path };
    }

    private async handlePersonaAddMemory(args: any): Promise<any> {
        return this.client.addMemory({
            capabilityToken: args.capability_token,
            zkpProofs: args.zkp_proofs,
            vaultId: args.vault_id,
            domain: args.domain,
            type: args.type,
            title: args.title,
            content: args.content,
            tags: args.tags,
            confidence: args.confidence,
            source: { type: 'mcp', actorDid: this.client.getIdentity().did },
        });
    }

    private async handlePersonaSearchMemories(args: any): Promise<any> {
        return this.client.queryMemories({
            capabilityToken: args.capability_token,
            zkpProofs: args.zkp_proofs,
            vaultId: args.vault_id,
            query: args.query,
            domain: args.domain,
            limit: args.limit,
        });
    }

    private async handlePersonaQueryGraph(args: any): Promise<any> {
        return this.client.queryGraph({
            capabilityToken: args.capability_token,
            zkpProofs: args.zkp_proofs,
            vaultId: args.vault_id,
            rootNodeId: args.root_node_id,
            domain: args.domain,
            maxDepth: args.max_depth,
            limit: args.limit,
        });
    }

    private async handlePersonaUpdatePreference(args: any): Promise<any> {
        return this.client.updatePreference({
            capabilityToken: args.capability_token,
            zkpProofs: args.zkp_proofs,
            vaultId: args.vault_id,
            key: args.key,
            value: args.value,
            confidence: args.confidence,
            domain: args.domain || 'preferences',
        });
    }

    private async handlePersonaIssueCapability(args: any): Promise<any> {
        return this.client.issueCapability({
            capabilityToken: args.capability_token,
            zkpProofs: args.zkp_proofs,
            vaultId: args.vault_id,
            serviceDid: args.service_did,
            scope: args.scope,
            caveats: args.caveats,
        });
    }

    private async handlePersonaRevokeCapability(args: any): Promise<any> {
        await this.client.revokeCapability(args.token_id, args.reason, {
            capabilityToken: args.capability_token,
            zkpProofs: args.zkp_proofs,
        });
        return { success: true, token_id: args.token_id };
    }

    private async handlePersonaAttenuateCapability(args: any): Promise<any> {
        const token = await this.client.attenuateCapability(
            args.token_id,
            args.caveats_patch || {},
            {
                capabilityToken: args.capability_token,
                zkpProofs: args.zkp_proofs,
            }
        );
        return { token };
    }

    private async handlePersonaIssueClaim(args: any): Promise<any> {
        return this.client.issuePersonaClaim({
            capabilityToken: args.capability_token,
            zkpProofs: args.zkp_proofs,
            vaultId: args.vault_id,
            schema: args.schema,
            payload: args.payload || {},
            subjectDid: args.subject_did,
            issuerDid: args.issuer_did,
            issuerSignature: args.issuer_signature,
            expiresAt: args.expires_at,
        });
    }

    private async handlePersonaGenerateZkProof(args: any): Promise<any> {
        return this.client.generatePersonaZkProof({
            capabilityToken: args.capability_token,
            vaultId: args.vault_id,
            circuitId: args.circuit_id,
            privateInputs: args.private_inputs || {},
            publicInputs: args.public_inputs || {},
            claimIds: args.claim_ids || [],
            expiresAt: args.expires_at,
        });
    }

    private async handlePersonaVerifyZkProof(args: any): Promise<any> {
        return this.client.verifyPersonaZkProof({
            capabilityToken: args.capability_token,
            vaultId: args.vault_id,
            proofBundle: args.proof_bundle,
        });
    }

    private async handlePersonaShareSubgraph(args: any): Promise<any> {
        return this.client.shareSubgraph({
            capabilityToken: args.capability_token,
            zkpProofs: args.zkp_proofs,
            vaultId: args.vault_id,
            domain: args.domain,
            nodeIds: args.node_ids,
            includeNeighbors: args.include_neighbors,
        });
    }

    private async handlePersonaGetProfile(args: any): Promise<any> {
        return this.client.getPersonaProfile(args.vault_id, {
            capabilityToken: args.capability_token,
            zkpProofs: args.zkp_proofs,
        });
    }

    private async handlePersonaVerifyAccessLog(args: any): Promise<any> {
        return this.client.verifyPersonaAccessLog({
            logId: Number(args.log_id),
            capabilityToken: args.capability_token,
            zkpProofs: args.zkp_proofs,
        });
    }

    private async handlePersonaRunRetentionSweep(args: any): Promise<any> {
        if (this.enableReadOnly) {
            throw new Error('Tool not available in read-only mode: persona_run_retention_sweep');
        }
        return this.client.runPersonaRetentionSweep({
            capabilityToken: args.capability_token,
            zkpProofs: args.zkp_proofs,
            vaultId: args.vault_id,
            domain: args.domain,
            dryRun: args.dry_run,
        });
    }

    private async handleReadResource(uri: string): Promise<any> {
        if (!uri) throw new Error('Resource URI is required');

        if (uri === 'persona://profile') {
            return this.client.getPersonaProfile();
        }

        if (uri.startsWith('persona://memory/')) {
            const id = uri.slice('persona://memory/'.length);
            const result = await this.client.queryMemories({ query: id, limit: 5 });
            return { memoryId: id, matches: result.nodes };
        }

        if (uri.startsWith('persona://preferences/')) {
            const category = uri.slice('persona://preferences/'.length);
            const result = await this.client.queryMemories({
                domain: 'preferences',
                query: category === 'default' ? undefined : category,
                limit: 100,
            });
            return { category, preferences: result.nodes };
        }

        if (uri.startsWith('persona://graph/')) {
            const domain = uri.slice('persona://graph/'.length);
            return this.client.queryGraph({
                domain: domain as any,
                limit: 200,
            });
        }

        if (uri === 'persona://capabilities/active') {
            const capabilities = await this.client.listPersonaCapabilities();
            return {
                count: capabilities.filter((c) => c.status === 'active').length,
                capabilities: capabilities.filter((c) => c.status === 'active'),
            };
        }

        if (uri.startsWith('persona://capabilities/')) {
            const tokenId = uri.slice('persona://capabilities/'.length);
            const cap = await this.client.getPersonaCapability(tokenId);
            if (!cap) {
                throw new Error(`Capability not found: ${tokenId}`);
            }
            return cap;
        }

        if (uri.startsWith('persona://claims/')) {
            const claimId = uri.slice('persona://claims/'.length);
            const claim = await this.client.getPersonaClaim(claimId);
            if (!claim) {
                throw new Error(`Claim not found: ${claimId}`);
            }
            return claim;
        }

        if (uri === 'persona://zkp/circuits') {
            return {
                circuits: this.client.listPersonaZkCircuits(),
            };
        }

        if (uri.startsWith('persona://zkp/proofs/')) {
            const proofId = uri.slice('persona://zkp/proofs/'.length);
            const proof = this.client.getPersonaZkProof(proofId);
            if (!proof) {
                throw new Error(`Proof not found: ${proofId}`);
            }
            return proof;
        }

        throw new Error(`Unsupported resource URI: ${uri}`);
    }

    private async handleGetPrompt(name?: string, args: Record<string, string> = {}): Promise<any> {
        switch (name) {
            case 'persona_context': {
                const profile = await this.client.getPersonaProfile(args.vault_id);
                return {
                    description: 'Persona context for assistant personalization',
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Use this persona profile to personalize responses:\\n${JSON.stringify(profile, null, 2)}`,
                            },
                        },
                    ],
                };
            }
            case 'persona_preferences_snapshot': {
                const prefs = await this.client.queryMemories({
                    vaultId: args.vault_id,
                    domain: 'preferences',
                    limit: 50,
                });
                return {
                    description: 'Preference snapshot',
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Preferences:\\n${JSON.stringify(prefs.nodes, null, 2)}`,
                            },
                        },
                    ],
                };
            }
            case 'persona_memory_digest': {
                const memories = await this.client.queryMemories({
                    vaultId: args.vault_id,
                    query: args.query,
                    limit: 20,
                });
                return {
                    description: 'Memory digest',
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Top memories for query \"${args.query || ''}\":\\n${JSON.stringify(memories.nodes, null, 2)}`,
                            },
                        },
                    ],
                };
            }
            case 'persona_zkp_challenge': {
                const circuits = this.client.listPersonaZkCircuits();
                const circuit = circuits.find((item: any) => item.circuitId === args.circuit_id);
                if (!circuit) {
                    throw new Error(`Unknown circuit: ${args.circuit_id}`);
                }
                return {
                    description: 'Prompt template for ZKP challenge flow',
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text:
                                    `Prepare a ZKP challenge for circuit "${args.circuit_id}".\n` +
                                    `Use persona vault ${args.vault_id || '(default)'}.\n` +
                                    `Required public inputs: ${JSON.stringify(circuit.publicInputs || [])}\n` +
                                    `Return a JSON object with: { public_inputs, proof_request_reason, expires_at }.`,
                            },
                        },
                    ],
                };
            }
            default:
                throw new Error(`Unknown prompt: ${name}`);
        }
    }

    // ─── Lifecycle ───────────────────────────────────────────────

    async connect(transport: { start?: () => Promise<void>; close?: () => Promise<void> }): Promise<void> {
        await this.server.connect(transport as any);
    }

    async run(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.connect(transport);
        console.error('Society MCP Server running on stdio');
    }

    async stop(): Promise<void> {
        await this.server.close();
    }
}
