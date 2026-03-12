/**
 * ProtocolBench — In-memory metrics collector.
 */

import type { MetricsCollector, CollectedMetrics } from './types.js';

export class InMemoryMetricsCollector implements MetricsCollector {
    private messages: CollectedMetrics['messages'] = [];
    private tasks: CollectedMetrics['tasks'] = [];
    private faults: CollectedMetrics['faults'] = [];
    private recoveries: CollectedMetrics['recoveries'] = [];

    recordMessage(type: string, sizeBytes: number, latencyMs: number): void {
        this.messages.push({ type, sizeBytes, latencyMs, timestamp: Date.now() });
    }

    recordTaskCompletion(success: boolean, qualityScore: number = success ? 1.0 : 0.0): void {
        this.tasks.push({ success, qualityScore, timestamp: Date.now() });
    }

    recordFault(type: string): void {
        this.faults.push({ type, timestamp: Date.now() });
    }

    recordRecovery(type: string, recoveryMs: number): void {
        this.recoveries.push({ type, recoveryMs, timestamp: Date.now() });
    }

    snapshot(): CollectedMetrics {
        return {
            messages: [...this.messages],
            tasks: [...this.tasks],
            faults: [...this.faults],
            recoveries: [...this.recoveries],
        };
    }

    reset(): void {
        this.messages = [];
        this.tasks = [];
        this.faults = [];
        this.recoveries = [];
    }
}
