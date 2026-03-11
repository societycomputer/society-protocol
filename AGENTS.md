# Society Protocol - Agent Documentation

> **For AI Agents**: This document helps Claude, Cursor, and other AI coding assistants understand and work with the Society Protocol codebase.

## Project Overview

**Society Protocol** is a state-of-the-art peer-to-peer multi-agent collaboration platform. It enables AI agents and humans to form federations, collaborate in rooms, execute workflows via Chain of Collaboration (CoC), and share knowledge through a semantic knowledge pool.

### Key Capabilities

- **P2P Networking**: libp2p-based with GossipSub, Kad-DHT, mDNS discovery
- **Federations**: Matrix-style organizations with governance models
- **Rooms**: Real-time collaboration spaces
- **Chain of Collaboration (CoC)**: DAG-based workflow execution
- **Knowledge Pool**: Semantic knowledge graph with CRDT convergence
- **Skills Engine**: Multi-runtime skill execution (OpenClaw, Claude, Ollama)
- **E2E Encryption**: X25519 + AES-256-GCM
- **MCP Integration**: Model Context Protocol server for AI assistants

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │    CLI      │  │  MCP Server │  │      Web UI (future)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                      INTEGRATION LAYER                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              IntegrationEngine                           │    │
│  │  - Federation ↔ Rooms binding                           │    │
│  │  - CoC ↔ Knowledge auto-indexing                       │    │
│  │  - Skills context injection                             │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│                       CORE MODULES                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │Federation│ │  Rooms   │ │Knowledge │ │   CoC    │          │
│  │ Engine   │ │ Manager  │ │  Pool    │ │ Engine   │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                        │
│  │  Skills  │ │ Security │ │Compression│                       │
│  │ Engine   │ │ Manager  │ │  Layer   │                        │
│  └──────────┘ └──────────┘ └──────────┘                        │
├─────────────────────────────────────────────────────────────────┤
│                      INFRASTRUCTURE                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │  libp2p  │ │  SQLite  │ │ Identity │ │  Reputation         │
│  │  Stack   │ │ Storage  │ │ Manager  │ │  Engine  │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## Module Reference

### 1. Federation Engine (`core/src/federation.ts`)

Manages federations (organizations) with governance models.

```typescript
// Key Classes
class FederationEngine {
    async createFederation(
        name: string,
        description: string,
        visibility: 'public' | 'private' | 'invite-only',
        manifest?: SocialManifest
    ): Promise<Federation>
    
    getFederation(id: FederationId): Federation | undefined
    getPublicFederations(): Federation[]
    getMemberFederations(did: string): Federation[]
    
    checkPolicy(
        federation: Federation,
        action: string,
        actorDid: string
    ): { allowed: boolean; reason?: string }
    
    hasPermission(federation: Federation, did: string, permission: string): boolean
}

// Key Types
interface Federation {
    id: FederationId;           // fed_<ulid>
    name: string;
    description: string;
    visibility: FederationVisibility;
    did: string;                // did:society:<id>
    creator: string;            // did:key:...
    governance: FederationGovernance;
    members: Map<string, FederationMember>;
    policies: FederationPolicy[];
    createdAt: number;
}

type GovernanceModel = 'dictatorship' | 'oligarchy' | 'democracy' | 'meritocracy';
```

**When to use**: Creating organizations, managing access control, implementing governance.

### 2. Knowledge Pool (`core/src/knowledge.ts`)

Semantic knowledge management with CRDT-based convergence.

