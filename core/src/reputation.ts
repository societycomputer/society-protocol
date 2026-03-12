/**
 * Society Protocol — Reputation System v1.0
 *
 * Decentralized reputation tracking for agents based on:
 * - Task completion history
 * - Quality scores from reviews
 * - On-time delivery rates
 * - Community feedback
 * 
 * Uses exponential decay to weight recent performance higher.
 */

import { EventEmitter } from 'events';
import { type Storage } from './storage.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ReputationMetrics {
    tasks_completed: number;
    tasks_failed: number;
    tasks_cancelled: number;
    avg_quality_score: number; // 0.0 - 1.0
    avg_latency_ms: number;
    response_rate: number; // % of assignments accepted
    on_time_delivery: number; // % delivered before lease expiry
    total_tokens_used: number;
    total_cost_usd: number;
}

export interface SpecialtyScore {
    specialty: string;
    score: number; // 0.0 - 1.0
    tasks_completed: number;
    last_used: number;
}

export interface ReputationScore {
    did: string;
    display_name?: string;
    overall: number; // 0.0 - 1.0
    metrics: ReputationMetrics;
    specialties: SpecialtyScore[];
    trust_tier: 'unverified' | 'bronze' | 'silver' | 'gold' | 'platinum';
    first_seen: number;
    last_updated: number;
    version: number; // For cache invalidation
}

export interface ReputationConfig {
    // Decay factor per day (0.95 = 5% decay per day)
    decayFactor: number;
    // Minimum tasks before full reputation calculation
    minTasksForReliability: number;
    // Weights for overall score calculation
    weights: {
        quality: number;
        reliability: number;
        responsiveness: number;
        expertise: number;
    };
}

export interface TaskOutcome {
    did: string;
    chain_id: string;
    step_id: string;
    status: 'completed' | 'failed' | 'cancelled' | 'partial';
    quality_score?: number; // 0.0 - 1.0, from review
    latency_ms: number;
    lease_ms: number;
    accepted: boolean; // Whether agent accepted the assignment
    tokens_used?: number;
    cost_usd?: number;
    specialties_used: string[];
    timestamp: number;
}

/**
 * Lightweight reputation observation for gossip propagation.
 * One node's observation of another's performance — the unit of reputation gossip.
 */
export interface ReputationObservation {
    subject: string;      // DID of the agent being observed
    observer: string;     // DID of the observer
    timestamp: number;
    quality?: number;     // 0-1 quality score (if applicable)
    delivered: boolean;   // Did the agent deliver?
    onTime: boolean;      // Was it on time?
    specialties?: string[];
}

// ─── Default Configuration ──────────────────────────────────────

const DEFAULT_CONFIG: ReputationConfig = {
    decayFactor: 0.95,
    minTasksForReliability: 5,
    weights: {
        quality: 0.35,
        reliability: 0.30,
        responsiveness: 0.20,
        expertise: 0.15,
    },
};

// ─── Reputation Engine ──────────────────────────────────────────

export class ReputationEngine extends EventEmitter {
    private config: ReputationConfig;
    private cache = new Map<string, ReputationScore>();
    private dirtyDids = new Set<string>();
    private identityVerified = new Set<string>();

