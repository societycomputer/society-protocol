import type { SocietyClient } from '../sdk/client.js';
import type { ResearchWorkerConfig } from '../proactive/types.js';

export class ResearchWorkerNode {
    private timer?: ReturnType<typeof setInterval>;
    private running = false;
    private readonly inFlight = new Set<string>();
    private readonly recentlySubmitted = new Map<string, number>();
    private readonly dedupeWindowMs = 15_000;

    constructor(
        private client: SocietyClient,
        private config: ResearchWorkerConfig
    ) {}

    async start(): Promise<void> {
        if (this.running) return;
        const maxConcurrency = this.maxConcurrency();
        await this.client.joinRoom(this.config.roomId);
        await this.client.announceWorker(this.config.roomId, {
            adapter_id: `worker-${this.config.hostId}`,
            runtime: this.config.runtime === 'custom' ? 'custom' : this.config.runtime,
            version: '1.0.0',
            display_name: this.client.getIdentity().name,
            specialties: this.config.specialties,
            kinds: this.config.kinds || ['task', 'review', 'synthesis', 'verification'],
            max_concurrency: maxConcurrency,
            endpoint: this.config.endpoint || '',
            auth_type: 'none',
            capabilities: this.config.capabilities,
            owner_did: this.client.getIdentity().did,
            room_id: this.config.roomId,
            peer_id: this.client.getPeerId(),
            host_id: this.config.hostId,
            mission_tags: this.config.missionTags || [],
        });
        this.running = true;
        await this.heartbeat();
        await this.loop();
        this.timer = setInterval(() => {
            this.loop().catch(() => {});
        }, this.config.pollIntervalMs || 10_000);
    }

    async stop(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        this.running = false;
        this.inFlight.clear();
        await this.client.heartbeatWorker(this.config.roomId, {
            adapter_id: `worker-${this.config.hostId}`,
            worker_did: this.client.getIdentity().did,
            active_tasks: 0,
            queue_depth: 0,
            health: 'unhealthy',
            room_id: this.config.roomId,
        });
    }

    private async loop(): Promise<void> {
        await this.heartbeat();
        const now = Date.now();
        for (const [stepId, ts] of this.recentlySubmitted.entries()) {
            if (now - ts > this.dedupeWindowMs) {
                this.recentlySubmitted.delete(stepId);
            }
        }

        if (this.inFlight.size >= this.maxConcurrency()) {
            return;
        }

        const steps = await this.client.getPendingSteps();
        for (const step of steps) {
            if (!this.running) break;
            if (this.inFlight.has(step.id)) continue;
            const lastSubmitAt = this.recentlySubmitted.get(step.id);
            if (lastSubmitAt && now - lastSubmitAt < this.dedupeWindowMs) continue;
            if (this.inFlight.size >= this.maxConcurrency()) break;

            this.inFlight.add(step.id);
            this.processStep(step)
                .catch(() => {})
                .finally(() => {
                    this.inFlight.delete(step.id);
                });
        }
    }

    private async processStep(step: { id: string; chainId: string; title: string }): Promise<void> {
        let result: {
            status: 'completed' | 'failed' | 'partial';
            output: string;
            artifacts?: Array<{ artifact_id?: string; artifact_type?: string; content?: string; content_hash?: string }>;
        };

        try {
            result = this.config.executor
                ? await this.config.executor({
                    stepId: step.id,
                    chainId: step.chainId,
                    title: step.title,
                })
                : {
                    status: 'completed',
                    output: `Research worker ${this.client.getIdentity().name} processed ${step.title}`,
                    artifacts: [],
                };
        } catch (error) {
            result = {
                status: 'failed',
                output: `Worker execution failed: ${(error as Error).message}`,
                artifacts: [],
            };
        }

        await this.client.submitStep(step.id, {
            status: result.status,
            output: result.output,
            artifacts: result.artifacts as any,
        });
        this.recentlySubmitted.set(step.id, Date.now());
        await this.heartbeat();
    }

    private maxConcurrency(): number {
        return Math.max(1, this.config.maxConcurrency || 1);
    }

    private async heartbeat(): Promise<void> {
        const maxConcurrency = this.maxConcurrency();
        const load = Math.min(1, this.inFlight.size / maxConcurrency);
        await this.client.sendWorkerPresence(this.config.roomId, {
            status: load >= 1 ? 'busy' : 'running',
            capabilities: ['worker', 'research', this.config.runtime, ...this.config.capabilities],
            specialties: this.config.specialties,
            load,
        });
        await this.client.heartbeatWorker(this.config.roomId, {
            adapter_id: `worker-${this.config.hostId}`,
            worker_did: this.client.getIdentity().did,
            active_tasks: this.inFlight.size,
            queue_depth: Math.max(0, this.inFlight.size - maxConcurrency),
            health: load >= 1 ? 'degraded' : 'healthy',
            room_id: this.config.roomId,
            metrics: {
                success_rate: 1,
            },
        });
    }
}