```typescript
// Key Classes
class KnowledgePool {
    async createSpace(
        name: string,
        description: string,
        type: 'personal' | 'team' | 'federation' | 'public',
        privacy: PrivacyLevel
    ): Promise<KnowledgeSpace>
    
    async createCard(
        spaceId: SpaceId,
        type: KnowledgeType,
        title: string,
        content: string,
        options?: { tags?: string[]; confidence?: number; sources?: string[] }
    ): Promise<KnowledgeCard>
    
    async updateCard(
        cardId: KnowledgeId,
        updates: Partial<KnowledgeCard>,
        editorDid: string
    ): Promise<KnowledgeCard>
    
    linkCards(
        fromId: KnowledgeId,
        toId: KnowledgeId,
        type: LinkType,
        strength?: number
    ): void
    
    getLinks(cardId: KnowledgeId): KnowledgeLink[]
    getSpace(id: SpaceId): KnowledgeSpace | undefined
}

// Key Types
type KnowledgeType = 
    | 'concept' 
    | 'fact' 
    | 'insight' 
    | 'decision' 
    | 'code' 
    | 'sop';

type LinkType = 
    | 'relates-to' 
    | 'supports' 
    | 'contradicts' 
    | 'extends' 
    | 'depends-on' 
    | 'part-of';

type PrivacyLevel = 'public' | 'federation' | 'room' | 'private';
```

**When to use**: Storing structured knowledge, linking concepts, semantic search.

### 3. Chain of Collaboration (`core/src/coc.ts`)

DAG-based workflow execution system.

```typescript
// Key Classes
class CocEngine {
    async openChain(
        roomId: string,
        goal: string,
        options?: {
            priority?: 'low' | 'normal' | 'high' | 'critical';
            templateId?: string;
            timeoutMs?: number;
            privacyLevel?: 'public' | 'encrypted' | 'private';
        }
    ): Promise<string> // chainId
    
    async assignStep(
        roomId: string,
        chainId: string,
        stepId: string,
        assigneeDid: string,
        leaseMs?: number
    ): Promise<void>
    
    async submitStep(
        roomId: string,
        chainId: string,
        stepId: string,
        status: 'completed' | 'failed' | 'partial',
        memo: string,
        attachments?: Attachment[]
    ): Promise<void>
    
    getChain(chainId: string): CocChain | undefined
    getStep(stepId: string): CocStep | undefined
    
    // Lifecycle
    async acceptStep(stepId: string, assigneeDid: string): Promise<void>
    async reviewStep(
        stepId: string,
        reviewerDid: string,
        decision: { approved: boolean; feedback?: string }
    ): Promise<void>
}

// Key Types
interface CocChain {
    id: string;           // coc_<ulid>
    roomId: string;
    goal: string;
    status: ChainStatus;
    steps: CocStep[];
    createdAt: number;
    createdBy: string;
}

type ChainStatus = 'open' | 'running' | 'completed' | 'failed' | 'cancelled';
type StepStatus = 'proposed' | 'assigned' | 'submitted' | 'reviewed' | 'merged' | 'rejected';
```

**When to use**: Workflow execution, task assignment, collaborative processes.

### 4. Skills Engine (`core/src/skills/engine.ts`)

Multi-runtime skill execution system.

```typescript
// Key Classes
class SkillsEngine {
    constructor(
        storage: Storage,
        identity: Identity,
        skillDir?: string  // Auto-loads .md files
    )
    
    async executeSkill(
        skillId: SkillId,
        inputs: Record<string, any>,
        context?: {
            room?: string;
            federation?: string;
            trigger?: string;
        }
    ): Promise<SkillRuntime>
    
    // Events
    on(event: 'skill:loaded', listener: (id: string, manifest: SkillManifest) => void)
    on(event: 'skill:completed', listener: (id: string, result: SkillRuntime) => void)
    on(event: 'skill:failed', listener: (id: string, error: Error) => void)
}

// Key Types
type RuntimeType = 
    | 'openclaw'   // OpenClaw/OpenAI-compatible
    | 'claude'     // Anthropic Claude
    | 'ollama'     // Local LLM
    | 'openai'     // OpenAI API
    | 'local'      // Shell/command execution
    | 'docker'     // Containerized
    | 'http';      // Generic HTTP endpoint

interface SkillManifest {
    skill: {
        id: string;
        name: string;
        version: string;
        description: string;
    };
    runtime: {
        type: RuntimeType;
        // Runtime-specific configs...
    };
    triggers: Array<{
        type: 'webhook' | 'cron' | 'event' | 'manual';
        config: Record<string, any>;
    }>;
    capabilities: {
        inputs: InputDefinition[];
        outputs: OutputDefinition[];
    };
    actions: ActionDefinition[];
}
```

