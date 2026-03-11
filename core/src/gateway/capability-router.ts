/**
 * Society Protocol — Capability Router
 *
 * Inspired by:
 * - DAAO (arXiv:2509.11079): Difficulty-aware routing
 * - DyLAN (arXiv:2310.02170): Agent importance scoring
 * - MaAS (arXiv:2502.04180): Per-query architecture sampling
 *
 * Analyzes incoming requests and decides:
 * 1. Complexity level (simple → single agent, complex → swarm)
 * 2. Required capabilities (what skills/specialties are needed)
 * 3. Routing mode (select from pool vs spawn new agents)
 */

import type { SwarmAgentProfile } from '../proactive/swarm-controller.js';

// ─── Types ───────────────────────────────────────────────────────

export interface IncomingRequest {
    /** The goal / task description */
    goal: string;
    /** Optional room to execute in */
    roomId?: string;
    /** Optional required capabilities */
    requiredCapabilities?: string[];
    /** Optional priority */
    priority?: 'low' | 'normal' | 'high' | 'critical';
    /** Optional max agents to use */
    maxAgents?: number;
    /** Caller identity */
    callerDid?: string;
    /** Additional context */
    context?: Record<string, unknown>;
}

export type RoutingMode = 'single-agent' | 'select-from-pool' | 'spawn-team';

export interface RoleSpec {
    /** Role name (e.g., 'researcher', 'coder', 'reviewer') */
    role: string;
    /** Task type for matching */
    taskType: string;
    /** Required capabilities */
    capabilities: string[];
    /** Required specialties */
    specialties: string[];
    /** Step kind in CoC */
    kind: 'task' | 'review' | 'synthesis' | 'verification';
    /** Priority for this role */
    priority: number;
}

export interface RoutingDecision {
    /** How to route */
    mode: RoutingMode;
    /** Estimated complexity (0-1) */
    complexity: number;
    /** Required roles */
    roles: RoleSpec[];
    /** Max agents to involve */
    maxAgents: number;
    /** Reasoning for the decision */
    reason: string;
}

// ─── Complexity Signals ──────────────────────────────────────────

/** Keywords that signal higher complexity */
const COMPLEX_SIGNALS = [
    'research', 'analyze', 'compare', 'synthesize', 'investigate',
    'design', 'architect', 'implement', 'build', 'create',
    'review', 'audit', 'benchmark', 'optimize', 'refactor',
    'multi-step', 'workflow', 'pipeline', 'coordinate',
    'paper', 'report', 'documentation', 'spec',
];

const SIMPLE_SIGNALS = [
    'summarize', 'translate', 'explain', 'define', 'list',
    'format', 'convert', 'calculate', 'lookup', 'check',
    'fix', 'typo', 'rename', 'update',
];

/** Role detection patterns */
const ROLE_PATTERNS: Array<{ pattern: RegExp; role: RoleSpec }> = [
    {
        pattern: /\b(research|paper|arxiv|literature|survey|study)\b/i,
        role: {
            role: 'researcher',
            taskType: 'research',
            capabilities: ['web-search', 'summarization'],
            specialties: ['research', 'arxiv'],
            kind: 'task',
            priority: 1,
        },
    },
    {
        pattern: /\b(code|implement|program|develop|build|script)\b/i,
        role: {
            role: 'coder',
            taskType: 'coding',
            capabilities: ['code-generation', 'debugging'],
            specialties: ['programming'],
            kind: 'task',
            priority: 2,
        },
    },
    {
        pattern: /\b(review|audit|check|validate|verify|test)\b/i,
        role: {
            role: 'reviewer',
            taskType: 'review',
            capabilities: ['code-review', 'analysis'],
            specialties: ['quality-assurance'],
            kind: 'review',
            priority: 3,
        },
    },
    {
        pattern: /\b(write|draft|compose|document|report)\b/i,
        role: {
            role: 'writer',
            taskType: 'writing',
            capabilities: ['text-generation', 'formatting'],
            specialties: ['writing'],
            kind: 'task',
            priority: 2,
        },
    },
    {
        pattern: /\b(analyze|data|metric|stat|chart|visuali[sz]e)\b/i,
        role: {
            role: 'analyst',
            taskType: 'analysis',
            capabilities: ['data-analysis', 'visualization'],
            specialties: ['analytics'],
            kind: 'task',
            priority: 2,
        },
    },
    {
        pattern: /\b(synthesize|combine|merge|integrate|consolidate)\b/i,
        role: {
            role: 'synthesizer',
            taskType: 'synthesis',
            capabilities: ['summarization', 'synthesis'],
            specialties: ['synthesis'],
            kind: 'synthesis',
            priority: 4,
        },
    },
];

