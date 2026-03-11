/**
 * Society Protocol — SQLite Storage Module v1.0
 *
 * Local-first persistence: identity, rooms, messages, presence, 
 * CoC chains/steps/events, adapters, reputation, and artifact lineage.
 * Uses better-sqlite3 for synchronous, fast SQLite access.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import * as sqliteVec from 'sqlite-vec';
import type { TaskOutcome } from './reputation.js';
import type { Artifact } from './swp.js';

const SCHEMA_VERSION = 14;

export interface StorageOptions {
    /** Path to the database file. Defaults to ~/.society/society.db */
    dbPath?: string;
    /** Optional SQLCipher key (also read from SOCIETY_DB_KEY) */
    encryptionKey?: string;
    /** Allow plaintext fallback when SQLCipher is unavailable */
    allowPlaintextDev?: boolean;
}

export type FederationPeeringStatus = 'pending' | 'active' | 'rejected' | 'revoked';
export type FederationBridgeStatus = 'active' | 'closed';
export type FederationSyncDirection = 'in' | 'out';

export type PersonaCapabilityStatus = 'active' | 'revoked' | 'expired';

export interface PersonaVaultRecord {
    id: string;
    ownerDid: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    settings?: Record<string, unknown>;
    lifecycle?: Record<string, unknown>;
}

export interface PersonaNodeRecord {
    id: string;
    vaultId: string;
    domain: string;
    type: string;
    title: string;
    content: string;
    tags: string[];
    confidence: number;
    metadata: Record<string, unknown>;
    source?: Record<string, unknown>;
    validFrom?: number;
    validTo?: number;
    createdAt: number;
    updatedAt: number;
    deletedAt?: number;
}

export interface PersonaEdgeRecord {
    id: string;
    vaultId: string;
    sourceNodeId: string;
    targetNodeId: string;
    type: string;
    weight: number;
    confidence: number;
    metadata: Record<string, unknown>;
    validFrom?: number;
    validTo?: number;
    updatedAt: number;
    deletedAt?: number;
}

export interface PersonaHyperEdgeRecord {
    id: string;
    vaultId: string;
    nodeIds: string[];
    type: string;
    metadata: Record<string, unknown>;
    updatedAt: number;
    deletedAt?: number;
}

export interface PersonaCrdtDocRecord {
    docId: string;
    vaultId: string;
    domain: string;
    data: Record<string, unknown>;
    clock: Record<string, number>;
    updatedAt: number;
}

export interface PersonaCapabilityRecord {
    id: string;
    vaultId: string;
    serviceDid: string;
    scope: string;
    caveats: Record<string, unknown>;
    tokenHash: string;
    status: PersonaCapabilityStatus;
    issuedAt: number;
    expiresAt?: number;
    revokedAt?: number;
    parentTokenId?: string;
}

export interface PersonaEmbeddingRecord {
    nodeId: string;
    vaultId: string;
    model: string;
    dim: number;
    vector?: number[];
    vecRowId?: number;
    updatedAt: number;
}

export interface PersonaClaimRecord {
    id: string;
    vaultId: string;
    subjectDid: string;
    issuerDid?: string;
    schema: string;
    payloadEnc: string;
    status: 'active' | 'revoked' | 'expired';
    issuedAt: number;
    expiresAt?: number;
    revokedAt?: number;
    signature: string;
}

export interface PersonaZkpProofRecord {
    id: string;
    vaultId: string;
    circuitId: string;
    proofBlob: string;
    publicInputs: Record<string, unknown>;
    claimIds: string[];
    createdAt: number;
    expiresAt?: number;
}

export interface PersonaZkpCircuitRecord {
    circuitId: string;
    version: string;
    vkBlob?: string | null;
    metadata: Record<string, unknown>;
    active: boolean;
}

export interface PersonaAccessLogRecord {
    id?: number;
    vaultId: string;
    tokenId?: string;
    serviceDid: string;
    operation: string;
    resource: string;
    result: 'allowed' | 'denied';
    details?: Record<string, unknown>;
    ts: number;
    signature?: string;
    signerDid?: string;
    sigAlg?: string;
}

export interface PersonaSyncStateRecord {
    peerDid: string;
    vaultId: string;
    cursorId: string;
    clock: Record<string, number>;
    updatedAt: number;
}

export interface PersonaRetentionStateRecord {
    vaultId: string;
    domain: string;
    lastCleanupAt: number;
}

export interface PersonaGraphCacheRecord {
    vaultId: string;
    domain: string;
    graphVersion: string;
    ppr: Record<string, number>;
    updatedAt: number;
}

export interface PersonaMetricRecord {
    ts: number;
    metric: string;
    value: number;
    labels?: Record<string, unknown>;
}

export interface FederationPeeringRecord {
    peeringId: string;
    sourceFederationId: string;
    sourceFederationDid: string;
    targetFederationDid: string;
    policy: Record<string, unknown>;
    status: FederationPeeringStatus;
    reason?: string;
    createdAt: number;
    updatedAt: number;
    respondedAt?: number;
}

export interface FederationBridgeRecord {
    bridgeId: string;
    peeringId: string;
    localFederationId: string;
    localRoomId: string;
    remoteRoomId: string;
    rules: Record<string, unknown>;
    status: FederationBridgeStatus;
    eventsIn: number;
    eventsOut: number;
    lastSyncAt?: number;
    createdAt: number;
    updatedAt: number;
}

export interface FederationSyncCursorRecord {
    bridgeId: string;
    direction: FederationSyncDirection;
    cursorId: string;
    updatedAt: number;
}

export interface FederationSyncLogRecord {
    id?: number;
    bridgeId: string;
    envelopeId: string;
    direction: FederationSyncDirection;
    messageType: string;
    fromFederationId?: string;
    toFederationId?: string;
    status: 'processed' | 'rejected' | 'failed';
    error?: string;
    ts: number;
}

export interface MissionRecord {
    missionId: string;
    roomId: string;
    goal: string;
    missionType: string;
    templateId?: string;
    mode: string;
    status: string;
    leaderDid: string;
    cadenceMs: number;
    policy: Record<string, unknown>;
    research: Record<string, unknown>;
    knowledge?: Record<string, unknown>;
    activeChainIds: string[];
    lastTickAt?: number;
    nextTickAt?: number;
    createdAt: number;
    updatedAt: number;
}

export interface MissionRunRecord {
    runId: string;
    missionId: string;
    cycle: number;
    chainId?: string;
    status: string;
    summary?: string;
    startedAt?: number;
    endedAt?: number;
}

export interface MissionCheckpointRecord {
    checkpointId: string;
    missionId: string;
    summary: string;
    frontier: Record<string, unknown>;
    knowledge: Record<string, unknown>;
    createdAt: number;
}

export interface MissionLeaseRecord {
    missionId: string;
    holderInstanceId: string;
    holderDid: string;
    expiresAt: number;
    updatedAt: number;
}

export interface SwarmWorkerRecord {
    did: string;
    peerId?: string;
    roomId: string;
    hostId: string;
    runtime: string;
    specialties: string[];
    capabilities: string[];
    kinds: string[];
    maxConcurrency: number;
    load: number;
    health: 'healthy' | 'degraded' | 'unhealthy';
    missionTags?: string[];
    adapterId?: string;
    displayName?: string;
    endpoint?: string;
    successRate?: number;
    queueDepth?: number;
    lastSeen?: number;
    metadata?: Record<string, unknown>;
}

export class Storage {
    public db: Database.Database;

    constructor(options: StorageOptions = {}) {
        const dbPath = options.dbPath ?? path.join(os.homedir(), '.society', 'society.db');
        const isProd = process.env.NODE_ENV === 'production';

        // Ensure directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(dbPath);
        const encryptionKey = options.encryptionKey || process.env.SOCIETY_DB_KEY;
        const allowPlaintextFallback = options.allowPlaintextDev || process.env.SOCIETY_ALLOW_PLAINTEXT_DEV === '1';

        if (isProd && !encryptionKey) {
            throw new Error('SQLCipher key is required in production (SOCIETY_DB_KEY).');
        }

        if (encryptionKey) {
            this.db.pragma(`key = '${String(encryptionKey).replace(/'/g, "''")}'`);
            this.db.pragma('cipher_compatibility = 4');
            const cipherVersion = this.db.pragma('cipher_version', { simple: true }) as unknown as string | undefined;
            if (!cipherVersion || String(cipherVersion).trim().length === 0) {
                throw new Error('SQLCipher is required but cipher_version is unavailable.');
            }
        } else if (!allowPlaintextFallback) {
            if (isProd) {
                throw new Error('Plaintext database is not allowed in production.');
            }
        }

        try {
            const loader =
                (sqliteVec as any)?.load ||
                (sqliteVec as any)?.default?.load;
            if (typeof loader !== 'function') {
                throw new Error('sqlite-vec load() not available');
            }
            loader(this.db);
        } catch (error) {
            if (isProd) {
                throw new Error(`sqlite-vec extension is required in production: ${(error as Error).message}`);
            }
            console.warn(`[storage] sqlite-vec unavailable, vector search degraded: ${(error as Error).message}`);
        }

        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('synchronous = NORMAL');

        this.migrate();
    }