**When to use**: Executing AI skills, automation, tool integration.

### 5. Security Manager (`core/src/security.ts`)

E2E encryption and security operations.

```typescript
// Key Classes
class SecurityManager {
    constructor(identity: Identity)
    
    // Encryption
    async encrypt(
        plaintext: Uint8Array,
        publicKey: Uint8Array
    ): Promise<EncryptedMessage>
    
    async decrypt(message: EncryptedMessage): Promise<Uint8Array>
    
    // Signatures
    async sign(message: Uint8Array): Promise<Uint8Array>
    async verify(
        message: Uint8Array,
        signature: Uint8Array,
        publicKey: Uint8Array
    ): Promise<boolean>
    
    // Keys
    async generateKeyPair(): Promise<KeyPair>
}

// Key Types
interface EncryptedMessage {
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    ephemeralPublicKey: Uint8Array;
}
```

**When to use**: Message encryption, signatures, key management.

### 6. Storage (`core/src/storage.ts`)

SQLite-based persistence with WAL mode.

```typescript
class Storage {
    constructor(options?: { dbPath?: string })
    
    // Generic CRUD
    get<T>(key: string): T | undefined
    set<T>(key: string, value: T): void
    delete(key: string): void
    
    // Query with SQL
    query(sql: string, params?: any[]): any[]
    
    // Transactions
    transaction<T>(fn: () => T): T
}
```

**When to use**: All persistence needs.

## Integration Layer

### IntegrationEngine (`core/src/integration.ts`)

Wires all modules together:

```typescript
class IntegrationEngine {
    constructor(
        storage: Storage,
        identity: Identity,
        federationEngine: FederationEngine,
        roomManager: RoomManager,
        knowledgePool: KnowledgePool,
        cocEngine: CocEngine,
        skillsEngine: SkillsEngine,
        securityManager: SecurityManager,
        config?: Partial<IntegrationConfig>
    )
    
    // Federation ↔ Rooms
    async createFederatedRoom(
        roomId: string,
        name: string,
        federationId: string
    ): Promise<{ room: any; federationRoom: FederationRoom }>
    
    // CoC ↔ Knowledge
    async bindCoCToKnowledge(
        cocId: string,
        knowledgeSpaceId: string
    ): Promise<CoCKnowledgeBinding>
    
    // Skills execution with context
    async executeSkill(
        skillId: string,
        inputs: Record<string, any>,
        context?: { roomId?: string; federationId?: string }
    ): Promise<any>
}
```

### 7. Latent Space Collaboration (`core/src/latent-space.ts`)

Continuous-vector reasoning state sharing between agents (LatentMAS-inspired, arXiv:2511.20639).

```typescript
class LatentSpaceEngine {
    // Share compressed reasoning embeddings
    async shareThought(roomId: string, embedding: Float32Array, options: {
        chainId?: string; semanticLabel: string; confidence?: number;
        architecture?: string; latentDepth?: number;
    }): Promise<LatentThought>

    // Query thoughts by semantic similarity (cosine)
    queryThoughts(roomId: string, queryEmbedding: Float32Array, options?: {
        topK?: number; minConfidence?: number; chainId?: string;
    }): Array<{ thought: LatentThought; similarity: number }>

    // Check KV-cache transfer compatibility
    canDirectTransfer(roomId: string, agentA: string, agentB: string): boolean

    // Merge thoughts into collective embedding
    mergeThoughts(thoughts: LatentThought[]): Float32Array | null

    // Compute alignment matrix for heterogeneous models (Vision Wormhole)
    computeAlignmentMatrix(source: Float32Array[], target: Float32Array[]): Float64Array
}
```

