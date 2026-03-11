import type { PersonaDomain, PersonaRedactionOperation } from './types.js';

interface DomainPamuPolicy {
    shortTermWindow: number;
    emaAlpha: number;
    promoteThreshold: number;
}

export interface DomainPolicy {
    name: PersonaDomain;
    sensitive: boolean;
    defaultPrivacy: 'private' | 'federation' | 'public';
    retentionDays: number;
    allowShare: boolean;
    redactFields: string[];
    redactionByOperation: Record<PersonaRedactionOperation, string[]>;
    pamu: DomainPamuPolicy;
}

export const DOMAIN_POLICIES: Record<PersonaDomain, DomainPolicy> = {
    health: {
        name: 'health',
        sensitive: true,
        defaultPrivacy: 'private',
        retentionDays: 3650,
        allowShare: true,
        redactFields: ['content', 'metadata.diagnosis', 'metadata.biometric'],
        redactionByOperation: {
            read: ['metadata.biometric'],
            share: ['content', 'metadata.diagnosis', 'metadata.biometric'],
            export: ['content', 'metadata.diagnosis', 'metadata.biometric', 'metadata.patientId'],
        },
        pamu: { shortTermWindow: 80, emaAlpha: 0.2, promoteThreshold: 2 },
    },
    work: {
        name: 'work',
        sensitive: false,
        defaultPrivacy: 'federation',
        retentionDays: 3650,
        allowShare: true,
        redactFields: [],
        redactionByOperation: {
            read: [],
            share: [],
            export: [],
        },
        pamu: { shortTermWindow: 60, emaAlpha: 0.18, promoteThreshold: 2 },
    },
    social: {
        name: 'social',
        sensitive: false,
        defaultPrivacy: 'federation',
        retentionDays: 3650,
        allowShare: true,
        redactFields: [],
        redactionByOperation: {
            read: [],
            share: [],
            export: [],
        },
        pamu: { shortTermWindow: 60, emaAlpha: 0.15, promoteThreshold: 3 },
    },
    family: {
        name: 'family',
        sensitive: true,
        defaultPrivacy: 'private',
        retentionDays: 3650,
        allowShare: true,
        redactFields: ['content', 'metadata.children', 'metadata.address'],
        redactionByOperation: {
            read: ['metadata.address'],
            share: ['content', 'metadata.children', 'metadata.address'],
            export: ['content', 'metadata.children', 'metadata.address'],
        },
        pamu: { shortTermWindow: 70, emaAlpha: 0.16, promoteThreshold: 2 },
    },
    finance: {
        name: 'finance',
        sensitive: true,
        defaultPrivacy: 'private',
        retentionDays: 3650,
        allowShare: false,
        redactFields: ['content', 'metadata.account', 'metadata.balance', 'metadata.card'],
        redactionByOperation: {
            read: ['metadata.account', 'metadata.card'],
            share: ['content', 'metadata.account', 'metadata.balance', 'metadata.card'],
            export: ['content', 'metadata.account', 'metadata.balance', 'metadata.card', 'metadata.iban'],
        },
        pamu: { shortTermWindow: 90, emaAlpha: 0.12, promoteThreshold: 2 },
    },
    learning: {
        name: 'learning',
        sensitive: false,
        defaultPrivacy: 'federation',
        retentionDays: 3650,
        allowShare: true,
        redactFields: [],
        redactionByOperation: {
            read: [],
            share: [],
            export: [],
        },
        pamu: { shortTermWindow: 55, emaAlpha: 0.2, promoteThreshold: 2 },
    },
    travel: {
        name: 'travel',
        sensitive: true,
        defaultPrivacy: 'private',
        retentionDays: 3650,
        allowShare: true,
        redactFields: ['metadata.passport', 'metadata.location'],
        redactionByOperation: {
            read: ['metadata.passport'],
            share: ['metadata.passport', 'metadata.location'],
            export: ['metadata.passport', 'metadata.location', 'content'],
        },
        pamu: { shortTermWindow: 50, emaAlpha: 0.15, promoteThreshold: 3 },
    },
    identity: {
        name: 'identity',
        sensitive: true,
        defaultPrivacy: 'private',
        retentionDays: 3650,
        allowShare: true,
        redactFields: ['content', 'metadata.document', 'metadata.birthdate'],
        redactionByOperation: {
            read: ['metadata.document'],
            share: ['content', 'metadata.document', 'metadata.birthdate'],
            export: ['content', 'metadata.document', 'metadata.birthdate', 'metadata.nationalId'],
        },
        pamu: { shortTermWindow: 100, emaAlpha: 0.1, promoteThreshold: 2 },
    },
    preferences: {
        name: 'preferences',
        sensitive: false,
        defaultPrivacy: 'federation',
        retentionDays: 3650,
        allowShare: true,
        redactFields: [],
        redactionByOperation: {
            read: [],
            share: [],
            export: [],
        },
        pamu: { shortTermWindow: 45, emaAlpha: 0.25, promoteThreshold: 2 },
    },
    general: {
        name: 'general',
        sensitive: false,
        defaultPrivacy: 'federation',
        retentionDays: 3650,
        allowShare: true,
        redactFields: [],
        redactionByOperation: {
            read: [],
            share: [],
            export: [],
        },
        pamu: { shortTermWindow: 50, emaAlpha: 0.15, promoteThreshold: 3 },
    },
};

export function getDomainPolicy(domain: PersonaDomain): DomainPolicy {
    return DOMAIN_POLICIES[domain] || DOMAIN_POLICIES.general;
}

export function redactByDomain<T extends Record<string, any>>(domain: PersonaDomain, data: T): T {
    return redactByDomainOperation(domain, data, 'share');
}

export function redactByDomainOperation<T extends Record<string, any>>(
    domain: PersonaDomain,
    data: T,
    operation: PersonaRedactionOperation
): T {
    const policy = getDomainPolicy(domain);
    const redactionFields = policy.redactionByOperation[operation] || policy.redactFields || [];
    if (!policy.sensitive || redactionFields.length === 0) {
        return data;
    }

    const clone: Record<string, any> = { ...data };
    for (const field of redactionFields) {
        const parts = field.split('.');
        if (parts.length === 1) {
            if (parts[0] in clone) clone[parts[0]] = '[REDACTED]';
            continue;
        }
        let cursor: any = clone;
        for (let i = 0; i < parts.length - 1; i++) {
            cursor = cursor?.[parts[i]];
            if (!cursor || typeof cursor !== 'object') break;
        }
        const leaf = parts[parts.length - 1];
        if (cursor && typeof cursor === 'object' && leaf in cursor) {
            cursor[leaf] = '[REDACTED]';
        }
    }

    return clone as T;
}
