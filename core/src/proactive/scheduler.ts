import type { StepRequirements } from '../swp.js';
import type { SchedulerDecision, SwarmWorkerProfile } from './types.js';

export class SwarmScheduler {
    selectWorker(
        workers: SwarmWorkerProfile[],
        step: {
            kind: string;
            requirements?: StepRequirements | Record<string, unknown>;
            retry_count?: number;
        }
    ): SchedulerDecision | null {
        let best: SchedulerDecision | null = null;
        for (const worker of workers) {
            const score = this.scoreWorker(worker, step);
            if (score <= Number.NEGATIVE_INFINITY) continue;
            const decision: SchedulerDecision = {
                worker,
                score,
                reason: `health=${worker.health};load=${worker.load.toFixed(2)}`,
            };
            if (!best || decision.score > best.score) {
                best = decision;
            }
        }
        return best;
    }

    private scoreWorker(
        worker: SwarmWorkerProfile,
        step: {
            kind: string;
            requirements?: StepRequirements | Record<string, unknown>;
        }
    ): number {
        if (worker.health === 'unhealthy') return Number.NEGATIVE_INFINITY;
        if (!worker.kinds.includes(step.kind as SwarmWorkerProfile['kinds'][number])) {
            return Number.NEGATIVE_INFINITY;
        }

        const capabilities = Array.isArray((step.requirements as StepRequirements | undefined)?.capabilities)
            ? ((step.requirements as StepRequirements).capabilities || [])
            : [];
        const minReputation = typeof (step.requirements as StepRequirements | undefined)?.min_reputation === 'number'
            ? (step.requirements as StepRequirements).min_reputation || 0
            : 0;

        if (capabilities.length > 0 && !capabilities.every((cap) => worker.capabilities.includes(cap) || worker.specialties.includes(cap))) {
            return Number.NEGATIVE_INFINITY;
        }

        let score = 0;
        score += worker.health === 'healthy' ? 100 : 40;
        score += Math.max(0, 30 - worker.load * 30);
        score += Math.max(0, 20 - (worker.queueDepth || 0) * 2);
        score += (worker.successRate ?? 0.75) * 15;
        score += capabilities.filter((cap) => worker.capabilities.includes(cap)).length * 5;
        score += capabilities.filter((cap) => worker.specialties.includes(cap)).length * 3;
        score += minReputation > 0 ? 5 : 0;
        return score;
    }
}
