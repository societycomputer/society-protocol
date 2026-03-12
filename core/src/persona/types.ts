export type PersonaVaultId = string;
export type PersonaNodeId = string;
export type PersonaEdgeId = string;
export type PersonaClaimId = string;
export type ZkProofId = string;
export type ZkCircuitId = 'age_over_18' | 'domain_membership' | 'capability_possession' | 'did_ownership';
export type PersonaDomain =
    | 'health'
    | 'work'
    | 'social'
    | 'family'
    | 'finance'
    | 'learning'
    | 'travel'
    | 'identity'
    | 'preferences'
    | 'general';

export type PersonaNodeType =
    | 'entity'
    | 'event'
    | 'concept'
    | 'preference'
    | 'skill'
    | 'workflow'
    | 'claim'
    | 'memory';

export type PersonaRedactionOperation = 'read' | 'share' | 'export';

export type PersonaEdgeType =
    | 'related_to'
    | 'part_of'
    | 'caused_by'
    | 'preferred_by'
    | 'supports'
    | 'contradicts'
    | 'depends_on'
    | 'occurs_with';

export interface PersonaVault {
    id: PersonaVaultId;
    ownerDid: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    settings: {
        shortTermWindow: number;
        emaAlpha: number;
        maxShareResults: number;
    };
}

export interface PersonaNode {
    id: PersonaNodeId;
    vaultId: PersonaVaultId;
    domain: PersonaDomain;
    type: PersonaNodeType;
    title: string;
    content: string;
    tags: string[];
    confidence: number;
    source?: {
        type: 'manual' | 'mcp' | 'sdk' | 'sync';
        actorDid?: string;
        reference?: string;
    };
    metadata: Record<string, unknown>;
    validFrom?: number;
    validTo?: number;
    createdAt: number;
    updatedAt: number;
    deletedAt?: number;
}

export interface PersonaEdge {
    id: PersonaEdgeId;
    vaultId: PersonaVaultId;
    sourceNodeId: PersonaNodeId;
    targetNodeId: PersonaNodeId;
    type: PersonaEdgeType;
    weight: number;
    confidence: number;
    metadata: Record<string, unknown>;
    validFrom?: number;
    validTo?: number;
    updatedAt: number;
    deletedAt?: number;
}

export interface PersonaHyperEdge {
    id: string;
    vaultId: PersonaVaultId;
    nodeIds: PersonaNodeId[];
    type: PersonaEdgeType;
    metadata: Record<string, unknown>;
    updatedAt: number;
    deletedAt?: number;
}

export interface AddMemoryInput {
    vaultId?: PersonaVaultId;
    domain: PersonaDomain;
    type: PersonaNodeType;
    title: string;
    content: string;
    tags?: string[];
    confidence?: number;
    metadata?: Record<string, unknown>;
    source?: PersonaNode['source'];
    validFrom?: number;
    validTo?: number;
}

export interface UpdateMemoryInput {
    title?: string;
    content?: string;
    tags?: string[];
    confidence?: number;
    metadata?: Record<string, unknown>;
    validFrom?: number;
    validTo?: number;
}

export interface LinkMemoryInput {
    vaultId?: PersonaVaultId;
    sourceNodeId: PersonaNodeId;
    targetNodeId: PersonaNodeId;
    type: PersonaEdgeType;
    weight?: number;
    confidence?: number;
    metadata?: Record<string, unknown>;
    validFrom?: number;
    validTo?: number;
}

export interface MemoryQueryInput {
    vaultId?: PersonaVaultId;
    query?: string;
    domain?: PersonaDomain;
    domains?: PersonaDomain[];
    types?: PersonaNodeType[];
    tags?: string[];
    limit?: number;
    includeDeleted?: boolean;
}

export interface MemoryQueryResult {
    nodes: Array<PersonaNode & { score: number; scoreBreakdown: ScoreBreakdown }>;
    elapsedMs: number;
}

export interface GraphQueryInput {
    vaultId?: PersonaVaultId;
    rootNodeId?: PersonaNodeId;
    domain?: PersonaDomain;
    maxDepth?: number;
    limit?: number;
}

export interface GraphQueryResult {
    nodes: PersonaNode[];
    edges: PersonaEdge[];
    hyperEdges: PersonaHyperEdge[];
}

export interface UpdatePreferenceInput {
    vaultId?: PersonaVaultId;
    key: string;
    value: unknown;
    confidence?: number;
    domain?: PersonaDomain;
    tags?: string[];
}