    constructor(
        private storage: Storage,
        config: Partial<ReputationConfig> = {}
    ) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.startPeriodicSync();
    }

    // ─── Core API ─────────────────────────────────────────────────

    /**
     * Record the outcome of a task assignment
     */
    async recordTaskOutcome(outcome: TaskOutcome): Promise<void> {
        // Store raw outcome
        this.storage.saveTaskOutcome(outcome);

        // Mark cache entry as dirty
        this.dirtyDids.add(outcome.did);

        // Emit event for real-time updates
        this.emit('outcome:recorded', outcome);

        // Recalculate if significant event
        if (outcome.status === 'completed' || outcome.status === 'failed') {
            await this.recalculateReputation(outcome.did);
        }
    }

    /**
     * Get current reputation score for a DID
     */
    async getReputation(did: string): Promise<ReputationScore> {
        // Check cache first
        const cached = this.cache.get(did);
        if (cached && !this.dirtyDids.has(did)) {
            return cached;
        }

        // Calculate fresh score
        const score = await this.calculateReputation(did);
        this.cache.set(did, score);
        this.dirtyDids.delete(did);

        return score;
    }

    /**
     * Get reputation for multiple DIDs (batch)
     */
    async getReputations(dids: string[]): Promise<Map<string, ReputationScore>> {
        const results = new Map<string, ReputationScore>();
        
        await Promise.all(
            dids.map(async (did) => {
                const rep = await this.getReputation(did);
                results.set(did, rep);
            })
        );

        return results;
    }

    /**
     * Rank agents by suitability for a specific task
     */
    async rankAgentsForTask(
        dids: string[],
        requirements: {
            specialties?: string[];
            minReputation?: number;
            kind?: string;
        }
    ): Promise<Array<{ did: string; score: number; reputation: ReputationScore }>> {
        const reputations = await this.getReputations(dids);
        const ranked: Array<{ did: string; score: number; reputation: ReputationScore }> = [];

        for (const [did, rep] of reputations) {
            // Filter by minimum reputation
            if (requirements.minReputation && rep.overall < requirements.minReputation) {
                continue;
            }

            // Calculate task-specific score
            const score = this.calculateTaskScore(rep, requirements);
            ranked.push({ did, score, reputation: rep });
        }

        // Sort by score descending
        ranked.sort((a, b) => b.score - a.score);

        return ranked;
    }

    /**
     * Update reputation based on peer review
     */
    async recordPeerReview(
        reviewerDid: string,
        subjectDid: string,
        chainId: string,
        stepId: string,
        rating: number, // 0.0 - 1.0
        feedback?: string
    ): Promise<void> {
        this.storage.savePeerReview({
            reviewer_did: reviewerDid,
            subject_did: subjectDid,
            chain_id: chainId,
            step_id: stepId,
            rating,
            feedback,
            timestamp: Date.now(),
        });

        this.dirtyDids.add(subjectDid);
        this.emit('review:received', { subjectDid, reviewerDid, rating });
    }

    /**
     * Get reputation trend over time
     */
    async getReputationHistory(
        did: string,
        days: number = 30
    ): Promise<Array<{ date: string; score: number }>> {
        const outcomes = this.storage.getTaskOutcomes(did, days);
        const history: Array<{ date: string; score: number }> = [];

        // Group by day and calculate running score
        const byDay = this.groupByDay(outcomes);
        
        for (const [date, dayOutcomes] of byDay) {
            const score = this.calculateScoreFromOutcomes(dayOutcomes);
            history.push({ date, score });
        }

        return history;
    }

    // ─── Calculation Logic ────────────────────────────────────────

    private async calculateReputation(did: string): Promise<ReputationScore> {
        const outcomes = this.storage.getAllTaskOutcomes(did);
        const reviews = this.storage.getPeerReviews(did);
        const existing = this.storage.getReputationRecord(did);

        if (outcomes.length === 0) {
            return this.getDefaultReputation(did, existing?.display_name);
        }

        // Calculate metrics
        const metrics = this.calculateMetrics(outcomes);

        // Calculate specialty scores
        const specialties = this.calculateSpecialtyScores(outcomes);

        // Calculate overall score
        const overall = this.calculateOverallScore(metrics, specialties, reviews);

        // Determine trust tier
        const trust_tier = this.calculateTrustTier(overall, metrics, did);

        return {
            did,
            display_name: existing?.display_name,
            overall,
            metrics,
            specialties,
            trust_tier,
            first_seen: existing?.first_seen || outcomes[0]?.timestamp || Date.now(),
            last_updated: Date.now(),
            version: (existing?.version || 0) + 1,
        };
    }

    private calculateMetrics(outcomes: TaskOutcome[]): ReputationMetrics {
        const completed = outcomes.filter(o => o.status === 'completed');
        const failed = outcomes.filter(o => o.status === 'failed');
        const cancelled = outcomes.filter(o => o.status === 'cancelled');
        const accepted = outcomes.filter(o => o.accepted);

        // Quality score from reviews and submissions
        const qualityScores = completed
            .map(o => o.quality_score)
            .filter((s): s is number => s !== undefined);

        const avg_quality = qualityScores.length > 0
            ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
            : 0.5; // Neutral default

        // Latency
        const latencies = completed.map(o => o.latency_ms);
        const avg_latency = latencies.length > 0
            ? latencies.reduce((a, b) => a + b, 0) / latencies.length
            : 0;

        // Response rate
        const response_rate = outcomes.length > 0
            ? accepted.length / outcomes.length
            : 0;

        // On-time delivery
        const onTime = completed.filter(o => o.latency_ms <= o.lease_ms);
        const on_time_rate = completed.length > 0
            ? onTime.length / completed.length
            : 0;

        return {
            tasks_completed: completed.length,
            tasks_failed: failed.length,
            tasks_cancelled: cancelled.length,
            avg_quality_score: avg_quality,
            avg_latency_ms: avg_latency,
            response_rate: response_rate,
            on_time_delivery: on_time_rate,
            total_tokens_used: completed.reduce((sum, o) => sum + (o.tokens_used || 0), 0),
            total_cost_usd: completed.reduce((sum, o) => sum + (o.cost_usd || 0), 0),
        };
    }

    private calculateSpecialtyScores(outcomes: TaskOutcome[]): SpecialtyScore[] {
        const bySpecialty = new Map<string, TaskOutcome[]>();

        // Group outcomes by specialty
        for (const outcome of outcomes) {
            for (const specialty of outcome.specialties_used) {
                const list = bySpecialty.get(specialty) || [];
                list.push(outcome);
                bySpecialty.set(specialty, list);
            }
        }

        // Calculate score for each specialty
        const scores: SpecialtyScore[] = [];
        for (const [specialty, specialtyOutcomes] of bySpecialty) {
            const completed = specialtyOutcomes.filter(o => o.status === 'completed');
            const qualityScores = completed
                .map(o => o.quality_score)
                .filter((s): s is number => s !== undefined);

            const avgQuality = qualityScores.length > 0
                ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
                : 0.5;

            // Apply decay based on recency
            const weightedScore = this.applyTemporalDecay(specialtyOutcomes, avgQuality);

            scores.push({
                specialty,
                score: weightedScore,
                tasks_completed: completed.length,
                last_used: Math.max(...specialtyOutcomes.map(o => o.timestamp)),
            });
        }

        // Sort by score descending
        scores.sort((a, b) => b.score - a.score);

        return scores;
    }

    private calculateOverallScore(
        metrics: ReputationMetrics,
        specialties: SpecialtyScore[],
        reviews: Array<{ rating: number; timestamp: number }>
    ): number {
        const { weights } = this.config;

        // Quality component (direct scores + peer reviews)
        let qualityScore = metrics.avg_quality_score;
        if (reviews.length > 0) {
            const avgReview = reviews.reduce((a, r) => a + r.rating, 0) / reviews.length;
            qualityScore = (qualityScore + avgReview) / 2;
        }

        // Reliability component
        const totalTasks = metrics.tasks_completed + metrics.tasks_failed;
        const successRate = totalTasks > 0
            ? metrics.tasks_completed / totalTasks
            : 0;
        const reliabilityScore = (
            successRate * 0.6 +
            metrics.on_time_delivery * 0.3 +
            metrics.response_rate * 0.1
        );

        // Responsiveness component
        const responsivenessScore = (
            metrics.response_rate * 0.7 +
            Math.max(0, 1 - metrics.avg_latency_ms / 300000) * 0.3 // Normalize to 5 min
        );

        // Expertise component (top specialty scores)
        const topSpecialties = specialties.slice(0, 3);
        const expertiseScore = topSpecialties.length > 0
            ? topSpecialties.reduce((a, s) => a + s.score, 0) / topSpecialties.length
            : 0.5;

        // Weighted sum
        return (
            qualityScore * weights.quality +
            reliabilityScore * weights.reliability +
            responsivenessScore * weights.responsiveness +
            expertiseScore * weights.expertise
        );
    }

    private calculateTaskScore(
        rep: ReputationScore,
        requirements: { specialties?: string[]; kind?: string }
    ): number {
        let score = rep.overall;

        // Boost for specialty match
        if (requirements.specialties) {
            const matches = requirements.specialties.filter(req =>
                rep.specialties.some(s =>
                    s.specialty.toLowerCase() === req.toLowerCase()
                )
            );
            const matchRatio = matches.length / requirements.specialties.length;
            score += matchRatio * 0.2; // Up to 20% boost
        }

        // Penalty for high load (handled separately, but slight preference for idle)
        // This is just a tiebreaker

        return Math.min(1, score);
    }

    private calculateTrustTier(
        overall: number,
        metrics: ReputationMetrics,
        did?: string
    ): ReputationScore['trust_tier'] {
        const totalTasks = metrics.tasks_completed + metrics.tasks_failed;
        const isVerified = did ? this.identityVerified.has(did) : false;

        if (totalTasks < 3 || overall < 0.3) {
            // ZKP-verified identity gets at least bronze
            return isVerified ? 'bronze' : 'unverified';
        }
        if (overall < 0.5) return 'bronze';
        if (overall < 0.7) return 'silver';
        if (overall < 0.9) return 'gold';
        return 'platinum';
    }

    private applyTemporalDecay(outcomes: TaskOutcome[], baseScore: number): number {
        const now = Date.now();
        let totalWeight = 0;
        let weightedSum = 0;

        for (const outcome of outcomes) {
            const daysAgo = (now - outcome.timestamp) / (1000 * 60 * 60 * 24);
            const weight = Math.pow(this.config.decayFactor, daysAgo);
            
            const score = outcome.status === 'completed'
                ? (outcome.quality_score || 0.7)
                : 0;

            weightedSum += score * weight;
            totalWeight += weight;
        }

        return totalWeight > 0 ? weightedSum / totalWeight : baseScore;
    }

    private getDefaultReputation(did: string, displayName?: string): ReputationScore {
        return {
            did,
            display_name: displayName,
            overall: 0.5, // Neutral starting point
            metrics: {
                tasks_completed: 0,
                tasks_failed: 0,
                tasks_cancelled: 0,
                avg_quality_score: 0,
                avg_latency_ms: 0,
                response_rate: 0,
                on_time_delivery: 0,
                total_tokens_used: 0,
                total_cost_usd: 0,
            },
            specialties: [],
            trust_tier: 'unverified',
            first_seen: Date.now(),
            last_updated: Date.now(),
            version: 1,
        };
    }

    // ─── Helpers ──────────────────────────────────────────────────

    private async recalculateReputation(did: string): Promise<void> {
        const score = await this.calculateReputation(did);
        this.cache.set(did, score);
        this.dirtyDids.delete(did);
        this.storage.saveReputation(score as unknown as {
            did: string;
            overall: number;
            trust_tier: string;
            metrics: Record<string, unknown>;
            specialties: Record<string, unknown>[];
            first_seen: number;
            version: number;
        });
        this.emit('reputation:updated', score);
    }

    // ─── Gossip-Propagated Reputation Sync ──────────────────────────

    /**
     * Reputation observation for network propagation.
     * Lightweight struct carrying a single peer's observation of another.
     */
    static serializeObservation(obs: ReputationObservation): Uint8Array {
        return new TextEncoder().encode(JSON.stringify(obs));
    }

    static deserializeObservation(data: Uint8Array): ReputationObservation {
        return JSON.parse(new TextDecoder().decode(data));
    }

    /**
     * Create a reputation observation from a task outcome.
     * This is the unit of gossip — a single observation, not a full score.
     */
    createObservation(outcome: TaskOutcome, observerDid: string): ReputationObservation {
        return {
            subject: outcome.did,
            observer: observerDid,
            timestamp: outcome.timestamp,
            quality: outcome.quality_score ?? (outcome.status === 'completed' ? 0.7 : 0.0),
            delivered: outcome.status === 'completed',
            onTime: outcome.latency_ms <= outcome.lease_ms,
            specialties: outcome.specialties_used,
        };
    }

    /**
     * Ingest a reputation observation received from the network.
     * Validates the observation and integrates it into the local reputation store.
     *
     * Anti-gaming: observations are weighted by the observer's own reputation
     * to reduce the impact of Sybil nodes (low-rep observers have diminished influence).
     */
    async ingestObservation(obs: ReputationObservation): Promise<boolean> {
        // Ignore observations older than 30 days
        const maxAge = 30 * 24 * 60 * 60 * 1000;
        if (Date.now() - obs.timestamp > maxAge) return false;

        // Ignore self-observations (no self-rating)
        if (obs.subject === obs.observer) return false;

        // Weight by observer reputation (Sybil dampening)
        const observerRep = await this.getReputation(obs.observer);
        const weight = Math.max(0.1, observerRep.overall); // Floor at 0.1 to not discard entirely

        // Convert observation to a synthetic task outcome with reduced weight
        const synthetic: TaskOutcome = {
            did: obs.subject,
            chain_id: `gossip_${obs.observer}_${obs.timestamp}`,
            step_id: 'observation',
            status: obs.delivered ? 'completed' : 'failed',
            quality_score: obs.quality ? obs.quality * weight : undefined,
            latency_ms: obs.onTime ? 1000 : 999999,
            lease_ms: 30000,
            accepted: true,
            specialties_used: obs.specialties || [],
            timestamp: obs.timestamp,
        };

        this.storage.saveTaskOutcome(synthetic);
        this.dirtyDids.add(obs.subject);
        this.emit('observation:ingested', { obs, weight });
        return true;
    }

    /**
     * Handle an incoming reputation gossip message from the network.
     */
    handleSyncMessage(data: Uint8Array, from: string): void {
        try {
            const obs = ReputationEngine.deserializeObservation(data);
            this.ingestObservation(obs).catch(err => {
                this.emit('sync:error', { error: err, from });
            });
        } catch (err) {
            this.emit('sync:error', { error: err, from });
        }
    }

    /**
     * Record that a DID has verified identity via ZKP (Schnorr PoK).
     * Verified identities get a minimum trust tier of 'bronze'.
     */
    recordIdentityVerification(did: string): void {
        this.identityVerified.add(did);
        this.dirtyDids.add(did);
        this.emit('identity:verified', { did });
    }

    /**
     * Check if a DID has a verified identity.
     */
    hasVerifiedIdentity(did: string): boolean {
        return this.identityVerified.has(did);
    }

    private startPeriodicSync(): void {
        // Sync dirty entries every 30 seconds
        setInterval(() => {
            if (this.dirtyDids.size > 0) {
                Promise.all(
                    Array.from(this.dirtyDids).map(did =>
                        this.recalculateReputation(did).catch(console.error)
                    )
                );
            }
        }, 30000);
    }

    private groupByDay(outcomes: TaskOutcome[]): Map<string, TaskOutcome[]> {
        const groups = new Map<string, TaskOutcome[]>();

        for (const outcome of outcomes) {
            const date = new Date(outcome.timestamp).toISOString().split('T')[0];
            const list = groups.get(date) || [];
            list.push(outcome);
            groups.set(date, list);
        }

        return groups;
    }

    private calculateScoreFromOutcomes(outcomes: TaskOutcome[]): number {
        const metrics = this.calculateMetrics(outcomes);
        return this.calculateOverallScore(metrics, [], []);
    }
}

// ─── Reputation Utilities ───────────────────────────────────────

export function formatReputationTier(tier: ReputationScore['trust_tier']): string {
    const icons = {
        unverified: '⚪',
        bronze: '🥉',
        silver: '🥈',
        gold: '🥇',
        platinum: '💎',
    };
    return `${icons[tier]} ${tier.charAt(0).toUpperCase() + tier.slice(1)}`;
}

export function isTrusted(rep: ReputationScore, minTier: ReputationScore['trust_tier'] = 'bronze'): boolean {
    const tiers: Array<ReputationScore['trust_tier']> = ['unverified', 'bronze', 'silver', 'gold', 'platinum'];
    return tiers.indexOf(rep.trust_tier) >= tiers.indexOf(minTier);
}
