import crypto from 'crypto';
import { ulid } from 'ulid';
import type { Storage } from '../storage.js';
import type {
    CapabilityCaveats,
    CapabilityToken,
    CapabilityValidationInput,
    CapabilityValidationResult,
    IssueCapabilityInput,
    PersonaDomain,
} from './types.js';

interface TokenPayload {
    id: string;
    vaultId: string;
    serviceDid: string;
    scope: string;
    caveats: CapabilityToken['caveats'];
    issuedAt: number;
    expiresAt?: number;
    parentTokenId?: string;
}

function base64urlEncode(input: string): string {
    return Buffer.from(input, 'utf8').toString('base64url');
}

function base64urlDecode(input: string): string {
    return Buffer.from(input, 'base64url').toString('utf8');
}

function safeSplitToken(token: string): [string, string] | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    return [parts[0], parts[1]];
}

export class PersonaCapabilityManager {
    private signingSecret: string;

    constructor(private storage: Storage, secret?: string) {
        this.signingSecret =
            secret ||
            process.env.SOCIETY_PERSONA_CAP_SECRET ||
            crypto.createHash('sha256').update(`persona:${process.pid}:${Date.now()}`).digest('hex');
    }

    issue(input: IssueCapabilityInput & { vaultId: string }): CapabilityToken {
        const now = Date.now();
        const id = `cap_${ulid()}`;
        const expiresAt = input.caveats.expiresAt;

        const payload: TokenPayload = {
            id,
            vaultId: input.vaultId,
            serviceDid: input.serviceDid,
            scope: input.scope,
            caveats: input.caveats,
            issuedAt: now,
            expiresAt,
        };

        const payloadEncoded = base64urlEncode(JSON.stringify(payload));
        const sig = this.sign(payloadEncoded);
        const token = `${payloadEncoded}.${sig}`;
        const tokenHash = this.hashToken(token);

        this.storage.savePersonaCapability?.({
            id,
            vaultId: input.vaultId,
            serviceDid: input.serviceDid,
            scope: input.scope,
            caveats: input.caveats as unknown as Record<string, unknown>,
            tokenHash,
            status: 'active',
            issuedAt: now,
            expiresAt,
        });

        return {
            id,
            vaultId: input.vaultId,
            serviceDid: input.serviceDid,
            scope: input.scope,
            caveats: input.caveats,
            token,
            status: 'active',
            issuedAt: now,
            expiresAt,
        };
    }

    attenuate(tokenId: string, caveatsPatch: Partial<CapabilityCaveats>): CapabilityToken {
        const parent = this.storage.getPersonaCapability?.(tokenId);
        if (!parent) {
            throw new Error(`Parent capability not found: ${tokenId}`);
        }
        if (parent.status !== 'active') {
            throw new Error(`Parent capability is not active: ${tokenId}`);
        }

        const nextCaveats = this.attenuateCaveats(parent.caveats, caveatsPatch);
        const now = Date.now();
        const id = `cap_${ulid()}`;
        const payload: TokenPayload = {
            id,
            vaultId: parent.vaultId,
            serviceDid: parent.serviceDid,
            scope: parent.scope,
            caveats: nextCaveats,
            issuedAt: now,
            expiresAt: nextCaveats.expiresAt,
            parentTokenId: parent.id,
        };

        const payloadEncoded = base64urlEncode(JSON.stringify(payload));
        const sig = this.sign(payloadEncoded);
        const token = `${payloadEncoded}.${sig}`;
        const tokenHash = this.hashToken(token);

        this.storage.savePersonaCapability?.({
            id,
            vaultId: parent.vaultId,
            serviceDid: parent.serviceDid,
            scope: parent.scope,
            caveats: nextCaveats as unknown as Record<string, unknown>,
            tokenHash,
            status: 'active',
            issuedAt: now,
            expiresAt: nextCaveats.expiresAt,
            parentTokenId: parent.id,
        });

        return {
            id,
            vaultId: parent.vaultId,
            serviceDid: parent.serviceDid,
            scope: parent.scope,
            caveats: nextCaveats,
            token,
            status: 'active',
            issuedAt: now,
            expiresAt: nextCaveats.expiresAt,
            parentTokenId: parent.id,
        };
    }

    revoke(tokenId: string, reason: string): void {
        this.storage.updatePersonaCapabilityStatus?.(tokenId, 'revoked', reason, Date.now());
    }