export interface CapabilityCaveats {
    domains?: PersonaDomain[];
    operations?: Array<'read' | 'write' | 'delete' | 'share'>;
    resources?: string[];
    appendOnly?: boolean;
    limit?: number;
    startsAt?: number;
    expiresAt?: number;
    requireProofs?: ZkCircuitId[];
}

export interface IssueCapabilityInput {
    vaultId?: PersonaVaultId;
    serviceDid: string;
    scope: string;
    caveats: CapabilityCaveats;
}

export interface CapabilityToken {
    id: string;
    vaultId: PersonaVaultId;
    serviceDid: string;
    scope: string;
    caveats: CapabilityCaveats;
    token: string;
    status: 'active' | 'revoked' | 'expired';
    issuedAt: number;
    expiresAt?: number;
    revokedAt?: number;
    parentTokenId?: string;
}

export interface CapabilityValidationInput {
    token: string;
    operation: 'read' | 'write' | 'delete' | 'share';
    domain?: PersonaDomain;
    resource?: string;
}

export interface CapabilityValidationResult {
    allowed: boolean;
    reason?: string;
    capability?: CapabilityToken;
}

export interface PersonaClaim {
    id: PersonaClaimId;
    vaultId: PersonaVaultId;
    subjectDid: string;
    issuerDid?: string;
    schema: string;
    payload: Record<string, unknown>;
    status: 'active' | 'revoked' | 'expired';
    issuedAt: number;
    expiresAt?: number;
    revokedAt?: number;
    signature: string;
}

export interface IssueClaimInput {
    vaultId?: PersonaVaultId;
    schema: string;
    payload: Record<string, unknown>;
    subjectDid?: string;
    issuerDid?: string;
    issuerSignature?: string;
    expiresAt?: number;
}

export interface ZkProofBundle {
    id: ZkProofId;
    vaultId: PersonaVaultId;
    circuitId: ZkCircuitId;
    proof: string;
    publicInputs: Record<string, unknown>;
    claimIds: PersonaClaimId[];
    createdAt: number;
    expiresAt?: number;
    proofSystem: 'noir-bb' | 'mock-noir-bb';
}

export interface GenerateZkProofInput {
    vaultId?: PersonaVaultId;
    circuitId: ZkCircuitId;
    privateInputs: Record<string, unknown>;
    publicInputs?: Record<string, unknown>;
    claimIds?: PersonaClaimId[];
    expiresAt?: number;
}

export interface VerifyZkProofInput {
    vaultId?: PersonaVaultId;
    proofBundle: ZkProofBundle;
}

export interface ZkVerifyResult {
    valid: boolean;
    reason?: string;
    circuitId: ZkCircuitId;
}

export interface ScoreBreakdown {
    lexical: number;
    vector: number;
    graph: number;
    final: number;
}

export interface PersonaSyncOperation {
    type:
        | 'node_upsert'
        | 'node_delete'
        | 'edge_upsert'
        | 'edge_delete'
        | 'capability_revoke'
        | 'capability_attenuate'
        | 'claim_upsert'
        | 'claim_revoke'
        | 'zkp_proof_upsert';
    payload: Record<string, unknown>;
}

export interface PersonaSyncDelta {
    id: string;
    vaultId: PersonaVaultId;
    fromDid: string;
    cursor?: string;
    operations: PersonaSyncOperation[];
    vectorClock: Record<string, number>;
    proofs?: ZkProofBundle[];
    createdAt: number;
}

export interface SyncApplyResult {
    applied: number;
    ignored: number;
    cursor: string;
}

export interface VerifyPersonaAccessLogInput {
    logId: number;
}

export interface VerifyPersonaAccessLogResult {
    logId: number;
    valid: boolean;
    reason?: string;
}

export interface RunRetentionSweepInput {
    vaultId?: PersonaVaultId;
    domain?: PersonaDomain;
    dryRun?: boolean;
}

export interface RunRetentionSweepResult {
    scanned: number;
    deleted: number;
}

export interface ExportSubgraphInput {
    vaultId?: PersonaVaultId;
    domain?: PersonaDomain;
    nodeIds?: PersonaNodeId[];
    includeNeighbors?: boolean;
    redactionOperation?: PersonaRedactionOperation;
}

export interface PortableSubgraph {
    vaultId: PersonaVaultId;
    exportedAt: number;
    nodes: PersonaNode[];
    edges: PersonaEdge[];
    hyperEdges: PersonaHyperEdge[];
}
