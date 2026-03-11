import type { PersonaNode } from './types.js';

export interface LifecycleState {
    shortTerm: Record<string, number>;
    longTerm: Record<string, number>;
    lastUpdatedAt: number;
}

export class PersonaLifecycle {
    constructor(
        private shortTermWindow = 50,
        private emaAlpha = 0.15
    ) {}

    update(
        state: LifecycleState | undefined,
        node: PersonaNode,
        policy?: { shortTermWindow?: number; emaAlpha?: number; promoteThreshold?: number }
    ): LifecycleState {
        const current: LifecycleState = state || {
            shortTerm: {},
            longTerm: {},
            lastUpdatedAt: Date.now(),
        };
        const shortTermWindow = Math.max(10, policy?.shortTermWindow ?? this.shortTermWindow);
        const emaAlpha = Math.min(0.95, Math.max(0.01, policy?.emaAlpha ?? this.emaAlpha));
        const promoteThreshold = Math.max(1, policy?.promoteThreshold ?? 2);

        const key = `${node.domain}:${node.type}:${node.title}`.toLowerCase();
        current.shortTerm[key] = (current.shortTerm[key] || 0) + 1;

        // Keep short-term bounded by trimming low-frequency entries.
        const keys = Object.keys(current.shortTerm);
        if (keys.length > shortTermWindow) {
            keys
                .sort((a, b) => current.shortTerm[a] - current.shortTerm[b])
                .slice(0, keys.length - shortTermWindow)
                .forEach((k) => {
                    delete current.shortTerm[k];
                });
        }

        const prev = current.longTerm[key] || 0;
        const signal = current.shortTerm[key] >= promoteThreshold ? 1 : 0;
        current.longTerm[key] = emaAlpha * signal + (1 - emaAlpha) * prev;
        current.lastUpdatedAt = Date.now();
        return current;
    }
}