    validate(input: CapabilityValidationInput): CapabilityValidationResult {
        const split = safeSplitToken(input.token);
        if (!split) return { allowed: false, reason: 'Malformed token' };

        const [payloadEncoded, sig] = split;
        if (this.sign(payloadEncoded) !== sig) {
            return { allowed: false, reason: 'Invalid signature' };
        }

        let payload: TokenPayload;
        try {
            payload = JSON.parse(base64urlDecode(payloadEncoded));
        } catch {
            return { allowed: false, reason: 'Invalid payload' };
        }

        const tokenHash = this.hashToken(input.token);
        const stored = this.storage.getPersonaCapabilityByHash?.(tokenHash);
        if (!stored) {
            return { allowed: false, reason: 'Capability not found' };
        }

        if (stored.status !== 'active') {
            return { allowed: false, reason: `Capability ${stored.status}` };
        }

        const now = Date.now();
        if (payload.caveats.startsAt && now < payload.caveats.startsAt) {
            return { allowed: false, reason: 'Capability not active yet' };
        }
        if (payload.expiresAt && now > payload.expiresAt) {
            this.storage.updatePersonaCapabilityStatus?.(stored.id, 'expired', 'expired', now);
            return { allowed: false, reason: 'Capability expired' };
        }

        if (payload.caveats.operations?.length && !payload.caveats.operations.includes(input.operation)) {
            return { allowed: false, reason: 'Operation not allowed' };
        }

        if (input.domain && payload.caveats.domains?.length) {
            const domains = payload.caveats.domains as PersonaDomain[];
            if (!domains.includes(input.domain)) {
                return { allowed: false, reason: 'Domain not allowed' };
            }
        }

        if (input.resource && payload.caveats.resources?.length) {
            const allowed = payload.caveats.resources.some((r) => input.resource?.startsWith(r));
            if (!allowed) {
                return { allowed: false, reason: 'Resource not allowed' };
            }
        }

        return {
            allowed: true,
            capability: {
                id: stored.id,
                vaultId: stored.vaultId,
                serviceDid: stored.serviceDid,
                scope: stored.scope,
                caveats: stored.caveats,
                token: input.token,
                status: stored.status,
                issuedAt: stored.issuedAt,
                expiresAt: stored.expiresAt,
                revokedAt: stored.revokedAt,
                parentTokenId: stored.parentTokenId,
            },
        };
    }

    private sign(payload: string): string {
        return crypto.createHmac('sha256', this.signingSecret).update(payload).digest('base64url');
    }

    private hashToken(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    private attenuateCaveats(parent: CapabilityCaveats, patch: Partial<CapabilityCaveats>): CapabilityCaveats {
        const out: CapabilityCaveats = { ...parent };
        if (patch.domains) {
            out.domains = parent.domains?.length
                ? parent.domains.filter((d) => patch.domains!.includes(d))
                : [...patch.domains];
        }
        if (patch.operations) {
            out.operations = parent.operations?.length
                ? parent.operations.filter((op) => patch.operations!.includes(op))
                : [...patch.operations];
        }
        if (patch.resources) {
            out.resources = parent.resources?.length
                ? parent.resources.filter((resource) =>
                    patch.resources!.some((candidate) => resource.startsWith(candidate) || candidate.startsWith(resource))
                )
                : [...patch.resources];
        }
        if (patch.limit !== undefined) {
            out.limit = parent.limit !== undefined ? Math.min(parent.limit, patch.limit) : patch.limit;
        }
        if (patch.startsAt !== undefined) {
            out.startsAt = parent.startsAt !== undefined ? Math.max(parent.startsAt, patch.startsAt) : patch.startsAt;
        }
        if (patch.expiresAt !== undefined) {
            out.expiresAt = parent.expiresAt !== undefined ? Math.min(parent.expiresAt, patch.expiresAt) : patch.expiresAt;
        }
        if (patch.appendOnly !== undefined) {
            out.appendOnly = parent.appendOnly || patch.appendOnly;
        }
        if (patch.requireProofs) {
            out.requireProofs = parent.requireProofs?.length
                ? parent.requireProofs.filter((proof) => patch.requireProofs!.includes(proof))
                : [...patch.requireProofs];
        }
        return out;
    }
}
