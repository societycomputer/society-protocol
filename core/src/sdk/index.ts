/**
 * Society Protocol — JavaScript/TypeScript SDK
 * 
 * @packageDocumentation
 * SDK oficial para integração com Society Protocol
 */

// Client principal
export {
    SocietyClient,
    createClient,
    society,
    useSociety,
    type SDKConfig,
    type SimpleConfig,
    type SummonOptions,
    type StepInfo,
    type ChainInfo,
    type PeerInfo,
} from './client.js';

export {
    ProactiveMissionEngine,
} from '../proactive/engine.js';

export {
    P2PSwarmRegistry,
} from '../proactive/swarm-registry.js';

export {
    SwarmScheduler,
} from '../proactive/scheduler.js';

export {
    MissionCheckpointService,
} from '../proactive/checkpoints.js';

export {
    ResearchWorkerNode,
} from '../workers/research-worker.js';

export type {
    ProactiveMissionSpec,
    MissionPolicy,
    ResearchPolicy,
    MissionStatus,
    MissionInfo,
    SwarmStatus,
    SwarmWorkerProfile,
    ResearchWorkerConfig,
    SwarmWorkerAnnouncement,
} from '../proactive/types.js';

// AGENTS.md (AAIF Standard)
export {
    generateAgentsMd,
    parseAgentsMd,
    generateSocietyAgentsMd,
    type AgentsMdConfig,
} from '../agents-md.js';

// Latent Space Collaboration
export {
    LatentSpaceEngine,
    DEFAULT_LATENT_CONFIG,
    type LatentThought,
    type AlignmentMetadata,
    type LatentWorkingMemory,
    type AgentArchitectureInfo,
    type LatentCollaborationConfig,
} from '../latent-space.js';

// Swarm Controller
export {
    SwarmController,
    DEFAULT_SWARM_CONTROLLER_CONFIG,
    type SwarmRole,
    type TimeWindow,
    type RecurrencePattern,
    type SwarmAgentProfile,
    type SwarmEvent,
    type SwarmEventType,
    type SwarmControllerConfig,
} from '../proactive/swarm-controller.js';

// Skills
export {
    SkillParser,
    SkillLoader,
    SkillExecutor,
    skillParser,
    skillLoader,
    skillExecutor,
    createSkillTemplate,
    type SkillManifest,
    type SkillExecutionContext,
    type SkillHook,
} from '../skills/parser.js';

// MCP Server
export {
    SocietyMCPServer,
    type MCPServerConfig,
} from '../mcp/server.js';

// Prompt Injection Guard
export {
    PromptInjectionDetector,
    SafePromptBuilder,
    InputValidator,
    SafeExpressionEvaluator,
    InputValidationError,
    FIELD_LIMITS,
    type ScanResult,
    type GuardConfig,
} from '../prompt-guard.js';

// Persona Vault
export {
    PersonaVaultEngine,
    type PersonaVault,
    type PersonaNode,
    type PersonaEdge,
    type AddMemoryInput,
    type UpdateMemoryInput,
    type MemoryQueryInput,
    type GraphQueryInput,
    type UpdatePreferenceInput,
    type IssueCapabilityInput,
    type CapabilityCaveats,
    type CapabilityToken,
    type IssueClaimInput,
    type PersonaClaim,
    type GenerateZkProofInput,
    type VerifyZkProofInput,
    type ZkProofBundle,
    type ZkVerifyResult,
    type PersonaSyncDelta,
    type SyncApplyResult,
} from '../persona/index.js';

// Gateway — Demand-driven agent spawning
export {
    DemandSpawner,
    DEFAULT_SPAWN_CONFIG,
    type SpawnConfig,
    type SpawnedAgent,
    type SpawnedTeam,
    type SpawnResult,
    type SpawnRuntime,
} from '../gateway/demand-spawner.js';

export {
    CapabilityRouter,
    type IncomingRequest,
    type RoutingDecision,
    type RoutingMode,
    type RoleSpec,
} from '../gateway/capability-router.js';

// Social Layer
export {
    SocialEngine,
    type AgentProfile,
    type FollowRelation,
    type InviteCode,
    type ActivityEvent,
    type ActivityType,
} from '../social.js';

// Version
export const VERSION = '1.3.1';

// Utility para verificar se está rodando em ambiente compatível
export function checkEnvironment(): {
    compatible: boolean;
    node?: boolean;
    browser?: boolean;
    issues: string[];
} {
    const issues: string[] = [];
    let node = false;
    let browser = false;

    // Check Node.js
    if (typeof process !== 'undefined' && process.versions?.node) {
        node = true;
        const version = parseInt(process.versions.node.split('.')[0]);
        if (version < 20) {
            issues.push(`Node.js version ${process.versions.node} is too old. Requires >= 20.0.0`);
        }
    }

    // Check Browser (simplificado)
    if (typeof globalThis !== 'undefined' && 'window' in globalThis && 'document' in globalThis) {
        browser = true;
        issues.push('Browser environment not fully supported yet. Use Node.js for full functionality.');
    }

    return {
        compatible: issues.length === 0,
        node,
        browser,
        issues,
    };
}

// Quick start helper
export async function quickStart(options: {
    name: string;
    room: string;
    bootstrap?: string[];
}): Promise<import('./client.js').SocietyClient> {
    const { createClient } = await import('./client.js');
    
    const client = await createClient({
        identity: { name: options.name },
        network: {
            bootstrap: options.bootstrap,
            enableGossipsub: true,
            enableDht: true,
        },
    });

    await client.joinRoom(options.room);
    console.log(`✓ Connected to Society as ${options.name}`);
    console.log(`✓ Joined room: ${options.room}`);
    console.log(`✓ Peer ID: ${client.getPeerId()}`);

    return client;
}