    /**
     * Run schema migrations.
     */
    private migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL
            );
        `);

        const row = this.db.prepare('SELECT version FROM schema_version').get() as
            | { version: number }
            | undefined;
        const currentVersion = row?.version ?? 0;

        if (currentVersion < SCHEMA_VERSION) {
            this.db.transaction(() => {
                this.applyMigrations(currentVersion);
                this.db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)')
                    .run(SCHEMA_VERSION);
            })();
        }
    }

    private applyMigrations(fromVersion: number): void {
        if (fromVersion < 1) {
            this.db.exec(`
                -- Identity: local keypair + profile
                CREATE TABLE IF NOT EXISTS identity (
                    did TEXT PRIMARY KEY,
                    private_key_hex TEXT NOT NULL,
                    public_key_hex TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );

                -- Rooms
                CREATE TABLE IF NOT EXISTS rooms (
                    room_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    FOREIGN KEY (created_by) REFERENCES identity(did)
                );

                -- Room members
                CREATE TABLE IF NOT EXISTS room_members (
                    room_id TEXT NOT NULL,
                    member_did TEXT NOT NULL,
                    display_name TEXT,
                    joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    PRIMARY KEY (room_id, member_did)
                );

                -- Messages (chat)
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    room_id TEXT NOT NULL,
                    from_did TEXT NOT NULL,
                    from_name TEXT,
                    text TEXT NOT NULL,
                    reply_to TEXT,
                    ts INTEGER NOT NULL,
                    received_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    FOREIGN KEY (room_id) REFERENCES rooms(room_id)
                );
                CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, ts);

                -- Presence snapshots
                CREATE TABLE IF NOT EXISTS presence (
                    peer_did TEXT NOT NULL,
                    peer_name TEXT,
                    status TEXT NOT NULL DEFAULT 'online',
                    capabilities TEXT,
                    load REAL,
                    last_seen INTEGER NOT NULL DEFAULT (unixepoch()),
                    room_id TEXT,
                    PRIMARY KEY (peer_did)
                );

                -- CoC chains
                CREATE TABLE IF NOT EXISTS coc_chains (
                    chain_id TEXT PRIMARY KEY,
                    room_id TEXT NOT NULL,
                    goal TEXT NOT NULL,
                    template_id TEXT,
                    status TEXT NOT NULL DEFAULT 'open',
                    priority TEXT DEFAULT 'normal',
                    created_by TEXT NOT NULL,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    closed_at INTEGER,
                    timeout_at INTEGER,
                    final_report TEXT,
                    FOREIGN KEY (room_id) REFERENCES rooms(room_id)
                );

                -- CoC steps (DAG nodes)
                CREATE TABLE IF NOT EXISTS coc_steps (
                    step_id TEXT PRIMARY KEY,
                    chain_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    depends_on TEXT,
                    requirements_json TEXT,
                    assignee_did TEXT,
                    status TEXT NOT NULL DEFAULT 'proposed',
                    lease_ms INTEGER,
                    lease_started_at INTEGER,
                    timeout_ms INTEGER,
                    memo TEXT,
                    artifacts_json TEXT,
                    metrics_json TEXT,
                    retry_count INTEGER DEFAULT 0,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    FOREIGN KEY (chain_id) REFERENCES coc_chains(chain_id)
                );
                CREATE INDEX IF NOT EXISTS idx_coc_steps_chain ON coc_steps(chain_id);
                CREATE INDEX IF NOT EXISTS idx_coc_steps_assignee ON coc_steps(assignee_did, status);

                -- CoC events (audit log)
                CREATE TABLE IF NOT EXISTS coc_events (
                    event_id TEXT PRIMARY KEY,
                    chain_id TEXT NOT NULL,
                    step_id TEXT,
                    event_type TEXT NOT NULL,
                    actor_did TEXT,
                    data TEXT,
                    ts INTEGER NOT NULL DEFAULT (unixepoch()),
                    FOREIGN KEY (chain_id) REFERENCES coc_chains(chain_id)
                );
                CREATE INDEX IF NOT EXISTS idx_coc_events_chain ON coc_events(chain_id, ts);

                -- Adapters registry
                CREATE TABLE IF NOT EXISTS adapters (
                    adapter_id TEXT PRIMARY KEY,
                    runtime TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    specialties TEXT,
                    kinds TEXT,
                    max_concurrency INTEGER DEFAULT 1,
                    endpoint TEXT NOT NULL,
                    auth_type TEXT DEFAULT 'none',
                    registered_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    last_seen INTEGER
                );

                -- Replay cache (bounded LRU for SWP message deduplication)
                CREATE TABLE IF NOT EXISTS replay_cache (
                    from_did TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    ts INTEGER NOT NULL DEFAULT (unixepoch()),
                    PRIMARY KEY (from_did, message_id)
                );
                CREATE INDEX IF NOT EXISTS idx_replay_cache_ts ON replay_cache(ts);
            `);
        }

        if (fromVersion < 2) {
            this.db.exec(`
                -- Reputation tracking
                CREATE TABLE IF NOT EXISTS reputation (
                    did TEXT PRIMARY KEY,
                    overall_score REAL NOT NULL DEFAULT 0.5,
                    trust_tier TEXT DEFAULT 'unverified',
                    metrics_json TEXT,
                    specialties_json TEXT,
                    first_seen INTEGER NOT NULL DEFAULT (unixepoch()),
                    last_updated INTEGER NOT NULL DEFAULT (unixepoch()),
                    version INTEGER DEFAULT 1
                );

                -- Task outcomes for reputation calculation
                CREATE TABLE IF NOT EXISTS task_outcomes (
                    outcome_id TEXT PRIMARY KEY,
                    did TEXT NOT NULL,
                    chain_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    quality_score REAL,
                    latency_ms INTEGER,
                    lease_ms INTEGER,
                    accepted BOOLEAN,
                    tokens_used INTEGER,
                    cost_usd REAL,
                    specialties_json TEXT,
                    timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
                    FOREIGN KEY (did) REFERENCES reputation(did)
                );
                CREATE INDEX IF NOT EXISTS idx_task_outcomes_did ON task_outcomes(did, timestamp);

                -- Peer reviews
                CREATE TABLE IF NOT EXISTS peer_reviews (
                    review_id TEXT PRIMARY KEY,
                    reviewer_did TEXT NOT NULL,
                    subject_did TEXT NOT NULL,
                    chain_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    rating REAL NOT NULL,
                    feedback TEXT,
                    timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
                    FOREIGN KEY (subject_did) REFERENCES reputation(did)
                );
                CREATE INDEX IF NOT EXISTS idx_peer_reviews_subject ON peer_reviews(subject_did);

                -- Artifacts with content addressing
                CREATE TABLE IF NOT EXISTS artifacts (
                    artifact_id TEXT PRIMARY KEY,
                    artifact_type TEXT NOT NULL,
                    content_hash TEXT NOT NULL UNIQUE,
                    size_bytes INTEGER NOT NULL,
                    storage_path TEXT,
                    inline_content TEXT,
                    metadata_json TEXT,
                    created_by TEXT,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE INDEX IF NOT EXISTS idx_artifacts_hash ON artifacts(content_hash);

                -- Artifact lineage (provenance)
                CREATE TABLE IF NOT EXISTS artifact_lineage (
                    child_artifact_id TEXT NOT NULL,
                    parent_artifact_id TEXT NOT NULL,
                    relationship_type TEXT DEFAULT 'derived_from',
                    PRIMARY KEY (child_artifact_id, parent_artifact_id),
                    FOREIGN KEY (child_artifact_id) REFERENCES artifacts(artifact_id),
                    FOREIGN KEY (parent_artifact_id) REFERENCES artifacts(artifact_id)
                );

                -- Encrypted messages
                CREATE TABLE IF NOT EXISTS encrypted_messages (
                    message_id TEXT PRIMARY KEY,
                    room_id TEXT NOT NULL,
                    from_did TEXT NOT NULL,
                    encrypted_payload TEXT NOT NULL,
                    ephemeral_public_key TEXT NOT NULL,
                    nonce TEXT NOT NULL,
                    recipients_json TEXT NOT NULL,
                    ts INTEGER NOT NULL,
                    received_at INTEGER NOT NULL DEFAULT (unixepoch())
                );

                -- Lease expiry tracking
                CREATE TABLE IF NOT EXISTS lease_monitor (
                    chain_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    assignee_did TEXT NOT NULL,
                    lease_started_at INTEGER NOT NULL,
                    lease_ms INTEGER NOT NULL,
                    expiry_at INTEGER NOT NULL,
                    notified BOOLEAN DEFAULT FALSE,
                    PRIMARY KEY (chain_id, step_id)
                );
                CREATE INDEX IF NOT EXISTS idx_lease_monitor_expiry ON lease_monitor(expiry_at, notified);
            `);
        }

        if (fromVersion < 3) {
            this.db.exec(`
                -- Federations
                CREATE TABLE IF NOT EXISTS federations (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                );

                -- Knowledge Spaces
                CREATE TABLE IF NOT EXISTS knowledge_spaces (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                );

                -- Knowledge Cards
                CREATE TABLE IF NOT EXISTS knowledge_cards (
                    id TEXT PRIMARY KEY,
                    space_id TEXT NOT NULL,
                    data TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_cards_space ON knowledge_cards(space_id);

                -- Knowledge Links
                CREATE TABLE IF NOT EXISTS knowledge_links (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                );

                -- Collective Unconscious
                CREATE TABLE IF NOT EXISTS collective_unconscious (
                    id TEXT PRIMARY KEY,
                    space_id TEXT NOT NULL,
                    data TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE INDEX IF NOT EXISTS idx_collective_unconscious_space ON collective_unconscious(space_id);

                -- Audit Log
                CREATE TABLE IF NOT EXISTS audit_log (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    resource TEXT NOT NULL,
                    action TEXT NOT NULL,
                    result TEXT NOT NULL,
                    details TEXT,
                    ip TEXT,
                    session_id TEXT,
                    signature TEXT,
                    timestamp INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
                CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor);

                -- Threat Intelligence
                CREATE TABLE IF NOT EXISTS threat_intel (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    value TEXT NOT NULL UNIQUE,
                    severity TEXT NOT NULL,
                    category TEXT NOT NULL,
                    first_seen INTEGER NOT NULL DEFAULT (unixepoch()),
                    last_seen INTEGER NOT NULL DEFAULT (unixepoch()),
                    occurrences INTEGER DEFAULT 1,
                    confidence REAL DEFAULT 0.5
                );
                CREATE INDEX IF NOT EXISTS idx_threat_intel_value ON threat_intel(value);

                -- CoC Knowledge Bindings
                CREATE TABLE IF NOT EXISTS coc_knowledge_bindings (
                    coc_id TEXT PRIMARY KEY,
                    knowledge_space_id TEXT NOT NULL,
                    auto_index_steps BOOLEAN DEFAULT 1,
                    index_artifacts BOOLEAN DEFAULT 1,
                    index_decisions BOOLEAN DEFAULT 1,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );

                -- Federation Rooms
                CREATE TABLE IF NOT EXISTS federation_rooms (
                    federation_id TEXT NOT NULL,
                    room_id TEXT NOT NULL,
                    data TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    PRIMARY KEY (federation_id, room_id)
                );
                CREATE INDEX IF NOT EXISTS idx_federation_rooms_room ON federation_rooms(room_id);
            `);
        }

        if (fromVersion < 4) {
            this.db.exec(`
                -- Generic KV Store (compatibility layer)
                CREATE TABLE IF NOT EXISTS kv_store (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE INDEX IF NOT EXISTS idx_kv_store_updated_at ON kv_store(updated_at);

                -- Federation Governance
                CREATE TABLE IF NOT EXISTS federation_proposals (
                    proposal_id TEXT PRIMARY KEY,
                    federation_id TEXT NOT NULL,
                    proposer_did TEXT NOT NULL,
                    policy_json TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'open',
                    created_at INTEGER NOT NULL,
                    closed_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_federation_proposals_federation ON federation_proposals(federation_id, created_at);

                CREATE TABLE IF NOT EXISTS federation_votes (
                    proposal_id TEXT NOT NULL,
                    voter_did TEXT NOT NULL,
                    vote TEXT NOT NULL,
                    voting_power REAL NOT NULL,
                    voted_at INTEGER NOT NULL,
                    PRIMARY KEY (proposal_id, voter_did)
                );
                CREATE INDEX IF NOT EXISTS idx_federation_votes_proposal ON federation_votes(proposal_id, voted_at);
            `);
        }

        if (fromVersion < 5) {
            this.db.exec(`
                -- Federation Mesh Peerings
                CREATE TABLE IF NOT EXISTS federation_peerings (
                    peering_id TEXT PRIMARY KEY,
                    source_federation_id TEXT NOT NULL,
                    source_federation_did TEXT NOT NULL,
                    target_federation_did TEXT NOT NULL,
                    policy_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    reason TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    responded_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_federation_peerings_source
                    ON federation_peerings(source_federation_id, status, updated_at);
                CREATE INDEX IF NOT EXISTS idx_federation_peerings_target
                    ON federation_peerings(target_federation_did, status, updated_at);

                -- Federation Mesh Bridges
                CREATE TABLE IF NOT EXISTS federation_bridges (
                    bridge_id TEXT PRIMARY KEY,
                    peering_id TEXT NOT NULL,
                    local_federation_id TEXT NOT NULL,
                    local_room_id TEXT NOT NULL,
                    remote_room_id TEXT NOT NULL,
                    rules_json TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    events_in INTEGER NOT NULL DEFAULT 0,
                    events_out INTEGER NOT NULL DEFAULT 0,
                    last_sync_at INTEGER,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_federation_bridges_federation
                    ON federation_bridges(local_federation_id, status, updated_at);
                CREATE INDEX IF NOT EXISTS idx_federation_bridges_peering
                    ON federation_bridges(peering_id, status, updated_at);

                -- Federation Mesh Sync Cursor (idempotent replay point per direction)
                CREATE TABLE IF NOT EXISTS federation_sync_cursor (
                    bridge_id TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    cursor_id TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (bridge_id, direction)
                );

                -- Federation Mesh Sync Log (dedup + audit trail)
                CREATE TABLE IF NOT EXISTS federation_sync_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bridge_id TEXT NOT NULL,
                    envelope_id TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    message_type TEXT NOT NULL,
                    from_federation_id TEXT,
                    to_federation_id TEXT,
                    status TEXT NOT NULL DEFAULT 'processed',
                    error TEXT,
                    ts INTEGER NOT NULL,
                    UNIQUE (bridge_id, envelope_id, direction)
                );
                CREATE INDEX IF NOT EXISTS idx_federation_sync_log_bridge_ts
                    ON federation_sync_log(bridge_id, ts DESC);
            `);
        }

        if (fromVersion < 6) {
            this.db.exec(`
                -- Persona Vaults
                CREATE TABLE IF NOT EXISTS persona_vaults (
                    id TEXT PRIMARY KEY,
                    owner_did TEXT NOT NULL,
                    name TEXT NOT NULL,
                    data TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_persona_vaults_owner ON persona_vaults(owner_did, updated_at DESC);

                -- Persona nodes (episodic/semantic/procedural)
                CREATE TABLE IF NOT EXISTS persona_nodes (
                    id TEXT PRIMARY KEY,
                    vault_id TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    node_type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    tags_text TEXT,
                    confidence REAL NOT NULL DEFAULT 0.8,
                    metadata_json TEXT,
                    source_json TEXT,
                    valid_from INTEGER,
                    valid_to INTEGER,
                    data TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    deleted_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_persona_nodes_vault_domain
                    ON persona_nodes(vault_id, domain, node_type, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_persona_nodes_updated
                    ON persona_nodes(vault_id, updated_at DESC);

                -- Persona edges
                CREATE TABLE IF NOT EXISTS persona_edges (
                    id TEXT PRIMARY KEY,
                    vault_id TEXT NOT NULL,
                    source_node_id TEXT NOT NULL,
                    target_node_id TEXT NOT NULL,
                    edge_type TEXT NOT NULL,
                    weight REAL NOT NULL DEFAULT 0.8,
                    confidence REAL NOT NULL DEFAULT 0.8,
                    metadata_json TEXT,
                    data TEXT NOT NULL,
                    valid_from INTEGER,
                    valid_to INTEGER,
                    updated_at INTEGER NOT NULL,
                    deleted_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_persona_edges_vault
                    ON persona_edges(vault_id, source_node_id, target_node_id, updated_at DESC);

                -- Persona hyper-edges
                CREATE TABLE IF NOT EXISTS persona_hyperedges (
                    id TEXT PRIMARY KEY,
                    vault_id TEXT NOT NULL,
                    node_ids_json TEXT NOT NULL,
                    edge_type TEXT NOT NULL,
                    metadata_json TEXT,
                    data TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    deleted_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_persona_hyperedges_vault
                    ON persona_hyperedges(vault_id, updated_at DESC);

                -- Persona CRDT docs
                CREATE TABLE IF NOT EXISTS persona_crdt_docs (
                    doc_id TEXT PRIMARY KEY,
                    vault_id TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    data_json TEXT NOT NULL,
                    clock_json TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_persona_crdt_docs_vault_domain
                    ON persona_crdt_docs(vault_id, domain, updated_at DESC);

                -- Persona embeddings
                CREATE TABLE IF NOT EXISTS persona_embeddings (
                    node_id TEXT PRIMARY KEY,
                    vault_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    dim INTEGER NOT NULL,
                    vector BLOB,
                    data_json TEXT,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_persona_embeddings_vault
                    ON persona_embeddings(vault_id, updated_at DESC);

                -- Persona capabilities
                CREATE TABLE IF NOT EXISTS persona_capabilities (
                    id TEXT PRIMARY KEY,
                    vault_id TEXT NOT NULL,
                    service_did TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    caveats_json TEXT NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    status TEXT NOT NULL DEFAULT 'active',
                    issued_at INTEGER NOT NULL,
                    expires_at INTEGER,
                    revoked_at INTEGER,
                    reason TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_persona_capabilities_vault
                    ON persona_capabilities(vault_id, status, issued_at DESC);

                -- Persona access log
                CREATE TABLE IF NOT EXISTS persona_access_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    vault_id TEXT NOT NULL,
                    token_id TEXT,
                    service_did TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    resource TEXT NOT NULL,
                    result TEXT NOT NULL,
                    details_json TEXT,
                    ts INTEGER NOT NULL,
                    signature TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_persona_access_log_vault_ts
                    ON persona_access_log(vault_id, ts DESC);

                -- Persona sync cursors/state
                CREATE TABLE IF NOT EXISTS persona_sync_state (
                    peer_did TEXT NOT NULL,
                    vault_id TEXT NOT NULL,
                    cursor_id TEXT NOT NULL,
                    clock_json TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (peer_did, vault_id)
                );
                CREATE INDEX IF NOT EXISTS idx_persona_sync_state_vault
                    ON persona_sync_state(vault_id, updated_at DESC);

                -- Full-text search table for persona nodes
                CREATE VIRTUAL TABLE IF NOT EXISTS persona_fts USING fts5(
                    node_id UNINDEXED,
                    vault_id UNINDEXED,
                    title,
                    content,
                    tags
                );

                CREATE TRIGGER IF NOT EXISTS persona_nodes_ai AFTER INSERT ON persona_nodes BEGIN
                    INSERT INTO persona_fts (node_id, vault_id, title, content, tags)
                    VALUES (new.id, new.vault_id, new.title, new.content, COALESCE(new.tags_text, ''));
                END;

                CREATE TRIGGER IF NOT EXISTS persona_nodes_au AFTER UPDATE ON persona_nodes BEGIN
                    DELETE FROM persona_fts WHERE node_id = old.id;
                    INSERT INTO persona_fts (node_id, vault_id, title, content, tags)
                    VALUES (new.id, new.vault_id, new.title, new.content, COALESCE(new.tags_text, ''));
                END;

                CREATE TRIGGER IF NOT EXISTS persona_nodes_ad AFTER DELETE ON persona_nodes BEGIN
                    DELETE FROM persona_fts WHERE node_id = old.id;
                END;
            `);
        }

        if (fromVersion < 7) {
            this.safeAddColumn('persona_embeddings', 'vec_rowid INTEGER');
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_persona_embeddings_vec_rowid
                    ON persona_embeddings(vec_rowid);
            `);
        }

        if (fromVersion < 8) {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS persona_sync_applied (
                    from_did TEXT NOT NULL,
                    delta_id TEXT NOT NULL,
                    vault_id TEXT NOT NULL,
                    applied_at INTEGER NOT NULL,
                    PRIMARY KEY (from_did, delta_id)
                );
                CREATE INDEX IF NOT EXISTS idx_persona_sync_applied_vault
                    ON persona_sync_applied(vault_id, applied_at DESC);
            `);
        }

        if (fromVersion < 9) {
            this.safeAddColumn('persona_capabilities', 'parent_token_id TEXT');
            this.safeAddColumn('persona_access_log', 'signer_did TEXT');
            this.safeAddColumn('persona_access_log', 'sig_alg TEXT');
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_persona_capabilities_parent
                    ON persona_capabilities(parent_token_id);
            `);
        }

        if (fromVersion < 10) {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS persona_claims (
                    id TEXT PRIMARY KEY,
                    vault_id TEXT NOT NULL,
                    subject_did TEXT NOT NULL,
                    issuer_did TEXT,
                    schema TEXT NOT NULL,
                    payload_enc TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    issued_at INTEGER NOT NULL,
                    expires_at INTEGER,
                    revoked_at INTEGER,
                    signature TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_persona_claims_vault
                    ON persona_claims(vault_id, status, issued_at DESC);

                CREATE TABLE IF NOT EXISTS persona_zkp_proofs (
                    id TEXT PRIMARY KEY,
                    vault_id TEXT NOT NULL,
                    circuit_id TEXT NOT NULL,
                    proof_blob TEXT NOT NULL,
                    public_inputs_json TEXT NOT NULL,
                    claim_ids_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_persona_zkp_proofs_vault
                    ON persona_zkp_proofs(vault_id, circuit_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS persona_zkp_circuits (
                    circuit_id TEXT PRIMARY KEY,
                    version TEXT NOT NULL,
                    vk_blob TEXT,
                    metadata_json TEXT,
                    active INTEGER NOT NULL DEFAULT 1
                );
                CREATE INDEX IF NOT EXISTS idx_persona_zkp_circuits_active
                    ON persona_zkp_circuits(active);
            `);
        }

        if (fromVersion < 11) {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS persona_retention_state (
                    vault_id TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    last_cleanup_at INTEGER NOT NULL,
                    PRIMARY KEY (vault_id, domain)
                );
            `);
        }

        if (fromVersion < 12) {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS persona_graph_cache (
                    vault_id TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    graph_version TEXT NOT NULL,
                    ppr_blob TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (vault_id, domain, graph_version)
                );
                CREATE INDEX IF NOT EXISTS idx_persona_graph_cache_updated
                    ON persona_graph_cache(vault_id, domain, updated_at DESC);

                CREATE TABLE IF NOT EXISTS persona_metrics (
                    ts INTEGER NOT NULL,
                    metric TEXT NOT NULL,
                    value REAL NOT NULL,
                    labels_json TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_persona_metrics_metric_ts
                    ON persona_metrics(metric, ts DESC);

                CREATE INDEX IF NOT EXISTS idx_persona_access_log_signer_ts
                    ON persona_access_log(signer_did, ts DESC);
                CREATE INDEX IF NOT EXISTS idx_persona_retention_state_domain_ts
                    ON persona_retention_state(domain, last_cleanup_at DESC);
            `);
        }

        if (fromVersion < 13) {
            this.ensureColumn('adapters', 'owner_did', 'TEXT');
            this.ensureColumn('adapters', 'room_id', 'TEXT');
            this.ensureColumn('adapters', 'mission_tags', 'TEXT');
            this.ensureColumn('adapters', 'health', "TEXT DEFAULT 'healthy'");
            this.ensureColumn('adapters', 'queue_depth', 'INTEGER DEFAULT 0');
            this.ensureColumn('adapters', 'success_rate', 'REAL');
            this.ensureColumn('adapters', 'last_heartbeat_at', 'INTEGER');
            this.ensureColumn('adapters', 'host_id', 'TEXT');
            this.ensureColumn('adapters', 'peer_id', 'TEXT');

            this.db.exec(`
                CREATE TABLE IF NOT EXISTS proactive_missions (
                    mission_id TEXT PRIMARY KEY,
                    room_id TEXT NOT NULL,
                    goal TEXT NOT NULL,
                    mission_type TEXT NOT NULL,
                    template_id TEXT,
                    mode TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    leader_did TEXT NOT NULL,
                    cadence_ms INTEGER NOT NULL,
                    policy_json TEXT NOT NULL,
                    research_json TEXT NOT NULL,
                    knowledge_json TEXT,
                    active_chain_ids TEXT NOT NULL DEFAULT '[]',
                    last_tick_at INTEGER,
                    next_tick_at INTEGER,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE INDEX IF NOT EXISTS idx_proactive_missions_room_status
                    ON proactive_missions(room_id, status);

                CREATE TABLE IF NOT EXISTS mission_runs (
                    run_id TEXT PRIMARY KEY,
                    mission_id TEXT NOT NULL,
                    cycle INTEGER NOT NULL,
                    chain_id TEXT,
                    status TEXT NOT NULL,
                    summary TEXT,
                    started_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    ended_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_mission_runs_mission
                    ON mission_runs(mission_id, cycle DESC);

                CREATE TABLE IF NOT EXISTS mission_checkpoints (
                    checkpoint_id TEXT PRIMARY KEY,
                    mission_id TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    frontier_json TEXT NOT NULL,
                    knowledge_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE INDEX IF NOT EXISTS idx_mission_checkpoints_mission
                    ON mission_checkpoints(mission_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS mission_events (
                    event_id TEXT PRIMARY KEY,
                    mission_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    actor_did TEXT,
                    payload_json TEXT,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE INDEX IF NOT EXISTS idx_mission_events_mission
                    ON mission_events(mission_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS swarm_workers (
                    worker_did TEXT PRIMARY KEY,
                    peer_id TEXT,
                    room_id TEXT NOT NULL,
                    host_id TEXT NOT NULL,
                    runtime TEXT NOT NULL,
                    specialties_json TEXT NOT NULL DEFAULT '[]',
                    capabilities_json TEXT NOT NULL DEFAULT '[]',
                    kinds_json TEXT NOT NULL DEFAULT '[]',
                    max_concurrency INTEGER NOT NULL DEFAULT 1,
                    load REAL NOT NULL DEFAULT 0,
                    health TEXT NOT NULL DEFAULT 'healthy',
                    mission_tags_json TEXT,
                    adapter_id TEXT,
                    display_name TEXT,
                    endpoint TEXT,
                    success_rate REAL,
                    queue_depth INTEGER,
                    metadata_json TEXT,
                    last_seen INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE INDEX IF NOT EXISTS idx_swarm_workers_room_health
                    ON swarm_workers(room_id, health, last_seen DESC);

                CREATE TABLE IF NOT EXISTS research_artifacts (
                    artifact_id TEXT PRIMARY KEY,
                    mission_id TEXT,
                    worker_did TEXT,
                    artifact_type TEXT NOT NULL,
                    source_url TEXT,
                    external_id TEXT,
                    content_hash TEXT,
                    metadata_json TEXT,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE INDEX IF NOT EXISTS idx_research_artifacts_mission
                    ON research_artifacts(mission_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_research_artifacts_hash
                    ON research_artifacts(content_hash);
            `);
        }

        if (fromVersion < 14) {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS mission_leases (
                    mission_id TEXT PRIMARY KEY,
                    holder_instance_id TEXT NOT NULL,
                    holder_did TEXT NOT NULL,
                    expires_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_mission_leases_expiry
                    ON mission_leases(expires_at);
            `);
        }

        this.ensurePersonaVectorIndex();
    }

    private ensureColumn(table: string, column: string, sqlType: string): void {
        const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (rows.some((row) => row.name === column)) {
            return;
        }
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`);
    }

    // ─── Compatibility KV API ───────────────────────────────────

    transaction<T>(fn: () => T): T {
        return this.db.transaction(fn)();
    }

    set<T>(key: string, value: T): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO kv_store (key, value, updated_at)
            VALUES (?, ?, ?)
        `).run(key, JSON.stringify(value), Date.now());
    }

    get<T>(key: string): T | undefined {
        const row = this.db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as { value: string } | undefined;
        if (!row) return undefined;
        return JSON.parse(row.value) as T;
    }

    delete(key: string): void {
        this.db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    }

    query(sql: string, params: any[] = []): any[] {
        return this.db.prepare(sql).all(...params);
    }

    // ─── Identity CRUD ────────────────────────────────────────────

    saveIdentity(did: string, privateKeyHex: string, publicKeyHex: string, displayName: string): void {
        this.db
            .prepare(
                `INSERT OR REPLACE INTO identity (did, private_key_hex, public_key_hex, display_name)
                 VALUES (?, ?, ?, ?)`
            )
            .run(did, privateKeyHex, publicKeyHex, displayName);
    }

    getIdentity(): { did: string; private_key_hex: string; public_key_hex: string; display_name: string } | undefined {
        return this.db.prepare('SELECT * FROM identity LIMIT 1').get() as any;
    }

    // ─── Rooms CRUD ───────────────────────────────────────────────

    createRoom(roomId: string, name: string, createdBy: string): void {
        this.db
            .prepare('INSERT OR IGNORE INTO rooms (room_id, name, created_by) VALUES (?, ?, ?)')
            .run(roomId, name, createdBy);
    }

    getRooms(): Array<{ room_id: string; name: string; created_by: string; created_at: number }> {
        return this.db.prepare('SELECT * FROM rooms ORDER BY created_at DESC').all() as any;
    }

    // ─── Room Members ─────────────────────────────────────────────

    addRoomMember(roomId: string, memberDid: string, displayName?: string): void {
        this.db
            .prepare(
                'INSERT OR REPLACE INTO room_members (room_id, member_did, display_name) VALUES (?, ?, ?)'
            )
            .run(roomId, memberDid, displayName ?? null);
    }

    getRoomMembers(roomId: string): Array<{ member_did: string; display_name: string | null }> {
        return this.db
            .prepare('SELECT member_did, display_name FROM room_members WHERE room_id = ?')
            .all(roomId) as any;
    }

    // ─── Messages CRUD ────────────────────────────────────────────

    saveMessage(
        id: string,
        roomId: string,
        fromDid: string,
        fromName: string | null,
        text: string,
        replyTo: string | null,
        ts: number
    ): void {
        this.db
            .prepare(
                `INSERT OR IGNORE INTO messages (id, room_id, from_did, from_name, text, reply_to, ts)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(id, roomId, fromDid, fromName, text, replyTo, ts);
    }

    getMessages(roomId: string, limit = 100): Array<{
        id: string;
        room_id: string;
        from_did: string;
        from_name: string | null;
        text: string;
        ts: number;
    }> {
        return this.db
            .prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY ts DESC LIMIT ?')
            .all(roomId, limit) as any;
    }

    // ─── Presence CRUD ────────────────────────────────────────────

    upsertPresence(
        peerDid: string,
        peerName: string | null,
        status: string,
        capabilities: string[] | null,
        load: number | null,
        roomId?: string
    ): void {
        this.db
            .prepare(
                `INSERT OR REPLACE INTO presence (peer_did, peer_name, status, capabilities, load, last_seen, room_id)
                 VALUES (?, ?, ?, ?, ?, unixepoch(), ?)`
            )
            .run(
                peerDid,
                peerName,
                status,
                capabilities ? JSON.stringify(capabilities) : null,
                load,
                roomId ?? null
            );
    }

    getOnlinePeers(staleSeconds = 30): Array<{
        peer_did: string;
        peer_name: string | null;
        status: string;
        capabilities: string | null;
        last_seen: number;
    }> {
        return this.db
            .prepare('SELECT * FROM presence WHERE last_seen > (unixepoch() - ?)')
            .all(staleSeconds) as any;
    }

    // ─── Replay Cache ─────────────────────────────────────────────

    hasReplay(fromDid: string, messageId: string): boolean {
        const row = this.db
            .prepare('SELECT 1 FROM replay_cache WHERE from_did = ? AND message_id = ?')
            .get(fromDid, messageId);
        return !!row;
    }

    addReplay(fromDid: string, messageId: string): void {
        this.db
            .prepare('INSERT OR IGNORE INTO replay_cache (from_did, message_id) VALUES (?, ?)')
            .run(fromDid, messageId);
    }

    pruneReplayCache(maxAgeSeconds = 86400): void {
        this.db
            .prepare('DELETE FROM replay_cache WHERE ts < (unixepoch() - ?)')
            .run(maxAgeSeconds);
    }

    // ─── Adapters CRUD ────────────────────────────────────────────

    registerAdapter(
        adapterId: string,
        runtime: string,
        displayName: string,
        specialties: string[],
        kinds: string[],
        maxConcurrency: number,
        endpoint: string,
        authType: string = 'none',
        options: {
            ownerDid?: string;
            roomId?: string;
            missionTags?: string[];
            health?: 'healthy' | 'degraded' | 'unhealthy';
            queueDepth?: number;
            successRate?: number;
            hostId?: string;
            peerId?: string;
        } = {}
    ): void {
        this.db
            .prepare(
                `INSERT OR REPLACE INTO adapters
                 (adapter_id, runtime, display_name, specialties, kinds, max_concurrency, endpoint, auth_type,
                  owner_did, room_id, mission_tags, health, queue_depth, success_rate, host_id, peer_id, last_seen, last_heartbeat_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
            )
            .run(
                adapterId,
                runtime,
                displayName,
                JSON.stringify(specialties),
                JSON.stringify(kinds),
                maxConcurrency,
                endpoint,
                authType,
                options.ownerDid ?? null,
                options.roomId ?? null,
                options.missionTags ? JSON.stringify(options.missionTags) : null,
                options.health ?? 'healthy',
                options.queueDepth ?? 0,
                options.successRate ?? null,
                options.hostId ?? null,
                options.peerId ?? null
            );
    }

    getAdapters(): Array<{
        adapter_id: string;
        runtime: string;
        display_name: string;
        specialties: string;
        kinds: string;
        max_concurrency: number;
        endpoint: string;
    }> {
        return this.db.prepare('SELECT * FROM adapters').all() as any;
    }

    getAdapter(adapterId: string): any | undefined {
        return this.db.prepare('SELECT * FROM adapters WHERE adapter_id = ?').get(adapterId) as any;
    }

    updateAdapterHeartbeat(
        adapterId: string,
        health: 'healthy' | 'degraded' | 'unhealthy',
        queueDepth: number,
        successRate?: number
    ): void {
        this.db
            .prepare(
                `UPDATE adapters
                 SET health = ?, queue_depth = ?, success_rate = ?, last_seen = unixepoch(), last_heartbeat_at = unixepoch()
                 WHERE adapter_id = ?`
            )
            .run(health, queueDepth, successRate ?? null, adapterId);
    }

    upsertSwarmWorker(worker: SwarmWorkerRecord): void {
        this.db
            .prepare(
                `INSERT OR REPLACE INTO swarm_workers
                 (worker_did, peer_id, room_id, host_id, runtime, specialties_json, capabilities_json, kinds_json,
                  max_concurrency, load, health, mission_tags_json, adapter_id, display_name, endpoint, success_rate,
                  queue_depth, metadata_json, last_seen)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                worker.did,
                worker.peerId ?? null,
                worker.roomId,
                worker.hostId,
                worker.runtime,
                JSON.stringify(worker.specialties || []),
                JSON.stringify(worker.capabilities || []),
                JSON.stringify(worker.kinds || []),
                worker.maxConcurrency || 1,
                worker.load ?? 0,
                worker.health || 'healthy',
                worker.missionTags ? JSON.stringify(worker.missionTags) : null,
                worker.adapterId ?? null,
                worker.displayName ?? null,
                worker.endpoint ?? null,
                worker.successRate ?? null,
                worker.queueDepth ?? null,
                worker.metadata ? JSON.stringify(worker.metadata) : null,
                worker.lastSeen ?? Date.now()
            );
    }

    getSwarmWorker(workerDid: string): SwarmWorkerRecord | undefined {
        const row = this.db
            .prepare('SELECT * FROM swarm_workers WHERE worker_did = ?')
            .get(workerDid) as any;
        return row ? this.mapSwarmWorker(row) : undefined;
    }

    getVisibleWorkers(roomId?: string, maxAgeMs = 60_000): SwarmWorkerRecord[] {
        const minLastSeen = Date.now() - maxAgeMs;
        const rows = roomId
            ? this.db.prepare('SELECT * FROM swarm_workers WHERE room_id = ? AND last_seen >= ? ORDER BY last_seen DESC').all(roomId, minLastSeen)
            : this.db.prepare('SELECT * FROM swarm_workers WHERE last_seen >= ? ORDER BY last_seen DESC').all(minLastSeen);
        return (rows as any[]).map((row) => this.mapSwarmWorker(row));
    }

    private mapSwarmWorker(row: any): SwarmWorkerRecord {
        return {
            did: row.worker_did,
            peerId: row.peer_id ?? undefined,
            roomId: row.room_id,
            hostId: row.host_id,
            runtime: row.runtime,
            specialties: row.specialties_json ? JSON.parse(row.specialties_json) : [],
            capabilities: row.capabilities_json ? JSON.parse(row.capabilities_json) : [],
            kinds: row.kinds_json ? JSON.parse(row.kinds_json) : [],
            maxConcurrency: row.max_concurrency,
            load: row.load ?? 0,
            health: row.health,
            missionTags: row.mission_tags_json ? JSON.parse(row.mission_tags_json) : [],
            adapterId: row.adapter_id ?? undefined,
            displayName: row.display_name ?? undefined,
            endpoint: row.endpoint ?? undefined,
            successRate: row.success_rate ?? undefined,
            queueDepth: row.queue_depth ?? undefined,
            lastSeen: row.last_seen ?? undefined,
            metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
        };
    }

    createMission(input: {
        missionId: string;
        roomId: string;
        goal: string;
        missionType: string;
        templateId?: string;
        mode: string;
        status: string;
        leaderDid: string;
        cadenceMs: number;
        policy: Record<string, unknown>;
        research: Record<string, unknown>;
        knowledge?: Record<string, unknown>;
        activeChainIds: string[];
        lastTickAt?: number;
        nextTickAt?: number;
    }): void {
        this.db
            .prepare(
                `INSERT INTO proactive_missions
                 (mission_id, room_id, goal, mission_type, template_id, mode, status, leader_did, cadence_ms,
                  policy_json, research_json, knowledge_json, active_chain_ids, last_tick_at, next_tick_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                input.missionId,
                input.roomId,
                input.goal,
                input.missionType,
                input.templateId ?? null,
                input.mode,
                input.status,
                input.leaderDid,
                input.cadenceMs,
                JSON.stringify(input.policy),
                JSON.stringify(input.research),
                input.knowledge ? JSON.stringify(input.knowledge) : null,
                JSON.stringify(input.activeChainIds || []),
                input.lastTickAt ?? null,
                input.nextTickAt ?? null,
                Date.now()
            );
    }

    getMission(missionId: string): MissionRecord | undefined {
        const row = this.db.prepare('SELECT * FROM proactive_missions WHERE mission_id = ?').get(missionId) as any;
        return row ? this.mapMission(row) : undefined;
    }

    listMissions(roomId?: string): MissionRecord[] {
        const rows = roomId
            ? this.db.prepare('SELECT * FROM proactive_missions WHERE room_id = ? ORDER BY updated_at DESC').all(roomId)
            : this.db.prepare('SELECT * FROM proactive_missions ORDER BY updated_at DESC').all();
        return (rows as any[]).map((row) => this.mapMission(row));
    }

    updateMissionStatus(
        missionId: string,
        status: string,
        updates: {
            activeChainIds?: string[];
            lastTickAt?: number;
            nextTickAt?: number;
        } = {}
    ): void {
        const fields = ['status = ?', 'updated_at = ?'];
        const values: any[] = [status, Date.now()];
        if (updates.activeChainIds !== undefined) {
            fields.push('active_chain_ids = ?');
            values.push(JSON.stringify(updates.activeChainIds));
        }
        if (updates.lastTickAt !== undefined) {
            fields.push('last_tick_at = ?');
            values.push(updates.lastTickAt);
        }
        if (updates.nextTickAt !== undefined) {
            fields.push('next_tick_at = ?');
            values.push(updates.nextTickAt);
        }
        values.push(missionId);
        this.db.prepare(`UPDATE proactive_missions SET ${fields.join(', ')} WHERE mission_id = ?`).run(...values);
    }

    appendMissionChain(missionId: string, chainId: string): void {
        const mission = this.getMission(missionId);
        if (!mission) return;
        const activeChainIds = Array.from(new Set([...(mission.activeChainIds || []), chainId]));
        this.updateMissionStatus(missionId, mission.status, { activeChainIds });
        this.addMissionEvent(missionId, 'chain_attached', mission.leaderDid, { chain_id: chainId });
    }

    findMissionByChain(chainId: string): MissionRecord | undefined {
        try {
            const row = this.db
                .prepare(
                    `SELECT m.*
                     FROM proactive_missions m
                     JOIN json_each(m.active_chain_ids) AS j
                     WHERE j.value = ?
                     LIMIT 1`
                )
                .get(chainId) as any;
            return row ? this.mapMission(row) : undefined;
        } catch {
            return this.listMissions().find((mission) => mission.activeChainIds.includes(chainId));
        }
    }

    acquireMissionLease(
        missionId: string,
        holderInstanceId: string,
        holderDid: string,
        ttlMs: number,
        now = Date.now()
    ): boolean {
        const expiresAt = now + ttlMs;
        const result = this.db
            .prepare(
                `INSERT INTO mission_leases (mission_id, holder_instance_id, holder_did, expires_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(mission_id) DO UPDATE SET
                    holder_instance_id = excluded.holder_instance_id,
                    holder_did = excluded.holder_did,
                    expires_at = excluded.expires_at,
                    updated_at = excluded.updated_at
                 WHERE mission_leases.holder_instance_id = excluded.holder_instance_id
                    OR mission_leases.expires_at <= ?`
            )
            .run(missionId, holderInstanceId, holderDid, expiresAt, now, now) as unknown as { changes?: number };
        return (result.changes || 0) > 0;
    }

    renewMissionLease(
        missionId: string,
        holderInstanceId: string,
        holderDid: string,
        ttlMs: number,
        now = Date.now()
    ): boolean {
        const expiresAt = now + ttlMs;
        const result = this.db
            .prepare(
                `UPDATE mission_leases
                 SET expires_at = ?, updated_at = ?
                 WHERE mission_id = ?
                   AND holder_instance_id = ?
                   AND holder_did = ?
                   AND expires_at > ?`
            )
            .run(expiresAt, now, missionId, holderInstanceId, holderDid, now) as unknown as { changes?: number };
        return (result.changes || 0) > 0;
    }

    releaseMissionLease(missionId: string, holderInstanceId: string): boolean {
        const result = this.db
            .prepare('DELETE FROM mission_leases WHERE mission_id = ? AND holder_instance_id = ?')
            .run(missionId, holderInstanceId) as unknown as { changes?: number };
        return (result.changes || 0) > 0;
    }

    getMissionLease(missionId: string): MissionLeaseRecord | undefined {
        const row = this.db.prepare('SELECT * FROM mission_leases WHERE mission_id = ?').get(missionId) as any;
        return row
            ? {
                missionId: row.mission_id,
                holderInstanceId: row.holder_instance_id,
                holderDid: row.holder_did,
                expiresAt: row.expires_at,
                updatedAt: row.updated_at,
            }
            : undefined;
    }

    createMissionRun(run: MissionRunRecord): void {
        this.db
            .prepare(
                `INSERT OR REPLACE INTO mission_runs
                 (run_id, mission_id, cycle, chain_id, status, summary, started_at, ended_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                run.runId,
                run.missionId,
                run.cycle,
                run.chainId ?? null,
                run.status,
                run.summary ?? null,
                run.startedAt ?? Date.now(),
                run.endedAt ?? null
            );
    }

    saveMissionCheckpoint(checkpoint: MissionCheckpointRecord): void {
        this.db
            .prepare(
                `INSERT OR REPLACE INTO mission_checkpoints
                 (checkpoint_id, mission_id, summary, frontier_json, knowledge_json, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(
                checkpoint.checkpointId,
                checkpoint.missionId,
                checkpoint.summary,
                JSON.stringify(checkpoint.frontier),
                JSON.stringify(checkpoint.knowledge),
                checkpoint.createdAt
            );
    }

    getLatestMissionCheckpoint(missionId: string): MissionCheckpointRecord | undefined {
        const row = this.db
            .prepare('SELECT * FROM mission_checkpoints WHERE mission_id = ? ORDER BY created_at DESC LIMIT 1')
            .get(missionId) as any;
        return row
            ? {
                checkpointId: row.checkpoint_id,
                missionId: row.mission_id,
                summary: row.summary,
                frontier: row.frontier_json ? JSON.parse(row.frontier_json) : {},
                knowledge: row.knowledge_json ? JSON.parse(row.knowledge_json) : {},
                createdAt: row.created_at,
            }
            : undefined;
    }

    addMissionEvent(missionId: string, eventType: string, actorDid: string | null, payload?: Record<string, unknown>): void {
        const eventId = `${missionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.db
            .prepare(
                `INSERT INTO mission_events (event_id, mission_id, event_type, actor_did, payload_json, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(eventId, missionId, eventType, actorDid, payload ? JSON.stringify(payload) : null, Date.now());
    }

    saveResearchArtifact(input: {
        artifactId: string;
        missionId?: string;
        workerDid?: string;
        artifactType: string;
        sourceUrl?: string;
        externalId?: string;
        contentHash?: string;
        metadata?: Record<string, unknown>;
    }): void {
        this.db
            .prepare(
                `INSERT OR REPLACE INTO research_artifacts
                 (artifact_id, mission_id, worker_did, artifact_type, source_url, external_id, content_hash, metadata_json, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                input.artifactId,
                input.missionId ?? null,
                input.workerDid ?? null,
                input.artifactType,
                input.sourceUrl ?? null,
                input.externalId ?? null,
                input.contentHash ?? null,
                input.metadata ? JSON.stringify(input.metadata) : null,
                Date.now()
            );
    }

    private mapMission(row: any): MissionRecord {
        return {
            missionId: row.mission_id,
            roomId: row.room_id,
            goal: row.goal,
            missionType: row.mission_type,
            templateId: row.template_id ?? undefined,
            mode: row.mode,
            status: row.status,
            leaderDid: row.leader_did,
            cadenceMs: row.cadence_ms,
            policy: row.policy_json ? JSON.parse(row.policy_json) : {},
            research: row.research_json ? JSON.parse(row.research_json) : {},
            knowledge: row.knowledge_json ? JSON.parse(row.knowledge_json) : undefined,
            activeChainIds: row.active_chain_ids ? JSON.parse(row.active_chain_ids) : [],
            lastTickAt: row.last_tick_at ?? undefined,
            nextTickAt: row.next_tick_at ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    // ─── CoC CRUD ─────────────────────────────────────────────────

    createChain(chainId: string, roomId: string, goal: string, templateId: string | null, createdBy: string, priority: string = 'normal', timeoutAt?: number): void {
        this.db
            .prepare(
                `INSERT INTO coc_chains (chain_id, room_id, goal, template_id, created_by, priority, timeout_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(chainId, roomId, goal, templateId, createdBy, priority, timeoutAt ?? null);
    }

    updateChainStatus(chainId: string, status: string, finalReport?: string): void {
        this.db
            .prepare(
                `UPDATE coc_chains SET status = ?, closed_at = unixepoch(), final_report = ? WHERE chain_id = ?`
            )
            .run(status, finalReport ?? null, chainId);
    }

    createStep(
        stepId: string,
        chainId: string,
        kind: string,
        title: string,
        description: string | null,
        dependsOn: string[],
        requirements?: Record<string, unknown>,
        timeoutMs?: number
    ): void {
        this.db
            .prepare(
                `INSERT OR IGNORE INTO coc_steps (step_id, chain_id, kind, title, description, depends_on, requirements_json, timeout_ms)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(stepId, chainId, kind, title, description, JSON.stringify(dependsOn), 
                requirements ? JSON.stringify(requirements) : null, timeoutMs ?? null);
    }

    updateStepStatus(
        stepId: string,
        status: string,
        updates: {
            assigneeDid?: string | null;
            leaseMs?: number | null;
            memo?: string | null;
            artifacts?: Artifact[];
            metrics?: Record<string, unknown>;
            retryCount?: number;
        } = {}
    ): void {
        const fields: string[] = ['status = ?', 'updated_at = unixepoch()'];
        const values: any[] = [status];

        if (updates.assigneeDid !== undefined) {
            fields.push('assignee_did = ?');
            values.push(updates.assigneeDid);
        }

        if (updates.leaseMs !== undefined) {
            fields.push('lease_ms = ?');
            values.push(updates.leaseMs);
            
            if (updates.leaseMs !== null) {
                fields.push('lease_started_at = unixepoch()');
            }
        }

        if (updates.memo !== undefined) {
            fields.push('memo = ?');
            values.push(updates.memo);
        }

        if (updates.artifacts !== undefined) {
            fields.push('artifacts_json = ?');
            values.push(JSON.stringify(updates.artifacts));
        }

        if (updates.metrics !== undefined) {
            fields.push('metrics_json = ?');
            values.push(JSON.stringify(updates.metrics));
        }

        if (updates.retryCount !== undefined) {
            fields.push('retry_count = ?');
            values.push(updates.retryCount);
        }

        values.push(stepId);

        this.db
            .prepare(`UPDATE coc_steps SET ${fields.join(', ')} WHERE step_id = ?`)
            .run(...values);
    }

    addCocEvent(chainId: string, stepId: string | null, eventType: string, actorDid: string | null, data: unknown): void {
        const eventId = `${chainId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.db
            .prepare(
                `INSERT INTO coc_events (event_id, chain_id, step_id, event_type, actor_did, data)
                 VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(eventId, chainId, stepId, eventType, actorDid, data ? JSON.stringify(data) : null);
    }

    getChain(chainId: string): any | undefined {
        return this.db.prepare('SELECT * FROM coc_chains WHERE chain_id = ?').get(chainId);
    }

    getChainSteps(chainId: string): any[] {
        return this.db.prepare('SELECT * FROM coc_steps WHERE chain_id = ?').all(chainId);
    }

    getStepRecord(stepId: string): any | undefined {
        return this.db.prepare('SELECT * FROM coc_steps WHERE step_id = ?').get(stepId);
    }

    getAssignedStepsForDid(assigneeDid: string): any[] {
        return this.db
            .prepare(
                `SELECT s.*, c.room_id
                 FROM coc_steps s
                 JOIN coc_chains c ON c.chain_id = s.chain_id
                 WHERE s.assignee_did = ?
                   AND s.status = 'assigned'
                 ORDER BY s.updated_at ASC`
            )
            .all(assigneeDid);
    }

    getChainEvents(chainId: string): any[] {
        return this.db.prepare('SELECT * FROM coc_events WHERE chain_id = ? ORDER BY ts ASC').all(chainId);
    }

    // ─── Reputation CRUD ──────────────────────────────────────────

    saveReputation(reputation: {
        did: string;
        overall: number;
        trust_tier: string;
        metrics: Record<string, unknown>;
        specialties: Array<Record<string, unknown>>;
        first_seen: number;
        version: number;
    }): void {
        this.db
            .prepare(
                `INSERT OR REPLACE INTO reputation 
                 (did, overall_score, trust_tier, metrics_json, specialties_json, first_seen, last_updated, version)
                 VALUES (?, ?, ?, ?, ?, ?, unixepoch(), ?)`
            )
            .run(
                reputation.did,
                reputation.overall,
                reputation.trust_tier,
                JSON.stringify(reputation.metrics),
                JSON.stringify(reputation.specialties),
                reputation.first_seen,
                reputation.version
            );
    }

    getReputationRecord(did: string): any | undefined {
        return this.db.prepare('SELECT * FROM reputation WHERE did = ?').get(did);
    }

    saveTaskOutcome(outcome: TaskOutcome): void {
        const outcomeId = `outcome-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.db
            .prepare(
                `INSERT INTO task_outcomes 
                 (outcome_id, did, chain_id, step_id, status, quality_score, latency_ms, lease_ms, 
                  accepted, tokens_used, cost_usd, specialties_json, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                outcomeId,
                outcome.did,
                outcome.chain_id,
                outcome.step_id,
                outcome.status,
                outcome.quality_score ?? null,
                outcome.latency_ms,
                outcome.lease_ms,
                outcome.accepted ? 1 : 0,
                outcome.tokens_used ?? null,
                outcome.cost_usd ?? null,
                JSON.stringify(outcome.specialties_used),
                outcome.timestamp
            );
    }

    getAllTaskOutcomes(did: string): TaskOutcome[] {
        const rows = this.db
            .prepare('SELECT * FROM task_outcomes WHERE did = ? ORDER BY timestamp DESC')
            .all(did) as any[];
        
        return rows.map(row => ({
            did: row.did,
            chain_id: row.chain_id,
            step_id: row.step_id,
            status: row.status,
            quality_score: row.quality_score,
            latency_ms: row.latency_ms,
            lease_ms: row.lease_ms,
            accepted: Boolean(row.accepted),
            tokens_used: row.tokens_used,
            cost_usd: row.cost_usd,
            specialties_used: JSON.parse(row.specialties_json || '[]'),
            timestamp: row.timestamp,
        }));
    }

    getTaskOutcomes(did: string, days: number): TaskOutcome[] {
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        const rows = this.db
            .prepare('SELECT * FROM task_outcomes WHERE did = ? AND timestamp > ? ORDER BY timestamp DESC')
            .all(did, cutoff) as any[];
        
        return rows.map(row => ({
            did: row.did,
            chain_id: row.chain_id,
            step_id: row.step_id,
            status: row.status,
            quality_score: row.quality_score,
            latency_ms: row.latency_ms,
            lease_ms: row.lease_ms,
            accepted: Boolean(row.accepted),
            tokens_used: row.tokens_used,
            cost_usd: row.cost_usd,
            specialties_used: JSON.parse(row.specialties_json || '[]'),
            timestamp: row.timestamp,
        }));
    }

    savePeerReview(review: {
        reviewer_did: string;
        subject_did: string;
        chain_id: string;
        step_id: string;
        rating: number;
        feedback?: string;
        timestamp: number;
    }): void {
        const reviewId = `review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.db
            .prepare(
                `INSERT INTO peer_reviews 
                 (review_id, reviewer_did, subject_did, chain_id, step_id, rating, feedback, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(reviewId, review.reviewer_did, review.subject_did, review.chain_id, 
                review.step_id, review.rating, review.feedback ?? null, review.timestamp);
    }

    getPeerReviews(subjectDid: string): Array<{ rating: number; timestamp: number }> {
        return this.db
            .prepare('SELECT rating, timestamp FROM peer_reviews WHERE subject_did = ? ORDER BY timestamp DESC')
            .all(subjectDid) as any;
    }

    // ─── Artifact CRUD ────────────────────────────────────────────

    saveArtifact(artifact: Artifact & { created_by?: string }): void {
        this.db
            .prepare(
                `INSERT OR REPLACE INTO artifacts 
                 (artifact_id, artifact_type, content_hash, size_bytes, storage_path, 
                  inline_content, metadata_json, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                artifact.artifact_id,
                artifact.artifact_type,
                artifact.content_hash,
                artifact.size_bytes,
                artifact.uri ?? null,
                artifact.content ?? null,
                artifact.metadata ? JSON.stringify(artifact.metadata) : null,
                artifact.created_by ?? null,
                Date.now()
            );

        // Save lineage if present
        if (artifact.provenance && artifact.provenance.length > 0) {
            for (const parentId of artifact.provenance) {
                this.db
                    .prepare(
                        `INSERT OR IGNORE INTO artifact_lineage (child_artifact_id, parent_artifact_id)
                         VALUES (?, ?)`
                    )
                    .run(artifact.artifact_id, parentId);
            }
        }
    }

    getArtifact(artifactId: string): any | undefined {
        return this.db.prepare('SELECT * FROM artifacts WHERE artifact_id = ?').get(artifactId);
    }

    getArtifactLineage(artifactId: string): string[] {
        const rows = this.db
            .prepare('SELECT parent_artifact_id FROM artifact_lineage WHERE child_artifact_id = ?')
            .all(artifactId) as any[];
        return rows.map(r => r.parent_artifact_id);
    }

    // ─── Lease Monitor ────────────────────────────────────────────

    trackLease(chainId: string, stepId: string, assigneeDid: string, leaseMs: number): void {
        const expiryAt = Date.now() + leaseMs;
        this.db
            .prepare(
                `INSERT OR REPLACE INTO lease_monitor 
                 (chain_id, step_id, assignee_did, lease_started_at, lease_ms, expiry_at, notified)
                 VALUES (?, ?, ?, unixepoch(), ?, ?, FALSE)`
            )
            .run(chainId, stepId, assigneeDid, leaseMs, expiryAt);
    }

    getExpiredLeases(): Array<{ chain_id: string; step_id: string; assignee_did: string }> {
        return this.db
            .prepare(
                `SELECT chain_id, step_id, assignee_did FROM lease_monitor
                 WHERE expiry_at < ? AND notified = FALSE`
            )
            .all(Date.now()) as any;
    }

    /**
     * Atomically claim an expired lease: marks it notified and resets the step
     * in a single transaction. Returns true if this call won the race.
     */
    claimExpiredLease(chainId: string, stepId: string): boolean {
        const result = this.db.transaction(() => {
            const updated = this.db
                .prepare(
                    `UPDATE lease_monitor SET notified = TRUE
                     WHERE chain_id = ? AND step_id = ? AND notified = FALSE AND expiry_at < ?`
                )
                .run(chainId, stepId, Date.now());
            return updated.changes > 0;
        })();
        return result as boolean;
    }

    markLeaseNotified(chainId: string, stepId: string): void {
        this.db
            .prepare('UPDATE lease_monitor SET notified = TRUE WHERE chain_id = ? AND step_id = ?')
            .run(chainId, stepId);
    }

    removeLease(chainId: string, stepId: string): void {
        this.db
            .prepare('DELETE FROM lease_monitor WHERE chain_id = ? AND step_id = ?')
            .run(chainId, stepId);
    }

    // ─── Federation Storage ───────────────────────────────────────

    saveFederation(federation: any): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO federations 
            (id, data, updated_at) VALUES (?, ?, ?)
        `).run(federation.id, this.encode(federation), Date.now());
    }

    getFederations(): any[] {
        const rows = this.db.prepare('SELECT data FROM federations').all() as any[];
        return rows.map(r => this.decode(r.data));
    }

    // ─── Knowledge Storage ────────────────────────────────────────

    saveKnowledgeCard(card: any): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO knowledge_cards 
            (id, space_id, data, updated_at) VALUES (?, ?, ?, ?)
        `).run(card.id, card.spaceId, this.encode(card), Date.now());
    }

    saveKnowledgeSpace(space: any): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO knowledge_spaces 
            (id, data, updated_at) VALUES (?, ?, ?)
        `).run(space.id, this.encode(space), Date.now());
    }

    getKnowledgeSpaces(): any[] {
        try {
            const rows = this.db.prepare('SELECT data FROM knowledge_spaces').all() as any[];
            return rows.map(r => this.decode(r.data));
        } catch {
            return [];
        }
    }

    getKnowledgeCards(spaceId?: string): any[] {
        try {
            const rows = spaceId
                ? this.db.prepare('SELECT data FROM knowledge_cards WHERE space_id = ?').all(spaceId) as any[]
                : this.db.prepare('SELECT data FROM knowledge_cards').all() as any[];
            return rows.map(r => this.decode(r.data));
        } catch {
            return [];
        }
    }

    saveKnowledgeLink(link: any): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO knowledge_links 
            (id, data) VALUES (?, ?)
        `).run(link.id, this.encode(link));
    }

    getKnowledgeLinks(): any[] {
        try {
            const rows = this.db.prepare('SELECT data FROM knowledge_links').all() as any[];
            return rows.map(r => this.decode(r.data));
        } catch {
            return [];
        }
    }

    saveCollectiveUnconscious(cu: any): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO collective_unconscious 
            (id, space_id, data, updated_at) VALUES (?, ?, ?, ?)
        `).run(cu.id, cu.spaceId, this.encode(cu), Date.now());
    }

    getCollectiveUnconscious(spaceId?: string): any[] {
        try {
            const rows = spaceId
                ? this.db.prepare('SELECT data FROM collective_unconscious WHERE space_id = ?').all(spaceId) as any[]
                : this.db.prepare('SELECT data FROM collective_unconscious').all() as any[];
            return rows.map(r => this.decode(r.data));
        } catch {
            return [];
        }
    }

    // ─── Integration Storage ──────────────────────────────────────

    saveCoCKnowledgeBinding(binding: any): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO coc_knowledge_bindings
            (coc_id, knowledge_space_id, auto_index_steps, index_artifacts, index_decisions)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            binding.cocId,
            binding.knowledgeSpaceId,
            binding.autoIndexSteps ? 1 : 0,
            binding.indexArtifacts ? 1 : 0,
            binding.indexDecisions ? 1 : 0
        );
    }

    getCoCKnowledgeBinding(cocId: string): any | undefined {
        return this.db.prepare('SELECT * FROM coc_knowledge_bindings WHERE coc_id = ?').get(cocId);
    }

    saveFederationRoom(federationId: string, roomId: string, data: any): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO federation_rooms
            (federation_id, room_id, data, updated_at) VALUES (?, ?, ?, ?)
        `).run(federationId, roomId, JSON.stringify(data), Date.now());
    }

    getFederationRooms(federationId: string): any[] {
        try {
            const rows = this.db.prepare('SELECT data FROM federation_rooms WHERE federation_id = ?').all(federationId) as any[];
            return rows.map(r => JSON.parse(r.data));
        } catch {
            return [];
        }
    }

    // ─── Federation Governance Storage ────────────────────────────

    saveFederationProposal(
        proposalId: string,
        federationId: string,
        proposerDid: string,
        policy: any,
        status: string = 'open'
    ): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO federation_proposals
            (proposal_id, federation_id, proposer_did, policy_json, status, created_at, closed_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL)
        `).run(
            proposalId,
            federationId,
            proposerDid,
            this.encode(policy),
            status,
            Date.now()
        );
    }

    setFederationProposalStatus(proposalId: string, status: string): void {
        this.db.prepare(`
            UPDATE federation_proposals
            SET status = ?, closed_at = ?
            WHERE proposal_id = ?
        `).run(status, Date.now(), proposalId);
    }

    getFederationProposal(proposalId: string): any | undefined {
        const row = this.db.prepare('SELECT * FROM federation_proposals WHERE proposal_id = ?').get(proposalId) as any;
        if (!row) return undefined;
        return {
            ...row,
            policy: this.decode(row.policy_json),
        };
    }

    getFederationProposals(federationId?: string): any[] {
        const rows = federationId
            ? this.db.prepare('SELECT * FROM federation_proposals WHERE federation_id = ?').all(federationId) as any[]
            : this.db.prepare('SELECT * FROM federation_proposals').all() as any[];
        return rows.map((row) => ({
            ...row,
            policy: this.decode(row.policy_json),
        }));
    }

    saveFederationVote(
        proposalId: string,
        voterDid: string,
        vote: 'yes' | 'no' | 'abstain',
        votingPower: number
    ): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO federation_votes
            (proposal_id, voter_did, vote, voting_power, voted_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(proposalId, voterDid, vote, votingPower, Date.now());
    }

    getFederationVotes(proposalId: string): Array<{
        voter_did: string;
        vote: 'yes' | 'no' | 'abstain';
        voting_power: number;
        voted_at: number;
    }> {
        return this.db.prepare(`
            SELECT voter_did, vote, voting_power, voted_at
            FROM federation_votes
            WHERE proposal_id = ?
            ORDER BY voted_at ASC
        `).all(proposalId) as any;
    }

    // ─── Federation Mesh Storage ─────────────────────────────────

    saveFederationPeering(peering: FederationPeeringRecord): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO federation_peerings
            (
                peering_id,
                source_federation_id,
                source_federation_did,
                target_federation_did,
                policy_json,
                status,
                reason,
                created_at,
                updated_at,
                responded_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            peering.peeringId,
            peering.sourceFederationId,
            peering.sourceFederationDid,
            peering.targetFederationDid,
            this.encode(peering.policy),
            peering.status,
            peering.reason ?? null,
            peering.createdAt,
            peering.updatedAt,
            peering.respondedAt ?? null
        );
    }

    updateFederationPeeringStatus(
        peeringId: string,
        status: FederationPeeringStatus,
        reason?: string,
        respondedAt?: number
    ): void {
        this.db.prepare(`
            UPDATE federation_peerings
            SET status = ?, reason = ?, responded_at = ?, updated_at = ?
            WHERE peering_id = ?
        `).run(status, reason ?? null, respondedAt ?? null, Date.now(), peeringId);
    }

    getFederationPeering(peeringId: string): FederationPeeringRecord | undefined {
        const row = this.db.prepare('SELECT * FROM federation_peerings WHERE peering_id = ?').get(peeringId) as any;
        if (!row) return undefined;
        return {
            peeringId: row.peering_id,
            sourceFederationId: row.source_federation_id,
            sourceFederationDid: row.source_federation_did,
            targetFederationDid: row.target_federation_did,
            policy: this.decode(row.policy_json),
            status: row.status,
            reason: row.reason ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            respondedAt: row.responded_at ?? undefined
        };
    }

    listFederationPeerings(
        federationId?: string,
        status?: FederationPeeringStatus,
        federationDid?: string
    ): FederationPeeringRecord[] {
        const clauses: string[] = [];
        const params: any[] = [];

        if (federationId && federationDid) {
            clauses.push('(source_federation_id = ? OR target_federation_did = ?)');
            params.push(federationId, federationDid);
        } else if (federationId) {
            clauses.push('source_federation_id = ?');
            params.push(federationId);
        } else if (federationDid) {
            clauses.push('target_federation_did = ?');
            params.push(federationDid);
        }

        if (status) {
            clauses.push('status = ?');
            params.push(status);
        }

        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        const rows = this.db.prepare(`
            SELECT * FROM federation_peerings
            ${where}
            ORDER BY updated_at DESC
        `).all(...params) as any[];

        return rows.map((row) => ({
            peeringId: row.peering_id,
            sourceFederationId: row.source_federation_id,
            sourceFederationDid: row.source_federation_did,
            targetFederationDid: row.target_federation_did,
            policy: this.decode(row.policy_json),
            status: row.status,
            reason: row.reason ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            respondedAt: row.responded_at ?? undefined
        }));
    }

    saveFederationBridge(bridge: FederationBridgeRecord): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO federation_bridges
            (
                bridge_id,
                peering_id,
                local_federation_id,
                local_room_id,
                remote_room_id,
                rules_json,
                status,
                events_in,
                events_out,
                last_sync_at,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            bridge.bridgeId,
            bridge.peeringId,
            bridge.localFederationId,
            bridge.localRoomId,
            bridge.remoteRoomId,
            this.encode(bridge.rules),
            bridge.status,
            bridge.eventsIn,
            bridge.eventsOut,
            bridge.lastSyncAt ?? null,
            bridge.createdAt,
            bridge.updatedAt
        );
    }

    updateFederationBridgeStatus(
        bridgeId: string,
        status: FederationBridgeStatus,
        lastSyncAt?: number
    ): void {
        this.db.prepare(`
            UPDATE federation_bridges
            SET status = ?, last_sync_at = ?, updated_at = ?
            WHERE bridge_id = ?
        `).run(status, lastSyncAt ?? null, Date.now(), bridgeId);
    }

    incrementFederationBridgeCounters(
        bridgeId: string,
        direction: FederationSyncDirection,
        count: number = 1,
        lastSyncAt: number = Date.now()
    ): void {
        if (direction === 'in') {
            this.db.prepare(`
                UPDATE federation_bridges
                SET events_in = events_in + ?, last_sync_at = ?, updated_at = ?
                WHERE bridge_id = ?
            `).run(count, lastSyncAt, Date.now(), bridgeId);
            return;
        }

        this.db.prepare(`
            UPDATE federation_bridges
            SET events_out = events_out + ?, last_sync_at = ?, updated_at = ?
            WHERE bridge_id = ?
        `).run(count, lastSyncAt, Date.now(), bridgeId);
    }

    getFederationBridge(bridgeId: string): FederationBridgeRecord | undefined {
        const row = this.db.prepare('SELECT * FROM federation_bridges WHERE bridge_id = ?').get(bridgeId) as any;
        if (!row) return undefined;
        return {
            bridgeId: row.bridge_id,
            peeringId: row.peering_id,
            localFederationId: row.local_federation_id,
            localRoomId: row.local_room_id,
            remoteRoomId: row.remote_room_id,
            rules: this.decode(row.rules_json),
            status: row.status,
            eventsIn: row.events_in,
            eventsOut: row.events_out,
            lastSyncAt: row.last_sync_at ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    listFederationBridges(
        federationId?: string,
        status?: FederationBridgeStatus
    ): FederationBridgeRecord[] {
        const clauses: string[] = [];
        const params: any[] = [];

        if (federationId) {
            clauses.push('local_federation_id = ?');
            params.push(federationId);
        }

        if (status) {
            clauses.push('status = ?');
            params.push(status);
        }

        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        const rows = this.db.prepare(`
            SELECT * FROM federation_bridges
            ${where}
            ORDER BY updated_at DESC
        `).all(...params) as any[];

        return rows.map((row) => ({
            bridgeId: row.bridge_id,
            peeringId: row.peering_id,
            localFederationId: row.local_federation_id,
            localRoomId: row.local_room_id,
            remoteRoomId: row.remote_room_id,
            rules: this.decode(row.rules_json),
            status: row.status,
            eventsIn: row.events_in,
            eventsOut: row.events_out,
            lastSyncAt: row.last_sync_at ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }

    saveFederationSyncCursor(cursor: FederationSyncCursorRecord): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO federation_sync_cursor
            (bridge_id, direction, cursor_id, updated_at)
            VALUES (?, ?, ?, ?)
        `).run(cursor.bridgeId, cursor.direction, cursor.cursorId, cursor.updatedAt);
    }

    getFederationSyncCursor(
        bridgeId: string,
        direction: FederationSyncDirection
    ): FederationSyncCursorRecord | undefined {
        const row = this.db.prepare(`
            SELECT bridge_id, direction, cursor_id, updated_at
            FROM federation_sync_cursor
            WHERE bridge_id = ? AND direction = ?
        `).get(bridgeId, direction) as any;

        if (!row) return undefined;
        return {
            bridgeId: row.bridge_id,
            direction: row.direction,
            cursorId: row.cursor_id,
            updatedAt: row.updated_at
        };
    }

    appendFederationSyncLog(entry: FederationSyncLogRecord): void {
        this.db.prepare(`
            INSERT OR IGNORE INTO federation_sync_log
            (
                bridge_id,
                envelope_id,
                direction,
                message_type,
                from_federation_id,
                to_federation_id,
                status,
                error,
                ts
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            entry.bridgeId,
            entry.envelopeId,
            entry.direction,
            entry.messageType,
            entry.fromFederationId ?? null,
            entry.toFederationId ?? null,
            entry.status,
            entry.error ?? null,
            entry.ts
        );
    }

    hasFederationSyncLog(
        bridgeId: string,
        envelopeId: string,
        direction: FederationSyncDirection
    ): boolean {
        const row = this.db.prepare(`
            SELECT 1 FROM federation_sync_log
            WHERE bridge_id = ? AND envelope_id = ? AND direction = ?
        `).get(bridgeId, envelopeId, direction);
        return !!row;
    }

    listFederationSyncLog(bridgeId: string, limit = 100): FederationSyncLogRecord[] {
        const rows = this.db.prepare(`
            SELECT id, bridge_id, envelope_id, direction, message_type,
                   from_federation_id, to_federation_id, status, error, ts
            FROM federation_sync_log
            WHERE bridge_id = ?
            ORDER BY ts DESC
            LIMIT ?
        `).all(bridgeId, limit) as any[];

        return rows.map((row) => ({
            id: row.id,
            bridgeId: row.bridge_id,
            envelopeId: row.envelope_id,
            direction: row.direction,
            messageType: row.message_type,
            fromFederationId: row.from_federation_id ?? undefined,
            toFederationId: row.to_federation_id ?? undefined,
            status: row.status,
            error: row.error ?? undefined,
            ts: row.ts
        }));
    }

    getFederationMeshStats(federationId?: string): {
        bridgeCount: number;
        activeBridges: number;
        eventsIn: number;
        eventsOut: number;
        lastSyncAt?: number;
    } {
        const where = federationId ? 'WHERE local_federation_id = ?' : '';
        const row = this.db.prepare(`
            SELECT
                COUNT(*) AS bridge_count,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_bridges,
                COALESCE(SUM(events_in), 0) AS events_in,
                COALESCE(SUM(events_out), 0) AS events_out,
                MAX(last_sync_at) AS last_sync_at
            FROM federation_bridges
            ${where}
        `).get(...(federationId ? [federationId] : [])) as any;

        return {
            bridgeCount: row?.bridge_count ?? 0,
            activeBridges: row?.active_bridges ?? 0,
            eventsIn: row?.events_in ?? 0,
            eventsOut: row?.events_out ?? 0,
            lastSyncAt: row?.last_sync_at ?? undefined
        };
    }

    // ─── Persona Vault Storage ────────────────────────────────────

    savePersonaVault(vault: any): void {
        const createdAt = vault.createdAt || Date.now();
        const updatedAt = vault.updatedAt || Date.now();
        this.db.prepare(`
            INSERT OR REPLACE INTO persona_vaults
            (id, owner_did, name, data, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            vault.id,
            vault.ownerDid,
            vault.name,
            this.encode(vault),
            createdAt,
            updatedAt
        );
    }

    getPersonaVault(vaultId: string): any | undefined {
        const row = this.db.prepare('SELECT data FROM persona_vaults WHERE id = ?').get(vaultId) as any;
        if (!row) return undefined;
        return this.decode(row.data);
    }

    getPersonaVaults(ownerDid?: string): any[] {
        const rows = ownerDid
            ? this.db.prepare('SELECT data FROM persona_vaults WHERE owner_did = ? ORDER BY updated_at DESC').all(ownerDid) as any[]
            : this.db.prepare('SELECT data FROM persona_vaults ORDER BY updated_at DESC').all() as any[];
        return rows.map((r) => this.decode(r.data));
    }

    upsertPersonaNode(node: any): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO persona_nodes
            (
                id,
                vault_id,
                domain,
                node_type,
                title,
                content,
                tags_text,
                confidence,
                metadata_json,
                source_json,
                valid_from,
                valid_to,
                data,
                created_at,
                updated_at,
                deleted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            node.id,
            node.vaultId,
            node.domain,
            node.type,
            node.title,
            node.content,
            (node.tags || []).join(' '),
            node.confidence ?? 0.8,
            this.encode(node.metadata || {}),
            node.source ? this.encode(node.source) : null,
            node.validFrom ?? null,
            node.validTo ?? null,
            this.encode(node),
            node.createdAt || Date.now(),
            node.updatedAt || Date.now(),
            node.deletedAt ?? null
        );
    }

    getPersonaNode(nodeId: string): any | undefined {
        const row = this.db.prepare('SELECT data FROM persona_nodes WHERE id = ?').get(nodeId) as any;
        if (!row) return undefined;
        return this.decode(row.data);
    }

    listPersonaNodes(
        vaultId: string,
        options: {
            includeDeleted?: boolean;
            domain?: string;
            domains?: string[];
            types?: string[];
            tags?: string[];
        } = {}
    ): any[] {
        const clauses: string[] = ['vault_id = ?'];
        const params: any[] = [vaultId];

        if (!options.includeDeleted) {
            clauses.push('deleted_at IS NULL');
        }
        if (options.domain) {
            clauses.push('domain = ?');
            params.push(options.domain);
        }
        if (options.domains?.length) {
            clauses.push(`domain IN (${options.domains.map(() => '?').join(',')})`);
            params.push(...options.domains);
        }
        if (options.types?.length) {
            clauses.push(`node_type IN (${options.types.map(() => '?').join(',')})`);
            params.push(...options.types);
        }
        if (options.tags?.length) {
            for (const tag of options.tags) {
                clauses.push('tags_text LIKE ?');
                params.push(`%${tag}%`);
            }
        }

        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        const rows = this.db.prepare(`
            SELECT data
            FROM persona_nodes
            ${where}
            ORDER BY updated_at DESC
        `).all(...params) as any[];

        return rows.map((r) => this.decode(r.data));
    }

    searchPersonaNodes(vaultId: string, query: string, limit = 20): Array<{ id: string; score: number }> {
        try {
            const rows = this.db.prepare(`
                SELECT node_id, bm25(persona_fts) AS rank
                FROM persona_fts
                WHERE vault_id = ? AND persona_fts MATCH ?
                ORDER BY rank
                LIMIT ?
            `).all(vaultId, query, limit) as any[];

            return rows.map((row) => ({
                id: row.node_id,
                score: Math.max(0, 1 / (1 + Math.abs(row.rank || 1))),
            }));
        } catch {
            const rows = this.db.prepare(`
                SELECT id, title, content
                FROM persona_nodes
                WHERE vault_id = ? AND deleted_at IS NULL AND (
                    title LIKE ? OR content LIKE ? OR tags_text LIKE ?
                )
                ORDER BY updated_at DESC
                LIMIT ?
            `).all(vaultId, `%${query}%`, `%${query}%`, `%${query}%`, limit) as any[];

            return rows.map((row) => ({
                id: row.id,
                score: 0.1,
            }));
        }
    }

    softDeletePersonaNode(nodeId: string, deletedAt = Date.now()): void {
        this.db.prepare(`
            UPDATE persona_nodes
            SET deleted_at = ?, updated_at = ?
            WHERE id = ?
        `).run(deletedAt, Date.now(), nodeId);
    }

    upsertPersonaEdge(edge: any): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO persona_edges
            (
                id,
                vault_id,
                source_node_id,
                target_node_id,
                edge_type,
                weight,
                confidence,
                metadata_json,
                data,
                valid_from,
                valid_to,
                updated_at,
                deleted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            edge.id,
            edge.vaultId,
            edge.sourceNodeId,
            edge.targetNodeId,
            edge.type,
            edge.weight ?? 0.8,
            edge.confidence ?? 0.8,
            this.encode(edge.metadata || {}),
            this.encode(edge),
            edge.validFrom ?? null,
            edge.validTo ?? null,
            edge.updatedAt || Date.now(),
            edge.deletedAt ?? null
        );
    }

    getPersonaEdge(edgeId: string): any | undefined {
        const row = this.db.prepare('SELECT data FROM persona_edges WHERE id = ?').get(edgeId) as any;
        if (!row) return undefined;
        return this.decode(row.data);
    }

    listPersonaEdges(vaultId: string): any[] {
        const rows = this.db.prepare(`
            SELECT data
            FROM persona_edges
            WHERE vault_id = ?
            ORDER BY updated_at DESC
        `).all(vaultId) as any[];
        return rows.map((r) => this.decode(r.data));
    }

    softDeletePersonaEdge(edgeId: string, deletedAt = Date.now()): void {
        this.db.prepare(`
            UPDATE persona_edges
            SET deleted_at = ?, updated_at = ?
            WHERE id = ?
        `).run(deletedAt, Date.now(), edgeId);
    }

    upsertPersonaHyperEdge(edge: any): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO persona_hyperedges
            (
                id,
                vault_id,
                node_ids_json,
                edge_type,
                metadata_json,
                data,
                updated_at,
                deleted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            edge.id,
            edge.vaultId,
            this.encode(edge.nodeIds || []),
            edge.type,
            this.encode(edge.metadata || {}),
            this.encode(edge),
            edge.updatedAt || Date.now(),
            edge.deletedAt ?? null
        );
    }

    listPersonaHyperEdges(vaultId: string): any[] {
        const rows = this.db.prepare(`
            SELECT data
            FROM persona_hyperedges
            WHERE vault_id = ?
            ORDER BY updated_at DESC
        `).all(vaultId) as any[];
        return rows.map((r) => this.decode(r.data));
    }

    upsertPersonaCrdtDoc(doc: any): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO persona_crdt_docs
            (doc_id, vault_id, domain, data_json, clock_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            doc.docId,
            doc.vaultId,
            doc.domain,
            this.encode(doc.data || {}),
            this.encode(doc.clock || {}),
            doc.updatedAt || Date.now()
        );
    }

    getPersonaCrdtDoc(docId: string): any | undefined {
        const row = this.db.prepare(`
            SELECT doc_id, vault_id, domain, data_json, clock_json, updated_at
            FROM persona_crdt_docs
            WHERE doc_id = ?
        `).get(docId) as any;
        if (!row) return undefined;
        return {
            docId: row.doc_id,
            vaultId: row.vault_id,
            domain: row.domain,
            data: this.decode(row.data_json),
            clock: this.decode(row.clock_json),
            updatedAt: row.updated_at,
        };
    }

    upsertPersonaEmbedding(record: PersonaEmbeddingRecord): void {
        const updatedAt = record.updatedAt || Date.now();
        this.db.prepare(`
            INSERT OR REPLACE INTO persona_embeddings
            (node_id, vault_id, model, dim, vector, data_json, updated_at, vec_rowid)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            record.nodeId,
            record.vaultId,
            record.model,
            record.dim,
            record.vector ? Buffer.from(JSON.stringify(record.vector), 'utf8') : null,
            this.encode({ vector: record.vector || [], vecRowId: record.vecRowId }),
            updatedAt,
            record.vecRowId ?? null
        );
    }

    upsertPersonaVector(rowId: number, vector: number[]): void {
        try {
            this.db.prepare(`
                INSERT OR REPLACE INTO persona_vec(rowid, embedding)
                VALUES (?, ?)
            `).run(rowId, `[${vector.join(',')}]`);
        } catch (error) {
            if (process.env.NODE_ENV === 'production') {
                throw new Error(`persona_vec insert failed in production: ${(error as Error).message}`);
            }
        }
    }

    deletePersonaEmbedding(nodeId: string): void {
        const row = this.db.prepare(`
            SELECT vec_rowid
            FROM persona_embeddings
            WHERE node_id = ?
        `).get(nodeId) as any;
        if (row?.vec_rowid) {
            try {
                this.db.prepare('DELETE FROM persona_vec WHERE rowid = ?').run(row.vec_rowid);
            } catch {
                // no-op when vec index is unavailable in non-production environments
            }
        }
        this.db.prepare('DELETE FROM persona_embeddings WHERE node_id = ?').run(nodeId);
    }

    getPersonaEmbedding(nodeId: string): PersonaEmbeddingRecord | undefined {
        const row = this.db.prepare(`
            SELECT node_id, vault_id, model, dim, data_json, updated_at, vec_rowid
            FROM persona_embeddings
            WHERE node_id = ?
        `).get(nodeId) as any;
        if (!row) return undefined;
        const parsed = row.data_json ? this.decode(row.data_json) : {};
        return {
            nodeId: row.node_id,
            vaultId: row.vault_id,
            model: row.model,
            dim: row.dim,
            vector: Array.isArray(parsed?.vector) ? parsed.vector : undefined,
            vecRowId: row.vec_rowid ?? undefined,
            updatedAt: row.updated_at,
        };
    }

    searchPersonaVector(
        vaultId: string,
        vector: number[],
        limit = 20
    ): Array<{ nodeId: string; distance: number; score: number }> {
        const query = `[${vector.join(',')}]`;
        let rows: any[] = [];
        try {
            rows = this.db.prepare(`
                SELECT e.node_id, v.distance
                FROM persona_vec v
                JOIN persona_embeddings e ON e.vec_rowid = v.rowid
                WHERE e.vault_id = ? AND v.embedding MATCH ?
                ORDER BY v.distance ASC
                LIMIT ?
            `).all(vaultId, query, limit) as any[];
        } catch {
            return [];
        }
        return rows.map((row) => ({
            nodeId: row.node_id,
            distance: Number(row.distance || 0),
            score: 1 / (1 + Number(row.distance || 0)),
        }));
    }

    savePersonaCapability(capability: any): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO persona_capabilities
            (
                id,
                vault_id,
                service_did,
                scope,
                caveats_json,
                token_hash,
                status,
                issued_at,
                expires_at,
                revoked_at,
                reason,
                parent_token_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        `).run(
            capability.id,
            capability.vaultId,
            capability.serviceDid,
            capability.scope,
            this.encode(capability.caveats || {}),
            capability.tokenHash,
            capability.status,
            capability.issuedAt,
            capability.expiresAt ?? null,
            capability.revokedAt ?? null,
            capability.parentTokenId ?? null
        );
    }

    updatePersonaCapabilityStatus(
        tokenId: string,
        status: PersonaCapabilityStatus,
        reason?: string,
        updatedAt = Date.now()
    ): void {
        const revokedAt = status === 'revoked' ? updatedAt : null;
        this.db.prepare(`
            UPDATE persona_capabilities
            SET status = ?, revoked_at = ?, reason = ?
            WHERE id = ?
        `).run(status, revokedAt, reason ?? null, tokenId);
    }

    getPersonaCapabilityByHash(tokenHash: string): any | undefined {
        const row = this.db.prepare(`
            SELECT *
            FROM persona_capabilities
            WHERE token_hash = ?
            LIMIT 1
        `).get(tokenHash) as any;
        if (!row) return undefined;
        return {
            id: row.id,
            vaultId: row.vault_id,
            serviceDid: row.service_did,
            scope: row.scope,
            caveats: this.decode(row.caveats_json),
            tokenHash: row.token_hash,
            status: row.status,
            issuedAt: row.issued_at,
            expiresAt: row.expires_at ?? undefined,
            revokedAt: row.revoked_at ?? undefined,
            parentTokenId: row.parent_token_id ?? undefined,
        };
    }

    getPersonaCapability(tokenId: string): any | undefined {
        const row = this.db.prepare(`
            SELECT *
            FROM persona_capabilities
            WHERE id = ?
            LIMIT 1
        `).get(tokenId) as any;
        if (!row) return undefined;
        return {
            id: row.id,
            vaultId: row.vault_id,
            serviceDid: row.service_did,
            scope: row.scope,
            caveats: this.decode(row.caveats_json),
            tokenHash: row.token_hash,
            status: row.status,
            issuedAt: row.issued_at,
            expiresAt: row.expires_at ?? undefined,
            revokedAt: row.revoked_at ?? undefined,
            parentTokenId: row.parent_token_id ?? undefined,
        };
    }

    listPersonaCapabilities(vaultId: string): any[] {
        const rows = this.db.prepare(`
            SELECT *
            FROM persona_capabilities
            WHERE vault_id = ?
            ORDER BY issued_at DESC
        `).all(vaultId) as any[];
        return rows.map((row) => ({
            id: row.id,
            vaultId: row.vault_id,
            serviceDid: row.service_did,
            scope: row.scope,
            caveats: this.decode(row.caveats_json),
            tokenHash: row.token_hash,
            status: row.status,
            issuedAt: row.issued_at,
            expiresAt: row.expires_at ?? undefined,
            revokedAt: row.revoked_at ?? undefined,
            parentTokenId: row.parent_token_id ?? undefined,
        }));
    }

    appendPersonaAccessLog(entry: PersonaAccessLogRecord): void {
        this.db.prepare(`
            INSERT INTO persona_access_log
            (
                vault_id,
                token_id,
                service_did,
                operation,
                resource,
                result,
                details_json,
                ts,
                signature,
                signer_did,
                sig_alg
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            entry.vaultId,
            entry.tokenId ?? null,
            entry.serviceDid,
            entry.operation,
            entry.resource,
            entry.result,
            entry.details ? this.encode(entry.details) : null,
            entry.ts,
            entry.signature ?? null,
            entry.signerDid ?? null,
            entry.sigAlg ?? null
        );
    }

    listPersonaAccessLogs(vaultId: string, limit = 100): PersonaAccessLogRecord[] {
        const rows = this.db.prepare(`
            SELECT *
            FROM persona_access_log
            WHERE vault_id = ?
            ORDER BY ts DESC
            LIMIT ?
        `).all(vaultId, limit) as any[];
        return rows.map((row) => ({
            id: row.id,
            vaultId: row.vault_id,
            tokenId: row.token_id ?? undefined,
            serviceDid: row.service_did,
            operation: row.operation,
            resource: row.resource,
            result: row.result,
            details: row.details_json ? this.decode(row.details_json) : undefined,
            ts: row.ts,
            signature: row.signature ?? undefined,
            signerDid: row.signer_did ?? undefined,
            sigAlg: row.sig_alg ?? undefined,
        }));
    }

    getPersonaAccessLog(logId: number): PersonaAccessLogRecord | undefined {
        const row = this.db.prepare(`
            SELECT *
            FROM persona_access_log
            WHERE id = ?
            LIMIT 1
        `).get(logId) as any;
        if (!row) return undefined;
        return {
            id: row.id,
            vaultId: row.vault_id,
            tokenId: row.token_id ?? undefined,
            serviceDid: row.service_did,
            operation: row.operation,
            resource: row.resource,
            result: row.result,
            details: row.details_json ? this.decode(row.details_json) : undefined,
            ts: row.ts,
            signature: row.signature ?? undefined,
            signerDid: row.signer_did ?? undefined,
            sigAlg: row.sig_alg ?? undefined,
        };
    }

    savePersonaSyncState(state: PersonaSyncStateRecord): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO persona_sync_state
            (peer_did, vault_id, cursor_id, clock_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            state.peerDid,
            state.vaultId,
            state.cursorId,
            this.encode(state.clock || {}),
            state.updatedAt
        );
    }

    getPersonaSyncState(peerDid: string, vaultId: string): PersonaSyncStateRecord | undefined {
        const row = this.db.prepare(`
            SELECT peer_did, vault_id, cursor_id, clock_json, updated_at
            FROM persona_sync_state
            WHERE peer_did = ? AND vault_id = ?
        `).get(peerDid, vaultId) as any;
        if (!row) return undefined;
        return {
            peerDid: row.peer_did,
            vaultId: row.vault_id,
            cursorId: row.cursor_id,
            clock: this.decode(row.clock_json),
            updatedAt: row.updated_at,
        };
    }

    markPersonaSyncApplied(fromDid: string, deltaId: string, vaultId: string): boolean {
        try {
            this.db.prepare(`
                INSERT INTO persona_sync_applied (from_did, delta_id, vault_id, applied_at)
                VALUES (?, ?, ?, ?)
            `).run(fromDid, deltaId, vaultId, Date.now());
            return true;
        } catch {
            return false;
        }
    }

    hasPersonaSyncApplied(fromDid: string, deltaId: string): boolean {
        const row = this.db.prepare(`
            SELECT 1
            FROM persona_sync_applied
            WHERE from_did = ? AND delta_id = ?
            LIMIT 1
        `).get(fromDid, deltaId) as any;
        return !!row;
    }

    upsertPersonaRetentionState(record: PersonaRetentionStateRecord): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO persona_retention_state
            (vault_id, domain, last_cleanup_at)
            VALUES (?, ?, ?)
        `).run(record.vaultId, record.domain, record.lastCleanupAt);
    }

    getPersonaRetentionState(vaultId: string, domain: string): PersonaRetentionStateRecord | undefined {
        const row = this.db.prepare(`
            SELECT vault_id, domain, last_cleanup_at
            FROM persona_retention_state
            WHERE vault_id = ? AND domain = ?
            LIMIT 1
        `).get(vaultId, domain) as any;
        if (!row) return undefined;
        return {
            vaultId: row.vault_id,
            domain: row.domain,
            lastCleanupAt: row.last_cleanup_at,
        };
    }

    listPersonaRetentionStates(vaultId?: string): PersonaRetentionStateRecord[] {
        const rows = vaultId
            ? this.db.prepare(`
                SELECT vault_id, domain, last_cleanup_at
                FROM persona_retention_state
                WHERE vault_id = ?
                ORDER BY domain ASC
            `).all(vaultId) as any[]
            : this.db.prepare(`
                SELECT vault_id, domain, last_cleanup_at
                FROM persona_retention_state
                ORDER BY vault_id ASC, domain ASC
            `).all() as any[];
        return rows.map((row) => ({
            vaultId: row.vault_id,
            domain: row.domain,
            lastCleanupAt: row.last_cleanup_at,
        }));
    }

    upsertPersonaGraphCache(record: PersonaGraphCacheRecord): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO persona_graph_cache
            (vault_id, domain, graph_version, ppr_blob, updated_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            record.vaultId,
            record.domain,
            record.graphVersion,
            this.encode(record.ppr || {}),
            record.updatedAt
        );
    }

    getPersonaGraphCache(
        vaultId: string,
        domain: string,
        graphVersion: string
    ): PersonaGraphCacheRecord | undefined {
        const row = this.db.prepare(`
            SELECT vault_id, domain, graph_version, ppr_blob, updated_at
            FROM persona_graph_cache
            WHERE vault_id = ? AND domain = ? AND graph_version = ?
            LIMIT 1
        `).get(vaultId, domain, graphVersion) as any;
        if (!row) return undefined;
        return {
            vaultId: row.vault_id,
            domain: row.domain,
            graphVersion: row.graph_version,
            ppr: this.decode(row.ppr_blob),
            updatedAt: row.updated_at,
        };
    }

    prunePersonaGraphCache(vaultId: string, domain: string, keep = 8): void {
        this.db.prepare(`
            DELETE FROM persona_graph_cache
            WHERE vault_id = ? AND domain = ? AND graph_version NOT IN (
                SELECT graph_version
                FROM persona_graph_cache
                WHERE vault_id = ? AND domain = ?
                ORDER BY updated_at DESC
                LIMIT ?
            )
        `).run(vaultId, domain, vaultId, domain, keep);
    }

    appendPersonaMetric(record: PersonaMetricRecord): void {
        this.db.prepare(`
            INSERT INTO persona_metrics (ts, metric, value, labels_json)
            VALUES (?, ?, ?, ?)
        `).run(
            record.ts,
            record.metric,
            record.value,
            record.labels ? this.encode(record.labels) : null
        );
    }

    listPersonaMetrics(metric: string, limit = 100, sinceTs?: number): PersonaMetricRecord[] {
        const rows = sinceTs !== undefined
            ? this.db.prepare(`
                SELECT ts, metric, value, labels_json
                FROM persona_metrics
                WHERE metric = ? AND ts >= ?
                ORDER BY ts DESC
                LIMIT ?
            `).all(metric, sinceTs, limit) as any[]
            : this.db.prepare(`
                SELECT ts, metric, value, labels_json
                FROM persona_metrics
                WHERE metric = ?
                ORDER BY ts DESC
                LIMIT ?
            `).all(metric, limit) as any[];

        return rows.map((row) => ({
            ts: row.ts,
            metric: row.metric,
            value: row.value,
            labels: row.labels_json ? this.decode(row.labels_json) : undefined,
        }));
    }

    savePersonaClaim(record: PersonaClaimRecord): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO persona_claims
            (id, vault_id, subject_did, issuer_did, schema, payload_enc, status, issued_at, expires_at, revoked_at, signature)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            record.id,
            record.vaultId,
            record.subjectDid,
            record.issuerDid ?? null,
            record.schema,
            record.payloadEnc,
            record.status,
            record.issuedAt,
            record.expiresAt ?? null,
            record.revokedAt ?? null,
            record.signature
        );
    }

    getPersonaClaim(claimId: string): PersonaClaimRecord | undefined {
        const row = this.db.prepare(`
            SELECT *
            FROM persona_claims
            WHERE id = ?
            LIMIT 1
        `).get(claimId) as any;
        if (!row) return undefined;
        return {
            id: row.id,
            vaultId: row.vault_id,
            subjectDid: row.subject_did,
            issuerDid: row.issuer_did ?? undefined,
            schema: row.schema,
            payloadEnc: row.payload_enc,
            status: row.status,
            issuedAt: row.issued_at,
            expiresAt: row.expires_at ?? undefined,
            revokedAt: row.revoked_at ?? undefined,
            signature: row.signature,
        };
    }

    listPersonaClaims(
        vaultId: string,
        options: { includeRevoked?: boolean } = {}
    ): PersonaClaimRecord[] {
        const rows = options.includeRevoked
            ? this.db.prepare(`
                SELECT *
                FROM persona_claims
                WHERE vault_id = ?
                ORDER BY issued_at DESC
            `).all(vaultId) as any[]
            : this.db.prepare(`
                SELECT *
                FROM persona_claims
                WHERE vault_id = ? AND status = 'active'
                ORDER BY issued_at DESC
            `).all(vaultId) as any[];
        return rows.map((row) => ({
            id: row.id,
            vaultId: row.vault_id,
            subjectDid: row.subject_did,
            issuerDid: row.issuer_did ?? undefined,
            schema: row.schema,
            payloadEnc: row.payload_enc,
            status: row.status,
            issuedAt: row.issued_at,
            expiresAt: row.expires_at ?? undefined,
            revokedAt: row.revoked_at ?? undefined,
            signature: row.signature,
        }));
    }

    updatePersonaClaimStatus(claimId: string, status: 'active' | 'revoked' | 'expired'): void {
        this.db.prepare(`
            UPDATE persona_claims
            SET status = ?, revoked_at = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_at END
            WHERE id = ?
        `).run(status, status, Date.now(), claimId);
    }

    savePersonaZkpProof(record: PersonaZkpProofRecord): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO persona_zkp_proofs
            (id, vault_id, circuit_id, proof_blob, public_inputs_json, claim_ids_json, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            record.id,
            record.vaultId,
            record.circuitId,
            record.proofBlob,
            this.encode(record.publicInputs || {}),
            this.encode(record.claimIds || []),
            record.createdAt,
            record.expiresAt ?? null
        );
    }

    getPersonaZkpProof(proofId: string): PersonaZkpProofRecord | undefined {
        const row = this.db.prepare(`
            SELECT *
            FROM persona_zkp_proofs
            WHERE id = ?
            LIMIT 1
        `).get(proofId) as any;
        if (!row) return undefined;
        return {
            id: row.id,
            vaultId: row.vault_id,
            circuitId: row.circuit_id,
            proofBlob: row.proof_blob,
            publicInputs: this.decode(row.public_inputs_json),
            claimIds: this.decode(row.claim_ids_json),
            createdAt: row.created_at,
            expiresAt: row.expires_at ?? undefined,
        };
    }

    listPersonaZkpProofs(vaultId: string): PersonaZkpProofRecord[] {
        const rows = this.db.prepare(`
            SELECT *
            FROM persona_zkp_proofs
            WHERE vault_id = ?
            ORDER BY created_at DESC
        `).all(vaultId) as any[];
        return rows.map((row) => ({
            id: row.id,
            vaultId: row.vault_id,
            circuitId: row.circuit_id,
            proofBlob: row.proof_blob,
            publicInputs: this.decode(row.public_inputs_json),
            claimIds: this.decode(row.claim_ids_json),
            createdAt: row.created_at,
            expiresAt: row.expires_at ?? undefined,
        }));
    }

    savePersonaZkpCircuit(record: PersonaZkpCircuitRecord): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO persona_zkp_circuits
            (circuit_id, version, vk_blob, metadata_json, active)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            record.circuitId,
            record.version,
            record.vkBlob ?? null,
            this.encode(record.metadata || {}),
            record.active ? 1 : 0
        );
    }

    getPersonaZkpCircuit(circuitId: string): PersonaZkpCircuitRecord | undefined {
        const row = this.db.prepare(`
            SELECT *
            FROM persona_zkp_circuits
            WHERE circuit_id = ?
            LIMIT 1
        `).get(circuitId) as any;
        if (!row) return undefined;
        return {
            circuitId: row.circuit_id,
            version: row.version,
            vkBlob: row.vk_blob ?? undefined,
            metadata: row.metadata_json ? this.decode(row.metadata_json) : {},
            active: !!row.active,
        };
    }

    listPersonaZkpCircuits(): PersonaZkpCircuitRecord[] {
        const rows = this.db.prepare(`
            SELECT *
            FROM persona_zkp_circuits
            ORDER BY circuit_id ASC
        `).all() as any[];
        return rows.map((row) => ({
            circuitId: row.circuit_id,
            version: row.version,
            vkBlob: row.vk_blob ?? undefined,
            metadata: row.metadata_json ? this.decode(row.metadata_json) : {},
            active: !!row.active,
        }));
    }

    private safeAddColumn(table: string, spec: string): void {
        try {
            this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${spec}`);
        } catch {
            // no-op when column already exists
        }
    }

    private ensurePersonaVectorIndex(): void {
        try {
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS persona_vec USING vec0(
                    embedding float[384]
                );
            `);
        } catch (error) {
            if (process.env.NODE_ENV === 'production') {
                throw new Error(`persona_vec index is required in production: ${(error as Error).message}`);
            }
            console.warn(`[storage] persona_vec unavailable, using non-vector fallback: ${(error as Error).message}`);
        }
    }

    // ─── Cleanup ──────────────────────────────────────────────────

    close(): void {
        this.db.close();
    }

    private encode(value: unknown): string {
        return JSON.stringify(this.toStorable(value));
    }

    private decode(value: string): any {
        return this.fromStorable(JSON.parse(value));
    }

    private toStorable(value: any): any {
        if (value instanceof Map) {
            return {
                __societyType: 'Map',
                entries: Array.from(value.entries()).map(([k, v]) => [this.toStorable(k), this.toStorable(v)]),
            };
        }
        if (value instanceof Set) {
            return {
                __societyType: 'Set',
                values: Array.from(value.values()).map((v) => this.toStorable(v)),
            };
        }
        if (Array.isArray(value)) {
            return value.map((v) => this.toStorable(v));
        }
        if (value && typeof value === 'object') {
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(value)) {
                out[k] = this.toStorable(v);
            }
            return out;
        }
        return value;
    }

    private fromStorable(value: any): any {
        if (!value || typeof value !== 'object') {
            return value;
        }

        if (value.__societyType === 'Map' && Array.isArray(value.entries)) {
            return new Map(
                value.entries.map((entry: [any, any]) => [
                    this.fromStorable(entry[0]),
                    this.fromStorable(entry[1]),
                ])
            );
        }

        if (value.__societyType === 'Set' && Array.isArray(value.values)) {
            return new Set(value.values.map((v: any) => this.fromStorable(v)));
        }

        if (Array.isArray(value)) {
            return value.map((v) => this.fromStorable(v));
        }

        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = this.fromStorable(v);
        }
        return out;
    }
}