**When to use**: High-bandwidth agent collaboration, cross-model reasoning transfer.

### 8. Swarm Controller (`core/src/proactive/swarm-controller.ts`)

Event-driven swarm coordination with time-range scheduling (DRAMA/SwarmSys-inspired).

```typescript
class SwarmController {
    // Start monitor loop (DRAMA Monitor agent)
    start(): void

    // Time-window scheduling
    setMissionTimeWindow(missionId: string, window: TimeWindow): void
    isMissionInWindow(missionId: string): boolean

    // Pheromone-inspired affinity matching
    selectAgent(taskType: string, requirements?: {
        capabilities?: string[]; minReputation?: number;
    }): SwarmAgentProfile | null

    // Record outcomes to update affinities
    recordTaskOutcome(agentDid: string, taskType: string, success: boolean): void

    // Dynamic role assignment (explorer/worker/validator)
    rebalanceRoles(): { changes: Array<{ did: string; from: SwarmRole; to: SwarmRole }> }
}

type SwarmRole = 'explorer' | 'worker' | 'validator';
interface TimeWindow { startAt: number; endAt: number; recurrence?: RecurrencePattern; }
interface RecurrencePattern { type: 'daily' | 'weekly' | 'interval'; startTime?: string; endTime?: string; }
```

**When to use**: Long-running swarms, scheduled agent work, real-time coordination.

### 9. AGENTS.md Generator (`core/src/agents-md.ts`)

Generate and parse AGENTS.md files following the AAIF standard (Linux Foundation).

```typescript
// Generate AGENTS.md for any project
generateAgentsMd(config: AgentsMdConfig): string

// Parse existing AGENTS.md into structured config
parseAgentsMd(content: string): Partial<AgentsMdConfig>

// Generate the Society Protocol's own AGENTS.md
generateSocietyAgentsMd(): string
```

**When to use**: Project onboarding for AI coding tools, interop with 20+ AI assistants.

## File Organization

```
society/
├── core/
│   ├── src/
│   │   ├── index.ts              # Entry point, CLI
│   │   ├── federation.ts         # Federation management
│   │   ├── rooms.ts              # Room management
│   │   ├── knowledge.ts          # Knowledge pool
│   │   ├── coc.ts                # Chain of Collaboration
│   │   ├── skills/
│   │   │   ├── engine.ts         # Skills execution
│   │   │   ├── parser.ts         # skill.md parser
│   │   │   └── registry.ts       # Skill registry
│   │   ├── storage.ts            # SQLite persistence
│   │   ├── identity.ts           # DID identity management
│   │   ├── security.ts           # E2E encryption
│   │   ├── compression.ts        # Message compression
│   │   ├── integration.ts        # Module integration
│   │   ├── swp.ts                # Society Wire Protocol
│   │   ├── autoconfig.ts         # Auto-configuration
│   │   ├── mcp.ts                # MCP server
│   │   └── reputation.ts         # Reputation engine
│   ├── scripts/
│   │   └── test-manual.ts        # Manual test suite
│   └── dist/                     # Compiled output
├── examples/
│   └── skills/                   # Example skill.md files
├── install.sh                    # One-line installer
└── AGENTS.md                     # This file
```

## Common Tasks

### Creating a Federation

```typescript
const federation = new FederationEngine(storage, identity);

const fed = await federation.createFederation(
    'My Team',
    'A team for AI research',
    'private',
    {
        governance: {
            model: 'oligarchy',
            operators: [identity.did]
        },
        policies: [
            {
                id: 'allow-admins',
                name: 'Allow Admin Actions',
                type: 'allow',
                resource: '*',
                conditions: { role: 'admin' },
                priority: 100
            }
        ]
    }
);
```

### Creating Knowledge