// ─── Capability Router ───────────────────────────────────────────

export class CapabilityRouter {
    /**
     * Route an incoming request to the appropriate execution mode.
     */
    route(request: IncomingRequest): RoutingDecision {
        const complexity = this.estimateComplexity(request);
        const roles = this.detectRoles(request);
        const maxAgents = request.maxAgents || this.suggestAgentCount(complexity, roles.length);

        let mode: RoutingMode;
        let reason: string;

        if (complexity < 0.3) {
            mode = 'single-agent';
            reason = `Low complexity (${(complexity * 100).toFixed(0)}%) — single agent sufficient`;
        } else if (complexity < 0.65) {
            mode = 'select-from-pool';
            reason = `Medium complexity (${(complexity * 100).toFixed(0)}%) — selecting ${roles.length} agents from pool`;
        } else {
            mode = 'spawn-team';
            reason = `High complexity (${(complexity * 100).toFixed(0)}%) — spawning team of ${roles.length} agents`;
        }

        // Ensure at least one role
        if (roles.length === 0) {
            roles.push({
                role: 'generalist',
                taskType: 'general',
                capabilities: ['text-generation'],
                specialties: [],
                kind: 'task',
                priority: 1,
            });
        }

        // Always add a reviewer for high-complexity tasks
        if (complexity >= 0.7 && !roles.some(r => r.kind === 'review')) {
            roles.push({
                role: 'reviewer',
                taskType: 'review',
                capabilities: ['analysis'],
                specialties: ['quality-assurance'],
                kind: 'review',
                priority: 99,
            });
        }

        return { mode, complexity, roles, maxAgents, reason };
    }

    /**
     * Estimate task complexity (0-1) based on text signals.
     * Inspired by DAAO difficulty estimation.
     */
    estimateComplexity(request: IncomingRequest): number {
        const text = request.goal.toLowerCase();
        let score = 0;

        // Word count signal
        const words = text.split(/\s+/).length;
        score += Math.min(words / 100, 0.3); // Up to 0.3 for long goals

        // Complex keyword signals
        const complexMatches = COMPLEX_SIGNALS.filter(s => text.includes(s));
        score += complexMatches.length * 0.08;

        // Simple keyword signals (reduce complexity)
        const simpleMatches = SIMPLE_SIGNALS.filter(s => text.includes(s));
        score -= simpleMatches.length * 0.1;

        // Multiple task indicators (AND, then, also, plus)
        const multiTask = (text.match(/\b(and then|then|also|plus|additionally|moreover|furthermore)\b/g) || []).length;
        score += multiTask * 0.12;

        // Technical terms
        const technicalTerms = (text.match(/\b(api|database|architecture|distributed|concurrent|algorithm|protocol|encryption|authentication)\b/gi) || []).length;
        score += technicalTerms * 0.06;

        // Priority boost
        if (request.priority === 'critical') score += 0.15;
        if (request.priority === 'high') score += 0.1;

        // Required capabilities boost
        if (request.requiredCapabilities?.length) {
            score += request.requiredCapabilities.length * 0.05;
        }

        return Math.max(0, Math.min(1, score));
    }

    /**
     * Detect required roles from the request text.
     * Returns deduplicated, priority-sorted roles.
     */
    detectRoles(request: IncomingRequest): RoleSpec[] {
        const text = request.goal;
        const detected = new Map<string, RoleSpec>();

        for (const { pattern, role } of ROLE_PATTERNS) {
            if (pattern.test(text)) {
                if (!detected.has(role.role)) {
                    detected.set(role.role, { ...role });
                }
            }
        }

        // Add capabilities from explicit requirements
        if (request.requiredCapabilities?.length) {
            for (const cap of request.requiredCapabilities) {
                const existing = [...detected.values()].find(r =>
                    r.capabilities.includes(cap) || r.specialties.includes(cap)
                );
                if (!existing) {
                    detected.set(`specialist-${cap}`, {
                        role: `specialist-${cap}`,
                        taskType: cap,
                        capabilities: [cap],
                        specialties: [cap],
                        kind: 'task',
                        priority: 5,
                    });
                }
            }
        }

        return [...detected.values()].sort((a, b) => a.priority - b.priority);
    }

    /**
     * Suggest how many agents to use based on complexity and roles.
     */
    private suggestAgentCount(complexity: number, roleCount: number): number {
        if (complexity < 0.3) return 1;
        if (complexity < 0.5) return Math.max(2, roleCount);
        if (complexity < 0.7) return Math.max(3, roleCount);
        return Math.max(4, Math.min(8, roleCount + 1));
    }
}
