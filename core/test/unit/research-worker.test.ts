import { describe, it, expect } from 'vitest';
import { ResearchWorkerNode } from '../../src/workers/research-worker.js';

class FakeClient {
    public submitCount = 0;
    public maxActiveTasks = 0;

    async joinRoom(): Promise<void> {}
    async announceWorker(): Promise<void> {}
    getIdentity() {
        return { did: 'did:key:worker', name: 'Worker' };
    }
    getPeerId(): string {
        return 'peer_worker_1';
    }
    async sendWorkerPresence(): Promise<void> {}
    async heartbeatWorker(_roomId: string, heartbeat: { active_tasks: number }): Promise<void> {
        this.maxActiveTasks = Math.max(this.maxActiveTasks, heartbeat.active_tasks);
    }
    async getPendingSteps(): Promise<Array<{ id: string; chainId: string; title: string; status: string }>> {
        return [{ id: 'step-1', chainId: 'chain-1', title: 'Extract findings', status: 'assigned' }];
    }
    async submitStep(): Promise<void> {
        this.submitCount += 1;
    }
}

describe('ResearchWorkerNode', () => {
    it('avoids duplicate submit for the same in-flight/polled step', async () => {
        const client = new FakeClient() as any;
        const worker = new ResearchWorkerNode(client, {
            roomId: 'lab',
            hostId: 'host-a',
            runtime: 'nanobot',
            specialties: ['research'],
            capabilities: ['research', 'academic-search'],
            maxConcurrency: 1,
            pollIntervalMs: 10,
            executor: async () => {
                await new Promise((resolve) => setTimeout(resolve, 40));
                return { status: 'completed' as const, output: 'ok', artifacts: [] };
            },
        });

        await worker.start();
        await new Promise((resolve) => setTimeout(resolve, 180));
        await worker.stop();

        expect(client.submitCount).toBe(1);
        expect(client.maxActiveTasks).toBeLessThanOrEqual(1);
    });
});
