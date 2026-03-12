import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ulid } from 'ulid';
import { fileURLToPath } from 'url';
import type { Storage } from '../../storage.js';
import type {
    GenerateZkProofInput,
    VerifyZkProofInput,
    ZkCircuitId,
    ZkProofBundle,
    ZkVerifyResult,
} from '../types.js';
import type { ZkChallenge, ZkChallengeInput, ZkCircuitDefinition } from './types.js';

const DEFAULT_CIRCUITS: ZkCircuitDefinition[] = [
    {
        circuitId: 'age_over_18',
        version: '1.0.0',
        description: 'Prove that user age is above minimum threshold without disclosing DOB.',
        publicInputs: ['minAge', 'referenceDate', 'subjectDid'],
        privateInputs: ['dob'],
        active: true,
    },
    {
        circuitId: 'domain_membership',
        version: '1.0.0',
        description: 'Prove possession of active domain membership claim.',
        publicInputs: ['domain', 'subjectDid'],
        privateInputs: ['membershipClaimSecret'],
        active: true,
    },
    {
        circuitId: 'capability_possession',
        version: '1.0.0',
        description: 'Prove capability possession without exposing token body.',
        publicInputs: ['scope', 'serviceDid'],
        privateInputs: ['capabilityToken'],
        active: true,
    },
    {
        circuitId: 'did_ownership',
        version: '1.0.0',
        description: 'Prove ownership of a DID via Schnorr PoK without exposing private key.',
        publicInputs: ['did', 'challenge', 'roomId'],
        privateInputs: ['privateKey'],
        active: true,
    },
];

const ARTIFACTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'artifacts');

interface CircuitManifestEntry {
    id: ZkCircuitId;
    version?: string;
    acir?: string;
    vk?: string;
    hash?: string;
}

function canonical(value: unknown): string {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((v) => canonical(v)).join(',')}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

export class PersonaZkpEngine {
    private signingSecret: string;
    private providerMode: 'mock-noir-bb' | 'noir-bb';
    private noirRunner?: string;
    private warnedNoirFallback = false;
    private circuitManifest = new Map<ZkCircuitId, CircuitManifestEntry>();