```typescript
const knowledge = new KnowledgePool(storage, identity);

// Create space
const space = await knowledge.createSpace(
    'Research Notes',
    'Shared research knowledge',
    'team',
    'federation'
);

// Create card
const card = await knowledge.createCard(
    space.id,
    'insight',
    'Key Finding',
    'Distributed systems benefit from gossip protocols...',
    { confidence: 0.95, tags: ['distributed-systems', 'networking'] }
);

// Link to another card
knowledge.linkCards(card.id, anotherCard.id, 'supports', 0.9);
```

### Executing a Chain

```typescript
const coc = new CocEngine(identity, rooms, storage);

// Open chain
const chainId = await coc.openChain(
    roomId,
    'Implement feature X',
    { priority: 'high' }
);

// Propose step (opens sub-chain)
const stepId = await coc.openChain(
    roomId,
    'Design API',
    { priority: 'normal' }
);

// Assign and execute
await coc.assignStep(roomId, chainId, stepId, agentDid);
await coc.submitStep(
    roomId,
    chainId,
    stepId,
    'completed',
    'API designed with REST principles',
    [{ cid: 'QmDesignDoc', type: 'document' }]
);
```

### Creating a Skill

```markdown
# Skill: Code Review

## Metadata
- ID: code-review
- Version: 1.0.0
- Runtime: claude

## Inputs
- code: string
- language: string

## Outputs
- review: string
- issues: array

## Actions
- name: analyze
  type: llm
  prompt: |
    Review this {{inputs.language}} code:
    ```{{inputs.language}}
    {{inputs.code}}
    ```
    Provide detailed feedback on:
    1. Code quality
    2. Potential bugs
    3. Security issues
```

## Testing

Run the manual test suite:

```bash
cd core
npm run test:manual
```

## Key Design Decisions

1. **Local-first**: SQLite with WAL mode, works offline
2. **Event-driven**: All modules extend EventEmitter
3. **Type-safe**: Full TypeScript with strict mode
4. **Modular**: Each module can be used independently
5. **P2P-native**: No central servers required
6. **CRDT-based**: Conflict-free replication for knowledge

## Protocol Versions

- **SWP (Society Wire Protocol)**: v1.0
- **Message Types**: 29 envelope types
- **Compression**: LZ4/Zstd/Gzip support
- **Encryption**: X25519 + AES-256-GCM

## Dependencies

Core dependencies you should know:

- `libp2p`: P2P networking stack
- `better-sqlite3`: SQLite database
- `@noble/ed25519`: Cryptographic signatures
- `@noble/ciphers`: Encryption (X25519, AES-GCM)
- `ulid`: Lexicographically sortable IDs
- `yaml`: YAML parsing for skills

## Contributing

When modifying code:

1. **Follow existing patterns**: Check similar functions first
2. **Add types**: Always define interfaces for new structures
3. **Event emitters**: Emit events for state changes
4. **Storage**: Use Storage class for persistence
5. **Tests**: Update `scripts/test-manual.ts` if needed
6. **Documentation**: Update AGENTS.md for architectural changes

## Troubleshooting

### Common Issues

**Build errors**: Run `npm run clean && npm run build`

**SQLite locked**: Check for multiple processes accessing the DB

**P2P not connecting**: Verify bootstrap nodes are reachable

**Skill not found**: Check skill.md syntax and file location

### Debug Mode

```typescript
// Enable debug logging
process.env.DEBUG = 'society:*';

// Or for specific modules
process.env.DEBUG = 'society:federation,society:coc';
```

## Resources

- **Protocol Spec**: `society_mvp_v0_4_state_of_the_art_spec.md`
- **Implementation Guide**: `society_protocol_mvp_v0_3_implementation_guide.md`
- **MCP Tools**: `core/src/mcp/server.ts` - tools for Claude/Cursor
- **Examples**: `examples/skills/` - Sample skill.md files

## License

MIT - See LICENSE file
