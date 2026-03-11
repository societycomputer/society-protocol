import type { PersonaClaimId, PersonaVaultId, ZkCircuitId } from '../types.js';

export interface ZkCircuitDefinition {
    circuitId: ZkCircuitId;
    version: string;
    description: string;
    publicInputs: string[];
    privateInputs: string[];
    active: boolean;
}

export interface ZkCircuitArtifact {
    circuitId: ZkCircuitId;
    version: string;
    acir?: string;
    vk?: string;
    metadata?: Record<string, unknown>;
}

export interface ZkProofRecord {
    id: string;
    vaultId: PersonaVaultId;
    circuitId: ZkCircuitId;
    proofBlob: string;
    publicInputs: Record<string, unknown>;
    claimIds: PersonaClaimId[];
    createdAt: number;
    expiresAt?: number;
}

export interface ZkChallengeInput {
    circuitId: ZkCircuitId;
    nonce?: string;
    context?: Record<string, unknown>;
}

export interface ZkChallenge {
    id: string;
    circuitId: ZkCircuitId;
    nonce: string;
    createdAt: number;
    context: Record<string, unknown>;
}