    constructor(
        private storage: Storage,
        private identityDid: string,
        secret?: string
    ) {
        this.signingSecret =
            secret ||
            process.env.SOCIETY_PERSONA_ZKP_SECRET ||
            crypto.createHash('sha256').update('persona-zkp-shared-v1').digest('hex');
        this.providerMode =
            (process.env.SOCIETY_PERSONA_ZKP_PROVIDER as 'mock-noir-bb' | 'noir-bb') ||
            (process.env.NODE_ENV === 'production' ? 'noir-bb' : 'mock-noir-bb');
        this.noirRunner = process.env.SOCIETY_PERSONA_ZKP_RUNNER;
        if (!this.noirRunner) {
            const bundledCandidates = [
                join(process.cwd(), 'scripts', 'persona-zkp-runner.mjs'),
                join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'persona-zkp-runner.mjs'),
            ];
            this.noirRunner = bundledCandidates.find((candidate) => existsSync(candidate));
        }
        if (this.providerMode === 'noir-bb' && !this.noirRunner && process.env.NODE_ENV === 'production') {
            throw new Error('SOCIETY_PERSONA_ZKP_RUNNER is required in production when provider=noir-bb.');
        }
        this.loadCircuitManifest();
        this.assertProductionArtifacts();
        this.seedCircuits();
    }

    listCircuits(): ZkCircuitDefinition[] {
        const rows = this.storage.listPersonaZkpCircuits?.() || [];
        if (rows.length === 0) return DEFAULT_CIRCUITS;
        return rows.map((row: any) => ({
            circuitId: row.circuitId as ZkCircuitId,
            version: row.version,
            description: String(row.metadata?.description || ''),
            publicInputs: Array.isArray(row.metadata?.publicInputs) ? row.metadata.publicInputs : [],
            privateInputs: Array.isArray(row.metadata?.privateInputs) ? row.metadata.privateInputs : [],
            active: !!row.active,
        }));
    }

    createChallenge(input: ZkChallengeInput): ZkChallenge {
        return {
            id: `zkch_${ulid()}`,
            circuitId: input.circuitId,
            nonce: input.nonce || crypto.randomBytes(16).toString('hex'),
            createdAt: Date.now(),
            context: input.context || {},
        };
    }

    generateProof(vaultId: string, input: GenerateZkProofInput): ZkProofBundle {
        this.assertCircuitActive(input.circuitId);
        const issuedAt = Date.now();
        const noirBundle = this.tryGenerateWithNoir(vaultId, input, issuedAt);
        if (noirBundle) {
            this.storage.savePersonaZkpProof?.({
                id: noirBundle.id,
                vaultId: noirBundle.vaultId,
                circuitId: noirBundle.circuitId,
                proofBlob: noirBundle.proof,
                publicInputs: noirBundle.publicInputs,
                claimIds: noirBundle.claimIds,
                createdAt: noirBundle.createdAt,
                expiresAt: noirBundle.expiresAt,
            });
            return noirBundle;
        }

        const payload = {
            circuitId: input.circuitId,
            publicInputs: input.publicInputs || {},
            privateInputs: input.privateInputs || {},
            claimIds: input.claimIds || [],
            issuedAt,
        };
        const payloadStr = canonical(payload);
        const mac = crypto.createHmac('sha256', this.signingSecret).update(payloadStr).digest('base64url');
        const proof = `${Buffer.from(payloadStr, 'utf8').toString('base64url')}.${mac}`;

        const bundle: ZkProofBundle = {
            id: `zkp_${ulid()}`,
            vaultId,
            circuitId: input.circuitId,
            proof,
            publicInputs: input.publicInputs || {},
            claimIds: input.claimIds || [],
            createdAt: issuedAt,
            expiresAt: input.expiresAt,
            proofSystem: 'mock-noir-bb',
        };

        this.storage.savePersonaZkpProof?.({
            id: bundle.id,
            vaultId: bundle.vaultId,
            circuitId: bundle.circuitId,
            proofBlob: bundle.proof,
            publicInputs: bundle.publicInputs,
            claimIds: bundle.claimIds,
            createdAt: bundle.createdAt,
            expiresAt: bundle.expiresAt,
        });

        return bundle;
    }

    verifyProof(input: VerifyZkProofInput): ZkVerifyResult {
        const bundle = input.proofBundle;
        this.assertCircuitActive(bundle.circuitId);

        if (bundle.expiresAt && Date.now() > bundle.expiresAt) {
            return { valid: false, reason: 'Proof expired', circuitId: bundle.circuitId };
        }

        const noirResult = this.tryVerifyWithNoir(bundle);
        if (noirResult) {
            return noirResult;
        }

        const parts = bundle.proof.split('.');
        if (parts.length !== 2) {
            return { valid: false, reason: 'Malformed proof', circuitId: bundle.circuitId };
        }

        const payloadEncoded = parts[0];
        const mac = parts[1];
        const expected = crypto.createHmac('sha256', this.signingSecret).update(Buffer.from(payloadEncoded, 'base64url')).digest('base64url');
        if (expected !== mac) {
            return { valid: false, reason: 'Invalid proof MAC', circuitId: bundle.circuitId };
        }

        let payload: any;
        try {
            payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8'));
        } catch {
            return { valid: false, reason: 'Invalid proof payload', circuitId: bundle.circuitId };
        }

        const samePublicInputs = canonical(payload.publicInputs || {}) === canonical(bundle.publicInputs || {});
        if (!samePublicInputs) {
            return { valid: false, reason: 'Public inputs mismatch', circuitId: bundle.circuitId };
        }

        if (bundle.claimIds.length > 0) {
            const claims = this.storage.listPersonaClaims?.(bundle.vaultId, { includeRevoked: false }) || [];
            if (claims.length > 0) {
                const claimSet = new Set(claims.map((c: any) => c.id));
                for (const claimId of bundle.claimIds) {
                    if (!claimSet.has(claimId)) {
                        return { valid: false, reason: `Claim not active: ${claimId}`, circuitId: bundle.circuitId };
                    }
                }
            }
        }

        return { valid: true, circuitId: bundle.circuitId };
    }

    private assertCircuitActive(circuitId: ZkCircuitId): void {
        const circuit = this.listCircuits().find((c) => c.circuitId === circuitId);
        if (!circuit) {
            throw new Error(`Unknown ZKP circuit: ${circuitId}`);
        }
        if (!circuit.active) {
            throw new Error(`ZKP circuit is inactive: ${circuitId}`);
        }
    }

    private seedCircuits(): void {
        for (const circuit of DEFAULT_CIRCUITS) {
            const manifest = this.circuitManifest.get(circuit.circuitId);
            const acirPath = manifest?.acir ? join(ARTIFACTS_DIR, manifest.acir) : undefined;
            const vkPath = manifest?.vk ? join(ARTIFACTS_DIR, manifest.vk) : undefined;
            const artifactReady = !!(
                manifest &&
                acirPath &&
                vkPath &&
                existsSync(acirPath) &&
                existsSync(vkPath) &&
                !String(manifest.acir).includes('placeholder') &&
                !String(manifest.vk).includes('placeholder')
            );
            this.storage.savePersonaZkpCircuit?.({
                circuitId: circuit.circuitId,
                version: circuit.version,
                vkBlob: null,
                metadata: {
                    description: circuit.description,
                    publicInputs: circuit.publicInputs,
                    privateInputs: circuit.privateInputs,
                    artifactType: 'noir-acir-vk',
                    acirPath: manifest?.acir || null,
                    vkPath: manifest?.vk || null,
                    artifactHash: manifest?.hash || null,
                    artifactReady,
                },
                active: circuit.active,
            });
        }
    }

    private tryGenerateWithNoir(
        vaultId: string,
        input: GenerateZkProofInput,
        issuedAt: number
    ): ZkProofBundle | undefined {
        if (this.providerMode !== 'noir-bb') return undefined;
        if (!this.noirRunner) {
            this.warnNoirFallback('Noir runner not configured');
            return undefined;
        }
        try {
            const result = this.runNoirRunner('prove', {
                vaultId,
                circuitId: input.circuitId,
                privateInputs: input.privateInputs || {},
                publicInputs: input.publicInputs || {},
                claimIds: input.claimIds || [],
                issuedAt,
                expiresAt: input.expiresAt,
            });
            return {
                id: `zkp_${ulid()}`,
                vaultId,
                circuitId: input.circuitId,
                proof: String(result.proof || ''),
                publicInputs: (result.publicInputs as Record<string, unknown>) || input.publicInputs || {},
                claimIds: (result.claimIds as string[]) || input.claimIds || [],
                createdAt: issuedAt,
                expiresAt: input.expiresAt,
                proofSystem: 'noir-bb',
            };
        } catch (error) {
            if (process.env.NODE_ENV === 'production') {
                throw new Error(`Noir/Barretenberg prove failed: ${(error as Error).message}`);
            }
            this.warnNoirFallback((error as Error).message);
            return undefined;
        }
    }

    private tryVerifyWithNoir(bundle: ZkProofBundle): ZkVerifyResult | undefined {
        const shouldTryNoir = this.providerMode === 'noir-bb' || bundle.proofSystem === 'noir-bb';
        if (!shouldTryNoir) return undefined;
        if (!this.noirRunner) {
            if (process.env.NODE_ENV === 'production') {
                throw new Error('Noir/Barretenberg verify requires SOCIETY_PERSONA_ZKP_RUNNER.');
            }
            this.warnNoirFallback('Noir runner not configured');
            return undefined;
        }
        try {
            const result = this.runNoirRunner('verify', {
                circuitId: bundle.circuitId,
                proof: bundle.proof,
                publicInputs: bundle.publicInputs || {},
                claimIds: bundle.claimIds || [],
                expiresAt: bundle.expiresAt,
            });
            if (result.valid === true) {
                return { valid: true, circuitId: bundle.circuitId };
            }
            return {
                valid: false,
                reason: String(result.reason || 'Noir/Barretenberg verification failed'),
                circuitId: bundle.circuitId,
            };
        } catch (error) {
            if (process.env.NODE_ENV === 'production') {
                throw new Error(`Noir/Barretenberg verify failed: ${(error as Error).message}`);
            }
            this.warnNoirFallback((error as Error).message);
            return undefined;
        }
    }

    private runNoirRunner(operation: 'prove' | 'verify', payload: Record<string, unknown>): Record<string, unknown> {
        const output = execFileSync(this.noirRunner as string, [operation], {
            input: JSON.stringify(payload),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const parsed = JSON.parse(output || '{}');
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Invalid noir runner JSON output');
        }
        return parsed as Record<string, unknown>;
    }

    private warnNoirFallback(reason: string): void {
        if (this.warnedNoirFallback) return;
        this.warnedNoirFallback = true;
        console.warn(`[persona-zkp] Falling back to mock-noir-bb provider in non-production mode: ${reason}`);
    }

    private loadCircuitManifest(): void {
        const manifestPath = join(ARTIFACTS_DIR, 'circuits.json');
        if (!existsSync(manifestPath)) return;
        try {
            const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
                circuits?: CircuitManifestEntry[];
            };
            for (const circuit of parsed.circuits || []) {
                if (!circuit?.id) continue;
                this.circuitManifest.set(circuit.id, circuit);
            }
        } catch {
            // Ignore malformed manifest in non-production mode.
        }
    }

    private assertProductionArtifacts(): void {
        if (process.env.NODE_ENV !== 'production') return;
        if (this.providerMode !== 'noir-bb') return;

        const missing: string[] = [];
        for (const circuit of DEFAULT_CIRCUITS) {
            const manifest = this.circuitManifest.get(circuit.circuitId);
            const acirPath = manifest?.acir ? join(ARTIFACTS_DIR, manifest.acir) : '';
            const vkPath = manifest?.vk ? join(ARTIFACTS_DIR, manifest.vk) : '';
            const acirBody = acirPath && existsSync(acirPath) ? readFileSync(acirPath, 'utf8') : '';
            const vkBody = vkPath && existsSync(vkPath) ? readFileSync(vkPath, 'utf8') : '';
            const ok =
                !!manifest &&
                !!acirPath &&
                !!vkPath &&
                existsSync(acirPath) &&
                existsSync(vkPath) &&
                !String(manifest.acir).includes('placeholder') &&
                !String(manifest.vk).includes('placeholder') &&
                !/placeholder|dummy/i.test(acirBody) &&
                !/placeholder|dummy/i.test(vkBody);
            if (!ok) {
                missing.push(circuit.circuitId);
            }
        }

        if (missing.length > 0) {
            throw new Error(`Missing Noir/Barretenberg artifacts for circuits: ${missing.join(', ')}`);
        }
    }
}
