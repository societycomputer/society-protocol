import { ulid } from 'ulid';
import * as Automerge from '@automerge/automerge';
import type {
    PersonaEdge,
    PersonaNode,
    PersonaSyncDelta,
    PersonaSyncOperation,
    SyncApplyResult,
    ZkProofBundle,
} from './types.js';

export function createPersonaDelta(input: {
    vaultId: string;
    fromDid: string;
    operations: PersonaSyncOperation[];
    vectorClock: Record<string, number>;
    cursor?: string;
    proofs?: ZkProofBundle[];
}): PersonaSyncDelta {
    return {
        id: `psync_${ulid()}`,
        vaultId: input.vaultId,
        fromDid: input.fromDid,
        operations: input.operations,
        vectorClock: input.vectorClock,
        cursor: input.cursor,
        proofs: input.proofs,
        createdAt: Date.now(),
    };
}

export function mergeNodeLww(local: PersonaNode | undefined, incoming: PersonaNode): PersonaNode {
    if (!local) return incoming;
    if ((incoming.updatedAt || 0) > (local.updatedAt || 0)) return incoming;
    if ((incoming.updatedAt || 0) < (local.updatedAt || 0)) return local;

    // Tie-break by deterministic id.
    return incoming.id > local.id ? incoming : local;
}

export function mergeEdgeWeighted(local: PersonaEdge | undefined, incoming: PersonaEdge): PersonaEdge {
    if (!local) return incoming;
    if (incoming.deletedAt && !local.deletedAt) return incoming;
    if (local.deletedAt && !incoming.deletedAt) return local;

    const c1 = Math.max(local.confidence || 0.01, 0.01);
    const c2 = Math.max(incoming.confidence || 0.01, 0.01);
    const weight = (local.weight * c1 + incoming.weight * c2) / (c1 + c2);

    return {
        ...local,
        ...incoming,
        weight,
        confidence: Math.max(local.confidence || 0, incoming.confidence || 0),
        updatedAt: Math.max(local.updatedAt || 0, incoming.updatedAt || 0),
    };
}

export function mergeDomainDoc(
    current: Automerge.Doc<Record<string, any>> | undefined,
    patch: Record<string, any>
): Automerge.Doc<Record<string, any>> {
    const base = current || Automerge.from<Record<string, any>>({});
    return Automerge.change(base, (doc) => {
        for (const [k, v] of Object.entries(patch)) {
            doc[k] = cloneForAutomerge(mergeValue(doc[k], v));
        }
    });
}

export function emptyApplyResult(cursor: string): SyncApplyResult {
    return { applied: 0, ignored: 0, cursor };
}

function mergeValue(local: any, incoming: any): any {
    if (local === undefined || local === null) return incoming;
    if (incoming === undefined || incoming === null) return local;

    if (Array.isArray(local) && Array.isArray(incoming)) {
        const seen = new Set<string>();
        const out: any[] = [];
        for (const item of [...local, ...incoming]) {
            const key = typeof item === 'string' ? item : JSON.stringify(item);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(item);
        }
        return out;
    }

    if (typeof local === 'object' && typeof incoming === 'object') {
        const localUpdated = Number(local.updatedAt || local.updated_at || 0);
        const incomingUpdated = Number(incoming.updatedAt || incoming.updated_at || 0);
        if ((localUpdated > 0 || incomingUpdated > 0) && incomingUpdated !== localUpdated) {
            return incomingUpdated > localUpdated ? incoming : local;
        }

        const out: Record<string, any> = { ...local };
        for (const [k, v] of Object.entries(incoming)) {
            out[k] = mergeValue(local[k], v);
        }
        return out;
    }

    return incoming;
}

function cloneForAutomerge(value: any): any {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
}
